/**
 * VIRTÙ — Edge Function: calcular-frete
 * Calcula as opções de entrega com base no CEP informado.
 *
 * Regiões atendidas (todo o Brasil):
 *   Grande JP (Frete Grátis) — João Pessoa, Cabedelo, Santa Rita, Bayeux, Conde
 *   Nordeste (R$ 18,00)      — AL, BA, CE, MA, PB, PE, PI, RN, SE
 *   Sul / Sudeste (R$ 19,90)
 *   Norte / Centro-Oeste (R$ 29,90)
 *   Frete GRÁTIS em todo o Brasil quando o subtotal ≥ R$ 799,00.
 *
 * Input:  POST { cep: string, valor: number }   (valor = subtotal dos produtos)
 * Output: { opcoes: Opcao[] }  |  { error: string }
 */

// ── Tipos ────────────────────────────────────────────────────────────────────

interface Opcao {
  id: string;
  nome: string;
  descricao: string;
  prazo: string;
  preco: number;
  precoFormatado: string;
  precoOriginal: string | null;
}

// ── CORS / Security ───────────────────────────────────────────────────────────

const corsHeaders = {
  'Access-Control-Allow-Origin':  'https://wearvirtu.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const securityHeaders = {
  'X-Content-Type-Options':    'nosniff',
  'X-Frame-Options':           'DENY',
  'Referrer-Policy':           'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Content-Security-Policy':   "default-src 'none'",
};

// ── CEP ranges ────────────────────────────────────────────────────────────────

/** Grande JP — frete grátis */
const GRANDE_JP: { min: number; max: number; cidade: string }[] = [
  { min: 58000000, max: 58099999, cidade: 'João Pessoa'  },
  { min: 58102000, max: 58109999, cidade: 'Cabedelo'     },
  { min: 58300000, max: 58339999, cidade: 'Santa Rita'   },
  { min: 58400000, max: 58419999, cidade: 'Bayeux'       },
  { min: 58065000, max: 58066999, cidade: 'Conde'        },
];

/** Nordeste — faixa de CEP por estado */
const NORDESTE_RANGES: { min: number; max: number }[] = [
  { min: 40000000, max: 48999999 }, // BA
  { min: 49000000, max: 49999999 }, // SE
  { min: 50000000, max: 56999999 }, // PE
  { min: 57000000, max: 57999999 }, // AL
  { min: 58000000, max: 58999999 }, // PB
  { min: 59000000, max: 59999999 }, // RN
  { min: 60000000, max: 63999999 }, // CE
  { min: 64000000, max: 64999999 }, // PI
  { min: 65000000, max: 65999999 }, // MA
];

/** Norte + Centro-Oeste — CEP 66.000.000 a 79.999.999 (PA,AP,AM,RR,AC,RO,TO,DF,GO,MT,MS) */
const NORTE_CO_RANGES: { min: number; max: number }[] = [
  { min: 66000000, max: 79999999 },
];

/** Sul + Sudeste — Sudeste (01.000.000–39.999.999) e Sul (80.000.000–99.999.999) */
const SUL_SUDESTE_RANGES: { min: number; max: number }[] = [
  { min: 1000000,  max: 39999999 }, // SP, RJ, ES, MG
  { min: 80000000, max: 99999999 }, // PR, SC, RS
];

/** Frete grátis em todo o Brasil quando o subtotal dos produtos atinge: */
const FRETE_GRATIS_ACIMA = 799.00;

function inRanges(cep: number, ranges: { min: number; max: number }[]): boolean {
  return ranges.some(r => cep >= r.min && cep <= r.max);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtBRL(valor: number): string {
  if (valor === 0) return 'Grátis';
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function isGrandeJP(cepNum: number): { match: boolean; cidade: string } {
  for (const r of GRANDE_JP) {
    if (cepNum >= r.min && cepNum <= r.max) {
      return { match: true, cidade: r.cidade };
    }
  }
  return { match: false, cidade: '' };
}

function isNordeste(cepNum: number): boolean {
  return NORDESTE_RANGES.some(r => cepNum >= r.min && cepNum <= r.max);
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' },
  });
}

// ── Handler principal ─────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const cepRaw = String(body.cep ?? '').replace(/\D/g, '');

    if (cepRaw.length !== 8) {
      return json({ error: 'CEP inválido. Informe os 8 dígitos.' }, 400);
    }

    const cepNum   = parseInt(cepRaw, 10);
    const subtotal = Number(body.valor ?? 0);
    const freteGratisBrasil = subtotal >= FRETE_GRATIS_ACIMA;
    const { match: grandeJP, cidade } = isGrandeJP(cepNum);

    // ── Grande JP — Frete Grátis (sempre) ─────────────────────────────────────
    if (grandeJP) {
      const opcoes: Opcao[] = [];

      // Opção 1: Entrega Grátis padrão (disponível para todas as cidades Grande JP)
      opcoes.push({
        id:             'gratis',
        nome:           'Entrega Grátis',
        descricao:      `Grande João Pessoa · ${cidade}`,
        prazo:          '2-5 dias úteis',
        preco:          0,
        precoFormatado: 'Grátis',
        precoOriginal:  null,
      });

      // Opção 2: Motoboy (disponível apenas para João Pessoa)
      if (cepNum >= 58000000 && cepNum <= 58099999) {
        opcoes.push({
          id:             'motoboy',
          nome:           'Motoboy Expresso',
          descricao:      'Entrega em João Pessoa',
          prazo:          'Hoje ou amanhã',
          preco:          15.00,
          precoFormatado: 'R$ 15,00',
          precoOriginal:  null,
        });
      }

      return json({ opcoes });
    }

    // ── Demais regiões do Brasil — valor por região ──────────────────────────
    let precoRegional: number | null = null;
    let prazo = '';
    if (isNordeste(cepNum)) {
      precoRegional = 18.00;  prazo = '7-14 dias úteis';
    } else if (inRanges(cepNum, SUL_SUDESTE_RANGES)) {
      precoRegional = 19.90;  prazo = '7-14 dias úteis';
    } else if (inRanges(cepNum, NORTE_CO_RANGES)) {
      precoRegional = 29.90;  prazo = '10-18 dias úteis';
    }

    if (precoRegional === null) {
      return json({ error: 'CEP inválido. Verifique e tente novamente.' }, 200);
    }

    // Frete grátis em todo o Brasil acima de R$799 → mostra o valor original riscado.
    if (freteGratisBrasil) {
      return json({
        opcoes: [{
          id:             'gratis-brasil',
          nome:           'Entrega Grátis',
          descricao:      '✦ Frete grátis acima de R$799',
          prazo,
          preco:          0,
          precoFormatado: 'Grátis',
          precoOriginal:  fmtBRL(precoRegional),
        }],
      });
    }

    return json({
      opcoes: [{
        id:             'padrao',
        nome:           'Entrega Padrão',
        descricao:      'Transportadora parceira',
        prazo,
        preco:          precoRegional,
        precoFormatado: fmtBRL(precoRegional),
        precoOriginal:  null,
      }],
    });

  } catch (err) {
    console.error('[calcular-frete]', err);
    return json({ error: 'Erro interno ao calcular frete. Tente novamente.' }, 500);
  }
});
