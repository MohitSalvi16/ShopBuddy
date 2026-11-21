import crypto from 'node:crypto';
import { db } from './db.js';
import { COUPONS, type CouponCode } from './catalog.js';

export interface Product {
  id: string; name: string; brand: string; category: string;
  price: number; mrp: number; rating: number; reviews: number; stock: number;
  highlights: string[]; specs: Record<string, string | number | boolean>; image: string;
}

type Row = Record<string, any>;

function toProduct(r: Row): Product {
  return {
    id: r.id, name: r.name, brand: r.brand, category: r.category,
    price: Number(r.price), mrp: Number(r.mrp), rating: Math.round(Number(r.rating) * 100) / 100, reviews: Number(r.reviews),
    stock: Number(r.stock), highlights: JSON.parse(r.highlights), specs: JSON.parse(r.specs), image: r.image,
  };
}

export type ErrorCode = 'NOT_FOUND' | 'OUT_OF_STOCK' | 'INVALID_QUANTITY' | 'COUPON_INVALID' | 'CART_EMPTY' | 'CART_CHANGED' | 'NOT_PURCHASED' | 'BUSINESS_RULE';
/** Indian-format rupees for user-facing text: 1169 -> "₹1,169". */
export const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export class ShopError extends Error {
  constructor(message: string, public code: ErrorCode = 'BUSINESS_RULE') { super(message); }
}

// ---------------------------------------------------------------- session memory
// Ordered list of products currently shown to the user so the LLM can resolve "the second one".
export type LangPref = 'auto' | 'en' | 'hi' | 'hinglish';
export type UseCase = 'calls' | 'gaming' | 'music' | 'travel' | 'workout' | 'general';
export interface ShoppingGoal {
  category?: string; budget?: number; use_case?: UseCase; exclude_use_cases?: UseCase[];
  preferences?: string[]; brand?: string; require_anc?: boolean; require_wireless?: boolean;
}
interface SessionState {
  shown: string[];
  /** Last shopping goal (budget, category, use case...) so follow-ups like "show something cheaper" work. */
  goal: ShoppingGoal;
  /** Product the conversation is currently about (top pick, or last one added/compared). */
  focusId?: string;
  pendingOrder?: { cartId: string; fingerprint: string; at: number; turn?: number };
  /** Conversation turn counter: the summary must be shown in an EARLIER turn than the confirmation. */
  turn?: number;
  inTurn?: boolean;
  /** Customer's chosen reply language ('auto' = match how they speak). Shared by text, Lite voice and Agora. */
  language?: LangPref;
  lastOrder?: { orderId: string; cartId: string; at: number };
}
const sessions = new Map<string, SessionState>();
export function sessionState(sessionId: string): SessionState {
  let s = sessions.get(sessionId);
  if (!s) { s = { shown: [], goal: {} }; sessions.set(sessionId, s); }
  return s;
}

// ---------------------------------------------------------------- catalog
const CATEGORY_SYNONYMS: Record<string, string[]> = {
  earbuds: ['earbud', 'earbuds', 'tws', 'buds', 'earphone', 'earphones', 'airpods', 'in-ear', 'wireless earbuds'],
  headphones: ['headphone', 'headphones', 'headset', 'over-ear', 'on-ear'],
  smartwatch: ['watch', 'smartwatch', 'smart watch', 'fitness band', 'ghadi'],
  speaker: ['speaker', 'speakers', 'bluetooth speaker', 'party speaker'],
  accessory: ['charger', 'cable', 'power bank', 'powerbank', 'adapter', 'accessory', 'accessories', 'wireless charger'],
};

export function detectCategory(text: string): string | undefined {
  const t = text.toLowerCase();
  // headphones before earbuds so "headphones" is not caught by "phone"
  for (const cat of ['headphones', 'earbuds', 'smartwatch', 'speaker', 'accessory']) {
    if (CATEGORY_SYNONYMS[cat].some((w) => t.includes(w))) return cat;
  }
  return undefined;
}

export type SortBy = 'relevance' | 'battery' | 'sound' | 'anc' | 'rating' | 'price_low' | 'price_high';

export interface SearchFilters {
  category?: string; minPrice?: number; maxPrice?: number; brand?: string;
  requireAnc?: boolean; sortBy?: SortBy; inStockOnly?: boolean; limit?: number;
}

export function searchProducts(query: string, filters: SearchFilters = {}) {
  const category = filters.category || detectCategory(query || '');
  let rows = (db.prepare('SELECT * FROM products').all() as Row[]).map(toProduct);
  if (category) rows = rows.filter((p) => p.category === category);
  if (filters.maxPrice != null) rows = rows.filter((p) => p.price <= filters.maxPrice!);
  if (filters.minPrice != null) rows = rows.filter((p) => p.price >= filters.minPrice!);
  if (filters.brand) rows = rows.filter((p) => p.brand.toLowerCase().includes(filters.brand!.toLowerCase()));
  if (filters.requireAnc) rows = rows.filter((p) => p.specs.anc === true);
  const excludedOutOfStock = rows.filter((p) => p.stock <= 0).map((p) => p.name);
  if (filters.inStockOnly !== false) rows = rows.filter((p) => p.stock > 0);

  const terms = (query || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const textScore = (p: Product) => {
    const hay = `${p.name} ${p.brand} ${p.highlights.join(' ')}`.toLowerCase();
    return terms.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
  };
  const battery = (p: Product) => Number(p.specs.battery_hours ?? (Number(p.specs.battery_days ?? 0) * 24));
  const sorters: Record<SortBy, (a: Product, b: Product) => number> = {
    relevance: (a, b) => textScore(b) - textScore(a) || b.rating - a.rating,
    battery: (a, b) => battery(b) - battery(a),
    sound: (a, b) => Number(b.specs.sound_score ?? 0) - Number(a.specs.sound_score ?? 0),
    anc: (a, b) => Number(b.specs.anc === true) - Number(a.specs.anc === true) || b.rating - a.rating,
    rating: (a, b) => b.rating - a.rating,
    price_low: (a, b) => a.price - b.price,
    price_high: (a, b) => b.price - a.price,
  };
  rows.sort(sorters[filters.sortBy || 'relevance']);
  const total = rows.length;
  const items = rows.slice(0, Math.min(Math.max(filters.limit ?? 3, 1), 6));
  return { category: category ?? 'any', total_matches: total, excluded_out_of_stock: excludedOutOfStock, items };
}

export function getProduct(productId: string): Product {
  const r = db.prepare('SELECT * FROM products WHERE id = ?').get(productId.toUpperCase()) as Row | undefined;
  if (!r) throw new ShopError(`Product ${productId} not found`, 'NOT_FOUND');
  return toProduct(r);
}

export function checkInventory(productId: string) {
  const p = getProduct(productId);
  const eta = new Date(Date.now() + (p.stock > 10 ? 2 : 4) * 86400000);
  return {
    product_id: p.id, name: p.name, stock: p.stock, in_stock: p.stock > 0,
    status: p.stock === 0 ? 'OUT_OF_STOCK' : p.stock < 10 ? 'LOW_STOCK' : 'IN_STOCK',
    estimated_delivery: p.stock > 0 ? eta.toDateString() : null,
  };
}

// ---------------------------------------------------------------- cart
function openCartId(sessionId: string): string {
  const r = db.prepare("SELECT id FROM carts WHERE session_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1").get(sessionId) as Row | undefined;
  if (r) return r.id;
  const id = 'CART-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  db.prepare('INSERT INTO carts (id, session_id) VALUES (?, ?)').run(id, sessionId);
  return id;
}

export function computeDiscount(code: string | null, subtotal: number) {
  if (!code) return { discount: 0, valid: false, reason: 'no coupon' };
  const c = COUPONS[code as CouponCode];
  if (!c) return { discount: 0, valid: false, reason: 'unknown coupon' };
  if (c.minOrder > 0 && !(subtotal > c.minOrder)) return { discount: 0, valid: false, reason: `requires order above ${inr(c.minOrder)}` };
  if (subtotal <= 0) return { discount: 0, valid: false, reason: 'cart is empty' };
  const raw = c.type === 'percent' ? Math.round((subtotal * c.value) / 100) : c.value;
  return { discount: Math.min(raw, c.maxDiscount, subtotal), valid: true, reason: c.description };
}

export function getCart(sessionId: string) {
  const cartId = openCartId(sessionId);
  const cart = db.prepare('SELECT * FROM carts WHERE id = ?').get(cartId) as Row;
  const items = (db.prepare(`
    SELECT ci.product_id, ci.quantity, p.name, p.brand, p.price, p.image, p.stock
    FROM cart_items ci JOIN products p ON p.id = ci.product_id WHERE ci.cart_id = ?`).all(cartId) as Row[])
    .map((r) => ({ product_id: r.product_id, name: r.name, brand: r.brand, price: Number(r.price), quantity: Number(r.quantity), image: r.image, line_total: Number(r.price) * Number(r.quantity), stock: Number(r.stock) }));
  const subtotal = items.reduce((s, i) => s + i.line_total, 0);
  const d = computeDiscount(cart.coupon_code, subtotal);
  return {
    cart_id: cartId, items, item_count: items.reduce((s, i) => s + i.quantity, 0), subtotal,
    coupon: cart.coupon_code ? { code: cart.coupon_code, valid: d.valid, note: d.reason } : null,
    discount: d.discount, delivery_fee: 0, total: subtotal - d.discount, currency: 'INR',
  };
}

export function addToCart(sessionId: string, productId: string, quantity = 1) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) throw new ShopError('Quantity must be between 1 and 10', 'INVALID_QUANTITY');
  const p = getProduct(productId);
  const cartId = openCartId(sessionId);
  const existing = db.prepare('SELECT quantity FROM cart_items WHERE cart_id = ? AND product_id = ?').get(cartId, p.id) as Row | undefined;
  const newQty = (existing ? Number(existing.quantity) : 0) + quantity;
  if (p.stock <= 0) throw new ShopError(`${p.name} is out of stock`, 'OUT_OF_STOCK');
  if (newQty > p.stock) throw new ShopError(`Only ${p.stock} units of ${p.name} in stock`, 'OUT_OF_STOCK');
  db.prepare(`INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?)
    ON CONFLICT(cart_id, product_id) DO UPDATE SET quantity = excluded.quantity`).run(cartId, p.id, newQty);
  sessionState(sessionId).pendingOrder = undefined;
  return { added: { product_id: p.id, name: p.name, quantity }, cart: getCart(sessionId) };
}

export function removeFromCart(sessionId: string, productId: string) {
  const cartId = openCartId(sessionId);
  const res = db.prepare('DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?').run(cartId, productId.toUpperCase());
  if (!res.changes) throw new ShopError(`${productId} is not in the cart`, 'NOT_FOUND');
  sessionState(sessionId).pendingOrder = undefined;
  return { removed: productId, cart: getCart(sessionId) };
}

export function listCoupons(sessionId: string) {
  const cart = getCart(sessionId);
  const coupons = Object.values(COUPONS).map((c) => {
    const d = computeDiscount(c.code, cart.subtotal);
    return { code: c.code, description: c.description, eligible: d.valid, estimated_discount: d.discount, note: d.reason };
  });
  const best = coupons.filter((c) => c.eligible).sort((a, b) => b.estimated_discount - a.estimated_discount)[0];
  return { cart_subtotal: cart.subtotal, coupons, best_coupon: best?.code ?? null };
}

/**
 * Best verified coupon if `productId` (x quantity) were added to the current cart.
 * Eligibility is evaluated by the same backend rules applyCoupon enforces.
 */
export function findBestCoupon(sessionId: string, productId: string, quantity = 1) {
  const p = getProduct(productId);
  const cart = getCart(sessionId);
  const alreadyIn = cart.items.some((i) => i.product_id === p.id);
  const subtotal = cart.subtotal + p.price * quantity;
  const evaluated = Object.values(COUPONS).map((c) => {
    const d = computeDiscount(c.code, subtotal);
    return { code: c.code, description: c.description, eligible: d.valid, discount: d.discount, reason: d.reason };
  });
  const best = evaluated.filter((c) => c.eligible).sort((a, b) => b.discount - a.discount)[0] ?? null;
  return {
    product_id: p.id, product_price: p.price, quantity, cart_subtotal_before: cart.subtotal, cart_subtotal_after: subtotal,
    product_already_in_cart: alreadyIn, coupons: evaluated, best_coupon: best ? { code: best.code, discount: best.discount } : null,
    final_cart_total: subtotal - (best?.discount ?? 0),
  };
}

export function applyCoupon(sessionId: string, code: string) {
  const norm = code.trim().toUpperCase();
  const cart = getCart(sessionId);
  const d = computeDiscount(norm, cart.subtotal);
  if (!COUPONS[norm as CouponCode]) throw new ShopError(`Coupon ${norm} does not exist`, 'COUPON_INVALID');
  if (!d.valid) throw new ShopError(`Coupon ${norm} not applicable: ${d.reason}`, 'COUPON_INVALID');
  db.prepare('UPDATE carts SET coupon_code = ? WHERE id = ?').run(norm, cart.cart_id);
  sessionState(sessionId).pendingOrder = undefined;
  return { applied: norm, savings: d.discount, cart: getCart(sessionId) };
}

// ---------------------------------------------------------------- orders
function fingerprint(cart: ReturnType<typeof getCart>) {
  return JSON.stringify([cart.items.map((i) => [i.product_id, i.quantity]), cart.coupon?.code, cart.total]);
}

const CONFIRM_WINDOW_MS = 10 * 60 * 1000;

/**
 * Two-step checkout. confirmation=false returns a summary and arms the order.
 * confirmation=true only succeeds if a summary for the *same* cart was shown first.
 */
const DUPLICATE_WINDOW_MS = 5 * 60 * 1000;

export function createOrder(sessionId: string, confirmation: boolean, expectedTotal?: number) {
  const cart = getCart(sessionId);
  const st0 = sessionState(sessionId);
  if (!cart.items.length) {
    // Repeated "yes, confirm" after an order was just placed: return it instead of failing or duplicating.
    if (confirmation && st0.lastOrder && Date.now() - st0.lastOrder.at < DUPLICATE_WINDOW_MS) {
      return { status: 'ALREADY_PLACED' as const, message: 'This order was already placed; no duplicate created.', order: getOrderStatus(st0.lastOrder.orderId) };
    }
    throw new ShopError('Cart is empty — add a product first', 'CART_EMPTY');
  }
  if (confirmation && expectedTotal != null && Math.round(expectedTotal) !== cart.total) {
    st0.pendingOrder = undefined;
    throw new ShopError(`Cart total changed (now ${inr(cart.total)}, expected ${inr(Math.round(expectedTotal))}). Please review the new summary.`, 'CART_CHANGED');
  }
  for (const i of cart.items) if (i.quantity > i.stock) throw new ShopError(`Only ${i.stock} units of ${i.name} left`, 'OUT_OF_STOCK');
  const st = sessionState(sessionId);
  const fp = fingerprint(cart);
  const armed = st.pendingOrder && st.pendingOrder.cartId === cart.cart_id && st.pendingOrder.fingerprint === fp && Date.now() - st.pendingOrder.at < CONFIRM_WINDOW_MS;
  // An LLM must not arm and confirm inside the same turn: the customer has to see the summary first.
  const sameTurn = Boolean(armed && st.inTurn && st.pendingOrder?.turn != null && st.pendingOrder.turn === st.turn);

  if (confirmation && sameTurn) {
    return { status: 'AWAITING_CONFIRMATION' as const, message: 'Summary was generated in this same turn. Read it to the customer and wait for an explicit yes in their NEXT message.', summary: cart, payment: 'SIMULATED (no real payment)' };
  }
  if (!confirmation || !armed) {
    st.pendingOrder = { cartId: cart.cart_id, fingerprint: fp, at: Date.now(), turn: st.inTurn ? st.turn : undefined };
    return {
      status: 'AWAITING_CONFIRMATION' as const,
      message: !armed && confirmation ?'Summary must be confirmed by the customer first. Read it out and ask for an explicit yes.' : 'Read this summary to the customer and ask for explicit confirmation.',
      summary: cart, payment: 'SIMULATED (no real payment)',
    };
  }

  const orderId = `VC-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  db.exec('BEGIN');
  try {
    db.prepare(`INSERT INTO orders (id, session_id, cart_id, subtotal, discount, total, coupon_code, status, payment)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', 'SIMULATED_PREPAID')`).run(orderId, sessionId, cart.cart_id, cart.subtotal, cart.discount, cart.total, cart.coupon?.valid ? cart.coupon.code : null);
    const oi = db.prepare('INSERT INTO order_items (order_id, product_id, name, price, quantity) VALUES (?, ?, ?, ?, ?)');
    const dec = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?');
    for (const i of cart.items) {
      oi.run(orderId, i.product_id, i.name, i.price, i.quantity);
      if (!dec.run(i.quantity, i.product_id, i.quantity).changes) throw new ShopError(`${i.name} went out of stock`, 'OUT_OF_STOCK');
    }
    db.prepare("UPDATE carts SET status = 'ordered' WHERE id = ?").run(cart.cart_id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  st.pendingOrder = undefined;
  st.lastOrder = { orderId, cartId: cart.cart_id, at: Date.now() };
  return { status: 'ORDER_PLACED' as const, order: getOrderStatus(orderId) };
}

export function getOrderStatus(orderId: string) {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId.toUpperCase()) as Row | undefined;
  if (!o) throw new ShopError(`Order ${orderId} not found`, 'NOT_FOUND');
  const items = (db.prepare('SELECT product_id, name, price, quantity FROM order_items WHERE order_id = ?').all(o.id) as Row[])
    .map((r) => ({ product_id: r.product_id, name: r.name, price: Number(r.price), quantity: Number(r.quantity) }));
  const created = new Date(o.created_at + 'Z');
  return {
    order_id: o.id, status: o.status, payment: o.payment, items,
    subtotal: Number(o.subtotal), discount: Number(o.discount), total: Number(o.total), coupon_code: o.coupon_code,
    created_at: created.toISOString(), estimated_delivery: new Date(created.getTime() + 3 * 86400000).toDateString(),
  };
}

export function latestOrders(sessionId: string, limit = 5) {
  return (db.prepare('SELECT id FROM orders WHERE session_id = ? ORDER BY created_at DESC LIMIT ?').all(sessionId, limit) as Row[]).map((r) => getOrderStatus(r.id));
}

/** Find a product the customer named ("how is the Jabra?", "H390 kaisa hai"). Returns the best match or undefined. */
export function findProductMention(text: string): string | undefined {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9\u0900-\u097F]+/g, ' ')} `;
  let best: { id: string; score: number } | undefined;
  for (const r of db.prepare('SELECT id, name, brand FROM products').all() as { id: string; name: string; brand: string }[]) {
    const name = r.name.toLowerCase();
    let score = t.includes(` ${name.replace(/[^a-z0-9]+/g, ' ').trim()} `) ? 10 : 0;
    for (const tok of name.split(/[^a-z0-9]+/).filter((x) => x.length >= 3 && !['pro', 'max', 'lite', 'buds', 'watch', 'over', 'ear', 'usb', 'headset', 'wireless'].includes(x))) {
      if (t.includes(` ${tok} `)) score += /\d/.test(tok) ? 4 : 2;
    }
    if (t.includes(` ${r.brand.toLowerCase().split(' ')[0]} `)) score += 1;
    if (score >= 2 && (!best || score > best.score)) best = { id: r.id, score };
  }
  return best?.id;
}
