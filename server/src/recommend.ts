/**
 * AI Budget Negotiator + Shopping Devil's Advocate.
 * Deterministic: same catalog + goal => same ranking. All facts come from catalog attributes
 * and backend-verified coupon eligibility (shop.findBestCoupon). Nothing is invented.
 *
 * total = 0.40 * requirement match + 0.25 * quality + 0.20 * value for money + 0.15 * customer preferences
 * Hard constraints (stock > 0, final price <= budget, ANC/wireless if required) are applied BEFORE ranking.
 */
import { db } from './db.js';
import * as shop from './shop.js';
import type { Product, ShoppingGoal, UseCase } from './shop.js';
import { inr } from './shop.js';

export const WEIGHTS = { requirement: 0.4, quality: 0.25, value: 0.2, preference: 0.15 } as const;

type Attr = 'mic' | 'comfort' | 'battery' | 'anc' | 'sound' | 'latency' | 'water' | 'multipoint' | 'light';

const PROFILES: Record<UseCase, Partial<Record<Attr, number>>> = {
  calls: { mic: 0.45, comfort: 0.25, battery: 0.1, anc: 0.1, multipoint: 0.1 },
  gaming: { latency: 0.45, sound: 0.3, comfort: 0.15, mic: 0.1 },
  music: { sound: 0.55, anc: 0.25, battery: 0.2 },
  travel: { anc: 0.4, battery: 0.35, comfort: 0.25 },
  workout: { water: 0.45, battery: 0.25, light: 0.15, sound: 0.15 },
  general: { sound: 0.4, battery: 0.35, comfort: 0.15, mic: 0.05, anc: 0.05 },
};

const USE_CASE_LABEL: Record<UseCase, string> = {
  calls: 'office calls', gaming: 'gaming', music: 'music', travel: 'travel', workout: 'workouts', general: 'everyday use',
};

const PREF_ATTR: Record<string, Attr> = {
  mic: 'mic', microphone: 'mic', calling: 'mic', calls: 'mic', comfort: 'comfort', comfortable: 'comfort',
  battery: 'battery', anc: 'anc', noise_cancellation: 'anc', sound: 'sound', bass: 'sound', music: 'sound',
  latency: 'latency', gaming: 'latency', waterproof: 'water', lightweight: 'light', light: 'light', multipoint: 'multipoint',
};

const clamp = (x: number) => Math.max(0, Math.min(1, x));

/** Normalised 0..1 attribute value, or null if the catalog has no data for it (scored neutral, flagged). */
function attr(p: Product, a: Attr): number | null {
  const s = p.specs;
  switch (a) {
    case 'mic': return s.mic_score != null ? clamp((Number(s.mic_score) - 3) / 7) : null;
    case 'comfort': return s.comfort_score != null ? clamp((Number(s.comfort_score) - 4) / 6) : null;
    case 'battery':
      if (s.wireless === false) return 0.7; // wired: never runs out, but not "battery life"
      if (s.battery_hours != null) return clamp(Number(s.battery_hours) / 60);
      if (s.battery_days != null) return clamp(Number(s.battery_days) / 10);
      return null;
    case 'anc': return s.anc == null ? null : s.anc === true ? 1 : 0;
    case 'sound': return s.sound_score != null ? clamp((Number(s.sound_score) - 5) / 4.5) : null;
    case 'latency': return s.latency_ms != null ? clamp(1 - (Number(s.latency_ms) - 40) / 120) : s.wireless === false ? 1 : null;
    case 'water': {
      const m = String(s.water_resistance ?? '').match(/IP[X\d](\d)|(\d)ATM/i);
      return m ? clamp(Number(m[1] ?? m[2]) / 7) : s.water_resistance === 'none' ? 0 : null;
    }
    case 'multipoint': return s.multipoint == null ? null : s.multipoint ? 1 : 0;
    case 'light': return s.weight_g != null ? clamp(1 - (Number(s.weight_g) - 100) / 250) : null;
  }
}

export interface ScoredDeal {
  product_id: string; name: string; brand: string; category: string; image: string;
  price: number; mrp: number; rating: number; stock: number;
  best_coupon: { code: string; discount: number } | null; discount: number; final_price: number;
  scores: { requirement: number; quality: number; value: number; preference: number; total: number };
  advantages: string[]; disadvantages: string[]; reasoning: string;
  tags: string[];
  review?: { verdict: string; top_praise: string | null; top_complaint: string | null; top_complaint_severity: string | null };
}

function inferUseCase(goal: ShoppingGoal): UseCase {
  return goal.use_case ?? 'general';
}

function profileFor(goal: ShoppingGoal) {
  const uc = inferUseCase(goal);
  const prof = { ...PROFILES[uc] };
  // "not for gaming" -> remove emphasis that only matters for the excluded use-case
  for (const ex of goal.exclude_use_cases ?? []) {
    for (const k of Object.keys(PROFILES[ex]) as Attr[]) if (!PROFILES[uc][k]) delete prof[k];
    if (ex === 'gaming' && uc !== 'gaming') delete prof.latency;
  }
  const sum = Object.values(prof).reduce((s, w) => s + (w ?? 0), 0) || 1;
  for (const k of Object.keys(prof) as Attr[]) prof[k] = prof[k]! / sum;
  return { uc, prof };
}

function qualityScore(p: Product) {
  const rating = clamp((p.rating - 3.5) / 1.4);
  const confidence = clamp(Math.log10(Math.max(p.reviews, 1)) / 4.5);
  return 0.75 * rating + 0.25 * confidence;
}

function describe(p: Product, uc: UseCase, prefs: Attr[], coupon: { code: string; discount: number } | null) {
  const pros: string[] = [], cons: string[] = [];
  const s = p.specs;
  // Only talk about attributes that matter for this goal (profile weight >= 0.1) or that the customer asked for.
  const relevant = new Set<Attr>([...(Object.entries(PROFILES[uc]).filter(([, w]) => (w ?? 0) >= 0.1).map(([k]) => k) as Attr[]), ...prefs]);
  if (relevant.has('mic') && s.mic_score != null) {
    if (Number(s.mic_score) >= 8) pros.push(`Excellent microphone for calls (${s.mic_score}/10)`);
    else if (Number(s.mic_score) < 6.5) cons.push(`Weak microphone for calls (${s.mic_score}/10)`);
  }
  if (relevant.has('comfort') && s.comfort_score != null) {
    if (Number(s.comfort_score) >= 8.5) pros.push(`Very comfortable for long wear (${s.comfort_score}/10)`);
    else if (Number(s.comfort_score) <= 6.5) cons.push(`Less comfortable for all-day use (${s.comfort_score}/10)`);
  }
  if (s.wireless === false) (uc === 'calls' ? pros : cons).push(`Wired ${s.connection ?? 'USB'} — ${uc === 'calls' ? 'no battery or Bluetooth drop-outs on calls' : 'tethered to the device'}`);
  else if (relevant.has('battery') && s.battery_hours != null) {
    if (Number(s.battery_hours) >= 40) pros.push(`${s.battery_hours}h battery`);
    else if (Number(s.battery_hours) < 25) cons.push(`Short battery (${s.battery_hours}h)`);
  }
  if (relevant.has('anc') && s.anc != null) (s.anc ? pros : cons).push(s.anc ? 'Active noise cancellation' : 'No active noise cancellation');
  if (relevant.has('multipoint') && s.multipoint === true) pros.push('Multipoint: laptop + phone together');
  if (relevant.has('latency') && s.latency_ms != null) {
    if (Number(s.latency_ms) <= 60) pros.push(`Low latency (${s.latency_ms} ms)`);
    else if (Number(s.latency_ms) >= 100) cons.push(`High latency (${s.latency_ms} ms) for gaming`);
  }
  if (relevant.has('sound') && s.sound_score != null) {
    if (Number(s.sound_score) >= 8.5) pros.push(`Strong sound quality (${s.sound_score}/10)`);
    else if (Number(s.sound_score) < 6.8) cons.push(`Average sound quality (${s.sound_score}/10)`);
  }
  if (p.rating >= 4.4) pros.push(`Highly rated ${p.rating}★ (${p.reviews.toLocaleString('en-IN')} reviews)`);
  else if (p.rating < 4.0) cons.push(`Lower customer rating (${p.rating}★)`);
  if (coupon) pros.push(`Save ${inr(coupon.discount)} with ${coupon.code}`);
  if (p.stock > 0 && p.stock < 10) cons.push(`Only ${p.stock} left in stock`);
  return { pros, cons };
}

export interface DealRequest extends ShoppingGoal { query?: string; max_price_below?: number; limit?: number }

/** AI Budget Negotiator: filter -> price with verified coupons -> score -> rank -> critique. */
export function findBestDeal(sessionId: string, req: DealRequest) {
  const goal: ShoppingGoal = {
    category: req.category, budget: req.budget, use_case: req.use_case, exclude_use_cases: req.exclude_use_cases,
    preferences: req.preferences, brand: req.brand, require_anc: req.require_anc, require_wireless: req.require_wireless,
  };
  for (const k of Object.keys(goal) as (keyof ShoppingGoal)[]) if (goal[k] === undefined) delete goal[k];
  const category = req.category ?? shop.detectCategory(req.query ?? '');
  const { uc, prof } = profileFor(goal);
  const prefs = (req.preferences ?? []).map((x) => PREF_ATTR[x.toLowerCase().replace(/\s+/g, '_')]).filter(Boolean) as Attr[];
  const wantsCheap = (req.preferences ?? []).some((x) => /cheap|budget|sasta|lowest/i.test(x));

  let all = ((db.prepare('SELECT id FROM products').all() as { id: string }[]).map((r) => shop.getProduct(r.id)));
  if (category) all = all.filter((p) => p.category === category);

  const excluded: { product_id: string; name: string; reason: string }[] = [];
  const candidates: { p: Product; coupon: { code: string; discount: number } | null; final: number }[] = [];
  for (const p of all) {
    if (req.brand && !p.brand.toLowerCase().includes(req.brand.toLowerCase())) continue;
    if (p.stock <= 0) { excluded.push({ product_id: p.id, name: p.name, reason: 'out of stock' }); continue; }
    if (req.require_anc && p.specs.anc !== true) { excluded.push({ product_id: p.id, name: p.name, reason: 'no ANC' }); continue; }
    if (req.require_wireless && p.specs.wireless === false) { excluded.push({ product_id: p.id, name: p.name, reason: 'wired' }); continue; }
    if (req.max_price_below != null && p.price >= req.max_price_below) continue;
    const c = shop.findBestCoupon(sessionId, p.id);
    const coupon = c.best_coupon;
    const final = p.price - (coupon?.discount ?? 0);
    if (req.budget != null && final > req.budget) { excluded.push({ product_id: p.id, name: p.name, reason: `over budget (${inr(final)} after coupons)` }); continue; }
    candidates.push({ p, coupon, final });
  }

  // requirement + quality first; value needs the candidate pool for normalisation
  const pre = candidates.map((c) => {
    let req01 = 0, known = 0;
    for (const [a, w] of Object.entries(prof) as [Attr, number][]) {
      const v = attr(c.p, a);
      req01 += w * (v ?? 0.4); // missing data scored slightly below neutral
      if (v != null) known += w;
    }
    return { ...c, requirement: req01, known, quality: qualityScore(c.p) };
  });
  const vpr = pre.map((c) => (0.6 * c.requirement + 0.4 * c.quality) / c.final);
  const maxVpr = Math.max(...vpr, 1e-9);
  const prices = pre.map((c) => c.final);
  const [minP, maxP] = [Math.min(...prices), Math.max(...prices)];

  const scored: ScoredDeal[] = pre.map((c, i) => {
    const value = 0.8 * (vpr[i] / maxVpr) + 0.2 * clamp((1 - c.final / c.p.mrp) / 0.6);
    let pref = 0.5;
    const parts: number[] = prefs.map((a) => attr(c.p, a) ?? 0.4);
    if (wantsCheap) parts.push(maxP > minP ? 1 - (c.final - minP) / (maxP - minP) : 1);
    if (parts.length) pref = parts.reduce((s, x) => s + x, 0) / parts.length;
    const total = WEIGHTS.requirement * c.requirement + WEIGHTS.quality * c.quality + WEIGHTS.value * value + WEIGHTS.preference * pref;
    const { pros, cons } = describe(c.p, uc, prefs, c.coupon);
    const r = (x: number) => Math.round(x * 100);
    return {
      product_id: c.p.id, name: c.p.name, brand: c.p.brand, category: c.p.category, image: c.p.image,
      price: c.p.price, mrp: c.p.mrp, rating: c.p.rating, stock: c.p.stock,
      best_coupon: c.coupon, discount: c.coupon?.discount ?? 0, final_price: c.final,
      scores: { requirement: r(c.requirement), quality: r(c.quality), value: r(value), preference: r(pref), total: r(total) },
      advantages: pros, disadvantages: cons, reasoning: '', tags: [],
    };
  });
  scored.sort((a, b) => b.scores.total - a.scores.total || a.final_price - b.final_price);
  const limit = Math.min(Math.max(req.limit ?? 3, 1), 6);
  const top = scored.slice(0, limit);

  if (top.length) {
    const cheapest = [...scored].sort((a, b) => a.final_price - b.final_price)[0];
    top[0].tags.push('best_pick');
    const bestValue = [...top].sort((a, b) => b.scores.value - a.scores.value)[0];
    if (bestValue !== top[0]) bestValue.tags.push('best_value');
    // Always show the cheapest option (if >1 slot) so the critic can explain its trade-off.
    if (!top.includes(cheapest) && limit > 1) { if (top.length >= limit) top.pop(); top.push(cheapest); }
    if (top.includes(cheapest)) cheapest.tags.push('cheapest');
    // Display order = score order (best pick is option 1); the cheapest stays visible (usually last) for the friendly tip.
    for (const d of top) {
      const lead = d.advantages.slice(0, 2).join('; ') || 'balanced specs';
      const watch = d.disadvantages[0] ? ` Watch out: ${d.disadvantages[0].toLowerCase()}.` : '';
      d.reasoning = `${d.scores.total}/100 for ${USE_CASE_LABEL[uc]}: ${lead}. Final ${inr(d.final_price)}${d.best_coupon ? ` after ${d.best_coupon.code}` : ''}.${watch}`;
    }
  }

  const st = shop.sessionState(sessionId);
  st.goal = { ...st.goal, ...goal, category: category ?? st.goal.category };
  st.shown = top.map((d) => d.product_id);
  const best = top.find((d) => d.tags.includes('best_pick'));
  st.focusId = best?.product_id;

  const cheapest = top.find((d) => d.tags.includes('cheapest'));
  const devils_advocate = best && cheapest && cheapest !== best ? critiqueAgainst(cheapest, best, uc) : null;

  return {
    goal: { category: category ?? 'any', budget: req.budget ?? null, use_case: uc, excluded_use_cases: req.exclude_use_cases ?? [], preferences: req.preferences ?? [] },
    weights: WEIGHTS,
    candidates_considered: candidates.length,
    excluded: excluded.slice(0, 8),
    recommendations: top.map((d, i) => ({ position: i + 1, ...d })),
    best_pick: best?.product_id ?? null,
    display_order_note: 'Positions are exactly what the customer sees: 1 = best pick, then alternatives by score; the cheapest option is tagged.',
    devils_advocate,
    note: candidates.length ? undefined : 'No in-stock product meets the hard constraints. Suggest raising budget or relaxing a requirement.',
  };
}

function critiqueAgainst(target: ScoredDeal, better: ScoredDeal, uc: UseCase) {
  const gap = better.scores.total - target.scores.total;
  const extra = better.final_price - target.final_price;
  const concerns = target.disadvantages.length ? target.disadvantages : [`Scores ${target.scores.total}/100 vs ${better.scores.total}/100 for ${USE_CASE_LABEL[uc]}`];
  return {
    product_id: target.product_id, name: target.name, final_price: target.final_price, score: target.scores.total,
    verdict: gap >= 8 ? 'reconsider' : 'acceptable',
    concerns,
    better_alternative: gap >= 8 ? {
      product_id: better.product_id, name: better.name, final_price: better.final_price, score: better.scores.total,
      extra_cost: extra, why: better.advantages.slice(0, 2),
    } : null,
    message: gap >= 8
      ? `Friendly tip: ${target.name} is the cheapest at ${inr(target.final_price)} — great price — but ${concerns[0].toLowerCase()}. For ${inr(extra)} more, ${better.name} (${inr(better.final_price)}) is a better fit for ${USE_CASE_LABEL[uc]} (${better.scores.total} vs ${target.scores.total}). Your call!`
      : `${target.name} is a reasonable budget choice for ${USE_CASE_LABEL[uc]}.`,
  };
}

/** Devil's advocate on a specific product the customer wants (e.g. "buy the cheapest"). */
export function critiqueChoice(sessionId: string, productId: string, goal: ShoppingGoal = {}) {
  const p = shop.getProduct(productId);
  const st = shop.sessionState(sessionId);
  const defined = Object.fromEntries(Object.entries(goal).filter(([, v]) => v !== undefined)) as ShoppingGoal;
  const g: ShoppingGoal = { ...st.goal, ...defined, category: p.category };
  const budget = g.budget ?? Math.round(p.price * 1.5);
  // Score the pool without mutating the conversation's shown list.
  const savedShown = st.shown, savedFocus = st.focusId, savedGoal = st.goal;
  const pool = findBestDeal(sessionId, { ...g, budget, limit: 6 });
  st.shown = savedShown; st.focusId = savedFocus; st.goal = savedGoal;
  const { uc } = profileFor(g);
  const all = pool.recommendations;
  let target = all.find((d) => d.product_id === p.id);
  if (!target) {
    const one = findBestDeal(sessionId, { ...g, budget: undefined, brand: p.brand, limit: 6 });
    st.shown = savedShown; st.focusId = savedFocus; st.goal = savedGoal;
    target = one.recommendations.find((d) => d.product_id === p.id);
  }
  if (!target) throw new shop.ShopError(`${p.name} cannot be evaluated (out of stock?)`);
  const best = all.find((d) => d.tags.includes('best_pick')) ?? all[0];
  const c = best && best.product_id !== target.product_id ? critiqueAgainst(target, best, uc) : null;
  return {
    product: { product_id: target.product_id, name: target.name, final_price: target.final_price, score: target.scores.total, advantages: target.advantages, disadvantages: target.disadvantages },
    use_case: uc,
    verdict: c?.verdict ?? 'good_choice',
    concerns: c?.concerns ?? target.disadvantages,
    better_alternative: c?.better_alternative ?? null,
    message: c?.message ?? `${target.name} is the top-scoring option for ${USE_CASE_LABEL[uc]} within budget.`,
  };
}
