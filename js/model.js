export const MOODS = [
  { n: 1, word: 'Awful', fill: '#5145C9', ink: '#FFFFFF' },
  { n: 2, word: 'Very low', fill: '#6A5BE2', ink: '#FFFFFF' },
  { n: 3, word: 'Low', fill: '#4F8CF0', ink: '#0B1020' },
  { n: 4, word: 'Meh', fill: '#2FB3C9', ink: '#0B1020' },
  { n: 5, word: 'Okay', fill: '#2DBE9A', ink: '#0B1020' },
  { n: 6, word: 'Fine', fill: '#6FCF6A', ink: '#0B1020' },
  { n: 7, word: 'Good', fill: '#B8DB4A', ink: '#0B1020' },
  { n: 8, word: 'Very good', fill: '#F5C542', ink: '#1A1300' },
  { n: 9, word: 'Great', fill: '#FF9F43', ink: '#1A0E00' },
  { n: 10, word: 'Amazing', fill: '#FF6B8A', ink: '#1A0008' },
];

export const TAG_COLORS = { work: '#4F8CF0', gym: '#2DBE9A', family: '#FF9F43', friends: '#FF6B8A', health: '#2FB3C9', reading: '#9B8CFF' };
export const CHAPTER_COLORS = { Childhood: '#FF9F43', School: '#2DBE9A', College: '#4F8CF0', 'Grad school': '#9B8CFF', Now: '#FF6B8A' };
export const STARTER_TAGS = Object.keys(TAG_COLORS);
export const STARTER_CHAPTERS = Object.keys(CHAPTER_COLORS);
export const MARKS = ['dial', 'carry', 'loops', 'die'];
export const PRECISIONS = ['date', 'month', 'year', 'age'];

const DAY = 86400000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function mood(n) {
  const x = Number(n);
  const i = Number.isFinite(x) ? Math.min(10, Math.max(1, Math.round(x))) : 5;
  return MOODS[i - 1];
}

export function colorMap(names, fixed) {
  const map = new Map();
  const used = new Set();
  for (const n of names) {
    if (fixed[n] && !map.has(n)) {
      map.set(n, fixed[n]);
      used.add(fixed[n]);
    }
  }
  const spare = MOODS.map((m) => m.fill).filter((c) => !used.has(c));
  let i = 0;
  for (const n of names) {
    if (map.has(n)) continue;
    map.set(n, spare.length ? spare[i % spare.length] : MOODS[i % 10].fill);
    i++;
  }
  return map;
}

const pad2 = (n) => String(n).padStart(2, '0');

export function ymd(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function parseYmd(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12);
}

export function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12);
  return x;
}

export function startOfWeek(d) {
  return addDays(d, -d.getDay());
}

export function longDate(d) {
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
}

export function fullDate(d) {
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function shortDate(d) {
  return `${WEEKDAYS[d.getDay()].slice(0, 3)}, ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
}

export function monthName(m) {
  return MONTHS[m];
}

export function timeLabel(d) {
  const h = d.getHours() % 12 || 12;
  return `${h}:${pad2(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
}

export function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / DAY + 1) / 7);
}

export function kinds(items, kind) {
  return items.filter((x) => x.payload && x.payload.kind === kind);
}

export function byDate(entries) {
  const map = new Map();
  for (const x of entries) {
    const k = x.payload.date;
    if (!k) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(x);
  }
  return map;
}

export function dayMood(list) {
  const ms = (list || []).map((x) => Number(x.payload.mood)).filter((m) => m >= 1 && m <= 10);
  if (!ms.length) return null;
  return Math.round(ms.reduce((a, b) => a + b, 0) / ms.length);
}

export function monthCells(year, month, dates, today) {
  const first = new Date(year, month, 1, 12);
  const days = new Date(year, month + 1, 0).getDate();
  const cells = Array.from({ length: first.getDay() }, () => null);
  for (let n = 1; n <= days; n++) {
    const k = `${year}-${pad2(month + 1)}-${pad2(n)}`;
    const list = dates.get(k) || [];
    cells.push({ ymd: k, n, mood: dayMood(list), count: list.length, future: k > today, today: k === today });
  }
  return cells;
}

export function weekStats(dates, start) {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const k = ymd(addDays(start, i));
    days.push({ ymd: k, mood: dayMood(dates.get(k)) });
  }
  const ms = days.map((d) => d.mood).filter((m) => m != null);
  const avg = ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : null;
  return { days, avg, count: ms.length };
}

export function tagCounts(entries) {
  const counts = new Map();
  for (const x of entries) for (const t of x.payload.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function knownNames(starter, used) {
  const out = [...starter];
  for (const n of used) if (n && !out.includes(n)) out.push(n);
  return out;
}

export function memoryYear(when) {
  if (!when || when.precision === 'age') return null;
  const y = parseInt(String(when.value || '').slice(0, 4), 10);
  return y >= 1000 && y <= 9999 ? y : null;
}

export function whenLabel(when) {
  if (!when || !when.value) return 'Undated';
  if (when.precision === 'age') return `Age ${when.value}`;
  if (when.precision === 'date') return shortDate(parseYmd(when.value)) + ', ' + String(when.value).slice(0, 4);
  if (when.precision === 'month') {
    const [y, m] = String(when.value).split('-').map(Number);
    return `${MONTHS[(m || 1) - 1]} ${y}`;
  }
  return String(when.value);
}

export function memorySortKey(p) {
  const y = memoryYear(p.when);
  return y ? String(p.when.value) : '';
}

export function yearGrid(memories, nowYear, span = 7) {
  const counts = new Map();
  const chapterVotes = new Map();
  for (const x of memories) {
    const y = memoryYear(x.payload.when);
    if (!y) continue;
    counts.set(y, (counts.get(y) || 0) + 1);
    const ch = x.payload.chapter || '';
    if (!chapterVotes.has(y)) chapterVotes.set(y, new Map());
    const v = chapterVotes.get(y);
    v.set(ch, (v.get(ch) || 0) + 1);
  }
  const from = Math.min(nowYear - span + 1, ...counts.keys());
  const to = Math.max(nowYear, ...counts.keys());
  const years = [];
  for (let y = from; y <= to; y++) {
    const v = chapterVotes.get(y);
    const chapter = v ? [...v].sort((a, b) => b[1] - a[1])[0][0] : '';
    years.push({ year: y, count: counts.get(y) || 0, chapter });
  }
  return { from, to, years };
}

export function chapterList(memories) {
  const map = new Map();
  for (const x of memories) {
    const name = x.payload.chapter;
    if (!name) continue;
    const c = map.get(name) || { name, from: null, to: null, count: 0 };
    c.count++;
    const y = memoryYear(x.payload.when);
    if (y) {
      c.from = c.from == null ? y : Math.min(c.from, y);
      c.to = c.to == null ? y : Math.max(c.to, y);
    }
    map.set(name, c);
  }
  return [...map.values()].sort((a, b) => (a.from ?? 99999) - (b.from ?? 99999) || a.name.localeCompare(b.name));
}

export function spanLabel(c, nowYear) {
  if (c.from == null) return 'Undated';
  if (c.to === nowYear && c.from !== nowYear) return `${c.from} –`;
  return c.from === c.to ? String(c.from) : `${c.from} – ${c.to}`;
}

export function search(items, q) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return items;
  return items.filter((x) => {
    const p = x.payload;
    const hay = [p.text, p.chapter, p.people, p.place, ...(p.tags || [])].filter(Boolean).join('\n').toLowerCase();
    return hay.includes(s);
  });
}

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function cycleOrder(cycle) {
  const order = [0, 1, 2, 3];
  const r = rng(Math.imul(cycle + 1, 2654435761));
  for (let i = 3; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

export function dailyMark(d = new Date()) {
  const day = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
  const cycle = Math.floor(day / 4);
  const order = cycleOrder(cycle);
  const prev = cycleOrder(cycle - 1);
  if (order[0] === prev[3]) [order[0], order[1]] = [order[1], order[0]];
  return MARKS[order[day % 4]];
}
