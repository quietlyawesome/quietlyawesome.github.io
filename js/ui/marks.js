import { svgFrom } from './dom.js';
import { dailyMark } from '../model.js';

const NS = 'xmlns="http://www.w3.org/2000/svg"';

function dialArcs(width) {
  const colors = ['#6A5BE2', '#2FB3C9', '#6FCF6A', '#F5C542', '#FF6B8A'];
  return colors
    .map((c, i) => `<circle cx="48" cy="52" r="34" fill="none" stroke="${c}" stroke-width="${width}" stroke-dasharray="29 184.6" stroke-dashoffset="${-32 * i}" transform="rotate(135 48 52)"/>`)
    .join('');
}

const MARKUP = {
  dial: (w) => `<svg ${NS} viewBox="0 0 96 96">${dialArcs(w)}<line class="mk-fg" x1="48" y1="52" x2="70" y2="43" stroke-width="${w * 0.35}" stroke-linecap="round"/><circle class="mk-fgf" cx="48" cy="52" r="5"/></svg>`,
  carry: () => `<svg ${NS} viewBox="112 112 800 800"><defs><clipPath id="mk-c"><rect x="648" y="362" width="208" height="300" rx="28"/></clipPath></defs>
<rect class="mk-box" x="132" y="322" width="760" height="380" rx="64"/>
<rect x="168" y="362" width="208" height="300" rx="28" fill="#6A5BE2"/><rect x="408" y="362" width="208" height="300" rx="28" fill="#2FB3C9"/><rect x="648" y="362" width="208" height="300" rx="28" fill="#FF6B8A"/>
<g font-family="Google Sans, system-ui, sans-serif" font-size="210" font-weight="700" text-anchor="middle"><text x="272" y="594" fill="#FFFFFF">1</text><text x="512" y="594" fill="#0B1020">2</text>
<g clip-path="url(#mk-c)" fill="#1A0008"><text x="752" y="454">9</text><text x="752" y="744">0</text></g></g>
<rect class="mk-shade" x="132" y="506" width="760" height="12"/></svg>`,
  loops: () => `<svg ${NS} viewBox="120 120 784 784"><g fill="none" stroke-width="64">
<circle class="mk-track" cx="512" cy="512" r="330"/><circle class="mk-track" cx="512" cy="512" r="236"/><circle class="mk-track" cx="512" cy="512" r="142"/>
<g stroke-linecap="round" transform="rotate(-90 512 512)"><circle cx="512" cy="512" r="330" stroke="#6A5BE2" stroke-dasharray="1451.5 2073.5"/><circle cx="512" cy="512" r="236" stroke="#2FB3C9" stroke-dasharray="593 1483"/><circle cx="512" cy="512" r="142" stroke="#FF6B8A" stroke-dasharray="803 892"/></g></g>
<circle cx="512" cy="512" r="44" fill="#F5C542"/></svg>`,
  die: () => {
    const pins = [];
    for (let i = 0; i < 5; i++) {
      const p = 292 + i * 100;
      pins.push(`<rect x="${p}" y="160" width="40" height="72" rx="8"/><rect x="${p}" y="792" width="40" height="72" rx="8"/><rect x="160" y="${p}" width="72" height="40" rx="8"/><rect x="792" y="${p}" width="72" height="40" rx="8"/>`);
    }
    const tiles = ['#B8DB4A', '#F5C542', '', '#6FCF6A', '#2DBE9A', '#FF9F43', '#B8DB4A', '#4F8CF0', '#F5C542', '', '#FF6B8A', '#6FCF6A', '#2FB3C9', '#B8DB4A', '#FF9F43', '#F5C542'];
    const cells = tiles
      .map((c, i) => `<rect ${c ? `fill="${c}"` : 'class="mk-dim"'} x="${274 + (i % 4) * 124}" y="${274 + Math.floor(i / 4) * 124}" width="104" height="104" rx="18"/>`)
      .join('');
    return `<svg ${NS} viewBox="140 140 744 744"><g class="mk-pin">${pins.join('')}</g><rect class="mk-box mk-line" x="232" y="232" width="560" height="560" rx="56" stroke-width="8"/>${cells}</svg>`;
  },
};

export function mark(name, size, weight = 10) {
  const el = svgFrom(MARKUP[name](weight));
  el.setAttribute('width', size);
  el.setAttribute('height', size);
  el.setAttribute('class', 'mark');
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', 'Odometer');
  return el;
}

export function todaysMark(size, weight) {
  return mark(dailyMark(), size, weight);
}

export function applyDailyFavicon(doc = document) {
  const link = doc.querySelector('link[rel="icon"]');
  if (link) link.href = `icons/${dailyMark()}.svg`;
}
