import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// The Avalanche mark: a steep, asymmetric pyramid in the manner of the great Karakoram peaks,
// with a lower shoulder on the left and a jagged snowcap. It is drawn from three flat shapes
// so it stays legible at 16 px. The same geometry is used for the app icon (tools/make-icons.cjs).
export const LOGO_BODY = 'M2.5 27.5 L9.6 14.6 L12.3 17.6 L17 4.5 L29.5 27.5 Z'
export const LOGO_SNOW = 'M17 4.5 L21.7 13.2 L19.3 12 L17.5 15 L15.4 12.5 L13.5 14.3 Z'
export const LOGO_SHADE = 'M17 4.5 L29.5 27.5 L18.6 27.5 L17.5 15 L19.3 12 L21.7 13.2 Z'

/**
 * `tile`  – the mark on the theme's gradient tile (sidebar, About, app icon).
 * `mono`  – a single-colour silhouette that takes the current text colour; the snowcap is cut out.
 */
export function Logo({ size = 22, variant = 'tile', className }: { size?: number; variant?: 'tile' | 'mono'; className?: string }): ReactNode {
  if (variant === 'mono') {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className={className}>
        <path d={`${LOGO_BODY} ${LOGO_SNOW}`} fill="currentColor" fillRule="evenodd" />
      </svg>
    )
  }
  return (
    <span
      aria-hidden
      className={cn('brand-tile inline-flex shrink-0 items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]', className)}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.27) }}
    >
      <svg width={size * 0.8} height={size * 0.8} viewBox="0 0 32 32">
        <path d={LOGO_BODY} fill="#0a1424" />
        <path d={LOGO_SHADE} fill="#000" opacity="0.28" />
        <path d={LOGO_SNOW} fill="#ffffff" />
      </svg>
    </span>
  )
}

/** Layered ridgelines for the Home header. Decorative, drawn from theme tokens, never behind text. */
export function Ridges({ className }: { className?: string }): ReactNode {
  return (
    <svg viewBox="0 0 1200 180" preserveAspectRatio="none" aria-hidden className={className}>
      <path d="M0 180 L0 120 L110 70 L190 110 L300 40 L390 100 L470 62 L590 122 L700 30 L790 96 L880 58 L990 112 L1090 50 L1200 104 L1200 180 Z" fill="var(--ridge-1)" />
      <path d="M0 180 L0 140 L90 108 L170 134 L290 84 L360 122 L500 72 L600 132 L720 86 L840 136 L960 90 L1060 128 L1200 80 L1200 180 Z" fill="var(--ridge-2)" />
      <path d="M0 180 L0 158 L140 126 L250 152 L380 118 L520 156 L650 124 L800 158 L930 130 L1080 160 L1200 136 L1200 180 Z" fill="var(--ridge-3)" />
    </svg>
  )
}
