import {
  Activity,
  Anchor,
  Atom,
  Beaker,
  Binary,
  Bird,
  Bone,
  BookOpen,
  Bot,
  Brain,
  Briefcase,
  Bug,
  Calculator,
  Camera,
  Car,
  Castle,
  ChartLine,
  ChartPie,
  Check,
  Church,
  Cloud,
  Code,
  Cog,
  Coins,
  Compass,
  Cpu,
  Crown,
  Database,
  Dna,
  Drama,
  Dumbbell,
  Earth,
  Eye,
  Feather,
  Film,
  Fish,
  Flag,
  Flame,
  FlaskConical,
  Gamepad2,
  Gem,
  Globe,
  GraduationCap,
  Guitar,
  Hammer,
  HeartPulse,
  Hourglass,
  Infinity as InfinityIcon,
  Key,
  Landmark,
  Languages,
  Layers,
  Leaf,
  Lightbulb,
  Magnet,
  Map as MapIcon,
  MessageCircle,
  Mic,
  Microscope,
  Moon,
  Mountain,
  Music,
  Newspaper,
  Orbit,
  Palette,
  PawPrint,
  PenTool,
  Percent,
  Pi,
  Piano,
  Pill,
  Plane,
  Puzzle,
  Quote,
  Radiation,
  Rocket,
  Ruler,
  Scale,
  Scroll,
  Shield,
  Sigma,
  Snowflake,
  Sprout,
  Star,
  Stethoscope,
  Sun,
  Swords,
  Syringe,
  Telescope,
  Terminal,
  TestTube,
  TreePine,
  Triangle,
  Trophy,
  Users,
  Utensils,
  Wifi,
  Wrench,
  Zap,
  type LucideIcon
} from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { DECK_COLOR_IDS, DECK_COLORS, normalizeDeckColor, normalizeDeckIcon, searchDeckIcons, type DeckColorId, type DeckIconId } from '@shared/domain/deck-style'
import type { Deck } from '@shared/types'
import { Button } from '@/components/ui/button'
import { SearchField } from '@/components/ui/controls'
import { toast } from '@/components/ui/feedback'
import { Modal } from '@/components/ui/overlays'
import { call, errorMessage } from '@/lib/api'
import { invalidate } from '@/lib/useData'
import { cn } from '@/lib/utils'

// The drawing for each deck icon id. TypeScript requires an entry for every id in the shared list.
const ICONS: Record<DeckIconId, LucideIcon> = {
  layers: Layers,
  'graduation-cap': GraduationCap,
  'book-open': BookOpen,
  languages: Languages,
  feather: Feather,
  quote: Quote,
  scroll: Scroll,
  newspaper: Newspaper,
  'message-circle': MessageCircle,
  calculator: Calculator,
  pi: Pi,
  sigma: Sigma,
  infinity: InfinityIcon,
  percent: Percent,
  triangle: Triangle,
  ruler: Ruler,
  'chart-line': ChartLine,
  'chart-pie': ChartPie,
  atom: Atom,
  magnet: Magnet,
  zap: Zap,
  orbit: Orbit,
  telescope: Telescope,
  rocket: Rocket,
  radiation: Radiation,
  'flask-conical': FlaskConical,
  'test-tube': TestTube,
  beaker: Beaker,
  flame: Flame,
  dna: Dna,
  microscope: Microscope,
  leaf: Leaf,
  sprout: Sprout,
  bug: Bug,
  bird: Bird,
  fish: Fish,
  'paw-print': PawPrint,
  brain: Brain,
  'heart-pulse': HeartPulse,
  stethoscope: Stethoscope,
  pill: Pill,
  syringe: Syringe,
  bone: Bone,
  eye: Eye,
  activity: Activity,
  dumbbell: Dumbbell,
  globe: Globe,
  earth: Earth,
  map: MapIcon,
  compass: Compass,
  mountain: Mountain,
  'tree-pine': TreePine,
  cloud: Cloud,
  sun: Sun,
  moon: Moon,
  snowflake: Snowflake,
  anchor: Anchor,
  plane: Plane,
  landmark: Landmark,
  castle: Castle,
  church: Church,
  crown: Crown,
  swords: Swords,
  shield: Shield,
  hourglass: Hourglass,
  flag: Flag,
  scale: Scale,
  users: Users,
  coins: Coins,
  briefcase: Briefcase,
  palette: Palette,
  'pen-tool': PenTool,
  camera: Camera,
  film: Film,
  drama: Drama,
  music: Music,
  guitar: Guitar,
  piano: Piano,
  mic: Mic,
  code: Code,
  terminal: Terminal,
  binary: Binary,
  cpu: Cpu,
  database: Database,
  bot: Bot,
  wifi: Wifi,
  cog: Cog,
  wrench: Wrench,
  hammer: Hammer,
  utensils: Utensils,
  car: Car,
  'gamepad-2': Gamepad2,
  puzzle: Puzzle,
  lightbulb: Lightbulb,
  key: Key,
  gem: Gem,
  star: Star,
  trophy: Trophy
}

const label = (id: string): string => id.replace(/-\d+$/, '').replace(/-/g, ' ')

/** A deck's icon on a softly tinted tile, in the deck's colour (or the theme's accent). */
export function DeckIcon({ icon, color, size = 30, className }: { icon: string; color: string; size?: number; className?: string }): ReactNode {
  const Icon = ICONS[normalizeDeckIcon(icon)]
  const hue = DECK_COLORS[normalizeDeckColor(color)]
  return (
    <span
      data-testid="deck-icon"
      data-icon={normalizeDeckIcon(icon)}
      className={cn('flex shrink-0 items-center justify-center rounded-lg', !hue && 'bg-accent-soft text-accent-text', className)}
      // A chosen deck colour is the user's own choice, so it is applied directly rather than through a theme token.
      style={{ width: size, height: size, ...(hue ? { color: hue, background: `color-mix(in srgb, ${hue} 16%, transparent)` } : {}) }}
      aria-hidden
    >
      <Icon size={Math.round(size * 0.55)} strokeWidth={1.9} />
    </span>
  )
}

/** Choose an icon and a colour for a deck: searchable by subject, applied when saved. */
export function DeckStyleDialog({ deck, onClose }: { deck: Deck; onClose(): void }): ReactNode {
  const [icon, setIcon] = useState<DeckIconId>(normalizeDeckIcon(deck.icon))
  const [color, setColor] = useState<DeckColorId>(normalizeDeckColor(deck.color))
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const shown = useMemo(() => searchDeckIcons(query), [query])

  const save = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await call('flashcards.setDeckStyle', { id: deck.id, icon, color })
      invalidate('flashcards')
      onClose()
    } catch (error) {
      toast(errorMessage(error), 'error')
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Icon for “${deck.name}”`}
      className="w-[520px]"
      footer={
        <>
          <span className="mr-auto flex items-center gap-2.5 self-center text-xs text-muted">
            <DeckIcon icon={icon} color={color} size={30} />
            <span className="capitalize">{label(icon)}</span>
          </span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div role="radiogroup" aria-label="Deck colour" className="mb-3 flex items-center gap-1.5">
        <span className="mr-1 text-xs font-medium text-muted">Colour</span>
        {DECK_COLOR_IDS.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={id === color}
            aria-label={id === 'default' ? 'Theme colour' : id}
            title={id === 'default' ? 'Theme colour' : id}
            onClick={() => setColor(id)}
            className={cn('flex h-6 w-6 items-center justify-center rounded-full border-2', id === color ? 'border-fg' : 'border-transparent', id === 'default' && 'bg-accent text-accent-fg')}
            style={DECK_COLORS[id] ? { background: DECK_COLORS[id] } : undefined}
          >
            {id === color && <Check size={12} strokeWidth={3} className={id === 'default' ? undefined : 'text-white'} />}
          </button>
        ))}
      </div>
      <SearchField aria-label="Search icons" placeholder="Search by subject, for example “chemistry” or “history”" value={query} onChange={(event) => setQuery(event.target.value)} autoFocus />
      <div role="radiogroup" aria-label="Deck icon" className="mt-3 grid max-h-[260px] grid-cols-10 gap-1 overflow-y-auto pr-1">
        {shown.map((id) => {
          const Icon = ICONS[id]
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={id === icon}
              aria-label={label(id)}
              title={label(id)}
              onClick={() => setIcon(id)}
              className={cn('flex h-10 items-center justify-center rounded-md border', id === icon ? 'border-accent bg-accent-soft text-accent-text' : 'border-transparent text-muted hover:bg-hover hover:text-fg')}
            >
              <Icon size={18} strokeWidth={1.9} />
            </button>
          )
        })}
        {shown.length === 0 && <p className="col-span-10 py-8 text-center text-xs text-subtle">No icon matches “{query}”.</p>}
      </div>
    </Modal>
  )
}
