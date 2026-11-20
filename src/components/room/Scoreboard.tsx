/** Live scoreboard with presence dots and who has answered. */
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { type Player, type Rec } from '@/lib/game-logic'

export function Scoreboard({
  players, online, meId, hostId, highlightIndex,
}: { players: Rec<Player>[]; online: Set<string>; meId: string | null; hostId: string; highlightIndex: number | null }) {
  return (
    <div className="sheet overflow-hidden">
      <p className="font-display flex items-center justify-between border-b-[3px] border-[var(--ink)] bg-hl-0 px-4 py-2 text-xl">
        Players <span className="font-code rounded-full bg-ink px-2 text-sm text-paper">{players.length}</span>
      </p>
      <ol className="space-y-1 p-2" data-testid="scoreboard">
        {players.map((p, i) => {
          const answered = highlightIndex != null && p.data.lastAnswered === highlightIndex
          const isOnline = online.has(p.data.userId)
          return (
            <li key={p.recordId} className={cn('flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-sm', p.data.userId === meId && 'bg-[var(--hl-yellow)]/45')}>
              <span className="relative">
                <span className={`bg-hl-${i % 4} font-display grid h-9 w-9 place-items-center rounded-full border-[3px] border-[var(--ink)] text-base`}>
                  {(p.data.name?.[0] ?? '?').toUpperCase()}
                </span>
                <span
                  className={cn('absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-[3px] border-[var(--paper)]', isOnline ? 'bg-[#16a34a]' : 'bg-[#9ca3af]')}
                  title={isOnline ? 'In the room' : 'Away'}
                />
              </span>
              <span className="min-w-0 flex-1 truncate font-black">
                {p.data.name}
                {p.data.userId === hostId && <span className="ml-1.5 rounded-full bg-ink px-1.5 text-[10px] font-black uppercase text-paper">host</span>}
              </span>
              {answered && <Check className="h-4 w-4 text-[#16a34a]" strokeWidth={4} aria-label="Answered" />}
              <span className="font-code text-base tabular-nums">{p.data.score}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
