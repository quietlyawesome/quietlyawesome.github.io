import { randomBytes } from './crypto.js';

export async function create() {
  const cred = await navigator.credentials.create({
    publicKey: {
      rp: { name: 'Odometer', id: location.hostname },
      user: { id: randomBytes(16), name: 'Odometer', displayName: 'Odometer' },
      challenge: randomBytes(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      extensions: { prf: {} },
    },
  });
  const prf = cred.getClientExtensionResults().prf;
  if (prf && prf.enabled === false) throw new Error('This passkey cannot derive keys (no PRF support)');
  return new Uint8Array(cred.rawId);
}

export async function prf(credId, prfSalt) {
  const a = await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      rpId: location.hostname,
      allowCredentials: [{ type: 'public-key', id: credId }],
      userVerification: 'required',
      extensions: { prf: { eval: { first: prfSalt } } },
    },
  });
  const r = a.getClientExtensionResults().prf;
  if (!r || !r.results || !r.results.first) throw new Error('This passkey gave no PRF output');
  return new Uint8Array(r.results.first);
}
