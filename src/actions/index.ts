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
 *   drawCard       a player who answered right picks 1 of 3 face-down cards;
 *                  the server deals and applies it (the browser never decides)
 *   playSteal      the Jester: take 20% of another player's points, unless
 *                  they hold a Librarian shield
 *
 * Scores are never incremented. Every change recomputes them from the stored
 * answers plus the card_plays ledger, so retries and races can't double count.
 *
 * Remember: `tools.*` runs with RBAC off (see src/server/action-routes.ts), so
 * every ownership check below is load-bearing.
 */

import { enqueueJob } from 'deepspace/worker'
import type { ActionHandler, ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import {
  LIMITS,
  CARD_LIMITS,
  CARDS,
  dealHand,
  oracleStrikes,
  redactedPenalty,
  scoreWithCards,
  stealOutcome,
  streakAt,
  streakMultiplier,
  distributionFor,
  makeJoinCode,
  normalizeJoinCode,
  pointsFor,
  totalsFor,
  type Answer,
  type BankQuestion,
  type CardId,
  type CardPlay,
  type Draw,
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

/** Recompute every player's score from answers + card ledger. Idempotent. */
async function recomputeScores(tools: ActionTools, gameId: string, answers?: Envelope<Answer>[]): Promise<void> {
  const all = answers ?? (await queryAll<Answer>(tools, 'answers', { gameId }, 2000))
  const plays = (await queryAll<CardPlay>(tools, 'card_plays', { gameId }, 2000)).map((p) => p.data)
  const players = await queryAll<Player>(tools, 'players', { gameId })
  for (const p of players) {
    const t = totalsFor(all.filter((a) => a.data.userId === p.data.userId).map((a) => a.data))
    const score = scoreWithCards(t.score, plays, p.data.userId)
    if (score !== p.data.score || t.correctCount !== p.data.correctCount) {
      await tools.update('players', p.recordId, { score, correctCount: t.correctCount })
    }
  }
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
  const mode = params.mode === 'solo' ? 'solo' : 'party'

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
    mode,
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
  // "Did you mean…?" retry: point the failed room at the new game so the
  // friends already in it follow the host. Only the failed game's own host can.
  const replaces = str(params.replaces)
  if (replaces) {
    const old = await getRecord<Game>(tools, 'games', replaces)
    if (old && old.data.hostId === userId && old.data.status === 'failed') {
      await tools.update('games', replaces, { nextCode: code })
    }
  }
  return { success: true, data: { gameId, code } }
}

const joinGame: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const code = normalizeJoinCode(params.code)
  if (!code) return fail('That code doesn’t look right. Codes are 5 letters or numbers.')
  const [game] = await queryAll<Game>(tools, 'games', { code }, 1)
  if (!game) return fail('No game with that code.')
  if (game.data.status === 'finished' || game.data.status === 'failed') return fail('That game has ended.')

  const players = await queryAll<Player>(tools, 'players', { gameId: game.recordId })
  if (players.some((p) => p.data.userId === userId)) {
    return { success: true, data: { gameId: game.recordId, code } }
  }
  if (game.data.mode === 'solo') return fail('That’s a solo run, so nobody else can join.')
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

  // Solo: a right answer's card must be picked before moving on (in a party
  // the pick carries over into the next question instead; see drawCard).
  if (g.mode === 'solo' && g.status === 'reveal') {
    const [mine] = await queryAll<Answer>(tools, 'answers', { gameId, index: g.currentIndex, userId }, 1)
    if (mine?.data.correct) {
      const [drawn] = await queryAll<Draw>(tools, 'draws', { gameId, index: g.currentIndex, userId }, 1)
      if (!drawn) return fail('Pick your card first!')
    }
  }

  const next = g.currentIndex + 1
  if (next >= g.questionCount) {
    let bestBefore: number | undefined
    if (g.mode === 'solo') bestBefore = await saveBest(tools, userId, gameId, g.topic)
    await tools.update('games', gameId, { status: 'finished', endsAt: 0, ...(bestBefore != null ? { bestBefore } : {}) })
    return { success: true, data: { finished: true } }
  }

  const bank = await getRecord<BankQuestion>(tools, 'question_bank', `${gameId}-q${next}`)
  if (!bank) return fail('Question missing. Try starting a new game.')

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

/** Solo: keep the player's best score per topic. Returns the previous best. */
async function saveBest(tools: ActionTools, userId: string, gameId: string, topic: string): Promise<number> {
  const [me] = await queryAll<Player>(tools, 'players', { gameId, userId }, 1)
  const score = me?.data.score ?? 0
  const topicKey = topic.trim().toLowerCase()
  const [best] = await queryAll<{ score: number }>(tools, 'bests', { userId, topicKey }, 1)
  const before = best?.data.score ?? 0
  if (!best) await tools.create('bests', { userId, topicKey, topic, score, gameId })
  else if (score > before) await tools.update('bests', best.recordId, { score, gameId, topic })
  return before
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
  const draws = await queryAll<Draw>(tools, 'draws', { gameId }, 2000)
  const twins = new Set(
    draws.filter((d) => d.data.card === 'twins' && d.data.appliesTo != null).map((d) => `${d.data.userId}:${d.data.appliesTo}`),
  )

  // Score every unscored answer up to this question — including one that
  // slipped in during a previous reveal's window. Sorted so streaks see
  // earlier answers first. Speed points × streak bonus × Twins.
  const correctBy = new Map<string, Map<number, boolean>>()
  for (const a of [...answers].sort((x, y) => x.data.index - y.data.index)) {
    let mine = correctBy.get(a.data.userId)
    if (!mine) correctBy.set(a.data.userId, (mine = new Map()))
    if (a.data.points != null) { mine.set(a.data.index, !!a.data.correct); continue }
    if (a.data.index > index) continue
    const key = keyByIndex.get(a.data.index)
    if (!key) continue
    const inTime = a.data.elapsedMs <= durationMs + LIMITS.answerGraceMs
    const correct = inTime && a.data.choice === key.answerIndex
    mine.set(a.data.index, correct)
    let points = pointsFor(correct, a.data.elapsedMs, durationMs)
    if (correct) points = Math.round(points * streakMultiplier(streakAt(mine, a.data.index)))
    if (correct && twins.has(`${a.data.userId}:${a.data.index}`)) points *= 2
    a.data.correct = correct
    a.data.points = points
    await tools.update('answers', a.recordId, { correct, points })
  }
  // Twins and Oracle cards for this question are now spent.
  for (const d of draws) {
    if (d.data.status === 'active' && d.data.appliesTo != null && d.data.appliesTo <= index) {
      await tools.update('draws', d.recordId, { status: 'used' })
    }
  }

  await recomputeScores(tools, gameId, answers)

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

const drawCard: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const gameId = str(params.gameId)
  const index = Number(params.index)
  const slot = Number(params.slot)
  if (!gameId || !Number.isInteger(index) || !Number.isInteger(slot) || slot < 0 || slot > 2) return fail('Invalid draw.')
  const game = await getRecord<Game>(tools, 'games', gameId)
  if (!game) return fail('Game not found.')
  const g = game.data
  // Draw during that question's reveal, or while the next question is open.
  const open = (g.status === 'reveal' && g.currentIndex === index) || (g.status === 'question' && g.currentIndex === index + 1)
  if (!open) return fail('Too late to draw for that question.')

  const [answer] = await queryAll<Answer>(tools, 'answers', { gameId, index, userId }, 1)
  if (!answer?.data.correct) return fail('Only right answers earn a card.')
  const players = await queryAll<Player>(tools, 'players', { gameId })
  const me = players.find((p) => p.data.userId === userId)
  if (!me) return fail('Join the game first.')

  const solo = g.mode === 'solo' || players.length < 2
  const lastQuestion = index + 1 >= g.questionCount
  const offered = testHand(env) ?? dealHand({ solo, lastQuestion })
  const card = offered[slot]

  const draw: Draw = { gameId, index, userId, card, offered, slot, status: 'done' }
  if (card === 'twins' && !lastQuestion) Object.assign(draw, { status: 'active', appliesTo: index + 1 })
  if (card === 'librarian') draw.status = 'active'
  if (card === 'jester') draw.status = 'pending'
  if (card === 'oracle') {
    const next = await getRecord<BankQuestion>(tools, 'question_bank', `${gameId}-q${index + 1}`)
    if (!next) return fail('Next question missing.')
    Object.assign(draw, { status: 'active', appliesTo: index + 1, strike: oracleStrikes(next.data.answerIndex, next.data.choices.length) })
  }

  // No explicit id: uniqueOn(gameId, index, userId) refuses a second draw.
  const created = await tools.create('draws', { ...draw })
  if (!created.success) return /duplicate/i.test(created.error) ? fail('You already drew a card for this question.') : created

  let delta = 0
  if (card !== 'jester') {
    if (card === 'scholar') delta = CARD_LIMITS.scholarBonus
    if (card === 'redacted') delta = redactedPenalty(me.data.score)
    // Last question: no "next", so the Twins double the answer just scored.
    if (card === 'twins' && lastQuestion) delta = answer.data.points ?? 0
    // Deterministic id: at most one ledger row per draw, whatever retries happen.
    await tools.create('card_plays', {
      gameId, index, card, actorId: userId, actorName: me.data.name ?? 'Player', actorDelta: delta, targetDelta: 0,
    }, `${gameId}-c${index}-${userId}`)
    if (delta !== 0) await recomputeScores(tools, gameId)
  }
  return { success: true, data: { card, offered, delta, lastQuestion, needsTarget: card === 'jester' } }
}

/** The test id can never be registered, so this seam is dead in production. */
const TEST_APP_ID = 'app_00000000000000000000000000'
function testHand(env: Env): CardId[] | null {
  if (env.DEEPSPACE_APP_ID !== TEST_APP_ID || !env.CARD_DECK_OVERRIDE) return null
  const hand = env.CARD_DECK_OVERRIDE.split(',').map((c) => c.trim()) as CardId[]
  return hand.length === 3 && hand.every((c) => c in CARDS) ? hand : null
}

const playSteal: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const gameId = str(params.gameId)
  const index = Number(params.index)
  const targetId = str(params.targetUserId)
  if (!gameId || !Number.isInteger(index) || !targetId) return fail('Invalid steal.')
  if (targetId === userId) return fail('You can’t steal from yourself.')
  const game = await getRecord<Game>(tools, 'games', gameId)
  if (!game) return fail('Game not found.')
  if (game.data.status === 'finished' || game.data.status === 'failed') return fail('The game is over.')

  const [draw] = await queryAll<Draw>(tools, 'draws', { gameId, index, userId }, 1)
  if (!draw || draw.data.card !== 'jester' || draw.data.status !== 'pending') return fail('No Jester to play.')
  const players = await queryAll<Player>(tools, 'players', { gameId })
  const me = players.find((p) => p.data.userId === userId)
  const target = players.find((p) => p.data.userId === targetId)
  if (!me || !target) return fail('Pick a player in this game.')

  const [shield] = await queryAll<Draw>(tools, 'draws', { gameId, userId: targetId, card: 'librarian', status: 'active' }, 1)
  const out = stealOutcome(target.data.score, !!shield)
  // Deterministic id: a double-tap can't steal twice.
  const r = await tools.create('card_plays', {
    gameId, index, card: 'jester',
    actorId: userId, actorName: me.data.name ?? 'Player',
    targetId, targetName: target.data.name ?? 'Player',
    actorDelta: out.thief, targetDelta: out.victim, blocked: !!shield,
  }, `${gameId}-c${index}-${userId}`)
  if (!r.success) return /duplicate/i.test(r.error) ? fail('Already played.') : r
  await tools.update('draws', draw.recordId, { status: 'used' })
  if (shield) await tools.update('draws', shield.recordId, { status: 'used' })
  await recomputeScores(tools, gameId)
  return { success: true, data: { amount: out.thief, blocked: !!shield, targetName: target.data.name ?? 'Player' } }
}

export const actions: Record<string, ActionHandler<Env>> = {
  createGame,
  joinGame,
  advance,
  submitAnswer,
  reveal,
  speakQuestion,
  drawCard,
  playSteal,
}
