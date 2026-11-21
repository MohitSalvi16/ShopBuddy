import { AnimatePresence, motion } from 'framer-motion';
import { Star, ShoppingCart, Trash2, Tag, PackageCheck, Battery, Activity, CheckCircle2, XCircle, Scale, X } from 'lucide-react';
import { useStore } from '../store';
import { api, inr } from '../lib/api';
import type { PricedProduct, Product } from '../lib/types';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { cn } from '../lib/utils';
import { DealCard } from './DealPanels';

const SPEC_LABEL: Record<string, string> = {
  battery_hours: 'Battery (h)', battery_days: 'Battery (days)', anc: 'ANC', driver_mm: 'Driver (mm)', bluetooth: 'Bluetooth',
  water_resistance: 'Water resistance', latency_ms: 'Latency (ms)', fast_charge: 'Fast charge', sound_score: 'Sound score /10',
  display: 'Display', calling: 'BT calling', gps: 'GPS', sensors: 'Sensors', output_w: 'Output (W)', tws_pairing: 'Stereo pairing',
  capacity_mah: 'Capacity (mAh)', ports: 'Ports', weight_g: 'Weight (g)', foldable: 'Foldable', length_m: 'Length (m)',
  max_power_w: 'Max power (W)', braided: 'Braided', gan: 'GaN', magnetic: 'Magnetic', cable: 'Cable',
  mic_score: 'Mic quality /10', comfort_score: 'Comfort /10', multipoint: 'Multipoint', wireless: 'Wireless', connection: 'Connection',
};
const fmt = (v: unknown) => (v === true ? 'Yes' : v === false ? 'No' : String(v));
const onErr = (e: unknown) => useStore.getState().set({ error: e instanceof Error ? e.message : String(e) });

function StockBadge({ stock }: { stock: number }) {
  if (stock <= 0) return <Badge variant="danger">Out of stock</Badge>;
  if (stock < 10) return <Badge variant="warn">Only {stock} left</Badge>;
  return <Badge variant="success">In stock</Badge>;
}

function ProductCard({ p, index }: { p: Product; index: number }) {
  const inCart = useStore((s) => s.cart?.items.some((i) => i.product_id === p.id));
  const off = Math.round((1 - p.price / p.mrp) * 100);
  return (
    <motion.div layout initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: index * 0.08 }}
      className="glass group relative overflow-hidden p-0 transition hover:border-vaani-cyan/40 hover:shadow-[0_0_32px_rgb(34_211_238/0.15)]">
      <span className="absolute left-3 top-3 z-10 grid size-7 place-items-center rounded-full bg-navy-900/80 font-display text-sm font-bold text-vaani-cyan ring-1 ring-vaani-cyan/40">{index + 1}</span>
      <img src={p.image} alt={p.name} className="aspect-[4/3] w-full object-cover opacity-90 transition group-hover:scale-[1.03]" />
      <div className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-wider text-slate-400">{p.brand}</p>
            <p className="font-semibold leading-snug">{p.name}</p>
          </div>
          <span className="flex items-center gap-1 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-xs text-emerald-300"><Star className="size-3 fill-current" />{p.rating}</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="font-display text-xl font-bold">{inr(p.price)}</span>
          <span className="text-xs text-slate-500 line-through">{inr(p.mrp)}</span>
          <span className="text-xs font-semibold text-vaani-cyan">{off}% off</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {p.specs.battery_hours != null && <Badge variant="cyan"><Battery className="size-3" />{fmt(p.specs.battery_hours)}h</Badge>}
          {p.specs.anc === true && <Badge>ANC</Badge>}
          <StockBadge stock={p.stock} />
        </div>
        <ul className="space-y-0.5 text-xs text-slate-400">{p.highlights.slice(0, 2).map((h) => <li key={h}>• {h}</li>)}</ul>
        <Button size="sm" variant={inCart ? 'secondary' : 'default'} className="mt-1 w-full" disabled={p.stock <= 0}
          onClick={() => api.addToCart(p.id).catch(onErr)}>
          <ShoppingCart /> {inCart ? 'Add one more' : 'Add to cart'}
        </Button>
      </div>
    </motion.div>
  );
}

export function Results() {
  const results = useStore((s) => s.results);
  if (!results) {
    return (
      <Card className="grid min-h-48 place-items-center p-8 text-center">
        <div>
          <p className="font-display text-lg font-semibold">Recommendations appear here</p>
          <p className="mt-1 text-sm text-slate-400">Try: "Bhai, ₹5,000 ke andar office calls ke liye best headphones chahiye"</p>
        </div>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader><CardTitle>{results.deals ? 'Best deals' : 'Top picks'} · <span className="normal-case tracking-normal text-slate-400">{results.title}</span></CardTitle></CardHeader>
      <CardContent>
        {results.deals ? (
          results.deals.recommendations.length === 0
            ? <p className="text-sm text-slate-400">No in-stock product meets the hard constraints. Try a higher budget.</p>
            : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{results.deals.recommendations.map((d, i) => <DealCard key={d.product_id} d={d} index={i} />)}</div>
        ) : results.items.length === 0 ? <p className="text-sm text-slate-400">No in-stock products match.</p> : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <AnimatePresence mode="popLayout">{results.items.map((p, i) => <ProductCard key={p.id} p={p} index={i} />)}</AnimatePresence>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function Comparison() {
  const items = useStore((s) => s.comparison);
  const set = useStore((s) => s.set);
  if (!items?.length) return null;
  const keys = Array.from(new Set(items.flatMap((p) => Object.keys(p.specs))));
  const best = (k: string) => {
    const nums = items.map((p) => Number(p.specs[k]));
    if (nums.some(Number.isNaN)) return -1;
    const lowerBetter = k === 'latency_ms' || k === 'weight_g';
    return nums.indexOf(lowerBetter ? Math.min(...nums) : Math.max(...nums));
  };
  const rows: [string, (p: PricedProduct) => string, number][] = [
    ['Price', (p) => inr(p.price), items.map((p) => p.price).indexOf(Math.min(...items.map((p) => p.price)))],
    ...(items.every((p) => p.final_price != null) ? [['Final price (verified coupon)', (p: PricedProduct) => `${inr(p.final_price!)}${p.best_coupon ? ` · ${p.best_coupon.code}` : ''}`, items.map((p) => p.final_price!).indexOf(Math.min(...items.map((p) => p.final_price!)))] as [string, (p: PricedProduct) => string, number]] : []),
    ['Rating', (p) => `${p.rating} ★ (${p.reviews.toLocaleString('en-IN')})`, items.map((p) => p.rating).indexOf(Math.max(...items.map((p) => p.rating)))],
    ['Availability', (p) => (p.stock > 0 ? `${p.stock} in stock` : 'Out of stock'), -1],
    ...keys.map((k): [string, (p: PricedProduct) => string, number] => [SPEC_LABEL[k] ?? k, (p) => (p.specs[k] == null ? '—' : fmt(p.specs[k])), best(k)]),
  ];
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Scale className="size-4 text-vaani-cyan" /> Comparison</CardTitle>
          <Button size="icon" variant="ghost" className="size-8" onClick={() => set({ comparison: null })} aria-label="Close comparison"><X /></Button>
        </CardHeader>
        <CardContent className="overflow-x-auto scroll-thin">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="text-left">
                <th className="py-2 pr-3 font-normal text-slate-500">Spec</th>
                {items.map((p) => <th key={p.id} className="py-2 pr-3"><span className="text-xs text-slate-400">{p.brand}</span><br />{p.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, get, win]) => (
                <tr key={label} className="border-t border-white/5">
                  <td className="py-2 pr-3 text-slate-400">{label}</td>
                  {items.map((p, i) => <td key={p.id} className={cn('py-2 pr-3', i === win && 'font-semibold text-vaani-cyan')}>{get(p)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export function CartPanel() {
  const cart = useStore((s) => s.cart);
  const checkout = useStore((s) => s.checkout);
  const items = cart?.items ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ShoppingCart className="size-4 text-vaani-cyan" /> Cart</CardTitle>
        <Badge variant="muted">{cart?.item_count ?? 0} {(cart?.item_count ?? 0) === 1 ? 'item' : 'items'}</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length === 0 ? <p className="text-sm text-slate-400">Cart is empty. Say "second wala cart mein add karo".</p> : (
          <AnimatePresence initial={false}>
            {items.map((i) => (
              <motion.div key={i.product_id} layout initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                className="flex items-center gap-3 rounded-xl bg-white/[0.03] p-2">
                <img src={i.image} alt="" className="size-12 rounded-lg object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{i.name}</p>
                  <p className="text-xs text-slate-400">{i.quantity} × {inr(i.price)}</p>
                </div>
                <span className="text-sm font-semibold">{inr(i.line_total)}</span>
                <Button size="icon" variant="ghost" className="size-8" aria-label={`Remove ${i.name}`} onClick={() => api.removeFromCart(i.product_id).catch(onErr)}><Trash2 /></Button>
              </motion.div>
            ))}
          </AnimatePresence>
        )}

        <div className="flex flex-wrap gap-2">
          {['WELCOME10', 'SAVE200'].map((c) => (
            <button key={c} disabled={!items.length} onClick={() => api.applyCoupon(c).catch(onErr)}
              className={cn('flex items-center gap-1.5 rounded-lg border border-dashed px-2.5 py-1 text-xs transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-40',
                cart?.coupon?.code === c ? 'border-emerald-400/60 bg-emerald-500/10 text-emerald-300' : 'border-white/20 text-slate-300 hover:border-vaani-cyan/50')}>
              <Tag className="size-3" />{c}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-slate-500">WELCOME10: 10% off up to ₹500 · SAVE200: ₹200 off above ₹2,000</p>

        {items.length > 0 && cart && (
          <div className="space-y-1 border-t border-white/10 pt-3 text-sm">
            <Row label="Subtotal" value={inr(cart.subtotal)} />
            {cart.discount > 0 && <Row label={`Discount (${cart.coupon?.code})`} value={`− ${inr(cart.discount)}`} className="text-emerald-300" />}
            <Row label="Delivery" value="FREE" />
            <Row label="Total" value={inr(cart.total)} className="pt-1 font-display text-lg font-bold" />
          </div>
        )}

        <AnimatePresence>
          {checkout && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden rounded-xl border border-vaani-purple/40 bg-vaani-purple/10 p-3">
              <p className="mb-1 flex items-center gap-2 text-sm font-semibold"><PackageCheck className="size-4 text-vaani-cyan" /> Awaiting your confirmation</p>
              <p className="text-xs text-slate-300">Inventory and coupon re-validated by the backend. Say <b>"Yes, confirm"</b> or tap below. Total {inr(checkout.total)} · demo payment, no money moves.</p>
              <Button size="sm" className="mt-2 w-full" onClick={() => api.confirmOrder(checkout.total).catch(onErr)}>
                Confirm order
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return <div className={cn('flex justify-between', className)}><span className="text-slate-400">{label}</span><span>{value}</span></div>;
}

export function ToolLog() {
  const tools = useStore((s) => s.tools);
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Activity className="size-4 text-vaani-cyan" /> Agent tool calls</CardTitle></CardHeader>
      <CardContent className="max-h-56 space-y-1.5 overflow-y-auto scroll-thin">
        {tools.length === 0 && <p className="text-sm text-slate-400">Live backend tool executions show here.</p>}
        <AnimatePresence initial={false}>
          {tools.map((t) => (
            <motion.div key={t.id} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="flex items-start gap-2 font-mono text-[11px]">
              {t.ok ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-400" /> : <XCircle className="mt-0.5 size-3.5 shrink-0 text-rose-400" />}
              <span className="text-violet-300">{t.name}</span>
              <span className="min-w-0 flex-1 truncate text-slate-500">{JSON.stringify(t.args)}</span>
              {t.error && <span className="shrink-0 text-rose-300">{t.error}</span>}
            </motion.div>
          ))}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}

export function OrderSuccess() {
  const order = useStore((s) => s.order);
  const set = useStore((s) => s.set);
  return (
    <AnimatePresence>
      {order && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/80 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div initial={{ scale: 0.8, y: 30 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, opacity: 0 }} transition={{ type: 'spring', stiffness: 200, damping: 18 }}
            className="glass relative w-full max-w-md overflow-hidden p-6 text-center">
            {Array.from({ length: 18 }).map((_, i) => (
              <motion.span key={i} className="absolute top-1/3 left-1/2 size-2 rounded-full"
                style={{ background: i % 2 ? '#22d3ee' : '#8b5cf6' }}
                initial={{ x: 0, y: 0, opacity: 1 }}
                animate={{ x: Math.cos((i / 18) * Math.PI * 2) * 180, y: Math.sin((i / 18) * Math.PI * 2) * 140, opacity: 0 }}
                transition={{ duration: 1.2, ease: 'easeOut' }} />
            ))}
            <motion.div initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} transition={{ delay: 0.15, type: 'spring' }}
              className="mx-auto mb-4 grid size-20 place-items-center rounded-full bg-gradient-to-br from-emerald-400 to-vaani-cyan shadow-[0_0_50px_rgb(34_211_238/0.6)]">
              <CheckCircle2 className="size-10 text-navy-900" />
            </motion.div>
            <h2 className="font-display text-2xl font-bold">Demo order confirmed!</h2>
            <p className="mt-1 font-mono text-lg text-vaani-cyan">{order.order_id}</p>
            <div className="mt-4 space-y-1 rounded-xl bg-white/[0.04] p-3 text-left text-sm">
              {order.items.map((i) => <Row key={i.product_id} label={`${i.quantity} × ${i.name}`} value={inr(i.price * i.quantity)} />)}
              <div className="my-1 border-t border-white/10" />
              <Row label="Subtotal" value={inr(order.subtotal)} />
              {order.discount > 0 && <Row label={`Discount (${order.coupon_code})`} value={`− ${inr(order.discount)}`} className="text-emerald-300" />}
              <Row label="Total paid" value={inr(order.total)} className="font-semibold" />
              <Row label="Status" value={order.status} />
              <Row label="Arriving by" value={order.estimated_delivery} />
            </div>
            <p className="mt-3 text-[11px] text-slate-500">Simulated payment · demo order stored in SQLite</p>
            <Button className="mt-4 w-full" onClick={() => set({ order: null, results: null, comparison: null })}>Continue shopping</Button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function CartDrawer() {
  const open = useStore((s) => s.cartOpen);
  const set = useStore((s) => s.set);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-40 bg-navy-950/60 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => set({ cartOpen: false })} />
          <motion.aside role="dialog" aria-label="Cart" className="fixed right-0 top-0 z-40 h-full w-full max-w-md overflow-y-auto border-l border-white/10 bg-navy-900/95 p-4 scroll-thin"
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', stiffness: 260, damping: 30 }}>
            <div className="mb-3 flex items-center justify-between">
              <p className="font-display text-lg font-semibold">Your cart</p>
              <Button size="icon" variant="ghost" aria-label="Close cart" onClick={() => set({ cartOpen: false })}><X /></Button>
            </div>
            <CartPanel />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
