/**
 * Integration Billing Config
 *
 * Configure who pays for each integration's API calls.
 *
 * - 'developer': The app owner pays (default).
 * - 'user': The calling user pays.
 *
 * Every integration requires a signed-in caller. Set `anonymous: true` on a
 * 'developer' integration to let signed-out visitors call it too — the owner
 * then pays for anyone who can reach the app.
 *
 * Integrations not listed here default to 'developer' with sign-in required.
 *
 * IMPORTANT: any integration backed by per-user connected accounts (Google,
 * Composio) must be 'user' — the api-worker resolves the account from the
 * JWT subject. With 'developer' the app owner's JWT is forwarded, so every
 * signed-in user connects and acts on the app owner's account. Server code
 * that acts for a user in the background (e.g. a cron job) uses
 * `callComposio(env, ..., { asUser })` from 'deepspace/worker' instead.
 */

/**
 * Cited calls every integration from server code (the generation job and
 * server actions), never from the browser. `browser: true` is required for
 * the /api/integrations/* proxy to forward a call; nothing here sets it, so a
 * signed-in user can't use the proxy to spend the owner's credits on
 * arbitrary models. (The scaffold's proxy forwards any integration by default.)
 */
export const integrations: Record<
  string,
  { billing: 'developer' | 'user'; anonymous?: boolean; browser?: boolean }
> = {
  google: { billing: 'user' },
  composio: { billing: 'user' },
  wikipedia: { billing: 'developer' },
  anthropic: { billing: 'developer' },
  elevenlabs: { billing: 'developer' },
}
