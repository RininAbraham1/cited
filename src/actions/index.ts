/**
 * Server actions — the ONLY way game state changes.
 *
 * Every collection in src/schemas/game-schemas.ts denies client writes, so
 * each rule of the game is enforced here, against the verified caller:
 *
 *   createGame     any signed-in user (rate-limited; it spends owner credits)
 *   joinGame       anyone with the code, until the game ends
 *   advance        host only: open the next question, or finish the game
 *   submitAnswer   players in the game, once per question, before the deadline
 *   reveal         host any time; anyone once the deadline has passed, so a
 *                  host who closes their laptop can't freeze the room
 *   speakQuestion  host only: ElevenLabs reads the open question aloud
 *
 * Remember: `tools.*` runs with RBAC off (see src/server/action-routes.ts), so
 * every ownership check below is load-bearing.
 */

import { enqueueJob } from 'deepspace/worker'
import type { ActionHandler, ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import {
  LIMITS,
  distributionFor,
  makeJoinCode,
  normalizeJoinCode,
  pointsFor,
  totalsFor,
  type Answer,
  type BankQuestion,
  type Game,
  type Player,
} from '../lib/game-logic'

interface Envelope<T> {
  recordId: string
  data: T
  createdBy: string
  createdAt: string
}

const fail = (error: string): ActionResult<never> => ({ success: false, error })

async function getRecord<T>(tools: ActionTools, collection: string, id: string): Promise<Envelope<T> | null> {
  const r = await tools.get(collection, id)
  if (!r.success) return null
  return ((r.data as { record?: Envelope<T> }).record ?? null)
}

async function queryAll<T>(
  tools: ActionTools,
  collection: string,
  where: Record<string, string | number>,
  limit = 500,
): Promise<Envelope<T>[]> {
  const r = await tools.query(collection, { where, limit })
  if (!r.success) throw new Error(`Query ${collection} failed: ${r.error}`)
  return (r.data as { records: Envelope<T>[] }).records
}

async function displayName(tools: ActionTools, userId: string): Promise<string> {
  const user = await getRecord<{ name?: string }>(tools, 'users', userId)
  return user?.data.name?.trim() || 'Player'
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

// ---------------------------------------------------------------------------

const createGame: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const topic = typeof params.topic === 'string' ? params.topic.trim().replace(/\s+/g, ' ') : ''
  if (topic.length < 2 || topic.length > LIMITS.topicMaxLength) {
    return fail(`Topic must be 2–${LIMITS.topicMaxLength} characters.`)
  }
  const questionCount = Number(params.questionCount)
  const secondsPerQuestion = Number(params.secondsPerQuestion)
  if (!(LIMITS.questionCounts as readonly number[]).includes(questionCount)) return fail('Invalid question count.')
  if (!(LIMITS.secondsOptions as readonly number[]).includes(secondsPerQuestion)) return fail('Invalid timer.')

  // Spend control: each game costs several Wikipedia calls and a model call.
  const mine = await queryAll<Game>(tools, 'games', { hostId: userId }, 200)
  const hourAgo = Date.now() - 60 * 60 * 1000
  if (mine.filter((g) => Date.parse(g.createdAt) > hourAgo).length >= LIMITS.gamesPerHour) {
    return fail(`You can start ${LIMITS.gamesPerHour} games an hour. Try again a little later.`)
  }

  let code = ''
  for (let i = 0; i < 6 && !code; i++) {
    const candidate = makeJoinCode()
    const clash = await queryAll<Game>(tools, 'games', { code: candidate }, 1)
    if (clash.length === 0) code = candidate
  }
  if (!code) return fail('Could not allocate a join code. Please retry.')

  const hostName = await displayName(tools, userId)
  const created = await tools.create('games', {
    code,
    hostId: userId,
    hostName,
    topic,
    status: 'generating',
    stage: 'Queued…',
    error: '',
    questionCount,
    secondsPerQuestion,
    currentIndex: -1,
    endsAt: 0,
    sources: [],
  })
  if (!created.success) return created
  const gameId = created.data.recordId

  // The host plays too.
  await tools.create('players', { gameId, userId, name: hostName, score: 0, correctCount: 0, lastAnswered: -1 })

  try {
    await enqueueJob(env.JOB_ROOMS, `app:${env.DEEPSPACE_APP_ID}`, 'generate-questions', { gameId }, {
      enqueuedBy: userId,
    })
  } catch (err) {
    await tools.update('games', gameId, { status: 'failed', error: 'Could not start question generation.' })
    console.error(`[createGame] enqueue failed: ${err instanceof Error ? err.message : String(err)}`)
    return fail('Could not start question generation.')
  }
  return { success: true, data: { gameId, code } }
}

const joinGame: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const code = normalizeJoinCode(params.code)
  if (!code) return fail('That code doesn’t look right — codes are 5 letters/numbers.')
  const [game] = await queryAll<Game>(tools, 'games', { code }, 1)
  if (!game) return fail('No game with that code.')
  if (game.data.status === 'finished' || game.data.status === 'failed') return fail('That game has ended.')

  const players = await queryAll<Player>(tools, 'players', { gameId: game.recordId })
  if (players.some((p) => p.data.userId === userId)) {
    return { success: true, data: { gameId: game.recordId, code } }
  }
  if (players.length >= LIMITS.maxPlayers) return fail('That game is full.')

  const r = await tools.create('players', {
    gameId: game.recordId,
    userId,
    name: await displayName(tools, userId),
    score: 0,
    correctCount: 0,
    lastAnswered: -1,
  })
  // uniqueOn(gameId, userId) refuses a concurrent double-join; that's still "joined".
  if (!r.success && !/duplicate/i.test(r.error)) return r
  return { success: true, data: { gameId: game.recordId, code } }
}

const advance: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const gameId = str(params.gameId)
  if (!gameId) return fail('Missing game.')
  const game = await getRecord<Game>(tools, 'games', gameId)
  if (!game) return fail('Game not found.')
  const g = game.data
  if (g.hostId !== userId) return fail('Only the host can do that.')
  if (g.status !== 'lobby' && g.status !== 'reveal') return fail('Not ready to advance.')

  const next = g.currentIndex + 1
  if (next >= g.questionCount) {
    await tools.update('games', gameId, { status: 'finished', endsAt: 0 })
    return { success: true, data: { finished: true } }
  }

  const bank = await getRecord<BankQuestion>(tools, 'question_bank', `${gameId}-q${next}`)
  if (!bank) return fail('Question missing — try regenerating the game.')

  const openedAt = Date.now()
  const endsAt = openedAt + g.secondsPerQuestion * 1000
  // Deterministic id: a double-click re-opens the same question instead of skipping one.
  const pub = await tools.create('questions', {
    gameId,
    index: next,
    prompt: bank.data.prompt,
    choices: bank.data.choices,
    openedAt,
    endsAt,
  }, `${gameId}-q${next}`)
  if (!pub.success) return pub
  await tools.update('games', gameId, { status: 'question', currentIndex: next, endsAt })
  return { success: true, data: { index: next, endsAt } }
}

const submitAnswer: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const gameId = str(params.gameId)
  const index = Number(params.index)
  const choice = Number(params.choice)
  if (!gameId || !Number.isInteger(index) || !Number.isInteger(choice) || choice < 0 || choice > 3) {
    return fail('Invalid answer.')
  }
  const now = Date.now()
  const game = await getRecord<Game>(tools, 'games', gameId)
  if (!game) return fail('Game not found.')
  const g = game.data
  if (g.status !== 'question' || g.currentIndex !== index) return fail('That question is closed.')
  if (now > (g.endsAt ?? 0) + LIMITS.answerGraceMs) return fail('Time’s up!')

  const [player] = await queryAll<Player>(tools, 'players', { gameId, userId }, 1)
  if (!player) return fail('Join the game first.')

  const q = await getRecord<{ openedAt: number }>(tools, 'questions', `${gameId}-q${index}`)
  const elapsedMs = Math.max(0, now - (q?.data.openedAt ?? now))

  // No explicit id: uniqueOn(gameId, index, userId) makes the SECOND create
  // fail, so an answer can't be changed after it's locked in.
  const r = await tools.create('answers', { gameId, index, userId, choice, elapsedMs })
  if (!r.success) return /duplicate/i.test(r.error) ? fail('You already answered.') : r
  await tools.update('players', player.recordId, { lastAnswered: index })
  return { success: true, data: { locked: true } }
}

const reveal: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const gameId = str(params.gameId)
  if (!gameId) return fail('Missing game.')
  const game = await getRecord<Game>(tools, 'games', gameId)
  if (!game) return fail('Game not found.')
  const g = game.data
  if (g.status !== 'question') return { success: true, data: { alreadyRevealed: true } }
  const isHost = g.hostId === userId
  if (!isHost) {
    const players = await queryAll<Player>(tools, 'players', { gameId, userId }, 1)
    if (players.length === 0) return fail('Not in this game.')
    if (Date.now() < (g.endsAt ?? 0) + LIMITS.answerGraceMs) return fail('Only the host can reveal early.')
  }

  // Flip first: submitAnswer re-reads status, so new answers stop here.
  await tools.update('games', gameId, { status: 'reveal' })

  const index = g.currentIndex
  const durationMs = g.secondsPerQuestion * 1000
  const bankRows = await queryAll<BankQuestion>(tools, 'question_bank', { gameId })
  const keyByIndex = new Map(bankRows.map((b) => [b.data.index, b.data]))
  const answers = await queryAll<Answer>(tools, 'answers', { gameId }, 2000)

  // Score every unscored answer up to this question — including one that
  // slipped in during a previous reveal's window — then recompute totals.
  for (const a of answers) {
    if (a.data.points != null || a.data.index > index) continue
    const key = keyByIndex.get(a.data.index)
    if (!key) continue
    const inTime = a.data.elapsedMs <= durationMs + LIMITS.answerGraceMs
    const correct = inTime && a.data.choice === key.answerIndex
    const points = pointsFor(correct, a.data.elapsedMs, durationMs)
    a.data.correct = correct
    a.data.points = points
    await tools.update('answers', a.recordId, { correct, points })
  }

  const players = await queryAll<Player>(tools, 'players', { gameId })
  for (const p of players) {
    const totals = totalsFor(answers.filter((a) => a.data.userId === p.data.userId).map((a) => a.data))
    if (totals.score !== p.data.score || totals.correctCount !== p.data.correctCount) {
      await tools.update('players', p.recordId, totals)
    }
  }

  const key = keyByIndex.get(index)
  if (key) {
    const forThis = answers.filter((a) => a.data.index === index).map((a) => a.data.choice)
    await tools.update('questions', `${gameId}-q${index}`, {
      answerIndex: key.answerIndex,
      quote: key.quote,
      explanation: key.explanation ?? '',
      sourceTitle: key.sourceTitle,
      sourceUrl: key.sourceUrl ?? '',
      distribution: distributionFor(forThis, key.choices.length),
    })
  }
  return { success: true, data: { index } }
}

const speakQuestion: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const gameId = str(params.gameId)
  if (!gameId) return fail('Missing game.')
  const game = await getRecord<Game>(tools, 'games', gameId)
  if (!game) return fail('Game not found.')
  if (game.data.hostId !== userId) return fail('Only the host can play audio.')
  if (game.data.status !== 'question') return fail('No open question.')
  const q = await getRecord<{ prompt: string; choices: string[] }>(
    tools, 'questions', `${gameId}-q${game.data.currentIndex}`,
  )
  if (!q) return fail('Question not found.')
  const letters = ['A', 'B', 'C', 'D']
  const text = `${q.data.prompt} ${q.data.choices.map((c, i) => `${letters[i]}: ${c}.`).join(' ')}`.slice(0, 700)
  const r = await tools.integration<{ audioUrl: string }>('elevenlabs/generate-speech', {
    text,
    model_id: 'eleven_flash_v2_5',
    output_format: 'mp3_22050_32',
  })
  if (!r.success) return r
  return { success: true, data: { audioUrl: r.data.audioUrl } }
}

export const actions: Record<string, ActionHandler<Env>> = {
  createGame,
  joinGame,
  advance,
  submitAnswer,
  reveal,
  speakQuestion,
}
