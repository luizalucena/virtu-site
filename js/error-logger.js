/* ============================================================
   VIRTÙ — Error Logger (Pilar 3 — Monitoramento de Erros)
   Captura window.onerror + unhandledrejection silenciosamente
   e persiste em Supabase (tabela logs_erros) via REST anon.
   Não exibe nada ao utilizador. Não usa console em produção.
   ============================================================ */
(function () {
  'use strict';

  // ── Configuração ───────────────────────────────────────────
  var SUPA_URL  = 'https://oxivtnuxnghpddwawfdr.supabase.co';
  var SUPA_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94aXZ0bnV4bmdocGRkd2F3ZmRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDkxNzgxMzMsImV4cCI6MjA2NDc1NDEzM30.5hFVFhvJoHgMdZJK0etqbDFvnBY9OVlOmVDWHMdxahY';

  // Throttle: máximo 5 erros por sessão para não flooding
  var _erroCount = 0;
  var MAX_ERROS  = 5;

  // ── Função de envio ────────────────────────────────────────
  function enviarErro(payload) {
    if (_erroCount >= MAX_ERROS) return;
    _erroCount++;

    // Tenta obter user_id do Supabase Auth (se disponível)
    try {
      var sb = window.supabase && window.supabase.createClient
        ? null // já instanciado pelo app
        : null;
      // Lê diretamente do localStorage do SDK v2
      var authKey = Object.keys(localStorage || {})
        .find(function (k) { return k.startsWith('sb-') && k.endsWith('-auth-token'); });
      if (authKey) {
        var session = JSON.parse(localStorage.getItem(authKey) || '{}');
        payload.user_id = session?.user?.id || null;
      }
    } catch (_) { /* silencioso */ }

    fetch(SUPA_URL + '/rest/v1/logs_erros', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        SUPA_ANON,
        'Authorization': 'Bearer ' + SUPA_ANON,
        'Prefer':        'return=minimal',
      },
      body: JSON.stringify(payload),
      keepalive: true, // garante envio mesmo ao fechar a aba
    }).catch(function () { /* silencioso — nunca propagar */ });
  }

  // ── window.onerror (erros JS síncronos) ────────────────────
  var _prevOnerror = window.onerror;
  window.onerror = function (mensagem, origem, linha, coluna, erro) {
    // Ignora erros de extensões de browser e scripts terceiros óbvios
    if (origem && (
      origem.indexOf('chrome-extension') !== -1 ||
      origem.indexOf('moz-extension')    !== -1 ||
      origem.indexOf('safari-extension') !== -1
    )) {
      return false;
    }

    enviarErro({
      tipo:       'js_error',
      mensagem:   String(mensagem).slice(0, 500),
      stack:      erro && erro.stack ? String(erro.stack).slice(0, 2000) : null,
      pagina:     window.location.pathname + window.location.search,
      linha:      linha   || null,
      coluna:     coluna  || null,
      user_agent: navigator.userAgent ? navigator.userAgent.slice(0, 300) : null,
    });

    // Chama handler anterior se existia
    if (typeof _prevOnerror === 'function') {
      return _prevOnerror.apply(this, arguments);
    }
    return false; // não suprime o erro no console do dev
  };

  // ── unhandledrejection (Promises rejeitadas) ───────────────
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    var mensagem = reason instanceof Error
      ? reason.message
      : (typeof reason === 'string' ? reason : JSON.stringify(reason));
    var stack = reason instanceof Error ? reason.stack : null;

    // Ignora erros de rede offline comuns (não acionáveis)
    if (mensagem && (
      mensagem.indexOf('Failed to fetch') !== -1 ||
      mensagem.indexOf('NetworkError')    !== -1 ||
      mensagem.indexOf('Load failed')     !== -1
    )) return;

    enviarErro({
      tipo:       'promise_rejection',
      mensagem:   String(mensagem || '').slice(0, 500),
      stack:      stack ? String(stack).slice(0, 2000) : null,
      pagina:     window.location.pathname + window.location.search,
      linha:      null,
      coluna:     null,
      user_agent: navigator.userAgent ? navigator.userAgent.slice(0, 300) : null,
    });
  });

})();
