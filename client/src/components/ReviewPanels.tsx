import { useState } from 'react';
import { motion } from 'framer-motion';
import { MessageSquareQuote, Star, ThumbsUp, ThumbsDown, X, BadgeCheck } from 'lucide-react';
import { useStore } from '../store';
import { api } from '../lib/api';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

const VERDICT: Record<string, { label: string; variant: 'success' | 'warn' | 'danger' }> = {
  mostly_positive: { label: 'Mostly positive', variant: 'success' },
  mixed: { label: 'Mixed reviews', variant: 'warn' },
  mostly_negative: { label: 'Mostly negative', variant: 'danger' },
};

export function Stars({ value, size = 'size-3.5' }: { value: number; size?: string }) {
  return (
    <span className="inline-flex items-center" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={cn(size, i <= Math.round(value) ? 'fill-amber-400 text-amber-400' : 'text-slate-600')} />
      ))}
    </span>
  );
}

/** "What buyers say": rating, verdict, the good AND the bad, verified-buyer ratings. */
export function ReviewsPanel() {
  const r = useStore((s) => s.reviews);
  const rated = useStore((s) => s.rated);
  const set = useStore((s) => s.set);
  if (!r) return null;
  const v = VERDICT[r.verdict] ?? VERDICT.mixed;
  return (
    <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass p-4" aria-label="What buyers say">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-300"><MessageSquareQuote className="size-5" /></span>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-display text-sm font-semibold uppercase tracking-[0.14em] text-amber-100">What buyers say</p>
            <Badge variant={v.variant}>{v.label}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{r.name}</p>
            <Stars value={r.rating} />
            <span className="text-sm text-slate-300">{r.rating.toFixed(1)}★</span>
            <span className="text-xs text-slate-500">({r.review_count.toLocaleString('en-IN')} ratings)</span>
          </div>
          {rated && <p className="rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-200">Thanks! You rated it {rated.rating}★ — new average {rated.new_average.toFixed(2)}★.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-emerald-300"><ThumbsUp className="size-3.5" /> Buyers like</p>
              {r.praise.length === 0 ? <p className="text-xs text-slate-500">No standout praise.</p> : (
                <ul className="space-y-1.5">{r.praise.map((p) => (
                  <li key={p.aspect} className="text-xs"><span className="font-medium capitalize text-slate-200">{p.label}</span><br /><span className="italic text-slate-400">“{p.quote}”</span></li>
                ))}</ul>
              )}
            </div>
            <div>
              <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-amber-300"><ThumbsDown className="size-3.5" /> Common complaints</p>
              {r.complaints.length === 0 ? <p className="text-xs text-slate-500">No common complaints.</p> : (
                <ul className="space-y-1.5">{r.complaints.map((c, i) => (
                  <li key={c.aspect + i} className="text-xs">
                    <span className="font-medium capitalize text-slate-200">{c.label}</span>{' '}
                    <Badge variant={c.severity === 'major' ? 'danger' : 'muted'}>{c.severity}</Badge><br />
                    <span className="italic text-slate-400">“{c.quote}”</span>
                  </li>
                ))}</ul>
              )}
            </div>
          </div>
          {r.customer_ratings.length > 0 && (
            <div className="border-t border-white/10 pt-2">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-cyan-200"><BadgeCheck className="size-3.5" /> Verified buyers</p>
              {r.customer_ratings.map((c, i) => <p key={i} className="text-xs text-slate-300"><Stars value={c.rating} size="size-3" /> {c.text} <span className="text-slate-500">— {c.author}</span></p>)}
            </div>
          )}
          <p className="text-[10px] text-slate-500">{r.disclaimer}</p>
        </div>
        <Button size="icon" variant="ghost" className="size-8" aria-label="Close reviews" onClick={() => set({ reviews: null, rated: null })}><X /></Button>
      </div>
    </motion.section>
  );
}

/** Star picker shown after an order, for each item bought. */
export function RatePurchase({ productId, name }: { productId: string; name: string }) {
  const [hover, setHover] = useState(0);
  const [done, setDone] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const rate = async (n: number) => {
    setErr(null);
    try { await api.rateProduct(productId, n); setDone(n); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/[0.04] p-2.5 text-left">
      <span className="text-xs text-slate-300">Rate <b>{name}</b></span>
      {done ? <span className="text-xs text-emerald-300">Thanks! You rated it {done}★</span> : (
        <span className="flex" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((i) => (
            <button key={i} aria-label={`Rate ${i} star${i > 1 ? 's' : ''}`} className="cursor-pointer p-0.5" onMouseEnter={() => setHover(i)} onClick={() => rate(i)}>
              <Star className={cn('size-5', i <= hover ? 'fill-amber-400 text-amber-400' : 'text-slate-500')} />
            </button>
          ))}
        </span>
      )}
      {err && <span className="w-full text-[11px] text-rose-300">{err}</span>}
    </div>
  );
}
