import { createVault } from './vault.js';
import { openStore } from './store.js';
import * as passkeys from './passkey.js';
import { idleLock } from './idle.js';
import { createShell } from './ui/shell.js';
import { unlockScreen, setupScreen, recoveryScreen } from './ui/gate.js';
import { writeView } from './ui/write.js';
import { timelineView } from './ui/timeline.js';
import { pastView, memoryView } from './ui/past.js';
import { weeklyView } from './ui/weekly.js';
import { itemView } from './ui/item.js';
import { settingsView } from './ui/settings.js';
import { statsView } from './ui/stats.js';
import { exportView } from './ui/export.js';
import { applyDailyFavicon } from './ui/marks.js';

const VIEWS = { write: writeView, timeline: timelineView, past: pastView, memory: memoryView, weekly: weeklyView, item: itemView, settings: settingsView, stats: statsView, export: exportView };
const FORMS = new Set(['write', 'memory']);
const IDLE_MS = 5 * 60 * 1000;
const REFRESH_MS = 60 * 1000;

let vault = null;
let store = null;
let shell = null;
let pending = null;
let idle = null;
let lastSync = 0;
const draftTimers = new Map();
const media = matchMedia('(prefers-color-scheme: light)');

const ctx = {
  session: null,
  items: [],
  drafts: {},
  ui: {},
  sync: 'synced',
  themePref: 'system',
  go(name) {
    if (location.hash === `#/${name}`) render();
    else location.hash = `#/${name}`;
  },
  render: (opts) => render(opts),
  toast: (message, bad) => shell.say(message, bad),
  readable,
  lock: (message) => lock(message),
  forget: () => forget(),
  setTheme: (pref) => setTheme(pref),
  saveDraftSoon,
  unlock: () => unlock(),
  setup: (repo, token) => setup(repo, token),
  finishSetup: (answers) => finishSetup(answers),
  async save(payload, draftName) {
    const path = await ctx.session.saveItem(payload);
    ctx.items = [{ path, payload }, ...ctx.items];
    if (draftName) {
      clearTimeout(draftTimers.get(draftName));
      draftTimers.delete(draftName);
      await ctx.session.clearDraft(draftName);
    }
    return path;
  },
};

function readable(e) {
  if (e && e.name === 'NotAllowedError') return 'The passkey prompt was cancelled or timed out.';
  if (e && e.name === 'InvalidStateError') return 'A passkey for Odometer already exists on this device.';
  return (e && e.message) || String(e);
}

function route() {
  const [name, ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  return { name: VIEWS[name] ? name : 'write', arg: rest.length ? decodeURIComponent(rest.join('/')) : undefined };
}

function render(opts = {}) {
  if (!ctx.session) return;
  const r = route();
  try {
    shell.app(r.name, opts.chromeOnly ? null : VIEWS[r.name](ctx, r.arg), opts);
  } catch (e) {
    shell.say(readable(e), true);
  }
}

async function refresh() {
  const s = ctx.session;
  if (!s) return;
  ctx.sync = 'syncing';
  render({ chromeOnly: true });
  try {
    const items = await s.listItems();
    if (ctx.session !== s) return;
    ctx.items = items;
    ctx.sync = items.offline ? 'offline' : 'synced';
    lastSync = Date.now();
  } catch (e) {
    if (ctx.session !== s) return;
    ctx.sync = 'error';
    shell.say(readable(e), true);
  }
  render(FORMS.has(route().name) ? { chromeOnly: true } : {});
}

function saveDraftSoon(name) {
  clearTimeout(draftTimers.get(name));
  draftTimers.set(name, setTimeout(() => {
    draftTimers.delete(name);
    writeDraft(name);
  }, 600));
}

async function writeDraft(name) {
  const s = ctx.session;
  const d = ctx.drafts[name];
  if (!s || !s.isOpen() || !d) return;
  try {
    await s.saveDraft(name, d);
  } catch {
    shell.say('Could not save the draft on this device.', true);
  }
}

async function flushDrafts() {
  const names = [...draftTimers.keys()];
  for (const n of names) clearTimeout(draftTimers.get(n));
  draftTimers.clear();
  for (const n of names) await writeDraft(n);
}

async function enter(s) {
  ctx.session = s;
  ctx.items = [];
  ctx.ui = {};
  ctx.drafts = { entry: await s.loadDraft('entry'), memory: await s.loadDraft('memory') };
  idle = idleLock(IDLE_MS, () => lock('Locked after 5 minutes without activity.'));
  if (!VIEWS[route().name] || !location.hash) history.replaceState(null, '', '#/write');
  render();
  refresh();
}

async function unlock() {
  try {
    await enter(await vault.unlock());
  } catch (e) {
    shell.say(readable(e), true);
  }
}

async function setup(repoText, tokenText) {
  try {
    shell.say('Checking repository…');
    const conn = await vault.connect(repoText, tokenText);
    if (conn.keyring) {
      shell.say('Found your keyring. Confirm with your passkey.');
      const s = await vault.addThisDevice(conn);
      shell.say('');
      await enter(s);
    } else {
      shell.say('New repository. Creating your passkey.');
      pending = await vault.beginFirstDevice(conn);
      shell.say('');
      shell.solo(recoveryScreen(ctx, pending));
    }
  } catch (e) {
    shell.say(readable(e), true);
  }
}

async function finishSetup(answers) {
  try {
    const s = await pending.finish(answers);
    pending = null;
    await enter(s);
    shell.say('Odometer is ready. Every day adds a mile.');
  } catch (e) {
    shell.say(readable(e), true);
  }
}

async function lock(message) {
  if (!ctx.session) return;
  await flushDrafts();
  if (idle) idle.stop();
  idle = null;
  ctx.session.lock();
  ctx.session = null;
  ctx.items = [];
  ctx.drafts = {};
  ctx.ui = {};
  shell.solo(unlockScreen(ctx));
  if (message) shell.say(message);
}

async function forget() {
  if (!confirm('Remove Odometer from this device? Your entries stay in GitHub, encrypted.')) return;
  if (idle) idle.stop();
  idle = null;
  if (ctx.session) ctx.session.lock();
  ctx.session = null;
  ctx.items = [];
  ctx.drafts = {};
  await vault.forget();
  await store.put('kv', 'theme', ctx.themePref);
  shell.solo(setupScreen(ctx));
}

function applyTheme() {
  const pref = ctx.themePref;
  if (pref === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = pref;
  const light = pref === 'light' || (pref === 'system' && media.matches);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = light ? '#F7F6FC' : '#0E0C1D';
}

async function setTheme(pref) {
  ctx.themePref = pref;
  applyTheme();
  await store.put('kv', 'theme', pref);
}

async function start() {
  const root = document.getElementById('app');
  shell = createShell(root, ctx);
  applyDailyFavicon();
  if (!window.PublicKeyCredential || !window.indexedDB || !window.isSecureContext) {
    root.textContent = 'This browser cannot run Odometer. It needs passkeys over HTTPS.';
    return;
  }
  store = await openStore();
  ctx.themePref = (await store.get('kv', 'theme')) || 'system';
  applyTheme();
  media.addEventListener('change', applyTheme);
  vault = createVault({ store, passkeys, fetch: window.fetch.bind(window) });
  shell.solo((await vault.isSetUp()) ? unlockScreen(ctx) : setupScreen(ctx));
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

window.addEventListener('hashchange', () => {
  if (!ctx.session) return;
  render();
  window.scrollTo(0, 0);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && ctx.session && Date.now() - lastSync > REFRESH_MS) refresh();
  if (document.visibilityState === 'hidden') flushDrafts();
});

start().catch((e) => {
  document.getElementById('app').textContent = readable(e);
});
