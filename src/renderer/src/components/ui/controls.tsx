import { Search } from 'lucide-react'
import { motion } from 'motion/react'
import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const FIELD =
  'w-full rounded-md border border-line-strong bg-bg px-2.5 text-[13px] text-fg outline-none placeholder:text-subtle ' +
  'transition-[border-color,box-shadow] duration-150 hover:border-subtle ' +
  'focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)] disabled:opacity-50'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>): ReactNode {
  return <input className={cn(FIELD, 'h-8', className)} {...props} />
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>): ReactNode {
  return <textarea className={cn(FIELD, 'resize-none py-2 leading-relaxed', className)} {...props} />
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>): ReactNode {
  return (
    <select className={cn(FIELD, 'h-8 cursor-pointer pr-7', className)} {...props}>
      {children}
    </select>
  )
}

/** A text field with a leading search icon, used wherever a list can be filtered. */
export function SearchField({ className, ...props }: InputHTMLAttributes<HTMLInputElement>): ReactNode {
  return (
    <div className={cn('relative', className)}>
      <Search size={13} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-subtle" />
      <Input className="pl-8" {...props} />
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }): ReactNode {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-subtle">{hint}</span>}
    </label>
  )
}

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  icon?: ReactNode
}

/** A segmented control. The selected pill slides between options instead of jumping. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = 'md'
}: {
  value: T
  options: SegmentedOption<T>[]
  onChange(value: T): void
  label: string
  size?: 'sm' | 'md'
}): ReactNode {
  const id = useId()
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line bg-surface p-0.5">
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative inline-flex items-center gap-1.5 rounded-[5px] px-2.5 text-xs',
              size === 'sm' ? 'h-6' : 'h-7',
              selected ? 'font-medium text-fg' : 'text-muted hover:text-fg'
            )}
          >
            {selected && (
              <motion.span
                layoutId={`segmented-${id}`}
                className="absolute inset-0 rounded-[5px] bg-active shadow-[0_1px_2px_rgba(0,0,0,0.12)]"
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              />
            )}
            <span className="relative flex items-center gap-1.5">
              {option.icon}
              {option.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
