/* ============================================================
   VIRTÙ — Endereço Salvo (1-click checkout)
   Carrega e salva endereço do usuário logado via Supabase.
   Só age se o toggle endereco_salvo_ativo === true no admin.
   ============================================================ */

(function () {
  'use strict';

  // Aguarda o supabaseClient estar disponível
  async function waitForSupabase(maxMs = 3000) {
    const start = Date.now();
    while (typeof supabaseClient === 'undefined' && Date.now() - start < maxMs) {
      await new Promise(r => setTimeout(r, 100));
    }
    return typeof supabaseClient !== 'undefined' ? supabaseClient : null;
  }

  // ── Pré-preenche os campos do formulário de entrega ──────
  function preencherCampos(end) {
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el && val) { el.value = val; }
    };
    set('cep',          end.cep);
    set('street',       end.rua);
    set('number',       end.numero);
    set('complement',   end.complemento);
    set('neighborhood', end.bairro);
    set('city',         end.cidade);
    const stateEl = document.getElementById('state');
    if (stateEl && end.estado) stateEl.value = end.estado;

    // Exibe banner de aviso
    const banner = document.getElementById('vtEndSalvoBanner');
    if (banner) banner.style.display = 'flex';
  }

  // ── Lê endereço salvo e pré-preenche ────────────────────
  async function carregarEnderecoSalvo() {
    const sb = await waitForSupabase();
    if (!sb) return;

    // Verifica toggle do admin
    const { data: cfg } = await sb
      .from('configuracoes')
      .select('endereco_salvo_ativo')
      .eq('id', 1)
      .maybeSingle();
    if (!cfg?.endereco_salvo_ativo) return;

    // Verifica se usuário está logado
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;

    const { data: end } = await sb
      .from('enderecos_salvos')
      .select('*')
      .eq('user_id', session.user.id)
      .maybeSingle();

    if (!end) return;

    // Só preenche quando a etapa 2 ficar visível
    const step2Content = document.getElementById('step2Content');
    if (!step2Content) return;

    const observer = new MutationObserver(() => {
      if (!step2Content.hasAttribute('hidden')) {
        preencherCampos(end);
        observer.disconnect();

        // Dispara busca de CEP automaticamente
        const lookupBtn = document.getElementById('lookupCep');
        if (lookupBtn && end.cep) {
          setTimeout(() => lookupBtn.click(), 300);
        }
      }
    });
    observer.observe(step2Content, { attributes: true, attributeFilter: ['hidden'] });
  }

  // ── Salva / atualiza endereço após pedido confirmado ─────
  window.vtSalvarEndereco = async function (endereco) {
    const sb = await waitForSupabase();
    if (!sb) return;

    const { data: cfg } = await sb
      .from('configuracoes')
      .select('endereco_salvo_ativo')
      .eq('id', 1)
      .maybeSingle();
    if (!cfg?.endereco_salvo_ativo) return;

    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;

    await sb.from('enderecos_salvos').upsert({
      user_id:     session.user.id,
      cep:         endereco.cep,
      rua:         endereco.rua,
      numero:      endereco.numero,
      complemento: endereco.complemento || '',
      bairro:      endereco.bairro,
      cidade:      endereco.cidade,
      estado:      endereco.estado,
      atualizado_em: new Date().toISOString(),
    }, { onConflict: 'user_id' });
  };

  // Inicia ao carregar a página
  document.addEventListener('DOMContentLoaded', carregarEnderecoSalvo);
})();
