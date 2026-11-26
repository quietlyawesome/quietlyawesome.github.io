import { h, vars } from './dom.js';
import { header, iconButton, label, badge, moodVars, dot } from './parts.js';
import { TAG_COLORS, colorMap, kinds, byDate, weekStats, tagCounts, startOfWeek, addDays, ymd, parseYmd, isoWeek, monthName } from '../model.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function rangeLabel(start) {
  const end = addDays(start, 6);
  const a = `${monthName(start.getMonth()).slice(0, 3)} ${start.getDate()}`;
  const b = start.getMonth() === end.getMonth() ? String(end.getDate()) : `${monthName(end.getMonth()).slice(0, 3)} ${end.getDate()}`;
  return `${a} – ${b} · Week ${isoWeek(addDays(start, 1))}`;
}

export function weeklyView(ctx) {
  const ui = ctx.ui;
  const thisWeek = startOfWeek(new Date());
  const start = ui.week ? parseYmd(ui.week) : thisWeek;
  const key = ymd(start);
  const entries = kinds(ctx.items, 'entry');
  const stats = weekStats(byDate(entries), start);
  const weekEntries = entries.filter((x) => stats.days.some((d) => d.ymd === x.payload.date));
  const summary = kinds(ctx.items, 'summary')
    .filter((x) => x.payload.week === key)
    .sort((a, b) => (a.payload.created < b.payload.created ? 1 : -1))[0];

  const shift = (k) => {
    ui.week = ymd(addDays(start, 7 * k));
    ctx.render();
  };
  const head = header({
    eyebrow: rangeLabel(start),
    title: key === ymd(thisWeek) ? 'Your week' : 'That week',
    section: 'week',
    actions: [
      iconButton('left', 'Previous week', () => shift(-1)),
      Object.assign(iconButton('right', 'Next week', () => shift(1)), { disabled: key >= ymd(thisWeek) }),
    ],
  });

  const avg = stats.avg == null ? null : stats.avg;
  const avgBadge = avg == null ? h('span', { class: 'badge lg muted-badge' }, '–') : badge(Math.round(avg), 'lg');
  if (avg != null) avgBadge.textContent = avg.toFixed(1);
  const bars = h('div', { class: 'bars' }, stats.days.map((d, i) => {
    const el = h('div', { class: `bar ${d.mood ? 'has' : 'none'}`, role: 'img', 'aria-label': `${DAYS[i]}, ${d.mood ? `mood ${d.mood}` : 'no entry'}` });
    if (d.mood) {
      moodVars(el, d.mood);
      el.style.setProperty('--h', `${d.mood * 10}%`);
    }
    return el;
  }));
  const moodCard = h('section', { class: 'card week-card', 'aria-label': 'Mood this week' },
    h('div', { class: 'week-top' },
      h('div', { class: 'week-avg' }, avgBadge, h('span', { class: 'muted' }, 'avg mood')),
      h('span', { class: 'muted small' }, `${stats.count} of 7 days written`)),
    bars,
    h('div', { class: 'bar-days', 'aria-hidden': 'true' }, DAYS.map((d) => h('span', {}, d[0]))));

  const p = summary && summary.payload;
  const summaryBox = h('section', { class: 'stack' },
    label('Summary', h('span', { class: 'hint' }, '· by Claude on your Mac')),
    p && p.text
      ? h('p', { class: 'prose' }, p.text)
      : h('p', { class: 'prose muted' }, 'Claude writes this every Sunday night on your Mac, only from entries you allow it to read.'));

  const themes = p && Array.isArray(p.themes) && p.themes.length ? p.themes.map((t) => ({ name: String(t.name), count: Number(t.count) || 0 })) : tagCounts(weekEntries);
  const colors = colorMap(themes.map((t) => t.name), TAG_COLORS);
  const themeBox = themes.length
    ? h('section', { class: 'stack' },
      label(p && p.themes ? 'Themes' : 'Tags this week'),
      h('div', { class: 'chips' }, themes.map((t) => vars(h('span', { class: 'chip' }, dot(colors.get(t.name)), t.name, h('b', {}, String(t.count))), { '--c': colors.get(t.name) }))))
    : null;

  const question = p && p.question
    ? h('section', { class: 'question' }, h('h2', { class: 'label accent' }, 'A question for you'), h('p', { class: 'prose' }, p.question))
    : null;

  return h('div', { class: 'view-weekly' }, head, moodCard, summaryBox, themeBox, question);
}
