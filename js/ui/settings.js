import { h } from './dom.js';
import { icon } from './icons.js';
import { header, label, segmented } from './parts.js';

export function settingsView(ctx) {
  const copy = h('button', { type: 'button', class: 'btn secondary' }, icon('copy', 18), 'Copy token for another device');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(ctx.session.token());
      ctx.toast('Token copied. Paste it on your other device within 2 minutes.');
    } catch (e) {
      ctx.toast(ctx.readable(e), true);
    }
  });
  const forget = h('button', { type: 'button', class: 'btn danger' }, 'Forget this device');
  forget.addEventListener('click', () => ctx.forget());

  return h('div', { class: 'view-settings' },
    header({ eyebrow: 'Odometer', title: 'Settings', section: 'write' }),
    h('section', { class: 'stack' },
      label('Appearance'),
      segmented('Appearance', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], ctx.themePref, (v) => ctx.setTheme(v))),
    h('section', { class: 'stack' },
      label('Your writing'),
      h('a', { class: 'btn secondary', href: '#/stats' }, icon('chart', 18), 'Stats'),
      h('a', { class: 'btn secondary', href: '#/export' }, icon('download', 18), 'Export to PDF or Markdown')),
    h('section', { class: 'stack' },
      label('This device'),
      h('p', { class: 'muted' }, `Data repository: ${ctx.session ? ctx.session.repoName() : '–'}`),
      copy,
      h('button', { type: 'button', class: 'btn secondary', onclick: () => ctx.lock() }, icon('lock', 18), 'Lock now'),
      h('p', { class: 'muted small' }, 'Odometer locks itself after 5 minutes without activity.')),
    h('section', { class: 'stack' },
      label('Remove'),
      forget,
      h('p', { class: 'muted small' }, 'Removes the saved token and cache from this device only. Your entries stay in GitHub, encrypted.')),
    h('p', { class: 'foot' }, icon('shield', 14, 2), 'End-to-end encrypted · AES-256-GCM · passkey'));
}
