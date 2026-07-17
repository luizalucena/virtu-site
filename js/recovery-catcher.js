/* ============================================================
   VIRTÙ — recovery-catcher.js
   ------------------------------------------------------------
   Garante que os links de AUTENTICAÇÃO por e-mail do Supabase
   (redefinição de senha E confirmação de cadastro) sempre abram
   em /conta.html — com a tela/mensagem certa — mesmo que a
   configuração de redirect do projeto leve o cliente para outra
   página (ex.: a home / Site URL).

   Deve ser o PRIMEIRO script do <head> de TODAS as páginas — roda
   antes do supabase-config.js, que (com detectSessionInUrl) consome
   e limpa o token da URL. Puro JS, sem dependências.

   O que detecta na URL:
     • recuperação: #type=recovery / ?type=recovery
     • cadastro:    #type=signup   / ?type=signup   (confirmação de e-mail)
     • erro:        #error=...&error_code=otp_expired (link expirado)
     • PKCE:        ?code=... (troca de código; a conta decide a ação)
   ============================================================ */
(function () {
  try {
    var hash   = window.location.hash   || '';
    var search = window.location.search || '';
    var hp     = hash.replace(/^#/, '');

    var isRecovery =
      /(^|&)type=recovery(&|$)/.test(hp) ||
      /(^|[?&])type=recovery(&|$)/.test(search);

    // Confirmação de cadastro (o link cai no Site URL/home se o redirect
    // pedido não estiver na allowlist) → encaminha p/ conta.html, onde o
    // conta.js mostra "E-mail confirmado!" e já entra logada.
    var isSignup =
      /(^|&)type=signup(&|$)/.test(hp) ||
      /(^|[?&])type=signup(&|$)/.test(search);

    // Erro de token de recuperação (ex.: link expirado/otp) → também abrir a
    // tela em /conta.html para permitir reenviar.
    var isRecoveryError =
      (/(^|&)error/.test(hp)     && /(recovery|otp|access_denied)/i.test(hp)) ||
      (/(^|[?&])error/.test(search) && /(recovery|otp|access_denied)/i.test(search));

    // PKCE: um ?code= isolado (recuperação OU confirmação). A conta processa
    // e o evento do Supabase (PASSWORD_RECOVERY vs SIGNED_IN) decide a ação —
    // aqui só garantimos que ele chegue à /conta.html.
    var hasCode = /(^|[?&])code=/.test(search);

    if (!isRecovery && !isSignup && !isRecoveryError && !hasCode) return;

    var naConta = /\/conta\.html$/i.test(window.location.pathname);

    // Marca o fluxo de recuperação (não para signup/?code, que não abrem a
    // tela de nova senha — quem decide é o tipo/evento na conta.js).
    if (isRecovery || isRecoveryError) {
      try { sessionStorage.setItem('vt_recovery', '1'); } catch (e) {}
    }

    if (naConta) return; // já está na página certa

    // Redireciona preservando o token (query + hash).
    var dest = window.location.origin + '/conta.html' + search + hash;

    // IMPORTANTE (corrida de token single-use): limpa o token da URL da página
    // ATUAL antes de qualquer outro script (supabase-config/detectSessionInUrl)
    // rodar aqui e "gastar" o token. Assim ele chega intacto e é processado
    // uma única vez em /conta.html. O `dest` já capturou o token acima.
    try { window.history.replaceState(null, '', window.location.pathname); } catch (e) {}

    window.location.replace(dest);
  } catch (e) { /* silencioso — nunca deve quebrar a navegação */ }
})();
