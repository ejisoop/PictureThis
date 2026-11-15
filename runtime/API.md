# Sketchbook runtime — API for visualization modules (runtime 1.0.0)

A visualization is one plain-JavaScript module. It runs in a sandbox with no network and no DOM access. Everything comes from `lp`.

## Module contract

```js
export default function create(lp, ctx) {
  // build the scene here
  return {
    root,          // THREE.Object3D: normally the group from lp.figure.frame(...)
    enter(tl) {},  // add the lift-off animation to tl (a GSAP timeline starting at 0)
    exit(tl) {},   // add the fold-back animation to tl
    update(dt, t) {}, // called every frame; dt in seconds (≤ 0.05), t = time since load
    dispose() {},  // free anything the runtime doesn't own (usually empty)
    view: { lift: 0.4, polar: 0.92, azimuth: 0.15, zoom: 1 }, // optional camera framing for explore mode
  };
}
```

- The module may contain helper functions and constants above or inside `create`. There must be **no imports and no other exports**.
- `ctx` holds:
  - `figure: { rect: {x0,y0,x1,y1}, description, concept, subject }`. `rect` is the figure's box in normalised page coordinates.
  - `params`: numbers read from the page, e.g. `{ L: { value: 1.6, unit: 'm' } }`.
  - `equations`: LaTeX strings from the page.
  - `page: { number, heading }`.
- These identifiers are **forbidden**, and the validator rejects any module that uses them: `fetch`, `XMLHttpRequest`, `WebSocket`, `eval`, `Function`, `import()`, `document`, `window`, `globalThis`, `self`, `parent`, `top`, `localStorage`, `indexedDB`, `navigator`, `postMessage`, `setInterval`, `requestAnimationFrame`.
  - For animation, use `update(dt)` or `lp.gsap`.
  - For a drawing canvas, use `lp.board`.

## World and page coordinates

- The student's page photo lies flat in the x/z plane. y points up, off the paper.
- **`lp.page`**
  - `{ W, H, point(x, z, lift), uv(u, v, lift), group }`
  - x runs 0…W from the left edge of the page; z runs −H/2…H/2 from top to bottom; H = 2.8.
  - `uv(u, v)` takes normalised page coordinates (u right, v down, 0…1).
- **`lp.figure`**
  - `{ x0, z0, w, h, cx, cz, rect, description, point(u, v, lift), frame(designW, designH) }` — the printed figure in world units.
  - **`lp.figure.frame(designW, designH)`** is how every module starts. It returns a `THREE.Group` that is already in the scene:
    - centred on the figure, lying on the page;
    - scaled so that a design of `designW × designH` units fills the figure;
    - local axes: x right, y up off the page, z down the page.
  - Build at a fixed design size (e.g. 2.0 × 1.5) inside this group. The visual then originates exactly from the printed drawing, whatever the photo.

## Palette and materials

- **`lp.palette`** — the only colours to use:
  - ivory `#f7f0e1`, ink `#2f2b26`, graphite `#5a5650`, sepia `#8a6a4a`
  - sage `#9fb79a`, sageDeep `#6f8f6c`
  - blue / dustyBlue `#9db7cf`, blueDeep `#6b8fb3`
  - peach `#f2b8a0`, coral `#e8907e`, coralDeep `#c96a5a`
  - lavender `#c4b5dc`, lavenderDeep `#8f7db5`, yellow `#f1d68c`
- Wherever a colour is accepted, you can pass a palette key (`'coral'`) or a hex string.
- **`lp.sketch(color, { hatch = 1, opacity = 1, emissive = 0.22, doubleSide = false })`**
  - The standard material for solid objects: watercolour wash plus screen-space pencil hatching in the shadows.
  - Has `.userData.uniforms.uHighlight` (0…1) for a warm hover glow. `lp.draggable` animates it automatically.
- **`lp.outline(mesh, thickness = 0.008)`** — ink outline (inverted hull) for curved shapes: spheres, cylinders, tori.
- **`lp.edges(mesh, { width = 1.6, opacity = 0.9, threshold = 30, color })`** — ink edges for hard-edged shapes such as boxes. Call it once per mesh, after positioning the mesh.
- **Shadows:** set `mesh.castShadow = true` on solid objects so they cast soft shadows on the page.
- Plain `lp.THREE` materials (`MeshBasicMaterial`, etc.) are allowed for thin strings, dots and tiny details.

## Ink lines and arrows

- **`lp.ink(points, opts)`** — a drawable ink line (thin tube).
  - `points`: `THREE.Vector3[]` or `[x, y, z][]`, at least 2.
  - Options: `{ color = ink, color2, tailFade = 0, radius = 0.005, dashed = false, dashCount = 30, opacity = 1, progress = 1, closed = false, jitter = 0, flow = 0 }`.
  - `color2` fades the line from `color` to `color2` along its length; `tailFade` (0…1) fades out both ends.
  - Returns a `Mesh`. `mesh.material.uniforms.uProgress.value` (0…1) draws it on.
  - With `dashed: true`, `uniforms.uTime` plus `flow` animates the dashes.
  - **Rebuilding:** to change the shape, remove it, call `lp.dispose(mesh)`, and create a new one, at most every few frames. Prefer moving or scaling existing objects.
- **`lp.canvasTexture(w, h)`** → `{ canvas, ctx, texture, refresh() }`: a 2D canvas you can draw on (pole letters, dial faces, labels printed on objects) and use as `map` on a material. Call `refresh()` after drawing.
- **Arrows**
  - `lp.arrow(color, { radius = 0.008, head = 0.07, headR = 0.028 })` returns a group.
  - `lp.setArrow(arrow, origin: Vector3, dir: Vector3, length)` positions it. Coordinates are in the arrow's parent.
  - `lp.arrow(color, { dashed: true, dashCount = 7 })` gives a dashed shaft, for vector components.
  - Hide very short arrows: `arrow.visible = length > 0.03`.

## Handwritten notes

- **`lp.note(html, { kind = 'label', color, anchor = 'center', at })`** — a Caveat-handwriting note.
  - `kind: 'label'` (default): a small note pinned in 3D. Add it to a group (`group.add(note)`) and position it with `note.position.set(x, y, z)` or `at: Vector3`.
  - `kind: 'readout'`: like `label`, for live values.
  - `kind: 'equation'`: goes in the **margin strip** at the top of the phone, not in 3D. Don't add it to the scene. Use it for the governing equations and derived live values, e.g. `T = 2π√(L/g) ≈ 2.54 s`.
  - `color`: one of `'coral' | 'blue' | 'sepia' | 'sage' | 'lavender'`, or omit for graphite/ink.
- Methods:
  - `note.set(html)` updates the text; cheap if unchanged, so it can be called every frame.
  - `note.reveal(delay = 0, duration = 0.7)` writes the note on from left to right. Notes start hidden; reveal them at the end of `enter`.
  - `note.hide(delay = 0)`, and `note.element.style.visibility = 'hidden'` to toggle quickly.
- Allowed HTML: `<i>`, `<b>`, `<sub>`, `<sup>`. Unicode symbols are preferred: θ ω ∇ √ ≈ · ² ₀.

## Choreography

- `in` is the group to attach to, normally the frame from `lp.figure.frame(...)`. `at` is in that group's coordinates.
- Opacity: presets fade content in by scaling each material's opacity as it was **when the preset was created**. Set custom opacities before calling the preset.
- Every preset wraps content and returns `{ group, inner, state, apply, enter(tl, at = 0), exit(tl, at = 0) }`. `enter` and `exit` return the time their motion ends.
- The runtime runs its own sequence around them: colour wash spreading over the printed figure, then camera move, then a ghost left on the page.
- **`lp.choreo.popUp(content, { in: frame, at: [x, z], lean = 0.06 })`** — pop-up-book fold.
  - Author `content` **standing up**: x right, y up off the page, z toward the reader.
  - It starts flat over the printed drawing, hinged at `at` in parent (frame) coordinates, which is usually the bottom edge of the drawing: `[cx, +designH/2 − margin]`.
  - On enter it draws on (0.9 s), gains depth (0.6 s), then lifts upright with a bounce (1.2 s). Ends at `at + 2.2`.
  - Use it for side-view diagrams: pendulums, inclines, circuits, trajectories, waves.
- **`lp.choreo.riseFromPage(content, { in: frame, at: [x, z], height = 0 })`** — grows straight up out of the page.
  - Author `content` **in page space**: x right, y up, z down the page.
  - Ends at `at + 2.05`.
  - Use it for top-view figures: field maps, contour plots, surfaces, vector fields, molecules.
- **`lp.choreo.unfold(content, { in: frame, at, lean = 0.1 })`** — like `popUp`, but also opens out sideways from its centre line.
- **`lp.choreo.drawOn(inkMeshes, { stagger = 0.12, duration = 0.9 })`** — draws ink lines on one after another. Lines given to `drawOn` are excluded from the preset's own draw-on.
- **`lp.board({ in: frame, at: [x, z], size: [w, h], hinge = 'bottom', lean = 0.42, grid = true, px = 1024 })`** — a graph-paper card, like the pendulum's θ(t) plot.
  - It lies flat and folds up like a laptop lid.
  - Drawing: `board.clear()`, then `ax = board.axes({ x: [a, b], y: [c, d], xLabel, yLabel })`, `board.plot(ax, [[x, y], …], { color, width, dash: [10, 8], sketchy })`, `board.dot(ax, x, y, { color, r })`, `board.text(str, px, py, { color, size, align })` (pixel coordinates on a 1024-wide canvas). Finish with `board.refresh()`.
  - Animation: `board.enter(tl, at)` / `board.exit(tl, at)`, and `board.state.open` (0…1).
  - Redraw at most about 30 times a second.
- Typical `enter`:
  ```js
  enter(tl) {
    const end = pop.enter(tl, 0);
    board.enter(tl, 0.35);
    tl.add(() => { notes.a.reveal(0); notes.eq.reveal(0.3); }, end - 0.2);
  },
  exit(tl) {
    tl.add(() => Object.values(notes).forEach((n) => n.hide()), 0);
    board.exit(tl, 0.2);
    pop.exit(tl, 0.4);
  },
  ```
- `lp.gsap` is GSAP 3, if you need custom tweens.
- `lp.opacity(object, a)` fades a whole subtree.

## Maths

- **`lp.ode(rhs, y0)`** — RK4 integrator.
  - `rhs(t, y)` returns dy/dt as an array.
  - `sim.step(dt, substeps = 4)` advances it (dt is clamped to 0.05 s) and returns `sim.y`. Also `sim.t`, and `sim.set(y, t?)`.
- **`lp.surface(fn, { x: [a, b], y: [c, d], res = 64, scale: [sx, sy, sz] })`** — height-field `BufferGeometry` for z = f(x, y).
  - Maths x maps to world x, maths y to world −z (up the page), and f to world y. Centred on the domain.
  - `geometry.userData.update(fn)` recomputes it in place.
- **`lp.vectorField(fn, { x, y, n })`** samples a 2D field `fn(x, y) → [vx, vy]` on a grid and returns `[{ p: [x, y], v: [vx, vy], m }]`.
- **`lp.trace(field, seeds, { step = 0.02, maxSteps = 400, bounds: { x, y }, both = false, minSpeed, stop })`** — streamlines (RK4, unit speed) through a 2D or 3D field from each seed. Returns arrays of points.
- **`lp.param(name, fallback, [min, max]?)`** — a number from `ctx.params` (case-insensitive), clamped. Always use this for page values, with sensible defaults.
- **`lp.util`**: `DEG`, `clamp(v, a, b)`, `lerp(a, b, t)`, `damp(x, target, rate, dt)` (smooth approach, for slider changes), `rng(seed)` (deterministic random).

## Interaction

- **`lp.controls([...])`** declares the controls. The phone renders them in a paper bottom sheet, so call it exactly once, in `create`.
  - `{ type: 'slider', key, label, min, max, step, value, unit?, format?(v) → string, ticks?: [{ v, label }], snap?, onChange(v) }`
  - `{ type: 'toggle', key, label, icon?, value, onChange(on) }`
  - `{ type: 'button', key, label, icon?, onClick() }`. Icons are short glyphs: ▶ ❚❚ ↺ ⛰ ◠ ✦ ⟲.
  - Returns `ui` with `ui.get(key)` (current value), `ui.set(key, value)` (move a slider after a reset) and `ui.label(key, label, icon)` (e.g. play ↔ pause).
  - Labels may use `<i>`, `<sub>`, `<sup>`.
  - Declare 2–5 meaningful controls. Every one must change the visual immediately; ease toward new values with `lp.util.damp`.
- **`lp.draggable(object, { plane = 'page' | 'vertical' | 'screen', space, hitRadius, onStart(p, ray), onDrag(p, ray), onEnd() })`** — touch-drag an object.
  - `p` is the touch point projected onto a plane through the object, in `space`'s coordinates (default: the object's parent).
    - `'page'`: the space's x/z plane.
    - `'vertical'`: its x/y plane.
  - `ray` is the world-space `THREE.Ray` under the finger, for custom hit tests (e.g. `ray.intersectPlane`, or marching along a surface).
  - `hitRadius` adds an invisible, larger grab sphere for small objects.
  - The highlight glow is automatic.
  - One finger elsewhere orbits; pinch zooms; double-tap resets the view.

## Style rules (non-negotiable)

1. **Palette only** (`lp.palette`), with `lp.sketch` materials and ink outlines or edges on solids. No neon, glow, bloom, holograms, gradients, particles or sci-fi looks. No pure black or pure white surfaces.
2. **Handwritten labels** (`lp.note`) for quantities and readouts. Equations go in the margin strip (`kind: 'equation'`).
3. **Origin:** the visual must originate from the figure's location (`lp.figure.frame`). It lifts off the printed drawing using a choreography preset; it never just appears.
4. **Don't hide the page:**
   - Stay within about 1.3× the figure's footprint.
   - Nothing opaque may lie flat over the text around the figure.
   - Boards stand up; they don't lie on the text.
5. **Stay above the paper.** The page photo is an opaque sheet at y = 0, so anything below it is hidden. Every object must have y ≥ 0 once the model has lifted off.
   - Pop-ups: put the hinge at the **bottom** of what you draw; nothing may hang below it.
   - Surfaces and plots with negative values: add a base height (e.g. `riseFromPage(…, { height })`, or offset the geometry) so the lowest point stays above the page.
   - The runtime raises a model that dips below the paper as a safety net, but that detaches it from the printed drawing. Design it to sit on the page.
6. **Sizes:** keep objects comparable to the printed drawing. Typical design sizes: line radius 0.004–0.008, arrows 0.1–0.5 long, balls 0.05–0.1.
7. **Readability:** a few clear objects beat many. Avoid more than about 300 meshes or 200k triangles. Rebuild geometry only when needed.

## Accuracy rules

- Use the governing equations of the figure (from the page when given), with SI units. Integrate dynamics with `lp.ode` (RK4). Never fake motion with keyframes when physics applies.
- Defaults come from the page (`lp.param`). Show the units of every readout.
- State an approximation in a note when you make one (e.g. "small-angle", "no air drag").
- Keep it numerically safe: clamp parameters, guard divisions, never produce NaN. The validator runs 120+ frames and rejects NaN positions.
