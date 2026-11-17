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
    <div className="mx-auto grid max-w-5xl gap-10 px-5 py-12 md:grid-cols-[1.4fr_1fr] md:py-16">
      <section>
        <p className="font-code text-xs uppercase tracking-[0.2em] text-primary">Host a game</p>
        <h1 className="font-display mt-2 text-4xl font-extrabold leading-tight tracking-tight md:text-5xl">
          Pick a topic. We’ll bring the receipts.
        </h1>
        <p className="mt-3 max-w-lg text-muted-foreground">
          Questions are written from real Wikipedia articles, and every answer is revealed with the exact
          sentence that proves it.
        </p>

        <form onSubmit={create} className="mt-8 space-y-5 rounded-lg border border-border bg-card p-5">
          <div>
            <label htmlFor="topic" className="text-sm font-medium">Topic</label>
            <Input
              id="topic"
              data-testid="topic-input"
              className="mt-1.5 h-12 text-base"
              placeholder="e.g. The history of the bicycle"
              maxLength={LIMITS.topicMaxLength}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              required
              minLength={2}
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {TOPIC_IDEAS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTopic(t)}
                  className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground hover:border-primary hover:text-foreground"
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

          <Button type="submit" size="lg" className="w-full" disabled={creating || topic.trim().length < 2} data-testid="create-game">
            {creating ? 'Starting…' : 'Create game'}
            {!creating && <ArrowRight aria-hidden />}
          </Button>
          <p className="text-xs text-muted-foreground">
            Writing and fact-checking the questions takes about half a minute. Your friends can join while it runs.
          </p>
        </form>
      </section>

      <aside className="space-y-8">
        <form onSubmit={join} className="rounded-lg border-2 border-dashed border-border p-5">
          <p className="font-code text-xs uppercase tracking-[0.2em] text-primary">Join a game</p>
          <label htmlFor="code" className="sr-only">Join code</label>
          <Input
            id="code"
            data-testid="join-code"
            className="font-code mt-3 h-14 text-center text-2xl uppercase tracking-[0.4em]"
            placeholder="ABCDE"
            maxLength={5}
            autoComplete="off"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <Button type="submit" variant="secondary" className="mt-3 w-full" disabled={joining || code.trim().length !== 5}>
            {joining ? 'Joining…' : 'Join'}
          </Button>
        </form>

        {myGames.length > 0 && (
          <div>
            <h2 className="font-code text-xs uppercase tracking-[0.2em] text-muted-foreground">Your recent games</h2>
            <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-card">
              {myGames.map((g) => (
                <li key={g.recordId}>
                  <button
                    onClick={() => navigate(`/g/${g.data.code}`)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted"
                  >
                    <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{g.data.topic}</span>
                    <span className="font-code text-xs text-muted-foreground">{g.data.code}</span>
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
      <legend className="text-sm font-medium">{label}</legend>
      <div className="mt-1.5 flex rounded-md border border-input bg-background p-0.5">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={value === o}
            onClick={() => onChange(o)}
            className={cn(
              'font-code flex-1 rounded-[4px] py-1.5 text-sm',
              value === o ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
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
      'font-code rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider',
      status === 'question' || status === 'reveal' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
    )}>
      {label[status]}
    </span>
  )
}
