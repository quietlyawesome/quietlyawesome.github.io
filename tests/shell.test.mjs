import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const sw = readFileSync(new URL('sw.js', root), 'utf8');
const shell = [...sw.matchAll(/^\s+'([^']+)',$/gm)].map((m) => m[1]);

test('service worker caches every app module and every listed file exists', () => {
  const modules = [
    ...readdirSync(new URL('js/', root)).filter((f) => f.endsWith('.js')).map((f) => `js/${f}`),
    ...readdirSync(new URL('js/ui/', root)).filter((f) => f.endsWith('.js')).map((f) => `js/ui/${f}`),
  ];
  for (const m of modules) assert.ok(shell.includes(m), `${m} missing from sw.js SHELL`);
  for (const f of shell) if (f !== './') assert.ok(existsSync(new URL(f, root)), `${f} listed but missing`);
});

test('page CSP stays strict', () => {
  const html = readFileSync(new URL('index.html', root), 'utf8');
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self';/);
  assert.match(csp, /connect-src https:\/\/api\.github\.com;/);
  assert.ok(!csp.includes('unsafe'));
});
