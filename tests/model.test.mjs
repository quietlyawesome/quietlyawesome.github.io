import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../js/model.js';

const entry = (date, mood, tags = []) => ({ path: date, payload: { kind: 'entry', date, mood, tags, text: `t ${date}` } });
const memory = (when, chapter) => ({ path: String(when.value), payload: { kind: 'memory', when, chapter, text: 'm' } });

test('mood clamps and rounds', () => {
  assert.equal(m.mood(7).word, 'Good');
  assert.equal(m.mood(0).n, 1);
  assert.equal(m.mood(42).n, 10);
  assert.equal(m.mood(6.5).n, 7);
});

test('colorMap keeps fixed colors and gives new names unused ones', () => {
  const map = m.colorMap(['work', 'zen', 'art'], m.TAG_COLORS);
  assert.equal(map.get('work'), '#4F8CF0');
  assert.notEqual(map.get('zen'), '#4F8CF0');
  assert.notEqual(map.get('zen'), map.get('art'));
});

test('month cells start on the right weekday and mark today/future', () => {
  const dates = m.byDate([entry('2026-11-03', 4), entry('2026-11-03', 8), entry('2026-11-20', 9)]);
  const cells = m.monthCells(2026, 10, dates, '2026-11-25');
  assert.equal(cells.filter((c) => c === null).length, 0);
  const real = cells.filter(Boolean);
  assert.equal(real.length, 30);
  assert.equal(real[2].mood, 6);
  assert.equal(real[2].count, 2);
  assert.equal(real[24].today, true);
  assert.equal(real[25].future, true);
  const dec = m.monthCells(2026, 11, dates, '2026-11-25');
  assert.equal(dec.filter((c) => c === null).length, 2);
});

test('week stats from Sunday', () => {
  const start = m.startOfWeek(m.parseYmd('2026-11-25'));
  assert.equal(m.ymd(start), '2026-11-22');
  const s = m.weekStats(m.byDate([entry('2026-11-22', 8), entry('2026-11-24', 6), entry('2026-11-30', 1)]), start);
  assert.equal(s.count, 2);
  assert.equal(s.avg, 7);
  assert.equal(s.days[1].mood, null);
  assert.equal(m.isoWeek(m.parseYmd('2026-11-23')), 48);
});

test('tag counts sorted', () => {
  assert.deepEqual(m.tagCounts([entry('a', 1, ['gym', 'work']), entry('b', 1, ['work'])]), [{ name: 'work', count: 2 }, { name: 'gym', count: 1 }]);
});

test('year grid covers memories and the last 7 years, no hardcoded start', () => {
  const g0 = m.yearGrid([], 2026);
  assert.equal(g0.from, 2020);
  assert.equal(g0.years.length, 7);
  const mems = [memory({ precision: 'year', value: '2010' }, 'School'), memory({ precision: 'date', value: '2010-05-02' }, 'School'), memory({ precision: 'age', value: '7' }, 'Childhood'), memory({ precision: 'month', value: '2024-03' }, 'Now')];
  const g = m.yearGrid(mems, 2026);
  assert.equal(g.from, 2010);
  assert.equal(g.years[0].count, 2);
  assert.equal(g.years[0].chapter, 'School');
  const chapters = m.chapterList(mems);
  assert.deepEqual(chapters.map((c) => [c.name, c.from, c.count]), [['School', 2010, 2], ['Now', 2024, 1], ['Childhood', null, 1]]);
  assert.equal(m.spanLabel(chapters[0], 2026), '2010');
  assert.equal(m.whenLabel({ precision: 'month', value: '2024-03' }), 'March 2024');
  assert.equal(m.whenLabel({ precision: 'age', value: '7' }), 'Age 7');
});

test('search looks at text, tags and memory fields', () => {
  const items = [entry('2026-01-01', 5, ['gym']), memory({ precision: 'year', value: '2001' }, 'School')];
  items[1].payload.place = 'Lake house';
  assert.equal(m.search(items, 'GYM').length, 1);
  assert.equal(m.search(items, 'lake').length, 1);
  assert.equal(m.search(items, '').length, 2);
});

test('daily mark shows all four every 4 days, never twice in a row', () => {
  const seen = [];
  for (let i = 0; i < 400; i++) seen.push(m.dailyMark(new Date(2026, 0, 1 + i, 12)));
  for (let i = 1; i < seen.length; i++) assert.notEqual(seen[i], seen[i - 1]);
  const day0 = Math.floor(Date.UTC(2026, 0, 1) / 86400000);
  const offset = (4 - (day0 % 4)) % 4;
  for (let i = offset; i + 4 <= seen.length; i += 4) assert.equal(new Set(seen.slice(i, i + 4)).size, 4);
  assert.equal(m.dailyMark(new Date(2026, 5, 1, 1)), m.dailyMark(new Date(2026, 5, 1, 23)));
});
