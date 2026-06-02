/**
 * cart-badge.js
 * Lê o carrinho do localStorage e atualiza o badge da navbar em todas as páginas.
 * Deve ser incluído em todos os HTMLs com o elemento #cartBadge.
 */
(function () {
  const CART_KEY = 'virtu_cart';

  function getCartCount() {
    try {
      const cart = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      return cart.reduce((sum, item) => sum + (item.qty || item.quantidade || 1), 0);
    } catch {
      return 0;
    }
  }

  function updateCartBadge() {
    const badge = document.getElementById('cartBadge');
    if (!badge) return;
    const count = getCartCount();
    badge.textContent = count;
    if (count > 0) {
      badge.removeAttribute('hidden');
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
    // Atualiza aria-label do link do carrinho para acessibilidade
    const cartLink = badge.closest('a[href*="carrinho"]');
    if (cartLink) cartLink.setAttribute('aria-label', `Carrinho (${count} ${count === 1 ? 'item' : 'itens'})`);
  }

  // Atualiza ao carregar a página
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateCartBadge);
  } else {
    updateCartBadge();
  }

  // Atualiza quando outra aba altera o carrinho
  window.addEventListener('storage', function (e) {
    if (e.key === CART_KEY) updateCartBadge();
  });

  // Expõe globalmente para que stock.js / main.js possam chamar após adicionar
  window.updateCartBadge = updateCartBadge;
})();
