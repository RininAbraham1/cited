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

const aliceScore = await alice.locator('[data-testid=scoreboard] li').first().textContent()
console.log('top of scoreboard:', aliceScore)
console.log('console errors:', errors.length ? '\n' + [...new Set(errors)].join('\n') : 'none')
await browser.close()
