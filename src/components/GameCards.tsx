/**
 * In-game pieces for footnote cards, solo runs and the card feed.
 * Everything here only READS records and asks the server to act.
 */
import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { callAction } from '@/lib/call-action'
import { CARDS, cardEffect, streakMultiplier, type CardId, type CardPlay, type Draw, type Player, type Rec } from '@/lib/game-logic'
import { FlipCard } from './TarotCard'
import { Mascot } from './Mascot'


/** After a right answer: pick 1 of 3 face-down cards, then see what you got. */
export function CardPicker({
  gameId, index, draw, players, meId, lastQuestion,
}: {
  gameId: string
  index: number
  draw?: Draw
  players: Rec<Player>[]
  meId: string | null
  lastQuestion: boolean
}) {
  const { error } = useToast()
  const [busy, setBusy] = useState<number | null>(null)
  // What the server just dealt, until the draws subscription catches up.
  const [local, setLocal] = useState<{ card: CardId; offered: CardId[]; slot: number } | null>(null)
  const [showRest, setShowRest] = useState(false)
  const shown = draw ?? (local ? { ...local, status: 'done' as const } : null)

  useEffect(() => {
    if (!shown) return
    const t = setTimeout(() => setShowRest(true), local ? 900 : 0)
    return () => clearTimeout(t)
  }, [shown, local])

  async function pick(slot: number) {
    if (busy != null || shown) return
    setBusy(slot)
    const r = await callAction<{ card: CardId; offered: CardId[] }>('drawCard', { gameId, index, slot })
    setBusy(null)
    if (!r.success) return error('No card this time', r.error)
    setLocal({ card: r.data.card, offered: r.data.offered, slot })
  }

  return (
    <section id="card-picker" className="sheet mt-6 scroll-mt-24 p-5" data-testid="card-picker">
      <div>
        <div>
          <h3 className="font-display text-2xl leading-none">{shown ? CARDS[shown.card].name : 'You earned a card!'}</h3>
          <p className="mt-1 text-sm font-bold opacity-70">
            {shown ? cardEffect(shown.card, lastQuestion) : 'Pick one. Choose before the next question opens.'}
          </p>
        </div>
      </div>

      <div className="mx-auto mt-4 grid max-w-md grid-cols-3 gap-3 sm:gap-4">
        {[0, 1, 2].map((slot) => {
          const mine = shown?.slot === slot
          const card = shown ? shown.offered?.[slot] : undefined
          return (
            <div key={slot} className="deal" style={{ animationDelay: `${slot * 90}ms` }}>
              <FlipCard
                card={card}
                faceUp={!!shown && (mine || showRest)}
                dim={!!shown && !mine}
                onClick={shown ? undefined : () => pick(slot)}
                disabled={busy != null}
                testId={`card-slot-${slot}`}
                className={cn(mine && 'scale-105', busy === slot && 'animate-pulse')}
              />
            </div>
          )
        })}
      </div>
      {busy != null && <p className="mt-3 flex items-center justify-center gap-2 text-sm font-bold"><Loader2 className="h-4 w-4 animate-spin" />Shuffling…</p>}
      {shown?.card === 'jester' && (draw?.status ?? 'pending') === 'pending' && (
        <JesterPrompt gameId={gameId} index={index} players={players} meId={meId} />
      )}
      {shown && showRest && shown.offered && (
        <p className="mt-3 text-center text-sm font-bold opacity-60">
          You could have had: {shown.offered.filter((_, i) => i !== shown.slot).map((c) => CARDS[c].name).join(' or ')}
        </p>
      )}
    </section>
  )
}

/** The Jester (reversed): pick whose points to raid. */
export function JesterPrompt({
  gameId, index, players, meId, compact,
}: { gameId: string; index: number; players: Rec<Player>[]; meId: string | null; compact?: boolean }) {
  const { error, success } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const targets = players.filter((p) => p.data.userId !== meId)
  async function steal(targetUserId: string) {
    setBusy(targetUserId)
    const r = await callAction<{ amount: number; blocked: boolean; targetName: string }>('playSteal', { gameId, index, targetUserId })
    setBusy(null)
    if (!r.success) return error('Steal failed', r.error)
    if (r.data.blocked) error('Blocked!', `${r.data.targetName}’s Librarian shield stopped your Jester.`)
    else success('Stolen!', `You took ${r.data.amount} points from ${r.data.targetName}.`)
  }
  return (
    <div className={cn('rounded-2xl border-[3px] border-[var(--ink)] bg-hl-1 p-3 text-ink', !compact && 'mt-4')} data-testid="jester-prompt">
      <p className="font-display text-xl leading-tight">Who are you stealing from?</p>
      <p className="text-xs font-bold opacity-70">Takes 20% of their points, unless they’re hiding behind a Librarian.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {targets.map((p) => (
          <button
            key={p.recordId}
            onClick={() => steal(p.data.userId)}
            disabled={busy != null}
            data-testid="steal-target"
            className="pop rounded-xl bg-paper px-3 py-1.5 text-sm font-black"
          >
            {busy === p.data.userId ? 'Stealing…' : `${p.data.name ?? 'Player'} · ${p.data.score}`}
          </button>
        ))}
      </div>
    </div>
  )
}

export function describePlay(p: CardPlay): string {
  const who = p.actorName ?? 'Someone'
  switch (p.card) {
    case 'jester':
      if (p.blocked) return `${p.targetName}’s Librarian blocked ${who}’s Jester!`
      if (!p.targetDelta) return `${who} tried to rob ${p.targetName}, but their pockets were empty!`
      return `${who} played The Jester on ${p.targetName}: −${Math.abs(p.targetDelta)}!`
    case 'scholar': return `${who} drew The Scholar: +${p.actorDelta}`
    case 'redacted': return `${who} drew Redacted: ${p.actorDelta}`
    case 'librarian': return `${who} is hiding behind The Librarian`
    case 'twins': return p.actorDelta ? `${who} drew The Twins: +${p.actorDelta} (doubled!)` : `${who} drew The Twins: next answer doubles`
    case 'oracle': return `${who} drew The Oracle and sees the future`
  }
}

/** Big announcement for the newest card play, shown for a few seconds. */
export function FeedBanner({ plays, meId }: { plays: Rec<CardPlay>[]; meId: string | null }) {
  const seen = useRef<Set<string> | null>(null)
  const [banner, setBanner] = useState<Rec<CardPlay> | null>(null)
  useEffect(() => {
    if (seen.current == null) { seen.current = new Set(plays.map((p) => p.recordId)); return }
    const fresh = plays.filter((p) => !seen.current!.has(p.recordId))
    if (fresh.length === 0) return
    for (const p of fresh) seen.current.add(p.recordId)
    // Prefer showing a steal, which is the juicy one.
    setBanner(fresh.find((p) => p.data.card === 'jester') ?? fresh[fresh.length - 1])
    const t = setTimeout(() => setBanner(null), 6000)
    return () => clearTimeout(t)
  }, [plays])
  if (!banner) return null
  const hitMe = banner.data.targetId === meId && !banner.data.blocked
  return (
    <div className={cn('feed-in sticker mb-5 flex w-full items-center gap-3 px-4 py-2.5', hitMe ? 'bg-hl-1' : 'bg-hl-0')} role="status" data-testid="feed-banner">
      <Mascot mood={hitMe ? 'sad' : banner.data.card === 'jester' ? 'wow' : 'happy'} size={40} />
      <p className="font-display text-xl leading-tight">{describePlay(banner.data)}</p>
    </div>
  )
}

export function CardFeed({ plays }: { plays: Rec<CardPlay>[] }) {
  if (plays.length === 0) return null
  const recent = [...plays].reverse().slice(0, 6)
  return (
    <div className="sheet mt-5 overflow-hidden">
      <p className="font-display border-b-[3px] border-[var(--ink)] bg-hl-1 px-4 py-2 text-xl">Card plays</p>
      <ul className="space-y-1.5 p-3 text-sm font-bold">
        {recent.map((p) => <li key={p.recordId}>✱ {describePlay(p.data)}</li>)}
      </ul>
    </div>
  )
}

/** Solo sidebar: score, streak, best. */
export function SoloPanel({ score, streak, best }: { score: number; streak: number; best?: number }) {
  return (
    <div className="sheet overflow-hidden" data-testid="solo-panel">
      <p className="font-display border-b-[3px] border-[var(--ink)] bg-hl-0 px-4 py-2 text-xl">Your run</p>
      <dl className="grid grid-cols-2 gap-3 p-4">
        <div><dt className="text-xs font-black uppercase opacity-60">Score</dt><dd className="font-display text-3xl leading-none">{score}</dd></div>
        <div>
          <dt className="text-xs font-black uppercase opacity-60">Streak</dt>
          <dd className="font-display text-3xl leading-none">{streak}{streak >= 2 && <span className="ml-1 text-base">🔥</span>}</dd>
        </div>
        {streak >= 2 && <p className="col-span-2 text-xs font-bold opacity-70">Next right answer: ×{streakMultiplier(streak + 1).toFixed(1)} points</p>}
        {best != null && best > 0 && <p className="col-span-2 text-sm font-bold">Best on this topic: {best}</p>}
      </dl>
    </div>
  )
}
