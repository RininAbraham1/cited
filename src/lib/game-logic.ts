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

export type GameStatus = 'generating' | 'lobby' | 'question' | 'reveal' | 'finished' | 'failed'

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
