/**
 * Background entry: the MentraOS host runs this in a bare JS engine and calls
 * the registerMiniapp handler once connected. All logic lives in core.ts so
 * the browser dev harness can run the same loop against a mock session.
 */
import { registerMiniapp } from '@mentra/miniapp/background';
import type { Channels } from '../shared/channels';
import { livingPagesBackground, type LpSession } from './core';

// The server URL is public (it holds the Gemini key; the miniapp never does).
// Set MENTRA_PUBLIC_LP_SERVER in miniapp/.env; it is inlined at build time.
// inlined by build.ts (define); there is no real `process` in the background engine
declare const process: { env: Record<string, string | undefined> };
const SERVER = process.env.MENTRA_PUBLIC_LP_SERVER || 'http://localhost:8787';

registerMiniapp<Channels>((session) => {
  // returning the promise keeps the host's splash up until handlers are registered
  return livingPagesBackground(session as unknown as LpSession, { server: SERVER }).then(() => {});
});
