/** Non-question phases of a game: generating, failed, lobby. */
import { Link } from 'react-router-dom'
import { ExternalLink, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui'
import { Mascot, MascotSays } from '@/components/Mascot'
import { type Game } from '@/lib/game-logic'

export function Generating({ stage, topic }: { stage?: string; topic: string }) {
  return (
    <div className="sheet relative p-6 md:p-8">
      <div className="flex flex-wrap items-center gap-5">
        <Mascot mood="think" size={110} className="lg:hidden" />
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

export function Failed({ message }: { message?: string }) {
  return (
    <div className="sheet p-6 md:p-8">
      <Mascot mood="sad" size={96} className="lg:hidden" />
      <h2 className="font-display mt-3 text-4xl leading-none">This one didn’t pan out</h2>
      <p className="mt-2 font-semibold opacity-70">{message || 'Question generation failed.'}</p>
      <Link to="/play" className="mt-5 inline-block"><Button size="lg" className="font-display bg-hl-1 text-xl font-normal">Try another topic</Button></Link>
    </div>
  )
}

export function Lobby({ game, isHost, playerCount }: { game: Game; isHost: boolean; gameId: string; playerCount: number }) {
  return (
    <div className="sheet p-6 md:p-8">
      <div className="lg:hidden"><MascotSays mood="idle" size={72}>{isHost ? 'Questions ready. All fact-checked!' : 'Grab a snack, we start soon.'}</MascotSays></div>
      <h2 className="font-display mt-6 text-4xl leading-none md:text-5xl lg:mt-0">
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
