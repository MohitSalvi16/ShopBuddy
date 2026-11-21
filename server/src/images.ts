import type { Product } from './shop.js';

const PALETTE: Record<string, [string, string]> = {
  earbuds: ['#7c3aed', '#06b6d4'],
  headphones: ['#4f46e5', '#a855f7'],
  smartwatch: ['#0891b2', '#22d3ee'],
  speaker: ['#9333ea', '#ec4899'],
  accessory: ['#0ea5e9', '#6366f1'],
};

const GLYPH: Record<string, string> = {
  earbuds: '<circle cx="-34" cy="0" r="26"/><rect x="-42" y="18" width="16" height="44" rx="8"/><circle cx="34" cy="0" r="26"/><rect x="26" y="18" width="16" height="44" rx="8"/>',
  headphones: '<path d="M-60 20 V0 a60 60 0 0 1 120 0 V20" fill="none" stroke="white" stroke-width="10"/><rect x="-72" y="10" width="28" height="50" rx="12"/><rect x="44" y="10" width="28" height="50" rx="12"/>',
  smartwatch: '<rect x="-16" y="-75" width="32" height="150" rx="10" opacity=".6"/><rect x="-42" y="-45" width="84" height="90" rx="22"/><circle cx="0" cy="0" r="22" fill="none" stroke="#0b1026" stroke-width="5"/>',
  speaker: '<rect x="-38" y="-62" width="76" height="124" rx="22"/><circle cx="0" cy="-22" r="12" fill="#0b1026"/><circle cx="0" cy="24" r="24" fill="#0b1026"/>',
  accessory: '<rect x="-26" y="-55" width="52" height="80" rx="10"/><rect x="-10" y="25" width="20" height="40" rx="4"/><path d="M-6 -30 l-10 22 h12 l-6 20 l18 -28 h-12 l8 -14z" fill="#0b1026"/>',
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Generated product art (no external image hosting needed for the simulated catalog). */
export function productSvg(p: Product) {
  const [a, b] = PALETTE[p.category] ?? PALETTE.accessory;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
<radialGradient id="r" cx=".5" cy=".45" r=".6"><stop offset="0" stop-color="#fff" stop-opacity=".25"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
<rect width="400" height="300" fill="#0b1026"/><rect width="400" height="300" fill="url(#g)" opacity=".85"/><rect width="400" height="300" fill="url(#r)"/>
<g transform="translate(200 135)" fill="white">${GLYPH[p.category] ?? GLYPH.accessory}</g>
<text x="20" y="278" font-family="Inter,Arial,sans-serif" font-size="20" font-weight="700" fill="white" opacity=".9">${esc(p.brand)}</text>
</svg>`;
}
