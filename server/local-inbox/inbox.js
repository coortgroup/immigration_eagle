const list = document.querySelector('#requests');
const status = document.querySelector('#status');
const refresh = document.querySelector('#refresh');

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function details(label, value) {
  const row = element('div', undefined, 'detail');
  row.append(element('dt', label), element('dd', value));
  return row;
}

function requestCard(request) {
  const card = element('article', undefined, 'request');
  const heading = element('div', undefined, 'request-heading');
  heading.append(element('span', request.type === 'attorney' ? 'Attorney request' : 'Contact request', 'badge'));
  if (request.formId) heading.append(element('span', request.formId, 'form-id'));
  const date = new Date(request.createdAt);
  const time = element('time', Number.isNaN(date.valueOf()) ? 'Date unavailable' : date.toLocaleString());
  if (!Number.isNaN(date.valueOf())) time.dateTime = date.toISOString();
  heading.append(time);
  const contacts = element('dl');
  contacts.append(details('Name', request.name));
  if (request.email) contacts.append(details('Email', request.email));
  if (request.phone) contacts.append(details('Phone', request.phone));
  card.append(heading, contacts, element('h2', 'Question'), element('p', request.question, 'question'), element('p', `Saved in local inbox · ${request.id}`, 'receipt'));
  return card;
}

async function load() {
  refresh.disabled = true;
  status.textContent = 'Loading requests…';
  try {
    const response = await fetch('/api/requests', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) throw new Error('Inbox unavailable');
    const data = await response.json();
    if (data.local !== true || !Array.isArray(data.requests)) throw new Error('Unexpected response');
    list.replaceChildren(...data.requests.map(requestCard));
    status.textContent = data.requests.length ? `${data.requests.length} request${data.requests.length === 1 ? '' : 's'} saved on this computer.` : 'No requests yet. Submit a contact or attorney request through the local app to see it here.';
  } catch {
    list.replaceChildren();
    status.textContent = 'Could not load the local inbox. Check that the local server is running, then refresh.';
  } finally { refresh.disabled = false; }
}

refresh.addEventListener('click', load);
load();
