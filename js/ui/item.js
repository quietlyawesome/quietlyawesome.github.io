import { h } from './dom.js';
import { icon } from './icons.js';
import { header, badge, tagLine, itemTitle, empty } from './parts.js';
import { TAG_COLORS, colorMap, mood, longDate, parseYmd, whenLabel } from '../model.js';

export function itemView(ctx, path) {
  const x = ctx.items.find((i) => i.path === path);
  const back = h('div', { class: 'back-row' },
    h('a', { class: 'back', href: '#/timeline', onclick: (e) => {
      if (history.length > 1) {
        e.preventDefault();
        history.back();
      }
    } }, icon('left', 18, 2), 'Back'));
  if (!x) return h('div', { class: 'view-item' }, back, empty('This item is not loaded yet.'));
  const p = x.payload;
  const colors = colorMap(p.tags || [], TAG_COLORS);
  let head;
  let meta = [];
  if (p.kind === 'memory') {
    head = header({ eyebrow: p.chapter ? `Memory-Bound · ${p.chapter}` : 'Memory-Bound', title: whenLabel(p.when), section: 'past' });
    meta = [p.people && `With ${p.people}`, p.place && `At ${p.place}`, p.split && 'Marked for splitting', p.analyze === false && 'Never sent to Claude'].filter(Boolean);
  } else if (p.kind === 'summary') {
    head = header({ eyebrow: 'Weekly', title: itemTitle(p), section: 'week' });
  } else {
    head = header({ eyebrow: longDate(parseYmd(p.date)), title: mood(p.mood).word, section: 'time', actions: p.mood ? [badge(p.mood, 'lg')] : [] });
    meta = [p.analyze === false && 'Never sent to Claude'].filter(Boolean);
  }
  return h('article', { class: 'view-item' },
    back,
    head,
    tagLine(p.tags, colors),
    meta.length ? h('p', { class: 'muted small' }, meta.join(' · ')) : null,
    h('div', { class: 'prose full' }, p.text || ''));
}
