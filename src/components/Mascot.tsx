/**
 * Cited's mascot: a footnote asterisk with a face. Pure SVG + CSS animation
 * (keyframes in themes.css), so it also renders on the prerendered landing.
 *
 *   idle  — gentle bob, blinks
 *   think — arms spin while questions are written / a question is open
 *   happy — hops (you got it right)
 *   cheer — keeps jumping (final scores, the winner)
 *   sad   — droops (wrong answer, failed game)
 *   wow   — surprised (no answer, reveal)
 */
import { cn } from '@/lib/utils'

export type Mood = 'idle' | 'think' | 'happy' | 'cheer' | 'sad' | 'wow'

export function Mascot({
  mood = 'idle',
  size = 64,
  color = 'var(--hl-yellow)',
  className,
  label,
}: {
  mood?: Mood
  size?: number
  color?: string
  className?: string
  /** Accessible name; omit for a decorative mascot. */
  label?: string
}) {
  const squint = mood === 'happy' || mood === 'cheer'
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      data-mood={mood}
      className={cn('mascot shrink-0', className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <g className="m-body">
        <g className="m-arms" strokeLinecap="round">
          {[0, 60, 120].map((deg) => (
            <line key={`o${deg}`} x1="50" y1="9" x2="50" y2="91" stroke="var(--ink)" strokeWidth="27" transform={`rotate(${deg} 50 50)`} />
          ))}
          {[0, 60, 120].map((deg) => (
            <line key={deg} x1="50" y1="9" x2="50" y2="91" stroke={color} strokeWidth="20" transform={`rotate(${deg} 50 50)`} />
          ))}
        </g>
        <circle cx="50" cy="50" r="21" fill={color} />

        {/* cheeks */}
        <circle cx="35.5" cy="56" r="3.6" fill="var(--hl-pink)" opacity="0.85" />
        <circle cx="64.5" cy="56" r="3.6" fill="var(--hl-pink)" opacity="0.85" />

        {/* eyes */}
        <g className="m-eyes">
          {squint ? (
            <g fill="none" stroke="var(--ink)" strokeWidth="3.4" strokeLinecap="round">
              <path d="M37.5 48 Q42 42 46.5 48" />
              <path d="M53.5 48 Q58 42 62.5 48" />
            </g>
          ) : (
            <>
              <ellipse cx="42" cy="46" rx="5.6" ry={mood === 'wow' ? 7.4 : 6.6} fill="#fff" stroke="var(--ink)" strokeWidth="2" />
              <ellipse cx="58" cy="46" rx="5.6" ry={mood === 'wow' ? 7.4 : 6.6} fill="#fff" stroke="var(--ink)" strokeWidth="2" />
              <circle cx={mood === 'think' ? 44 : 42.6} cy={mood === 'think' ? 43.5 : mood === 'sad' ? 48 : 46.5} r="2.9" fill="var(--ink)" />
              <circle cx={mood === 'think' ? 60 : 58.6} cy={mood === 'think' ? 43.5 : mood === 'sad' ? 48 : 46.5} r="2.9" fill="var(--ink)" />
            </>
          )}
        </g>

        {/* brows for the sad face */}
        {mood === 'sad' && (
          <g stroke="var(--ink)" strokeWidth="2.6" strokeLinecap="round">
            <path d="M36.5 37.5 L45 35" />
            <path d="M63.5 37.5 L55 35" />
          </g>
        )}

        {/* mouth */}
        {mood === 'idle' && <path d="M43 57 Q50 63 57 57" fill="none" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />}
        {mood === 'think' && <path d="M45 59 Q50 57 55 58" fill="none" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />}
        {mood === 'sad' && <path d="M43 61.5 Q50 55.5 57 61.5" fill="none" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />}
        {mood === 'wow' && <ellipse cx="50" cy="59.5" rx="3.6" ry="4.4" fill="var(--ink)" />}
        {squint && (
          <g>
            <path d="M41 55 Q50 67 59 55 Z" fill="var(--ink)" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" />
            <path d="M45.5 60.5 Q50 64.5 54.5 60.5 Q50 58.5 45.5 60.5 Z" fill="var(--hl-pink)" />
          </g>
        )}
      </g>
    </svg>
  )
}

/** Mascot with a speech bubble beside it. */
export function MascotSays({
  mood,
  size = 56,
  children,
  className,
}: {
  mood?: Mood
  size?: number
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <Mascot mood={mood} size={size} />
      <div className="relative rounded-2xl bg-paper px-4 py-2.5 text-ink font-bold leading-snug shadow-[0_4px_0_0_rgba(6,12,28,0.45)]">
        <span className="absolute -left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 rotate-45 bg-paper" aria-hidden />
        <span className="relative">{children}</span>
      </div>
    </div>
  )
}
