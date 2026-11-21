/**
 * Reviews & ratings.
 * - SIMULATED reviews (clearly labelled) are generated from each product's real catalog attributes, so they never
 *   contradict the specs (a 4.5/10 mic yields "muffled mic" complaints, a 9.5/10 mic yields praise).
 * - CUSTOMER ratings are real for this demo: only products bought in the session can be rated (verified buyer),
 *   and each rating updates the product's average rating — which feeds the Best Deal Finder's quality score.
 */
import { db } from './db.js';
import * as shop from './shop.js';
import type { Product } from './shop.js';

db.exec(`
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL REFERENCES products(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  aspect TEXT NOT NULL,
  sentiment TEXT NOT NULL CHECK (sentiment IN ('positive', 'negative', 'mixed')),
  text TEXT NOT NULL,
  author TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('simulated', 'customer')),
  session_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id, source);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_customer ON reviews(product_id, session_id) WHERE source = 'customer';
`);

type Sentiment = 'positive' | 'negative' | 'mixed';
type Aspect = { aspect: string; label: string; score: number };

const LABEL: Record<string, string> = {
  mic: 'microphone on calls', comfort: 'comfort for long wear', battery: 'battery life', sound: 'sound quality', anc: 'noise cancellation',
  cable: 'wired cable', display: 'display', gps: 'GPS', calling: 'Bluetooth calling', loudness: 'loudness', water: 'water resistance',
  speed: 'charging speed', build: 'build quality', value: 'value for money', weight: 'weight',
};

const T: Record<string, Partial<Record<Sentiment, string[]>>> = {
  mic: {
    positive: ['Colleagues say my voice sounds crystal clear on Teams calls.', 'Mic is excellent — no more "you are on mute?" confusion in meetings.'],
    mixed: ['Mic is okay for calls, but a bit muffled in a noisy room.', 'Call quality is fine indoors; outdoors people struggle to hear me.'],
    negative: ['Mic sounds muffled on Zoom; people keep asking me to repeat.', 'Great for music but the microphone is poor for office calls.'],
  },
  comfort: {
    positive: ['Wore it through a 6-hour workday without any ear pain.', 'Very light and comfortable even after long meetings.'],
    mixed: ['Comfortable for an hour or two, then gets a little tight.', 'Fit is decent, ears get warm after long sessions.'],
    negative: ['Gets painful after about 2 hours of continuous use.', 'Clamping force is too strong; not great for all-day wear.'],
  },
  battery: {
    positive: ['Battery lasts forever — charge it once a week.', 'Battery easily lasts multiple days of heavy use.'],
    mixed: ['Battery is okay, needs charging every other day.', 'Battery life is average, as advertised.'],
    negative: ['Battery drains faster than advertised.', 'Need to charge it daily, which gets annoying.'],
  },
  sound: {
    positive: ['Sound is rich and clear, bass is punchy without being muddy.', 'Excellent audio for the price — vocals are crisp.'],
    mixed: ['Sound is decent for calls, not great for music.', 'Audio is fine, a little flat compared to pricier ones.'],
    negative: ['Sound is tinny and bass is weak.', 'Audio quality is disappointing for music.'],
  },
  anc: {
    positive: ['Noise cancellation blocks out the ceiling fan and traffic nicely.'],
    negative: ['No noise cancellation, so household noise leaks into calls.'],
  },
  cable: {
    mixed: ['Wired means no battery worries, but the cable gets in the way.', 'Rock-solid wired connection; the cable is a bit short for my setup.'],
  },
  display: {
    positive: ['Display is bright and readable even in sunlight.'], mixed: ['Display is fine indoors, hard to read in direct sun.'],
  },
  gps: { positive: ['Built-in GPS tracks runs accurately without the phone.'], negative: ['No GPS, so you need to carry your phone for runs.'] },
  calling: { positive: ['Bluetooth calling from the wrist works well.'], negative: ['No calling feature on the watch.'] },
  loudness: { positive: ['Gets very loud — fills the whole room.'], mixed: ['Loud enough for a small room, not for parties.'] },
  water: { positive: ['Survived a pool party without any issue.'], negative: ['Not water resistant, had to keep it away from the pool.'] },
  speed: { positive: ['Charges my phone really fast.'], mixed: ['Charging speed is okay, not the fastest.'] },
  build: {
    positive: ['Build quality feels premium and sturdy.', 'Solid build, has survived a few drops.'],
    mixed: ['Build is okay, feels a bit plasticky.'],
    negative: ['Quality control issues — one unit stopped working in a month.', 'Feels cheap; hinge started creaking quickly.'],
  },
  value: { positive: ['Great value for money at this price.', 'Worth every rupee with the discount.'], mixed: ['Fair price, nothing special.'] },
  weight: { negative: ['Quite heavy to carry around.'], positive: ['Very light, easy to carry.'] },
};

const NAMES = ['Aarav S.', 'Priya K.', 'Rohit M.', 'Sneha P.', 'Vikram R.', 'Ananya D.', 'Kabir J.', 'Meera T.', 'Arjun N.', 'Isha G.'];
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const clamp = (x: number) => Math.max(0, Math.min(1, x));

/** Aspect scores (0..1) derived ONLY from catalog attributes. */
function aspectsFor(p: Product): Aspect[] {
  const s = p.specs;
  const a: Aspect[] = [];
  const push = (aspect: string, score: number) => a.push({ aspect, label: LABEL[aspect], score: clamp(score) });
  if (s.mic_score != null) push('mic', (Number(s.mic_score) - 3) / 7);
  if (s.comfort_score != null) push('comfort', (Number(s.comfort_score) - 4) / 6);
  if (s.wireless === false) push('cable', 0.6);
  else if (s.battery_hours != null) push('battery', Number(s.battery_hours) / (p.category === 'speaker' ? 16 : 50));
  if (s.battery_days != null) push('battery', Number(s.battery_days) / 10);
  if (s.sound_score != null) push('sound', (Number(s.sound_score) - 5.5) / 4);
  if (s.anc != null && ['earbuds', 'headphones'].includes(p.category)) push('anc', s.anc ? 1 : 0);
  if (s.display != null) push('display', /AMOLED/i.test(String(s.display)) ? 0.85 : 0.6);
  if (s.gps != null) push('gps', s.gps ? 1 : 0);
  if (s.calling != null) push('calling', s.calling ? 1 : 0);
  if (p.category === 'speaker' && s.output_w != null) push('loudness', Number(s.output_w) / 30);
  if (p.category === 'speaker' && s.water_resistance != null) push('water', /7|8/.test(String(s.water_resistance)) ? 1 : 0);
  if (p.category === 'accessory' && (s.output_w ?? s.max_power_w) != null) push('speed', Number(s.output_w ?? s.max_power_w) / 60);
  if (s.weight_g != null && Number(s.weight_g) > 300) push('weight', 0.2);
  push('build', (p.rating - 3.6) / 1.0);
  push('value', (1 - p.price / p.mrp) / 0.5);
  return a;
}

function sentimentOf(aspect: string, score: number): Sentiment {
  const opts = T[aspect] ?? {};
  let s: Sentiment = score >= 0.7 ? 'positive' : score <= 0.45 ? 'negative' : 'mixed';
  if (!opts[s]) s = opts.mixed ? 'mixed' : s === 'negative' && opts.positive ? 'positive' : (Object.keys(opts)[0] as Sentiment);
  return s;
}

/** Seed simulated reviews once per product (idempotent). */
export function seedReviews() {
  const has = db.prepare("SELECT COUNT(*) AS n FROM reviews WHERE product_id = ? AND source = 'simulated'");
  const ins = db.prepare("INSERT INTO reviews (product_id, rating, aspect, sentiment, text, author, source) VALUES (?, ?, ?, ?, ?, ?, 'simulated')");
  for (const { id } of db.prepare('SELECT id FROM products').all() as { id: string }[]) {
    if (Number((has.get(id) as any).n) > 0) continue;
    const p = shop.getProduct(id);
    for (const a of aspectsFor(p)) {
      const sent = sentimentOf(a.aspect, a.score);
      const texts = T[a.aspect]?.[sent];
      if (!texts?.length) continue;
      const h = hash(id + a.aspect);
      const rating = sent === 'positive' ? 4 + (h % 2) : sent === 'mixed' ? 3 : 1 + (h % 2);
      ins.run(id, rating, a.aspect, sent, texts[h % texts.length], NAMES[h % NAMES.length]);
    }
  }
}

export interface ReviewInsights {
  product_id: string; name: string; rating: number; review_count: number;
  verdict: 'mostly_positive' | 'mixed' | 'mostly_negative';
  praise: { aspect: string; label: string; quote: string }[];
  complaints: { aspect: string; label: string; severity: 'minor' | 'major'; quote: string }[];
  customer_ratings: { rating: number; text: string; author: string; at: string }[];
  summary: string;
  disclaimer: string;
}

/** Which aspects matter most, per shopping goal — used to rank praise and complaints. */
const PRIORITY: Record<string, string[]> = {
  calls: ['mic', 'comfort', 'cable', 'battery', 'build', 'sound', 'anc', 'weight', 'value'],
  gaming: ['sound', 'mic', 'comfort', 'battery', 'build', 'anc', 'value'],
  music: ['sound', 'anc', 'battery', 'comfort', 'build', 'value'],
  travel: ['anc', 'battery', 'comfort', 'sound', 'build', 'weight', 'value'],
  workout: ['water', 'battery', 'comfort', 'sound', 'build', 'value'],
  general: ['build', 'sound', 'battery', 'comfort', 'mic', 'display', 'speed', 'loudness', 'water', 'gps', 'calling', 'anc', 'cable', 'weight', 'value'],
};
/** Missing features are a mismatch, not a defect — never "major". */
const MISSING_FEATURE = new Set(['anc', 'gps', 'calling']);

let seeded = false;
export function getReviewInsights(productId: string, useCase = 'general'): ReviewInsights {
  if (!seeded) { seedReviews(); seeded = true; }
  const p = shop.getProduct(productId);
  const order = PRIORITY[useCase] ?? PRIORITY.general;
  const rank = (aspect: string) => { const i = order.indexOf(aspect); return i < 0 ? 99 : i; };
  const rows = db.prepare('SELECT * FROM reviews WHERE product_id = ? ORDER BY created_at DESC, id DESC').all(p.id) as any[];
  const sim = rows.filter((r) => r.source === 'simulated');
  const cust = rows.filter((r) => r.source === 'customer');
  const praise = sim.filter((r) => r.sentiment === 'positive').sort((a, b) => rank(a.aspect) - rank(b.aspect))
    .map((r) => ({ aspect: r.aspect, label: LABEL[r.aspect] ?? r.aspect, quote: r.text }));
  const sev = (r: any): 'major' | 'minor' => (r.sentiment === 'negative' && !MISSING_FEATURE.has(r.aspect) ? 'major' : 'minor');
  const complaints = [
    // verified-buyer complaints first (real feedback), then simulated ones: major before minor, most relevant aspect first
    ...cust.filter((r) => r.rating <= 2).map((r) => ({ aspect: 'overall', label: 'verified buyer complaint', severity: 'major' as const, quote: r.text })),
    ...sim.filter((r) => r.sentiment !== 'positive')
      .sort((a, b) => (sev(a) === sev(b) ? rank(a.aspect) - rank(b.aspect) : sev(a) === 'major' ? -1 : 1))
      .map((r) => ({ aspect: r.aspect, label: LABEL[r.aspect] ?? r.aspect, severity: sev(r), quote: r.text })),
  ];
  const major = complaints.filter((c) => c.severity === 'major').length;
  const verdict = p.rating >= 4.3 && major <= 1 ? 'mostly_positive' : p.rating < 3.9 || major > praise.length ? 'mostly_negative' : 'mixed';
  const good = praise.slice(0, 2).map((x) => x.label).join(' and ') || 'nothing in particular';
  const bad = complaints.slice(0, 2).map((x) => x.label).join(' and ');
  return {
    product_id: p.id, name: `${p.brand} ${p.name}`, rating: p.rating, review_count: p.reviews, verdict,
    praise: praise.slice(0, 3), complaints: complaints.slice(0, 3),
    customer_ratings: cust.slice(0, 3).map((r) => ({ rating: r.rating, text: r.text, author: r.author, at: r.created_at })),
    summary: `${p.name} is rated ${p.rating}★ (${p.reviews.toLocaleString('en-IN')} reviews). Buyers like the ${good}${bad ? `; common complaints: ${bad}` : '; no common complaints'}.`,
    disclaimer: 'Review snippets are simulated demo data derived from catalog attributes; customer ratings are from verified demo orders.',
  };
}

/** Short praise/complaint line used on deal cards. */
export function reviewHighlights(productId: string, useCase = 'general') {
  const r = getReviewInsights(productId, useCase);
  return { verdict: r.verdict, top_praise: r.praise[0]?.label ?? null, top_complaint: r.complaints[0]?.label ?? null, top_complaint_severity: r.complaints[0]?.severity ?? null };
}

/** Customer rating — only for products bought in this session; one rating per product (re-rating replaces it). */
export function rateProduct(sessionId: string, productId: string, rating: number, comment?: string) {
  const p = shop.getProduct(productId);
  const bought = shop.latestOrders(sessionId, 50).some((o) => o.items.some((i) => i.product_id === p.id));
  if (!bought) throw new shop.ShopError(`You can rate ${p.name} after buying it (verified buyers only)`, 'NOT_PURCHASED');
  const existing = db.prepare("SELECT rating FROM reviews WHERE product_id = ? AND session_id = ? AND source = 'customer'").get(p.id, sessionId) as { rating: number } | undefined;
  const text = comment?.trim() || (rating >= 4 ? 'Happy with this purchase.' : rating === 3 ? 'It is okay.' : 'Not satisfied with this product.');
  const sentiment: Sentiment = rating >= 4 ? 'positive' : rating === 3 ? 'mixed' : 'negative';
  db.exec('BEGIN');
  try {
    // Running average over the catalog's review count (replace the old rating if re-rating).
    const raw = db.prepare('SELECT rating, reviews FROM products WHERE id = ?').get(p.id) as { rating: number; reviews: number };
    const total = Number(raw.rating) * Number(raw.reviews) - (existing?.rating ?? 0) + rating; // use the unrounded value
    const count = Number(raw.reviews) + (existing ? 0 : 1);
    const newAvg = total / count; // stored precisely; rounded only for display
    db.prepare('UPDATE products SET rating = ?, reviews = ? WHERE id = ?').run(newAvg, count, p.id);
    if (existing) db.prepare("UPDATE reviews SET rating = ?, sentiment = ?, text = ?, created_at = datetime('now') WHERE product_id = ? AND session_id = ? AND source = 'customer'").run(rating, sentiment, text, p.id, sessionId);
    else db.prepare("INSERT INTO reviews (product_id, rating, aspect, sentiment, text, author, source, session_id) VALUES (?, ?, 'overall', ?, ?, 'You (verified buyer)', 'customer', ?)").run(p.id, rating, sentiment, text, sessionId);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  const after = shop.getProduct(p.id);
  return { product_id: p.id, name: p.name, your_rating: rating, updated: Boolean(existing), new_average: Math.round(after.rating * 100) / 100, review_count: after.reviews, insights: getReviewInsights(p.id) };
}

/** Products this session bought (for "rate it" without naming the product). */
export function purchasedProductIds(sessionId: string): string[] {
  return [...new Set(shop.latestOrders(sessionId, 50).flatMap((o) => o.items.map((i) => i.product_id)))];
}
