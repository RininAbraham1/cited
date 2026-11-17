/**
 * /g/:code — the live game room.
 *
 * Everything on screen is derived from records the server writes; this page
 * only READS (useQuery) and asks for moves (server actions). Live updates
 * arrive over the RecordRoom WebSocket, so the host advancing a question
 * re-renders every player's screen with no polling.
 *
 *   games      → phase, timer deadline, generation progress
 *   players    → scoreboard and "n of m answered" (lastAnswered)
 *   questions  → the open question; answer + source quote appear at reveal
 *   answers    → RBAC returns only MY rows, so I can see my lock-in
 *   presence   → who has this room open right now (PresenceRoom DO)
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth, usePresenceRoom, useQuery } from 'deepspace'
import { Check, Copy, ExternalLink, Loader2, Volume2, VolumeX, X } from 'lucide-react'
import { Button, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { callAction } from '@/lib/call-action'
import { LIMITS, type Answer, type Game, type Player, type PublicQuestion } from '@/lib/game-logic'

const LETTERS = ['A', 'B', 'C', 'D']

type Rec<T> = { recordId: string; data: T }

export default function GameRoomPage() {
  const { code = '' } = useParams()
  const upper = code.toUpperCase()
  const { records: games, status } = useQuery<Game>('games', { where: { code: upper }, limit: 1 })
  const game = games[0]

  if (status === 'loading') return <Centered><Loader2 className="h-5 w-5 animate-spin" aria-label="Loading" /></Centered>
  if (!game) {
    return (
      <Centered>
        <p className="font-display text-2xl font-bold">No game with code {upper}</p>
        <Link to="/play" className="mt-3 text-sm text-primary underline">Back to Play</Link>
      </Centered>
    )
  }
  return <Room gameId={game.recordId} game={game.data} />
}

function Room({ gameId, game }: { gameId: string; game: Game }) {
  const { userId } = useAuth()
  const { error: toastError } = useToast()
  const isHost = userId === game.hostId

  const { records: players } = useQuery<Player>('players', { where: { gameId }, orderBy: 'score', orderDir: 'desc' })
  const { records: questions } = useQuery<PublicQuestion>('questions', { where: { gameId } })
  const { records: myAnswers } = useQuery<Answer>('answers', { where: { gameId } })
  const { peers } = usePresenceRoom(`game:${gameId}`)

  const me = players.find((p) => p.data.userId === userId)
  const current = questions.find((q) => q.data.index === game.currentIndex)?.data
  const myAnswer = myAnswers.find((a) => a.data.index === game.currentIndex)?.data
  const online = useMemo(() => new Set([...(userId ? [userId] : []), ...peers.map((p) => p.userId)]), [peers, userId])

  // Joining is idempotent server-side; do it once when landing via a shared link.
  const joinTried = useRef(false)
  useEffect(() => {
    if (!userId || me || joinTried.current || players.length === 0) return
    if (game.status === 'finished' || game.status === 'failed') return
    joinTried.current = true
    void callAction('joinGame', { code: game.code }).then((r) => {
      if (!r.success) toastError('Couldn’t join', r.error)
    })
  }, [userId, me, players.length, game.status, game.code, toastError])

  const now = useNow(game.status === 'question' ? 200 : 1000)
  const remainingMs = Math.max(0, (game.endsAt ?? 0) - now)

  // Reveal when time runs out. The host's tab does it right at the deadline;
  // everyone else's tab is a fallback a few seconds later (the server only
  // lets non-hosts reveal after the deadline), so a closed host tab can't
  // freeze the room. The server makes repeats harmless.
  const answeredCount = players.filter((p) => p.data.lastAnswered === game.currentIndex).length
  const allAnswered = players.length > 0 && answeredCount >= players.length
  const revealSent = useRef(-1)
  useEffect(() => {
    if (game.status !== 'question' || revealSent.current === game.currentIndex) return
    const overdueBy = now - (game.endsAt ?? Infinity) - LIMITS.answerGraceMs
    const shouldReveal = isHost ? overdueBy >= 0 || allAnswered : overdueBy >= 2500
    if (!shouldReveal) return
    revealSent.current = game.currentIndex
    void callAction('reveal', { gameId })
  }, [now, game.status, game.currentIndex, game.endsAt, isHost, allAnswered, gameId])

  return (
    <div className="mx-auto max-w-5xl px-5 py-8 md:py-10">
      <Header game={game} isHost={isHost} gameId={gameId} />

      <div className="mt-6 grid gap-8 md:grid-cols-[1fr_17rem]">
        <main className="min-w-0">
          {game.status === 'generating' && <Generating stage={game.stage} topic={game.topic} />}
          {game.status === 'failed' && <Failed message={game.error} />}
          {game.status === 'lobby' && <Lobby game={game} isHost={isHost} gameId={gameId} playerCount={players.length} />}
          {(game.status === 'question' || game.status === 'reveal') && current && (
            <QuestionCard
              key={current.index}
              gameId={gameId}
              game={game}
              question={current}
              myAnswer={myAnswer}
              remainingMs={remainingMs}
              answeredCount={answeredCount}
              playerCount={players.length}
              isPlayer={!!me}
            />
          )}
          {game.status === 'finished' && <Finished game={game} players={players} questions={questions} />}
        </main>

        <aside>
          <Scoreboard players={players} online={online} meId={userId} hostId={game.hostId} highlightIndex={game.status === 'question' ? game.currentIndex : null} />
        </aside>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function Header({ game, isHost, gameId }: { game: Game; isHost: boolean; gameId: string }) {
  const [copied, setCopied] = useState(false)
  const link = typeof window !== 'undefined' ? `${window.location.origin}/g/${game.code}` : ''
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
      <div className="min-w-0">
        <p className="font-code text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Hosted by {game.hostName ?? 'someone'}
          {game.status !== 'generating' && game.status !== 'lobby' && game.status !== 'failed' && (
            <> · Question {Math.min(game.currentIndex + 1, game.questionCount)} of {game.questionCount}</>
          )}
        </p>
        <h1 className="font-display mt-1 truncate text-3xl font-extrabold tracking-tight md:text-4xl">{game.topic}</h1>
      </div>
      <div className="flex items-center gap-3">
        {isHost && <HostControls game={game} gameId={gameId} />}
        <button
          onClick={() => { void navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
          className="group flex items-center gap-2 rounded-md border-2 border-foreground bg-card px-3 py-1.5"
          title="Copy invite link"
        >
          <span className="font-code text-xl font-semibold tracking-[0.25em]" data-testid="join-code-display">{game.code}</span>
          {copied ? <Check className="h-4 w-4 text-primary" aria-label="Copied" /> : <Copy className="h-4 w-4 text-muted-foreground group-hover:text-foreground" aria-hidden />}
        </button>
      </div>
    </header>
  )
}

function HostControls({ game, gameId }: { game: Game; gameId: string }) {
  const { error } = useToast()
  const [busy, setBusy] = useState(false)
  const [readAloud, setReadAloud] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const spokenRef = useRef(-1)

  // Read each newly opened question aloud on the host's screen (the one
  // usually on the TV). Generated on demand and never stored: audio is
  // ~20 KB of data URL per question and only this tab needs it.
  useEffect(() => {
    if (!readAloud || game.status !== 'question' || spokenRef.current === game.currentIndex) return
    spokenRef.current = game.currentIndex
    void callAction<{ audioUrl: string }>('speakQuestion', { gameId }).then((r) => {
      if (!r.success) return error('Couldn’t read the question aloud', r.error)
      audioRef.current?.pause()
      audioRef.current = new Audio(r.data.audioUrl)
      void audioRef.current.play().catch(() => {})
    })
  }, [readAloud, game.status, game.currentIndex, gameId, error])
  useEffect(() => () => audioRef.current?.pause(), [])

  async function run(name: 'advance' | 'reveal') {
    setBusy(true)
    const r = await callAction(name, { gameId })
    setBusy(false)
    if (!r.success) error('Hmm', r.error)
  }

  const last = game.currentIndex + 1 >= game.questionCount
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => { setReadAloud((v) => !v); spokenRef.current = readAloud ? spokenRef.current : -1 }}
        aria-pressed={readAloud}
        title={readAloud ? 'Stop reading questions aloud' : 'Read questions aloud (ElevenLabs)'}
      >
        {readAloud ? <Volume2 /> : <VolumeX />}
      </Button>
      {game.status === 'lobby' && <Button onClick={() => run('advance')} disabled={busy} data-testid="start-game">Start game</Button>}
      {game.status === 'question' && <Button variant="outline" onClick={() => run('reveal')} disabled={busy}>Reveal now</Button>}
      {game.status === 'reveal' && (
        <Button onClick={() => run('advance')} disabled={busy} data-testid="next-question">
          {last ? 'Final scores' : 'Next question'}
        </Button>
      )}
    </div>
  )
}

function Generating({ stage, topic }: { stage?: string; topic: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-8">
      <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
      <h2 className="font-display mt-4 text-2xl font-bold">Researching “{topic}”</h2>
      <p className="mt-2 text-muted-foreground" aria-live="polite">{stage || 'Starting…'}</p>
      <p className="mt-6 text-sm text-muted-foreground">
        Claude writes the questions from the articles, then every question is checked: if its quoted evidence
        isn’t word-for-word in the article, it’s thrown out. Share the code while you wait.
      </p>
    </div>
  )
}

function Failed({ message }: { message?: string }) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-card p-8">
      <h2 className="font-display text-2xl font-bold">This one didn’t pan out</h2>
      <p className="mt-2 text-muted-foreground">{message || 'Question generation failed.'}</p>
      <Link to="/play" className="mt-5 inline-block text-sm font-medium text-primary underline">Try another topic</Link>
    </div>
  )
}

function Lobby({ game, isHost, playerCount }: { game: Game; isHost: boolean; gameId: string; playerCount: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-8">
      <p className="font-code text-xs uppercase tracking-[0.2em] text-primary">Ready · {game.questionCount} questions · {game.secondsPerQuestion} sec each</p>
      <h2 className="font-display mt-3 text-3xl font-bold">
        {isHost ? 'Start when everyone’s in.' : 'Waiting for the host to start…'}
      </h2>
      <p className="mt-3 text-muted-foreground">
        {playerCount} {playerCount === 1 ? 'player' : 'players'} in the room. Others can join at{' '}
        <span className="font-code text-foreground">/g/{game.code}</span> or with the code above.
      </p>
      {game.sources && game.sources.length > 0 && (
        <div className="mt-6">
          <p className="text-sm font-medium">Questions are drawn from:</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {game.sources.map((s) => (
              <li key={s.title}>
                <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-sm hover:border-primary">
                  {s.title} <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function QuestionCard({
  gameId, game, question, myAnswer, remainingMs, answeredCount, playerCount, isPlayer,
}: {
  gameId: string
  game: Game
  question: PublicQuestion
  myAnswer?: Answer
  remainingMs: number
  answeredCount: number
  playerCount: number
  isPlayer: boolean
}) {
  const { error } = useToast()
  const [pending, setPending] = useState<number | null>(null)
  const revealed = game.status === 'reveal' && question.answerIndex != null
  const locked = myAnswer?.choice ?? pending
  const closed = game.status !== 'question' || remainingMs <= 0
  const total = game.secondsPerQuestion * 1000
  const dist = question.distribution ?? []
  const maxVotes = Math.max(1, ...dist)

  async function answer(choice: number) {
    if (locked != null || closed || !isPlayer) return
    setPending(choice)
    const r = await callAction('submitAnswer', { gameId, index: question.index, choice })
    if (!r.success) {
      setPending(null)
      error('Answer not recorded', r.error)
    }
  }

  return (
    <div>
      {/* Timer bar */}
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div
          className={cn('h-full transition-[width] duration-200 ease-linear', remainingMs < 5000 ? 'bg-primary' : 'bg-foreground')}
          style={{ width: `${revealed ? 0 : (remainingMs / total) * 100}%` }}
        />
      </div>
      <div className="mt-2 flex justify-between font-code text-xs text-muted-foreground">
        <span>{revealed ? 'Answer' : `${Math.ceil(remainingMs / 1000)}s`}</span>
        <span>{answeredCount}/{playerCount} answered</span>
      </div>

      <h2 className="font-display mt-6 text-2xl font-bold leading-snug md:text-3xl" data-testid="question-prompt">
        {question.prompt}
      </h2>

      <ol className="mt-6 grid gap-3 sm:grid-cols-2">
        {question.choices.map((choice, i) => {
          const isMine = locked === i
          const isRight = revealed && question.answerIndex === i
          const isWrongMine = revealed && isMine && !isRight
          return (
            <li key={i}>
              <button
                onClick={() => answer(i)}
                disabled={locked != null || closed || !isPlayer}
                data-testid={`choice-${i}`}
                className={cn(
                  'relative flex w-full items-center gap-3 overflow-hidden rounded-md border-2 bg-card px-4 py-4 text-left transition-colors',
                  !revealed && locked == null && !closed && 'hover:border-foreground',
                  !revealed && isMine && 'border-foreground bg-foreground text-background',
                  !revealed && !isMine && 'border-border',
                  revealed && isRight && 'border-primary',
                  revealed && !isRight && 'border-border opacity-70',
                  isWrongMine && 'border-dashed',
                )}
              >
                {revealed && (
                  <span
                    className={cn('absolute inset-y-0 left-0', isRight ? 'bg-primary/15' : 'bg-muted')}
                    style={{ width: `${((dist[i] ?? 0) / maxVotes) * 100}%` }}
                    aria-hidden
                  />
                )}
                <span className="font-code relative w-5 shrink-0 text-sm font-semibold">{LETTERS[i]}</span>
                <span className="relative flex-1 font-medium">{choice}</span>
                {revealed && <span className="font-code relative text-xs text-muted-foreground">{dist[i] ?? 0}</span>}
                {revealed && isRight && <Check className="relative h-5 w-5 text-primary" aria-label="Correct answer" />}
                {isWrongMine && <X className="relative h-5 w-5 text-muted-foreground" aria-label="Your answer" />}
              </button>
            </li>
          )
        })}
      </ol>

      {!revealed && (
        <p className="mt-4 text-sm text-muted-foreground" aria-live="polite">
          {!isPlayer ? 'Joining…' : locked != null ? 'Locked in. Waiting for the reveal…' : closed ? 'Time’s up!' : 'Faster correct answers score more.'}
        </p>
      )}

      {revealed && (
        <div className="mt-6">
          {myAnswer?.points != null && (
            <p className="stamp font-display inline-block rounded border-2 border-primary px-3 py-1 text-lg font-extrabold uppercase text-primary">
              {myAnswer.correct ? `+${myAnswer.points}` : 'No points'}
            </p>
          )}
          {myAnswer == null && isPlayer && <p className="text-sm text-muted-foreground">You didn’t answer this one.</p>}
          <Citation question={question} />
        </div>
      )}
    </div>
  )
}

function Citation({ question }: { question: PublicQuestion }) {
  return (
    <figure className="mt-4 rounded-lg border border-border bg-card p-5" data-testid="citation">
      <figcaption className="font-code text-xs uppercase tracking-[0.2em] text-muted-foreground">
        From the article{' '}
        {question.sourceUrl ? (
          <a href={question.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline">
            {question.sourceTitle} <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        ) : question.sourceTitle}
      </figcaption>
      <blockquote className="font-display mt-3 text-lg leading-[1.7rem]">“{question.quote}”</blockquote>
      {question.explanation && <p className="mt-3 text-sm text-muted-foreground">{question.explanation}</p>}
    </figure>
  )
}

function Finished({ game, players, questions }: { game: Game; players: Rec<Player>[]; questions: Rec<PublicQuestion>[] }) {
  const podium = players.slice(0, 3)
  const ordered = [...questions].sort((a, b) => a.data.index - b.data.index)
  return (
    <div>
      <p className="font-code text-xs uppercase tracking-[0.2em] text-primary">Final scores</p>
      <ol className="mt-4 grid gap-3 sm:grid-cols-3">
        {podium.map((p, i) => (
          <li key={p.recordId} className={cn('rounded-lg border-2 bg-card p-5', i === 0 ? 'border-primary' : 'border-border')}>
            <p className="font-code text-sm text-muted-foreground">#{i + 1}</p>
            <p className="font-display mt-1 truncate text-2xl font-bold">{p.data.name}</p>
            <p className="font-code mt-2 text-lg">{p.data.score} pts</p>
            <p className="text-xs text-muted-foreground">{p.data.correctCount}/{game.questionCount} correct</p>
          </li>
        ))}
      </ol>

      <h3 className="font-display mt-10 text-xl font-bold">The receipts</h3>
      <ol className="mt-3 space-y-3">
        {ordered.map((q) => (
          <li key={q.recordId} className="rounded-lg border border-border bg-card p-4">
            <p className="font-medium">{q.data.index + 1}. {q.data.prompt}</p>
            {q.data.answerIndex != null && (
              <p className="mt-1 text-sm"><span className="text-primary">✓ {q.data.choices[q.data.answerIndex]}</span></p>
            )}
            {q.data.quote && (
              <p className="mt-2 text-sm text-muted-foreground">
                “{q.data.quote}” —{' '}
                <a href={q.data.sourceUrl} target="_blank" rel="noreferrer" className="underline">{q.data.sourceTitle}</a>
              </p>
            )}
          </li>
        ))}
      </ol>
      <Link to="/play" className="mt-8 inline-block"><Button>Play another topic</Button></Link>
    </div>
  )
}

function Scoreboard({
  players, online, meId, hostId, highlightIndex,
}: { players: Rec<Player>[]; online: Set<string>; meId: string | null; hostId: string; highlightIndex: number | null }) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <p className="border-b border-border px-4 py-2.5 font-code text-xs uppercase tracking-[0.2em] text-muted-foreground">
        Players · {players.length}
      </p>
      <ol className="divide-y divide-border" data-testid="scoreboard">
        {players.map((p, i) => {
          const answered = highlightIndex != null && p.data.lastAnswered === highlightIndex
          return (
            <li key={p.recordId} className={cn('flex items-center gap-2.5 px-4 py-2.5 text-sm', p.data.userId === meId && 'bg-muted/60')}>
              <span className="font-code w-5 text-xs text-muted-foreground">{i + 1}</span>
              <span
                className={cn('h-2 w-2 shrink-0 rounded-full', online.has(p.data.userId) ? 'bg-success' : 'bg-border')}
                title={online.has(p.data.userId) ? 'In the room' : 'Away'}
              />
              <span className="min-w-0 flex-1 truncate">
                {p.data.name}
                {p.data.userId === hostId && <span className="ml-1.5 text-xs text-muted-foreground">host</span>}
              </span>
              {answered && <Check className="h-3.5 w-3.5 text-primary" aria-label="Answered" />}
              <span className="font-code tabular-nums">{p.data.score}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">{children}</div>
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
