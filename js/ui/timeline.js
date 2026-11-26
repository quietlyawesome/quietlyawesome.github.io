import { h } from './dom.js';
import { icon } from './icons.js';
import { header, iconButton, label, moodVars, itemCard, empty } from './parts.js';
import { MOODS, TAG_COLORS, colorMap, knownNames, STARTER_TAGS, kinds, byDate, monthCells, monthName, search, ymd, parseYmd, longDate } from '../model.js';

const WD = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function timelineView(ctx) {
  const ui = ctx.ui;
  const now = new Date();
  const today = ymd(now);
  if (!ui.month) ui.month = { y: now.getFullYear(), m: now.getMonth() };
  const { y, m } = ui.month;
  const entries = kinds(ctx.items, 'entry');
  const dates = byDate(entries);
  const prefix = `${y}-${String(m + 1).padStart(2, '0')}`;
  const inMonth = entries.filter((x) => (x.payload.date || '').startsWith(prefix));
  const colors = colorMap(knownNames(STARTER_TAGS, entries.flatMap((x) => x.payload.tags || [])), TAG_COLORS);

  const shift = (k) => {
    const d = new Date(y, m + k, 1);
    ui.month = { y: d.getFullYear(), m: d.getMonth() };
    ui.day = null;
    ctx.render();
  };
  const isCurrent = y === now.getFullYear() && m === now.getMonth();

  const head = header({
    eyebrow: `${y} · ${inMonth.length} ${inMonth.length === 1 ? 'entry' : 'entries'}`,
    title: monthName(m),
    section: 'time',
    actions: [
      iconButton('left', 'Previous month', () => shift(-1)),
      Object.assign(iconButton('right', 'Next month', () => shift(1)), { disabled: isCurrent }),
    ],
  });

  const q = h('input', { type: 'search', class: 'search-input', placeholder: 'Search entries and memories', 'aria-label': 'Search entries and memories', value: ui.query || '' });
  const searchBox = h('label', { class: 'search' }, icon('search', 18, 2), q);

  const grid = h('div', { class: 'cal' });
  for (const c of monthCells(y, m, dates, today)) {
    if (!c) {
      grid.append(h('span', { class: 'cal-pad', 'aria-hidden': 'true' }));
      continue;
    }
    const state = c.mood ? 'has' : c.future ? 'future' : 'none';
    const lbl = `${monthName(m)} ${c.n}` + (c.mood ? `, mood ${c.mood}${c.count > 1 ? `, ${c.count} entries` : ''}` : c.future ? '' : ', no entry');
    const b = h('button', { type: 'button', class: `cal-cell ${state}${c.today ? ' today' : ''}`, 'aria-label': lbl, 'aria-pressed': ui.day === c.ymd, disabled: c.future }, String(c.n));
    if (c.mood) moodVars(b, c.mood);
    b.addEventListener('click', () => {
      if (!c.count) {
        ctx.drafts.entry = { ...(ctx.drafts.entry || { text: '', mood: 5, tags: [] }), date: c.ymd === today ? null : c.ymd };
        ctx.saveDraftSoon('entry');
        ctx.go('write');
        return;
      }
      ui.day = ui.day === c.ymd ? null : c.ymd;
      for (const el of grid.querySelectorAll('.cal-cell')) el.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-pressed', String(ui.day === c.ymd));
      paintList();
    });
    grid.append(b);
  }

  const legend = h('div', { class: 'legend' },
    h('span', {}, 'Low'),
    h('span', { class: 'legend-scale', 'aria-hidden': 'true' }, MOODS.map((mm) => moodVars(h('span'), mm.n))),
    h('span', {}, 'Great'),
    h('span', { class: 'legend-none' }, h('span', { class: 'legend-box', 'aria-hidden': 'true' }), 'No entry'));

  const listHead = h('div');
  const list = h('div', { class: 'cards' });
  function paintList() {
    const query = (ui.query || '').trim();
    let items;
    let title;
    if (query) {
      items = search(ctx.items.filter((x) => x.payload.kind !== 'summary'), query);
      title = `${items.length} found for “${query}”`;
    } else if (ui.day) {
      items = dates.get(ui.day) || [];
      title = longDate(parseYmd(ui.day));
    } else {
      items = inMonth;
      title = 'Entries';
    }
    listHead.replaceChildren(label(title));
    list.replaceChildren(...(items.length ? items.map((x) => itemCard(x, colors)) : [empty(query ? 'Nothing matches.' : 'No entries this month yet. Tap an empty day to write for it.')]));
  }
  q.addEventListener('input', () => {
    ui.query = q.value;
    paintList();
  });
  paintList();

  return h('div', { class: 'view-timeline' },
    head,
    searchBox,
    h('section', { class: 'cal-wrap', 'aria-label': 'Mood calendar' },
      h('div', { class: 'cal-head', 'aria-hidden': 'true' }, WD.map((d) => h('span', {}, d))),
      grid,
      legend),
    h('section', { class: 'list' }, listHead, list));
}
