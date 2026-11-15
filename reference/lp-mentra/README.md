# Living Pages for Mentra Live — concept demo

A browser simulation of the Living Pages idea on **displayless camera glasses**. The glasses keep an eye on the textbook page. When they spot a figure that can be brought to life, they chime, and the student's own page comes alive on their phone inside a Mentra miniapp.

Nothing here talks to real hardware. The glasses, the recognition pipeline and the Mentra host are all simulated. The code is laid out like a real MentraOS miniapp so the miniapp part can be ported to the real SDK.

## Run

```bash
npm install
npm run dev      # local dev server
npm run build    # dist/index.html, one self-contained file
```

## Using it

- **Look around:** move the mouse over the camera view. Scroll to lean in or out.
- **Turn pages:** use the page tabs on the book, the ‹ › buttons, or the ← → keys.
- **Glasses button:**
  - tap it (or press C) to look now
  - hold it to pause or resume scanning
- **"Hey Mentra, explain this":** forces an immediate look at the page.
- **On the phone:**
  - drag the bob, compass or yellow point to move them
  - drag anywhere else to orbit
  - pinch or scroll to zoom
  - double-tap to reset the view
  - ✕ in the capsule closes the miniapp. Anything found while it's closed is replayed when you reopen it.
- **Play guided demo:** an ~80 s scripted tour with pause and speed controls.
- **Settings → Developer:**
  - show or hide the pipeline view
  - switch to the mocked generated-video renderer

## Layout

| Folder | Role |
|---|---|
| `src/background/` | Miniapp background layer (no DOM). Runs the capture loop, frame gating, pipeline calls, confidence and temporal decisions, de-duplication, the queue for when the UI is closed, and audio cues. |
| `src/ui/` | Miniapp UI layer (React in the phone WebView). Holds the home screen, the discovery toast, the explore screen with the bottom sheet, history and settings. `ui/renderers.ts` contains `Interactive3DRenderer` (used), plus `GeneratedVideoRenderer` and `HybridRenderer` (stubs). |
| `src/shared/` | Shared types (`Detection`, `Photo`, …) and the typed channel registry. |
| `src/services/` | Service interfaces and mock implementations: the recognition pipeline, the visualization registry, and video generation (`buildVideoPrompt` plus a mock provider). |
| `src/mentra/mock.ts` | A small stand-in for the MentraOS SDK. Provides `registerMiniapp(session)` (camera, input, transcription, speaker, `ui.send/on/handle/onOpen`) and `mentra.send/on/request/ready`. |
| `src/harness/` | Everything that isn't the miniapp: the simulated glasses (camera feed, head model, capture, ground truth), the speaker, the pipeline HUD, the phone frame and Mentra host, and the guided demo. |
| `src/viz/` | The v1 textbook, page rendering and the three visualizations, decoupled from the book through a page anchor. |

## How detection is simulated

Each still is a real render from the glasses camera. The mock pipeline uses the camera pose stored with each photo to decide what was actually visible:

- **Frame gating:** frames are skipped for motion blur, an oblique angle, no page in view, or a page mid-turn.
- **Flattening:** the right-hand page is flattened out of the photo, following the page's curve.
- **Confidence:** each printed region is scored from how much of it is in view, how large it appears, the viewing angle and head motion.
- **Matching:** regions are matched against the registry.

A concept is delivered when its confidence is at least 0.8 on two consecutive frames (one frame for a button press or voice request), and only once per page.
