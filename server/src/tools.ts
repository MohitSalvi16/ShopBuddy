import { z } from 'zod';
import * as shop from './shop.js';
import { findBestDeal, critiqueChoice } from './recommend.js';
import { emit } from './events.js';
import { getReviewInsights, rateProduct, reviewHighlights, purchasedProductIds } from './reviews.js';

/**
 * Agent tools. Each tool has a zod INPUT schema (validated, and converted to JSON Schema for the LLM),
 * an OUTPUT schema (checked on every call), and runs real backend logic against SQLite.
 * Every call returns a uniform envelope: { ok: true, tool, data } | { ok: false, tool, error: { code, message } }.
 */

const pid = z.string().min(2).describe('Product ID, e.g. HP-209').transform((s) => s.trim().toUpperCase());
const useCase = z.enum(['calls', 'gaming', 'music', 'travel', 'workout', 'general']);
const category = z.enum(['earbuds', 'headphones', 'smartwatch', 'speaker', 'accessory']);

const money = z.number();
const cartOut = z.object({ cart_id: z.string(), items: z.array(z.object({ product_id: z.string(), quantity: z.number() }).passthrough()), subtotal: money, discount: money, total: money }).passthrough();
const dealOut = z.object({
  product_id: z.string(), price: money, discount: money, final_price: money,
  scores: z.object({ requirement: z.number(), quality: z.number(), value: z.number(), preference: z.number(), total: z.number() }),
  advantages: z.array(z.string()), disadvantages: z.array(z.string()), reasoning: z.string(),
}).passthrough();

const TOOLS = {
  search_products: {
    description: 'Keyword/filter catalog search. Prefer find_best_deal when the customer has a budget or a goal. Results are shown as numbered cards.',
    input: z.object({
      query: z.string().default('').describe('Free-text need'),
      category: category.optional(),
      budget: z.coerce.number().positive().optional().describe('Max list price in INR'),
      min_price: z.coerce.number().nonnegative().optional(),
      preferences: z.array(z.string()).optional().describe('e.g. ["battery","sound","anc"]'),
      brand: z.string().optional(),
      require_anc: z.boolean().optional(),
      sort_by: z.enum(['relevance', 'battery', 'sound', 'anc', 'rating', 'price_low', 'price_high']).optional(),
      limit: z.coerce.number().int().min(1).max(6).optional(),
    }),
    output: z.object({ category: z.string(), total_matches: z.number(), items: z.array(z.object({ position: z.number(), id: z.string(), price: money }).passthrough()) }).passthrough(),
  },
  find_best_deal: {
    description: 'AI Budget Negotiator. Applies hard constraints (stock, final price <= budget, required features), prices every candidate with backend-verified best coupon, then ranks by score = 40% requirement match + 25% quality + 20% value + 15% preferences. Returns pros/cons/reasoning per product and a devils_advocate critique of the cheapest option. Results are shown as numbered cards.',
    input: z.object({
      query: z.string().optional(),
      category: category.optional(),
      budget: z.coerce.number().positive().optional().describe('Max final price in INR after coupons'),
      use_case: useCase.optional().describe('What the customer is trying to do; calls = office meetings/WFH'),
      exclude_use_cases: z.array(useCase).optional().describe('e.g. "gaming ke liye nahi" -> ["gaming"]'),
      preferences: z.array(z.string()).optional().describe('e.g. ["comfort","battery","mic","cheap"]'),
      brand: z.string().optional(),
      require_anc: z.boolean().optional(),
      require_wireless: z.boolean().optional(),
      cheaper_than_product_id: z.string().optional().describe('For "show something cheaper": only products priced below this one'),
      limit: z.coerce.number().int().min(1).max(6).optional(),
    }),
    output: z.object({ goal: z.object({}).passthrough(), recommendations: z.array(dealOut), best_pick: z.string().nullable(), devils_advocate: z.object({}).passthrough().nullable() }).passthrough(),
  },
  critique_choice: {
    description: "Shopping Devil's Advocate: evaluates a product the customer wants (e.g. the cheapest) against in-budget alternatives using real catalog attributes. Returns verdict (good_choice | acceptable | reconsider), concerns and a better alternative with the extra cost.",
    input: z.object({ product_id: pid, use_case: useCase.optional(), budget: z.coerce.number().positive().optional() }),
    output: z.object({ verdict: z.string(), concerns: z.array(z.string()), better_alternative: z.object({}).passthrough().nullable(), message: z.string() }).passthrough(),
  },
  get_review_insights: {
    description: "Customer reviews & rating for one product: overall rating, verdict, what buyers praise and what they complain about (with quotes), plus verified-buyer ratings. Use whenever the customer asks about a specific product (how is it, kaisa hai, reviews, is it good, worth it). Always tell BOTH the main praise and the main complaint.",
    input: z.object({ product_id: pid }),
    output: z.object({ product_id: z.string(), rating: z.number(), verdict: z.string(), praise: z.array(z.object({}).passthrough()), complaints: z.array(z.object({}).passthrough()) }).passthrough(),
  },
  rate_product: {
    description: 'Save the customer\'s 1-5 star rating (optional comment) for a product they BOUGHT in this session; updates the product\'s average rating. Only call with a rating the customer explicitly gave.',
    input: z.object({ product_id: pid, rating: z.coerce.number().int().min(1).max(5), comment: z.string().max(500).optional() }),
    output: z.object({ product_id: z.string(), your_rating: z.number(), new_average: z.number(), review_count: z.number() }).passthrough(),
  },
  get_product_details: {
    description: 'Full catalog specs for one product.',
    input: z.object({ product_id: pid }),
    output: z.object({ id: z.string(), price: money, specs: z.object({}).passthrough() }).passthrough(),
  },
  compare_products: {
    description: 'Side-by-side comparison of 2-3 products from catalog data, with final price after best verified coupon and which product wins each attribute. Shown as a comparison table.',
    input: z.object({ product_ids: z.array(pid).min(2).max(3) }),
    output: z.object({ products: z.array(z.object({ id: z.string(), final_price: money }).passthrough()), winners: z.record(z.string(), z.string()) }).passthrough(),
  },
  check_inventory: {
    description: 'Live stock level and delivery estimate.',
    input: z.object({ product_id: pid }),
    output: z.object({ product_id: z.string(), stock: z.number(), in_stock: z.boolean() }).passthrough(),
  },
  find_best_coupon: {
    description: 'Backend-verified coupon eligibility. With product_id: best coupon if that product were added to the current cart. Without: best coupon for the current cart.',
    input: z.object({ product_id: pid.optional(), cart_context: z.enum(['current_cart', 'with_product']).optional() }),
    output: z.object({ best_coupon: z.unknown(), coupons: z.array(z.object({ code: z.string() }).passthrough()) }).passthrough(),
  },
  add_to_cart: {
    description: 'Add a product to the cart (validates stock). May return an `advisor` critique if the product is a poor fit for the stated goal; mention it.',
    input: z.object({ product_id: pid, quantity: z.coerce.number().int().min(1).max(10).default(1) }),
    output: z.object({ added: z.object({ product_id: z.string(), quantity: z.number() }).passthrough(), cart: cartOut }).passthrough(),
  },
  remove_from_cart: {
    description: 'Remove a product from the cart.',
    input: z.object({ product_id: pid }),
    output: z.object({ removed: z.string(), cart: cartOut }).passthrough(),
  },
  apply_coupon: {
    description: 'Apply a coupon code to the cart. Fails unless the backend verifies eligibility.',
    input: z.object({ coupon_code: z.string().min(2) }),
    output: z.object({ applied: z.string(), savings: money, cart: cartOut }).passthrough(),
  },
  get_cart: {
    description: 'Current cart with backend-calculated subtotal, coupon, discount and total.',
    input: z.object({}),
    output: cartOut,
  },
  create_demo_order: {
    description: 'Demo checkout (no real payment). First call with confirmed=false: validates inventory and coupon, returns the summary and arms the order. Read the summary and ask for explicit confirmation. Only after the customer clearly says yes in their latest message, call with confirmed=true and expected_total from the summary.',
    input: z.object({ confirmed: z.boolean(), expected_total: z.coerce.number().optional().describe('Total from the summary the customer confirmed') }),
    output: z.object({ status: z.enum(['AWAITING_CONFIRMATION', 'ORDER_PLACED', 'ALREADY_PLACED']) }).passthrough(),
  },
  get_order_status: {
    description: 'Status of an order by ID; omit order_id for the latest order in this session.',
    input: z.object({ order_id: z.string().optional() }),
    output: z.object({ order_id: z.string(), status: z.string(), total: money }).passthrough(),
  },
} as const;

export type ToolName = keyof typeof TOOLS;
export const TOOL_NAMES = Object.keys(TOOLS) as ToolName[];

const jsonSchema = (s: z.ZodType) => {
  const j = z.toJSONSchema(s, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  delete j.$schema;
  return j;
};

/** OpenAI-format tool definitions for the LLM. */
export const TOOL_DEFS = TOOL_NAMES.map((name) => ({
  type: 'function' as const,
  function: { name, description: TOOLS[name].description, parameters: jsonSchema(TOOLS[name].input) },
}));

/** Public description of every tool (input + output schema) — served at GET /api/tools. */
export const TOOL_CATALOG = TOOL_NAMES.map((name) => ({
  name, description: TOOLS[name].description, input_schema: jsonSchema(TOOLS[name].input), output_schema: jsonSchema(TOOLS[name].output),
}));

export type ToolResult =
  | { ok: true; tool: string; data: any }
  | { ok: false; tool: string; error: { code: string; message: string; issues?: string[] } };

/** Executes a tool against the real backend, pushes UI updates, returns a structured envelope. */
export function executeTool(sessionId: string, name: string, rawArgs: unknown): ToolResult {
  const def = TOOLS[name as ToolName];
  if (!def) return { ok: false, tool: name, error: { code: 'UNKNOWN_TOOL', message: `Unknown tool ${name}` } };
  const parsed = def.input.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`);
    emit(sessionId, { type: 'tool', name, args: rawArgs, ok: false, error: 'invalid input' });
    return { ok: false, tool: name, error: { code: 'INVALID_INPUT', message: 'Invalid tool input', issues } };
  }
  const a: any = parsed.data;
  try {
    const data = run(sessionId, name as ToolName, a);
    const out = def.output.safeParse(data);
    if (!out.success) console.warn(`[tool ${name}] output schema mismatch:`, out.error.issues.slice(0, 3));
    emit(sessionId, { type: 'tool', name, args: a, ok: true });
    return { ok: true, tool: name, data };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    emit(sessionId, { type: 'tool', name, args: a, ok: false, error: msg });
    if (e instanceof shop.ShopError) return { ok: false, tool: name, error: { code: e.code, message: msg } };
    console.error(`[tool ${name}]`, e);
    return { ok: false, tool: name, error: { code: 'INTERNAL', message: 'Internal error executing tool' } };
  }
}

function slim(p: shop.Product) {
  return { id: p.id, name: p.name, brand: p.brand, category: p.category, price: p.price, mrp: p.mrp, rating: p.rating, reviews: p.reviews, stock: p.stock, highlights: p.highlights, specs: p.specs };
}

const LOWER_BETTER = new Set(['latency_ms', 'weight_g']);

function run(sessionId: string, name: ToolName, a: any): unknown {
  const st = shop.sessionState(sessionId);
  switch (name) {
    case 'search_products': {
      const prefSort = (a.preferences ?? []).map((x: string) => x.toLowerCase()).find((x: string) => ['battery', 'sound', 'anc'].includes(x));
      const r = shop.searchProducts(a.query, { category: a.category, maxPrice: a.budget, minPrice: a.min_price, brand: a.brand, requireAnc: a.require_anc, sortBy: a.sort_by ?? prefSort, limit: a.limit });
      st.shown = r.items.map((p) => p.id);
      st.focusId = st.shown[0];
      if (a.category || r.category !== 'any') st.goal = { ...st.goal, category: a.category ?? r.category, budget: a.budget ?? st.goal.budget };
      const title = [r.category !== 'any' ? r.category : 'products', a.budget ? `under ₹${a.budget.toLocaleString('en-IN')}` : '', a.sort_by && a.sort_by !== 'relevance' ? `· best ${a.sort_by.replace('_', ' ')}` : ''].filter(Boolean).join(' ');
      emit(sessionId, { type: 'products', title, items: r.items });
      return { ...r, items: r.items.map((p, i) => ({ position: i + 1, ...slim(p) })) };
    }
    case 'find_best_deal': {
      let maxBelow: number | undefined;
      if (a.cheaper_than_product_id) {
        const ref = shop.getProduct(a.cheaper_than_product_id);
        maxBelow = ref.price;
        a.category ??= ref.category; // "isse sasta" = a cheaper one of the same kind
      }
      const goal = { ...st.goal, ...Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined)) };
      const r = findBestDeal(sessionId, { ...goal, max_price_below: maxBelow, limit: a.limit });
      for (const d of r.recommendations) d.review = reviewHighlights(d.product_id, r.goal.use_case);
      const label = `${r.goal.category === 'any' ? 'products' : r.goal.category} for ${r.goal.use_case}${r.goal.budget ? ` · budget ₹${Number(r.goal.budget).toLocaleString('en-IN')}` : ''}${maxBelow ? ` · cheaper than ₹${maxBelow.toLocaleString('en-IN')}` : ''}`;
      emit(sessionId, { type: 'deal', title: label, result: r, items: r.recommendations.map((d) => shop.getProduct(d.product_id)) });
      return r;
    }
    case 'get_review_insights': {
      const r = getReviewInsights(a.product_id, st.goal.use_case ?? 'general');
      st.focusId = r.product_id;
      emit(sessionId, { type: 'reviews', insights: r });
      return r;
    }
    case 'rate_product': {
      const r = rateProduct(sessionId, a.product_id, a.rating, a.comment);
      emit(sessionId, { type: 'reviews', insights: r.insights, rated: { rating: r.your_rating, new_average: r.new_average } });
      return { ...r, insights: undefined };
    }
    case 'critique_choice': {
      const r = critiqueChoice(sessionId, a.product_id, { use_case: a.use_case, budget: a.budget });
      emit(sessionId, { type: 'critique', critique: r });
      return r;
    }
    case 'get_product_details': {
      const p = shop.getProduct(a.product_id);
      st.focusId = p.id;
      emit(sessionId, { type: 'focus', product: p });
      return slim(p);
    }
    case 'compare_products': {
      const items = a.product_ids.map((id: string) => shop.getProduct(id));
      const priced = items.map((p: shop.Product) => {
        const c = shop.findBestCoupon(sessionId, p.id);
        return { ...slim(p), best_coupon: c.best_coupon, final_price: p.price - (c.best_coupon?.discount ?? 0) };
      });
      const winners: Record<string, string> = {};
      const keys = new Set<string>(items.flatMap((p: shop.Product) => Object.keys(p.specs)));
      for (const k of keys) {
        const vals = items.map((p: shop.Product) => p.specs[k]);
        if (vals.every((v: unknown) => typeof v === 'number')) {
          const nums = vals as number[];
          const best = LOWER_BETTER.has(k) ? Math.min(...nums) : Math.max(...nums);
          if (nums.filter((n) => n === best).length === 1) winners[k] = items[nums.indexOf(best)].id;
        } else if (vals.every((v: unknown) => typeof v === 'boolean') && vals.filter(Boolean).length === 1) {
          winners[k] = items[vals.indexOf(true)].id;
        }
      }
      const finals = priced.map((p: any) => p.final_price);
      winners.final_price = items[finals.indexOf(Math.min(...finals))].id;
      const ratings = items.map((p: shop.Product) => p.rating);
      winners.rating = items[ratings.indexOf(Math.max(...ratings))].id;
      emit(sessionId, { type: 'comparison', items: priced });
      return { products: priced, winners };
    }
    case 'check_inventory': return shop.checkInventory(a.product_id);
    case 'find_best_coupon': {
      if (a.product_id && a.cart_context !== 'current_cart') return shop.findBestCoupon(sessionId, a.product_id);
      const lc = shop.listCoupons(sessionId);
      const best = lc.coupons.filter((c) => c.eligible).sort((x, y) => y.estimated_discount - x.estimated_discount)[0];
      return { cart_subtotal: lc.cart_subtotal, coupons: lc.coupons, best_coupon: best ? { code: best.code, discount: best.estimated_discount } : null };
    }
    case 'add_to_cart': {
      const r = shop.addToCart(sessionId, a.product_id, a.quantity);
      st.focusId = r.added.product_id;
      emit(sessionId, { type: 'cart', cart: r.cart });
      let advisor = null;
      if (st.goal.use_case) {
        try {
          const c = critiqueChoice(sessionId, r.added.product_id, {});
          if (c.verdict === 'reconsider') { advisor = c; emit(sessionId, { type: 'critique', critique: c }); }
        } catch { /* advisory only */ }
      }
      return { ...r, advisor };
    }
    case 'remove_from_cart': { const r = shop.removeFromCart(sessionId, a.product_id); emit(sessionId, { type: 'cart', cart: r.cart }); return r; }
    case 'get_cart': { const c = shop.getCart(sessionId); emit(sessionId, { type: 'cart', cart: c }); return c; }
    case 'apply_coupon': { const r = shop.applyCoupon(sessionId, a.coupon_code); emit(sessionId, { type: 'cart', cart: r.cart }); return r; }
    case 'create_demo_order': {
      const r = shop.createOrder(sessionId, a.confirmed, a.expected_total);
      if (r.status === 'ORDER_PLACED') {
        emit(sessionId, { type: 'order', order: r.order });
        emit(sessionId, { type: 'cart', cart: shop.getCart(sessionId) });
      } else if (r.status === 'AWAITING_CONFIRMATION') emit(sessionId, { type: 'checkout', summary: r.summary });
      return r;
    }
    case 'get_order_status': {
      if (a.order_id) return shop.getOrderStatus(a.order_id);
      const [latest] = shop.latestOrders(sessionId, 1);
      if (!latest) throw new shop.ShopError('No orders yet in this session', 'NOT_FOUND');
      return latest;
    }
  }
}

/** Compact live-state block so the LLM can resolve "first one", "second wala", "something cheaper". */
export function contextSnapshot(sessionId: string) {
  const st = shop.sessionState(sessionId);
  const shown = st.shown.map((id, i) => {
    try { const p = shop.getProduct(id); return `${i + 1}. ${p.id} — ${p.brand} ${p.name}, ₹${p.price}`; } catch { return null; }
  }).filter(Boolean);
  const cart = shop.getCart(sessionId);
  const g = st.goal;
  return [
    `Shopping goal so far: ${Object.keys(g).length ? JSON.stringify(g) : 'unknown'}`,
    `Products currently shown on screen (in order): ${shown.length ? '\n' + shown.join('\n') : 'none'}`,
    `Product in focus: ${st.focusId ?? 'none'}`,
    `Cart: ${cart.items.length ? cart.items.map((i) => `${i.quantity}x ${i.name} (${i.product_id})`).join(', ') + `; subtotal ₹${cart.subtotal}, discount ₹${cart.discount}${cart.coupon ? ` (${cart.coupon.code})` : ''}, total ₹${cart.total}` : 'empty'}`,
    `Checkout summary shown and awaiting confirmation: ${st.pendingOrder ? `YES (total ₹${cart.total})` : 'no'}`,
    st.lastOrder ? `Last order placed: ${st.lastOrder.orderId}` : '',
    purchasedProductIds(sessionId).length ? `Products the customer bought (can be rated): ${purchasedProductIds(sessionId).join(', ')}` : '',
  ].filter(Boolean).join('\n');
}
