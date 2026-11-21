import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

// shadcn/ui-style Badge
const badgeVariants = cva('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide', {
  variants: {
    variant: {
      default: 'bg-vaani-purple/20 text-violet-200 border border-vaani-purple/30',
      cyan: 'bg-vaani-cyan/15 text-cyan-200 border border-vaani-cyan/30',
      success: 'bg-emerald-500/15 text-emerald-300 border border-emerald-400/30',
      warn: 'bg-amber-500/15 text-amber-300 border border-amber-400/30',
      danger: 'bg-rose-500/15 text-rose-300 border border-rose-400/30',
      muted: 'bg-white/5 text-slate-400 border border-white/10',
    },
  },
  defaultVariants: { variant: 'default' },
});

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
