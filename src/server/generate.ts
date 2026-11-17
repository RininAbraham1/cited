/**
 * Question generation pipeline — runs inside the background job.
 *
 *   1. wikipedia/search-pages      topic → candidate articles
 *   2. wikipedia/get-page-content  article HTML → plain prose
 *   3. anthropic/chat-completion   prose → multiple-choice drafts with a verbatim quote
 *   4. validateDrafts              drop anything whose quote isn't in the article
 *   5. one top-up round if validation left us short
 *
 * All integration calls go through ActionTools.integration, so billing
 * follows src/integrations.ts (owner-billed) and no key lives in this app.
 */

import type { ActionTools } from 'deepspace/worker'
import {
  LIMITS,
  articleTextFromHtml,
  extractJson,
  validateDrafts,
  wikipediaUrl,
  type DraftQuestion,
} from '../lib/game-logic.js'

export const QUESTION_MODEL = 'claude-sonnet-5-5'

export interface Source {
  title: string
  url: string
  text: string
}

interface SearchHit {
  title?: string
  description?: string
}

/** Unwrap an integration result or throw a readable error. */
function unwrap<T>(r: { success: boolean; data?: unknown; error?: string }, what: string): T {
  if (!r.success) throw new Error(`${what} failed: ${r.error ?? 'unknown error'}`)
  return r.data as T
}

export async function findSources(tools: ActionTools, topic: string): Promise<Source[]> {
  const hits = unwrap<SearchHit[]>(
    await tools.integration('wikipedia/search-pages', { query: topic, limit: 8 }),
    'Wikipedia search',
  )
  const titles = (Array.isArray(hits) ? hits : [])
    .map((h) => h.title)
    .filter((t): t is string => typeof t === 'string' && t.length > 0)
    // Disambiguation and list pages make poor quiz material.
    .filter((t) => !/\(disambiguation\)$/i.test(t) && !/^List of /i.test(t))

  const sources: Source[] = []
  for (const title of titles) {
    if (sources.length >= LIMITS.articlesPerGame) break
    const page = await tools.integration('wikipedia/get-page-content', { title })
    if (!page.success) continue
    const html = (page.data as { htmlContent?: string })?.htmlContent ?? ''
    const text = articleTextFromHtml(html)
    if (text.length < 1500) continue // stubs can't support several questions
    sources.push({ title, url: wikipediaUrl(title), text })
  }
  if (sources.length === 0) {
    throw new Error(`Couldn't find Wikipedia articles with enough detail for "${topic}". Try a broader topic.`)
  }
  return sources
}

/** Pull the text out of whichever response envelope the provider returned. */
export function modelText(data: unknown): string {
  if (typeof data === 'string') return data
  const d = (data ?? {}) as Record<string, unknown>
  if (Array.isArray(d.content)) {
    return d.content
      .map((b) => (b && typeof b === 'object' && (b as { type?: string }).type === 'text' ? (b as { text: string }).text : ''))
      .join('')
  }
  if (typeof d.text === 'string') return d.text
  const choice = Array.isArray(d.choices) ? (d.choices[0] as { message?: { content?: string } }) : undefined
  if (typeof choice?.message?.content === 'string') return choice.message.content
  throw new Error('Unrecognized model response shape')
}

const SYSTEM = `You write multiple-choice trivia questions for a live party game.
Every question must be answerable from, and supported by, the SOURCE TEXT you are given — never from outside knowledge.

Rules:
- Exactly 4 choices, one correct. Wrong choices must be plausible and of the same type as the answer (all years, all people, all places...).
- "quote" must be copied character-for-character from the source text: one contiguous sentence (or clause of at least 8 words) that proves the answer. Do not paraphrase, trim words from the middle, or fix typos.
- "source" must be the exact title of the article the quote came from.
- Prefer interesting, specific facts over trivia about dates of minor events. Mix easy and hard.
- The prompt must not give away the answer. Keep prompts under 160 characters and choices under 60.
- "explanation": one short sentence of context shown after the reveal.

Respond with ONLY a JSON array, no prose:
[{"prompt": "...", "choices": ["...","...","...","..."], "answerIndex": 0, "quote": "...", "source": "...", "explanation": "..."}]`

function userMessage(topic: string, sources: Source[], count: number, avoid: string[]): string {
  const docs = sources
    .map((s) => `<article title="${s.title.replace(/"/g, "'")}">\n${s.text}\n</article>`)
    .join('\n\n')
  const avoidLine = avoid.length
    ? `\nDo NOT repeat or closely rephrase these existing questions:\n${avoid.map((p) => `- ${p}`).join('\n')}\n`
    : ''
  return `Topic: ${topic}\n\nSOURCE TEXT:\n${docs}\n${avoidLine}\nWrite ${count} questions, spread across the articles.`
}

export async function draftQuestions(
  tools: ActionTools,
  topic: string,
  sources: Source[],
  count: number,
  avoid: string[] = [],
): Promise<{ kept: DraftQuestion[]; rejected: string[] }> {
  const res = await tools.integration('anthropic/chat-completion', {
    model: QUESTION_MODEL,
    max_tokens: 4096,
    temperature: 0.7,
    system: SYSTEM,
    messages: [{ role: 'user', content: userMessage(topic, sources, count, avoid) }],
  })
  const text = modelText(unwrap<unknown>(res, 'Question generation'))
  let parsed: unknown
  try {
    parsed = extractJson(text)
  } catch {
    return { kept: [], rejected: ['unparseable model output'] }
  }
  const byTitle = Object.fromEntries(sources.map((s) => [s.title, s.text]))
  return validateDrafts(parsed, byTitle)
}
