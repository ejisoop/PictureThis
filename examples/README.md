# Example visualizations

These are the four reference modules, written against the runtime contract (`runtime/API.md`). They serve as:
- the **few-shot examples** in Gemini's code-generation prompt;
- **templates** for figures that depict exactly one of these systems (`TEMPLATE_MATCH=1`);
- seeds for the cache.

| file | origin | choreography |
|---|---|---|
| `pendulum.js` | ported from the demo's `chapters/pendulum.js` | `popUp` + graph board |
| `magnet.js` | ported from `chapters/magnet.js` | `riseFromPage` + traced field lines |
| `surface.js` | ported from `chapters/surface.js` | `riseFromPage` + `lp.surface` |
| `projectile.js` | **new**: the reference only had a text-only history chapter | `popUp` + graph board |

Smoke-test one (headless Chromium, the same check generated code gets):

```bash
cd server && bun scripts/smoke.ts ../examples/pendulum.js "../evals/pages/<page>.png" 0.1,0.6,0.9,0.95
```
