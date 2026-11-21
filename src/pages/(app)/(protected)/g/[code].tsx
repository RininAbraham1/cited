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
 *   draws      → RBAC returns only MY cards (Oracle strikes, a waiting Jester)
 *   card_plays → public feed of card plays, also the score ledger
 *
 * This file owns the room's state and timing; each phase's UI lives in
 * src/components/room/.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth, usePresenceRoom, useQuery } from 'deepspace'
import { Button, useToast } from '@/components/ui'
import { Mascot } from '@/components/Mascot'
import { callAction } from '@/lib/call-action'
import { LIMITS, streakAt, type Answer, type CardPlay, type Draw, type Game, type Player, type PublicQuestion } from '@/lib/game-logic'
import { CardFeed, CardPicker, FeedBanner, JesterPrompt, SoloPanel } from '@/components/GameCards'
import { reactionFor, ReactionMascot } from '@/components/room/Reaction'
import { Header } from '@/components/room/RoomHeader'
import { Generating, Failed, Lobby } from '@/components/room/Phases'
import { QuestionCard } from '@/components/room/QuestionCard'
import { Finished } from '@/components/room/Finished'
import { Scoreboard } from '@/components/room/Scoreboard'

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
  const drewFor = (i: number) => myDraws.some((d) => d.data.index === i)

  // Solo: you can't move on until you've picked the card you earned.
  const mustPickCard = solo && game.status === 'reveal' && !!myAnswer?.correct && !drewFor(game.currentIndex)

  // Party: if the host moved on before I picked, my cards carry over to the top
  // of the next question (the server accepts that draw while it's open). The
  // index is latched so the flip animation isn't cut off once the draw lands.
  const prevIndex = game.currentIndex - 1
  const prevCorrect = !!myAnswers.find((a) => a.data.index === prevIndex)?.data.correct
  const [carryIndex, setCarryIndex] = useState<number | null>(null)
  useEffect(() => {
    if (solo || game.status !== 'question') { setCarryIndex(null); return }
    if (prevCorrect && !drewFor(prevIndex)) setCarryIndex(prevIndex)
    else setCarryIndex((c) => (c === prevIndex ? c : null))
  }, [solo, game.status, prevIndex, prevCorrect, myDraws])

  const { records: bests } = useQuery<{ topicKey: string; score: number }>('bests', {
    where: { topicKey: game.topic.trim().toLowerCase() }, limit: 1,
  })

  const now = useNow(game.status === 'question' ? 200 : 1000)
  const remainingMs = Math.max(0, (game.endsAt ?? 0) - now)
  const reaction = reactionFor(game, myAnswer, remainingMs, !!me, isHost)

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
    <div className="mx-auto max-w-5xl px-5 py-8 md:py-10 lg:grid lg:max-w-7xl lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-10">
      <div className="hidden lg:block">
        <div className="sticky top-8 pt-2"><ReactionMascot {...reaction} /></div>
      </div>
      <div className="min-w-0">
      <Header game={game} isHost={isHost} gameId={gameId} solo={solo} mustPickCard={mustPickCard} />

      <div className="mt-8 grid gap-8 md:grid-cols-[1fr_17rem]">
        <main className="min-w-0">
          {!solo && <FeedBanner plays={plays} meId={userId} />}
          {carryIndex != null && game.status === 'question' && (
            <div className="mb-6" data-testid="carry-over-cards">
              <p className="font-display mb-1 text-xl text-paper">Pick your card from the last question</p>
              <CardPicker
                gameId={gameId}
                index={carryIndex}
                draw={myDraws.find((d) => d.data.index === carryIndex)?.data}
                players={players}
                meId={userId}
                lastQuestion={false}
                solo={solo}
                hint="Pick one before this question closes."
              />
            </div>
          )}
          {pendingJester && !(game.status === 'reveal' && pendingJester.data.index === game.currentIndex) && game.status !== 'finished' && (
            <div className="mb-5"><JesterPrompt compact gameId={gameId} index={pendingJester.data.index} players={players} meId={userId} /></div>
          )}
          {game.status === 'generating' && <Generating stage={game.stage} topic={game.topic} />}
          {game.status === 'failed' && <Failed game={game} gameId={gameId} isHost={isHost} />}
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
              reaction={reaction}
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
    </div>
  )
}

// ---------------------------------------------------------------------------

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
