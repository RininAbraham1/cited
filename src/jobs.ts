/**
 * Background jobs — dispatched by AppJobRoom (worker.ts).
 *
 * `generate-questions` takes 20–60 s (three Wikipedia fetches plus one or two
 * model calls), longer than an HTTP action should hold a request open, so the
 * createGame action enqueues it and returns at once. Progress is written onto
 * the game record (`stage`), which every player in the room already
 * subscribes to — no extra channel needed.
 *
 * The job's own return value is deliberately just counts: job rows are
 * broadcast to job-room subscribers, so returning the questions here would
 * leak the answer key.
 */

import type { Job, JobContext } from 'deepspace/worker'
import type { Env } from '../worker'
import { createActionTools } from './server/action-routes.js'
import { draftQuestions, findSources } from './server/generate.js'
import { shuffleChoices, type Game } from './lib/game-logic.js'

export async function runJob(job: Job, ctx: JobContext, env: Env): Promise<unknown> {
  switch (job.type) {
    case 'generate-questions':
      return generateQuestions(job.payload as { gameId: string }, ctx, env)
    default:
      throw new Error(`Unknown job type: ${job.type}`)
  }
}

async function generateQuestions(
  { gameId }: { gameId: string },
  ctx: JobContext,
  env: Env,
): Promise<{ questions: number; rejected: number }> {
  const tools = createActionTools(env, env.OWNER_USER_ID, '')
  const got = await tools.get('games', gameId)
  if (!got.success) throw new Error(`Game ${gameId} not found`)
  const game = got.data.record.data as unknown as Game
  // Idempotent: a retried or duplicate job must not regenerate a live game.
  if (game.status !== 'generating') return { questions: 0, rejected: 0 }

  const stage = (text: string, progress: number) => {
    ctx.progress(progress, text)
    return tools.update('games', gameId, { stage: text })
  }

  try {
    await stage('Searching Wikipedia…', 0.1)
    const sources = await findSources(tools, game.topic)
    await stage(`Reading ${sources.map((s) => s.title).join(', ')}…`, 0.3)

    const want = game.questionCount
    // Ask for a few extra: some drafts fail the quote check.
    const first = await draftQuestions(tools, game.topic, sources, want + 3)
    let kept = first.kept
    let rejected = first.rejected.length
    if (kept.length < want) {
      await stage(`Double-checking sources (${kept.length}/${want} verified)…`, 0.7)
      const more = await draftQuestions(
        tools, game.topic, sources, want - kept.length + 2, kept.map((q) => q.prompt),
      )
      const seen = new Set(kept.map((q) => q.prompt.toLowerCase()))
      kept = kept.concat(more.kept.filter((q) => !seen.has(q.prompt.toLowerCase())))
      rejected += more.rejected.length
    }
    if (kept.length < Math.min(3, want)) {
      throw new Error("Couldn't write enough verifiable questions on that topic. Try a different one.")
    }

    const final = kept.slice(0, want)
    const urlByTitle = Object.fromEntries(sources.map((s) => [s.title, s.url]))
    for (const [index, q] of final.entries()) {
      const shuffled = shuffleChoices(q.choices, q.answerIndex)
      const r = await tools.create('question_bank', {
        gameId,
        index,
        prompt: q.prompt,
        choices: shuffled.choices,
        answerIndex: shuffled.answerIndex,
        quote: q.quote,
        explanation: q.explanation ?? '',
        sourceTitle: q.source,
        sourceUrl: urlByTitle[q.source] ?? '',
      }, `${gameId}-q${index}`)
      if (!r.success) throw new Error(`Saving question failed: ${r.error}`)
    }

    const used = new Set(final.map((q) => q.source))
    await tools.update('games', gameId, {
      status: 'lobby',
      stage: '',
      questionCount: final.length,
      sources: sources.filter((s) => used.has(s.title)).map(({ title, url }) => ({ title, url })),
    })
    ctx.progress(1, 'ready')
    console.info(`[generate] game=${gameId} kept=${final.length} rejected=${rejected}`)
    return { questions: final.length, rejected }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await tools.update('games', gameId, { status: 'failed', stage: '', error: message })
    // Swallowed on purpose: the failure is shown in the room and a retry would
    // spend credits on the same doomed topic.
    console.warn(`[generate] game=${gameId} failed: ${message}`)
    return { questions: 0, rejected: 0 }
  }
}
