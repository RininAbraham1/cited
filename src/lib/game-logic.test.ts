import { describe, expect, it } from 'vitest'
import {
  articleTextFromHtml,
  distributionFor,
  extractJson,
  makeJoinCode,
  normalizeJoinCode,
  pointsFor,
  quoteAppearsIn,
  shuffleChoices,
  totalsFor,
  validateDrafts,
  wikipediaUrl,
} from './game-logic'

// Shaped like Wikipedia's rendered (Parsoid) HTML: infobox table, footnote
// <sup>s, entities, a style block, and a short coordinates paragraph.
const ARTICLE_HTML = `
<style>.mw-parser-output .hatnote{font-style:italic}</style>
<table class="infobox"><tr><td>Kingdom: Animalia — should not appear</td></tr></table>
<p><span>Coordinates: 1°N</span></p>
<p>An <b>octopus</b> (<abbr>pl.</abbr> octopuses or octopodes) is a soft-bodied, eight-limbed
mollusc of the order <a href="./Octopoda">Octopoda</a>.<sup class="reference"><a href="#cite_note-1">[1]</a></sup>
The order consists of some 300&nbsp;species and is grouped within the class Cephalopoda.</p>
<p>Octopuses have three hearts: two pump blood through the gills, while the third circulates it
through the rest of the body.<sup>[12]</sup> Their blood is blue because it contains the
copper-rich protein &#8220;haemocyanin&#8221;.</p>
<figure><figcaption>Caption text that is not prose</figcaption></figure>
`

const TEXT = articleTextFromHtml(ARTICLE_HTML)

describe('articleTextFromHtml', () => {
  it('keeps paragraph prose and drops tables, styles, figures and footnotes', () => {
    expect(TEXT).toContain('soft-bodied, eight-limbed mollusc of the order Octopoda.')
    expect(TEXT).not.toContain('Kingdom')
    expect(TEXT).not.toContain('font-style')
    expect(TEXT).not.toContain('Caption text')
    expect(TEXT).not.toMatch(/\[\d+\]/)
    expect(TEXT).not.toContain('Coordinates') // under 40 chars
  })

  it('decodes entities', () => {
    expect(TEXT).toContain('some 300 species')
    expect(TEXT).toContain('“haemocyanin”')
  })

  it('respects the character budget', () => {
    expect(articleTextFromHtml(ARTICLE_HTML, 100).length).toBeLessThanOrEqual(100)
  })
})

describe('quoteAppearsIn — the anti-hallucination gate', () => {
  it('accepts a verbatim quote', () => {
    expect(quoteAppearsIn('Octopuses have three hearts: two pump blood through the gills', TEXT)).toBe(true)
  })

  it('tolerates curly vs straight quotes, case, whitespace and a trailing period', () => {
    expect(quoteAppearsIn('their blood is blue because it contains the copper-rich protein "haemocyanin".', TEXT)).toBe(true)
    expect(quoteAppearsIn('Octopuses  have\nthree hearts', TEXT)).toBe(true)
  })

  it('tolerates footnote markers the model copied from the article', () => {
    expect(quoteAppearsIn('mollusc of the order Octopoda.[1] The order consists of some 300 species', TEXT)).toBe(true)
  })

  it('rejects a paraphrase', () => {
    expect(quoteAppearsIn('Octopuses possess three separate hearts that pump blood', TEXT)).toBe(false)
  })

  it('rejects a fabricated fact', () => {
    expect(quoteAppearsIn('Octopuses have four hearts: two pump blood through the gills', TEXT)).toBe(false)
  })

  it('rejects quotes too short to prove anything', () => {
    expect(quoteAppearsIn('three hearts', TEXT)).toBe(false)
  })
})

describe('validateDrafts', () => {
  const sources = { Octopus: TEXT }
  const good = {
    prompt: 'How many hearts does an octopus have?',
    choices: ['One', 'Two', 'Three', 'Four'],
    answerIndex: 2,
    quote: 'Octopuses have three hearts: two pump blood through the gills',
    source: 'Octopus',
    explanation: 'Two serve the gills.',
  }

  it('keeps a grounded question', () => {
    const { kept, rejected } = validateDrafts([good], sources)
    expect(rejected).toEqual([])
    expect(kept).toHaveLength(1)
    expect(kept[0].answerIndex).toBe(2)
  })

  it('accepts a { questions: [...] } wrapper', () => {
    expect(validateDrafts({ questions: [good] }, sources).kept).toHaveLength(1)
  })

  it('drops ungrounded, malformed and duplicate drafts with reasons', () => {
    const { kept, rejected } = validateDrafts(
      [
        good,
        { ...good }, // duplicate prompt
        { ...good, prompt: 'Q2', quote: 'Octopuses have nine hearts and two brains in total.' },
        { ...good, prompt: 'Q3', source: 'Squid' },
        { ...good, prompt: 'Q4', choices: ['a', 'b', 'c'] },
        { ...good, prompt: 'Q5', choices: ['a', 'b', 'a', 'c'] },
        { ...good, prompt: 'Q6', answerIndex: 4 },
        { ...good, prompt: 'Q7', answerIndex: '2' },
        null,
      ],
      sources,
    )
    expect(kept).toHaveLength(1)
    expect(rejected).toEqual([
      'duplicate prompt',
      'quote not found in source',
      'unknown source "Squid"',
      'needs 4 choices',
      'duplicate choices',
      'bad answerIndex',
      'bad answerIndex',
      'missing field',
    ])
  })
})

describe('extractJson', () => {
  it('reads fenced and bare JSON', () => {
    expect(extractJson('Here you go:\n```json\n[{"a":1}]\n```')).toEqual([{ a: 1 }])
    expect(extractJson('[{"a":[1,2]}] trailing')).toEqual([{ a: [1, 2] }])
  })
  it('throws when there is no JSON', () => {
    expect(() => extractJson('sorry, I cannot')).toThrow()
  })
})

describe('scoring', () => {
  it('gives 1000 for an instant correct answer and 500 at the buzzer', () => {
    expect(pointsFor(true, 0, 20_000)).toBe(1000)
    expect(pointsFor(true, 10_000, 20_000)).toBe(750)
    expect(pointsFor(true, 20_000, 20_000)).toBe(500)
    expect(pointsFor(true, 25_000, 20_000)).toBe(500) // clamped inside grace
  })
  it('gives 0 for a wrong answer however fast', () => {
    expect(pointsFor(false, 0, 20_000)).toBe(0)
  })
  it('recomputes totals idempotently from answers', () => {
    const answers = [
      { points: 900, correct: true },
      { points: 0, correct: false },
      { points: undefined, correct: undefined }, // not yet scored
      { points: 600, correct: true },
    ]
    expect(totalsFor(answers)).toEqual({ score: 1500, correctCount: 2 })
    // Running it twice is the point: same input, same totals, no double count.
    expect(totalsFor(answers)).toEqual(totalsFor(answers))
  })
  it('builds a per-choice distribution and ignores junk', () => {
    expect(distributionFor([0, 2, 2, 3, 7, -1], 4)).toEqual([1, 0, 2, 1])
  })
})

describe('shuffleChoices', () => {
  it('keeps the correct answer attached to its text', () => {
    let seed = 1
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < 50; i++) {
      const out = shuffleChoices(['One', 'Two', 'Three', 'Four'], 2, rand)
      expect(out.choices[out.answerIndex]).toBe('Three')
      expect([...out.choices].sort()).toEqual(['Four', 'One', 'Three', 'Two'])
    }
  })
  it('actually moves the answer around', () => {
    const positions = new Set<number>()
    for (let i = 0; i < 200; i++) positions.add(shuffleChoices(['a', 'b', 'c', 'd'], 0).answerIndex)
    expect(positions.size).toBe(4)
  })
})

describe('join codes', () => {
  it('makes 5-char codes without ambiguous characters', () => {
    for (let i = 0; i < 200; i++) {
      const code = makeJoinCode()
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/)
      expect(code).not.toMatch(/[01OIL]/)
      expect(normalizeJoinCode(code)).toBe(code)
    }
  })
  it('normalizes user input and rejects bad codes', () => {
    expect(normalizeJoinCode('  k7mqx ')).toBe('K7MQX')
    expect(normalizeJoinCode('K7MQ')).toBeNull()
    expect(normalizeJoinCode('K0MQX')).toBeNull()
    expect(normalizeJoinCode(42)).toBeNull()
  })
})

it('builds Wikipedia URLs', () => {
  expect(wikipediaUrl('Great Barrier Reef')).toBe('https://en.wikipedia.org/wiki/Great_Barrier_Reef')
})
