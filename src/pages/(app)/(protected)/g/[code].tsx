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
import { Mascot, MascotSays, type Mood } from '@/components/Mascot'
import { callAction } from '@/lib/call-action'
import { LIMITS, type Answer, type Game, type Player, type PublicQuestion } from '@/lib/game-logic'

const LETTERS = ['A', 'B', 'C', 'D']

type Rec<T> = { recordId: string; data: T }

export default function GameRoomPage() {
  const { code = '' } = useParams()
  const upper = code.toUpperCase()
  const { records: games, status } = useQuery<Game>('games', { where: { code: upper }, limit: 1 })
  const game = games[0]

  if (status === 'loading') return <Centered><Mascot mood="think" size={64} label="Loading" /></Centered>
  if (!game) {
    return (
      <Centered>
        <Mascot mood="sad" size={96} />
        <p className="font-display mt-4 text-3xl font-extrabold">No game with code {upper}</p>
        <Link to="/play" className="mt-3 text-sm font-bold text-primary underline underline-offset-4">Back to Play</Link>
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
    <header className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-border pb-5">
      <div className="min-w-0">
        <p className="font-code text-xs uppercase tracking-[0.16em] text-muted-foreground">
          Hosted by {game.hostName ?? 'someone'}
          {game.status !== 'generating' && game.status !== 'lobby' && game.status !== 'failed' && (
            <> · Question {Math.min(game.currentIndex + 1, game.questionCount)} of {game.questionCount}</>
          )}
        </p>
        <h1 className="font-display mt-0.5 truncate text-3xl font-extrabold leading-tight md:text-5xl">{game.topic}</h1>
      </div>
      <div className="flex items-center gap-3">
        {isHost && <HostControls game={game} gameId={gameId} />}
        <button
          onClick={() => { void navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
          className="chunky group flex items-center gap-2 rounded-xl bg-paper px-3.5 py-1.5 text-ink"
          title="Copy invite link"
        >
          <span className="font-code text-2xl tracking-[0.22em]" data-testid="join-code-display">{game.code}</span>
          {copied ? <Check className="h-4 w-4" aria-label="Copied" /> : <Copy className="h-4 w-4 opacity-50 group-hover:opacity-100" aria-hidden />}
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
    <div className="rounded-3xl border-2 border-border bg-card p-6 shadow-[0_6px_0_0_rgba(6,12,28,0.45)] md:p-8">
      <Mascot mood="think" size={88} />
      <h2 className="font-display mt-4 text-3xl font-extrabold">Reading up on “{topic}”…</h2>
      <p className="mt-2 flex items-center gap-2 font-bold text-primary" aria-live="polite">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />{stage || 'Starting…'}
      </p>
      <p className="mt-6 text-sm text-muted-foreground">
        Claude writes the questions from the articles, then every question is checked: if its quoted evidence
        isn’t word-for-word in the article, it’s thrown out. Share the code while you wait.
      </p>
    </div>
  )
}

function Failed({ message }: { message?: string }) {
  return (
    <div className="rounded-3xl border-2 border-destructive/60 bg-card p-6 md:p-8">
      <Mascot mood="sad" size={80} />
      <h2 className="font-display mt-3 text-3xl font-extrabold">This one didn’t pan out</h2>
      <p className="mt-2 text-muted-foreground">{message || 'Question generation failed.'}</p>
      <Link to="/play" className="mt-5 inline-block"><Button>Try another topic</Button></Link>
    </div>
  )
}

function Lobby({ game, isHost, playerCount }: { game: Game; isHost: boolean; gameId: string; playerCount: number }) {
  return (
    <div className="rounded-3xl border-2 border-border bg-card p-6 shadow-[0_6px_0_0_rgba(6,12,28,0.45)] md:p-8">
      <MascotSays mood="idle" size={64}>{isHost ? 'Questions are ready. Fact-checked, too!' : 'Grab a snack, we start soon.'}</MascotSays>
      <p className="font-code mt-6 text-xs uppercase tracking-[0.16em] text-primary">Ready · {game.questionCount} questions · {game.secondsPerQuestion} sec each</p>
      <h2 className="font-display mt-1 text-3xl font-extrabold md:text-4xl">
        {isHost ? 'Start when everyone’s in.' : 'Waiting for the host to start…'}
      </h2>
      <p className="mt-3 text-muted-foreground">
        {playerCount} {playerCount === 1 ? 'player' : 'players'} in the room. Others can join at{' '}
        <span className="font-code text-primary">/g/{game.code}</span> or with the code above.
      </p>
      {game.sources && game.sources.length > 0 && (
        <div className="mt-6">
          <p className="text-sm font-extrabold">Questions are drawn from:</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {game.sources.map((s, i) => (
              <li key={s.title}>
                <a href={s.url} target="_blank" rel="noreferrer" className={`bg-hl-${i % 4} text-ink inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-bold hover:brightness-105`}>
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
  const hurry = !revealed && remainingMs < 5000

  async function answer(choice: number) {
    if (locked != null || closed || !isPlayer) return
    setPending(choice)
    const r = await callAction('submitAnswer', { gameId, index: question.index, choice })
    if (!r.success) {
      setPending(null)
      error('Answer not recorded', r.error)
    }
  }

  let mood: Mood = 'think'
  if (revealed) mood = myAnswer?.correct ? 'happy' : myAnswer ? 'sad' : 'wow'
  else if (locked != null) mood = 'idle'
  else if (closed) mood = 'wow'

  return (
    <div>
      {/* Timer */}
      <div className="flex items-center gap-3">
        <span
          className={cn(
            'font-code grid h-12 w-12 shrink-0 place-items-center rounded-full text-lg text-ink transition-colors',
            revealed ? 'bg-hl-2' : hurry ? 'bg-hl-1 wiggle' : 'bg-hl-0',
          )}
          aria-hidden
        >
          {revealed ? '✓' : Math.ceil(remainingMs / 1000)}
        </span>
        <div className="flex-1">
          <div className="h-4 overflow-hidden rounded-full bg-muted p-0.5" aria-hidden>
            <div
              className={cn('h-full rounded-full transition-[width] duration-200 ease-linear', hurry ? 'bg-hl-1' : 'bg-hl-0')}
              style={{ width: `${revealed ? 0 : (remainingMs / total) * 100}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-xs font-bold text-muted-foreground">
            <span>{revealed ? 'Answer' : `${Math.ceil(remainingMs / 1000)}s`}</span>
            <span>{answeredCount}/{playerCount} answered</span>
          </div>
        </div>
      </div>

      <div className="mt-6 flex items-start gap-3">
        <Mascot mood={mood} size={56} className="mt-1 hidden sm:block" key={mood} />
        <h2 className="font-display text-2xl font-extrabold leading-tight md:text-[2rem]" data-testid="question-prompt">
          {question.prompt}
        </h2>
      </div>

      <ol className="mt-6 grid gap-3 sm:grid-cols-2">
        {question.choices.map((choice, i) => {
          const isMine = locked === i
          const isRight = revealed && question.answerIndex === i
          const isWrongMine = revealed && isMine && !isRight
          const dimmed = (revealed && !isRight) || (!revealed && locked != null && !isMine)
          return (
            <li key={i}>
              <button
                onClick={() => answer(i)}
                disabled={locked != null || closed || !isPlayer}
                data-testid={`choice-${i}`}
                className={cn(
                  `chunky bg-hl-${i} text-ink relative flex min-h-16 w-full items-center gap-3 overflow-hidden rounded-2xl px-4 py-3.5 text-left`,
                  'disabled:cursor-default',
                  dimmed && 'opacity-40',
                  (isMine || isRight) && 'outline-4 outline-offset-3 outline-[var(--paper)]',
                  isWrongMine && 'opacity-60',
                )}
              >
                {revealed && (
                  <span
                    className="bg-ink absolute inset-y-0 left-0 opacity-15"
                    style={{ width: `${((dist[i] ?? 0) / maxVotes) * 100}%` }}
                    aria-hidden
                  />
                )}
                <span className="bg-ink font-code relative grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm text-[var(--paper)]">{LETTERS[i]}</span>
                <span className="relative flex-1 text-base font-extrabold leading-snug">{choice}</span>
                {revealed && <span className="font-code relative rounded-full bg-[var(--paper)]/70 px-2 text-xs">{dist[i] ?? 0}</span>}
                {revealed && isRight && <Check className="relative h-6 w-6" strokeWidth={3.5} aria-label="Correct answer" />}
                {isWrongMine && <X className="relative h-6 w-6" strokeWidth={3.5} aria-label="Your answer" />}
                {!revealed && isMine && <span className="font-code relative rounded-full bg-ink px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--paper)]">Locked</span>}
              </button>
            </li>
          )
        })}
      </ol>

      {!revealed && (
        <p className="mt-5 font-bold text-muted-foreground" aria-live="polite">
          {!isPlayer ? 'Joining…' : locked != null ? 'Locked in! Waiting for the reveal…' : closed ? 'Time’s up!' : 'Faster correct answers score more.'}
        </p>
      )}

      {revealed && (
        <div className="mt-7">
          <div className="flex flex-wrap items-center gap-3">
            {myAnswer?.points != null && (
              <p className={cn('stamp font-display inline-block rounded-2xl px-4 py-1.5 text-2xl font-extrabold text-ink shadow-[0_4px_0_0_rgba(6,12,28,0.5)]', myAnswer.correct ? 'bg-hl-2' : 'bg-hl-1')}>
                {myAnswer.correct ? `+${myAnswer.points}` : 'No points'}
              </p>
            )}
            {myAnswer == null && isPlayer && <p className="font-bold text-muted-foreground">You didn’t answer this one.</p>}
          </div>
          <Citation question={question} />
        </div>
      )}
    </div>
  )
}

function Citation({ question }: { question: PublicQuestion }) {
  return (
    <figure className="bg-paper text-ink relative mt-5 rounded-3xl p-5 shadow-[0_6px_0_0_rgba(6,12,28,0.5)] md:p-6" data-testid="citation">
      <span className="font-display absolute -top-4 left-5 rounded-full bg-hl-0 px-3 py-0.5 text-sm font-extrabold">✱ The receipt</span>
      <blockquote className="mt-2 text-lg font-semibold leading-relaxed md:text-xl">
        “<span className="hl-mark swipe">{question.quote}</span>”
      </blockquote>
      <figcaption className="mt-3 text-sm font-bold">
        <span className="opacity-60">From the article </span>
        {question.sourceUrl ? (
          <a href={question.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline decoration-2 underline-offset-2">
            {question.sourceTitle} <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        ) : question.sourceTitle}
      </figcaption>
      {question.explanation && <p className="mt-2 text-sm opacity-75">{question.explanation}</p>}
    </figure>
  )
}

function Finished({ game, players, questions }: { game: Game; players: Rec<Player>[]; questions: Rec<PublicQuestion>[] }) {
  const podium = players.slice(0, 3)
  const ordered = [...questions].sort((a, b) => a.data.index - b.data.index)
  const medal = ['bg-hl-0', 'bg-hl-3', 'bg-hl-1']
  return (
    <div>
      <div className="flex items-center gap-4">
        <Mascot mood="cheer" size={84} />
        <div>
          <p className="font-code text-xs uppercase tracking-[0.16em] text-primary">Game over</p>
          <h2 className="font-display text-4xl font-extrabold leading-none">Final scores</h2>
        </div>
      </div>
      <ol className="mt-6 grid gap-3 sm:grid-cols-3">
        {podium.map((p, i) => (
          <li key={p.recordId} className={cn('rounded-3xl p-5 text-ink shadow-[0_6px_0_0_rgba(6,12,28,0.5)]', medal[i], i === 0 && 'sm:-translate-y-2')}>
            <p className="font-code text-sm">#{i + 1}{i === 0 && ' 👑'}</p>
            <p className="font-display mt-1 truncate text-2xl font-extrabold">{p.data.name}</p>
            <p className="font-code mt-1 text-2xl">{p.data.score} pts</p>
            <p className="text-xs font-bold opacity-70">{p.data.correctCount}/{game.questionCount} correct</p>
          </li>
        ))}
      </ol>

      <h3 className="font-display mt-10 text-2xl font-extrabold">The receipts</h3>
      <ol className="mt-3 space-y-3">
        {ordered.map((q) => (
          <li key={q.recordId} className="rounded-2xl border-2 border-border bg-card p-4">
            <p className="font-bold">{q.data.index + 1}. {q.data.prompt}</p>
            {q.data.answerIndex != null && (
              <p className="mt-1.5 text-sm">
                <span className={`bg-hl-${q.data.answerIndex} text-ink rounded-full px-2.5 py-0.5 font-extrabold`}>✓ {q.data.choices[q.data.answerIndex]}</span>
              </p>
            )}
            {q.data.quote && (
              <p className="mt-2 text-sm text-muted-foreground">
                “{q.data.quote}” —{' '}
                <a href={q.data.sourceUrl} target="_blank" rel="noreferrer" className="font-bold text-foreground underline underline-offset-2">{q.data.sourceTitle}</a>
              </p>
            )}
          </li>
        ))}
      </ol>
      <Link to="/play" className="mt-8 inline-block"><Button size="lg">Play another topic</Button></Link>
    </div>
  )
}

function Scoreboard({
  players, online, meId, hostId, highlightIndex,
}: { players: Rec<Player>[]; online: Set<string>; meId: string | null; hostId: string; highlightIndex: number | null }) {
  return (
    <div className="overflow-hidden rounded-3xl border-2 border-border bg-card shadow-[0_6px_0_0_rgba(6,12,28,0.45)]">
      <p className="font-display border-b-2 border-border px-4 py-2.5 text-lg font-extrabold">
        Players <span className="text-muted-foreground">· {players.length}</span>
      </p>
      <ol className="space-y-1 p-2" data-testid="scoreboard">
        {players.map((p, i) => {
          const answered = highlightIndex != null && p.data.lastAnswered === highlightIndex
          const isOnline = online.has(p.data.userId)
          return (
            <li key={p.recordId} className={cn('flex items-center gap-2.5 rounded-2xl px-2.5 py-2 text-sm', p.data.userId === meId && 'bg-secondary')}>
              <span className="relative">
                <span className={`bg-hl-${i % 4} font-display grid h-8 w-8 place-items-center rounded-full text-sm font-extrabold text-ink`}>
                  {(p.data.name?.[0] ?? '?').toUpperCase()}
                </span>
                <span
                  className={cn('absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card', isOnline ? 'bg-success' : 'bg-muted-foreground')}
                  title={isOnline ? 'In the room' : 'Away'}
                />
              </span>
              <span className="min-w-0 flex-1 truncate font-bold">
                {p.data.name}
                {p.data.userId === hostId && <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[10px] font-extrabold uppercase text-muted-foreground">host</span>}
              </span>
              {answered && <Check className="h-4 w-4 text-[var(--hl-green)]" strokeWidth={3.5} aria-label="Answered" />}
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
