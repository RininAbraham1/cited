/**
 * Landing page — a STATIC, prerendered page (no providers, no WebSocket).
 * Keep it renderable without a browser: prose in HTML, CSS-only motion.
 */

import { Link } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { Mascot } from '../components/Mascot'
import { seo } from '../seo'

const TICKER = ['Every answer sourced', 'Live with friends', 'No made-up facts', 'Any topic', 'Receipts included', 'Zero arguments']

/** How a round works, itemised like a till receipt. */
const RECEIPT: [string, string][] = [
  ['1x topic', '“Octopuses”'],
  ['3x Wikipedia articles', 'read'],
  ['12x questions', 'drafted'],
  ['4x questions', 'THROWN OUT'],
  ['   (quote not in article)', ''],
  ['8x questions', 'fact-checked'],
  ['1x five-letter code', 'K7QPX'],
  ['∞ friends', 'welcome'],
]

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="stage min-h-screen overflow-x-hidden text-foreground">
        <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <span className="flex items-center gap-1.5">
            <Mascot size={38} />
            <span className="title-pop text-3xl leading-none">Cited</span>
          </span>
          <Link to="/play" className="pop rounded-xl bg-paper px-4 py-1.5 text-sm font-black text-ink">Sign in</Link>
        </header>

        <Ticker />

        <section className="relative mx-auto grid max-w-6xl items-center gap-10 px-5 pb-16 pt-10 md:grid-cols-[1.15fr_1fr] md:pt-16">
          <div className="relative z-10">
            <h1 className="title-pop text-[3.4rem] leading-[0.95] sm:text-7xl md:text-[5.6rem]">
              Trivia night
            </h1>
            <p className="sticker font-display mt-3 rotate-[-3deg] bg-hl-0 px-4 py-1 text-[2.1rem] leading-tight sm:text-5xl">
              with footnotes<span className="text-hl-1 [-webkit-text-stroke:2px_var(--ink)] [paint-order:stroke_fill]">*</span>
            </p>
            <p className="mt-7 max-w-lg text-lg font-semibold text-muted-foreground">
              Type any topic. Get a live quiz written from real Wikipedia articles. After every question the whole room
              sees the exact sentence that settles it.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link to="/play" className="pop font-display inline-flex h-14 items-center rounded-2xl bg-hl-1 px-8 text-2xl text-ink">
                Host a game
              </Link>
              <Link to="/play" className="pop font-code inline-flex h-14 items-center rounded-2xl bg-paper px-6 text-lg tracking-[0.2em] text-ink">
                JOIN&nbsp;·&nbsp;K7QPX
              </Link>
            </div>
          </div>

          {/* The mascot surrounded by answer stickers. */}
          <div className="relative mx-auto h-[340px] w-full max-w-[420px] sm:h-[400px]">
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <Mascot mood="happy" size={210} />
            </div>
            <AnswerSticker i={0} text="Two" className="left-0 top-4" r={-8} />
            <AnswerSticker i={1} text="Eight" className="right-0 top-0" r={7} />
            <AnswerSticker i={2} text="Three ✓" className="bottom-10 left-2" r={5} correct />
            <AnswerSticker i={3} text="One" className="bottom-2 right-4" r={-6} />
            <div className="sticker font-display absolute left-1/2 top-[-6px] -translate-x-1/2 rotate-2 bg-paper px-3 py-1 text-lg">
              How many hearts?
            </div>
          </div>
        </section>

        {/* How it works — as a receipt, not a numbered list. */}
        <section className="relative mx-auto max-w-6xl px-5 pb-20">
          <div className="grid items-center gap-12 md:grid-cols-[1fr_1fr]">
            <div className="order-2 md:order-1">
              <h2 className="title-pop text-5xl leading-none md:text-6xl">What you get</h2>
              <p className="mt-4 max-w-md text-lg font-semibold text-muted-foreground">
                Claude writes the questions, but it has to show its work. Each one must quote a sentence that appears word for
                word in the article. No quote, no question.
              </p>
              <div className="mt-6 flex items-center gap-3">
                <span className="sticker rotate-[-4deg] bg-hl-2 px-3 py-1 font-black">Answers hidden from everyone</span>
                <span className="sticker rotate-[3deg] bg-hl-3 px-3 py-1 font-black">Faster = more points</span>
              </div>
            </div>

            <div className="receipt-shadow order-1 mx-auto w-full max-w-sm rotate-[2deg] md:order-2">
              <div className="receipt font-receipt px-6 text-sm">
                <div className="flex flex-col items-center text-center">
                  <Mascot size={44} mood="idle" />
                  <p className="mt-1 text-lg font-bold tracking-[0.3em]">CITED</p>
                  <p className="text-xs opacity-60">GAME NIGHT · TABLE 1</p>
                </div>
                <p className="my-3 text-center opacity-40">- - - - - - - - - - - - - - -</p>
                <ul className="space-y-1">
                  {RECEIPT.map(([item, value]) => (
                    <li key={item} className="flex items-end">
                      <span className="whitespace-pre">{item}</span>
                      {value && <span className="dotted-leader" />}
                      <span className={value === 'THROWN OUT' ? 'font-bold text-[#d21f5a]' : 'font-bold'}>{value}</span>
                    </li>
                  ))}
                </ul>
                <p className="my-3 text-center opacity-40">- - - - - - - - - - - - - - -</p>
                <div className="flex items-end text-base font-bold">
                  <span>TOTAL ARGUMENTS</span><span className="dotted-leader" /><span>0</span>
                </div>
                <p className="mt-4 text-center text-xs opacity-60">* every answer comes with its source</p>
              </div>
            </div>
          </div>
        </section>

        <footer className="border-t-[3px] border-[var(--ink)] bg-[var(--stage-deep)]">
          <p className="mx-auto max-w-6xl px-5 py-6 text-xs font-semibold text-muted-foreground">
            Article text from Wikipedia (CC BY-SA). Questions are machine-written and machine-checked, so read the source if
            something looks off. Built on DeepSpace.
          </p>
        </footer>
      </div>
    </>
  )
}

function Ticker() {
  const items = [...TICKER, ...TICKER]
  return (
    <div className="marquee relative z-20 -mx-2 rotate-[-1.2deg] border-y-[3px] border-[var(--ink)] bg-hl-0 py-2 text-ink" aria-hidden>
      <div>
        {[0, 1].map((k) => (
          <span key={k} className="flex">
            {items.map((t, i) => (
              <span key={`${k}-${i}`} className="font-display flex items-center px-5 text-xl uppercase">
                {t}<span className="ml-10 text-hl-1 [-webkit-text-stroke:1.5px_var(--ink)] [paint-order:stroke_fill]">✱</span>
              </span>
            ))}
          </span>
        ))}
      </div>
    </div>
  )
}

function AnswerSticker({ i, text, className, r, correct }: { i: number; text: string; className: string; r: number; correct?: boolean }) {
  return (
    <div
      className={`sticker floaty absolute bg-hl-${i} flex items-center gap-2 px-3 py-2 text-lg font-black ${correct ? 'outline-4 outline-offset-2 outline-[var(--paper)]' : ''} ${className}`}
      style={{ '--r': `${r}deg`, animationDelay: `${i * -0.8}s` } as React.CSSProperties}
    >
      <span className="bg-ink grid h-7 w-7 place-items-center rounded-full text-sm text-paper">{'ABCD'[i]}</span>
      {text}
    </div>
  )
}
