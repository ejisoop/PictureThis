# @lp/server: Living Pages API

The server is Bun + Hono. It holds the Gemini key and does what the glasses and the miniapp background can't:
- frame gating
- page understanding
- code generation
- validation and repair
- the shared cache

```bash
cp .env.example .env   # add GEMINI_API_KEY
bun run dev            # http://localhost:8787
```

| route | purpose |
|---|---|
| `POST /v1/frames` `{photoUrl, sessionId, ts, reason}` | Downloads the frame, then runs the blur check (Laplacian variance), the dHash comparison and the stability check. Calls Gemini only when the page changed and has held still for 2 frames, or immediately on a button press. Returns `discovery`, `nothing`, `already`, `waiting`, `blurry`, `unchanged` or `no-page`. |
| `POST /v1/visualizations` `{discoveryId, force?, noTemplate?}` | Cache first, then template, then generation. Returns `viz` immediately on a hit, otherwise the SSE URL. |
| `GET /v1/visualizations/events?key=` | SSE stream: `progress` events, then `done` or `failed`. |
| `GET /v1/discoveries/:id(/photo.jpg)` | A stored discovery and its page photo (cropped to the page). This is the only image data the server keeps. |
| `POST /v1/uploads` | Dev only: a stand-in for Mentra's signed photo URLs (memory only, 30 min TTL). |
| `POST /v1/understand` | Dev and evals: page understanding without gating. |
| `GET /v1/stats` | Latency per stage over the last 24 h. Every stage is also logged to the console and to SQLite. |

## Pipeline

1. **Gate** (`src/gate.ts`): blur check plus a 64-bit dHash per session.
2. **Understand** (`src/understand.ts`): one structured-output call. Boxes come back in Gemini's native `[ymin, xmin, ymax, xmax]` 0–1000 format and are mapped to page coordinates through the inverse homography of `pageCorners`. The page key is a hash of the page number and heading (or heading and excerpt); see `pageKeyOf`.
3. **Decide**: discoveries are figures with `visualizable ≥ 0.75`. Generation starts immediately, before the student even opens the phone.
4. **Generate** (`src/generate.ts`):
   - the system prompt (`src/prompts/codegen.ts`) is `runtime/API.md` plus the rules plus the four examples;
   - the input is the figure crop plus the page-understanding JSON;
   - Gemini returns JSON `{title, summary, controls, code}`.
5. **Validate**:
   - `src/validate/static.ts`: acorn parse, module-contract shape, deny-listed identifiers;
   - `src/validate/smoke.ts`: Playwright and Chromium with SwiftShader WebGL, using the same srcdoc and CSP as the phone. It runs the lift-off, 120 frames plus 3 s of settling, and asserts no exceptions, no NaN transforms or vertices, at least one mesh and declared controls. It saves a screenshot.
   - On failure, up to 2 repair rounds feed the errors back to Gemini.
6. **Cache** (`src/cache.ts`): SQLite, keyed by `pageKey|figureId|runtimeVersion`. Failed attempts are stored for the developer view but never served.

The first smoke test launches Chromium, which takes about 1 s; later ones take about 2.5–4.5 s. Run `bunx playwright install chromium` once.
