/** End of game: podium (party) or score vs personal best (solo), then every receipt. */
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui'
import { cn } from '@/lib/utils'
import { Mascot } from '@/components/Mascot'
import { type Game, type Player, type PublicQuestion, type Rec } from '@/lib/game-logic'

export function Finished({ game, players, questions, solo, meId }: { game: Game; players: Rec<Player>[]; questions: Rec<PublicQuestion>[]; solo: boolean; meId: string | null }) {
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
        <Mascot mood="cheer" size={96} className="lg:hidden" />
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
