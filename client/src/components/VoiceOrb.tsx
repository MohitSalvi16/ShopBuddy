import { motion } from 'framer-motion';
import { Mic, Loader2, Sparkles, Volume2, WifiOff, Power } from 'lucide-react';
import type { VoiceState } from '../lib/types';
import { cn } from '../lib/utils';
import { BRAND } from '../brand';

const LABEL: Record<VoiceState, string> = {
  off: `Tap to talk to ${BRAND.name}`,
  connecting: 'Connecting…',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: `${BRAND.name} is speaking`,
  reconnecting: 'Reconnecting…',
};

export function VoiceOrb({ state, level, onClick, size = 220 }: { state: VoiceState; level: number; onClick?: () => void; size?: number }) {
  const active = state !== 'off';
  const scale = 1 + Math.min(level, 1) * 0.18;
  const Icon = { off: Power, connecting: Loader2, listening: Mic, thinking: Sparkles, speaking: Volume2, reconnecting: WifiOff }[state];

  return (
    <div className="flex flex-col items-center gap-4">
      <button
        onClick={onClick}
        aria-label={LABEL[state]}
        className="relative grid place-items-center rounded-full outline-none focus-visible:ring-4 focus-visible:ring-vaani-cyan/40 cursor-pointer"
        style={{ width: size, height: size }}
      >
        {/* outer glow rings */}
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="absolute inset-0 rounded-full border border-vaani-cyan/30"
            animate={active ? { scale: [1, 1.35 + i * 0.12], opacity: [0.5, 0] } : { scale: 1, opacity: 0.15 }}
            transition={{ duration: state === 'speaking' ? 1.4 : 2.6, repeat: Infinity, delay: i * 0.6, ease: 'easeOut' }}
          />
        ))}
        <motion.span
          className="absolute inset-[6%] rounded-full blur-2xl"
          style={{ background: 'conic-gradient(from 0deg, #8b5cf6, #22d3ee, #d946ef, #8b5cf6)' }}
          animate={{ rotate: 360, opacity: active ? 0.85 : 0.45 }}
          transition={{ rotate: { duration: state === 'thinking' ? 2.5 : 8, repeat: Infinity, ease: 'linear' }, opacity: { duration: 0.4 } }}
        />
        <motion.span
          className="absolute inset-[14%] rounded-full"
          style={{
            background: 'radial-gradient(circle at 35% 30%, #c4b5fd 0%, #8b5cf6 30%, #312e81 65%, #0b1026 100%)',
            boxShadow: 'inset 0 0 40px rgb(34 211 238 / 0.45), 0 0 60px rgb(139 92 246 / 0.6)',
          }}
          animate={{ scale: active ? scale : [1, 1.03, 1] }}
          transition={active ? { type: 'spring', stiffness: 260, damping: 18 } : { duration: 3, repeat: Infinity }}
        />
        <motion.span
          className="absolute inset-[30%] rounded-full bg-gradient-to-br from-white/30 to-transparent"
          animate={{ rotate: -360 }}
          transition={{ duration: 12, repeat: Infinity, ease: 'linear' }}
        />
        <Icon className={cn('relative z-10 size-10 text-white drop-shadow-[0_0_12px_rgb(34_211_238/0.9)]', state === 'connecting' && 'animate-spin')} />
      </button>
      <motion.p key={state} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="font-display text-sm tracking-wide text-slate-300">
        {LABEL[state]}
      </motion.p>
    </div>
  );
}

/** Live bar waveform driven by mic or agent level. */
export function Waveform({ level, color = 'cyan', bars = 28 }: { level: number; color?: 'cyan' | 'purple'; bars?: number }) {
  return (
    <div className="flex h-10 items-center justify-center gap-[3px]">
      {Array.from({ length: bars }).map((_, i) => {
        const shape = Math.sin((i / (bars - 1)) * Math.PI);
        const h = 4 + shape * Math.min(level, 1) * 36 * (0.6 + 0.4 * Math.abs(Math.sin(i * 1.7 + level * 9)));
        return (
          <motion.span
            key={i}
            className={cn('w-[3px] rounded-full', color === 'cyan' ? 'bg-vaani-cyan' : 'bg-vaani-purple')}
            animate={{ height: h, opacity: 0.35 + shape * 0.65 }}
            transition={{ type: 'spring', stiffness: 400, damping: 22 }}
          />
        );
      })}
    </div>
  );
}
