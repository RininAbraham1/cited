/** One live question: timer, answers, Oracle/Twins perks, reveal, receipt and card picker. */
import { useEffect, useRef, useState } from 'react'
import { Check, ExternalLink, X } from 'lucide-react'
import { useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { Mascot, type Mood } from '@/components/Mascot'
import { callAction } from '@/lib/call-action'
import { playCorrect, playWrong, unlock } from '@/lib/sfx'
import { type Answer, type Draw, type Game, type Player, type PublicQuestion, type Rec } from '@/lib/game-logic'
import { CardPicker } from '@/components/GameCards'

const LETTERS = ['A', 'B', 'C', 'D']

export function QuestionCard({
  gameId, game, question, myAnswer, remainingMs, answeredCount, playerCount, isPlayer, solo, streak, draws, players, meId, reaction,
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
  reaction: { mood: Mood; line: string }
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
    unlock()
    setPending(choice)
    const r = await callAction('submitAnswer', { gameId, index: question.index, choice })
    if (!r.success) {
      setPending(null)
      error('Answer not recorded', r.error)
    }
  }

  // One soft sound when my result for this question comes in.
  const sounded = useRef(false)
  useEffect(() => {
    if (!revealed || sounded.current || myAnswer?.correct == null) return
    sounded.current = true
    if (myAnswer.correct) playCorrect()
    else playWrong()
  }, [revealed, myAnswer?.correct])

  // A right answer earns a card: the picker takes the question's place until you pick.
  const earnedCard = revealed && !!myAnswer?.correct && isPlayer
  const picking = earnedCard && !myDraw

  return (
    <div>
      {/* Timer (on narrow screens the reacting mascot sits here) */}
      <div className="flex items-center gap-3">
        <Mascot mood={reaction.mood} size={64} key={reaction.mood} className="-my-2 lg:hidden" label={reaction.line} />
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

      {earnedCard && (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <p className="stamp sticker font-display bg-hl-2 px-4 py-1.5 text-3xl leading-none">Correct! +{myAnswer?.points}</p>
          </div>
          <CardPicker gameId={gameId} index={question.index} draw={myDraw} players={players} meId={meId} lastQuestion={question.index + 1 >= game.questionCount} />
        </>
      )}

      {!picking && (<>
      <div className="sheet relative mt-6 p-5 pr-6 md:p-6">
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
      </>)}

      {!revealed && (
        <p className="mt-5 text-lg font-black text-muted-foreground" aria-live="polite">
          {!isPlayer ? 'Joining…' : locked != null ? 'Locked in! Waiting for the reveal…' : closed ? 'Time’s up!' : 'Faster correct answers score more.'}
        </p>
      )}

      {revealed && (
        <div className={cn('mt-8 grid items-start gap-6', !earnedCard && 'md:grid-cols-[auto_1fr]')}>
          {!earnedCard && (
            <div className="flex justify-center md:block md:pt-4">
              {myAnswer ? (myAnswer.points != null && (
                <p className="stamp sticker font-display bg-hl-1 px-5 py-2 text-center leading-none">
                  <span className="block text-4xl">Nope!</span>
                  <span className="block text-2xl">0 pts</span>
                </p>
              )) : isPlayer ? (
                <p className="stamp sticker font-display bg-paper px-5 py-2 text-3xl leading-none">Too slow!</p>
              ) : null}
            </div>
          )}
          <Citation question={question} />
        </div>
      )}
    </div>
  )
}

export function Citation({ question }: { question: PublicQuestion }) {
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
