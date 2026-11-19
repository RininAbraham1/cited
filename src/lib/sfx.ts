/**
 * Tiny synthesized sound effects (Web Audio, no files). Kept quiet and short
 * on purpose: a soft rising chime for a right answer, a soft low "bonk" for a
 * wrong one. Browsers only allow audio after a tap, so `unlock()` is called
 * from the answer button.
 *
 * The mute choice is a per-device convenience in localStorage; every access
 * is guarded because storage can be blocked (private mode, previews).
 */

const KEY = 'cited:sfx-muted'
let ctx: AudioContext | null = null

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    try { ctx = new AC() } catch { return null }
  }
  return ctx
}

export function isMuted(): boolean {
  try { return window.localStorage.getItem(KEY) === '1' } catch { return false }
}

export function setMuted(muted: boolean): void {
  try { window.localStorage.setItem(KEY, muted ? '1' : '0') } catch { /* storage blocked: stays session-only */ }
}

/** Call from a user gesture so later sounds are allowed to play. */
export function unlock(): void {
  const a = audio()
  if (a && a.state === 'suspended') void a.resume().catch(() => {})
}

/** One soft note with a quick attack and a gentle fade. */
function note(a: AudioContext, freq: number, start: number, dur: number, type: OscillatorType, peak: number) {
  const osc = a.createOscillator()
  const gain = a.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, start)
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  osc.connect(gain).connect(a.destination)
  osc.start(start)
  osc.stop(start + dur + 0.05)
}

export function playCorrect(): void {
  if (isMuted()) return
  const a = audio()
  if (!a) return
  const t = a.currentTime + 0.02
  // C6 then E6: bright but short.
  note(a, 1046.5, t, 0.22, 'sine', 0.09)
  note(a, 1318.5, t + 0.09, 0.32, 'sine', 0.08)
}

export function playWrong(): void {
  if (isMuted()) return
  const a = audio()
  if (!a) return
  const t = a.currentTime + 0.02
  // Soft descending pair, low and rounded (triangle), never buzzy.
  note(a, 311.1, t, 0.18, 'triangle', 0.08)
  note(a, 233.1, t + 0.12, 0.3, 'triangle', 0.07)
}
