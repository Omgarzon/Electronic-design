# B0GOTA · PMB-1.3 — Structural inspection payload

An interactive 3D showcase for the **PMB-1.3** dual-sensor structural inspection payload,
published as a static site on GitHub Pages.

**Live site → <https://omgarzon.github.io/Electronic-design/>**

The page is plain HTML, CSS and ES modules — no bundler, no framework, no CDN. Three.js,
the fonts and the optimized models are committed to the repository, so the deployed site
works offline-first and never depends on a third-party host.

---

## What's in here

| Path | What it is |
| --- | --- |
| `index.html` | The single page: hero with the live 3D stage, mission, payload, specifications, model downloads |
| `game.html` | **Inspection Run** — the mixed-reality flight game (menu, HUD, joysticks, debrief) |
| `404.html` | Styled not-found page, resolved from any deploy path |
| `styles/main.css` | Design system, layout and responsive rules |
| `styles/game.css` | Standalone stylesheet for the game UI |
| `src/main.js` | Navigation, reveals, tabs, annotation UI and dock wiring (no Three.js) |
| `src/viewer.js` | The Three.js scene: lighting, shadows, turntable floor, camera framing, snapshots |
| `src/annotations.js` | Callout data for the four model annotations |
| `src/game/` | The game: flight model, drone rig, inspection course, WebXR session, HUD, audio |
| `assets/models/*.glb` | Web builds of the model — meshopt + quantization + WebP (24.6 MB → 3.1 MB) |
| `assets/vendor/three/` | Three.js r186 core and the four addons the viewer uses |
| `assets/fonts/` | Self-hosted Space Grotesk and Inter variables (SIL OFL) |
| `assets/img/` | Poster render, card renders, social card, icons |
| `base_basic_pbr.glb`, `base_basic_shaded.glb` | The original, untouched Blender exports |
| `imagen_prototipo.jpeg` | Prototype photograph used in the mission section |
| `scripts/` | Dev server, build, asset vendoring and model optimization |
| `.github/workflows/pages.yml` | The GitHub Pages deployment workflow |

---

## Running it locally

The page loads ES modules and `.glb` files, so it must be served over HTTP —
opening `index.html` from the file system will not work.

```bash
npm install      # only needed for the dev tooling; the site itself has no runtime deps
npm run dev      # → http://localhost:4173
```

Other scripts:

```bash
npm run build    # assemble the publishable site into ./_site
npm run preview  # serve ./_site exactly as Pages will
npm run vendor   # re-copy Three.js addons + fonts from node_modules
npm run optimize # regenerate assets/models from the original .glb exports
```

---

## Deploying to GitHub Pages

The workflow in `.github/workflows/pages.yml` builds `_site` and deploys it on every push
to `main`. To switch it on **once**:

1. Push this repository to GitHub (branch `main`).
2. Open **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **GitHub Actions**.
4. Push to `main` (or run the workflow manually from the **Actions** tab).

The site then lives at `https://<owner>.github.io/<repo>/`, e.g.
<https://omgarzon.github.io/Electronic-design/>.

> **Pages source.** `deploy-pages` needs **Settings → Pages → Source = "GitHub Actions"**.
> The deploy job holds `pages: write`, so it flips that setting itself on its first run.
> If the token cannot, it logs a warning naming the toggle and skips instead of failing —
> and the branch build keeps serving the site in the meantime (`_config.yml` keeps the
> 45 MB source exports and the tooling out of that build, so even that mode publishes a
> lean ~9 MB site).

Everything is relative to the page (`./src/main.js`, `assets/...`, `./assets/vendor/...`),
so it works identically at a project path, a user site root, or a custom domain. No `base`
tag or path configuration is needed. The `404.html` page resolves the correct root from
`location.pathname` at runtime.

### Notes for the deployment

- `.nojekyll` is written into `_site`, so Pages serves the files untouched.
- The original 45 MB of source `.glb` exports are **not** published; only the 3.1 MB and
  2.9 MB web builds are copied into `_site`.
- The workflow verifies that `assets/vendor` and `assets/fonts` still match
  `package-lock.json` (`npm run vendor` + `git diff --exit-code`), so the checked-in
  copies can't drift silently.

---

## Inspection Run — the mixed-reality game

**Play it → <https://omgarzon.github.io/Electronic-design/game.html>**

`game.html` is an interactive merged-reality flight game built around the same
PMB-1.3 airframe. The drone reacts both to the pilot and to the virtual
environment: gusts push it off course, walls and rubble are solid, the gimbal
locks onto cracks inside its sensor cone, and the pack drains with the work.

### True scale, no rescaling

The GLB is authored in metres (measured bounding box **1.869 × 0.770 × 1.577 m**),
and the game never scales it. The whole course shares that metre grid: a 1 m
ground grid, a **1.70 m human reference figure**, a **2.10 × 0.90 m doorway**,
2.4 m gate openings sized against the 1.87 m prop-tip span, and a live HUD scale
bar derived from the camera projection. In WebXR the course is placed with a
hit-test at real 1:1 scale, so the drone occupies the same volume in the room
that it would on site.

### Two ways to play

- **Simulator** — full damaged-structure yard in the browser: five cracks to
  grade (two visible only through the thermal core), three fly-through gates,
  a gust can, collisions, hull and battery state, and an RTH autopilot.
- **Mixed reality (WebXR `immersive-ar`)** — on an ARCore phone, tap a real
  floor to place a room-sized course (3.2 m flight radius, 3 m ceiling) and fly
  the same physics through camera passthrough. Unsupported devices fall back
  to the simulator automatically.

### Drone mechanics

- Attitude-mode quadcopter dynamics in `src/game/flight-model.js` (pure,
  framework-free math, unit-exercised in Node): collective thrust against
  9.81 m/s² gravity, rate-limited pitch/roll self-levelling, yaw rate, drag,
  ground contact and per-rotor RPM.
- Four rotor blur discs on the real motor masts, ground-effect wash ring, and
  a three-axis gimbal rig that counter-rotates to hold a world-frame lock while
  the airframe tilts — the stabilization the payload advertises.
- Dual-sensor scanning: hold the reticle on a crack inside range, inside the
  sensor cone, below the steadiness speed limit; thermal cracks require the
  radiometric core. A simulated 48 MP / 640 × 512 feed runs in the HUD PIP.
- Battery budget with a 20 % automatic RTH, dead-stick falls, hard-landing and
  collision damage, plus a score/grade debrief.

### Controls

| Input | Action |
| --- | --- |
| `W`/`S` or `↑`/`↓` | Pitch forward / back |
| `A`/`D` or `←`/`→` | Yaw |
| `Space` / `C` | Climb / descend |
| `Q` / `E` | Strafe |
| `Shift` | Brake / hover |
| `F` (hold) | Scan with the selected sensor |
| `T` · `H` · `Enter` · `P` · `M` | Thermal · RTH · takeoff/land · pause · mute |
| Touch | Left stick climb/yaw, right stick pitch/roll, on-screen action buttons |
| Mouse | Drag to orbit the chase camera, scroll to zoom |

The game modules live in `src/game/`:

| File | Responsibility |
| --- | --- |
| `config.js` | Measured drone dimensions, flight envelope, sensor and scoring constants |
| `flight-model.js` | Pure flight physics, sphere/box collision, gimbal line-of-sight |
| `drone.js` | GLB rig: tilt pivot, rotor discs, stabilized gimbal, sensor beam |
| `world.js` | Procedural metre-scale course, crack targets, gates, gusts, colliders |
| `textures.js` | Seeded canvas textures (concrete, crack decals, rotor blur, pad, labels) |
| `input.js` | Keyboard and dual virtual joysticks with an edge-action queue |
| `hud.js` | Telemetry, artificial horizon, reticle, sensor PIP, minimap, scale bar |
| `audio.js` | Synthesized rotor bed (RPM-coupled) and mission sound effects |
| `ar.js` | WebXR session, hit-test source and placement reticle |
| `game.js` | State machine, mission loop, scanning, collisions, autopilot, scoring |
| `main.js` | Bootstrap, mode selection and screen flow |

## The 3D stage

- **Lazy loaded.** Three.js (~2 MB) is imported only after the page has painted and the
  window has loaded; the hero shows a rendered poster until the scene is ready.
- **Precise framing.** The camera radius is solved by projecting the model's bounding-box
  corners and iterating until the silhouette fits the safe area, so no rotor is ever
  clipped at any aspect ratio.
- **Honest progress.** The dock reports real download progress from the glTF loader.
- **Respectful of resources.** Rendering pauses when the tab or the stage is off screen,
  the second material set is prefetched only when idle, and pixel ratio is capped at 2.
- **Graceful degradation.** No WebGL, a lost context, or a software rasteriser (SwiftShader,
  llvmpipe) falls back to the rendered poster and keeps the page fully usable.
- **Accessible controls.** Every dock action is a real button with an accessible name and
  `aria-pressed` state; the canvas is keyboard-orbitable with the arrow keys; `Esc` leaves
  focus mode; annotations are keyboard reachable and dismissible.

### Controls

| Input | Action |
| --- | --- |
| Drag / one-finger drag | Orbit |
| Scroll / pinch | Zoom |
| `F` or `Esc` | Enter / leave focus mode |
| `M` | Switch material set (PBR ↔ baked) |
| `N` | Toggle annotations |
| `A` | Toggle auto-rotate |
| `R` | Reset the view |
| Arrow keys, `+` / `-`, `0` | Orbit, zoom and re-frame the focused canvas |

### Deep links

The stage accepts URL parameters, useful for sharing a specific look:

| Parameter | Values | Meaning |
| --- | --- | --- |
| `m` | `pbr`, `baked` | Material set to load first |
| `n` | `1`, `0` | Annotations on / off |
| `a` | `1`, `0` | Auto-rotate on / off |
| `3d` | `on`, `off`, `auto` | Force the live view, force the still, or decide automatically |

Examples: `?m=baked`, `?n=0&a=0` (a clean poster shot), `?3d=off`.

---

## The model

Both web builds come from the same 394 534-triangle mesh, exported from Blender 4.3.

| | Original | Web build | Reduction |
| --- | --- | --- | --- |
| PBR (base colour, metallic–roughness, normal) | 24.57 MB | 3.23 MB | 87 % |
| Baked lighting (single emissive texture) | 19.15 MB | 3.03 MB | 84 % |

Compression: `EXT_meshopt_compression`, `KHR_mesh_quantization`, and WebP textures at
2048 px. Loading them requires the meshopt decoder:

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const { scene } = await loader.loadAsync('assets/models/drone-pbr.glb');
```

---

## Design notes

- **Palette** — near-black base (`#06090d`), cool grey type, a single mint accent
  (`#4ff0c0`) reserved for interactive and measured values.
- **Type** — Space Grotesk for display and UI, Inter for body copy, both self-hosted and
  subset to Latin.
- **Motion** — reveals, counters and the ticker all respect `prefers-reduced-motion`.
- **Content** — the specification figures describe the concept shown in the model and are
  labelled as reference values on the page itself.

## Licences

- Site code: MIT.
- Three.js: MIT — see `assets/vendor/three/LICENSE`.
- Space Grotesk, Inter: SIL Open Font License 1.1 — see `assets/fonts/`.
- The 3D model and prototype photograph belong to the repository owner.
