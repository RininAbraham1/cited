import { createRequire } from 'node:module'
const require = createRequire(new URL('../app/package.json', import.meta.url))
const { chromium } = require('@playwright/test')
const BASE = 'http://127.0.0.1:8787'
const SHOTS = process.argv[2]
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {})
const errors = []
async function person(id, viewport = { width: 1280, height: 860 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 })
  await ctx.addCookies([{ name: 'mockuser', value: id, url: BASE }])
  const page = await ctx.newPage()
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${id}] ${m.text()}`) })
  page.on('pageerror', (e) => errors.push(`[${id}] pageerror ${e.message}`))
  return page
}
const step = (s) => console.log('→', s)

const landing = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
await landing.goto(BASE + '/'); await landing.screenshot({ path: `${SHOTS}/01-landing.png`, fullPage: true })
step('landing')

const host = await person(`user_hana${Date.now() % 100000}`)
await host.goto(BASE + '/play')
await host.getByTestId('topic-input').fill('Octopuses')
await host.screenshot({ path: `${SHOTS}/02-play.png` })
await host.getByTestId('create-game').click()
await host.waitForURL(/\/g\/[A-Z0-9]{5}$/, { timeout: 15000 })
const code = host.url().split('/').pop()
step(`created ${code}`)
await host.screenshot({ path: `${SHOTS}/03-generating.png` }).catch(() => {})
await host.getByTestId('start-game').waitFor({ timeout: 30000 })

const alice = await person('user_alice')
const bob = await person('user_bob', { width: 390, height: 844 }) // phone
await alice.goto(`${BASE}/g/${code}`)
await bob.goto(`${BASE}/g/${code}`)
await host.locator('[data-testid=scoreboard] li').nth(2).waitFor({ timeout: 15000 })
await host.waitForTimeout(1500)
await host.screenshot({ path: `${SHOTS}/04-lobby-host.png` })
step('lobby with 3 players')

await host.getByTestId('start-game').click()
await alice.getByTestId('question-prompt').waitFor({ timeout: 10000 })
await bob.getByTestId('question-prompt').waitFor({ timeout: 10000 })
const prompt = await alice.getByTestId('question-prompt').textContent()
step(`question live on alice + bob: ${prompt}`)
const answers = { 'How many hearts does an octopus have?': 'Three' }
const choices = await alice.locator('[data-testid^=choice-]').allTextContents()
const right = choices.findIndex((c) => c.includes(answers[prompt] ?? '§'))
await alice.getByTestId(`choice-${right}`).click()
await bob.getByTestId(`choice-${(right + 1) % 4}`).click()
await alice.waitForTimeout(800)
await alice.screenshot({ path: `${SHOTS}/05-question-locked-alice.png` })
await bob.screenshot({ path: `${SHOTS}/06-question-locked-bob-phone.png` })

// host hasn't answered: reveal manually
await host.getByRole('button', { name: 'Reveal now' }).click()
await alice.getByTestId('citation').waitFor({ timeout: 10000 })
await bob.getByTestId('citation').waitFor({ timeout: 10000 })
await alice.waitForTimeout(800)
await alice.screenshot({ path: `${SHOTS}/07-reveal-alice.png` })
await bob.screenshot({ path: `${SHOTS}/08-reveal-bob-phone.png`, fullPage: true })
step('reveal shown with citation')

// Footnote card: alice picks the first face-down card (local deck: The Jester) and robs the host.
await alice.getByTestId('card-slot-0').click()
await alice.getByTestId('jester-prompt').waitFor({ timeout: 10000 })
await alice.waitForTimeout(1400)
await alice.screenshot({ path: `${SHOTS}/07b-card-drawn-alice.png`, fullPage: true })
await alice.getByTestId('steal-target').first().click()
await bob.getByTestId('feed-banner').waitFor({ timeout: 10000 })
await bob.waitForTimeout(600)
await bob.screenshot({ path: `${SHOTS}/08b-steal-banner-bob-phone.png` })
step('card drawn, Jester played, banner shown to others')

for (let i = 1; i < 5; i++) {
  await host.getByTestId('next-question').click()
  await host.getByRole('button', { name: 'Reveal now' }).click()
  await host.getByTestId('next-question').waitFor()
}
await host.getByTestId('next-question').click() // "Final scores"
await alice.getByText('Final scores').waitFor({ timeout: 10000 })
await alice.waitForTimeout(800)
await alice.screenshot({ path: `${SHOTS}/09-final-alice.png`, fullPage: true })
step('finished')

// Solo run on a phone: pick Solo, start, answer right, see a card.
const sol = await person(`user_solo${Date.now() % 100000}`, { width: 390, height: 844 })
await sol.goto(BASE + '/play')
await sol.getByTestId('mode-solo').click()
await sol.getByTestId('topic-input').fill('Octopuses')
await sol.screenshot({ path: `${SHOTS}/10-play-solo-phone.png` })
await sol.getByTestId('create-game').click()
await sol.getByTestId('question-prompt').waitFor({ timeout: 40000 })
const sp = await sol.getByTestId('question-prompt').textContent()
const sc = await sol.locator('[data-testid^=choice-]').allTextContents()
await sol.getByTestId(`choice-${sc.findIndex((c) => c.includes(answers[sp] ?? '§'))}`).click()
await sol.getByTestId('card-picker').waitFor({ timeout: 10000 })
await sol.waitForTimeout(900)
await sol.screenshot({ path: `${SHOTS}/11-solo-reveal-phone.png`, fullPage: true })
step('solo run: auto-started, answered, card offered')

// A vague topic fails, offers "Did you mean…?", and one tap starts over on that article.
const vg = await person(`user_vague${Date.now() % 100000}`, { width: 390, height: 844 })
await vg.goto(BASE + '/play')
await vg.getByTestId('topic-input').fill('Mercury')
await vg.getByTestId('create-game').click()
await vg.getByTestId('suggestions').waitFor({ timeout: 40000 })
await vg.waitForTimeout(500)
await vg.screenshot({ path: `${SHOTS}/12-did-you-mean-phone.png`, fullPage: true })
const before = vg.url()
await vg.getByTestId('suggestion').first().click()
await vg.waitForURL((u) => u.toString() !== before, { timeout: 15000 })
step('vague topic: suggestions shown, retry started a new game')

const aliceScore = await alice.locator('[data-testid=scoreboard] li').first().textContent()
console.log('top of scoreboard:', aliceScore)
console.log('console errors:', errors.length ? '\n' + [...new Set(errors)].join('\n') : 'none')
await browser.close()
