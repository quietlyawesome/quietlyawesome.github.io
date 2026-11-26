import * as c from '../js/crypto.js';

const op = process.argv[2];
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const input = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
const d = c.b64dec;
const e = c.b64enc;

async function setup(payload) {
  const mk = c.newMasterKey();
  const rec = await c.newRecovery();
  const keyring = c.newKeyring();
  keyring.wraps.push(await c.passkeyWrap(mk, c.randomBytes(32), c.randomBytes(16), c.randomBytes(32)));
  keyring.wraps.push(await c.recoveryWrap(mk, rec.secret));
  const path = c.newObjectPath();
  const file = await c.encryptObject(await c.objectKey(mk), path, payload);
  return { keyring, phrase: rec.phrase, path, file };
}

async function run() {
  if (op === 'encrypt') {
    return { file: await c.encryptObject(await c.objectKey(d(input.mk)), input.path, input.payload) };
  }
  if (op === 'decrypt') {
    return { payload: await c.decryptObject(await c.objectKey(d(input.mk)), input.path, input.file) };
  }
  if (op === 'setup') return setup(input.payload);
  if (op === 'open') {
    const mk = await c.unlockWithRecovery(input.keyring, input.phrase);
    return { mk: e(mk), payload: await c.decryptObject(await c.objectKey(mk), input.path, input.file) };
  }
  throw new Error('unknown op ' + op);
}

process.stdout.write(JSON.stringify(await run()));
