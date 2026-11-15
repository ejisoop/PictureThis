# Evals

- `pages/`: page photos (currently 10 textbook screenshots; the target is 30+ across physics and calculus, ideally real glasses photos).
- `scripts/understand.ts`: page understanding only. Records latency, figures and scores, and draws an overlay PNG per page.
- `scripts/pipeline.ts`: end to end through `/v1/frames` with a forced look, then generation over SSE. Reports time to decision (chime), validation pass rate, first-try pass rate and generation time. Scores detection precision and recall against `expected.json`.

```bash
bun evals/scripts/understand.ts
bun evals/scripts/pipeline.ts --concurrency 4 [--regenerate] [--only 17:12]
# for genuine generation (no templates), run the server with TEMPLATE_MATCH=0
```

Results go to `results/<run>/`: `report.md`, `results.json`, screenshots and the generated code.

**Labels.** Copy `expected.example.json` to `expected.json` and fill in `visualizable` (true/false) by hand for each page. These ground-truth labels are what precision and recall are scored against. They have deliberately not been pre-filled.
