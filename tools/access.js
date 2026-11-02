'use strict';
// Owner-only panel for choosing who can use the tools. Shown only when the signed-in account is the owner.
(() => {
  const $ = id => document.getElementById(id);
  const API_URL = 'https://mshadkhah-tools.mshadkhah.workers.dev';
  const session = sessionStorage.getItem('tools-session');
  if (!session) return;

  const authHeaders = () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + (sessionStorage.getItem('tools-session') || '') });

  function say(message, isError) {
    const line = $('access-status');
    line.hidden = !message;
    line.textContent = message || '';
    line.style.color = isError ? '#b03a2e' : '';
  }

  function render(users) {
    const list = $('access-list');
    list.replaceChildren();
    if (!users.length) {
      const empty = document.createElement('li');
      empty.className = 'muted';
      empty.textContent = 'No one else has access yet.';
      list.appendChild(empty);
      return;
    }
    for (const name of users) {
      const item = document.createElement('li');
      item.className = 'access-item';
      const label = document.createElement('span');
      label.textContent = name;
      const remove = document.createElement('button');
      remove.className = 'reader-link';
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', 'Remove ' + name);
      remove.addEventListener('click', () => change({ remove: name }, 'Removed ' + name + '.'));
      item.append(label, ' ', remove);
      list.appendChild(item);
    }
  }

  async function change(body, doneMessage) {
    say('Saving…');
    try {
      const response = await fetch(API_URL + '/admin/users', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { say(data.error || 'Could not save the change.', true); return; }
      render(data.users);
      say(doneMessage);
    } catch (error) {
      say('Could not reach the tools service. Try again.', true);
    }
  }

  async function load() {
    try {
      const response = await fetch(API_URL + '/admin/users', { headers: authHeaders() });
      if (!response.ok) return;
      render((await response.json()).users);
    } catch (error) {
      say('Could not load the list of people.', true);
    }
  }

  async function init() {
    try {
      const response = await fetch(API_URL + '/auth/me', { headers: authHeaders() });
      if (!response.ok) return;
      const me = await response.json();
      if (!me.owner) return;
    } catch (error) {
      return;
    }
    $('access-panel').hidden = false;
    $('access-form').addEventListener('submit', event => {
      event.preventDefault();
      const name = $('access-input').value.trim();
      if (!name) return;
      $('access-input').value = '';
      change({ add: name }, 'Added ' + name + '.');
    });
    load();
  }
  init();
})();
