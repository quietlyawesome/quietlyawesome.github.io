import { h } from './dom.js';
import { icon } from './icons.js';
import { mark } from './marks.js';
import { iconButton, moodVars, dot } from './parts.js';
import { kinds, byDate, monthCells, monthName, fullDate, shortDate, parseYmd, ymd } from '../model.js';

const TABS = [
  ['write', 'Write', 'write'],
  ['timeline', 'Timeline', 'time'],
  ['past', 'Past', 'past'],
  ['weekly', 'Weekly', 'week'],
];

const SECTION_OF = { write: 'write', timeline: 'timeline', item: 'timeline', export: 'timeline', past: 'past', memory: 'past', weekly: 'weekly', stats: 'weekly' };

export function createShell(root, ctx) {
  const toast = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
  const host = h('main', { class: 'view', id: 'view', tabindex: '-1' });
  const sidebar = h('aside', { class: 'sidebar', 'aria-label': 'Odometer' });
  const topDate = h('span', { class: 'eyebrow c-write' });
  const topbar = h('div', { class: 'topbar' },
    topDate,
    h('div', { class: 'vh-actions' },
      h('button', { type: 'button', class: 'btn secondary small', onclick: () => ctx.go('export') }, icon('download', 16), 'Export'),
      iconButton('settings', 'Settings', () => ctx.go('settings')),
      iconButton('lock', 'Lock', () => ctx.lock())));
  const tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Sections' });
  const layout = h('div', { class: 'layout' }, sidebar, h('div', { class: 'main' }, topbar, host), tabbar);
  let timer = null;

  function say(message, bad = false) {
    toast.textContent = message || '';
    toast.className = `toast${message ? ' show' : ''}${bad ? ' bad' : ''}`;
    clearTimeout(timer);
    if (message) timer = setTimeout(() => say(''), bad ? 6000 : 3200);
  }

  function solo(el) {
    root.replaceChildren(h('div', { class: 'solo' }, el), toast);
    window.scrollTo(0, 0);
  }

  function paintTabs(route) {
    const active = SECTION_OF[route];
    tabbar.replaceChildren(...TABS.map(([id, text, sec]) => h('a', {
      href: `#/${id}`,
      class: `tab c-${sec}`,
      'aria-current': active === id ? 'page' : null,
    }, icon(id), h('span', {}, text))));
  }

  function paintSidebar(route) {
    const now = new Date();
    const today = ymd(now);
    const entries = kinds(ctx.items, 'entry');
    const dates = byDate(entries);
    const search = h('input', { type: 'search', class: 'search-input', placeholder: 'Search entries', 'aria-label': 'Search entries', value: ctx.ui.query || '' });
    search.addEventListener('input', () => {
      ctx.ui.query = search.value;
      if (route !== 'timeline') ctx.go('timeline');
      else ctx.render({ keepSidebar: true });
    });
    const cells = monthCells(now.getFullYear(), now.getMonth(), dates, today).map((c) => {
      if (!c) return h('span', { class: 'mini pad', 'aria-hidden': 'true' });
      const el = h('a', { class: `mini ${c.mood ? 'has' : c.future ? 'future' : 'none'}${c.today ? ' today' : ''}`, href: '#/timeline', 'aria-label': `${monthName(now.getMonth())} ${c.n}${c.mood ? `, mood ${c.mood}` : ''}` });
      if (c.mood) moodVars(el, c.mood);
      el.addEventListener('click', () => {
        ctx.ui.month = { y: now.getFullYear(), m: now.getMonth() };
        ctx.ui.day = c.count ? c.ymd : null;
      });
      return el;
    });
    const recent = entries.slice(0, 5).map((x) => {
      const p = x.payload;
      const el = h('a', { class: 'recent', href: `#/item/${encodeURIComponent(x.path)}` },
        moodVars(h('span', { class: 'recent-dot', 'aria-hidden': 'true' }), p.mood),
        h('span', { class: 'recent-text' },
          h('span', { class: 'recent-date' }, shortDate(parseYmd(p.date)) + (p.date === today ? ' · Today' : '')),
          h('span', { class: 'recent-tags' }, (p.tags || []).join(', ') || (p.text || '').slice(0, 40))));
      return el;
    });
    const status = { synced: ['Synced', '#2DBE9A'], offline: ['Offline · showing saved copy', '#F5C542'], syncing: ['Syncing…', '#4F8CF0'], error: ['Not synced', '#FF6B8A'] }[ctx.sync] || ['Synced', '#2DBE9A'];
    sidebar.replaceChildren(
      h('a', { class: 'brand', href: '#/write' }, mark('dial', 32, 12), h('span', {}, 'Odometer')),
      h('a', { class: 'btn primary', href: '#/write' }, icon('plus', 16, 2.2), 'New entry'),
      h('label', { class: 'search compact' }, icon('search', 16, 2), search),
      h('section', { class: 'mini-cal-wrap', 'aria-label': `${monthName(now.getMonth())} mood` },
        h('a', { class: 'label c-time', href: '#/timeline' }, monthName(now.getMonth())),
        h('div', { class: 'mini-cal' }, cells)),
      h('nav', { class: 'side-nav', 'aria-label': 'Recent entries' },
        h('h2', { class: 'label' }, 'Recent'),
        recent.length ? recent : h('p', { class: 'muted small' }, 'No entries yet.'),
        h('a', { class: `side-link c-time${route === 'timeline' ? ' on' : ''}`, href: '#/timeline' }, icon('timeline', 16), 'Timeline'),
        h('a', { class: `side-link c-week${route === 'weekly' ? ' on' : ''}`, href: '#/weekly' }, icon('weekly', 16), 'Weekly summary'),
        h('a', { class: `side-link c-week${route === 'stats' ? ' on' : ''}`, href: '#/stats' }, icon('chart', 16), 'Stats'),
        h('a', { class: `side-link c-past${route === 'past' || route === 'memory' ? ' on' : ''}`, href: '#/past' }, icon('past', 16), 'Memory-Bound · add a memory')),
      h('div', { class: 'sync' }, dot(status[1]), `${status[0]} · end-to-end encrypted`));
  }

  function app(route, view, { keepSidebar = false } = {}) {
    if (!layout.isConnected) root.replaceChildren(layout, toast);
    topDate.textContent = route === 'write' ? '' : fullDate(new Date());
    paintTabs(route);
    if (!keepSidebar) paintSidebar(route);
    if (view) {
      host.replaceChildren(view);
      host.dataset.route = route;
    }
  }

  return { say, solo, app, host };
}
