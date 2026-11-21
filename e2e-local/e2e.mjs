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

// 6b. footnote cards
check('wrong answer earns no card', (await act('bob', 'drawCard', { gameId, index: 0, slot: 1 })).success === false)
check('bad slot refused', (await act('alice', 'drawCard', { gameId, index: 0, slot: 7 })).success === false)
// The local deck is fixed to [jester, librarian, scholar] (test seam, see worker.ts).
const drew = await act('alice', 'drawCard', { gameId, index: 0, slot: 0 })
check('right answer draws a card (server deals 3)', drew.success === true && drew.data.offered?.length === 3 && drew.data.offered[0] === drew.data.card, JSON.stringify(drew).slice(0, 200))
check('second draw for the same question refused', (await act('alice', 'drawCard', { gameId, index: 0, slot: 0 })).success === false)
const aliceDraws = await snapshot('alice', 'draws', { gameId }); aliceDraws.ws.close()
const bobDraws = await snapshot('bob', 'draws', { gameId }); bobDraws.ws.close()
check('alice sees her own draw', aliceDraws.records.length === 1, `${aliceDraws.records.length}`)
check('bob cannot see alice’s draw (Oracle/shield stay secret)', bobDraws.records.length === 0, `${bobDraws.records.length}`)
check('playSteal without a Jester refused', (await act('bob', 'playSteal', { gameId, index: 0, targetUserId: users.alice })).success === false)
check('alice drew The Jester (fixed local deck)', drew.data?.card === 'jester' && drew.data.needsTarget === true)
check('cannot steal from yourself', (await act('alice', 'playSteal', { gameId, index: 0, targetUserId: users.alice })).success === false)
check('cannot steal from someone outside the game', (await act('alice', 'playSteal', { gameId, index: 0, targetUserId: users.eve })).success === false)
const playsSnap = await snapshot('bob', 'card_plays', { gameId }); playsSnap.ws.close()
check('an unplayed Jester is not announced yet', playsSnap.records.length === 0, `${playsSnap.records.length}`)
const afterCard = await snapshot('alice', 'players', { gameId }); afterCard.ws.close()
const aliceNow = afterCard.records.find((r) => r.data.userId === users.alice)?.data.score
const cardDelta = playsSnap.records.filter((r) => r.data.actorId === users.alice).reduce((s, r) => s + (r.data.actorDelta ?? 0), 0)
check('card delta is reflected in alice’s score', aliceNow === score[users.alice].score + cardDelta, `card=${drew.data?.card} before=${score[users.alice].score} delta=${cardDelta} now=${aliceNow}`)

// 7. timeout path: open q2, nobody answers, a non-host may reveal only after the deadline (15s)
await act('host', 'advance', { gameId })
check('ElevenLabs read-aloud is host-only', (await act('alice', 'speakQuestion', { gameId })).success === false)
const tts = await act('host', 'speakQuestion', { gameId })
check('host gets an audio data URL', tts.success && tts.data.audioUrl.startsWith('data:audio'), JSON.stringify(tts).slice(0, 150))
console.log('… waiting out the 15s timer')
await sleep(17_000)
check('answer after deadline refused', (await act('alice', 'submitAnswer', { gameId, index: 1, choice: 0 })).success === false)
check('non-host can reveal after the deadline', (await act('bob', 'reveal', { gameId })).success === true)

// 8. play through to the end, with a shield, a blocked steal and a real steal
const answerRight = async (who, i) => {
  const qs = await snapshot(who, 'questions', { gameId }); qs.ws.close()
  const q = qs.records.find((r) => r.data.index === i)?.data
  return act(who, 'submitAnswer', { gameId, index: i, choice: q.choices.indexOf(correctText[q.prompt]) })
}
const scores = async () => {
  const p = await snapshot('bob', 'players', { gameId }); p.ws.close()
  return Object.fromEntries(p.records.map((r) => [r.data.userId, r.data.score]))
}
// q3: bob answers right and takes The Librarian (shield)
await act('host', 'advance', { gameId }); await answerRight('bob', 2); await act('host', 'reveal', { gameId })
check('bob draws The Librarian', (await act('bob', 'drawCard', { gameId, index: 2, slot: 1 })).data?.card === 'librarian')
const beforeBlock = await scores()
const blocked = await act('alice', 'playSteal', { gameId, index: 0, targetUserId: users.bob })
check('alice’s Jester is blocked by bob’s shield', blocked.success && blocked.data.blocked === true && blocked.data.amount === 0, JSON.stringify(blocked))
const afterBlock = await scores()
check('a blocked steal moves no points', afterBlock[users.bob] === beforeBlock[users.bob] && afterBlock[users.alice] === beforeBlock[users.alice])
check('a played Jester cannot be replayed', (await act('alice', 'playSteal', { gameId, index: 0, targetUserId: users.host })).success === false)
// q4: bob answers right again (his shield is now spent)
await act('host', 'advance', { gameId }); await answerRight('bob', 3); await act('host', 'reveal', { gameId })
// q5 opens before bob picked his q4 card: in a party the pick carries over while q5 is open
await act('host', 'advance', { gameId })
check('party: an unpicked card can still be drawn while the next question is open', (await act('bob', 'drawCard', { gameId, index: 3, slot: 2 })).data?.card === 'scholar')
// q5: alice answers right, draws another Jester and robs bob for real
await answerRight('alice', 4); await act('host', 'reveal', { gameId })
check('alice draws a second Jester', (await act('alice', 'drawCard', { gameId, index: 4, slot: 0 })).data?.card === 'jester')
const beforeSteal = await scores()
// Double-tap: two concurrent plays of the same Jester.
const [stole, stole2] = await Promise.all([
  act('alice', 'playSteal', { gameId, index: 4, targetUserId: users.bob }),
  act('alice', 'playSteal', { gameId, index: 4, targetUserId: users.bob }),
])
const afterSteal = await scores()
const feed = await snapshot('bob', 'card_plays', { gameId }); feed.ws.close()
check('card plays are public (bob sees the feed)', feed.records.filter((r) => r.data.card === 'jester').length === 2, `${feed.records.length}`)
check('every steal in the ledger conserves points', feed.records.filter((r) => r.data.card === 'jester').every((r) => r.data.actorDelta + r.data.targetDelta === 0))
const expected = Math.floor(beforeSteal[users.bob] * 0.2 / 10) * 10
const took = [stole, stole2].find((r) => r.success)?.data
check('steal takes 20% of bob’s points (rounded to 10)', took?.amount === expected && expected > 0, `bob=${beforeSteal[users.bob]} took=${took?.amount}`)
check('double-tapped steal applied once', [stole, stole2].filter((r) => r.success).length >= 1 && afterSteal[users.alice] - beforeSteal[users.alice] === expected)
check('steal conserves points exactly', afterSteal[users.alice] - beforeSteal[users.alice] === expected && beforeSteal[users.bob] - afterSteal[users.bob] === expected,
  JSON.stringify({ beforeSteal, afterSteal }))
check('advance past last question finishes the game', (await act('host', 'advance', { gameId })).data?.finished === true)
const fin = await snapshot('bob', 'games', { code }); fin.ws.close()
check('game status is finished', fin.records[0]?.data.status === 'finished')
check('joining a finished game is refused', (await act('eve', 'joinGame', { code })).success === false)

// 8b. solo runs
const soloNew = await act('eve', 'createGame', { topic: 'Octopuses', questionCount: 5, secondsPerQuestion: 15, mode: 'solo' })
check('solo run created', soloNew.success === true)
const solo = soloNew.data ?? {}
for (let i = 0; i < 40; i++) {
  await sleep(500)
  const s = await snapshot('eve', 'games', { code: solo.code }); s.ws.close()
  if (s.records[0]?.data.status === 'lobby') break
}
check('nobody can join a solo run', (await act('bob', 'joinGame', { code: solo.code })).success === false)
for (let i = 0; i < 5; i++) {
  await act('eve', 'advance', { gameId: solo.gameId })
  const qs = await snapshot('eve', 'questions', { gameId: solo.gameId }); qs.ws.close()
  const q = qs.records.find((r) => r.data.index === i)?.data
  await act('eve', 'submitAnswer', { gameId: solo.gameId, index: i, choice: q.choices.indexOf(correctText[q.prompt]) })
  await act('eve', 'reveal', { gameId: solo.gameId })
  if (i === 0) check('solo: cannot skip past an earned card', (await act('eve', 'advance', { gameId: solo.gameId })).success === false)
  await act('eve', 'drawCard', { gameId: solo.gameId, index: i, slot: 2 }) // scholar on the fixed local deck
}
const soloPlayers = await snapshot('eve', 'players', { gameId: solo.gameId }); soloPlayers.ws.close()
const evePts = soloPlayers.records[0]?.data
const soloAnswers = await snapshot('eve', 'answers', { gameId: solo.gameId }); soloAnswers.ws.close()
const pts = soloAnswers.records.sort((a, b) => a.data.index - b.data.index).map((r) => r.data.points)
check('streak bonus: 5th straight right answer beats 1000', evePts?.correctCount === 5 && pts[4] > 1000, JSON.stringify(pts))
await act('eve', 'advance', { gameId: solo.gameId })
const eveBest = await snapshot('eve', 'bests', {}); eveBest.ws.close()
const bobBest = await snapshot('bob', 'bests', {}); bobBest.ws.close()
check('solo finish saves a personal best', eveBest.records.some((r) => r.data.topicKey === 'octopuses' && r.data.score === evePts.score), JSON.stringify(eveBest.records.map((r) => r.data)))
check('bests are private', bobBest.records.every((r) => r.data.userId === users.bob))

// 8c. a vague topic fails with "Did you mean…?" and the room follows the host's retry
const vague = await act('bob', 'createGame', { topic: 'Mercury', questionCount: 5, secondsPerQuestion: 15 })
check('vague topic game created', vague.success === true)
let failedGame
for (let i = 0; i < 40; i++) {
  await sleep(500)
  const s = await snapshot('bob', 'games', { code: vague.data.code }); s.ws.close()
  failedGame = s.records[0]?.data
  if (failedGame?.status === 'failed') break
}
check('vague topic fails generation', failedGame?.status === 'failed', `status=${failedGame?.status}`)
check('failure offers 3 specific articles, skipping disambiguation and thin pages',
  JSON.stringify(failedGame?.suggestions) === '["Mercury (planet)","Mercury (element)","Freddie Mercury"]', JSON.stringify(failedGame?.suggestions))
const hijack = await act('eve', 'createGame', { topic: 'Freddie Mercury', questionCount: 5, secondsPerQuestion: 15, replaces: vague.data.gameId })
const afterHijack = await snapshot('bob', 'games', { code: vague.data.code }); afterHijack.ws.close()
check('a non-host cannot redirect someone else’s room', hijack.success === true && !afterHijack.records[0]?.data.nextCode)
const retry = await act('bob', 'createGame', { topic: 'Mercury (planet)', questionCount: 5, secondsPerQuestion: 15, replaces: vague.data.gameId })
const followed = await snapshot('alice', 'games', { code: vague.data.code }); followed.ws.close()
check('host retry points the old room at the new game', retry.success && followed.records[0]?.data.nextCode === retry.data.code, JSON.stringify(followed.records[0]?.data.nextCode))

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
