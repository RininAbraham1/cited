// End-to-end check of Cited's server rules against a locally running worker.
import fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(new URL('../app/package.json', import.meta.url))
const { SignJWT, importPKCS8 } = require('jose')

const BASE = 'http://127.0.0.1:8787'
const key = await importPKCS8(fs.readFileSync(new URL('./priv.pem', import.meta.url), 'utf8'), 'ES256')
const token = (sub, name) => new SignJWT({ name, email: `${sub}@deepspace.test` })
  .setProtectedHeader({ alg: 'ES256' }).setSubject(sub).setIssuer('local-test').setIssuedAt().setExpirationTime('1h').sign(key)

const users = { host: `user_host_${Date.now()}`, alice: 'user_alice', bob: 'user_bob', eve: 'user_eve' }
const tok = {}
for (const [k, id] of Object.entries(users)) tok[k] = await token(id, k)

let failures = 0
const check = (label, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`); if (!cond) failures++ }
const act = async (who, name, params) => {
  const res = await fetch(`${BASE}/api/actions/${name}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(who ? { authorization: `Bearer ${tok[who]}` } : {}) },
    body: JSON.stringify(params),
  })
  const text = await res.text()
  try { return { status: res.status, ...JSON.parse(text) } } catch { return { status: res.status, raw: text } }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// --- WebSocket helper: subscribe to a collection as a user, collect what the server sends.
async function snapshot(who, collection, where) {
  const scope = fs.readFileSync(new URL('./scope.txt', import.meta.url), 'utf8').trim()
  const ws = new WebSocket(`${BASE.replace('http', 'ws')}/ws/${encodeURIComponent(scope)}?token=${tok[who]}`)
  const msgs = []
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
  ws.onmessage = (e) => msgs.push(JSON.parse(e.data))
  ws.send(JSON.stringify({ type: 'core.subscribe', payload: { subscriptionId: 's1', query: { collection, where } } }))
  await sleep(700)
  return { ws, msgs, records: msgs.filter((m) => m.type === 'core.query_result').flatMap((m) => m.payload.records ?? []) }
}

// 0. auth + input validation
check('unauthenticated action is refused', (await act(null, 'createGame', {})).status === 401)
const bad = await act('host', 'createGame', { topic: 'x', questionCount: 5, secondsPerQuestion: 15 })
check('too-short topic is refused', bad.success === false, bad.error)
const badCount = await act('host', 'createGame', { topic: 'Octopuses', questionCount: 99, secondsPerQuestion: 15 })
check('invalid question count is refused', badCount.success === false)

// 1. create
const created = await act('host', 'createGame', { topic: 'Octopuses', questionCount: 5, secondsPerQuestion: 15 })
check('host can create a game', created.success === true, JSON.stringify(created).slice(0, 200))
const { gameId, code } = created.data ?? {}

// 2. wait for the job
let game
for (let i = 0; i < 40; i++) {
  await sleep(500)
  const s = await snapshot('alice', 'games', { code })
  s.ws.close()
  game = s.records[0]?.data
  if (game && game.status !== 'generating') break
}
check('generation job moves game to lobby', game?.status === 'lobby', `status=${game?.status} error=${game?.error}`)
check('hallucinated question was dropped, 5 grounded kept', game?.questionCount === 5, `questionCount=${game?.questionCount}`)
check('sources exclude disambiguation + stub pages', JSON.stringify(game?.sources?.map((s) => s.title)) === '["Octopus","Cephalopod"]', JSON.stringify(game?.sources))

// 3. join
check('bad code is refused', (await act('alice', 'joinGame', { code: 'ZZZZZ' })).success === false)
check('alice joins with lowercase code', (await act('alice', 'joinGame', { code: code.toLowerCase() })).success === true)
check('bob joins', (await act('bob', 'joinGame', { code })).success === true)
check('double join is idempotent', (await act('bob', 'joinGame', { code })).success === true)
const ps = await snapshot('alice', 'players', { gameId }); ps.ws.close()
check('3 player rows (host, alice, bob)', ps.records.length === 3, `${ps.records.length}`)

// 4. RBAC: nobody can read the answer key, nobody can write game state directly
for (const who of ['alice', 'host']) {
  const bank = await snapshot(who, 'question_bank', { gameId }); bank.ws.close()
  check(`${who} receives 0 question_bank rows over WebSocket`, bank.records.length === 0, `${bank.records.length} rows`)
}
const qs0 = await snapshot('alice', 'questions', { gameId }); qs0.ws.close()
check('no public questions before the game starts', qs0.records.length === 0)

const w = await snapshot('alice', 'games', { code })
w.ws.send(JSON.stringify({ type: 'core.put', payload: { collection: 'players', recordId: 'forged', data: { gameId, userId: users.alice, score: 999999 }, requestId: 'r1' } }))
w.ws.send(JSON.stringify({ type: 'core.put', payload: { collection: 'games', recordId: gameId, data: { status: 'finished' }, requestId: 'r2' } }))
await sleep(700); w.ws.close()
const refusals = w.msgs.filter((m) => m.type === 'records.ack' || m.type === 'core.error')
check('client writes to players/games are refused', refusals.length >= 2 && refusals.every((m) => m.payload?.success !== true), JSON.stringify(refusals).slice(0, 300))

// 5. host-only controls
check('non-host cannot start', (await act('alice', 'advance', { gameId })).success === false)
const adv = await act('host', 'advance', { gameId })
check('host starts question 1', adv.success === true && adv.data.index === 0, JSON.stringify(adv))

const q0 = await snapshot('alice', 'questions', { gameId }); q0.ws.close()
const pub0 = q0.records[0]?.data
check('published question has prompt+choices but NO answer', pub0 && pub0.choices?.length === 4 && pub0.answerIndex == null && !pub0.quote, JSON.stringify(pub0))

// Work out the right answer server-side only via the mock's fixture text, to drive the test.
const correctText = { 'How many hearts does an octopus have?': 'Three', 'Why is octopus blood blue?': 'Copper-rich haemocyanin',
  'Roughly how many octopus species are there?': 'About 300', 'Which period saw cephalopods become dominant?': 'Ordovician',
  'What cells let octopuses change colour?': 'Chromatophores' }
const right0 = pub0.choices.indexOf(correctText[pub0.prompt])
const wrong0 = (right0 + 1) % 4

check('early reveal by non-host refused', (await act('alice', 'reveal', { gameId })).success === false)
check('alice answers correctly', (await act('alice', 'submitAnswer', { gameId, index: 0, choice: right0 })).success === true)
check('alice cannot change her answer', (await act('alice', 'submitAnswer', { gameId, index: 0, choice: wrong0 })).success === false)
check('bob answers wrong', (await act('bob', 'submitAnswer', { gameId, index: 0, choice: wrong0 })).success === true)
check('eve (not joined) cannot answer', (await act('eve', 'submitAnswer', { gameId, index: 0, choice: right0 })).success === false)
check('answer for a future question refused', (await act('bob', 'submitAnswer', { gameId, index: 1, choice: 0 })).success === false)

const bobAns = await snapshot('bob', 'answers', { gameId }); bobAns.ws.close()
check('bob sees only his own answer', bobAns.records.length === 1 && bobAns.records[0].data.userId === users.bob, `${bobAns.records.length}`)

// 6. reveal (twice, concurrently — must not double count)
const [r1, r2] = await Promise.all([act('host', 'reveal', { gameId }), act('host', 'reveal', { gameId })])
check('concurrent reveals both succeed', r1.success && r2.success)
const after = await snapshot('alice', 'players', { gameId }); after.ws.close()
const score = Object.fromEntries(after.records.map((r) => [r.data.userId, r.data]))
check('alice scored 500-1000 once', score[users.alice]?.score >= 500 && score[users.alice]?.score <= 1000 && score[users.alice]?.correctCount === 1, JSON.stringify(score[users.alice]))
check('bob scored 0', score[users.bob]?.score === 0)
const q0r = await snapshot('alice', 'questions', { gameId }); q0r.ws.close()
const rev = q0r.records[0]?.data
check('reveal publishes answer, quote, source, distribution', rev.answerIndex === right0 && rev.quote?.length > 20 && rev.sourceUrl?.startsWith('https://en.wikipedia.org/wiki/') && rev.distribution?.[right0] === 1, JSON.stringify(rev).slice(0, 300))
check('late answer after reveal refused', (await act('host', 'submitAnswer', { gameId, index: 0, choice: right0 })).success === false)

// 7. timeout path: open q2, nobody answers, a non-host may reveal only after the deadline (15s)
await act('host', 'advance', { gameId })
check('ElevenLabs read-aloud is host-only', (await act('alice', 'speakQuestion', { gameId })).success === false)
const tts = await act('host', 'speakQuestion', { gameId })
check('host gets an audio data URL', tts.success && tts.data.audioUrl.startsWith('data:audio'), JSON.stringify(tts).slice(0, 150))
console.log('… waiting out the 15s timer')
await sleep(17_000)
check('answer after deadline refused', (await act('alice', 'submitAnswer', { gameId, index: 1, choice: 0 })).success === false)
check('non-host can reveal after the deadline', (await act('bob', 'reveal', { gameId })).success === true)

// 8. play through to the end
for (let i = 2; i < 5; i++) {
  await act('host', 'advance', { gameId })
  await act('host', 'reveal', { gameId })
}
check('advance past last question finishes the game', (await act('host', 'advance', { gameId })).data?.finished === true)
const fin = await snapshot('bob', 'games', { code }); fin.ws.close()
check('game status is finished', fin.records[0]?.data.status === 'finished')
check('joining a finished game is refused', (await act('eve', 'joinGame', { code })).success === false)

// 9. integration proxy is locked
const proxy = await fetch(`${BASE}/api/integrations/anthropic/chat-completion`, {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok.eve}` }, body: '{}' })
check('browser proxy to anthropic is refused (403)', proxy.status === 403, `${proxy.status}`)

// 10. rate limit (5/hour; one already created above)
let limited = false
for (let i = 0; i < 5; i++) {
  const r = await act('host', 'createGame', { topic: `Topic ${i}`, questionCount: 5, secondsPerQuestion: 15 })
  if (!r.success && /an hour/.test(r.error)) limited = true
}
check('6th game in an hour is rate-limited', limited)

const mockLog = JSON.parse(fs.readFileSync(new URL('./mock-log.json', import.meta.url), 'utf8'))
check('integration calls were billed with the owner JWT', mockLog.filter((l) => l.url.includes('/integrations/')).every((l) => l.auth === 'Bearer owner-jwt-placeholder'))

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures ? 1 : 0)
