import { describe, expect, it } from 'vitest'
import {
  CARDS, cardPool, dealHand, oracleStrikes, redactedPenalty, scoreWithCards, stealOutcome, streakAt, streakMultiplier,
} from './game-logic'

const seq = (...xs: number[]) => { let i = 0; return () => xs[i++ % xs.length] }

describe('card pool', () => {
  it('never deals social cards in solo', () => {
    const pool = cardPool({ solo: true, lastQuestion: false })
    expect(pool).not.toContain('jester')
    expect(pool).not.toContain('librarian')
    expect(pool).toContain('oracle')
  })
  it('never deals the Oracle on the last question (nothing left to cross out)', () => {
    const pool = cardPool({ solo: false, lastQuestion: true })
    expect(pool).not.toContain('oracle')
    expect(pool).toContain('twins')
    expect(pool).toContain('jester')
  })
  it('always deals 3 DIFFERENT cards, in every situation', () => {
    for (const solo of [true, false]) {
      for (const lastQuestion of [true, false]) {
        expect(cardPool({ solo, lastQuestion }).length).toBeGreaterThanOrEqual(3)
        for (let t = 0; t < 500; t++) {
          const hand = dealHand({ solo, lastQuestion })
          expect(hand).toHaveLength(3)
          expect(new Set(hand).size).toBe(3)
          for (const c of hand) expect(cardPool({ solo, lastQuestion })).toContain(c)
        }
      }
    }
  })
  it('solo last question deals exactly Scholar, Twins and Redacted', () => {
    expect(new Set(dealHand({ solo: true, lastQuestion: true }))).toEqual(new Set(['scholar', 'twins', 'redacted']))
  })
  it('covers every card with a full random range', () => {
    const seen = new Set(dealHand({ solo: false, lastQuestion: false }, seq(0, 0.3, 0.999)))
    for (let r = 0; r < 1; r += 0.01) seen.add(dealHand({ solo: false, lastQuestion: false }, () => r)[0])
    expect([...seen].sort()).toEqual(Object.keys(CARDS).sort())
  })
})

describe('steal', () => {
  it('moves 20% (rounded down to 10) and conserves points', () => {
    const o = stealOutcome(1745, false)
    expect(o.thief).toBe(340)
    expect(o.thief + o.victim).toBe(0)
  })
  it('is blocked completely by a shield', () => {
    expect(stealOutcome(5000, true)).toEqual({ thief: 0, victim: 0 })
  })
  it('takes nothing from a zero score', () => {
    expect(stealOutcome(0, false).thief).toBe(0)
  })
})

describe('other cards', () => {
  it('redacted never goes below zero', () => {
    expect(redactedPenalty(1000)).toBe(-100)
    expect(redactedPenalty(40)).toBe(-40)
    expect(redactedPenalty(0) === 0).toBe(true)
  })
  it('oracle strikes two distinct wrong answers', () => {
    for (let t = 0; t < 100; t++) {
      const s = oracleStrikes(2, 4)
      expect(s).toHaveLength(2)
      expect(s).not.toContain(2)
      expect(new Set(s).size).toBe(2)
    }
  })
  it('score adds every delta that touches the player and floors at 0', () => {
    const plays = [
      { actorId: 'a', targetId: 'b', actorDelta: 300, targetDelta: -300 },
      { actorId: 'b', actorDelta: 200, targetDelta: 0 },
    ]
    expect(scoreWithCards(1000, plays, 'a')).toBe(1300)
    expect(scoreWithCards(50, plays, 'b')).toBe(0)
  })
})

describe('streaks', () => {
  it('counts consecutive correct answers and breaks on a miss', () => {
    const m = new Map([[0, true], [1, true], [2, false], [3, true], [4, true], [5, true]])
    expect(streakAt(m, 1)).toBe(2)
    expect(streakAt(m, 2)).toBe(0)
    expect(streakAt(m, 5)).toBe(3)
    expect(streakAt(new Map([[0, true], [2, true]]), 2)).toBe(1)
  })
  it('multiplier grows 10% per step and caps at 1.5', () => {
    expect(streakMultiplier(1)).toBe(1)
    expect(streakMultiplier(3)).toBeCloseTo(1.2)
    expect(streakMultiplier(20)).toBeCloseTo(1.5)
  })
})
