import { motion } from 'framer-motion';
import { MessageSquareQuote, Lightbulb, Check, AlertTriangle, Trophy, BadgePercent, Wallet, Scale, ShoppingCart, Sparkles, Target } from 'lucide-react';
import { useStore } from '../store';
import { api, inr } from '../lib/api';
import type { Deal } from '../lib/types';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

const onErr = (e: unknown) => useStore.getState().set({ error: e instanceof Error ? e.message : String(e) });

const TAG: Record<string, { label: string; variant: 'success' | 'warn' | 'cyan' }> = {
  best_pick: { label: 'Best pick', variant: 'success' },
  cheapest: { label: 'Cheapest', variant: 'warn' },
  best_value: { label: 'Best value', variant: 'cyan' },
};

function ScoreRing({ value }: { value: number }) {
  const r = 18, c = 2 * Math.PI * r;
  return (
    <div className="relative grid size-12 place-items-center" title={`Suitability score ${value}/100`}>
      <svg viewBox="0 0 44 44" className="absolute inset-0 -rotate-90">
        <circle cx="22" cy="22" r={r} fill="none" stroke="rgb(255 255 255 / 0.1)" strokeWidth="4" />
        <motion.circle cx="22" cy="22" r={r} fill="none" stroke="url(#sg)" strokeWidth="4" strokeLinecap="round"
          strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - value / 100) }} transition={{ duration: 0.9 }} />
        <defs><linearGradient id="sg"><stop offset="0" stopColor="#8b5cf6" /><stop offset="1" stopColor="#22d3ee" /></linearGradient></defs>
      </svg>
      <span className="font-display text-sm font-bold">{value}</span>
    </div>
  );
}

function Bar({ label, value, weight }: { label: string; value: number; weight: number }) {
  return (
    <div className="flex items-center gap-2 text-[10px] text-slate-400">
      <span className="w-20 shrink-0">{label} <span className="text-slate-600">{Math.round(weight * 100)}%</span></span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
        <motion.span className="block h-full rounded-full bg-gradient-to-r from-vaani-purple to-vaani-cyan" initial={{ width: 0 }} animate={{ width: `${value}%` }} transition={{ duration: 0.7 }} />
      </span>
      <span className="w-6 text-right tabular-nums">{value}</span>
    </div>
  );
}

export function DealCard({ d, index }: { d: Deal; index: number }) {
  const inCart = useStore((s) => s.cart?.items.some((i) => i.product_id === d.product_id));
  const best = d.tags.includes('best_pick');
  return (
    <motion.div layout initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.08 }}
      className={cn('glass relative flex flex-col overflow-hidden p-0 transition', best ? 'border-emerald-400/40 shadow-[0_0_36px_rgb(52_211_153/0.18)]' : 'hover:border-vaani-cyan/40')}>
      <span className="absolute left-3 top-3 z-10 grid size-7 place-items-center rounded-full bg-navy-900/80 font-display text-sm font-bold text-vaani-cyan ring-1 ring-vaani-cyan/40">{d.position}</span>
      <div className="absolute right-3 top-3 z-10 flex flex-col items-end gap-1">
        {d.tags.map((t) => TAG[t] && <Badge key={t} variant={TAG[t].variant}>{t === 'best_pick' && <Trophy className="size-3" />}{TAG[t].label}</Badge>)}
      </div>
      <img src={d.image} alt={d.name} className="aspect-[16/9] w-full object-cover opacity-90" />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider text-slate-400">{d.brand} · {d.rating}★</p>
            <p className="font-semibold leading-snug">{d.name}</p>
          </div>
          <ScoreRing value={d.scores.total} />
        </div>
        <div>
          <div className="flex items-baseline gap-2">
            <span className="font-display text-xl font-bold">{inr(d.final_price)}</span>
            {d.discount > 0 && <span className="text-xs text-slate-500 line-through">{inr(d.price)}</span>}
          </div>
          {d.best_coupon
            ? <p className="flex items-center gap-1 text-[11px] text-emerald-300"><BadgePercent className="size-3" /> {d.best_coupon.code} verified · −{inr(d.discount)}</p>
            : <p className="text-[11px] text-slate-500">No eligible coupon</p>}
        </div>
        <ul className="space-y-0.5 text-xs">
          {d.advantages.slice(0, 3).map((a) => <li key={a} className="flex gap-1.5 text-slate-300"><Check className="mt-0.5 size-3 shrink-0 text-emerald-400" />{a}</li>)}
          {d.disadvantages.slice(0, 2).map((a) => <li key={a} className="flex gap-1.5 text-amber-200/90"><AlertTriangle className="mt-0.5 size-3 shrink-0 text-amber-400" />{a}</li>)}
        </ul>
        {d.review && (d.review.top_praise || d.review.top_complaint) && (
          <p className="rounded-lg bg-white/[0.04] px-2 py-1 text-[11px] leading-relaxed text-slate-400" data-testid="review-line">
            <span className="text-slate-500">Buyers: </span>
            {d.review.top_praise && <span className="text-emerald-300">like the {d.review.top_praise}</span>}
            {d.review.top_praise && d.review.top_complaint && <span> · </span>}
            {d.review.top_complaint && <span className={d.review.top_complaint_severity === 'major' ? 'text-rose-300' : 'text-amber-200'}>complain about {d.review.top_complaint}</span>}
          </p>
        )}
        <details className="group text-xs text-slate-400">
          <summary className="cursor-pointer select-none text-[11px] text-vaani-cyan/80 hover:text-vaani-cyan">Why this score?</summary>
          <div className="mt-2 space-y-1">
            <Bar label="Requirement" value={d.scores.requirement} weight={0.4} />
            <Bar label="Quality" value={d.scores.quality} weight={0.25} />
            <Bar label="Value" value={d.scores.value} weight={0.2} />
            <Bar label="Preference" value={d.scores.preference} weight={0.15} />
            <p className="pt-1 leading-relaxed">{d.reasoning}</p>
          </div>
        </details>
        <div className="mt-auto flex gap-2">
          <Button size="sm" variant="outline" className="shrink-0" aria-label={`Reviews for ${d.name}`} onClick={() => api.showReviews(d.product_id).catch(onErr)}>
            <MessageSquareQuote /> Reviews
          </Button>
          <Button size="sm" variant={best ? 'default' : 'secondary'} className="w-full" onClick={() => api.addToCart(d.product_id).catch(onErr)}>
            <ShoppingCart /> {inCart ? 'Add one more' : 'Add to cart'}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

export function DevilsAdvocate() {
  const c = useStore((s) => s.critique);
  const set = useStore((s) => s.set);
  if (!c || c.verdict !== 'reconsider') return null;
  const target = c.product ?? { product_id: c.product_id!, name: c.name!, final_price: c.final_price!, score: c.score! };
  const alt = c.better_alternative;
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="glass border-vaani-cyan/30 bg-gradient-to-br from-vaani-cyan/[0.07] to-vaani-purple/[0.07] p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-vaani-cyan/15 text-cyan-200"><Lightbulb className="size-5" /></span>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-display text-sm font-semibold uppercase tracking-[0.14em] text-cyan-100">Friendly tip</p>
            <Badge variant="cyan">Worth a look</Badge>
          </div>
          <p className="text-sm text-slate-200">{c.message}</p>
          <ul className="flex flex-wrap gap-1.5">{c.concerns.slice(0, 3).map((x) => <li key={x}><Badge variant="warn">{x}</Badge></li>)}</ul>
          {alt && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button size="sm" variant="secondary" onClick={() => api.tool('compare_products', { product_ids: [target.product_id, alt.product_id] }).catch(onErr)}>
                <Scale /> Compare {target.name} vs {alt.name}
              </Button>
              <span className="text-xs text-slate-400">+{inr(alt.extra_cost)} for score {alt.score} vs {target.score}</span>
            </div>
          )}
          <p className="text-[10px] text-slate-500">Just a heads-up from catalog facts (simulated demo data) — the choice is always yours.</p>
        </div>
        <button className="cursor-pointer text-xs text-slate-500 hover:text-slate-300" onClick={() => set({ critique: null })}>Dismiss</button>
      </div>
    </motion.div>
  );
}

export function BudgetCard() {
  const deals = useStore((s) => s.results?.deals);
  const cart = useStore((s) => s.cart);
  if (!deals) return null;
  const g = deals.goal;
  const best = deals.recommendations.find((d) => d.tags.includes('best_pick'));
  const budget = g.budget ?? null;
  const spend = cart?.items.length ? cart.total : best?.final_price ?? 0;
  const pct = budget ? Math.min(100, Math.round((spend / budget) * 100)) : 0;
  const mrpSave = best ? best.mrp - best.final_price : 0;
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Wallet className="size-4 text-vaani-cyan" /> Budget & savings</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="cyan"><Target className="size-3" />{g.use_case}</Badge>
          {g.category !== 'any' && <Badge variant="muted">{g.category}</Badge>}
          {g.preferences.map((p) => <Badge key={p}>{p}</Badge>)}
          {g.excluded_use_cases.map((p) => <Badge key={p} variant="danger">not {p}</Badge>)}
        </div>
        {budget ? (
          <div>
            <div className="mb-1 flex justify-between text-xs text-slate-400"><span>{cart?.items.length ? 'Cart total' : 'Best pick'} {inr(spend)}</span><span>Budget {inr(budget)}</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <motion.div className={cn('h-full rounded-full', pct > 100 ? 'bg-rose-500' : 'bg-gradient-to-r from-emerald-400 to-vaani-cyan')} initial={{ width: 0 }} animate={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1 text-xs text-emerald-300">{inr(Math.max(0, budget - spend))} under budget</p>
          </div>
        ) : <p className="text-xs text-slate-400">No budget set. Say "5000 ke andar" to set one.</p>}
        {best && (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-xl bg-white/[0.04] p-2"><p className="text-slate-500">Coupon saving</p><p className="font-display text-base font-semibold text-emerald-300">{inr(best.discount)}</p></div>
            <div className="rounded-xl bg-white/[0.04] p-2"><p className="text-slate-500">Off MRP (best pick)</p><p className="font-display text-base font-semibold">{inr(mrpSave)}</p></div>
          </div>
        )}
        <p className="flex items-center gap-1 text-[11px] text-slate-500">
          <Sparkles className="size-3" /> {deals.candidates_considered} in-stock candidates scored · {deals.excluded.length} excluded ({[...new Set(deals.excluded.map((e) => e.reason.split(' (')[0]))].join(', ') || 'none'})
        </p>
      </CardContent>
    </Card>
  );
}
