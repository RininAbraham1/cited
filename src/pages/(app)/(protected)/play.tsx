/**
 * /play — the hub: start a game on any topic, or join one by code.
 * Both go through server actions; the page itself never writes records.
 */

import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, useQuery } from 'deepspace'
import { ArrowRight, BookOpen } from 'lucide-react'
import { Button, Input, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { Mascot } from '@/components/Mascot'
import { callAction } from '@/lib/call-action'
import { LIMITS, type Game } from '@/lib/game-logic'

const TOPIC_IDEAS = ['Octopuses', 'The Apollo program', 'Jazz in the 1920s', 'Volcanoes', 'Ancient Rome', 'Coffee']

export default function PlayPage() {
  const navigate = useNavigate()
  const { error } = useToast()
  const { userId } = useAuth()

  const [topic, setTopic] = useState('')
  const [questionCount, setQuestionCount] = useState<number>(8)
  const [seconds, setSeconds] = useState<number>(20)
  const [creating, setCreating] = useState(false)

  const [code, setCode] = useState('')
  const [joining, setJoining] = useState(false)

  const { records: myGames } = useQuery<Game>('games', {
    where: { hostId: userId ?? '__none__' },
    orderBy: 'createdAt',
    orderDir: 'desc',
    limit: 5,
  })

  async function create(e: FormEvent) {
    e.preventDefault()
    if (creating) return
    setCreating(true)
    const r = await callAction<{ code: string }>('createGame', {
      topic,
      questionCount,
      secondsPerQuestion: seconds,
    })
    setCreating(false)
    if (!r.success) return error('Couldn’t start a game', r.error)
    navigate(`/g/${r.data.code}`)
  }

  async function join(e: FormEvent) {
    e.preventDefault()
    if (joining) return
    setJoining(true)
    const r = await callAction<{ code: string }>('joinGame', { code })
    setJoining(false)
    if (!r.success) return error('Couldn’t join', r.error)
    navigate(`/g/${r.data.code}`)
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-10 px-5 py-10 md:grid-cols-[1.45fr_1fr] md:py-14">
      <section>
        <div className="flex items-end gap-3">
          <Mascot mood="idle" size={70} />
          <h1 className="title-pop text-5xl leading-[0.95] md:text-6xl">Pick a topic</h1>
        </div>
        <p className="mt-4 max-w-lg font-semibold text-muted-foreground">
          We read the Wikipedia articles, write the questions and check every answer against the text.
        </p>

        <form onSubmit={create} className="sheet mt-7 space-y-5 p-5 md:p-6">
          <div>
            <label htmlFor="topic" className="font-display text-xl">Topic</label>
            <Input
              id="topic"
              data-testid="topic-input"
              className="mt-1.5 h-14 text-lg md:text-lg"
              placeholder="e.g. The history of the bicycle"
              maxLength={LIMITS.topicMaxLength}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              required
              minLength={2}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              {TOPIC_IDEAS.map((t, i) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTopic(t)}
                  className={cn(
                    `pop bg-hl-${i % 4} rounded-full px-3 py-0.5 text-sm font-black text-ink`,
                    topic !== t && 'opacity-70 hover:opacity-100',
                    topic === t && 'rotate-[-3deg]',
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Segmented label="Questions" options={LIMITS.questionCounts} value={questionCount} onChange={setQuestionCount} />
            <Segmented label="Seconds each" options={LIMITS.secondsOptions} value={seconds} onChange={setSeconds} />
          </div>

          <Button type="submit" size="lg" className="font-display h-14 w-full rounded-2xl bg-hl-1 text-2xl font-normal" disabled={creating || topic.trim().length < 2} data-testid="create-game">
            {creating ? 'Starting…' : 'Create game'}
            {!creating && <ArrowRight className="size-6" strokeWidth={3} aria-hidden />}
          </Button>
          <p className="text-xs font-semibold opacity-60">
            Writing and fact-checking the questions takes about half a minute. Your friends can join while it runs.
          </p>
        </form>
      </section>

      <aside className="space-y-8 md:pt-20">
        <form onSubmit={join} className="sheet relative rotate-[1.5deg] bg-hl-3 p-5">
          <Mascot mood="wow" size={56} className="absolute -right-4 -top-8 rotate-12" />
          <p className="font-display text-3xl leading-none">Got a code?</p>
          <p className="mt-1 text-sm font-bold opacity-70">Join a friend’s game.</p>
          <label htmlFor="code" className="sr-only">Join code</label>
          <Input
            id="code"
            data-testid="join-code"
            className="font-code mt-3 h-16 text-center text-3xl uppercase tracking-[0.35em] md:text-3xl"
            placeholder="ABCDE"
            maxLength={5}
            autoComplete="off"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <Button type="submit" size="lg" className="font-display mt-4 h-12 w-full text-xl font-normal" disabled={joining || code.trim().length !== 5}>
            {joining ? 'Joining…' : 'Join'}
          </Button>
        </form>

        {myGames.length > 0 && (
          <div>
            <h2 className="font-display text-2xl">Your recent games</h2>
            <ul className="sheet mt-2 divide-y-2 divide-[var(--ink)]/15 overflow-hidden">
              {myGames.map((g) => (
                <li key={g.recordId}>
                  <button
                    onClick={() => navigate(`/g/${g.data.code}`)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left font-bold hover:bg-[var(--hl-yellow)]/40"
                  >
                    <BookOpen className="h-4 w-4 shrink-0 opacity-50" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{g.data.topic}</span>
                    <span className="font-code text-xs opacity-60">{g.data.code}</span>
                    <StatusPill status={g.data.status} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
  )
}

function Segmented<T extends number>({
  label, options, value, onChange,
}: { label: string; options: readonly T[]; value: number; onChange: (v: T) => void }) {
  return (
    <fieldset>
      <legend className="font-display text-lg">{label}</legend>
      <div className="mt-1 flex gap-1 rounded-xl border-[3px] border-[var(--ink)] bg-white p-1">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={value === o}
            onClick={() => onChange(o)}
            className={cn(
              'font-code flex-1 rounded-lg py-1.5 text-sm transition-colors',
              value === o ? 'bg-ink text-paper' : 'text-ink/60 hover:bg-[var(--hl-yellow)]/50 hover:text-ink',
            )}
          >
            {o}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

export function StatusPill({ status }: { status: Game['status'] }) {
  const label: Record<Game['status'], string> = {
    generating: 'writing', lobby: 'lobby', question: 'live', reveal: 'live', finished: 'done', failed: 'failed',
  }
  return (
    <span className={cn(
      'font-code rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider',
      status === 'question' || status === 'reveal' ? 'bg-hl-2 text-ink' : status === 'failed' ? 'bg-hl-1 text-ink' : 'bg-ink/10 text-ink',
    )}>
      {label[status]}
    </span>
  )
}
