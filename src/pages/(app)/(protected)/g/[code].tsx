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
import { LIMITS, streakAt, type Answer, type CardPlay, type Draw, type Game, type Player, type PublicQuestion } from '@/lib/game-logic'
import { CardFeed, CardPicker, FeedBanner, JesterPrompt, SoloPanel } from '@/components/GameCards'

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
        <p className="title-pop mt-4 text-4xl">No game with code {upper}</p>
        <Link to="/play" className="mt-4"><Button size="lg">Back to Play</Button></Link>
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
  const { records: myDraws } = useQuery<Draw>('draws', { where: { gameId } })
  const { records: plays } = useQuery<CardPlay>('card_plays', { where: { gameId }, orderBy: 'createdAt', orderDir: 'asc' })
  const { peers } = usePresenceRoom(`game:${gameId}`)
  const solo = game.mode === 'solo'

  const me = players.find((p) => p.data.userId === userId)
  const current = questions.find((q) => q.data.index === game.currentIndex)?.data
  const myAnswer = myAnswers.find((a) => a.data.index === game.currentIndex)?.data
  const online = useMemo(() => new Set([...(userId ? [userId] : []), ...peers.map((p) => p.userId)]), [peers, userId])

  // Joining is idempotent server-side; do it once when landing via a shared link.
  const joinTried = useRef(false)
  useEffect(() => {
    if (!userId || me || joinTried.current || players.length === 0) return
    if (game.status === 'finished' || game.status === 'failed' || solo) return
    joinTried.current = true
    void callAction('joinGame', { code: game.code }).then((r) => {
      if (!r.success) toastError('Couldn’t join', r.error)
    })
  }, [userId, me, players.length, game.status, game.code, toastError, solo])

  // Solo runs skip the lobby: start as soon as the questions are ready.
  const autoStarted = useRef(false)
  useEffect(() => {
    if (!solo || !isHost || game.status !== 'lobby' || autoStarted.current) return
    autoStarted.current = true
    void callAction('advance', { gameId }).then((r) => {
      if (!r.success) { autoStarted.current = false; toastError('Couldn’t start', r.error) }
    })
  }, [solo, isHost, game.status, gameId, toastError])

  // My current streak, from my own (RBAC-filtered) answers.
  const streak = useMemo(() => {
    const m = new Map<number, boolean>()
    let last = -1
    for (const a of myAnswers) {
      if (a.data.correct == null) continue
      m.set(a.data.index, !!a.data.correct)
      last = Math.max(last, a.data.index)
    }
    return last < 0 ? 0 : streakAt(m, last)
  }, [myAnswers])
  const pendingJester = myDraws.find((d) => d.data.card === 'jester' && d.data.status === 'pending')
  const { records: bests } = useQuery<{ topicKey: string; score: number }>('bests', {
    where: { topicKey: game.topic.trim().toLowerCase() }, limit: 1,
  })

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
      <Header game={game} isHost={isHost} gameId={gameId} solo={solo} />

      <div className="mt-8 grid gap-8 md:grid-cols-[1fr_17rem]">
        <main className="min-w-0">
          {!solo && <FeedBanner plays={plays} meId={userId} />}
          {pendingJester && !(game.status === 'reveal' && pendingJester.data.index === game.currentIndex) && game.status !== 'finished' && (
            <div className="mb-5"><JesterPrompt compact gameId={gameId} index={pendingJester.data.index} players={players} meId={userId} /></div>
          )}
          {game.status === 'generating' && <Generating stage={game.stage} topic={game.topic} />}
          {game.status === 'failed' && <Failed message={game.error} />}
          {game.status === 'lobby' && (solo ? <Generating stage="Questions ready. Here we go!" topic={game.topic} /> : <Lobby game={game} isHost={isHost} gameId={gameId} playerCount={players.length} />)}
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
              solo={solo}
              streak={streak}
              draws={myDraws.map((d) => d.data)}
              players={players}
              meId={userId}
            />
          )}
          {game.status === 'finished' && <Finished game={game} players={players} questions={questions} solo={solo} meId={userId} />}
        </main>

        <aside>
          {solo
            ? <SoloPanel score={me?.data.score ?? 0} streak={streak} best={bests[0]?.data.score} />
            : <Scoreboard players={players} online={online} meId={userId} hostId={game.hostId} highlightIndex={game.status === 'question' ? game.currentIndex : null} />}
          {!solo && <CardFeed plays={plays} />}
        </aside>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function Header({ game, isHost, gameId, solo }: { game: Game; isHost: boolean; gameId: string; solo: boolean }) {
  const [copied, setCopied] = useState(false)
  const link = typeof window !== 'undefined' ? `${window.location.origin}/g/${game.code}` : ''
  const live = game.status !== 'generating' && game.status !== 'lobby' && game.status !== 'failed'
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-black">
          <span className="sticker rotate-[-2deg] bg-paper px-2 py-0.5 text-xs">{solo ? 'Solo run' : `Hosted by ${game.hostName ?? 'someone'}`}</span>
          {live && (
            <span className="sticker rotate-[2deg] bg-hl-2 px-2 py-0.5 text-xs">
              Question {Math.min(game.currentIndex + 1, game.questionCount)} of {game.questionCount}
            </span>
          )}
        </p>
        <h1 className="title-pop mt-3 truncate pb-1 text-5xl leading-none md:text-6xl">{game.topic}</h1>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {isHost && <HostControls game={game} gameId={gameId} solo={solo} />}
        {!solo && <button
          onClick={() => { void navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
          className="pop group flex rotate-[2deg] items-center gap-2 rounded-2xl bg-hl-0 px-4 py-1.5 text-ink"
          title="Copy invite link"
        >
          <span className="text-left">
            <span className="block text-[10px] font-black uppercase leading-none tracking-[0.2em] opacity-60">Code</span>
            <span className="font-display block text-3xl leading-none tracking-[0.12em]" data-testid="join-code-display">{game.code}</span>
          </span>
          {copied ? <Check className="h-5 w-5" strokeWidth={3} aria-label="Copied" /> : <Copy className="h-5 w-5 opacity-50 group-hover:opacity-100" aria-hidden />}
        </button>}
      </div>
    </header>
  )
}

function HostControls({ game, gameId, solo }: { game: Game; gameId: string; solo?: boolean }) {
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
      <button
        onClick={() => { setReadAloud((v) => !v); spokenRef.current = readAloud ? spokenRef.current : -1 }}
        aria-pressed={readAloud}
        title={readAloud ? 'Stop reading questions aloud' : 'Read questions aloud (ElevenLabs)'}
        className={cn('pop grid h-12 w-12 place-items-center rounded-2xl text-ink', readAloud ? 'bg-hl-2' : 'bg-paper')}
      >
        {readAloud ? <Volume2 className="h-5 w-5" strokeWidth={2.6} /> : <VolumeX className="h-5 w-5" strokeWidth={2.6} />}
      </button>
      {game.status === 'lobby' && <Button size="lg" className="font-display h-12 bg-hl-1 text-xl font-normal" onClick={() => run('advance')} disabled={busy} data-testid="start-game">Start game</Button>}
      {game.status === 'question' && !solo && <Button size="lg" variant="outline" className="font-display h-12 text-xl font-normal" onClick={() => run('reveal')} disabled={busy}>Reveal now</Button>}
      {game.status === 'reveal' && (
        <Button size="lg" className="font-display h-12 bg-hl-1 text-xl font-normal" onClick={() => run('advance')} disabled={busy} data-testid="next-question">
          {last ? 'Final scores' : 'Next question'}
        </Button>
      )}
    </div>
  )
}

function Generating({ stage, topic }: { stage?: string; topic: string }) {
  return (
    <div className="sheet relative p-6 md:p-8">
      <div className="flex flex-wrap items-center gap-5">
        <Mascot mood="think" size={110} />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-4xl leading-none">Reading up on “{topic}”</h2>
          <p className="sticker mt-3 flex w-fit items-center gap-2 bg-hl-0 px-3 py-1 font-black" aria-live="polite">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={3} aria-hidden />{stage || 'Starting…'}
          </p>
        </div>
      </div>
      <p className="mt-6 font-semibold opacity-70">
        We write the questions from the articles, then every question is checked: if its quoted evidence isn’t
        word-for-word in the article, it’s thrown out. Share the code while you wait.
      </p>
    </div>
  )
}

function Failed({ message }: { message?: string }) {
  return (
    <div className="sheet p-6 md:p-8">
      <Mascot mood="sad" size={96} />
      <h2 className="font-display mt-3 text-4xl leading-none">This one didn’t pan out</h2>
      <p className="mt-2 font-semibold opacity-70">{message || 'Question generation failed.'}</p>
      <Link to="/play" className="mt-5 inline-block"><Button size="lg" className="font-display bg-hl-1 text-xl font-normal">Try another topic</Button></Link>
    </div>
  )
}

function Lobby({ game, isHost, playerCount }: { game: Game; isHost: boolean; gameId: string; playerCount: number }) {
  return (
    <div className="sheet p-6 md:p-8">
      <MascotSays mood="idle" size={72}>{isHost ? 'Questions ready. All fact-checked!' : 'Grab a snack, we start soon.'}</MascotSays>
      <h2 className="font-display mt-6 text-4xl leading-none md:text-5xl">
        {isHost ? 'Start when everyone’s in.' : 'Waiting for the host to start…'}
      </h2>
      <div className="mt-4 flex flex-wrap gap-2 text-sm font-black">
        <span className="sticker bg-hl-0 px-2.5 py-0.5">{game.questionCount} questions</span>
        <span className="sticker bg-hl-3 px-2.5 py-0.5">{game.secondsPerQuestion} sec each</span>
        <span className="sticker bg-hl-2 px-2.5 py-0.5">{playerCount} {playerCount === 1 ? 'player' : 'players'} in</span>
      </div>
      <p className="mt-4 font-semibold opacity-70">
        Friends join at <span className="font-code text-ink opacity-100">/g/{game.code}</span> or with the code above.
      </p>
      {game.sources && game.sources.length > 0 && (
        <div className="mt-6">
          <p className="font-display text-xl">Questions come from</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {game.sources.map((s, i) => (
              <li key={s.title}>
                <a href={s.url} target="_blank" rel="noreferrer" className={`pop bg-hl-${i % 4} inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-black text-ink`}>
                  {s.title} <ExternalLink className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
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
  gameId, game, question, myAnswer, remainingMs, answeredCount, playerCount, isPlayer, solo, streak, draws, players, meId,
}: {
  gameId: string
  game: Game
  question: PublicQuestion
  myAnswer?: Answer
  remainingMs: number
  answeredCount: number
  playerCount: number
  isPlayer: boolean
  solo: boolean
  streak: number
  draws: Draw[]
  players: Rec<Player>[]
  meId: string | null
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
  // My cards that act on THIS question (draws are RBAC-filtered to mine).
  const struck = new Set(draws.find((d) => d.card === 'oracle' && d.appliesTo === question.index)?.strike ?? [])
  const doubled = draws.some((d) => d.card === 'twins' && d.appliesTo === question.index)
  const myDraw = draws.find((d) => d.index === question.index)

  async function answer(choice: number) {
    if (locked != null || closed || !isPlayer || struck.has(choice)) return
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
            'sticker font-display grid h-16 w-16 shrink-0 place-items-center rounded-full text-3xl',
            revealed ? 'bg-hl-2' : hurry ? 'bg-hl-1 wiggle' : 'bg-hl-0',
          )}
          aria-hidden
        >
          {revealed ? '✓' : Math.ceil(remainingMs / 1000)}
        </span>
        <div className="flex-1">
          <div className="h-5 overflow-hidden rounded-full border-[3px] border-[var(--ink)] bg-[var(--stage-deep)]" aria-hidden>
            <div
              className={cn('h-full border-r-[3px] border-[var(--ink)] transition-[width] duration-200 ease-linear', hurry ? 'bg-hl-1' : 'bg-hl-0')}
              style={{ width: `${revealed ? 0 : (remainingMs / total) * 100}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-xs font-black text-muted-foreground">
            <span>{revealed ? 'Answer' : `${Math.ceil(remainingMs / 1000)}s`}</span>
            <span>{solo ? `Question ${question.index + 1} of ${game.questionCount}` : `${answeredCount}/${playerCount} answered`}</span>
          </div>
        </div>
      </div>

      {(streak >= 2 || doubled || struck.size > 0) && !revealed && (
        <div className="mt-4 flex flex-wrap gap-2 text-sm font-black" data-testid="perks">
          {streak >= 2 && <span className="sticker bg-hl-1 px-2.5 py-0.5">🔥 {streak} in a row</span>}
          {doubled && <span className="sticker bg-hl-1 px-2.5 py-0.5">The Twins: ×2 this question</span>}
          {struck.size > 0 && <span className="sticker bg-[#c4b5ff] px-2.5 py-0.5">The Oracle crossed out 2 wrong answers</span>}
        </div>
      )}

      <div className={cn('sheet relative mt-6 p-5 pr-6 md:mt-10 md:p-6', !revealed && 'md:pl-24')}>
        {!revealed && <Mascot mood={mood} size={84} key={mood} className="absolute -left-5 -top-7 hidden md:block" />}
        <h2 className="font-display text-[1.75rem] leading-tight md:text-4xl" data-testid="question-prompt">
          {question.prompt}
        </h2>
      </div>

      <ol className="mt-6 grid gap-4 sm:grid-cols-2">
        {question.choices.map((choice, i) => {
          const isMine = locked === i
          const isRight = revealed && question.answerIndex === i
          const isWrongMine = revealed && isMine && !isRight
          const isStruck = !revealed && struck.has(i)
          const dimmed = (revealed && !isRight) || (!revealed && locked != null && !isMine) || isStruck
          return (
            <li key={i}>
              <button
                onClick={() => answer(i)}
                disabled={locked != null || closed || !isPlayer || isStruck}
                data-testid={`choice-${i}`}
                className={cn(
                  `pop bg-hl-${i} relative flex min-h-[4.75rem] w-full items-center gap-3 overflow-hidden rounded-2xl px-4 py-3 text-left text-ink`,
                  'disabled:cursor-default',
                  dimmed && 'opacity-40',
                  isMine && !revealed && 'rotate-[-1.5deg]',
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
                <span className="bg-ink font-display relative grid h-10 w-10 shrink-0 place-items-center rounded-xl text-xl text-paper">{LETTERS[i]}</span>
                <span className={cn('relative flex-1 text-lg font-black leading-snug', isStruck && 'line-through decoration-4')}>{choice}</span>
                {isStruck && <X className="relative h-7 w-7" strokeWidth={4} aria-label="Crossed out by The Oracle" />}
                {revealed && <span className="font-code relative rounded-full border-2 border-[var(--ink)] bg-paper px-2 text-xs">{dist[i] ?? 0}</span>}
                {revealed && isRight && <Check className="relative h-7 w-7" strokeWidth={4} aria-label="Correct answer" />}
                {isWrongMine && <X className="relative h-7 w-7" strokeWidth={4} aria-label="Your answer" />}
                {!revealed && isMine && <span className="font-code relative rounded-full bg-ink px-2 py-0.5 text-[10px] uppercase tracking-wider text-paper">Locked</span>}
              </button>
            </li>
          )
        })}
      </ol>

      {!revealed && (
        <p className="mt-5 text-lg font-black text-muted-foreground" aria-live="polite">
          {!isPlayer ? 'Joining…' : locked != null ? 'Locked in! Waiting for the reveal…' : closed ? 'Time’s up!' : 'Faster correct answers score more.'}
        </p>
      )}

      {revealed && (
        <div className="mt-8 grid items-start gap-6 md:grid-cols-[auto_1fr]">
          <div className="flex justify-center md:block md:pt-4">
            {myAnswer?.points != null ? (
              <div className="flex flex-col items-center md:items-start">
                <Mascot mood={myAnswer.correct ? 'happy' : 'sad'} size={104} className="-mb-2" label={myAnswer.correct ? 'Mascot bouncing for joy' : 'Sad mascot'} />
                <p className={cn('stamp sticker font-display px-5 py-2 text-center leading-none', myAnswer.correct ? 'bg-hl-2' : 'bg-hl-1')}>
                  <span className="block text-4xl">{myAnswer.correct ? 'Correct!' : 'Nope!'}</span>
                  <span className="block text-2xl">{myAnswer.correct ? `+${myAnswer.points}` : '0 pts'}</span>
                </p>
                {myAnswer.correct && isPlayer && !myDraw && (
                  <a href="#card-picker" className="font-display mt-4 block text-lg text-paper underline decoration-2 underline-offset-4">
                    ✱ You earned a card ↓
                  </a>
                )}
              </div>
            ) : isPlayer ? (
              <div className="flex flex-col items-center md:items-start">
                <Mascot mood="wow" size={104} className="-mb-2" />
                <p className="stamp sticker font-display bg-paper px-5 py-2 text-3xl leading-none">Too slow!</p>
              </div>
            ) : null}
          </div>
          <Citation question={question} />
        </div>
      )}

      {revealed && myAnswer?.correct && isPlayer && (
        <CardPicker gameId={gameId} index={question.index} draw={myDraw} players={players} meId={meId} />
      )}
    </div>
  )
}

function Citation({ question }: { question: PublicQuestion }) {
  return (
    <figure className="receipt-shadow rotate-[0.6deg]" data-testid="citation">
      <div className="receipt px-5 md:px-7">
        <figcaption className="font-receipt flex items-center justify-between text-xs font-bold uppercase tracking-[0.2em]">
          <span>✱ Source receipt</span><span className="opacity-50">Q{question.index + 1}</span>
        </figcaption>
        <blockquote className="mt-3 text-lg font-bold leading-relaxed md:text-xl">
          “<span className="hl-mark swipe">{question.quote}</span>”
        </blockquote>
        <div className="font-receipt mt-4 space-y-1 border-t-2 border-dashed border-[var(--ink)]/30 pt-3 text-sm">
          <p className="flex items-end">
            <span>ARTICLE</span><span className="dotted-leader" />
            {question.sourceUrl ? (
              <a href={question.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-bold underline decoration-2 underline-offset-2">
                {question.sourceTitle} <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            ) : <span className="font-bold">{question.sourceTitle}</span>}
          </p>
          <p className="flex items-end"><span>MATCH</span><span className="dotted-leader" /><span className="font-bold">WORD FOR WORD ✓</span></p>
        </div>
        {question.explanation && <p className="mt-3 text-sm font-semibold opacity-70">{question.explanation}</p>}
      </div>
    </figure>
  )
}

function Finished({ game, players, questions, solo, meId }: { game: Game; players: Rec<Player>[]; questions: Rec<PublicQuestion>[]; solo: boolean; meId: string | null }) {
  const mine = players.find((p) => p.data.userId === meId)?.data
  const best = game.bestBefore ?? 0
  const newBest = solo && mine != null && mine.score > best
  const ordered = [...questions].sort((a, b) => a.data.index - b.data.index)
  // Podium order on screen: 2nd, 1st, 3rd.
  const podium = [1, 0, 2].map((rank) => ({ rank, p: players[rank] })).filter((x) => x.p)
  const height = ['h-44', 'h-32', 'h-24']
  const color = ['bg-hl-0', 'bg-hl-3', 'bg-hl-1']
  return (
    <div>
      <div className="flex items-center gap-3">
        <Mascot mood="cheer" size={96} />
        <h2 className="title-pop text-5xl leading-none md:text-6xl">Final scores</h2>
      </div>

      {solo && mine && (
        <div className="sheet mt-8 flex flex-wrap items-center justify-between gap-4 p-6" data-testid="solo-result">
          <div>
            <p className="text-xs font-black uppercase opacity-60">Your score</p>
            <p className="font-display text-6xl leading-none">{mine.score}</p>
            <p className="mt-1 font-bold opacity-70">{mine.correctCount}/{game.questionCount} correct</p>
          </div>
          {newBest ? (
            <p className="stamp sticker font-display bg-hl-2 px-5 py-2 text-3xl leading-none">New best!{best > 0 && <span className="block text-lg">old: {best}</span>}</p>
          ) : (
            <p className="sticker font-display bg-paper px-4 py-2 text-xl leading-none">Best on this topic: {best}</p>
          )}
        </div>
      )}

      {!solo && <ol className="mt-8 flex items-end justify-center gap-3 sm:gap-4">
        {podium.map(({ rank, p }) => (
          <li key={p.recordId} className="flex w-1/3 max-w-[11rem] flex-col items-center">
            <span className="sticker max-w-full truncate bg-paper px-2.5 py-0.5 text-center font-black">{p.data.name}</span>
            <span className="font-code mt-1.5 text-lg text-paper">{p.data.score} pts</span>
            <span className="text-xs font-bold text-muted-foreground">{p.data.correctCount}/{game.questionCount} correct</span>
            <div className={cn('pop font-display mt-2 grid w-full place-items-start justify-center rounded-t-2xl rounded-b-none pt-2 text-5xl text-ink', height[rank], color[rank])}>
              {rank === 0 ? '1' : rank + 1}
            </div>
          </li>
        ))}
      </ol>}

      <div className="receipt-shadow mt-12">
        <div className="receipt px-5 md:px-7">
          <h3 className="font-receipt text-center text-sm font-bold uppercase tracking-[0.3em]">✱ The receipts ✱</h3>
          <ol className="mt-4 divide-y-2 divide-dashed divide-[var(--ink)]/20">
            {ordered.map((q) => (
              <li key={q.recordId} className="py-3">
                <p className="font-black">{q.data.index + 1}. {q.data.prompt}</p>
                {q.data.answerIndex != null && (
                  <p className="mt-1.5 text-sm">
                    <span className={`bg-hl-${q.data.answerIndex} rounded-full border-2 border-[var(--ink)] px-2.5 py-0.5 font-black`}>✓ {q.data.choices[q.data.answerIndex]}</span>
                  </p>
                )}
                {q.data.quote && (
                  <p className="mt-2 text-sm font-semibold opacity-75">
                    “{q.data.quote}”{' '}<span className="opacity-60">from</span>{' '}
                    <a href={q.data.sourceUrl} target="_blank" rel="noreferrer" className="font-black underline underline-offset-2">{q.data.sourceTitle}</a>
                  </p>
                )}
              </li>
            ))}
          </ol>
        </div>
      </div>
      <Link to="/play" className="mt-10 inline-block"><Button size="lg" className="font-display h-14 bg-hl-1 px-8 text-2xl font-normal">Play another topic</Button></Link>
    </div>
  )
}

function Scoreboard({
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
