# Cited — live trivia with sourced answers

A multiplayer quiz game on [DeepSpace](https://docs.deep.space). A host types any topic. Cited pulls
the relevant Wikipedia articles, Claude drafts multiple-choice questions, and **every question
is checked against the article text before anyone sees it.** Friends join with a five-letter code
and answer live. Each reveal shows the exact sentence from the article that proves the answer.

Most AI trivia is fun until someone asks "wait, is that actually true?" Cited is built so the
answer to that question is always one click away, and so a question whose evidence can't be
found never gets asked.

## How a game works

1. **Create** (`/play`): the `createGame` server action validates the input, rate-limits the
   host (5 games per hour, since each one spends owner credits), creates the game in `generating`
   state, and enqueues a background job.
2. **Generate** (`src/jobs.ts`, `src/server/generate.ts`): the job runs `wikipedia/search-pages`,
   then `wikipedia/get-page-content` for the top articles (skipping disambiguation, list and stub
   pages), then one `anthropic/chat-completion` call that must return a *verbatim* quote and its
   source for each question. `validateDrafts` drops anything malformed or whose quote is not
   literally in the named article. If too few survive, it does one top-up round. Choices are
   shuffled server-side. Progress is written to the game record, so everyone in the room watches it live.
3. **Lobby → question → reveal → … → final** (`/g/:code`): the host advances. Players answer
   through `submitAnswer`. `reveal` scores the answers and publishes the answer, the quote, a link
   to the source and the answer distribution. The final screen lists every question with its receipt.

## Security model (the interesting part)

The game's rules are enforced on the server, not in the UI:

| Collection      | Who can read                       | Who can write |
| --------------- | ---------------------------------- | ------------- |
| `question_bank` | **nobody**, admins/owner included  | server only   |
| `questions`     | everyone; a row appears when the question opens, and its answer fields are filled only at reveal | server only |
| `answers`       | each player sees **only their own** (`read: 'own'`) | server only |
| `games`, `players` | everyone                        | server only   |

- **The answer key never reaches a browser before the reveal.** RBAC filters records in the
  RecordRoom Durable Object before the WebSocket broadcast, and `question_bank` is unreadable for
  every role. Even the host, who is pinned to `admin` when they own the app, can't peek.
- **Every state change is a server action** (`src/actions/index.ts`) checked against the verified
  JWT caller. Only the host may advance; answers must come from a joined player, for the open
  question, before the deadline (plus 1.5 s grace). `uniqueOn(gameId, index, userId)` makes
  answers write-once, which the database enforces against races too.
- **Scores are recomputed, not incremented.** `reveal` derives totals from the stored answers, so
  two overlapping reveals (host click plus timer) write the same numbers instead of double-counting.
- **No stalled rooms.** The host's tab reveals at the deadline. If the host has left, any player
  may reveal once the deadline has passed.
- **No credit leaks.** The scaffold's `/api/integrations/*` proxy forwards *any* integration for
  any signed-in user, billed to the app owner. Cited makes every integration call server-side,
  so the proxy now requires an explicit `browser: true` opt-in (`src/integrations.ts`) and returns
  403 otherwise. The JobRoom also refuses all browser connections. Only the `createGame` action
  can enqueue generation.
- The job's return value is just counts, because job rows are broadcast to subscribers and would
  otherwise leak the questions.

## DeepSpace pieces used, and why

| Piece | Used for |
| ----- | -------- |
| **RecordRoom + RBAC schemas** | All game state, live sync to every player, and server-side answer hiding |
| **Server actions** | Every move in the game: privileged, validated, attributed to a verified caller |
| **JobRoom background job** | 20–60 s generation that shouldn't hold an HTTP request open; retries are safe because the job is idempotent on `status` |
| **PresenceRoom** | Green dot for who has the room open right now (sub-second, not the 60 s heartbeat) |
| **Auth** | Google/GitHub sign-in; identity comes only from the verified JWT |
| **Integration: `wikipedia`** | Source material: search, then full article HTML |
| **Integration: `anthropic`** | Question drafting with verbatim evidence (`claude-sonnet-5-5`) |
| **Integration: `elevenlabs`** | Optional host-only "read questions aloud" for a TV or projector setup. Generated on demand and never stored (about 20 KB per question) |

**Left out on purpose:**
- **AI chat panel:** a chatbot next to a quiz is a cheating tool.
- **Payments:** nothing to sell in an evaluation build.
- **File uploads:** nothing to upload.
- **Email:** invites travel as a 5-letter code or link, which is faster in a room than email.
- **Exa/web search:** Wikipedia's licence and stable article text are what make the quote check
  possible. Arbitrary web pages would make "the source says so" much weaker.
- **Yjs/canvas:** no shared free-form editing here.

## Main tradeoff

**Grounding over coverage and speed.** Requiring a verbatim quote that is mechanically verified
throws away some good questions (a paraphrased quote fails) and costs a second model call when too
many are rejected. Topics with thin Wikipedia coverage can fail outright ("Try a broader topic").
In exchange, every question is backed by text the players can read, and a hallucinated fact can't
get through, because its "evidence" won't be found in the article. A similar call: the host's
browser drives the timer (reveal at the deadline) rather than a server cron. That's simpler and
has no per-second scheduling, at the cost of relying on a connected client. Any player's tab can
take over, which covers the host leaving.

## Verification

- `src/lib/game-logic.test.ts`: 23 unit tests covering the grounding gate (accepts verbatim,
  tolerates curly quotes, footnote markers and whitespace; rejects paraphrases, fabrications and
  short quotes), HTML extraction, scoring, idempotent totals, choice shuffling and join codes.
- `e2e-local/run.sh`: runs the **real worker** under `wrangler dev`, with a mock standing in for
  the DeepSpace auth and API workers. The mock signs JWTs with a throwaway key and returns canned
  Wikipedia and Claude responses, including one hallucinated quote. Then:
  - `e2e.mjs` asserts 41 server rules over HTTP and WebSocket: the answer key is never sent to
    players or host; client writes are denied; only the host can advance; answers are write-once,
    on time and from joined players only; concurrent reveals don't double-score; the proxy is
    locked; rate limiting works; integration calls are billed with the owner JWT.
  - `ui.mjs` plays a full game in three browsers (host, a desktop player, a phone player) and
    saves screenshots.
  - The answer-key test was **mutation-checked**: with `question_bank` made readable, it fails
    (5 rows leaked), so it isn't passing vacuously.
- Not verifiable offline: real Wikipedia/Claude output quality, real OAuth, and the deployed
  platform. Those need the live app (see below).

## Run, test, deploy

```bash
npm install                      # npm ≥ 11.6
npx deepspace auth login         # browser sign-in (GitHub/Google)
npx deepspace app init           # registers the app id (the committed wrangler.toml has the placeholder)
git add wrangler.toml && git commit -m "Register app id"
npx deepspace dev start          # local dev against the real platform
npx deepspace deploy             # → https://cited.app.space (or the name you choose)
bash e2e-local/run.sh            # offline rules + UI check (no login needed)
```

## What I'd do next

- **Server-driven timer:** use a scheduled alarm per open question (a small per-game Durable
  Object, or JobRoom `continue({ afterMs })`) so reveals happen even if every tab sleeps.
- **Clock skew:** send `serverNow` with each question and offset the countdown. Today the client
  trusts its own clock (the server enforces the deadline either way).
- **Question quality:** a cheap second-pass model check that the quote actually *entails* the
  marked answer. Quote presence proves the evidence exists, not that it's the right evidence.
- **Reconnect polish and spectator mode** for a TV display that isn't a player.
- **Cost guard per day** across all users, not only per host per hour.
