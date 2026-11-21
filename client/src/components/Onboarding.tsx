import { motion } from 'framer-motion';
import { ArrowRight, Languages, Compass, ShieldAlert, Scale, Mic } from 'lucide-react';
import { VoiceOrb } from './VoiceOrb';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import type { Caps } from '../lib/types';
import { BRAND } from '../brand';

const FEATURES = [
  { icon: Languages, title: 'English · हिंदी · Hinglish', text: 'Bolo jaise aap dukaan pe bolte ho.' },
  { icon: Scale, title: 'Best deal finder', text: 'Weighs every option for your need, quality, value and verified coupons.' },
  { icon: ShieldAlert, title: 'Friendly tips', text: 'A heads-up before you buy the wrong one — always your call.' },
  { icon: Mic, title: 'Agora + Murf Falcon', text: 'Real-time audio with natural Indian voices.' },
];

export function Onboarding({ caps, onStart }: { caps: Caps | null; onStart: () => void }) {
  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden px-4 py-10">
      <div className="mx-auto grid w-full max-w-6xl items-center gap-10 lg:grid-cols-[1.1fr_1fr]">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <div className="mb-5 flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-vaani-purple to-vaani-cyan"><Compass className="size-5" /></span>
            <span className="font-display text-lg font-semibold">{BRAND.name}</span>
          </div>
          <h1 className="font-display text-4xl font-bold leading-tight sm:text-6xl">
            Your friendly<br /><span className="glow-text">shopping buddy</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-slate-300">
            "Bhai, ₹5,000 ke andar office calls ke liye best headphones chahiye." {BRAND.name} shops with you like a friend: finds the best deal for your need and budget, gives you a friendly tip before a bad buy, applies only verified coupons, and checks out only when you say yes. {BRAND.hinglishTagline}
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {FEATURES.map((f, i) => (
              <motion.div key={f.title} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 + i * 0.1 }} className="glass p-4">
                <f.icon className="mb-2 size-5 text-vaani-cyan" />
                <p className="text-sm font-semibold">{f.title}</p>
                <p className="mt-1 text-xs text-slate-400">{f.text}</p>
              </motion.div>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button size="lg" onClick={onStart}>Start shopping <ArrowRight /></Button>
            {caps && (
              <div className="flex flex-wrap gap-2">
                <Badge variant={caps.agoraVoice ? 'success' : 'warn'}>{caps.agoraVoice ? 'Agora voice ready' : 'Agora: lite mode'}</Badge>
                <Badge variant={caps.murf ? 'success' : 'warn'}>{caps.murf ? 'Murf Falcon TTS' : 'Murf key missing'}</Badge>
                <Badge variant={caps.llm ? 'cyan' : 'muted'}>{caps.llm ? caps.llmProvider : 'Rule engine'}</Badge>
              </div>
            )}
          </div>
          <p className="mt-6 text-xs text-slate-500">Demo store · simulated catalog & payments · no real money moves.</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.8 }} className="flex justify-center">
          <VoiceOrb state="off" level={0} onClick={onStart} size={300} />
        </motion.div>
      </div>
    </div>
  );
}
