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
  if (!['privacy', 'support', 'status', 'guarantee'].includes(id)) return;
  const section = document.getElementById(id);
  if (section instanceof HTMLDetailsElement) section.open = true;
}
revealFooterSection();
window.addEventListener('hashchange', revealFooterSection);

async function updateLocalServiceStatus() {
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
  if (!loopbackHosts.has(window.location.hostname)) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(new URL('/api/status', window.location.origin), {
      signal: controller.signal, cache: 'no-store',
    });
    if (!response.ok) return;
    const status = await response.json();
    if (status.local !== true || status.contactDelivery !== 'local-inbox') return;

    const copy = {
      '[data-status-label]': 'Local testing',
      '[data-status-copy]': 'Contact and attorney requests can be saved to the local team inbox for testing. FILLOUT AI responses are scripted. Live AI, full PDF generation, payments, and government filing are not connected. A preliminary form check does not confirm every filing requirement.',
      '[data-privacy-delivery]': 'Submitted contact and attorney requests are stored in the local team inbox on this computer for testing. They are not sent to an outside legal team, AI service, or government agency.',
      '[data-support-label]': 'Local team inbox',
      '[data-support-copy]': 'Use the app’s contact or attorney request form to send a test request to the local team inbox. You can open that inbox below to review it. This local test does not book an attorney or promise a reply.',
      '[data-attorney-status]': 'Local test · Requests saved locally',
    };
    for (const [selector, value] of Object.entries(copy)) {
      const element = document.querySelector(selector);
      if (element) element.textContent = value;
    }
    const inbox = document.querySelector('[data-local-inbox]');
    if (inbox) {
      inbox.href = new URL('/local-inbox/', window.location.origin).href;
      inbox.hidden = false;
    }
  } catch {
    // Static and unavailable local servers keep the preview-only defaults.
  } finally {
    clearTimeout(timeout);
  }
}
updateLocalServiceStatus();

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
      label.textContent = goal.forms.length === 1 ? 'Your form match' : 'Forms to explore';
      results.append(label);
      goal.forms.forEach(id => {
        const original = cards.get(id);
        if (!original) return;
        const match = original.cloneNode(true);
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
  } catch {
    results.textContent = 'The finder is unavailable. Browse all forms below to choose your next step.';
  }
}
