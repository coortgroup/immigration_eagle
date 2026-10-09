const toggle = document.querySelector('.menu-toggle');
const navigation = document.querySelector('#site-navigation');
const narrow = window.matchMedia('(max-width: 720px)');

if (toggle && navigation) {
  document.documentElement.classList.add('enhanced');
  const closeMenu = () => {
    navigation.hidden = narrow.matches;
    toggle.setAttribute('aria-expanded', 'false');
  };
  closeMenu();
  toggle.addEventListener('click', () => {
    const isOpen = toggle.getAttribute('aria-expanded') === 'true';
    navigation.hidden = isOpen;
    toggle.setAttribute('aria-expanded', String(!isOpen));
  });
  navigation.addEventListener('click', event => {
    if (event.target.closest('a') && narrow.matches) closeMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && narrow.matches && !navigation.hidden) {
      closeMenu();
      toggle.focus();
    }
  });
  narrow.addEventListener('change', closeMenu);
}

document.querySelectorAll('[data-year]').forEach(node => {
  node.textContent = String(new Date().getFullYear());
});

function revealFooterSection() {
  const id = window.location.hash.slice(1);
  if (!['privacy', 'support', 'status'].includes(id)) return;
  const section = document.getElementById(id);
  if (section instanceof HTMLDetailsElement) section.open = true;
}
revealFooterSection();
window.addEventListener('hashchange', revealFooterSection);
