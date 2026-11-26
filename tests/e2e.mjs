import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createVault, newEntry } from '../js/vault.js';
import { memoryStore } from '../js/store.js';
import { fakeGitHub, fakePasskeys } from './fake-github.mjs';

const out = process.argv[2];
const TOKEN = 'github_pat_' + 'E'.repeat(40);
const gh = fakeGitHub({ token: TOKEN });
const passkeys = fakePasskeys();
const device = () => createVault({ store: memoryStore(), passkeys, fetch: gh.fetch });

const mac = device();
const pending = await mac.beginFirstDevice(await mac.connect('someone/data', TOKEN));
const groups = pending.phrase.split('-');
await pending.finish(pending.checkGroups.map((g) => groups[g - 1]));

const phone = await device().addThisDevice(await device().connect('someone/data', TOKEN));
const texts = ['Fake phone entry one.', 'Fake phone entry two — ünïcødé 🚲', 'z'.repeat(20000)];
for (const [i, text] of texts.entries()) {
  await phone.saveEntry(newEntry({ text, mood: i + 4, tags: ['fake'] }, new Date(2026, 0, i + 1, 9)));
}

for (const [p, t] of gh.files) {
  mkdirSync(dirname(join(out, p)), { recursive: true });
  writeFileSync(join(out, p), t);
}
process.stdout.write(JSON.stringify({ phrase: pending.phrase, texts }));
