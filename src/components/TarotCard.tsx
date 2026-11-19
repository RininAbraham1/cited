/**
 * Footnote cards: a six-card tarot deck drawn in SVG from the mascot, a
 * shared card back, and a 3D flip. Pure presentation; the server decides
 * which card you get.
 */
import { useId } from 'react'
import { cn } from '@/lib/utils'
import { CARDS, type CardId } from '@/lib/game-logic'
import { MascotBody } from './Mascot'

const INK = 'var(--ink)'
const PAPER = 'var(--paper)'

const ART_BG: Record<CardId, string> = {
  scholar: '#5fd0ff',
  twins: '#ff7ab6',
  jester: '#4fe39a',
  librarian: '#c4b5ff',
  oracle: '#2c1bb3',
  redacted: '#e7e2d4',
}

/** Card face, 120×180 units. */
export function CardFace({ card }: { card: CardId }) {
  const uid = useId().replace(/:/g, '')
  const clip = `art-${uid}`
  const def = CARDS[card]
  return (
    <svg viewBox="0 0 120 180" className="mascot block h-full w-full" role="img" aria-label={`${def.name}: ${def.effect}`}>
      <defs>
        <clipPath id={clip}><rect x="10" y="24" width="100" height="110" rx="7" /></clipPath>
      </defs>
      <rect x="2" y="2" width="116" height="176" rx="12" fill={PAPER} stroke={INK} strokeWidth="4" />
      <text x="60" y="18" textAnchor="middle" fontFamily="'Lilita One', sans-serif" fontSize="12" fill={INK}>
        {def.numeral}{card === 'jester' ? ' · REVERSED' : ''}
      </text>
      <g clipPath={`url(#${clip})`}>
        <rect x="10" y="24" width="100" height="110" fill={ART_BG[card]} />
        <Art card={card} />
      </g>
      <rect x="10" y="24" width="100" height="110" rx="7" fill="none" stroke={INK} strokeWidth="3" />
      <rect x="8" y="142" width="104" height="28" rx="7" fill={INK} />
      <text x="60" y="161" textAnchor="middle" fontFamily="'Lilita One', sans-serif" fontSize={def.name.length > 11 ? 13 : 15} fill={PAPER}>
        {def.name}
      </text>
    </svg>
  )
}

/** Mascot placed in the art window (centre ≈ 60,80). */
const Body = ({ mood, x = 25, y = 45, s = 0.7 }: { mood?: Parameters<typeof MascotBody>[0]['mood']; x?: number; y?: number; s?: number }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}><MascotBody mood={mood} /></g>
)

function Sparkle({ x, y, r = 4, fill = PAPER }: { x: number; y: number; r?: number; fill?: string }) {
  const p = `M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r}Z`
  return <path d={p} fill={fill} stroke={INK} strokeWidth="1" strokeLinejoin="round" />
}

function Art({ card }: { card: CardId }) {
  switch (card) {
    case 'scholar':
      return (
        <>
          <Sparkle x={22} y={36} /><Sparkle x={98} y={48} r={3} />
          <Body mood="happy" />
          {/* mortarboard */}
          <g transform="translate(25 45) scale(0.7)">
            <path d="M34 24 L34 35 Q50 42 66 35 L66 24Z" fill={INK} />
            <path d="M14 20 L50 4 L86 20 L50 36Z" fill={INK} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
            <path d="M18 20 L50 6" stroke={PAPER} strokeWidth="1.5" opacity="0.35" />
            <path d="M50 20 L80 26 L80 44" fill="none" stroke="var(--hl-pink)" strokeWidth="3" strokeLinecap="round" />
            <circle cx="80" cy="47" r="4" fill="var(--hl-pink)" stroke={INK} strokeWidth="1.5" />
          </g>
          {/* diploma */}
          <g transform="rotate(-22 86 116)">
            <rect x="68" y="110" width="36" height="11" rx="5.5" fill={PAPER} stroke={INK} strokeWidth="2.5" />
            <rect x="83" y="109" width="5" height="13" fill="var(--hl-pink)" stroke={INK} strokeWidth="1.5" />
          </g>
        </>
      )
    case 'twins':
      return (
        <>
          <Body mood="happy" x={8} y={58} s={0.5} />
          <Body mood="cheer" x={62} y={58} s={0.5} />
          <Sparkle x={60} y={86} r={6} fill="var(--hl-yellow)" />
          <text x="60" y="56" textAnchor="middle" fontFamily="'Lilita One', sans-serif" fontSize="30" fill={PAPER} stroke={INK} strokeWidth="5" paintOrder="stroke fill">×2</text>
        </>
      )
    case 'jester':
      // Drawn upright, then the whole picture is turned upside down: "reversed".
      return (
        <g transform="rotate(180 60 79)">
          {[[24, 40], [94, 54], [30, 118], [90, 112]].map(([x, y]) => (
            <g key={`${x}-${y}`}>
              <circle cx={x} cy={y} r="6" fill="var(--hl-yellow)" stroke={INK} strokeWidth="2" />
              <text x={x} y={y + 3} textAnchor="middle" fontSize="8" fontWeight="900" fill={INK}>¢</text>
            </g>
          ))}
          <Body mood="happy" />
          <g transform="translate(25 45) scale(0.7)" stroke={INK} strokeWidth="2.5" strokeLinejoin="round">
            <path d="M32 34 Q14 22 2 -2 Q28 10 44 24Z" fill="var(--hl-pink)" />
            <path d="M41 27 Q44 4 50 -16 Q56 4 59 27Z" fill="#3a26d9" />
            <path d="M68 34 Q86 22 98 -2 Q72 10 56 24Z" fill="var(--hl-pink)" />
            <path d="M30 37 Q50 20 70 37 Q50 30 30 37Z" fill={INK} />
            <circle cx="2" cy="-2" r="5.5" fill="var(--hl-yellow)" />
            <circle cx="50" cy="-16" r="5.5" fill="var(--hl-yellow)" />
            <circle cx="98" cy="-2" r="5.5" fill="var(--hl-yellow)" />
          </g>
        </g>
      )
    case 'librarian':
      return (
        <>
          {/* shelf of books behind */}
          {[16, 26, 34, 80, 90, 98].map((x, i) => (
            <rect key={x} x={x} y={i % 2 ? 34 : 40} width="8" height={i % 2 ? 30 : 24} rx="1.5" fill={['var(--hl-pink)', 'var(--hl-yellow)', 'var(--hl-blue)'][i % 3]} stroke={INK} strokeWidth="2" />
          ))}
          <Body mood="idle" />
          {/* glasses */}
          <g transform="translate(25 45) scale(0.7)" fill="none" stroke={INK} strokeWidth="2.6">
            <circle cx="42" cy="46" r="8.5" /><circle cx="58" cy="46" r="8.5" /><path d="M50.5 45 L49.5 45" />
          </g>
          {/* the shield: a giant book */}
          <g>
            <rect x="22" y="98" width="76" height="36" rx="3" fill="var(--hl-green)" stroke={INK} strokeWidth="3" />
            <path d="M60 98 L60 134" stroke={INK} strokeWidth="3" />
            <path d="M30 108 H52 M30 115 H50 M68 108 H90 M68 115 H86" stroke={INK} strokeWidth="2" strokeLinecap="round" opacity="0.5" />
          </g>
        </>
      )
    case 'oracle':
      return (
        <>
          {[[20, 36, 3], [96, 34, 4], [88, 64, 2.5], [18, 70, 2.5], [40, 30, 2]].map(([x, y, r]) => (
            <Sparkle key={`${x}-${y}`} x={x} y={y} r={r} fill="var(--hl-yellow)" />
          ))}
          <Body mood="think" y={38} />
          <path d="M40 132 L80 132 L73 118 L47 118Z" fill={INK} />
          <circle cx="60" cy="100" r="22" fill="#c4b5ff" stroke={INK} strokeWidth="3" />
          <path d="M48 100 Q52 88 64 86" fill="none" stroke={PAPER} strokeWidth="4" strokeLinecap="round" />
          <text x="60" y="108" textAnchor="middle" fontFamily="'Lilita One', sans-serif" fontSize="15" fill="#3a26d9" opacity="0.7">✕✕</text>
        </>
      )
    case 'redacted':
      return (
        <>
          {[38, 52, 66, 80, 94, 108, 122].map((y) => (
            <rect key={y} x="14" y={y} width={y % 28 ? 70 : 88} height="4" rx="2" fill={INK} opacity="0.12" />
          ))}
          <Body mood="sad" />
          <g transform="translate(25 45) scale(0.7)" fill={INK}>
            <rect x="48" y="37" width="28" height="15" rx="1.5" transform="rotate(-4 62 44)" />
            <rect x="30" y="54" width="42" height="11" rx="1.5" transform="rotate(3 51 59)" />
          </g>
          <g transform="rotate(-14 60 116)">
            <rect x="24" y="106" width="72" height="20" rx="4" fill="none" stroke="#d21f5a" strokeWidth="3" />
            <text x="60" y="121" textAnchor="middle" fontFamily="'Lilita One', sans-serif" fontSize="14" fill="#d21f5a">REDACTED</text>
          </g>
        </>
      )
  }
}

/** Card back: ultramarine with a halftone screen and a big asterisk. */
export function CardBack() {
  const uid = useId().replace(/:/g, '')
  return (
    <svg viewBox="0 0 120 180" className="block h-full w-full" aria-hidden>
      <defs>
        <pattern id={`dots-${uid}`} width="8" height="8" patternUnits="userSpaceOnUse">
          <circle cx="4" cy="4" r="1.1" fill={PAPER} opacity="0.22" />
        </pattern>
      </defs>
      <rect x="2" y="2" width="116" height="176" rx="12" fill="#3a26d9" stroke={INK} strokeWidth="4" />
      <rect x="2" y="2" width="116" height="176" rx="12" fill={`url(#dots-${uid})`} />
      <rect x="10" y="10" width="100" height="160" rx="8" fill="none" stroke={PAPER} strokeWidth="2" strokeDasharray="4 4" opacity="0.7" />
      <g strokeLinecap="round" transform="translate(60 90)">
        {[0, 60, 120].map((d) => <line key={`o${d}`} x1="0" y1="-34" x2="0" y2="34" stroke={INK} strokeWidth="20" transform={`rotate(${d})`} />)}
        {[0, 60, 120].map((d) => <line key={d} x1="0" y1="-34" x2="0" y2="34" stroke="var(--hl-yellow)" strokeWidth="14" transform={`rotate(${d})`} />)}
      </g>
      <text x="60" y="160" textAnchor="middle" fontFamily="'Lilita One', sans-serif" fontSize="13" fill={PAPER} letterSpacing="2">CITED</text>
    </svg>
  )
}

/** A card that flips from its back to its face. */
export function FlipCard({
  card, faceUp, onClick, disabled, dim, className, testId,
}: {
  card?: CardId
  faceUp: boolean
  onClick?: () => void
  disabled?: boolean
  dim?: boolean
  className?: string
  testId?: string
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      disabled={onClick ? disabled : undefined}
      data-testid={testId}
      aria-label={faceUp && card ? `${CARDS[card].name}: ${CARDS[card].effect}` : 'Face-down card'}
      className={cn('flip-card aspect-[2/3] w-full', faceUp && 'is-flipped', dim && 'opacity-45', onClick && !disabled && 'flip-hover', className)}
    >
      <span className="flip-inner">
        <span className="flip-face"><CardBack /></span>
        <span className="flip-face flip-front">{card ? <CardFace card={card} /> : null}</span>
      </span>
    </Tag>
  )
}
