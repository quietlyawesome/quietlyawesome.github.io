import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as c from '../js/crypto.js';
import { createVault, newEntry, localStamp } from '../js/vault.js';
import { memoryStore } from '../js/store.js';
import { fakeGitHub, fakePasskeys } from './fake-github.mjs';

const TOKEN = 'github_pat_' + 'A'.repeat(40);
const REPO = 'someone/data';

function world(opts = {}) {
  const gh = fakeGitHub({ token: TOKEN, ...opts });
  const passkeys = fakePasskeys();
  const device = (pk = passkeys) => {
    const store = memoryStore();
    return { store, vault: createVault({ store, passkeys: pk, fetch: gh.fetch }) };
  };
  return { gh, passkeys, device };
}

async function setupFirst(w) {
  const a = w.device();
  const conn = await a.vault.connect(REPO, TOKEN);
  const pending = await a.vault.beginFirstDevice(conn);
  const groups = pending.phrase.split('-');
  const session = await pending.finish(pending.checkGroups.map((g) => groups[g - 1].toLowerCase()));
  return { ...a, session, phrase: pending.phrase };
}

test('first device: keyring written only after the phrase is confirmed', async () => {
  const w = world();
  const a = w.device();
  const pending = await a.vault.beginFirstDevice(await a.vault.connect(REPO, TOKEN));
  assert.match(pending.phrase, /^([0-9A-Z]{4}-){13}[0-9A-Z]{4}$/);
  await assert.rejects(pending.finish(['XXXX', 'YYYY']), /do not match/);
  assert.equal(w.gh.files.size, 0);
  assert.equal(await a.vault.isSetUp(), false);

  const groups = pending.phrase.split('-');
  await pending.finish([groups[2], groups[10]]);
  const keyring = JSON.parse(w.gh.files.get('keyring.json'));
  assert.deepEqual(keyring.wraps.map((x) => x.type), ['passkey', 'recovery']);
  assert.equal(w.gh.state.lastMessage, 'keyring');
  assert.equal(await a.vault.isSetUp(), true);
  await assert.rejects(pending.finish([groups[2], groups[10]]), /already finished/);
});

test('entry from device B reads on device A; recovery phrase alone decrypts it', async () => {
  const w = world();
  const a = await setupFirst(w);
  const b = w.device();
  const sessionB = await b.vault.addThisDevice(await b.vault.connect(REPO, TOKEN));
  const text = 'Fake entry from the phone. café ☕';
  const path = await sessionB.saveEntry(newEntry({ text, mood: 8, tags: ['test'] }));
  assert.equal(w.gh.state.lastMessage, 'entry');

  const list = await a.session.listEntries();
  assert.equal(list.length, 1);
  assert.equal(list[0].path, path);
  assert.equal(list[0].payload.text, text);
  assert.equal(list[0].payload.mood, 8);

  const keyring = JSON.parse(w.gh.files.get('keyring.json'));
  const mk = await c.unlockWithRecovery(keyring, a.phrase);
  const payload = await c.decryptObject(await c.objectKey(mk), path, w.gh.files.get(path));
  assert.equal(payload.text, text);
});

test('repo holds only ciphertext of bucketed size; device store holds no token', async () => {
  const w = world();
  const a = await setupFirst(w);
  const secret = 'very-recognizable-fake-text';
  await a.session.saveEntry(newEntry({ text: secret, mood: 5 }));
  await a.session.saveEntry(newEntry({ text: secret.repeat(300), mood: 2 }));
  for (const [p, t] of w.gh.files) {
    assert.ok(!t.includes(secret), p);
    if (p !== 'keyring.json') {
      assert.match(p, /^objects\/([0-9a-f]{2})\/\1[0-9a-f]{30}\.enc$/);
      assert.ok([4096, 16384].includes(c.b64dec(JSON.parse(t).ct).length - 16));
    }
  }
  const dump = JSON.stringify([...a.store.maps.kv]);
  assert.ok(!dump.includes(TOKEN));
  assert.ok(!dump.includes(REPO));
});

test('unlock after restart; lock wipes the session', async () => {
  const w = world();
  const a = await setupFirst(w);
  await a.session.saveEntry(newEntry({ text: 'one', mood: 3 }));
  a.session.lock();
  await assert.rejects(a.session.saveEntry(newEntry({ text: 'x', mood: 1 })), /Locked/);
  assert.throws(() => a.session.token(), /Locked/);

  const again = await a.vault.unlock();
  assert.equal(again.token(), TOKEN);
  assert.equal(again.repoName(), REPO);
  assert.equal((await again.listEntries())[0].payload.text, 'one');
});

test('ciphertext cache: second listing fetches no blobs', async () => {
  const w = world();
  const a = await setupFirst(w);
  for (let i = 0; i < 3; i++) await a.session.saveEntry(newEntry({ text: `e${i}`, mood: i + 1 }, new Date(2026, 0, i + 1)));
  const blobCalls = () => w.gh.calls.filter((x) => x.path.includes('/git/blobs/')).length;
  const first = await a.session.listEntries();
  assert.deepEqual(first.map((x) => x.payload.text), ['e2', 'e1', 'e0']);
  const n = blobCalls();
  assert.equal(n, 3);
  await a.session.listEntries();
  assert.equal(blobCalls(), n);
});

test('offline unlock uses the cached keyring', async () => {
  const w = world();
  const a = await setupFirst(w);
  a.session.lock();
  w.gh.state.online = false;
  const s = await a.vault.unlock();
  await assert.rejects(s.listEntries(), /Network error/);
});

test('a swapped keyring.json is refused', async () => {
  const w = world();
  const a = await setupFirst(w);
  const k = JSON.parse(w.gh.files.get('keyring.json'));
  const pw = k.wraps[0];
  const dev = await a.store.get('kv', 'device');
  const prf = await w.passkeys.prf(c.b64dec(dev.credId), c.b64dec(dev.prfSalt));
  const evil = c.newKeyring();
  evil.wraps.push(await c.passkeyWrap(c.newMasterKey(), prf, c.b64dec(pw.credId), c.b64dec(pw.prfSalt)));
  w.gh.files.set('keyring.json', JSON.stringify(evil));
  await assert.rejects(a.vault.unlock(), /different key/);
});

test('refusals', async () => {
  const pub = world({ isPrivate: false });
  await assert.rejects(pub.device().vault.connect(REPO, TOKEN), /public/);
  const ro = world({ push: false });
  await assert.rejects(ro.device().vault.connect(REPO, TOKEN), /cannot write/);

  const w = world();
  const d = w.device();
  await assert.rejects(d.vault.connect(REPO, 'ghp_' + 'A'.repeat(36)), /fine-grained/);
  await assert.rejects(d.vault.connect(REPO, 'nonsense'), /github_pat_/);
  await assert.rejects(d.vault.connect('not a repo', TOKEN), /owner\/name/);
  await assert.rejects(d.vault.connect('someone/other', TOKEN), /not found/);
  await assert.rejects(d.vault.connect(REPO, 'github_pat_' + 'B'.repeat(40)), /rejected the token/);
  await assert.rejects(d.vault.addThisDevice(await d.vault.connect(REPO, TOKEN)), /no keyring yet/);
  await assert.rejects(d.vault.unlock(), /not set up/);

  await setupFirst(w);
  const e = w.device();
  await assert.rejects(e.vault.beginFirstDevice(await e.vault.connect(REPO, TOKEN)), /already has a keyring/);

  const stranger = w.device(fakePasskeys());
  await assert.rejects(stranger.vault.addThisDevice(await stranger.vault.connect(REPO, TOKEN)), /No matching passkey/);
});

test('repo given as a URL is accepted', async () => {
  const w = world();
  const conn = await w.device().vault.connect('https://github.com/someone/data.git', TOKEN);
  assert.equal(conn.keyring, null);
});

test('local timestamp carries the offset', () => {
  const s = localStamp(new Date(2026, 10, 25, 21, 41, 5));
  assert.equal(s.date, '2026-11-25');
  assert.match(s.created, /^2026-11-25T21:41:05[+-]\d\d:\d\d$/);
});
