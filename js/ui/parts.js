import { h, vars } from './dom.js';
import { icon } from './icons.js';
import { mood, shortDate, parseYmd, ymd, whenLabel } from '../model.js';

export function header({ eyebrow, title, section, actions = [], level = 'h1' }) {
  return h('header', { class: 'vh' },
    h('div', { class: 'vh-text' },
      eyebrow ? h('span', { class: `eyebrow c-${section}` }, eyebrow) : null,
      h(level, { class: 'vh-title' }, title)),
    actions.length ? h('div', { class: 'vh-actions' }, actions) : null);
}

export function iconButton(name, label, onclick, extra = '') {
  return h('button', { type: 'button', class: `icon-btn ${extra}`, 'aria-label': label, title: label, onclick }, icon(name, 18));
}

export function label(text, aside) {
  return h('div', { class: 'label-row' }, h('h2', { class: 'label' }, text), aside || null);
}

export function moodVars(el, n) {
  const m = mood(n);
  return vars(el, { '--m': m.fill, '--m-ink': m.ink });
}

export function badge(n, size = '') {
  return moodVars(h('span', { class: `badge ${size}`, 'aria-label': `mood ${mood(n).n} of 10` }, String(mood(n).n)), n);
}

export function dot(color, size = 8) {
  return vars(h('span', { class: 'dot', 'aria-hidden': 'true' }), { '--c': color, '--s': `${size}px` });
}

export function pill(name, color, on, onclick) {
  return vars(h('button', { type: 'button', class: 'pill', 'aria-pressed': !!on, onclick }, dot(color), name), { '--c': color });
}

export function addPill(text, onAdd) {
  const btn = h('button', { type: 'button', class: 'pill add' }, `+ ${text}`);
  btn.addEventListener('click', () => {
    const input = h('input', { class: 'pill-input', 'aria-label': `New ${text.toLowerCase()}`, maxlength: 24, autocapitalize: 'off' });
    const done = (keep) => {
      const v = input.value.trim();
      input.replaceWith(btn);
      if (keep && v) onAdd(v);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        done(true);
      } else if (e.key === 'Escape') done(false);
    });
    input.addEventListener('blur', () => done(true));
    btn.replaceWith(input);
    input.focus();
  });
  return btn;
}

export function tagLine(tags, colors) {
  if (!tags || !tags.length) return null;
  return h('div', { class: 'tag-line' }, tags.map((t) => h('span', { class: 'tag' }, dot(colors.get(t) || '#9B8CFF'), t)));
}

export function itemTitle(p, today = ymd(new Date())) {
  if (p.kind === 'memory') return [whenLabel(p.when), p.chapter].filter(Boolean).join(' · ');
  if (p.kind === 'summary') return `Week of ${shortDate(parseYmd(p.week))}`;
  return shortDate(parseYmd(p.date)) + (p.date === today ? ' · Today' : '');
}

export function itemCard(x, colors) {
  const p = x.payload;
  return h('a', { class: `card item-card kind-${p.kind}`, href: `#/item/${encodeURIComponent(x.path)}` },
    h('div', { class: 'card-top' },
      h('span', { class: 'card-date' }, itemTitle(p)),
      p.kind === 'entry' && p.mood ? badge(p.mood) : null),
    h('p', { class: 'card-text' }, p.text || ''),
    tagLine(p.tags, colors));
}

export function segmented(groupLabel, options, value, onpick) {
  const group = h('div', { class: 'seg', role: 'group', 'aria-label': groupLabel });
  const paint = (v) => {
    for (const b of group.children) b.setAttribute('aria-pressed', String(b.dataset.v === v));
  };
  for (const [v, text] of options) {
    const b = h('button', { type: 'button', 'data-v': v }, text);
    b.addEventListener('click', () => {
      paint(v);
      onpick(v);
    });
    group.append(b);
  }
  paint(value);
  return group;
}

export function toggleRow(title, sub, checked, onchange) {
  const input = h('input', { type: 'checkbox', class: 'switch' });
  input.checked = !!checked;
  input.addEventListener('change', () => onchange(input.checked));
  return h('label', { class: 'toggle-row' },
    h('span', { class: 'toggle-text' }, h('span', { class: 'toggle-title' }, title), h('span', { class: 'toggle-sub' }, sub)),
    input);
}

export function empty(text) {
  return h('p', { class: 'empty' }, text);
}
