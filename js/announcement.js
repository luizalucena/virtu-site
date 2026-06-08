/* ============================================================
   VIRTÙ — Barra de anúncios dinâmica
   ============================================================
   Carrega os textos da barra de anúncios a partir do Supabase.
   Se nenhum texto estiver configurado, mantém o conteúdo
   estático do HTML como fallback.

   Depende de: supabase CDN + js/supabase-config.js
   ============================================================ */

// Escapa caracteres HTML para prevenir XSS
function _escAnuncio(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

(async () => {
  if (typeof supabaseClient === 'undefined') return;

  try {
    const { data: cfg } = await supabaseClient
      .from('configuracoes')
      .select('anuncio_bar')
      .eq('id', 1)
      .maybeSingle();

    const items = cfg?.anuncio_bar;
    if (!Array.isArray(items) || items.length === 0) return;

    const track = document.querySelector('.announcement-bar__track');
    if (!track) return;

    // Duplica os itens para criar o efeito de loop contínuo
    const all = [...items, ...items];
    track.innerHTML = all
      .map(txt => `<span class="announcement-bar__item"><span class="sep">✦</span> ${_escAnuncio(txt)}</span>`)
      .join('');

  } catch {
    // Em caso de erro, mantém o HTML estático como fallback
  }
})();
