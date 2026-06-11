/**
 * VIRTÙ — Edge Function: calcular-frete
 * Calcula as opções de entrega com base no CEP informado.
 *
 * Regiões atendidas:
 *   Grande JP (Frete Grátis) — João Pessoa, Cabedelo, Santa Rita, Bayeux, Conde
 *   Nordeste (R$ 18,00)      — AL, BA, CE, MA, PB, PE, PI, RN, SE
 *   Fora do Nordeste         — Não atendido por enquanto
 *
 * Input:  POST { cep: string, valor: number }
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

    const cepNum = parseInt(cepRaw, 10);
    const { match: grandeJP, cidade } = isGrandeJP(cepNum);

    // ── Grande JP — Frete Grátis ──────────────────────────────────────────────
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

    // ── Nordeste — Frete Padrão R$ 18,00 ─────────────────────────────────────
    if (isNordeste(cepNum)) {
      const opcoes: Opcao[] = [
        {
          id:             'nordeste',
          nome:           'Entrega Padrão',
          descricao:      'Transportadora parceira',
          prazo:          '7-14 dias úteis',
          preco:          18.00,
          precoFormatado: 'R$ 18,00',
          precoOriginal:  null,
        },
      ];
      return json({ opcoes });
    }

    // ── Fora do Nordeste — não atendido ───────────────────────────────────────
    return json(
      { error: 'Ainda não realizamos entregas fora do Nordeste. Em breve expandiremos nossa área de cobertura!' },
      200, // 200 para o front exibir a mensagem amigável
    );

  } catch (err) {
    console.error('[calcular-frete]', err);
    return json({ error: 'Erro interno ao calcular frete. Tente novamente.' }, 500);
  }
});
