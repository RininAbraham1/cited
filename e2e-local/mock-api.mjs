// Mock DeepSpace api-worker: answers integration calls with fixed data and logs every request.
import http from 'node:http'
import fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(new URL('../app/package.json', import.meta.url))
const { SignJWT, importPKCS8 } = require('jose')
const KEY = await importPKCS8(fs.readFileSync(new URL('./priv.pem', import.meta.url), 'utf8'), 'ES256')
const userFrom = (req) => {
  const m = /mockuser=([a-z0-9_]+)/.exec(req.headers.cookie ?? '')
  return m ? { id: m[1], name: m[1].replace('user_', '').replace(/^./, (c) => c.toUpperCase()), email: `${m[1]}@deepspace.test` } : null
}

const PARA = (t) => `<p>${t}</p>`
const ARTICLES = {
  Octopus: [
    'An octopus is a soft-bodied, eight-limbed mollusc of the order Octopoda.<sup>[1]</sup> The order consists of some 300 species and is grouped within the class Cephalopoda with squids, cuttlefish, and nautiloids.',
    'Octopuses have three hearts: two pump blood through the gills, while the third circulates it through the rest of the body. Their blood is blue because it contains the copper-rich protein haemocyanin.',
    'The giant Pacific octopus is often cited as the largest known octopus species, with adults usually weighing around 15 kg and an arm span of up to 4.3 m.',
    'Octopuses can change the colour and texture of their skin using specialised cells called chromatophores, which lets them blend into their surroundings within a fraction of a second.',
  ].map(PARA).join('\n').repeat(3),
  Cephalopod: [
    'A cephalopod is any member of the molluscan class Cephalopoda, such as a squid, octopus, cuttlefish, or nautilus. These exclusively marine animals are characterized by bilateral body symmetry and a prominent head.',
    'Cephalopods became dominant during the Ordovician period, represented by primitive nautiloids. The class now contains two, only distantly related, extant subclasses: Coleoidea and Nautiloidea.',
  ].map(PARA).join('\n').repeat(4),
}

const QUESTIONS = [
  { prompt: 'How many hearts does an octopus have?', choices: ['Three', 'One', 'Two', 'Four'], answerIndex: 0,
    quote: 'Octopuses have three hearts: two pump blood through the gills', source: 'Octopus', explanation: 'Two serve the gills.' },
  { prompt: 'Why is octopus blood blue?', choices: ['Copper-rich haemocyanin', 'Iron-rich haemoglobin', 'Ink in the veins', 'Cold water'], answerIndex: 0,
    quote: 'Their blood is blue because it contains the copper-rich protein haemocyanin.', source: 'Octopus' },
  { prompt: 'Roughly how many octopus species are there?', choices: ['About 30', 'About 300', 'About 3,000', 'About 30,000'], answerIndex: 1,
    quote: 'The order consists of some 300 species', source: 'Octopus' },
  { prompt: 'Which period saw cephalopods become dominant?', choices: ['Jurassic', 'Cambrian', 'Ordovician', 'Permian'], answerIndex: 2,
    quote: 'Cephalopods became dominant during the Ordovician period, represented by primitive nautiloids.', source: 'Cephalopod' },
  // Hallucinated: this sentence is NOT in the article and must be rejected.
  { prompt: 'How many brains does an octopus have?', choices: ['Nine', 'One', 'Two', 'Three'], answerIndex: 0,
    quote: 'Octopuses have nine brains, one in each arm plus a central brain.', source: 'Octopus' },
  { prompt: 'What cells let octopuses change colour?', choices: ['Chromatophores', 'Neurons', 'Melanocytes', 'Osteocytes'], answerIndex: 0,
    quote: 'specialised cells called chromatophores, which lets them blend into their surroundings', source: 'Octopus' },
]

const log = []
http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', async () => {
    log.push({ method: req.method, url: req.url, body: body.slice(0, 300), auth: req.headers.authorization })
    fs.writeFileSync(new URL('./mock-log.json', import.meta.url), JSON.stringify(log, null, 2))
    const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
    const u = req.url
    if (u.startsWith('/api/auth/get-session')) {
      const user = userFrom(req)
      if (!user) return send(200, null)
      const now = new Date().toISOString()
      return send(200, { session: { id: 'sess_' + user.id, userId: user.id, token: 't', expiresAt: new Date(Date.now() + 864e5).toISOString(), createdAt: now, updatedAt: now },
        user: { ...user, emailVerified: true, image: null, createdAt: now, updatedAt: now } })
    }
    if (u.startsWith('/api/auth/token')) {
      const user = userFrom(req)
      if (!user) return send(401, { error: 'no session' })
      const token = await new SignJWT({ name: user.name, email: user.email }).setProtectedHeader({ alg: 'ES256' })
        .setSubject(user.id).setIssuer('local-test').setIssuedAt().setExpirationTime('1h').sign(KEY)
      return send(200, { token })
    }
    if (u.endsWith('/wikipedia/search-pages')) {
      return send(200, { success: true, data: [
        { title: 'Octopus (disambiguation)', thumbnail: null }, { title: 'Octopus', thumbnail: null },
        { title: 'Cephalopod', thumbnail: null }, { title: 'Stubby article', thumbnail: null },
      ] })
    }
    if (u.endsWith('/wikipedia/get-page-content')) {
      const { title } = JSON.parse(body || '{}')
      if (title === 'Stubby article') return send(200, { success: true, data: { htmlContent: '<p>Too short to use for anything at all really.</p>' } })
      return send(200, { success: true, data: { htmlContent: ARTICLES[title] ?? '' } })
    }
    if (u.endsWith('/anthropic/chat-completion')) {
      return send(200, { success: true, data: { content: [{ type: 'text', text: '```json\n' + JSON.stringify(QUESTIONS) + '\n```' }] } })
    }
    if (u.endsWith('/elevenlabs/generate-speech')) {
      return send(200, { success: true, data: { audioUrl: 'data:audio/mpeg;base64,AAAA', voice_id: 'v', model_id: 'm', output_format: 'f' } })
    }
    send(404, { success: false, error: `mock: no route ${u}` })
  })
}).listen(8799, '127.0.0.1', () => console.log('mock api on 8799'))
