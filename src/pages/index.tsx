/**
 * Landing page — a STATIC, prerendered page (no providers, no WebSocket).
 * Keep it renderable without a browser: prose in HTML, CSS-only motion.
 */

import { Link } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { Mascot, MascotSays } from '../components/Mascot'
import { seo } from '../seo'

const STEPS = [
  { title: 'Name a topic', body: 'Anything with a Wikipedia article or three: “Octopuses”, “The Apollo program”, “Jazz in the 1920s”.' },
  { title: 'We read up', body: 'Cited pulls the articles, Claude drafts questions, and every one is checked against the text. If the quoted evidence isn’t in the article word for word, the question is thrown out.' },
  { title: 'Play live', body: 'Friends join with a five-letter code. Answers are hidden from everyone, host included, until the reveal. Faster correct answers score more.' },
  { title: 'Show the receipt', body: 'Each reveal shows the sentence from the article that proves the answer, with a link to read more.' },
]

const DEMO = ['One', 'Two', 'Three', 'Eight']

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="min-h-screen overflow-x-hidden bg-background text-foreground">
        <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
          <span className="flex items-center gap-1.5">
            <Mascot size={34} />
            <span className="font-display text-2xl font-extrabold leading-none">Cited</span>
          </span>
          <Link to="/play" className="rounded-full px-3 py-1.5 text-sm font-bold text-muted-foreground hover:text-foreground">Sign in &amp; play</Link>
        </header>

        <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-8 md:grid-cols-[1.1fr_1fr] md:pt-14">
          <div>
            <p className="font-code inline-block rounded-full bg-secondary px-3 py-1 text-xs uppercase tracking-[0.18em] text-primary">
              Live trivia · every answer sourced
            </p>
            <h1 className="font-display mt-5 text-5xl font-extrabold leading-[0.98] md:text-7xl">
              Trivia night, <span className="hl-mark swipe-ink">with footnotes.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted-foreground">
              Type a topic and get a live multiplayer quiz written from real Wikipedia articles. After every question
              the room sees the exact sentence that settles it, so there’s nothing to argue about.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link to="/play" className="chunky inline-flex h-13 items-center rounded-2xl bg-primary px-7 text-base font-extrabold text-primary-foreground">
                Host a game
              </Link>
              <Link to="/play" className="chunky font-code inline-flex h-13 items-center rounded-2xl border-2 border-input bg-card px-6 tracking-[0.25em]">
                JOIN · ABCDE
              </Link>
            </div>
          </div>

          {/* A frozen reveal, to show what a round looks like. */}
          <figure className="relative rotate-[1deg] rounded-3xl border-2 border-border bg-card p-5 shadow-[0_8px_0_0_rgba(6,12,28,0.5)] md:p-6">
            <div className="absolute -right-4 -top-10 md:-right-8">
              <Mascot mood="happy" size={92} />
            </div>
            <p className="font-code text-xs uppercase tracking-[0.18em] text-muted-foreground">Question 3 of 8 · Octopus</p>
            <p className="font-display mt-1 pr-14 text-2xl font-bold leading-tight">How many hearts does an octopus have?</p>
            <ol className="mt-4 grid grid-cols-2 gap-2.5">
              {DEMO.map((c, i) => (
                <li
                  key={c}
                  className={`bg-hl-${i} text-ink flex items-center gap-2 rounded-xl px-3 py-2.5 font-extrabold ${i === 2 ? 'ring-4 ring-foreground' : 'opacity-35'}`}
                >
                  <span className="bg-ink grid h-6 w-6 place-items-center rounded-full text-xs text-[var(--paper)]">{'ABCD'[i]}</span>
                  {c}
                  {i === 2 && <span className="ml-auto">✓</span>}
                </li>
              ))}
            </ol>
            <blockquote className="bg-paper text-ink mt-4 rounded-2xl p-4 text-[1.05rem] font-semibold leading-relaxed">
              “<span className="hl-mark swipe">Octopuses have three hearts</span>: two pump blood through the gills, while the
              third circulates it through the rest of the body.”
              <figcaption className="mt-2 text-xs font-bold opacity-60">Wikipedia, “Octopus” (illustrative)</figcaption>
            </blockquote>
          </figure>
        </section>

        <section className="bg-shell border-t-2 border-border">
          <ol className="mx-auto grid max-w-6xl gap-5 px-5 py-14 sm:grid-cols-2 md:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="rounded-3xl border-2 border-border bg-card p-5 shadow-[0_5px_0_0_rgba(6,12,28,0.45)]">
                <span className={`bg-hl-${i} text-ink font-display grid h-10 w-10 place-items-center rounded-full text-xl font-extrabold`}>{i + 1}</span>
                <h2 className="font-display mt-3 text-xl font-bold">{s.title}</h2>
                <p className="mt-1.5 text-sm text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8">
          <p className="max-w-xl text-xs text-muted-foreground">
            Article text from Wikipedia (CC BY-SA). Questions are machine-written and machine-checked, so read the source if
            something looks off. Built on DeepSpace.
          </p>
          <MascotSays mood="idle" size={44}>Source? I’ve got it.</MascotSays>
        </footer>
      </div>
    </>
  )
}
