import { h } from './dom.js';
import { icon } from './icons.js';
import { iconButton, moodVars, pill, addPill } from './parts.js';
import { MOODS, STARTER_TAGS, TAG_COLORS, mood, colorMap, knownNames, kinds, longDate, parseYmd, ymd, timeLabel } from '../model.js';
import { newEntry } from '../vault.js';

export function blankEntry() {
  return { text: '', mood: 5, tags: [], date: null };
}

export function writeView(ctx) {
  const d = ctx.drafts.entry || (ctx.drafts.entry = blankEntry());
  const today = ymd(new Date());
  const used = kinds(ctx.items, 'entry').flatMap((x) => x.payload.tags || []);
  const names = knownNames(STARTER_TAGS, [...used, ...d.tags]);
  const colors = colorMap(names, TAG_COLORS);
  const persist = () => ctx.saveDraftSoon('entry');

  const dateInput = h('input', { type: 'date', class: 'date-pick', max: today, value: d.date || today, 'aria-label': 'Entry date' });
  const eyebrow = h('label', { class: 'eyebrow c-write date-label' }, '', dateInput);
  const title = h('h1', { class: 'vh-title' });
  const paintDate = () => {
    const day = d.date || today;
    eyebrow.firstChild.textContent = longDate(parseYmd(day));
    title.textContent = day === today ? 'Today' : 'Looking back';
  };
  dateInput.addEventListener('change', () => {
    const v = dateInput.value;
    d.date = v && v < today ? v : null;
    paintDate();
    persist();
  });
  paintDate();

  const head = h('header', { class: 'vh' },
    h('div', { class: 'vh-text' }, eyebrow, title),
    h('div', { class: 'vh-actions phone-only' },
      iconButton('settings', 'Settings', () => ctx.go('settings')),
      iconButton('lock', 'Lock', () => ctx.lock())));

  const word = h('span', { class: 'mood-word' });
  const big = h('span', { class: 'badge lg' });
  const slider = h('input', { type: 'range', min: 1, max: 10, step: 1, value: d.mood, class: 'mood-slider', 'aria-label': 'Mood, 1 to 10' });
  const spectrum = h('div', { class: 'spectrum', 'aria-hidden': 'true' }, MOODS.map((m) => moodVars(h('span'), m.n)));
  const buttons = h('div', { class: 'mood-buttons', role: 'group', 'aria-label': 'Mood' },
    MOODS.map((m) => moodVars(h('button', { type: 'button', class: 'mood-btn', 'aria-label': `${m.n}, ${m.word}`, onclick: () => setMood(m.n) }, String(m.n)), m.n)));
  const card = h('section', { class: 'mood-card' },
    h('div', { class: 'mood-head' }, h('span', { class: 'label' }, 'Mood'), h('div', { class: 'mood-now' }, word, big)),
    slider, spectrum, buttons);

  function paintMood() {
    const m = mood(d.mood);
    moodVars(card, m.n);
    moodVars(big, m.n);
    word.textContent = m.word;
    big.textContent = String(m.n);
    slider.value = String(m.n);
    [...spectrum.children].forEach((s, i) => s.classList.toggle('off', i >= m.n));
    [...buttons.children].forEach((b, i) => b.setAttribute('aria-pressed', String(i + 1 === m.n)));
  }
  function setMood(n) {
    d.mood = n;
    paintMood();
    persist();
  }
  slider.addEventListener('input', () => setMood(Number(slider.value)));
  paintMood();

  const tagBox = h('div', { class: 'pills', role: 'group', 'aria-label': 'Tags' });
  function paintTags() {
    const all = knownNames(names, d.tags);
    const cmap = colorMap(all, TAG_COLORS);
    tagBox.replaceChildren(
      ...all.map((t) => pill(t, cmap.get(t), d.tags.includes(t), () => {
        d.tags = d.tags.includes(t) ? d.tags.filter((x) => x !== t) : [...d.tags, t];
        paintTags();
        persist();
      })),
      addPill('Tag', (v) => {
        const t = v.toLowerCase().replace(/\s+/g, '-');
        if (!d.tags.includes(t)) d.tags = [...d.tags, t];
        paintTags();
        persist();
      }),
    );
  }
  paintTags();

  const text = h('textarea', { id: 'entry-text', class: 'writing', placeholder: 'What happened today? How did it feel?', 'aria-label': 'Entry' });
  text.value = d.text;
  text.addEventListener('input', () => {
    d.text = text.value;
    persist();
  });
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      save();
    }
  });

  const saveBtn = h('button', { type: 'button', class: 'btn primary' }, 'Save entry');
  async function save() {
    if (!d.text.trim()) {
      ctx.toast('Write something first.');
      text.focus();
      return;
    }
    saveBtn.disabled = true;
    try {
      await ctx.save(newEntry({ text: d.text, mood: d.mood, tags: d.tags, date: d.date }), 'entry');
      ctx.drafts.entry = blankEntry();
      ctx.toast('Saved. Every day adds a mile.');
      ctx.render();
    } catch (e) {
      ctx.toast(ctx.readable(e) + ' Your draft is kept.', true);
      saveBtn.disabled = false;
    }
  }
  saveBtn.addEventListener('click', save);

  return h('div', { class: 'view-write' },
    head,
    card,
    h('div', { class: 'tags-row' }, h('span', { class: 'label mac-only' }, 'Tags'), tagBox),
    h('section', { class: 'write-card' }, h('label', { class: 'label', for: 'entry-text' }, `Entry · ${timeLabel(new Date())}`), text),
    h('div', { class: 'save-row' },
      h('span', { class: 'note' }, icon('lock', 14, 2), 'Draft encrypted on this device', h('span', { class: 'mac-only' }, ' · ⌘↵ to save')),
      saveBtn));
}
