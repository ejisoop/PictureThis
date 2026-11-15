# PictureThis

A Mentra miniapp for **Mentra Live**, camera glasses with no display:
1. While a student reads a textbook, the glasses notice a figure that can be brought to life and chime.
2. Gemini writes a Three.js visualization for it against our Sketchbook runtime.
3. On the phone, the student's own page photo flattens, and the figure lifts off it as an interactive 3D model in the concept demo's pencil-and-watercolour style.

```
miniapp/   Mentra miniapp: background capture loop + React UI (scaffolded with create-mentra-miniapp@beta)
runtime/   Sketchbook runtime: lp API, art style, choreography, sandbox host  (API.md = the contract)
server/    Bun + Hono: gating, Gemini page understanding + code generation, validation, repair, SQLite cache
examples/  pendulum, magnet, surface (ported from the demo) + projectile (new): few-shot examples + templates
harness/   browser harness: the real background + UI against a mock session, photo sources, pipeline view
evals/     page photos + scripts for understanding and end-to-end evals
reference/ the concept demo (source of the style; not built)
```

## Quick start

```bash
bun install
bunx playwright install chromium          # headless WebGL smoke tests
cp server/.env.example server/.env        # add GEMINI_API_KEY
bun run build:runtime
bun run dev:server                        # :8787
bun run dev:harness                       # :5173: pick an eval page, tap the glasses button
```

To use real glasses, see `miniapp/README.md` (`bun dev` and scan the QR code).

## Phase 1 spike results (2026-11-14)

### Page understanding (Gemini vision, 10 textbook pages)

| setting | latency per page | notes |
|---|---|---|
| `gemini-3.8-flash`, thinking LOW, first prompt (asked for OCR text) | 13–31 s | 2/10 failed with `RECITATION` (the model refused to repeat textbook text verbatim); ~1.9k output tokens |
| `gemini-3.8-flash`, short summaries instead of transcription | **6–9 s** | no recitation failures |
| `gemini-3.5-flash-lite`, same prompt | **2.2–3.2 s** | figure decisions essentially the same as Flash on these pages |
| thinking MINIMAL | n/a | rejected by `gemini-3.8-flash` |

- **Model choice:** only Flash-Lite meets the chime target. Time from photo to decision through `/v1/frames` was p50 2.8 s, p90 3.2 s. Following the spec, the default stays the stable Flash model; set `GEMINI_VISION_MODEL=gemini-3.5-flash-lite` (see `server/.env.example`).
- **Output cap:** one Flash-Lite call looped until `MAX_TOKENS` (112 s). Understanding calls are now capped at 4k output tokens with a 25 s timeout and one retry.

### Code generation (`gemini-3.8-flash`, thinking LOW, 7 figures across 10 pages, templates off)

- **Validated:** 7/7 passed static and headless checks, 6/7 on the first try. One `ReferenceError` was fixed by the repair loop.
- **Time:** about 31 s of Gemini per attempt for a single job; 36 s including the smoke test. With 5 jobs running concurrently: p50 43 s, p90 61 s. This is well over the 15 s target.
  - **Why:** output length. The modules run to 300–600 lines (6–10k tokens), and the prompt now asks for 150–300.
  - **Mitigations already in place:**
    - generation starts at discovery time, before the student opens the phone;
    - progress streams to the UI;
    - repeat pages are instant from the cache;
    - known systems are instant from templates.
- **Quality:**
  - Every result was recognisably the right system, on-palette, with ink outlines and handwritten labels, lifting off the right spot.
  - Several were sparse or small in frame. The camera framing has been tightened since; the next lever is prompt and examples work (Phase 3/5).

### On-device spikes (need a phone and glasses: please run these)

1. Open Living Pages on the phone → Settings → Developer → **device check**.
   - It reports WebGL1/2 support, the GPU, and whether the sandboxed `srcdoc` iframe starts the runtime and renders, with fps.
   - In headless Chromium it reports WebGL2, sandbox OK, 53 fps (SwiftShader).
   - It also shows `takePhoto` latency (capture plus upload): p50, p90 and last, over 20 frames.
2. For battery cost, scan for 10–15 minutes at 2 s and note the glasses battery before and after in the Mentra App. The SDK exposes no battery reading that the UI can show.
3. Check that both work on **iOS and Android**.

## Status by phase

1. **Spikes:**
   - Gemini latency and quality: measured (above).
   - WebView, WebGL and srcdoc: tooling ready (the device check); not yet run on a phone.
   - `takePhoto` and battery: tooling ready; not yet measured.
2. **Runtime + examples:** done. The `lp` runtime (`runtime/API.md`) and the 4 examples run in the sandbox in the harness and in the headless smoke test.
3. **Server:** done.
   - gating, understanding, generation, static and headless validation, repair, cache, SSE and per-stage latency logs
   - template matching for known systems
4. **Miniapp:** code complete.
   - capture loop, button, chime and voice, queue and replay, the UI flow and the dev tools
   - builds with the Mentra CLI's `build.ts` and runs end to end in the harness
   - **not yet run on a real phone with Mentra Live**
5. **Evals:** scripts done.
   - only 10 pages so far (the target is 30+)
   - `evals/expected.json` labels are needed to score detection precision and recall

## Known gaps and next steps

- **Generation latency, 30–60 s against a 15 s target.** Options:
  - smaller modules;
  - streaming the code and validating as it arrives;
  - a faster code model (try `GEMINI_CODE_MODEL=gemini-3.5-flash-lite` with the eval script);
  - more templates.
- **Eval pages are screenshots, not glasses photos.** The perspective flattening (`pageCorners` → homography) has only been exercised on full-frame pages so far.
- **`pageKey` stability across different photos of the same page** has not been measured. It hashes page number and heading, which Flash-Lite often can't read on screenshots without page numbers.
- **The camera framing in explore mode** still needs tuning per figure aspect.
