import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

// shadcn/ui-style Button
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaani-cyan/60 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 cursor-pointer',
  {
    variants: {
      variant: {
        default: 'bg-gradient-to-r from-vaani-purple to-vaani-cyan text-white shadow-[0_0_24px_rgb(139_92_246/0.45)] hover:brightness-110',
        secondary: 'bg-white/10 text-slate-100 hover:bg-white/15 border border-white/10',
        ghost: 'text-slate-300 hover:bg-white/10 hover:text-white',
        outline: 'border border-white/15 bg-transparent text-slate-200 hover:bg-white/5',
        danger: 'bg-rose-500/90 text-white hover:bg-rose-500',
      },
      size: { default: 'h-10 px-4', sm: 'h-8 px-3 text-xs', lg: 'h-12 px-6 text-base', icon: 'h-10 w-10' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
));
Button.displayName = 'Button';
