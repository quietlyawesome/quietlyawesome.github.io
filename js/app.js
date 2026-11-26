import { createVault, newEntry, localStamp } from './vault.js';
import { openStore } from './store.js';
import * as passkeys from './passkey.js';

const $ = (id) => document.getElementById(id);
const SCREENS = ['setup', 'recovery', 'locked', 'main'];

let vault = null;
let session = null;
let pending = null;

function show(name) {
  for (const s of SCREENS) $(s).hidden = s !== name;
}

function say(message, bad = false) {
  $('status').textContent = message || '';
  $('status').className = bad ? 'status bad' : 'status';
}

function readable(e) {
  if (e && e.name === 'NotAllowedError') return 'Face ID was cancelled or timed out.';
  return (e && e.message) || String(e);
}

async function busy(button, fn) {
  button.disabled = true;
  say('');
  try {
    await fn();
  } catch (e) {
    say(readable(e), true);
  } finally {
    button.disabled = false;
  }
}

function onSubmit(formId, buttonId, fn) {
  $(formId).addEventListener('submit', (ev) => {
    ev.preventDefault();
    busy($(buttonId), fn);
  });
}

function onClick(id, fn) {
  $(id).addEventListener('click', () => busy($(id), fn));
}

function renderPhrase(p) {
  const list = $('phrase');
  list.replaceChildren(...p.phrase.split('-').map((g) => Object.assign(document.createElement('li'), { textContent: g })));
  $('check-a-label').textContent = `Type group ${p.checkGroups[0]}`;
  $('check-b-label').textContent = `Type group ${p.checkGroups[1]}`;
  $('check-a').value = '';
  $('check-b').value = '';
}

function renderEntries(items) {
  $('entries').replaceChildren(...items.map((x) => {
    const li = document.createElement('li');
    const meta = document.createElement('div');
    meta.className = 'meta';
    const body = document.createElement('div');
    body.className = 'body';
    if (x.error) {
      meta.textContent = 'Could not decrypt';
      body.textContent = x.error;
    } else {
      const p = x.payload;
      meta.textContent = [p.date, p.mood ? `mood ${p.mood}` : '', ...(p.tags || []).map((t) => '#' + t)].filter(Boolean).join(' · ');
      body.textContent = p.text;
    }
    li.append(meta, body);
    return li;
  }));
}

async function refresh() {
  say('Loading…');
  renderEntries(await session.listEntries());
  say('');
}

async function enter(s) {
  session = s;
  $('today').textContent = `${localStamp().date} · ${session.repoName()}`;
  show('main');
  await refresh();
}

function lock() {
  if (session) session.lock();
  session = null;
  $('entries').replaceChildren();
  $('text').value = '';
  show('locked');
}

onSubmit('setup-form', 'setup-go', async () => {
  say('Checking repository…');
  const conn = await vault.connect($('repo').value, $('token').value);
  if (conn.keyring) {
    say('Found your keyring. Confirm with Face ID.');
    const s = await vault.addThisDevice(conn);
    $('token').value = '';
    await enter(s);
  } else {
    say('New repository. Creating your passkey.');
    pending = await vault.beginFirstDevice(conn);
    $('token').value = '';
    renderPhrase(pending);
    say('');
    show('recovery');
  }
});

onSubmit('recovery-form', 'recovery-go', async () => {
  const s = await pending.finish([$('check-a').value, $('check-b').value]);
  pending = null;
  $('phrase').replaceChildren();
  await enter(s);
});

onSubmit('entry-form', 'save', async () => {
  const text = $('text').value;
  if (!text.trim()) return;
  say('Saving…');
  await session.saveEntry(newEntry({ text, mood: Number($('mood').value) }));
  $('text').value = '';
  await refresh();
  say('Saved.');
});

onClick('unlock', async () => enter(await vault.unlock()));

onClick('lock', async () => lock());

onClick('copy-token', async () => {
  await navigator.clipboard.writeText(session.token());
  say('Token copied. Paste it on your other device within 2 minutes.');
});

onClick('forget', async () => {
  if (!confirm('Remove Odometer from this device? Your entries stay in GitHub.')) return;
  await vault.forget();
  show('setup');
});

$('mood').addEventListener('input', () => {
  $('mood-out').textContent = $('mood').value;
});

async function start() {
  if (!window.PublicKeyCredential || !window.indexedDB || !window.isSecureContext) {
    say('This browser cannot run Odometer (needs passkeys over HTTPS).', true);
    return;
  }
  vault = createVault({ store: await openStore(), passkeys, fetch: window.fetch.bind(window) });
  show((await vault.isSetUp()) ? 'locked' : 'setup');
}

start().catch((e) => say(readable(e), true));
