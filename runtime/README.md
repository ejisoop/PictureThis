# @lp/runtime: the Sketchbook runtime

Every visualization runs on this runtime. It owns the camera, the student's page photo, the art style and the lift-off choreography. Generated code only builds content through `lp`, so whatever Gemini writes looks like the concept demo.

- **`API.md`** — the API reference. It is also pasted verbatim into Gemini's system prompt; keep the two in sync.
- **Ported from the demo:**
  - `src/paper.js`, `src/sketch.js`, `src/ui.js` (v1 JS, unchanged)
  - `src/stage.ts`: the phone stage plus the page shader. The colour wash, ghost and corner marks are now derived from the photo.
- **New:**
  - `src/lp.ts`: the `lp` object
  - `src/choreo.ts`: `popUp`, `riseFromPage`, `unfold`, `drawOn`
  - `src/board.ts`: the graph-paper card
  - `src/math.ts`: RK4, surfaces, fields and streamlines
  - `src/geom.ts`: the homography used to flatten the photo
- `src/entry.ts` runs inside the sandbox iframe. It contains:
  - the message protocol (`src/protocol.ts`)
  - the error capture
  - the heartbeat for the host's watchdog
  - the deterministic smoke-test hook
- **`src/host/`** is used by the UI, the harness and the server:
  - `SandboxHost` creates the `<iframe sandbox="allow-scripts">` with a `srcdoc` CSP, decodes the photo and hands it over as an `ImageBitmap`, and runs the watchdog.
  - `renderPanel` builds the paper control strip.
  - `sanitizeLabel` cleans control labels.

## Build

```bash
bun run build      # → dist/bundle.ts (minified IIFE + CSS with inlined fonts, ~1.1 MB)
```

Rebuild after any change under `src/` except `src/host/`. Bump `RUNTIME_VERSION` in `src/protocol.ts` whenever the `lp` API changes behaviour: it is part of the cache key.

## Sandbox

- The iframe has an opaque origin: `sandbox="allow-scripts"`, without `allow-same-origin`.
- CSP: `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; img-src data: blob:`.
  - This goes beyond the original spec, which allowed only `script-src`. The extra inline style, `data:` fonts and blob/data images are needed for handwritten notes and fonts. Network access stays at none.
- The module, the runtime and the fonts are all inlined. The page photo arrives by `postMessage`.
- Everything coming out of the iframe is untrusted: the host clamps message sizes and sanitises HTML labels.
