import { h, vars } from './dom.js';
import { icon } from './icons.js';
import { header, label, dot, pill, addPill, itemCard, segmented, toggleRow, empty } from './parts.js';
import { CHAPTER_COLORS, STARTER_CHAPTERS, TAG_COLORS, colorMap, knownNames, kinds, yearGrid, chapterList, spanLabel, memoryYear, memorySortKey, PRECISIONS } from '../model.js';
import { newMemory } from '../vault.js';

const ALPHA = [0, 18, 25, 32, 40, 50];

function chapterColors(memories) {
  return colorMap(knownNames(STARTER_CHAPTERS, memories.map((x) => x.payload.chapter)), CHAPTER_COLORS);
}

export function pastView(ctx) {
  const ui = ctx.ui;
  const nowYear = new Date().getFullYear();
  const memories = kinds(ctx.items, 'memory');
  const colors = chapterColors(memories);
  const grid = yearGrid(memories, nowYear);
  const chapters = chapterList(memories);
  const tagColors = colorMap([], TAG_COLORS);

  const head = header({
    eyebrow: `${grid.from} – ${grid.to} · ${memories.length} ${memories.length === 1 ? 'memory' : 'memories'} so far`,
    title: 'Memory-Bound',
    section: 'past',
  });

  const actions = h('div', { class: 'past-actions' },
    h('a', { class: 'btn primary grow', href: '#/memory' }, icon('plus', 18, 2.2), 'Add a memory'),
    h('a', { class: 'icon-btn lg', href: '#/memory/dictate', 'aria-label': 'Add a memory by dictation', title: 'Dictate a memory' }, icon('mic', 20)));

  const list = h('div', { class: 'cards' });
  const listHead = h('div');
  const yearsBox = h('div', { class: 'years' });
  const chaptersBox = h('div', { class: 'chapters' });

  function paint() {
    yearsBox.replaceChildren(...grid.years.map((yr) => {
      const color = colors.get(yr.chapter) || 'var(--accent)';
      const lbl = `${yr.year}${yr.chapter ? `, ${yr.chapter}` : ''}, ${yr.count ? `${yr.count} ${yr.count === 1 ? 'memory' : 'memories'}` : 'no memories yet'}`;
      const b = h('button', { type: 'button', class: `year ${yr.count ? 'has' : 'open'}`, 'aria-label': lbl, 'aria-pressed': ui.year === yr.year }, `'${String(yr.year).slice(2)}`);
      vars(b, { '--c': color, '--a': `${ALPHA[Math.min(yr.count, 5)]}%` });
      b.addEventListener('click', () => {
        ui.year = ui.year === yr.year ? null : yr.year;
        ui.chapter = null;
        paint();
      });
      return b;
    }));
    chaptersBox.replaceChildren(...(chapters.length
      ? chapters.map((c) => h('button', { type: 'button', class: 'chapter', 'aria-pressed': ui.chapter === c.name, onclick: () => {
        ui.chapter = ui.chapter === c.name ? null : c.name;
        ui.year = null;
        paint();
      } },
      dot(colors.get(c.name), 12),
      h('span', { class: 'chapter-text' }, h('span', { class: 'chapter-name' }, c.name), h('span', { class: 'chapter-span' }, spanLabel(c, nowYear))),
      h('span', { class: 'chapter-count' }, String(c.count)),
      icon('right', 16, 2)))
      : [empty('Chapters appear as you add memories.')]));

    let shown = memories;
    let title = 'Recent memories';
    if (ui.year) {
      shown = memories.filter((x) => memoryYear(x.payload.when) === ui.year);
      title = String(ui.year);
    } else if (ui.chapter) {
      shown = memories.filter((x) => x.payload.chapter === ui.chapter);
      title = ui.chapter;
    }
    shown = [...shown].sort((a, b) => (memorySortKey(a.payload) < memorySortKey(b.payload) ? 1 : -1));
    if (!ui.year && !ui.chapter) shown = shown.slice(0, 20);
    listHead.replaceChildren(label(title));
    list.replaceChildren(...(shown.length ? shown.map((x) => itemCard(x, tagColors)) : [empty(memories.length ? 'No memories here yet.' : 'Your story starts with one memory. Any year, any age.')]));
  }
  paint();

  return h('div', { class: 'view-past' },
    head,
    actions,
    h('section', { class: 'card years-card', 'aria-label': 'Memories by year' },
      label('By year', h('span', { class: 'hint' }, 'Color = chapter · dashed = open')),
      yearsBox),
    h('section', { class: 'list' }, label('Chapters'), chaptersBox),
    h('section', { class: 'list' }, listHead, list));
}

export function blankMemory() {
  return { precision: 'year', value: '', chapter: '', people: '', place: '', text: '', split: false, analyze: true };
}

const WHEN_INPUT = {
  date: { type: 'date', placeholder: 'YYYY-MM-DD' },
  month: { type: 'month', placeholder: 'YYYY-MM' },
  year: { type: 'number', placeholder: 'Year, e.g. 2013', inputmode: 'numeric', min: 1900 },
  age: { type: 'number', placeholder: 'How old were you? e.g. 7', inputmode: 'numeric', min: 0, max: 120 },
};

function validWhen(p, v, nowYear) {
  if (!v) return true;
  if (p === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (p === 'month') return /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
  if (p === 'year') return /^\d{4}$/.test(v) && Number(v) <= nowYear;
  return /^\d{1,3}$/.test(v) && Number(v) <= 120;
}

export function memoryView(ctx, arg) {
  const d = ctx.drafts.memory || (ctx.drafts.memory = blankMemory());
  const nowYear = new Date().getFullYear();
  const memories = kinds(ctx.items, 'memory');
  const persist = () => ctx.saveDraftSoon('memory');

  const saveBtn = h('button', { type: 'button', class: 'btn primary small' }, 'Save');
  const top = h('div', { class: 'back-row' },
    h('a', { class: 'back', href: '#/past' }, icon('left', 18, 2), 'Memory-Bound'),
    saveBtn);

  const whenInput = h('input', { class: 'field', 'aria-label': 'When it happened' });
  function paintWhen() {
    const spec = WHEN_INPUT[d.precision];
    for (const a of ['type', 'placeholder', 'inputmode', 'min', 'max']) {
      if (spec[a] != null) whenInput.setAttribute(a, String(spec[a]));
      else whenInput.removeAttribute(a);
    }
    if (d.precision === 'year') whenInput.setAttribute('max', String(nowYear));
    whenInput.value = d.value;
  }
  whenInput.addEventListener('input', () => {
    d.value = whenInput.value.trim();
    persist();
  });
  const seg = segmented('When', PRECISIONS.map((p) => [p, p[0].toUpperCase() + p.slice(1)]), d.precision, (p) => {
    d.precision = p;
    d.value = '';
    paintWhen();
    persist();
  });
  paintWhen();

  const chapterBox = h('div', { class: 'pills', role: 'group', 'aria-label': 'Chapter' });
  function paintChapters() {
    const names = knownNames(STARTER_CHAPTERS, [...memories.map((x) => x.payload.chapter), d.chapter]);
    const colors = colorMap(names, CHAPTER_COLORS);
    chapterBox.replaceChildren(
      ...names.map((n) => pill(n, colors.get(n), d.chapter === n, () => {
        d.chapter = d.chapter === n ? '' : n;
        paintChapters();
        persist();
      })),
      addPill('Chapter', (v) => {
        d.chapter = v;
        paintChapters();
        persist();
      }),
    );
  }
  paintChapters();

  const field = (key, placeholder, aria) => {
    const el = h('input', { class: 'field', placeholder, 'aria-label': aria, value: d[key] });
    el.addEventListener('input', () => {
      d[key] = el.value;
      persist();
    });
    return el;
  };

  const text = h('textarea', { class: 'writing', placeholder: 'Start anywhere. Ramble as long as you like.', 'aria-label': 'Memory' });
  text.value = d.text;
  text.addEventListener('input', () => {
    d.text = text.value;
    persist();
  });
  const dictate = h('button', { type: 'button', class: 'btn soft small' }, icon('mic', 16), 'Dictate');
  dictate.addEventListener('click', () => {
    text.focus();
    ctx.toast('Tap the mic on your keyboard to dictate.');
  });

  saveBtn.addEventListener('click', async () => {
    if (!d.text.trim()) {
      ctx.toast('Write the memory first.');
      text.focus();
      return;
    }
    if (!validWhen(d.precision, d.value, nowYear)) {
      ctx.toast(`That ${d.precision} doesn’t look right.`, true);
      whenInput.focus();
      return;
    }
    saveBtn.disabled = true;
    try {
      const when = d.value ? { precision: d.precision, value: d.value } : null;
      await ctx.save(newMemory({ when, chapter: d.chapter, people: d.people.trim(), place: d.place.trim(), split: d.split, analyze: d.analyze, text: d.text }), 'memory');
      ctx.drafts.memory = blankMemory();
      ctx.toast('Memory saved.');
      ctx.go('past');
    } catch (e) {
      ctx.toast(ctx.readable(e) + ' Your draft is kept.', true);
      saveBtn.disabled = false;
    }
  });

  const view = h('div', { class: 'view-memory' },
    top,
    header({ eyebrow: 'Past', title: 'New memory', section: 'past' }),
    h('section', { class: 'stack' }, h('span', { class: 'label' }, 'When'), seg, whenInput),
    h('section', { class: 'stack' }, h('span', { class: 'label' }, 'Chapter'), chapterBox),
    h('div', { class: 'two' }, field('people', 'Who was there?', 'People'), field('place', 'Where?', 'Place')),
    h('section', { class: 'write-card' }, text, h('div', { class: 'right' }, dictate)),
    h('section', { class: 'card toggles' },
      toggleRow('Split into memories', 'Claude dates each part, on your Mac', d.split, (v) => {
        d.split = v;
        persist();
      }),
      toggleRow('Include in Claude analysis', 'Off: never leaves your devices as text', d.analyze, (v) => {
        d.analyze = v;
        persist();
      })));
  if (arg === 'dictate') setTimeout(() => dictate.click(), 50);
  return view;
}
