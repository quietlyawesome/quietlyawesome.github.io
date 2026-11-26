import { h, vars } from './dom.js';
import { header, label, moodVars, dot, empty } from './parts.js';
import { TAG_COLORS, colorMap, kinds, ymd, parseYmd, shortDate, streaks, wordStats, weeklyTrend, moodByWeekday, moodByTag, coverage } from '../model.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function tile(value, caption) {
  return h('div', { class: 'tile' }, h('span', { class: 'tile-value' }, value), h('span', { class: 'tile-caption' }, caption));
}

function columns(points, ariaLabel) {
  return h('div', { class: 'cols', role: 'list', 'aria-label': ariaLabel },
    points.map((p) => {
      const col = h('div', { class: 'col', role: 'listitem', 'aria-label': p.label, title: p.label, tabindex: '0' },
        h('span', { class: 'col-value' }, p.avg == null ? '' : p.avg.toFixed(1)),
        h('span', { class: `col-bar ${p.avg == null ? 'none' : 'has'}` }),
        h('span', { class: 'col-name', 'aria-hidden': 'true' }, p.name));
      if (p.avg != null) {
        moodVars(col, Math.round(p.avg));
        col.style.setProperty('--h', `${Math.max(4, p.avg * 10)}%`);
      }
      return col;
    }));
}

export function statsView(ctx) {
  const now = new Date();
  const today = ymd(now);
  const entries = kinds(ctx.items, 'entry');
  const memories = kinds(ctx.items, 'memory');
  const st = streaks(entries, today);
  const words = wordStats(ctx.items, today.slice(0, 7));
  const trend = weeklyTrend(entries, today, 12);
  const weekday = moodByWeekday(entries);
  const tags = moodByTag(entries);
  const cov = coverage(memories, now.getFullYear());
  const tagColors = colorMap(tags.map((t) => t.name), TAG_COLORS);
  const n = (x) => x.toLocaleString('en-US');

  const trendPoints = trend.map((w, i) => {
    const d = parseYmd(w.start);
    return { avg: w.avg, name: (trend.length - 1 - i) % 3 === 0 ? `${d.getMonth() + 1}/${d.getDate()}` : '', label: `Week of ${shortDate(d)}: ${w.avg == null ? 'no entries' : `average mood ${w.avg.toFixed(1)}, ${w.count} entr${w.count === 1 ? 'y' : 'ies'}`}` };
  });
  const weekdayPoints = weekday.map((w, i) => ({ avg: w.avg, name: DAYS[i][0], label: `${DAYS[i]}: ${w.avg == null ? 'no entries' : `average mood ${w.avg.toFixed(1)} over ${w.count}`}` }));

  const tagRows = tags.length
    ? h('div', { class: 'hbars' }, tags.map((t) => {
      const row = h('div', { class: 'hbar', title: `${t.name}: average mood ${t.avg.toFixed(1)} over ${t.count} entries` },
        h('span', { class: 'hbar-name' }, dot(tagColors.get(t.name)), t.name),
        h('span', { class: 'hbar-track' }, moodVars(h('span', { class: 'hbar-fill' }), Math.round(t.avg))),
        h('span', { class: 'hbar-value' }, t.avg.toFixed(1)));
      row.querySelector('.hbar-fill').style.setProperty('--w', `${t.avg * 10}%`);
      return row;
    }))
    : empty('Tag at least two entries with the same tag to compare moods.');

  const years = h('div', { class: 'year-strip', 'aria-label': `${cov.covered} of ${cov.total} years have memories` },
    cov.years.map((y) => vars(h('span', { class: `ys ${y.count ? 'has' : ''}`, title: `${y.year}: ${y.count} memor${y.count === 1 ? 'y' : 'ies'}` }), { '--c': 'var(--c-past)' })));

  return h('div', { class: 'view-stats' },
    header({ eyebrow: 'Computed on this device', title: 'Stats', section: 'week' }),
    entries.length || memories.length ? null : empty('Stats appear once you have written a few entries.'),
    h('section', { class: 'tiles' },
      tile(String(st.current), 'day streak'),
      tile(String(st.longest), 'longest streak'),
      tile(n(st.days), 'days written'),
      tile(n(words.total), 'words in total'),
      tile(n(words.month), 'words this month'),
      tile(n(words.perEntry), 'words per entry')),
    h('section', { class: 'card stack' }, label('Mood, last 12 weeks', h('span', { class: 'hint' }, 'weekly average')), columns(trendPoints, 'Average mood per week')),
    h('section', { class: 'card stack' }, label('Mood by weekday'), columns(weekdayPoints, 'Average mood per weekday')),
    h('section', { class: 'card stack' }, label('Mood by tag', h('span', { class: 'hint' }, 'average, 1–10')), tagRows),
    h('section', { class: 'card stack' },
      label('Year coverage', h('span', { class: 'hint' }, `${cov.covered} of ${cov.total} years`)),
      years,
      h('p', { class: 'muted small' }, `${cov.from} – ${cov.to}. Filled years have at least one memory in Memory-Bound.`)));
}
