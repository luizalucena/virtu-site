/* ============================================================
   VIRTÙ — Auth Badge
   Mostra o ponto dourado no ícone de usuário quando logado.
   Incluir em todas as páginas após supabase-config.js.
   ============================================================ */

(async function () {
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const dot = document.getElementById('authDot');
    if (dot && session) {
      dot.classList.add('navbar__account-dot--visible');
    }
    // Atualiza em tempo real (ex: logout em outra aba)
    supabaseClient.auth.onAuthStateChange((_event, s) => {
      if (dot) {
        dot.classList.toggle('navbar__account-dot--visible', !!s);
      }
    });
  } catch (_) {
    // Supabase não disponível — ignora silenciosamente
  }
})();
