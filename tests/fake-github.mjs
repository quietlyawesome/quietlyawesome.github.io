import { createHash, createHmac, randomBytes } from 'node:crypto';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const blobSha = (text) => {
  const buf = Buffer.from(text, 'utf8');
  return createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
};

export function fakeGitHub({ owner = 'someone', repo = 'data', token, isPrivate = true, push = true } = {}) {
  const files = new Map();
  const calls = [];
  const prefix = `/repos/${owner}/${repo}`;
  const state = { online: true };

  async function fetch(url, opts = {}) {
    const method = opts.method || 'GET';
    const u = new URL(url);
    calls.push({ method, path: u.pathname });
    if (!state.online) throw new TypeError('Failed to fetch');
    if (u.origin !== 'https://api.github.com') return json(404, {});
    const h = opts.headers || {};
    if (h.Authorization !== `Bearer ${token}`) return json(401, { message: 'Bad credentials' });
    if (h['X-GitHub-Api-Version'] !== '2022-11-28') return json(400, { message: 'missing api version' });
    if (!u.pathname.startsWith(prefix)) return json(404, { message: 'Not Found' });
    const path = u.pathname.slice(prefix.length);
    const raw = h.Accept === 'application/vnd.github.raw+json';
    let m;

    if (path === '' && method === 'GET') {
      return json(200, { private: isPrivate, default_branch: 'main', permissions: { push } });
    }
    if ((m = path.match(/^\/contents\/(.+)$/))) {
      const p = decodeURIComponent(m[1]);
      if (method === 'GET') {
        if (!files.has(p)) return json(404, { message: 'Not Found' });
        if (!raw) return json(200, { sha: blobSha(files.get(p)), content: Buffer.from(files.get(p)).toString('base64') });
        return new Response(files.get(p), { status: 200 });
      }
      if (method === 'PUT') {
        if (!push) return json(403, { message: 'Resource not accessible' });
        const b = JSON.parse(opts.body);
        if (typeof b.message !== 'string' || typeof b.content !== 'string') return json(422, {});
        if (files.has(p) && !b.sha) return json(422, { message: '"sha" wasn\'t supplied.' });
        const text = Buffer.from(b.content, 'base64').toString('utf8');
        files.set(p, text);
        state.lastMessage = b.message;
        return json(201, { content: { path: p, sha: blobSha(text) } });
      }
    }
    if ((m = path.match(/^\/git\/trees\/([^/?]+)$/)) && method === 'GET') {
      if (m[1] !== 'main') return json(404, {});
      if (!files.size) return json(409, { message: 'Git Repository is empty.' });
      const dirs = new Set();
      for (const p of files.keys()) {
        const parts = p.split('/');
        for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
      }
      const tree = [
        ...[...dirs].map((d) => ({ path: d, type: 'tree', sha: blobSha('tree:' + d) })),
        ...[...files].map(([p, t]) => ({ path: p, type: 'blob', sha: blobSha(t), size: Buffer.byteLength(t) })),
      ];
      return json(200, { sha: 'x', tree, truncated: false });
    }
    if ((m = path.match(/^\/git\/blobs\/([0-9a-f]+)$/)) && method === 'GET') {
      for (const t of files.values()) {
        if (blobSha(t) === m[1]) return raw ? new Response(t, { status: 200 }) : json(200, { content: Buffer.from(t).toString('base64') });
      }
      return json(404, {});
    }
    return json(404, { message: 'Not Found' });
  }

  return { fetch, files, calls, state };
}

export function fakePasskeys() {
  const creds = new Map();
  const key = (id) => Buffer.from(id).toString('base64');
  return {
    creds,
    async create() {
      const id = new Uint8Array(randomBytes(16));
      creds.set(key(id), randomBytes(32));
      return id;
    },
    async prf(credId, salt) {
      const secret = creds.get(key(credId));
      if (!secret) throw new DOMException('No matching passkey', 'NotAllowedError');
      return new Uint8Array(createHmac('sha256', secret).update(salt).digest());
    },
  };
}
