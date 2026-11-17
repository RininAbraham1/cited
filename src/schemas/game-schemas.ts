/**
 * Cited — game collections.
 *
 * The security model in one paragraph: clients never write game state.
 * Every create/update below is `false` for every role, so the only way to
 * change a game is a server action (src/actions/index.ts), which checks who
 * is calling and whether the move is legal. Reads are split so the answer
 * key never reaches a browser before the reveal:
 *
 *   question_bank  — generated questions WITH answers + source quotes.
 *                    No role can read it, admins included. Only server code
 *                    (actions and the generation job) touches it.
 *   questions      — the public copy. A row appears only when the host opens
 *                    that question, and gets `answerIndex`/`quote` filled in
 *                    only at reveal.
 *   answers        — each player sees only their own (`read: 'own'`), so nobody can copy a friend mid-question.
 */

import type { CollectionSchema } from 'deepspace/schema'

const SERVER_ONLY_WRITES = { create: false, update: false, delete: false } as const

const NONE = { read: false, ...SERVER_ONLY_WRITES } as const

export const gamesSchema: CollectionSchema = {
  name: 'games',
  columns: [
    { name: 'code', storage: 'text', interpretation: 'plain', required: true },
    { name: 'hostId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'hostName', storage: 'text', interpretation: 'plain' },
    { name: 'topic', storage: 'text', interpretation: 'plain', required: true },
    {
      name: 'status',
      storage: 'text',
      interpretation: {
        kind: 'select',
        options: ['generating', 'lobby', 'question', 'reveal', 'finished', 'failed'],
      },
      required: true,
    },
    /** Human-readable generation progress shown to everyone in the room. */
    { name: 'stage', storage: 'text', interpretation: 'plain' },
    { name: 'error', storage: 'text', interpretation: 'plain' },
    { name: 'questionCount', storage: 'number', interpretation: 'plain' },
    { name: 'secondsPerQuestion', storage: 'number', interpretation: 'plain' },
    /** -1 in the lobby, then the 0-based index of the open/revealed question. */
    { name: 'currentIndex', storage: 'number', interpretation: 'plain' },
    /** Epoch ms deadline for the open question (server clock). */
    { name: 'endsAt', storage: 'number', interpretation: 'plain' },
    /** [{ title, url }] — the Wikipedia articles questions were drawn from. */
    { name: 'sources', storage: 'text', interpretation: { kind: 'json' } },
  ],
  permissions: {
    viewer: { read: true, ...SERVER_ONLY_WRITES },
    member: { read: true, ...SERVER_ONLY_WRITES },
    admin: { read: true, ...SERVER_ONLY_WRITES },
  },
}

export const playersSchema: CollectionSchema = {
  name: 'players',
  columns: [
    { name: 'gameId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'name', storage: 'text', interpretation: 'plain' },
    { name: 'score', storage: 'number', interpretation: 'plain', default: 0 },
    { name: 'correctCount', storage: 'number', interpretation: 'plain', default: 0 },
    /** Index of the last question this player answered — powers "7/9 answered"
     *  without exposing anyone's choice. */
    { name: 'lastAnswered', storage: 'number', interpretation: 'plain', default: -1 },
  ],
  uniqueOn: ['gameId', 'userId'],
  permissions: {
    viewer: { read: true, ...SERVER_ONLY_WRITES },
    member: { read: true, ...SERVER_ONLY_WRITES },
    admin: { read: true, ...SERVER_ONLY_WRITES },
  },
}

export const questionBankSchema: CollectionSchema = {
  name: 'question_bank',
  columns: [
    { name: 'gameId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'index', storage: 'number', interpretation: 'plain', required: true },
    { name: 'prompt', storage: 'text', interpretation: 'plain', required: true },
    { name: 'choices', storage: 'text', interpretation: { kind: 'json' }, required: true },
    { name: 'answerIndex', storage: 'number', interpretation: 'plain', required: true },
    { name: 'quote', storage: 'text', interpretation: 'plain', required: true },
    { name: 'explanation', storage: 'text', interpretation: 'plain' },
    { name: 'sourceTitle', storage: 'text', interpretation: 'plain', required: true },
    { name: 'sourceUrl', storage: 'text', interpretation: { kind: 'url' } },
  ],
  uniqueOn: ['gameId', 'index'],
  // Deliberately unreadable by every role. The app owner is pinned to admin,
  // so even `admin: { read: true }` would ship the key to a host who owns the app.
  permissions: { '*': NONE, viewer: NONE, member: NONE, admin: NONE },
}

export const questionsSchema: CollectionSchema = {
  name: 'questions',
  columns: [
    { name: 'gameId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'index', storage: 'number', interpretation: 'plain', required: true },
    { name: 'prompt', storage: 'text', interpretation: 'plain', required: true },
    { name: 'choices', storage: 'text', interpretation: { kind: 'json' }, required: true },
    { name: 'openedAt', storage: 'number', interpretation: 'plain' },
    { name: 'endsAt', storage: 'number', interpretation: 'plain' },
    // Filled at reveal only:
    { name: 'answerIndex', storage: 'number', interpretation: 'plain' },
    { name: 'quote', storage: 'text', interpretation: 'plain' },
    { name: 'explanation', storage: 'text', interpretation: 'plain' },
    { name: 'sourceTitle', storage: 'text', interpretation: 'plain' },
    { name: 'sourceUrl', storage: 'text', interpretation: { kind: 'url' } },
    /** Answer counts per choice, e.g. [3, 0, 5, 1] — published at reveal. */
    { name: 'distribution', storage: 'text', interpretation: { kind: 'json' } },
  ],
  uniqueOn: ['gameId', 'index'],
  permissions: {
    viewer: { read: true, ...SERVER_ONLY_WRITES },
    member: { read: true, ...SERVER_ONLY_WRITES },
    admin: { read: true, ...SERVER_ONLY_WRITES },
  },
}

export const answersSchema: CollectionSchema = {
  name: 'answers',
  columns: [
    { name: 'gameId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'index', storage: 'number', interpretation: 'plain', required: true },
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'choice', storage: 'number', interpretation: 'plain', required: true },
    /** ms between the question opening and the server receiving the answer. */
    { name: 'elapsedMs', storage: 'number', interpretation: 'plain' },
    { name: 'correct', storage: 'number', interpretation: { kind: 'boolean' } },
    { name: 'points', storage: 'number', interpretation: 'plain' },
  ],
  uniqueOn: ['gameId', 'index', 'userId'],
  // 'own' resolves against createdBy. submitAnswer creates the row as the
  // verified caller, so createdBy is always the answering player.
  permissions: {
    viewer: { read: false, ...SERVER_ONLY_WRITES },
    member: { read: 'own', ...SERVER_ONLY_WRITES },
    admin: { read: 'own', ...SERVER_ONLY_WRITES },
  },
}

export const gameSchemas: CollectionSchema[] = [
  gamesSchema,
  playersSchema,
  questionBankSchema,
  questionsSchema,
  answersSchema,
]
