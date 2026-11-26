const subtle = globalThis.crypto.subtle;
const te = new TextEncoder();
const td = new TextDecoder('utf-8', { fatal: true });

export const INFO = Object.freeze({
  wrap: 'diary-wrap-v1',
  token: 'diary-token-v1',
  recovery: 'diary-recovery-v1',
  mac: 'diary-mac-v1',
  object: 'diary-object-v1',
});
export const BUCKETS = Object.freeze([4096, 16384, 65536, 262144]);

const ZERO_SALT = new Uint8Array(32);
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PATH_RE = /^objects\/([0-9a-f]{2})\/\1[0-9a-f]{30}\.enc$/;
const B64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

export class CryptoError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CryptoError';
  }
}

function fail(message) {
  throw new CryptoError(message);
}

export function randomBytes(n) {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

export function b64enc(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function b64dec(str) {
  if (typeof str !== 'string' || str.length % 4 || !B64_RE.test(str)) fail('bad base64');
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function hex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function equal(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

function hkdfParams(info, salt) {
  return { name: 'HKDF', hash: 'SHA-256', salt, info: te.encode(info) };
}

function hkdfInput(ikm) {
  return subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits', 'deriveKey']);
}

export async function hkdf(ikm, info, salt = ZERO_SALT) {
  return new Uint8Array(await subtle.deriveBits(hkdfParams(info, salt), await hkdfInput(ikm), 256));
}

async function deriveAes(ikm, info, salt = ZERO_SALT) {
  return subtle.deriveKey(hkdfParams(info, salt), await hkdfInput(ikm),
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export const passkeyWrapKey = (prf) => deriveAes(prf, INFO.wrap);
export const tokenKey = (prf) => deriveAes(prf, INFO.token);
export const recoveryWrapKey = (secret, salt) => deriveAes(secret, INFO.recovery, salt);
export const macWrapKey = (secret) => deriveAes(secret, INFO.mac);
export const objectKey = (mk) => deriveAes(mk, INFO.object);

async function seal(key, iv, data, aad) {
  if (iv.length !== 12) fail('bad iv');
  return new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(aad) }, key, data));
}

async function open(key, iv, ct, aad) {
  if (iv.length !== 12) fail('bad iv');
  try {
    return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv, additionalData: te.encode(aad) }, key, ct));
  } catch {
    fail('decrypt failed');
  }
}

export function newMasterKey() {
  return randomBytes(32);
}

export async function wrapMK(mk, wrapKey, type, iv = randomBytes(12)) {
  if (mk.length !== 32) fail('bad master key');
  return { iv: b64enc(iv), ct: b64enc(await seal(wrapKey, iv, mk, 'keyring:' + type)) };
}

export async function unwrapMK(wrap, wrapKey) {
  const mk = await open(wrapKey, b64dec(wrap.iv), b64dec(wrap.ct), 'keyring:' + wrap.type);
  if (mk.length !== 32) fail('bad master key');
  return mk;
}

export function newKeyring() {
  return { v: 1, wraps: [] };
}

export async function passkeyWrap(mk, prf, credId, prfSalt, iv) {
  const w = await wrapMK(mk, await passkeyWrapKey(prf), 'passkey', iv);
  return { type: 'passkey', credId: b64enc(credId), prfSalt: b64enc(prfSalt), iv: w.iv, ct: w.ct };
}

export async function recoveryWrap(mk, secret, salt = randomBytes(16), iv) {
  const w = await wrapMK(mk, await recoveryWrapKey(secret, salt), 'recovery', iv);
  return { type: 'recovery', salt: b64enc(salt), iv: w.iv, ct: w.ct };
}

export async function macWrap(mk, secret, iv) {
  const w = await wrapMK(mk, await macWrapKey(secret), 'mac-cli', iv);
  return { type: 'mac-cli', iv: w.iv, ct: w.ct };
}

function wrapsOf(keyring, type) {
  if (!keyring || keyring.v !== 1 || !Array.isArray(keyring.wraps)) fail('bad keyring');
  return keyring.wraps.filter((w) => w && w.type === type);
}

async function firstUnwrap(wraps, keyFor, message) {
  for (const w of wraps) {
    try {
      return await unwrapMK(w, await keyFor(w));
    } catch (e) {
      if (!(e instanceof CryptoError)) throw e;
    }
  }
  fail(message);
}

export async function unlockWithPasskey(keyring, credId, prf) {
  const id = b64enc(credId);
  const wraps = wrapsOf(keyring, 'passkey').filter((w) => w.credId === id);
  return firstUnwrap(wraps, () => passkeyWrapKey(prf), 'passkey does not match');
}

export async function unlockWithRecovery(keyring, phrase) {
  const secret = await phraseToSecret(phrase);
  return firstUnwrap(wrapsOf(keyring, 'recovery'), (w) => recoveryWrapKey(secret, b64dec(w.salt)),
    'recovery phrase does not match');
}

export async function unlockWithMac(keyring, secret) {
  return firstUnwrap(wrapsOf(keyring, 'mac-cli'), () => macWrapKey(secret), 'mac key does not match');
}

async function checksum(secret) {
  return new Uint8Array(await subtle.digest('SHA-256', secret)).subarray(0, 3);
}

export async function secretToPhrase(secret) {
  if (secret.length !== 32) fail('bad recovery secret');
  const data = new Uint8Array(35);
  data.set(secret);
  data.set(await checksum(secret), 32);
  let n = BigInt('0x' + hex(data));
  let s = '';
  for (let i = 0; i < 56; i++) {
    s = B32[Number(n & 31n)] + s;
    n >>= 5n;
  }
  return s.match(/.{4}/g).join('-');
}

export async function phraseToSecret(phrase) {
  const s = String(phrase).toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== 56) fail('recovery phrase must have 56 characters');
  let n = 0n;
  for (const c of s) {
    const i = B32.indexOf(c);
    if (i < 0) fail('recovery phrase has a bad character');
    n = n * 32n + BigInt(i);
  }
  const h = n.toString(16).padStart(70, '0');
  const data = Uint8Array.from(h.match(/../g), (x) => parseInt(x, 16));
  const secret = data.slice(0, 32);
  if (!equal(await checksum(secret), data.subarray(32))) fail('recovery phrase has a typo');
  return secret;
}

export async function newRecovery() {
  const secret = randomBytes(32);
  return { secret, phrase: await secretToPhrase(secret) };
}

export function paddedSize(n) {
  const need = n + 4;
  for (const b of BUCKETS) if (need <= b) return b;
  const top = BUCKETS[BUCKETS.length - 1];
  return Math.ceil(need / top) * top;
}

export function pad(data) {
  const out = new Uint8Array(paddedSize(data.length));
  new DataView(out.buffer).setUint32(0, data.length);
  out.set(data, 4);
  return out;
}

export function unpad(buf) {
  if (buf.length < 4) fail('bad padding');
  const n = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(0);
  if (n + 4 > buf.length || paddedSize(n) !== buf.length) fail('bad padding');
  for (let i = 4 + n; i < buf.length; i++) if (buf[i] !== 0) fail('bad padding');
  return buf.slice(4, 4 + n);
}

export function newObjectPath(name = randomBytes(16)) {
  if (name.length !== 16) fail('bad object name');
  const h = hex(name);
  return `objects/${h.slice(0, 2)}/${h}.enc`;
}

function checkPath(path) {
  if (typeof path !== 'string' || !PATH_RE.test(path)) fail('bad object path');
}

export async function encryptBytes(key, path, data, iv = randomBytes(12)) {
  checkPath(path);
  const ct = await seal(key, iv, pad(data), path);
  return JSON.stringify({ v: 1, alg: 'A256GCM', iv: b64enc(iv), ct: b64enc(ct) });
}

export async function decryptBytes(key, path, file) {
  checkPath(path);
  let o;
  try {
    o = JSON.parse(file);
  } catch {
    fail('bad object file');
  }
  if (!o || o.v !== 1 || o.alg !== 'A256GCM') fail('bad object file');
  return unpad(await open(key, b64dec(o.iv), b64dec(o.ct), path));
}

export function encryptObject(key, path, payload, iv) {
  return encryptBytes(key, path, te.encode(JSON.stringify(payload)), iv);
}

export async function decryptObject(key, path, file) {
  const data = await decryptBytes(key, path, file);
  try {
    return JSON.parse(td.decode(data));
  } catch {
    fail('bad object payload');
  }
}
