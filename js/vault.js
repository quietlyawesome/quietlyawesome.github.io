import * as c from './crypto.js';
import { github, parseRepo, checkToken } from './github.js';

const KEYRING = 'keyring.json';
const SECRETS_AAD = 'device-secrets';
const CHECK_GROUPS = [3, 11];
const FETCH_PARALLEL = 6;

export class VaultError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VaultError';
  }
}

function fail(message) {
  throw new VaultError(message);
}

function parseKeyring(text) {
  let k;
  try {
    k = JSON.parse(text);
  } catch {
    fail('keyring.json is not valid JSON');
  }
  if (!k || k.v !== 1 || !Array.isArray(k.wraps)) fail('keyring.json has an unknown format');
  return k;
}

async function mkCheck(mk) {
  return c.b64enc(await c.hkdf(mk, c.INFO.check));
}

const pad2 = (n) => String(n).padStart(2, '0');

export function localStamp(d = new Date()) {
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const off = -d.getTimezoneOffset();
  const a = Math.abs(off);
  const zone = `${off >= 0 ? '+' : '-'}${pad2(Math.floor(a / 60))}:${pad2(a % 60)}`;
  return { date, created: `${date}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}${zone}` };
}

export function newEntry({ text, mood, tags = [], analyze = true }, now = new Date()) {
  const { date, created } = localStamp(now);
  return { v: 1, kind: 'entry', created, date, mood, tags, analyze, text };
}

function normGroup(s) {
  return String(s).toUpperCase().replace(/\s/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

export function createVault({ store, passkeys, fetch }) {
  async function connect(repoText, tokenText) {
    const { owner, repo } = parseRepo(repoText);
    const token = checkToken(tokenText);
    const gh = github({ owner, repo, token, fetch });
    const info = await gh.info();
    if (!info.private) fail('This repository is public. Odometer only stores data in a private repository.');
    if (!info.push) fail('This token cannot write to the repository. Give it Contents: Read and write.');
    const text = await gh.getText(KEYRING);
    return { owner, repo, token, gh, keyring: text === null ? null : parseKeyring(text) };
  }

  async function saveDevice(conn, credId, prfSalt, prf, mk, keyring) {
    const secrets = { owner: conn.owner, repo: conn.repo, token: conn.token, mkCheck: await mkCheck(mk) };
    const sealed = await c.sealJSON(await c.tokenKey(prf), SECRETS_AAD, secrets);
    await store.put('kv', 'device', { v: 1, credId: c.b64enc(credId), prfSalt: c.b64enc(prfSalt), secrets: sealed });
    await store.put('kv', 'keyring', keyring);
  }

  async function isSetUp() {
    return !!(await store.get('kv', 'device'));
  }

  async function beginFirstDevice(conn) {
    if (conn.keyring) fail('This repository already has a keyring. Use it to set up this device instead.');
    const credId = await passkeys.create();
    const prfSalt = c.randomBytes(32);
    const prf = await passkeys.prf(credId, prfSalt);
    const mk = c.newMasterKey();
    const rec = await c.newRecovery();
    const keyring = c.newKeyring();
    keyring.wraps.push(await c.passkeyWrap(mk, prf, credId, prfSalt));
    keyring.wraps.push(await c.recoveryWrap(mk, rec.secret));
    c.wipe(rec.secret);
    const groups = rec.phrase.split('-');
    let done = false;
    return {
      phrase: rec.phrase,
      checkGroups: CHECK_GROUPS,
      async finish(answers) {
        if (done) fail('Setup already finished');
        if (!CHECK_GROUPS.every((g, i) => normGroup(answers[i]) === groups[g - 1])) {
          fail('Those groups do not match. Check what you wrote down.');
        }
        const ok = await conn.gh.create(KEYRING, JSON.stringify(keyring, null, 1) + '\n', 'keyring');
        if (!ok) fail('keyring.json appeared in the repository meanwhile. Nothing was overwritten.');
        await saveDevice(conn, credId, prfSalt, prf, mk, keyring);
        done = true;
        c.wipe(prf);
        return session(conn, mk);
      },
    };
  }

  async function addThisDevice(conn) {
    if (!conn.keyring) fail('This repository has no keyring yet. Set up your first device on the Mac.');
    const wraps = conn.keyring.wraps.filter((w) => w && w.type === 'passkey');
    if (!wraps.length) fail('The keyring has no passkey.');
    let last;
    for (const w of wraps) {
      const credId = c.b64dec(w.credId);
      const prfSalt = c.b64dec(w.prfSalt);
      let prf;
      try {
        prf = await passkeys.prf(credId, prfSalt);
      } catch (e) {
        last = e;
        continue;
      }
      const mk = await c.unlockWithPasskey(conn.keyring, credId, prf);
      await saveDevice(conn, credId, prfSalt, prf, mk, conn.keyring);
      c.wipe(prf);
      return session(conn, mk);
    }
    throw last;
  }

  async function unlock() {
    const dev = await store.get('kv', 'device');
    if (!dev) fail('This device is not set up');
    const credId = c.b64dec(dev.credId);
    const prf = await passkeys.prf(credId, c.b64dec(dev.prfSalt));
    let secrets;
    try {
      secrets = await c.openJSON(await c.tokenKey(prf), SECRETS_AAD, dev.secrets);
    } catch {
      fail('This passkey does not match this device');
    }
    const gh = github({ owner: secrets.owner, repo: secrets.repo, token: secrets.token, fetch });
    let keyring;
    try {
      const text = await gh.getText(KEYRING);
      if (text === null) fail('keyring.json is missing from the repository');
      keyring = parseKeyring(text);
    } catch (e) {
      if (e.status !== 0) throw e;
      keyring = await store.get('kv', 'keyring');
      if (!keyring) throw e;
    }
    const mk = await c.unlockWithPasskey(keyring, credId, prf);
    c.wipe(prf);
    if ((await mkCheck(mk)) !== secrets.mkCheck) {
      c.wipe(mk);
      fail('keyring.json now holds a different key than this device was set up with. Refusing to unlock.');
    }
    await store.put('kv', 'keyring', keyring);
    return session({ ...secrets, gh }, mk);
  }

  async function forget() {
    await store.clear();
  }

  function session(conn, mk) {
    let objKey = c.objectKey(mk);
    let token = conn.token;
    let open = true;
    const need = () => open || fail('Locked');

    async function file(o) {
      let text = await store.get('blobs', o.sha);
      if (typeof text !== 'string') {
        text = await conn.gh.getBlob(o.sha);
        await store.put('blobs', o.sha, text);
      }
      return text;
    }

    async function listEntries() {
      need();
      const objs = await conn.gh.listObjects();
      const key = await objKey;
      const out = new Array(objs.length);
      let next = 0;
      async function worker() {
        while (next < objs.length) {
          const i = next++;
          const o = objs[i];
          try {
            out[i] = { path: o.path, payload: await c.decryptObject(key, o.path, await file(o)) };
          } catch (e) {
            if (!(e instanceof c.CryptoError)) throw e;
            out[i] = { path: o.path, error: e.message };
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(FETCH_PARALLEL, objs.length) }, worker));
      const when = (x) => (x.payload && (x.payload.created || x.payload.date)) || '';
      return out.sort((a, b) => (when(a) < when(b) ? 1 : when(a) > when(b) ? -1 : 0));
    }

    async function saveEntry(payload) {
      need();
      const key = await objKey;
      for (let i = 0; i < 2; i++) {
        const path = c.newObjectPath();
        const text = await c.encryptObject(key, path, payload);
        if (await conn.gh.create(path, text, 'entry')) return path;
      }
      fail('GitHub refused the write');
    }

    return {
      listEntries,
      saveEntry,
      token: () => (need(), token),
      repoName: () => `${conn.owner}/${conn.repo}`,
      lock() {
        open = false;
        c.wipe(mk);
        objKey = null;
        token = null;
        conn = null;
      },
    };
  }

  return { connect, isSetUp, beginFirstDevice, addThisDevice, unlock, forget };
}
