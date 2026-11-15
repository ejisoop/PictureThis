# Dev harness

This page runs the real miniapp without glasses:
- The **background loop** (`miniapp/src/background/core.ts`) runs against a mock session (`src/mock.ts`) that matches the SDK shapes.
- The **phone UI** is mounted in a same-origin iframe, standing in for the Mentra WebView. It gets the host globals the SDK expects (`window.MentraOS`, `window.mentra`).

```bash
bun run dev                    # http://localhost:5173  (server expected at http://localhost:8787)
# other server: http://localhost:5173/?server=http://192.168.1.20:8787
```

- **Photo sources:** an `evals/pages` image, an upload, or the webcam. "look away" means no page is in view.
- **Glasses button:** tap to look now; hold (≥ 0.65 s) to pause or resume scanning. The speaker caption shows the chime and the voice.
- **close app / open app:** removes the phone WebView. Discoveries found while it's closed are queued and replayed with "Found while the app was closed".
- **Pipeline view:**
  - a timeline per frame: capture → download → gate → understand → decide (chime) → generate → render;
  - click a frame to see the page quad, regions and figures drawn over the photo, the Gemini JSON, and the generated code, validation result and smoke-test screenshot.
- **has camera / dark:** test the "no camera" state and the dark theme.

`server/scripts/drive-harness.ts` drives the same flow headlessly with Playwright and takes screenshots.

## If things look stale or start failing after code changes

- `bun --hot` sometimes misses a change to a file outside `harness/`. While I was building this, it kept serving an old `miniapp/src/ui/explore.ts`, which left the phone running a mix of old and new modules.
- If the phone behaves oddly after edits: restart `bun run dev`, then hard-reload the tab.
- Check that only one server is listening on 8787: `lsof -i:8787 -sTCP:LISTEN`. A stale server keeps answering when a restart fails with `EADDRINUSE`.
- Every explore reports to the server log, so a failure always leaves a trace there:
  - `render <ms>` when it worked;
  - `render-FAIL <reason> <errors>` when it didn't.
- The "Couldn't animate this one" card also shows the last error.
