/** The game-room mascot: what it feels and says for my view of the room. */
import { Check } from 'lucide-react'
import { Mascot, type Mood } from '@/components/Mascot'
import { type Answer, type Game } from '@/lib/game-logic'

/** What the mascot is feeling, and what it says, for my view of the room. */
export function reactionFor(game: Game, myAnswer: Answer | undefined, remainingMs: number, isPlayer: boolean, isHost: boolean): { mood: Mood; line: string } {
  switch (game.status) {
    case 'generating': return { mood: 'think', line: 'Reading the articles…' }
    case 'failed': return { mood: 'sad', line: 'That topic was too thin. Try another?' }
    case 'lobby':
      if (game.mode === 'solo') return { mood: 'happy', line: 'Here we go!' }
      return { mood: 'idle', line: isHost ? 'Start when everyone’s in!' : 'Waiting for the host…' }
    case 'finished': return { mood: 'cheer', line: 'GG! What a game.' }
    case 'question':
      if (!isPlayer) return { mood: 'idle', line: 'Watching…' }
      if (myAnswer) return { mood: 'idle', line: 'Locked in. Fingers crossed!' }
      if (remainingMs <= 0) return { mood: 'wow', line: 'Time!' }
      return { mood: 'think', line: remainingMs < 5000 ? 'Quick, quick!' : 'Hmm… think fast!' }
    case 'reveal':
      if (!isPlayer) return { mood: 'idle', line: 'And the answer is…' }
      if (!myAnswer) return { mood: 'wow', line: 'Too slow!' }
      if (myAnswer.correct == null) return { mood: 'think', line: 'Checking…' }
      return myAnswer.correct ? { mood: 'happy', line: 'Nailed it!' } : { mood: 'sad', line: 'Oof. Check the receipt.' }
  }
}

/** Big mascot that reacts to the game, pinned in the left margin on wide screens. */
export function ReactionMascot({ mood, line }: { mood: Mood; line: string }) {
  return (
    <div className="flex flex-col items-center gap-2" data-testid="reaction-mascot" aria-live="polite">
      <Mascot mood={mood} size={168} key={mood} />
      <p className="relative rounded-2xl border-[3px] border-[var(--ink)] bg-paper px-3 py-2 text-center font-black leading-snug text-ink shadow-[4px_4px_0_0_var(--ink)]">
        <span className="absolute -top-[10px] left-1/2 h-4 w-4 -translate-x-1/2 rotate-45 border-l-[3px] border-t-[3px] border-[var(--ink)] bg-paper" aria-hidden />
        <span className="relative">{line}</span>
      </p>
    </div>
  )
}
