/**
 * Pure game logic shared by the worker (actions, job) and unit tests.
 * No SDK imports here, so everything is testable with plain vitest.
 */

export const LIMITS = {
  topicMaxLength: 80,
  questionCounts: [5, 8, 10] as const,
  secondsOptions: [15, 20, 30] as const,
  /** Network slack after the deadline before an answer is refused. */
  answerGraceMs: 1500,
  /** Games one user may start per rolling hour (each one spends owner credits). */
  gamesPerHour: 5,
  maxPlayers: 50,
  articlesPerGame: 3,
  /** Characters of article text per source given to the model. */
  articleChars: 9000,
}

/** A record as subscriptions return it. */
export type Rec<T> = { recordId: string; data: T }

export type GameStatus = 'generating' | 'lobby' | 'question' | 'reveal' | 'finished' | 'failed'
export type GameMode = 'party' | 'solo'

export interface Game {
  code: string
  hostId: string
  hostName?: string
  topic: string
  status: GameStatus
  stage?: string
  error?: string
  questionCount: number
  secondsPerQuestion: number
  currentIndex: number
  endsAt?: number
  sources?: Array<{ title: string; url: string }>
  /** 'solo' runs have one player and skip the lobby. Missing = 'party'. */
  mode?: GameMode
  /** Solo only: the player's best score on this topic before this run. */
  bestBefore?: number
  /** Failed games: up to 3 Wikipedia articles to try instead ("Did you mean…?"). */
  suggestions?: string[]
  /** Failed games: the replacement game's code, so the room can follow the host. */
  nextCode?: string
}

export interface Player {
  gameId: string
  userId: string
  name?: string
  score: number
  correctCount: number
  lastAnswered: number
}

export interface PublicQuestion {
  gameId: string
  index: number
  prompt: string
  choices: string[]
  openedAt?: number
  endsAt?: number
  answerIndex?: number
  quote?: string
  explanation?: string
  sourceTitle?: string
  sourceUrl?: string
  distribution?: number[]
}

export interface BankQuestion {
  gameId: string
  index: number
  prompt: string
  choices: string[]
  answerIndex: number
  quote: string
  explanation?: string
  sourceTitle: string
  sourceUrl?: string
}

export interface Answer {
  gameId: string
  index: number
  userId: string
  choice: number
  elapsedMs: number
  correct?: boolean
  points?: number
}

// ---------------------------------------------------------------------------
// Join codes
// ---------------------------------------------------------------------------

/** No 0/O/1/I/L — codes get read aloud across a room. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function makeJoinCode(random: () => number = Math.random, length = 5): string {
  let out = ''
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)]
  return out
}

export function normalizeJoinCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const code = raw.trim().toUpperCase()
  if (code.length !== 5) return null
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return null
  return code
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * 500 for a correct answer plus up to 500 for speed, decaying linearly to 0
 * at the deadline. Wrong or late answers score 0.
 */
export function pointsFor(correct: boolean, elapsedMs: number, durationMs: number): number {
  if (!correct) return 0
  const t = Math.min(Math.max(elapsedMs / durationMs, 0), 1)
  return Math.round(500 + 500 * (1 - t))
}

/**
 * A player's totals are always RECOMPUTED from their stored answers rather
 * than incremented. Two overlapping reveal calls therefore write the same
 * numbers instead of double-counting.
 */
export function totalsFor(answers: Pick<Answer, 'points' | 'correct'>[]): {
  score: number
  correctCount: number
} {
  let score = 0
  let correctCount = 0
  for (const a of answers) {
    score += a.points ?? 0
    if (a.correct) correctCount += 1
  }
  return { score, correctCount }
}

export function distributionFor(choices: number[], optionCount: number): number[] {
  const counts = new Array<number>(optionCount).fill(0)
  for (const c of choices) if (Number.isInteger(c) && c >= 0 && c < optionCount) counts[c] += 1
  return counts
}

// ---------------------------------------------------------------------------
// Source grounding
// ---------------------------------------------------------------------------

/** Lowercase, unify quotes/dashes, collapse whitespace — for substring checks. */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/\[\d+\]/g, '') // footnote markers like [12]
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * True when the model's "verbatim" quote actually occurs in the article text.
 * This is the anti-hallucination gate: a question whose evidence cannot be
 * found in its source is thrown away, not shown.
 */
export function quoteAppearsIn(quote: string, sourceText: string, minLength = 25): boolean {
  const q = normalizeForMatch(quote).replace(/^["']|["']$/g, '').replace(/[.…]+$/, '')
  if (q.length < minLength) return false
  return normalizeForMatch(sourceText).includes(q)
}

// ---------------------------------------------------------------------------
// Wikipedia HTML → plain text
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

/**
 * Pull readable prose out of a Wikipedia article's rendered HTML: paragraph
 * text only (skips infoboxes, navboxes, tables, references, styles), with
 * footnote markers removed. Good enough for grounding; not a general parser.
 */
export function articleTextFromHtml(html: string, maxChars = LIMITS.articleChars): string {
  const cleaned = html
    .replace(/<(script|style|table|figure|sup)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
  const paragraphs: string[] = []
  let total = 0
  const re = /<p\b[^>]*>([\s\S]*?)<\/p>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(cleaned)) && total < maxChars) {
    const text = decodeEntities(m[1].replace(/<[^>]+>/g, ''))
      .replace(/\[\d+\]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (text.length < 40) continue // empty/coordinate-only paragraphs
    paragraphs.push(text)
    total += text.length
  }
  return paragraphs.join('\n\n').slice(0, maxChars)
}

// ---------------------------------------------------------------------------
// Model output validation
// ---------------------------------------------------------------------------

export interface DraftQuestion {
  prompt: string
  choices: string[]
  answerIndex: number
  quote: string
  explanation?: string
  source: string
}

/** Extract the first JSON array/object from model text (tolerates ```json fences). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : text
  const start = body.search(/[[{]/)
  if (start < 0) throw new Error('No JSON in model output')
  const open = body[start]
  const close = open === '[' ? ']' : '}'
  const end = body.lastIndexOf(close)
  if (end <= start) throw new Error('Unterminated JSON in model output')
  return JSON.parse(body.slice(start, end + 1))
}

function str(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null
}

/**
 * Keep only drafts that are well-formed AND whose quote is found in the
 * named source article. Returns kept questions plus why the rest were dropped.
 */
export function validateDrafts(
  raw: unknown,
  sources: Record<string, string>,
): { kept: DraftQuestion[]; rejected: string[] } {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { questions?: unknown }).questions)
      ? (raw as { questions: unknown[] }).questions
      : []
  const kept: DraftQuestion[] = []
  const rejected: string[] = []
  const seenPrompts = new Set<string>()

  for (const item of list) {
    const q = (item ?? {}) as Record<string, unknown>
    const prompt = str(q.prompt, 300)
    const quote = str(q.quote, 600)
    const source = str(q.source, 200)
    const choices = Array.isArray(q.choices) ? q.choices.map((c) => str(c, 120)) : []
    const answerIndex = q.answerIndex
    if (!prompt || !quote || !source) { rejected.push('missing field'); continue }
    if (choices.length !== 4 || choices.some((c) => !c)) { rejected.push('needs 4 choices'); continue }
    if (new Set(choices.map((c) => c!.toLowerCase())).size !== 4) { rejected.push('duplicate choices'); continue }
    if (typeof answerIndex !== 'number' || !Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex > 3) {
      rejected.push('bad answerIndex'); continue
    }
    const sourceText = sources[source]
    if (!sourceText) { rejected.push(`unknown source "${source}"`); continue }
    if (!quoteAppearsIn(quote, sourceText)) { rejected.push('quote not found in source'); continue }
    const key = prompt.toLowerCase()
    if (seenPrompts.has(key)) { rejected.push('duplicate prompt'); continue }
    seenPrompts.add(key)
    kept.push({
      prompt,
      choices: choices as string[],
      answerIndex,
      quote,
      explanation: str(q.explanation, 400) ?? undefined,
      source,
    })
  }
  return { kept, rejected }
}

/**
 * Shuffle choices server-side (models love putting the answer at B) and
 * return the new position of the correct answer.
 */
export function shuffleChoices(
  choices: string[],
  answerIndex: number,
  random: () => number = Math.random,
): { choices: string[]; answerIndex: number } {
  const order = choices.map((_, i) => i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return { choices: order.map((i) => choices[i]), answerIndex: order.indexOf(answerIndex) }
}

export function wikipediaUrl(title: string): string {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`
}

// ---------------------------------------------------------------------------
// Streaks
// ---------------------------------------------------------------------------

/** +10% per consecutive correct answer after the first, capped at +50%. */
export function streakMultiplier(streak: number): number {
  return 1 + Math.min(Math.max(streak - 1, 0), 5) * 0.1
}

/**
 * Length of the run of correct answers ending at `index` for one player.
 * A missed (unanswered) question breaks the streak.
 */
export function streakAt(correctByIndex: Map<number, boolean>, index: number): number {
  let n = 0
  for (let i = index; i >= 0 && correctByIndex.get(i) === true; i--) n++
  return n
}

// ---------------------------------------------------------------------------
// Footnote cards
// ---------------------------------------------------------------------------

export type CardId = 'scholar' | 'twins' | 'jester' | 'librarian' | 'oracle' | 'redacted'

export interface CardDef {
  id: CardId
  numeral: string
  name: string
  /** One line shown on the card face. */
  effect: string
  /** Needs another player (never dealt in solo). */
  social?: boolean
  /** Only useful with a next question (never dealt on the last one). */
  nextQuestion?: boolean
}

export const CARDS: Record<CardId, CardDef> = {
  scholar: { id: 'scholar', numeral: 'I', name: 'The Scholar', effect: '+200 points' },
  // On the last question there is no "next", so the Twins double the answer just given.
  twins: { id: 'twins', numeral: 'II', name: 'The Twins', effect: 'Next right answer counts double' },
  jester: { id: 'jester', numeral: 'III', name: 'The Jester', effect: 'Reversed: steal 20% from anyone', social: true },
  librarian: { id: 'librarian', numeral: 'IV', name: 'The Librarian', effect: 'Shield: blocks the next steal', social: true },
  oracle: { id: 'oracle', numeral: 'V', name: 'The Oracle', effect: 'Crosses out 2 wrong answers next question', nextQuestion: true },
  redacted: { id: 'redacted', numeral: 'VI', name: 'Redacted', effect: '−100 points. Oops.' },
}

export const CARD_WEIGHTS: Record<CardId, number> = {
  scholar: 24, twins: 18, jester: 20, librarian: 14, oracle: 14, redacted: 10,
}

export const CARD_LIMITS = {
  scholarBonus: 200,
  redactedPenalty: 100,
  stealShare: 0.2,
  handSize: 3,
}

/** Which cards can be dealt right now. */
export function cardPool(opts: { solo: boolean; lastQuestion: boolean }): CardId[] {
  return (Object.keys(CARDS) as CardId[]).filter((id) => {
    const c = CARDS[id]
    if (opts.solo && c.social) return false
    if (opts.lastQuestion && c.nextQuestion) return false
    return true
  })
}

/** Twins effect text depends on whether a next question exists. */
export function cardEffect(id: CardId, lastQuestion: boolean): string {
  return id === 'twins' && lastQuestion ? 'Last question: this answer counts double' : CARDS[id].effect
}

/**
 * Deal a face-down hand of DIFFERENT cards: weighted sampling without
 * replacement, so rarer cards stay rarer but a hand never repeats a card.
 * Every pool has at least 3 cards (solo, last question: Scholar, Twins, Redacted).
 */
export function dealHand(
  opts: { solo: boolean; lastQuestion: boolean },
  random: () => number = Math.random,
): CardId[] {
  const left = cardPool(opts)
  const hand: CardId[] = []
  while (hand.length < CARD_LIMITS.handSize && left.length > 0) {
    const total = left.reduce((s, id) => s + CARD_WEIGHTS[id], 0)
    let r = random() * total
    let at = left.length - 1
    for (let i = 0; i < left.length; i++) {
      r -= CARD_WEIGHTS[left[i]]
      if (r < 0) { at = i; break }
    }
    hand.push(left.splice(at, 1)[0])
  }
  return hand
}

/**
 * Point changes from a steal. Always conserves points: whatever the victim
 * loses, the thief gains. A shield blocks it completely.
 */
export function stealOutcome(victimScore: number, shielded: boolean): { thief: number; victim: number } {
  if (shielded) return { thief: 0, victim: 0 }
  const amount = Math.floor((Math.max(0, victimScore) * CARD_LIMITS.stealShare) / 10) * 10
  return { thief: amount, victim: -amount }
}

/** Redacted never takes a score below zero. */
export function redactedPenalty(currentScore: number): number {
  return -Math.min(CARD_LIMITS.redactedPenalty, Math.max(0, currentScore))
}

/** Two distinct wrong choices for the Oracle to cross out. */
export function oracleStrikes(answerIndex: number, choiceCount: number, random: () => number = Math.random): number[] {
  const wrong = Array.from({ length: choiceCount }, (_, i) => i).filter((i) => i !== answerIndex)
  for (let i = wrong.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[wrong[i], wrong[j]] = [wrong[j], wrong[i]]
  }
  return wrong.slice(0, 2).sort((a, b) => a - b)
}

/** One public card play: drives the feed AND the score ledger. */
export interface CardPlay {
  gameId: string
  index: number
  card: CardId
  actorId: string
  actorName?: string
  targetId?: string
  targetName?: string
  actorDelta: number
  targetDelta: number
  blocked?: boolean
}

/** A player's private draw for one question. */
export interface Draw {
  gameId: string
  index: number
  userId: string
  card: CardId
  offered: CardId[]
  slot: number
  /** done: applied · pending: Jester needs a target · active: waiting to apply · used: spent */
  status: 'done' | 'pending' | 'active' | 'used'
  /** Question index Twins/Oracle apply to. */
  appliesTo?: number
  /** Oracle: choices crossed out on `appliesTo`. */
  strike?: number[]
}

/** Score = answer points + every card delta that touches the player, never below 0. */
export function scoreWithCards(answerScore: number, plays: Pick<CardPlay, 'actorId' | 'targetId' | 'actorDelta' | 'targetDelta'>[], userId: string): number {
  let s = answerScore
  for (const p of plays) {
    if (p.actorId === userId) s += p.actorDelta ?? 0
    if (p.targetId === userId) s += p.targetDelta ?? 0
  }
  return Math.max(0, s)
}

// ---------------------------------------------------------------------------
// "Did you mean…?" after a failed topic
// ---------------------------------------------------------------------------

/**
 * Up to 3 alternative topics from the articles the search already found:
 * usable ones first (in search order), never the topic itself, never a
 * disambiguation or list page, never an article already found too thin.
 */
export function pickSuggestions(candidates: string[], topic: string, thin: string[] = []): string[] {
  const norm = (t: string) => t.trim().toLowerCase()
  const skip = new Set([norm(topic), ...thin.map(norm)])
  const out: string[] = []
  for (const t of candidates) {
    if (out.length >= 3) break
    if (!t || /\(disambiguation\)$/i.test(t) || /^List of /i.test(t) || skip.has(norm(t))) continue
    if (t.length > LIMITS.topicMaxLength) continue
    skip.add(norm(t))
    out.push(t)
  }
  return out
}
