const API = 'https://api.github.com';
const OBJECT_RE = /^objects\/([0-9a-f]{2})\/\1[0-9a-f]{30}\.enc$/;
const NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

export class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
  }
}

export function parseRepo(text) {
  const s = String(text).trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
  if (!NAME_RE.test(s) || s.includes('..')) throw new GitHubError(0, 'Repository must look like owner/name');
  const [owner, repo] = s.split('/');
  return { owner, repo };
}

export function checkToken(token) {
  const t = String(token).trim();
  if (t.startsWith('ghp_') || t.startsWith('gho_')) {
    throw new GitHubError(0, 'Use a fine-grained token (starts with github_pat_), not a classic one');
  }
  if (!/^github_pat_[A-Za-z0-9_]{20,}$/.test(t)) throw new GitHubError(0, 'Token must start with github_pat_');
  return t;
}

function utf8ToB64(text) {
  const bytes = new TextEncoder().encode(text);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function github({ owner, repo, token, fetch = globalThis.fetch.bind(globalThis) }) {
  const base = `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  let branch = null;

  async function call(method, path, { body, raw = false, ok = [200], soft = [] } = {}) {
    let res;
    try {
      res = await fetch(base + path, {
        method,
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new GitHubError(0, 'Network error: GitHub is unreachable');
    }
    if (soft.includes(res.status)) return { status: res.status };
    if (!ok.includes(res.status)) {
      const messages = {
        401: 'GitHub rejected the token (expired or revoked?)',
        403: 'The token is not allowed to do this (check its repository and permissions)',
        404: 'Repository not found, or the token cannot see it',
        422: 'GitHub refused the write',
      };
      throw new GitHubError(res.status, messages[res.status] || `GitHub error ${res.status}`);
    }
    return { status: res.status, body: raw ? await res.text() : await res.json() };
  }

  async function info() {
    const { body } = await call('GET', '');
    branch = body.default_branch || 'main';
    return { private: body.private === true, push: !!(body.permissions && body.permissions.push), branch };
  }

  async function getText(path) {
    const r = await call('GET', `/contents/${path}`, { raw: true, soft: [404] });
    return r.status === 404 ? null : r.body;
  }

  async function listObjects() {
    if (!branch) await info();
    const r = await call('GET', `/git/trees/${encodeURIComponent(branch)}?recursive=1`, { soft: [404, 409] });
    if (r.status !== 200) return [];
    if (r.body.truncated) throw new GitHubError(0, 'Repository listing was truncated');
    return r.body.tree
      .filter((t) => t.type === 'blob' && OBJECT_RE.test(t.path))
      .map((t) => ({ path: t.path, sha: t.sha, size: t.size }));
  }

  async function getBlob(sha) {
    if (!/^[0-9a-f]{40,64}$/.test(sha)) throw new GitHubError(0, 'bad blob sha');
    return (await call('GET', `/git/blobs/${sha}`, { raw: true })).body;
  }

  async function create(path, text, message) {
    const r = await call('PUT', `/contents/${path}`, {
      body: { message, content: utf8ToB64(text) },
      ok: [201],
      soft: [409, 422],
    });
    if (r.status !== 201) return false;
    return true;
  }

  return { info, getText, listObjects, getBlob, create };
}
