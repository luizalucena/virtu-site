/**
 * VIRTÙ — Edge Function: processar-pagamento  (v31 — ASAAS)
 * Recebe dados do checkout, chama o ASAAS v3 e salva o pedido no Supabase.
 *
 * Segurança:
 *   - Cartão: dados tokenizados via ASAAS (PCI-DSS) — nosso servidor repassa
 *             dados criptografados diretamente ao ASAAS, nunca os armazena
 *   - Preços: recalculados no servidor a partir do banco (anti-tampering)
 *   - Taxa de cartão (5%) e arredondamento ,90 aplicados server-side
 *   - Gift Card R$100: elegibilidade validada server-side (gift_card_status)
 *
 * Variáveis de ambiente necessárias (Supabase Secrets):
 *   ASAAS_API_KEY        — access_token do ASAAS (nunca vai ao frontend)
 *   ASAAS_SANDBOX        — 'true' para sandbox, 'false' para produção
 *   SUPABASE_URL         — Injetada automaticamente pelo Supabase
 *   SUPABASE_SERVICE_ROLE_KEY — Injetada automaticamente
 *   SUPABASE_ANON_KEY    — Injetada automaticamente
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── CORS / Security ─────────────────────────────────────────
const ALLOWED_ORIGIN = 'https://wearvirtu.com';

const corsHeaders = {
  'Access-Control-Allow-Origin':  ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age':       '86400',
};

const securityHeaders = {
  'X-Content-Type-Options':    'nosniff',
  'X-Frame-Options':           'DENY',
  'Referrer-Policy':           'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Content-Security-Policy':   "default-src 'none'",
};

// ── AJUSTE POR MÉTODO — espelho de AJUSTE_METODO no frontend ──
// PIX: sem ajuste (valor cheio); Débito/Crédito: +5% (taxa de cartão).
// A taxa incide sobre o TOTAL cobrado (subtotal − desconto + frete).
// Edite aqui E no checkout.js/produto.js/carrinho.js de forma sincronizada.
const AJUSTE_METODO: Record<string, number> = {
  pix:     0,     // sem ajuste — PIX paga o valor cheio
  debito:  0.05,  // 5% de ACRÉSCIMO (taxa de cartão)
  cartao:  0.05,  // 5% de ACRÉSCIMO (taxa de cartão)
};

// Frete grátis para todo o Brasil quando o subtotal dos PRODUTOS atinge:
const FRETE_GRATIS_ACIMA = 799.00;

/**
 * Arredondamento estético: leva o valor ao múltiplo terminado em ",90"
 * MAIS PRÓXIMO. Empate arredonda para cima.
 *   resultado = round(valor − 0,90) + 0,90
 *   179,87 → 179,90 | 179,10 → 178,90 | 188,895 → 188,90
 * (epsilon anti-ponto-flutuante no meio do arredondamento)
 */
function arredondar90(valor: number): number {
  const base  = valor - 0.90;
  const arred = Math.floor(base + 0.5 + 1e-9); // half-up estável
  return Math.round((arred + 0.90) * 100) / 100;
}

// ── Helpers ──────────────────────────────────────────────────
function sanitize(val: unknown, maxLen = 255): string {
  return String(val ?? '').trim().replace(/[<>"'`]/g, '').slice(0, maxLen);
}

/**
 * Fretes válidos para um CEP (anti-tampering do valor de frete).
 * Espelha supabase/functions/calcular-frete — MANTER SINCRONIZADO:
 *   Grande JP → grátis (+ motoboy R$15 só João Pessoa)
 *   Nordeste (fora Grande JP) → R$18
 *   Sul / Sudeste            → R$19,90
 *   Norte / Centro-Oeste     → R$29,90
 *   Frete grátis em TODO o Brasil quando subtotal ≥ R$799 (além de 0,
 *   o valor regional continua válido caso o cliente já tivesse selecionado).
 *
 * @param cepRaw   CEP do cliente
 * @param subtotal Subtotal dos PRODUTOS (base do frete grátis ≥ 799)
 */
function fretesPermitidos(cepRaw: unknown, subtotal = 0): number[] {
  const digits = String(cepRaw ?? '').replace(/\D/g, '');
  if (digits.length !== 8) return [];
  const cep = parseInt(digits, 10);

  const jp = cep >= 58000000 && cep <= 58099999;                 // João Pessoa
  const grandeJP = jp
    || (cep >= 58102000 && cep <= 58109999)                       // Cabedelo
    || (cep >= 58300000 && cep <= 58339999)                       // Santa Rita
    || (cep >= 58400000 && cep <= 58419999)                       // Bayeux
    || (cep >= 58065000 && cep <= 58066999);                      // Conde

  const freteGratisBrasil = Number(subtotal) >= FRETE_GRATIS_ACIMA;

  // Grande JP: sempre grátis (+ motoboy só em JP).
  if (grandeJP) return jp ? [0, 15] : [0];

  // Determina o valor regional base.
  let regional: number | null = null;
  const nordeste =
       (cep >= 40000000 && cep <= 65999999);                      // NE (BA→MA)
  const norteCentroOeste = (cep >= 66000000 && cep <= 79999999);  // Norte + C-Oeste
  const sulSudeste =
       (cep >= 1000000  && cep <= 39999999)                       // Sudeste (SP/RJ/ES/MG)
    || (cep >= 80000000 && cep <= 99999999);                      // Sul (PR/SC/RS)

  if (nordeste)              regional = 18.00;
  else if (sulSudeste)       regional = 19.90;
  else if (norteCentroOeste) regional = 29.90;

  if (regional === null) return [];               // CEP inexistente/ inválido

  // Acima de R$799 → frete grátis (0) também é válido para qualquer região.
  return freteGratisBrasil ? [0, regional] : [regional];
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' },
  });
}

/** Base URL da API ASAAS (sandbox ou produção) */
function asaasBase(): string {
  const sandbox = Deno.env.get('ASAAS_SANDBOX');
  return sandbox === 'true'
    ? 'https://sandbox.asaas.com/api/v3'
    : 'https://api.asaas.com/v3';
}

/** Headers padrão para todas as chamadas ASAAS */
function asaasHeaders(): Record<string, string> {
  return {
    'access_token':  Deno.env.get('ASAAS_API_KEY') ?? '',
    'Content-Type':  'application/json',
    'User-Agent':    'Virtu-EF/1.0',
  };
}

/** Cria ou recupera cliente no ASAAS. Retorna o asaas_customer_id. */
async function upsertAsaasCustomer(params: {
  nome: string;
  email: string;
  cpf: string;
  telefone?: string;
  supabase: ReturnType<typeof createClient>;
  userId: string | null;
}): Promise<string> {
  const { nome, email, cpf, telefone, supabase, userId } = params;

  // 1. Verifica se já existe um customer salvo no Supabase
  if (userId) {
    const { data: perfil } = await supabase
      .from('clientes_perfil')
      .select('asaas_customer_id')
      .eq('id', userId)
      .maybeSingle();

    if (perfil?.asaas_customer_id) {
      return perfil.asaas_customer_id;
    }
  }

  // 2. Tenta buscar pelo CPF no ASAAS
  const cpfClean = cpf.replace(/\D/g, '');
  const searchRes = await fetch(
    `${asaasBase()}/customers?cpfCnpj=${cpfClean}&limit=1`,
    { headers: asaasHeaders() },
  );
  if (searchRes.ok) {
    const searchData = await searchRes.json();
    if (searchData?.data?.[0]?.id) {
      const existingId: string = searchData.data[0].id;
      // Persiste para evitar nova busca na próxima compra
      if (userId) {
        await supabase
          .from('clientes_perfil')
          .update({ asaas_customer_id: existingId })
          .eq('id', userId);
      }
      return existingId;
    }
  }

  // 3. Cria novo cliente no ASAAS
  const createRes = await fetch(`${asaasBase()}/customers`, {
    method:  'POST',
    headers: asaasHeaders(),
    body: JSON.stringify({
      name:       nome,
      email:      email,
      cpfCnpj:    cpfClean,
      mobilePhone: telefone ? telefone.replace(/\D/g, '') : undefined,
      notificationDisabled: true, // notificações gerenciadas pela Virtù via Resend
    }),
  });

  const createData = await createRes.json();
  if (!createRes.ok || !createData.id) {
    throw new Error(`ASAAS criar cliente: ${createData.errors?.[0]?.description || createData.error || 'Erro desconhecido'}`);
  }

  const newId: string = createData.id;

  // Persiste o customer_id no perfil do usuário
  if (userId) {
    await supabase
      .from('clientes_perfil')
      .update({ asaas_customer_id: newId })
      .eq('id', userId);
  }

  return newId;
}

// ── Handler principal ────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      tipo,               // 'pix' | 'cartao' | 'debito'
      subtotal,
      frete,
      desconto,
      itens,
      cliente,            // { nome, email, cpf, telefone }
      endereco,
      // cartão — enviados diretamente (ASAAS cuida da tokenização PCI)
      card_number,        // string — apenas dígitos
      card_holder_name,   // string
      card_expiry_month,  // string — MM
      card_expiry_year,   // string — YYYY
      card_cvv,           // string
      parcelas,           // number — 1..12
      // cupom
      cupom_codigo,
      // gift card R$100 (clientes fiéis) — o frontend só SOLICITA; a
      // elegibilidade é decidida no servidor. `fidelidade_desconto` é
      // aceito por retrocompatibilidade com clientes ainda em cache.
      user_id,
      gift_card_solicitado: gift_card_solicitado_raw,
      fidelidade_desconto,
      // idempotência (anti cobrança dupla) — gerada no checkout.js
      idempotency_key,
    } = body;

    const gift_card_solicitado = gift_card_solicitado_raw ?? fidelidade_desconto ?? false;

    // Chave de idempotência: string curta, opcional (retrocompatível).
    const idemKey = idempotency_key
      ? String(idempotency_key).replace(/[^A-Za-z0-9._-]/g, '').slice(0, 100) || null
      : null;

    // ── Validações de entrada ────────────────────────────────
    if (!tipo || !['pix', 'cartao', 'debito'].includes(tipo)) {
      return json({ erro: 'Tipo de pagamento inválido.' }, 400);
    }
    if (!cliente?.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cliente.email)) {
      return json({ erro: 'E-mail inválido.' }, 400);
    }
    if (!cliente?.cpf || String(cliente.cpf).replace(/\D/g, '').length !== 11) {
      return json({ erro: 'CPF inválido.' }, 400);
    }
    if (itens && (itens as unknown[]).length > 50) {
      return json({ erro: 'Número de itens excede o limite permitido.' }, 400);
    }

    // Sanitiza campos de texto
    if (cliente.nome)     cliente.nome     = sanitize(cliente.nome, 120);
    if (cliente.telefone) cliente.telefone = String(cliente.telefone).replace(/\D/g, '').slice(0, 11);
    if (cliente.cpf)      cliente.cpf      = String(cliente.cpf).replace(/\D/g, '').slice(0, 11);
    if (endereco) {
      if (endereco.rua)         endereco.rua         = sanitize(endereco.rua, 200);
      if (endereco.complemento) endereco.complemento = sanitize(endereco.complemento, 100);
      if (endereco.bairro)      endereco.bairro      = sanitize(endereco.bairro, 100);
      if (endereco.cidade)      endereco.cidade      = sanitize(endereco.cidade, 100);
      if (endereco.cep)         endereco.cep         = String(endereco.cep).replace(/\D/g, '').slice(0, 8);
    }

    const ASAAS_KEY = Deno.env.get('ASAAS_API_KEY');
    if (!ASAAS_KEY) {
      return json({ erro: 'Gateway não configurado.' }, 500);
    }

    // ── Supabase service client ──────────────────────────────
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ── Valida JWT → confirma user_id ────────────────────────
    let confirmedUserId: string | null = null;
    const authHeader = req.headers.get('Authorization') || '';
    const jwtToken   = authHeader.replace(/^Bearer\s+/i, '');
    if (jwtToken) {
      try {
        const anonClient = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_ANON_KEY')!,
        );
        const { data: { user: jwtUser } } = await anonClient.auth.getUser(jwtToken);
        if (jwtUser?.id) {
          confirmedUserId = jwtUser.id;
          if (user_id && user_id !== confirmedUserId) {
            console.warn('[processar-pagamento] user_id payload != JWT — usando JWT');
          }
        }
      } catch { /* JWT inválido — prossegue sem user_id */ }
    }

    // ── Recálculo server-side do subtotal (anti-tampering) ───
    // Todo item precisa existir no banco. Se algum não casar, recusamos —
    // NUNCA confiamos no subtotal vindo do cliente (evita adulteração de preço).
    if (!itens?.length) {
      return json({ erro: 'Carrinho vazio.' }, 400);
    }
    const productIds = (itens as any[]).map((i) => i.id).filter(Boolean);
    const { data: produtos } = await supabase
      .from('produtos')
      .select('id, preco_original, preco_desconto')
      .in('id', productIds);

    const priceMap: Record<string, number> = {};
    for (const p of produtos ?? []) {
      priceMap[p.id] = Number(p.preco_desconto ?? p.preco_original) || 0;
    }

    let serverSubtotal = 0;
    for (const item of itens as any[]) {
      const sp = priceMap[item.id];
      if (sp === undefined) {
        console.error('[processar-pagamento] Item sem preço no banco:', item?.id);
        return json({ erro: 'Um item do carrinho é inválido. Atualize a página e tente novamente.' }, 400);
      }
      serverSubtotal += sp * (Number(item.qty) || 1);
    }

    const freteNum = Number(frete ?? 0);

    // ── Valida o frete server-side (anti-tampering) ──────────
    // O cliente escolhe a opção, mas o PREÇO é validado contra o CEP e o
    // subtotal (frete grátis ≥ R$799). Base do frete grátis = serverSubtotal.
    const fretesOk = fretesPermitidos(endereco?.cep, serverSubtotal);
    if (!fretesOk.some((p) => Math.abs(p - freteNum) <= 0.01)) {
      console.warn(`[Frete] inválido: cep=${endereco?.cep} frete=${freteNum} permitidos=[${fretesOk}]`);
      return json({ erro: 'Opção de frete inválida para o endereço informado.' }, 400);
    }

    // ── Valida cupom server-side (anti-tampering) ────────────
    // Base do desconto = serverSubtotal (recalculado), NUNCA o subtotal do cliente.
    let descontoNum = 0;
    if (cupom_codigo && String(cupom_codigo).trim()) {
      try {
        const codigoCupom = String(cupom_codigo).trim().toUpperCase();
        const emailCupom  = cliente?.email || null;
        const { data: cupomData, error: cupomErr } = await supabase
          .rpc('validar_cupom', { p_codigo: codigoCupom, p_email: emailCupom });

        if (cupomErr) {
          console.warn('[Cupom] Erro RPC:', cupomErr.message);
        } else if (cupomData?.valido === true) {
          const tipoCupom   = cupomData.tipo;                  // 'percentual' | 'frete'
          const valorCupom  = Number(cupomData.valor ?? 0);
          const valorMinimo = Number(cupomData.valor_minimo ?? 0);

          if (serverSubtotal < valorMinimo) {
            // Pedido abaixo do mínimo exigido pelo cupom → não aplica
            console.warn(`[Cupom] "${codigoCupom}" ignorado: subtotal R$${serverSubtotal} < mínimo R$${valorMinimo}`);
          } else if (tipoCupom === 'percentual') {
            // Aplica sobre o subtotal do servidor; nunca excede o próprio subtotal
            descontoNum = Math.min(
              serverSubtotal,
              Math.round(serverSubtotal * (valorCupom / 100) * 100) / 100,
            );
            console.log(`[Cupom] "${codigoCupom}" validado → desconto=R$${descontoNum}`);
          } else {
            // Cupom 'frete' (ou outro tipo): não vira desconto de produto.
            // Frete grátis é tratado automaticamente por CEP, não por cupom.
            console.log(`[Cupom] "${codigoCupom}" tipo "${tipoCupom}" — sem desconto de produto`);
          }
        } else {
          console.warn(`[Cupom] "${codigoCupom}" inválido/expirado/limite (server)`);
        }
      } catch (cupomEx) {
        console.error('[Cupom] Exceção:', cupomEx);
      }
    }

    // ── Gift Card R$100 (validação server-side) ──────────────
    // Elegível: cliente LOGADO com ≥6 compras válidas (1/dia) e gift card
    // ainda não consumido. Benefício: −R$100 se subtotal ≥ R$459.
    // A elegibilidade é decidida por gift_card_status (SECURITY DEFINER),
    // NUNCA pelo frontend. Recomputamos tudo do zero aqui.
    let descontoGiftCard = 0;
    let giftCardAplicado = false;
    if (gift_card_solicitado && confirmedUserId) {
      try {
        const { data: gc, error: gcErr } = await supabase
          .rpc('gift_card_status', { p_user_id: confirmedUserId });
        if (gcErr) {
          console.error('[GiftCard] Erro RPC:', gcErr.message);
        } else if (gc?.elegivel === true && serverSubtotal >= Number(gc.min_subtotal ?? 459)) {
          descontoGiftCard = Number(gc.valor ?? 100);
          giftCardAplicado = true;
          console.log(`[GiftCard] Aplicado: user=${confirmedUserId} subtotal=R$${serverSubtotal} → −R$${descontoGiftCard}`);
        } else {
          console.warn(`[GiftCard] Não aplicado: elegivel=${gc?.elegivel} subtotal=R$${serverSubtotal}`);
        }
      } catch (gcEx) {
        console.error('[GiftCard] Exceção:', gcEx);
      }
    }

    // ── Pipeline de cálculo (ordem exata) ────────────────────
    //   subtotal → frete → desconto (cupom + gift card) →
    //   baseTotal = (subtotal − desconto) + frete →
    //   PIX = baseTotal ; Cartão/Débito = baseTotal × 1,05 (taxa sobre o
    //   TOTAL, incluindo frete) → arredondamento estético ,90.
    const parcelasNum   = Math.max(1, Math.min(Number(parcelas) || 1, 12));
    const ajuste        = AJUSTE_METODO[tipo] ?? 0;
    const descontoTotal = descontoNum + descontoGiftCard;
    const subMenosDesc  = Math.max(0, serverSubtotal - descontoTotal);
    const baseTotal     = Math.round((subMenosDesc + freteNum) * 100) / 100;
    const totalBruto    = baseTotal * (1 + ajuste);
    const serverTotal   = arredondar90(totalBruto);

    if (serverTotal <= 0) {
      return json({ erro: 'Valor do pedido inválido.' }, 400);
    }

    // ── Valida estoque ANTES de cobrar (reduz oversell) ──────
    // Não é reserva atômica: resta uma pequena janela até o trigger debitar,
    // mas evita aceitar pagamento de item claramente esgotado.
    {
      const { data: vars } = await supabase
        .from('variacoes')
        .select('produto_id, tamanho, cor_nome, estoque')
        .in('produto_id', productIds);

      for (const item of itens as any[]) {
        const qty       = Number(item.qty) || 1;
        const doProduto = (vars ?? []).filter((v) => v.produto_id === item.id);
        let estoqueDisp: number;

        const exata = doProduto.find((v) =>
          (item.tamanho  == null || v.tamanho  === item.tamanho) &&
          (item.cor_nome == null || v.cor_nome === item.cor_nome),
        );
        if (exata) {
          estoqueDisp = Number(exata.estoque) || 0;
        } else if (doProduto.length > 0) {
          // espelha o fallback do trigger: qualquer variação do produto
          estoqueDisp = doProduto.reduce((m, v) => Math.max(m, Number(v.estoque) || 0), 0);
        } else {
          // produto sem variação cadastrada → usa produtos.estoque
          const { data: prod } = await supabase
            .from('produtos').select('estoque').eq('id', item.id).maybeSingle();
          estoqueDisp = Number(prod?.estoque) || 0;
        }

        if (estoqueDisp < qty) {
          return json(
            { erro: `Estoque insuficiente para "${sanitize(item?.nome || 'item', 80)}". Disponível: ${estoqueDisp}.` },
            409,
          );
        }
      }
    }

    // Cross-check ±2 centavos (tolerância para arredondamento client-side).
    // NÃO é bloqueante: o servidor SEMPRE cobra serverTotal (recomputado do
    // zero). Divergência só é logada para auditoria de tentativa de fraude.
    const totalCliente = Number(body.total ?? 0);
    if (totalCliente > 0 && Math.abs(totalCliente - serverTotal) > 0.02) {
      console.warn(
        `[processar-pagamento] Divergência: cliente=${totalCliente} servidor=${serverTotal} ` +
        `(baseTotal=${baseTotal}, ajuste=${(ajuste * 100).toFixed(0)}%, frete=${freteNum}, ` +
        `descCupom=${descontoNum}, giftCard=${descontoGiftCard})`,
      );
    }

    // ── Idempotência: evita cobrança dupla em retry/timeout ──
    // Se já existe um pedido (não recusado) com esta chave, devolve a
    // resposta original SEM criar uma nova cobrança no ASAAS.
    // 'recusado' é ignorado de propósito: permite nova tentativa após
    // cartão negado (a mesma chave é reusada pelo checkout.js).
    if (idemKey) {
      const { data: existente } = await supabase
        .from('pedidos')
        .select('id, asaas_payment_id, payment_status, pix_qr_code, pix_qr_base64, pix_expires_at')
        .eq('idempotency_key', idemKey)
        .neq('status', 'recusado')
        .order('criado_em', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existente?.id) {
        console.log('[processar-pagamento] Idempotência: pedido já existente, sem nova cobrança.', existente.id);
        const respIdem: Record<string, unknown> = {
          pedido_id:  existente.id,
          payment_id: existente.asaas_payment_id,
          status:     existente.payment_status,
          duplicado:  true,
        };
        if (tipo === 'pix') {
          respIdem.qr_code_base64 = existente.pix_qr_base64;
          respIdem.qr_code        = existente.pix_qr_code;
          respIdem.expires_at     = existente.pix_expires_at;
        } else {
          const aprovado = ['CONFIRMED', 'RECEIVED'].includes(existente.payment_status || '');
          respIdem.mensagem = aprovado
            ? 'Pagamento aprovado! 🎉'
            : 'Pagamento em análise. Confirmaremos por e-mail em breve.';
        }
        return json(respIdem, 200);
      }
    }

    // ── Cria / recupera cliente no ASAAS ────────────────────
    let asaasCustomerId: string;
    try {
      asaasCustomerId = await upsertAsaasCustomer({
        nome:     cliente.nome || 'Cliente',
        email:    cliente.email,
        cpf:      cliente.cpf,
        telefone: cliente.telefone,
        supabase,
        userId:   confirmedUserId,
      });
    } catch (custErr) {
      console.error('[ASAAS Cliente]', custErr);
      return json({ erro: 'Erro ao registrar cliente no gateway. Tente novamente.' }, 502);
    }

    // ── Monta cobrança ASAAS ─────────────────────────────────
    // Vencimento: hoje + 1 dia (PIX) ou hoje + 7 dias (cartão/débito)
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + (tipo === 'pix' ? 1 : 7));
    const dueDateStr = dueDate.toISOString().slice(0, 10); // YYYY-MM-DD

    const externalRef = crypto.randomUUID();

    const chargeBody: Record<string, unknown> = {
      customer:          asaasCustomerId,
      billingType:       tipo === 'pix' ? 'PIX' : tipo === 'debito' ? 'DEBIT_CARD' : 'CREDIT_CARD',
      value:             serverTotal,
      dueDate:           dueDateStr,
      description:       `Pedido Virtù — ${(itens as any[])?.length ?? 0} item(s)`,
      externalReference: externalRef,
    };

    // Crédito parcelado: informa o TOTAL e o nº de parcelas; o ASAAS divide
    // e ajusta a última parcela para bater exatamente com serverTotal.
    // (usa totalValue em vez de value+installmentValue para evitar sobra.)
    if (tipo === 'cartao' && parcelasNum > 1) {
      delete chargeBody.value;
      chargeBody.installmentCount = parcelasNum;
      chargeBody.totalValue       = serverTotal;
    }

    // Dados de cartão (ASAAS cuida da tokenização PCI v3)
    if (tipo === 'cartao' || tipo === 'debito') {
      if (!card_number || !card_holder_name || !card_expiry_month || !card_expiry_year || !card_cvv) {
        return json({ erro: 'Dados do cartão incompletos.' }, 400);
      }
      chargeBody.creditCard = {
        holderName:  sanitize(card_holder_name, 60),
        number:      String(card_number).replace(/\D/g, ''),
        expiryMonth: String(card_expiry_month).padStart(2, '0'),
        expiryYear:  String(card_expiry_year),
        ccv:         String(card_cvv).replace(/\D/g, ''),
      };
      chargeBody.creditCardHolderInfo = {
        name:      sanitize(cliente.nome, 120),
        email:     cliente.email,
        cpfCnpj:   cliente.cpf.replace(/\D/g, ''),
        phone:     cliente.telefone ? cliente.telefone.replace(/\D/g, '') : undefined,
        postalCode: endereco?.cep ? String(endereco.cep).replace(/\D/g, '') : undefined,
        addressNumber: endereco?.numero ? String(endereco.numero) : undefined,
      };
      // (installmentCount/totalValue já definidos acima para crédito parcelado)
      chargeBody.remoteIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '0.0.0.0';
    }

    // ── Chama ASAAS: cria cobrança ───────────────────────────
    const chargeRes = await fetch(`${asaasBase()}/payments`, {
      method:  'POST',
      headers: asaasHeaders(),
      body:    JSON.stringify(chargeBody),
    });

    const chargeData = await chargeRes.json();

    if (!chargeRes.ok) {
      console.error('[ASAAS Cobrança]', JSON.stringify({ errors: chargeData.errors, status: chargeRes.status }));

      // Traduz erros comuns do ASAAS para português
      const errDesc = chargeData.errors?.[0]?.description || chargeData.error || '';
      const errMap: Record<string, string> = {
        'invalid_creditCard':              'Dados do cartão inválidos.',
        'creditCard_expiredDate':          'Cartão expirado.',
        'creditCard_number_invalid':       'Número do cartão inválido.',
        'creditCard_cvv_invalid':          'CVV inválido.',
        'creditCard_holderName_invalid':   'Nome no cartão inválido.',
        'creditCard_insufficientFunds':    'Saldo insuficiente.',
        'creditCard_card_disabled':        'Cartão bloqueado. Entre em contato com seu banco.',
        'creditCard_declined':             'Pagamento recusado pelo banco emissor.',
        'creditCard_duplicatePayment':     'Pagamento duplicado detectado.',
      };

      const errPt = errMap[chargeData.errors?.[0]?.code || '']
        || (errDesc.length < 200 ? errDesc : null)
        || 'Erro no gateway de pagamento.';

      return json({ erro: errPt }, 502);
    }

    const asaasPaymentId: string = chargeData.id;

    // ── Para PIX: busca QR Code ──────────────────────────────
    let pixQrCodeBase64: string | null = null;
    let pixPayload:      string | null = null;
    let pixExpiresAt:    string | null = null;

    if (tipo === 'pix') {
      try {
        const qrRes = await fetch(
          `${asaasBase()}/payments/${asaasPaymentId}/pixQrCode`,
          { headers: asaasHeaders() },
        );
        if (qrRes.ok) {
          const qrData = await qrRes.json();
          pixQrCodeBase64 = qrData.encodedImage   || null;
          pixPayload      = qrData.payload         || null;
          pixExpiresAt    = qrData.expirationDate  || null;
        }
      } catch (qrErr) {
        console.error('[ASAAS QR]', qrErr);
        // Prossegue sem QR — pedido salvo normalmente
      }
    }

    // ── Determina status do pedido ───────────────────────────
    // ASAAS statuses: PENDING, CONFIRMED, RECEIVED, OVERDUE, REFUNDED, DECLINED
    const asaasStatus  = chargeData.status || '';
    const statusPedido =
      ['CONFIRMED', 'RECEIVED'].includes(asaasStatus) ? 'pago'     :
      ['DECLINED',  'REFUND_REQUESTED', 'REFUNDED'].includes(asaasStatus) ? 'recusado' :
      'pendente';

    // ── Salva pedido no Supabase ─────────────────────────────
    const { data: pedido, error: dbError } = await supabase
      .from('pedidos')
      .insert({
        status:             statusPedido,
        payment_id:         asaasPaymentId,
        asaas_payment_id:   asaasPaymentId,
        payment_method:     tipo,
        payment_status:     asaasStatus,
        subtotal:           serverSubtotal,
        frete:              freteNum,
        desconto:           descontoNum + descontoGiftCard,
        total:              serverTotal,
        gift_card_aplicado: giftCardAplicado,
        user_id:            confirmedUserId || null,
        cep:                endereco?.cep,
        rua:                endereco?.rua,
        numero:             endereco?.numero,
        complemento:        endereco?.complemento,
        bairro:             endereco?.bairro,
        cidade:             endereco?.cidade,
        estado:             endereco?.estado,
        cliente_nome:       cliente.nome    || 'Cliente',
        cliente_email:      cliente.email,
        cliente_telefone:   cliente.telefone || null,
        nome_cliente:       cliente.nome,
        email_cliente:      cliente.email,
        cpf_cliente:        cliente.cpf,
        telefone:           cliente.telefone,
        itens:              itens ?? [],
        cupom_codigo:       cupom_codigo ? String(cupom_codigo).trim().toUpperCase().slice(0, 50) : null,
        parcelas:           tipo === 'cartao' ? parcelasNum : null,
        pix_qr_code:        pixPayload      || null,
        pix_qr_base64:      pixQrCodeBase64 || null,
        pix_expires_at:     pixExpiresAt    || null,
        idempotency_key:    idemKey,
      })
      .select('id')
      .single();

    if (dbError) throw new Error('[DB Insert] ' + dbError.message);

    // Nota: o uso do cupom (cupom_usos_cliente + cupons.usos) é registrado
    // automaticamente pelo trigger trg_registrar_uso_cupom em `pedidos`
    // quando o pedido fica pago — não registrar aqui (evita contagem dupla).

    // ── Estoque ──────────────────────────────────────────────────
    // Delegado ao trigger trg_pedido_pago_baixa_estoque (AFTER INSERT OR UPDATE).
    // O trigger agora cobre INSERT (cartão imediato) e UPDATE (PIX via webhook).
    // NÃO chamar comprar_variacao aqui para evitar duplo débito.
    console.log('[processar-pagamento] Estoque: delegado ao trigger DB (trg_pedido_pago_baixa_estoque)');

    // ── Gift Card: contagem de compras válidas é DERIVADA de `pedidos` ──
    // (gift_card_status conta pedidos pagos distintos por dia). Não há
    // contador a incrementar aqui — o antigo registrar_compra_fidelidade
    // (prêmio a cada 10 compras) foi aposentado. O consumo do gift card é
    // marcado por `gift_card_aplicado` no próprio pedido (revertido sozinho
    // se o pedido for cancelado/estornado).

    // ── Notificações por e-mail (Resend via send-order-email) ──
    try {
      const SB_URL   = Deno.env.get('SUPABASE_URL');
      const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
      if (SB_URL && ANON_KEY && pedido?.id) {
        fetch(`${SB_URL}/functions/v1/send-order-email`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
          body: JSON.stringify({
            pedido_id:        pedido.id,
            cliente,
            endereco,
            itens,
            total:            serverTotal,
            subtotal:         serverSubtotal,
            frete:            freteNum,
            desconto:         descontoNum + descontoGiftCard,
            metodo_pagamento: tipo,
            parcelas,
            status:           statusPedido,
          }),
        }).catch(e => console.error('[Email dispatch]', e));
      }
    } catch (emailErr) {
      console.error('[Email Error]', emailErr);
    }

    // ── Resposta ao frontend ─────────────────────────────────
    const resposta: Record<string, unknown> = {
      pedido_id:  pedido?.id ?? null,
      payment_id: asaasPaymentId,
      status:     asaasStatus,
    };

    if (tipo === 'pix') {
      resposta.qr_code_base64 = pixQrCodeBase64;
      resposta.qr_code        = pixPayload;
      resposta.expires_at     = pixExpiresAt;
    }

    if (tipo === 'cartao' || tipo === 'debito') {
      const aprovado = ['CONFIRMED', 'RECEIVED'].includes(asaasStatus);
      resposta.mensagem = aprovado
        ? 'Pagamento aprovado! 🎉'
        : asaasStatus === 'DECLINED'
          ? 'Pagamento recusado. Verifique os dados do cartão e tente novamente.'
          : 'Pagamento em análise. Confirmaremos por e-mail em breve.';
    }

    return json(resposta, 200);

  } catch (err) {
    console.error('[Unexpected]', err);
    return json({ erro: 'Erro interno. Tente novamente.' }, 500);
  }
});
