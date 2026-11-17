/**
 * Landing page — a STATIC, prerendered page (no providers, no WebSocket).
 * Keep it renderable without a browser: prose in HTML, CSS-only motion.
 */

import { Link } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { seo } from '../seo'

const STEPS = [
  { n: '01', title: 'Name a topic', body: 'Anything with a Wikipedia article or three: “Octopuses”, “The Apollo program”, “Jazz in the 1920s”.' },
  { n: '02', title: 'We read up', body: 'Cited pulls the articles, Claude drafts questions, and every one is checked against the text. If the quoted evidence isn’t in the article word for word, the question is thrown out.' },
  { n: '03', title: 'Play live', body: 'Friends join with a five-letter code. Answers are hidden from everyone, host included, until the reveal. Faster correct answers score more.' },
  { n: '04', title: 'Show the receipt', body: 'Each reveal shows the sentence from the article that proves the answer, with a link to read more.' },
]

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="min-h-screen bg-background text-foreground">
        <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5">
          <span className="font-display text-xl font-extrabold tracking-tight">Cited<span className="text-primary">.</span></span>
          <Link to="/play" className="text-sm font-medium underline-offset-4 hover:underline">Sign in &amp; play</Link>
        </header>

        <section className="mx-auto max-w-5xl px-5 pb-16 pt-10 md:pt-20">
          <p className="font-code text-xs uppercase tracking-[0.25em] text-primary">Live trivia · every answer sourced</p>
          <h1 className="font-display mt-4 max-w-3xl text-5xl font-extrabold leading-[1.02] tracking-tight md:text-7xl">
            Trivia night, with footnotes.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted-foreground">
            Type a topic and get a live multiplayer quiz written from real Wikipedia articles. After every question
            the room sees the exact sentence that settles it, so there’s nothing to argue about.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link to="/play" className="inline-flex h-12 items-center rounded-md bg-primary px-6 font-medium text-primary-foreground hover:opacity-90">
              Host a game
            </Link>
            <Link to="/play" className="font-code inline-flex h-12 items-center rounded-md border-2 border-foreground px-5 tracking-[0.2em]">
              JOIN · ABCDE
            </Link>
          </div>

          <figure className="mt-16 max-w-2xl rotate-[-0.6deg] rounded-lg border border-border bg-card p-6 shadow-[0_2px_0_0_rgba(28,26,23,0.08)]">
            <p className="font-code text-xs uppercase tracking-[0.2em] text-muted-foreground">Question 3 of 8 · Octopus</p>
            <p className="font-display mt-2 text-2xl font-bold">How many hearts does an octopus have?</p>
            <p className="mt-3"><span className="font-code text-primary">C</span> · Three <span className="text-primary">✓</span></p>
            <blockquote className="font-display mt-4 border-t border-border pt-4 text-lg leading-[1.7rem]">
              “Octopuses have three hearts: two pump blood through the gills, while the third circulates it through the
              rest of the body.”
            </blockquote>
            <figcaption className="mt-2 text-sm text-muted-foreground">Wikipedia, “Octopus” (illustrative)</figcaption>
          </figure>
        </section>

        <section className="border-t border-border bg-card">
          <ol className="mx-auto grid max-w-5xl gap-8 px-5 py-14 md:grid-cols-4">
            {STEPS.map((s) => (
              <li key={s.n}>
                <p className="font-code text-sm text-primary">{s.n}</p>
                <h2 className="font-display mt-1 text-xl font-bold">{s.title}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <footer className="mx-auto max-w-5xl px-5 py-8 text-xs text-muted-foreground">
          Article text from Wikipedia (CC BY-SA). Questions are machine-written and machine-checked, so read the source if
          something looks off. Built on DeepSpace.
        </footer>
      </div>
    </>
  )
}
