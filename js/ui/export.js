import { h } from './dom.js';
import { icon } from './icons.js';
import { header, label, segmented, toggleRow } from './parts.js';
import { exportItems, toMarkdown, rangeTitle, itemHeading } from '../model.js';

function defaults() {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return { mode: 'month', month: `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}`, year: String(d.getFullYear()), memories: true };
}

function prefixOf(s) {
  if (s.mode === 'all') return '';
  if (s.mode === 'year') return /^\d{4}$/.test(s.year) ? s.year : null;
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s.month) ? s.month : null;
}

async function deliver(name, text) {
  const file = new File([text], name, { type: 'text/markdown' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function printDoc(items, prefix) {
  return h('article', { class: 'print-doc' },
    h('h1', {}, `Odometer · ${rangeTitle(prefix)}`),
    h('p', { class: 'print-meta' }, `${items.length} item${items.length === 1 ? '' : 's'} · exported from Odometer`),
    items.map((x) => h('section', { class: 'print-item' }, h('h2', {}, itemHeading(x.payload)), h('div', { class: 'print-text' }, String(x.payload.text || '').trim()))));
}

function printNow(doc) {
  const host = h('div', { class: 'print-host' }, doc);
  document.body.append(host);
  document.documentElement.classList.add('printing');
  const done = () => {
    document.documentElement.classList.remove('printing');
    host.remove();
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
  setTimeout(() => {
    if (host.isConnected && !matchMedia('print').matches) done();
  }, 60000);
}

export function exportView(ctx) {
  const s = ctx.ui.export || (ctx.ui.export = defaults());
  const count = h('p', { class: 'muted' });
  const month = h('input', { type: 'month', class: 'field', value: s.month, placeholder: 'YYYY-MM', 'aria-label': 'Month' });
  const year = h('input', { type: 'number', class: 'field', value: s.year, inputmode: 'numeric', min: 1900, max: new Date().getFullYear(), 'aria-label': 'Year' });
  const pdf = h('button', { type: 'button', class: 'btn primary' }, icon('download', 18), 'Save as PDF');
  const md = h('button', { type: 'button', class: 'btn secondary' }, icon('download', 18), 'Save as Markdown');

  function current() {
    const prefix = prefixOf(s);
    return { prefix, items: prefix == null ? [] : exportItems(ctx.items, prefix, s.memories) };
  }
  function paint() {
    month.hidden = s.mode !== 'month';
    year.hidden = s.mode !== 'year';
    const { prefix, items } = current();
    const e = items.filter((x) => x.payload.kind === 'entry').length;
    const m = items.length - e;
    count.textContent = prefix == null ? 'Pick a valid range.' : `${rangeTitle(prefix)}: ${e} entr${e === 1 ? 'y' : 'ies'}${s.memories ? `, ${m} memor${m === 1 ? 'y' : 'ies'}` : ''}.`;
    pdf.disabled = md.disabled = !items.length;
  }
  month.addEventListener('input', () => {
    s.month = month.value;
    paint();
  });
  year.addEventListener('input', () => {
    s.year = year.value.trim();
    paint();
  });
  pdf.addEventListener('click', () => {
    const { prefix, items } = current();
    printNow(printDoc(items, prefix));
  });
  md.addEventListener('click', async () => {
    const { prefix, items } = current();
    try {
      await deliver(`odometer-${prefix || 'all'}.md`, toMarkdown(items, prefix));
    } catch (e) {
      ctx.toast(ctx.readable(e), true);
    }
  });
  paint();

  return h('div', { class: 'view-export' },
    header({ eyebrow: 'Timeline', title: 'Export', section: 'time' }),
    h('section', { class: 'stack' },
      label('Range'),
      segmented('Range', [['month', 'Month'], ['year', 'Year'], ['all', 'All']], s.mode, (v) => {
        s.mode = v;
        paint();
      }),
      month,
      year),
    h('section', { class: 'card toggles' },
      toggleRow('Include memories', 'Memories dated inside the range', s.memories, (v) => {
        s.memories = v;
        paint();
      })),
    count,
    h('div', { class: 'stack' }, pdf, md),
    h('p', { class: 'note-card' }, 'The exported file is not encrypted. PDF opens the print sheet: on iPhone choose Save to Files; on Mac choose Save as PDF.'));
}
