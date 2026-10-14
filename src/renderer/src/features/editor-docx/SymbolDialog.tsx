import { useMemo, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { SearchField } from '@/components/ui/controls'
import { Modal } from '@/components/ui/overlays'
import { cn } from '@/lib/utils'

// Insert → Symbol, in the manner of a word processor: pick a character from a categorized
// grid and it is inserted at the cursor as ordinary text, so it is saved and exported like any
// other character. The dialog stays open so several symbols can be inserted in a row.

interface SymbolEntry {
  char: string
  name: string
}

const group = (pairs: string): SymbolEntry[] =>
  pairs
    .split('|')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => ({ char: pair.slice(0, pair.indexOf(' ')), name: pair.slice(pair.indexOf(' ') + 1) }))

export const SYMBOL_GROUPS: { id: string; label: string; symbols: SymbolEntry[] }[] = [
  {
    id: 'common',
    label: 'Common',
    symbols: group('© copyright|® registered|™ trademark|§ section|¶ paragraph|† dagger|‡ double dagger|• bullet|… ellipsis|– en dash|— em dash|° degree|′ prime|″ double prime|№ numero|✓ check mark|✗ cross mark|★ star|☆ outline star|♠ spade|♣ club|♥ heart|♦ diamond')
  },
  {
    id: 'math',
    label: 'Mathematics',
    symbols: group('± plus minus|× multiplication|÷ division|≠ not equal|≈ approximately|≡ identical|≤ less or equal|≥ greater or equal|≪ much less|≫ much greater|∞ infinity|√ square root|∛ cube root|∑ sum|∏ product|∫ integral|∂ partial derivative|∇ nabla|∆ increment|∈ element of|∉ not element of|⊂ subset|⊆ subset or equal|∪ union|∩ intersection|∅ empty set|∀ for all|∃ there exists|¬ not|∧ and|∨ or|∴ therefore|∵ because|∝ proportional|∠ angle|⊥ perpendicular|∥ parallel|· dot operator|‰ per mille|½ one half|⅓ one third|¼ one quarter|¾ three quarters|² superscript two|³ superscript three|ⁿ superscript n|₀ subscript zero|₁ subscript one|₂ subscript two')
  },
  {
    id: 'greek',
    label: 'Greek',
    symbols: group('α alpha|β beta|γ gamma|δ delta|ε epsilon|ζ zeta|η eta|θ theta|ι iota|κ kappa|λ lambda|μ mu|ν nu|ξ xi|π pi|ρ rho|σ sigma|τ tau|υ upsilon|φ phi|χ chi|ψ psi|ω omega|Γ capital gamma|Δ capital delta|Θ capital theta|Λ capital lambda|Ξ capital xi|Π capital pi|Σ capital sigma|Φ capital phi|Ψ capital psi|Ω capital omega')
  },
  {
    id: 'arrows',
    label: 'Arrows',
    symbols: group('← left arrow|→ right arrow|↑ up arrow|↓ down arrow|↔ left right arrow|↕ up down arrow|⇐ left double arrow|⇒ right double arrow|⇔ left right double arrow|↦ maps to|↩ return arrow|↪ hook arrow|↗ north east arrow|↘ south east arrow|⟶ long right arrow|⇌ equilibrium|⟂ perpendicular')
  },
  {
    id: 'currency',
    label: 'Currency',
    symbols: group('€ euro|£ pound|¥ yen|₹ rupee|¢ cent|₩ won|₽ ruble|₺ lira|₪ shekel|₫ dong|₿ bitcoin|¤ currency')
  },
  {
    id: 'punctuation',
    label: 'Punctuation',
    symbols: group('“ left double quote|” right double quote|‘ left single quote|’ right single quote|« left guillemet|» right guillemet|‹ left single guillemet|› right single guillemet|¡ inverted exclamation|¿ inverted question|‽ interrobang|‐ hyphen|‑ non-breaking hyphen|· middle dot|‣ triangular bullet|※ reference mark')
  },
  {
    id: 'latin',
    label: 'Accented letters',
    symbols: group('á a acute|à a grave|â a circumflex|ä a umlaut|ã a tilde|å a ring|æ ae|ç c cedilla|é e acute|è e grave|ê e circumflex|ë e umlaut|í i acute|î i circumflex|ï i umlaut|ñ n tilde|ó o acute|ô o circumflex|ö o umlaut|õ o tilde|ø o slash|œ oe|ß sharp s|ú u acute|ù u grave|û u circumflex|ü u umlaut|ý y acute|Á capital a acute|É capital e acute|Ñ capital n tilde|Ö capital o umlaut|Ü capital u umlaut|Ç capital c cedilla')
  }
]

// Recently used symbols, for this session.
let recent: SymbolEntry[] = []

export function SymbolDialog({ onInsert, onClose }: { onInsert(char: string): void; onClose(): void }): ReactNode {
  const [groupId, setGroupId] = useState(SYMBOL_GROUPS[0].id)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<SymbolEntry | null>(null)
  const [, setVersion] = useState(0)

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return SYMBOL_GROUPS.find((candidate) => candidate.id === groupId)!.symbols
    // Search looks across every category, by name or by the character itself.
    return SYMBOL_GROUPS.flatMap((candidate) => candidate.symbols).filter((symbol) => symbol.name.includes(needle) || symbol.char === query.trim())
  }, [groupId, query])

  const insert = (symbol: SymbolEntry): void => {
    onInsert(symbol.char)
    recent = [symbol, ...recent.filter((item) => item.char !== symbol.char)].slice(0, 12)
    setSelected(symbol)
    setVersion((value) => value + 1)
  }

  const cell = 'flex h-9 w-9 items-center justify-center rounded-md border border-transparent text-[17px] text-fg hover:border-line-strong hover:bg-hover'

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title="Insert symbol"
      description="Click a symbol to insert it at the cursor. The dialog stays open so you can insert several."
      className="w-[560px]"
      footer={
        <>
          <span className="mr-auto self-center text-xs text-muted" data-testid="symbol-name">
            {selected ? `${selected.char}  ${selected.name}  ·  U+${selected.char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}` : 'Hover or click a symbol to see its name'}
          </span>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <SearchField aria-label="Search symbols" placeholder="Search by name, for example “arrow” or “alpha”" value={query} onChange={(event) => setQuery(event.target.value)} autoFocus />
      {!query && (
        <div role="tablist" aria-label="Symbol categories" className="mt-3 flex flex-wrap gap-1">
          {SYMBOL_GROUPS.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              role="tab"
              aria-selected={candidate.id === groupId}
              onClick={() => setGroupId(candidate.id)}
              className={cn('rounded-md px-2.5 py-1 text-xs', candidate.id === groupId ? 'bg-active font-medium text-fg' : 'text-muted hover:bg-hover hover:text-fg')}
            >
              {candidate.label}
            </button>
          ))}
        </div>
      )}
      <div className="mt-3 flex min-h-[156px] flex-wrap content-start gap-0.5" role="group" aria-label="Symbols">
        {shown.map((symbol) => (
          <button key={symbol.char} type="button" title={symbol.name} aria-label={symbol.name} className={cell} onMouseEnter={() => setSelected(symbol)} onClick={() => insert(symbol)}>
            {symbol.char}
          </button>
        ))}
        {shown.length === 0 && <p className="w-full py-8 text-center text-xs text-subtle">No symbol matches “{query}”.</p>}
      </div>
      {recent.length > 0 && (
        <div className="mt-3 border-t border-line pt-2">
          <div className="mb-1 text-[11px] font-semibold tracking-[0.06em] text-subtle uppercase">Recently used</div>
          <div className="flex flex-wrap gap-0.5">
            {recent.map((symbol) => (
              <button key={symbol.char} type="button" title={symbol.name} aria-label={`${symbol.name} (recent)`} className={cell} onClick={() => insert(symbol)}>
                {symbol.char}
              </button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  )
}
