import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Tip } from './overlays'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

// Hover changes the surface, pressing nudges the scale by 2%: enough to feel physical,
// not enough to read as a bounce. Colour transitions come from the base layer in index.css.
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]',
  secondary: 'bg-surface text-fg border border-line-strong hover:bg-hover',
  ghost: 'text-muted hover:bg-hover hover:text-fg',
  danger: 'bg-danger text-white hover:opacity-90 font-medium'
}
const SIZES: Record<Size, string> = { sm: 'h-7 px-2.5 text-xs gap-1.5', md: 'h-8 px-3 text-[13px] gap-2' }

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

export function Button({ variant = 'secondary', size = 'md', className, type = 'button', ...props }: ButtonProps): ReactNode {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md whitespace-nowrap select-none',
        'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40',
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...props}
    />
  )
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name, also shown as the tooltip. */
  label: string
  shortcut?: string
  active?: boolean
  tipSide?: 'top' | 'right' | 'bottom' | 'left'
}

export function IconButton({ label, shortcut, active, tipSide, className, type = 'button', children, ...props }: IconButtonProps): ReactNode {
  return (
    <Tip label={label} shortcut={shortcut} side={tipSide}>
      <button
        type={type}
        aria-label={label}
        aria-pressed={active}
        className={cn(
          'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted',
          'hover:bg-hover hover:text-fg active:bg-active disabled:pointer-events-none disabled:opacity-35',
          active && 'bg-accent-soft text-accent-text hover:bg-accent-soft hover:text-accent-text',
          className
        )}
        {...props}
      >
        {children}
      </button>
    </Tip>
  )
}

/** A thin vertical rule between groups of toolbar controls. */
export function ToolbarDivider(): ReactNode {
  return <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-line-strong" />
}
