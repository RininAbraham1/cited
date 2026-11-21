/** Game-room header: topic, join code, sound toggle and the host's controls. */
import { useEffect, useRef, useState } from 'react'
import { Bell, BellOff, Check, Copy, Volume2, VolumeX } from 'lucide-react'
import { Button, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { callAction } from '@/lib/call-action'
import { isMuted, playCorrect, setMuted, unlock } from '@/lib/sfx'
import { type Game } from '@/lib/game-logic'

export function Header({ game, isHost, gameId, solo, mustPickCard }: { game: Game; isHost: boolean; gameId: string; solo: boolean; mustPickCard?: boolean }) {
  const [copied, setCopied] = useState(false)
  const link = typeof window !== 'undefined' ? `${window.location.origin}/g/${game.code}` : ''
  const live = game.status !== 'generating' && game.status !== 'lobby' && game.status !== 'failed'
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-black">
          <span className="sticker rotate-[-2deg] bg-paper px-2 py-0.5 text-xs">{solo ? 'Solo run' : `Hosted by ${game.hostName ?? 'someone'}`}</span>
          {live && (
            <span className="sticker rotate-[2deg] bg-hl-2 px-2 py-0.5 text-xs">
              Question {Math.min(game.currentIndex + 1, game.questionCount)} of {game.questionCount}
            </span>
          )}
        </p>
        <h1 className="title-pop mt-3 truncate pb-1 text-5xl leading-none md:text-6xl">{game.topic}</h1>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SoundToggle />
        {isHost && <HostControls game={game} gameId={gameId} solo={solo} mustPickCard={mustPickCard} />}
        {!solo && <button
          onClick={() => { void navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
          className="pop group flex rotate-[2deg] items-center gap-2 rounded-2xl bg-hl-0 px-4 py-1.5 text-ink"
          title="Copy invite link"
        >
          <span className="text-left">
            <span className="block text-[10px] font-black uppercase leading-none tracking-[0.2em] opacity-60">Code</span>
            <span className="font-display block text-3xl leading-none tracking-[0.12em]" data-testid="join-code-display">{game.code}</span>
          </span>
          {copied ? <Check className="h-5 w-5" strokeWidth={3} aria-label="Copied" /> : <Copy className="h-5 w-5 opacity-50 group-hover:opacity-100" aria-hidden />}
        </button>}
      </div>
    </header>
  )
}

export function SoundToggle() {
  const [muted, setMutedState] = useState(() => isMuted())
  return (
    <button
      onClick={() => { const m = !muted; setMuted(m); setMutedState(m); if (!m) { unlock(); playCorrect() } }}
      aria-pressed={!muted}
      title={muted ? 'Turn sound effects on' : 'Mute sound effects'}
      data-testid="sound-toggle"
      className={cn('pop grid h-12 w-12 place-items-center rounded-2xl text-ink', muted ? 'bg-paper' : 'bg-hl-3')}
    >
      {muted ? <BellOff className="h-5 w-5" strokeWidth={2.6} aria-label="Sound effects off" /> : <Bell className="h-5 w-5" strokeWidth={2.6} aria-label="Sound effects on" />}
    </button>
  )
}

export function HostControls({ game, gameId, solo, mustPickCard }: { game: Game; gameId: string; solo?: boolean; mustPickCard?: boolean }) {
  const { error } = useToast()
  const [busy, setBusy] = useState(false)
  const [readAloud, setReadAloud] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const spokenRef = useRef(-1)

  // Read each newly opened question aloud on the host's screen (the one
  // usually on the TV). Generated on demand and never stored: audio is
  // ~20 KB of data URL per question and only this tab needs it.
  useEffect(() => {
    if (!readAloud || game.status !== 'question' || spokenRef.current === game.currentIndex) return
    spokenRef.current = game.currentIndex
    void callAction<{ audioUrl: string }>('speakQuestion', { gameId }).then((r) => {
      if (!r.success) return error('Couldn’t read the question aloud', r.error)
      audioRef.current?.pause()
      audioRef.current = new Audio(r.data.audioUrl)
      void audioRef.current.play().catch(() => {})
    })
  }, [readAloud, game.status, game.currentIndex, gameId, error])
  useEffect(() => () => audioRef.current?.pause(), [])

  async function run(name: 'advance' | 'reveal') {
    setBusy(true)
    const r = await callAction(name, { gameId })
    setBusy(false)
    if (!r.success) error('Hmm', r.error)
  }

  const last = game.currentIndex + 1 >= game.questionCount
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => { setReadAloud((v) => !v); spokenRef.current = readAloud ? spokenRef.current : -1 }}
        aria-pressed={readAloud}
        title={readAloud ? 'Stop reading questions aloud' : 'Read questions aloud (ElevenLabs)'}
        className={cn('pop grid h-12 w-12 place-items-center rounded-2xl text-ink', readAloud ? 'bg-hl-2' : 'bg-paper')}
      >
        {readAloud ? <Volume2 className="h-5 w-5" strokeWidth={2.6} /> : <VolumeX className="h-5 w-5" strokeWidth={2.6} />}
      </button>
      {game.status === 'lobby' && <Button size="lg" className="font-display h-12 bg-hl-1 text-xl font-normal" onClick={() => run('advance')} disabled={busy} data-testid="start-game">Start game</Button>}
      {game.status === 'question' && !solo && <Button size="lg" variant="outline" className="font-display h-12 text-xl font-normal" onClick={() => run('reveal')} disabled={busy}>Reveal now</Button>}
      {game.status === 'reveal' && (
        <Button size="lg" className="font-display h-12 bg-hl-1 text-xl font-normal" onClick={() => run('advance')} disabled={busy || mustPickCard} data-testid="next-question">
          {mustPickCard ? 'Pick a card first' : last ? 'Final scores' : 'Next question'}
        </Button>
      )}
    </div>
  )
}
