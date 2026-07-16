/* ============================================================
   VIRTÙ — recovery-catcher.js
   ------------------------------------------------------------
   Garante que o link de REDEFINIÇÃO DE SENHA do Supabase sempre
   abra a tela de "Definir nova senha" em /conta.html, mesmo que
   a configuração de redirect do projeto leve o cliente para outra
   página (ex.: a home / Site URL).

   Deve ser o PRIMEIRO script do <head> de TODAS as páginas — roda
   antes do supabase-config.js, que (com detectSessionInUrl) consome
   e limpa o token da URL. Puro JS, sem dependências.

   O que detecta na URL:
     • implícito:  #...&type=recovery
     • query:      ?type=recovery
     • erro:       #error=...&error_code=otp_expired (link expirado)
     • PKCE:       ?code=... (troca de código; a conta decide a ação)
   ============================================================ */
(function () {
  try {
    var hash   = window.location.hash   || '';
    var search = window.location.search || '';
    var hp     = hash.replace(/^#/, '');

    var isRecovery =
      /(^|&)type=recovery(&|$)/.test(hp) ||
      /(^|[?&])type=recovery(&|$)/.test(search);

    // Erro de token de recuperação (ex.: link expirado/otp) → também abrir a
    // tela em /conta.html para permitir reenviar.
    var isRecoveryError =
      (/(^|&)error/.test(hp)     && /(recovery|otp|access_denied)/i.test(hp)) ||
      (/(^|[?&])error/.test(search) && /(recovery|otp|access_denied)/i.test(search));

    // PKCE: um ?code= isolado (recuperação OU confirmação). A conta processa
    // e o evento do Supabase (PASSWORD_RECOVERY vs SIGNED_IN) decide a ação —
    // aqui só garantimos que ele chegue à /conta.html.
    var hasCode = /(^|[?&])code=/.test(search);

    if (!isRecovery && !isRecoveryError && !hasCode) return;

    var naConta = /\/conta\.html$/i.test(window.location.pathname);

    // Marca o fluxo de recuperação (não para ?code puro, que pode ser
    // confirmação de cadastro — nesse caso quem decide é o evento).
    if (isRecovery || isRecoveryError) {
      try { sessionStorage.setItem('vt_recovery', '1'); } catch (e) {}
    }

    if (naConta) return; // já está na página certa

    // Redireciona preservando o token (query + hash).
    var dest = window.location.origin + '/conta.html' + search + hash;
    window.location.replace(dest);
  } catch (e) { /* silencioso — nunca deve quebrar a navegação */ }
})();
