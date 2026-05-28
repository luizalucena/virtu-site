/* ============================================================
   VIRTÙ — Navbar Categories Dropdown (all pages)
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  const catsToggle   = document.getElementById('catsToggle');
  const catsDropdown = document.getElementById('catsDropdown');
  if (!catsToggle || !catsDropdown) return;

  function openCats() {
    catsDropdown.classList.add('open');
    catsToggle.setAttribute('aria-expanded', 'true');
  }
  function closeCats() {
    catsDropdown.classList.remove('open');
    catsToggle.setAttribute('aria-expanded', 'false');
  }

  catsToggle.addEventListener('click', e => {
    e.stopPropagation();
    catsDropdown.classList.contains('open') ? closeCats() : openCats();
  });

  document.addEventListener('click', e => {
    if (!catsToggle.contains(e.target) && !catsDropdown.contains(e.target)) {
      closeCats();
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeCats();
  });
});
