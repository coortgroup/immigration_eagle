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

// Discovery uses the same status/goal data as the app. Preparation checks run there.
const statusSelect = document.querySelector('#finder-status');
const goalSelect = document.querySelector('#finder-goal');
const results = document.querySelector('#finder-results');
const resetFinder = document.querySelector('#finder-reset');
const finderSubmit = document.querySelector('#finder-submit');
const finderControls = document.querySelector('#form-finder-controls');
const finderData = document.querySelector('#finder-data');
if (statusSelect && goalSelect && results && resetFinder && finderSubmit && finderControls && finderData) {
  try {
    const { statuses } = JSON.parse(finderData.textContent);
    const cards = new Map([...document.querySelectorAll('[data-catalog-form]')].map(card => [card.dataset.catalogForm, card]));
    const placeholder = text => new Option(text, '');
    const selectedStatus = () => statuses.find(status => status.id === statusSelect.value);

    function resetGoals() {
      const status = selectedStatus();
      goalSelect.replaceChildren(placeholder(status ? 'Choose what you want to do' : 'Choose your status first'));
      (status?.goals || []).forEach(goal => goalSelect.add(new Option(goal.label, goal.id)));
      localizeTree(goalSelect);
      goalSelect.disabled = !status;
      finderSubmit.disabled = !status;
      resetFinder.hidden = !status;
      results.replaceChildren();
    }

    statusSelect.disabled = false;
    statusSelect.addEventListener('change', resetGoals);
    const showMatches = () => {
      results.replaceChildren();
      const goal = selectedStatus()?.goals.find(item => item.id === goalSelect.value);
      if (!goal) return;
      const label = document.createElement('p');
      label.className = 'finder-match-label';
      setText(label, goal.forms.length === 1 ? 'Your form match' : 'Forms to explore');
      results.append(label);
      goal.forms.forEach(id => {
        const original = cards.get(id);
        if (!original) return;
        const match = cloneLocalized(original);
        match.removeAttribute('data-catalog-form');
        results.append(match);
      });
    };
    goalSelect.addEventListener('change', showMatches);
    finderControls.addEventListener('submit', event => {
      event.preventDefault();
      if (!finderControls.reportValidity()) return;
      showMatches();
      results.focus({ preventScroll: true });
      results.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' });
    });
    resetFinder.addEventListener('click', () => {
      statusSelect.value = '';
      resetGoals();
      statusSelect.focus();
    });
    // Do not retain a browser-restored goal after a status change or reload.
    resetGoals();
    window.addEventListener('fillout-language-change', () => {
      const goal = goalSelect.value;
      resetGoals();
      goalSelect.value = goal;
      showMatches();
    });
  } catch {
    setText(results, 'The finder is unavailable. Browse all forms below to choose your next step.');
  }
}
import { cloneLocalized, localizeTree, setText } from './i18n.js';
