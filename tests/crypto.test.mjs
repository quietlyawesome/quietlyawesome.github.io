import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as c from '../js/crypto.js';

const V = JSON.parse(readFileSync(new URL('./vectors.json', import.meta.url), 'utf8'));
const d = c.b64dec;
const e = c.b64enc;

function keyFor(type, ikm, salt) {
  if (type === 'passkey') return c.passkeyWrapKey(ikm);
  if (type === 'recovery') return c.recoveryWrapKey(ikm, salt);
  if (type === 'mac-cli') return c.macWrapKey(ikm);
  throw new Error('unknown type ' + type);
}

test('hkdf', async () => {
  for (const v of V.hkdf) assert.equal(e(await c.hkdf(d(v.ikm), v.info, d(v.salt))), v.okm);
});

test('padding sizes and round trip', () => {
  for (const v of V.pad) {
    assert.equal(c.paddedSize(v.len), v.size);
    const data = new Uint8Array(v.len).fill(7);
    const p = c.pad(data);
    assert.equal(p.length, c.paddedSize(data.length));
    assert.deepEqual(c.unpad(p), data);
  }
});

test('recovery phrase', async () => {
  for (const v of V.recovery) {
    assert.equal(await c.secretToPhrase(d(v.secret)), v.phrase);
    assert.equal(e(await c.phraseToSecret(v.phrase)), v.secret);
  }
  for (const v of V.phraseVariants) assert.equal(e(await c.phraseToSecret(v.phrase)), v.secret);
  const r = await c.newRecovery();
  assert.match(r.phrase, /^([0-9A-HJKMNP-TV-Z]{4}-){13}[0-9A-HJKMNP-TV-Z]{4}$/);
  assert.deepEqual(await c.phraseToSecret(r.phrase), r.secret);
});

test('wrap and unwrap', async () => {
  for (const v of V.wrap) {
    const key = await keyFor(v.type, d(v.ikm), d(v.salt));
    const w = await c.wrapMK(d(v.mk), key, v.type, d(v.iv));
    assert.deepEqual(w, { iv: v.iv, ct: v.ct });
    assert.equal(e(await c.unwrapMK({ type: v.type, iv: v.iv, ct: v.ct }, key)), v.mk);
  }
});

test('object files match byte for byte', async () => {
  for (const v of V.object) {
    const key = await c.objectKey(d(v.mk));
    assert.equal(await c.encryptBytes(key, v.path, d(v.plaintext), d(v.iv)), v.file);
    assert.equal(e(await c.decryptBytes(key, v.path, v.file)), v.plaintext);
  }
});

test('keyring: build, unlock three ways, recovery phrase alone rebuilds MK', async () => {
  const K = V.keyring;
  const i = K.inputs;
  const kr = c.newKeyring();
  kr.wraps.push(await c.passkeyWrap(d(i.mk), d(i.prf), d(i.credId), d(i.prfSalt), d(K.keyring.wraps[0].iv)));
  kr.wraps.push(await c.recoveryWrap(d(i.mk), d(i.recoverySecret), d(i.recoverySalt), d(K.keyring.wraps[1].iv)));
  kr.wraps.push(await c.macWrap(d(i.mk), d(i.macSecret), d(K.keyring.wraps[2].iv)));
  assert.deepEqual(kr, K.keyring);
  assert.equal(await c.secretToPhrase(d(i.recoverySecret)), K.phrase);

  const fromPhrase = await c.unlockWithRecovery(K.keyring, K.phrase);
  assert.equal(e(fromPhrase), i.mk);
  assert.equal(e(await c.unlockWithPasskey(K.keyring, d(i.credId), d(i.prf))), i.mk);
  assert.equal(e(await c.unlockWithMac(K.keyring, d(i.macSecret))), i.mk);

  const o = K.object;
  const payload = await c.decryptObject(await c.objectKey(fromPhrase), o.path, o.file);
  assert.deepEqual(payload, o.payload);
});

test('sealed device secrets', async () => {
  for (const v of V.sealed) {
    const key = await c.tokenKey(d(v.prf));
    assert.deepEqual(await c.sealJSON(key, v.aad, v.obj, d(v.iv)), v.box);
    assert.deepEqual(await c.openJSON(key, v.aad, v.box), v.obj);
  }
});

test('bad inputs are rejected', async () => {
  for (const v of V.bad) {
    const run = async () => {
      if (v.op === 'decrypt') return c.decryptBytes(await c.objectKey(d(v.mk)), v.path, v.file);
      if (v.op === 'unwrap') return c.unwrapMK(v.wrap, await keyFor(v.keyType, d(v.ikm), d(v.salt)));
      if (v.op === 'phrase') return c.phraseToSecret(v.phrase);
      if (v.op === 'openSealed') return c.openJSON(await c.tokenKey(d(v.prf)), v.aad, v.box);
      if (v.op === 'unlockRecovery') return c.unlockWithRecovery(v.keyring, v.phrase);
      if (v.op === 'unlockPasskey') return c.unlockWithPasskey(v.keyring, d(v.credId), d(v.prf));
      throw new Error('unknown op ' + v.op);
    };
    await assert.rejects(run, (err) => err instanceof c.CryptoError && err.message === v.error, v.case);
  }
});

test('fresh random objects round trip, and paths look random', async () => {
  const mk = c.newMasterKey();
  const key = await c.objectKey(mk);
  const payload = { v: 1, kind: 'entry', date: '2026-01-02', mood: 3, tags: [], text: 'x'.repeat(5000) };
  const path = c.newObjectPath();
  assert.match(path, /^objects\/([0-9a-f]{2})\/\1[0-9a-f]{30}\.enc$/);
  const file = await c.encryptObject(key, path, payload);
  assert.deepEqual(await c.decryptObject(key, path, file), payload);
  assert.notEqual(await c.encryptObject(key, path, payload), file);
  assert.equal(d(JSON.parse(file).ct).length, 16384 + 16);
});
