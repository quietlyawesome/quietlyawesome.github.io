import { h } from './dom.js';
import { icon } from './icons.js';
import { todaysMark } from './marks.js';

function foot() {
  return h('p', { class: 'foot' }, icon('shield', 14, 2), 'End-to-end encrypted · AES-256 · passkey');
}

function busy(button, fn) {
  return async (e) => {
    if (e) e.preventDefault();
    button.disabled = true;
    try {
      await fn();
    } finally {
      button.disabled = false;
    }
  };
}

export function unlockScreen(ctx) {
  const go = h('button', { type: 'button', class: 'btn primary xl' }, icon('key', 22), 'Unlock with passkey');
  go.addEventListener('click', busy(go, () => ctx.unlock()));
  return h('div', { class: 'gate' },
    h('div', { class: 'gate-hero' },
      todaysMark(148),
      h('div', { class: 'gate-words' },
        h('h1', {}, 'Odometer'),
        h('p', { class: 'tagline' }, 'Every day adds a mile.'),
        h('p', { class: 'muted' }, 'Only your devices can read what you write.'))),
    h('div', { class: 'gate-actions' }, go, foot()));
}

export function setupScreen(ctx) {
  const repo = h('input', { id: 'repo', class: 'field', placeholder: 'owner/repository', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', required: true });
  const token = h('input', { id: 'token', class: 'field', type: 'password', placeholder: 'github_pat_…', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', required: true });
  const go = h('button', { type: 'submit', class: 'btn primary xl' }, icon('key', 22), 'Continue with passkey');
  const form = h('form', { class: 'gate-form', autocomplete: 'off' },
    h('label', { class: 'label', for: 'repo' }, 'Data repository'), repo,
    h('label', { class: 'label', for: 'token' }, 'GitHub token'), token,
    h('p', { class: 'muted small' }, 'A fine-grained token for that private repository only, with Contents: read and write. It is stored encrypted under your passkey.'),
    go);
  form.addEventListener('submit', busy(go, async () => {
    await ctx.setup(repo.value, token.value);
    token.value = '';
  }));
  return h('div', { class: 'gate' },
    h('div', { class: 'gate-hero small' },
      todaysMark(96),
      h('div', { class: 'gate-words' }, h('h1', {}, 'Set up Odometer'), h('p', { class: 'muted' }, 'First device creates your passkey and keyring. Other devices use the same passkey.'))),
    form,
    foot());
}

export function recoveryScreen(ctx, pending) {
  const groups = pending.phrase.split('-');
  const [ga, gb] = pending.checkGroups;
  const a = h('input', { id: 'check-a', class: 'field mono', maxlength: 4, autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', required: true });
  const b = h('input', { id: 'check-b', class: 'field mono', maxlength: 4, autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', required: true });
  const go = h('button', { type: 'submit', class: 'btn primary xl' }, 'I wrote it down. Finish setup');
  const form = h('form', { class: 'gate-form', autocomplete: 'off' },
    h('div', { class: 'two' },
      h('label', { class: 'stack' }, h('span', { class: 'label' }, `Group ${ga}`), a),
      h('label', { class: 'stack' }, h('span', { class: 'label' }, `Group ${gb}`), b)),
    go);
  form.addEventListener('submit', busy(go, () => ctx.finishSetup([a.value, b.value])));
  return h('div', { class: 'gate' },
    h('div', { class: 'gate-words left' },
      h('h1', {}, 'Your recovery phrase'),
      h('p', { class: 'muted' }, 'Write it on paper, in order. It is the only way back in if you lose every device. It is not stored anywhere.')),
    h('ol', { class: 'phrase' }, groups.map((g) => h('li', {}, g))),
    h('p', { class: 'muted small' }, 'Type two groups from your paper to confirm.'),
    form);
}
