# Severed Heaven — Combat Study 001

## Full game planning

The broader direction is a cooperative cultivation RPG about fugitives finding ruined sect grounds and founding their own sect there. See the [game design](docs/GAME_DESIGN.md), [implementation plan](docs/IMPLEMENTATION_PLAN.md), [opening chapter specification](docs/OPENING_CHAPTER.md), and [art direction with the endorsed concept](docs/ART_DIRECTION.md).

The main playable build remains the solo combat study. A separate M1.P3 local two-tab sparring harness now routes commands through `SessionAuthority` and a shared host. It is a transport test with opponent damage rules, not finished cooperative gameplay. Solo `World.step` retains its existing time-dilation behavior. All 101 tests, TypeScript checking, and build pass.

A standalone TypeScript / Canvas 2D cultivation combat vertical slice. Local-only; no accounts, hosted backend, game engine, or runtime dependencies. Node.js 24.13+ recommended (uses Node's built-in TypeScript stripper).

## Run

Open a terminal in this folder:

```powershell
npm install
npm run dev
```

Open http://127.0.0.1:5173. The game starts paused so you can read the controls. Press P or Resume to begin. The server builds once at startup; restart it after source edits. Stop with Ctrl+C. `npm run build` writes a portable static site to `dist/`; serve that folder with any static web server. Do not open index.html as a file URL.

```powershell
npm run check
npm test
npm run build
```

## Local two-player sparring spike

```powershell
npm run spike
```

Open [http://127.0.0.1:5174](http://127.0.0.1:5174) in two tabs and click **Join sparring** in each. Tabs receive separate actors. WASD moves, F/G climbs/descends, mouse aims, held click/1 fires bolts, Q/2 casts a crescent, E/3 casts falling heaven, and Shift dodges. Click the arena to focus controls. Blur/tab switching clears held input. Each tab sees authoritative health, qi, altitude, attacks, and terrain; neither runs local combat simulation.

Click **Leave** to release a seat. Closing a tab normally releases it too; otherwise the lease expires after five seconds. A silent command stream becomes neutral after 250 ms; existing momentum/dodges/attacks finish. Actors remain in the world after leaving; restart the host for a fresh match. The host is loopback-only, with no accounts, external hosting, relay fees, or added dependencies. It does not accept LAN/internet clients.

The dedicated page uses a simple overhead test view, independent of the original combat renderer and browser saves. HTTP polling intentionally exposes visible latency and may miss brief effects. M1.P4 now supplies versioned full join snapshots and ordered, acknowledged terrain deltas, bounded to 256 cells and 64 KiB per page. A join rebuilds all 16,384 cells before enabling input; completed terrain transfers apply atomically. Lost responses retry safely, and a sequence/revision gap starts a fresh snapshot. Input receipts show accepted and consumed sequence high-water marks, not guaranteed cast success. M1.P5 adds immediate local movement/climb prediction with bounded reconciliation, 200 ms remote interpolation, and independent live actor frames during terrain paging. Damage/resources/casts and new dodge onset remain authoritative; prediction pauses after 250 ms without live state. Durable reconnect is not implemented. Team/friendly-fire rules remain open; the two actors can damage each other. See the [M1.P3 transport handoff](docs/phases/M1.P3-local-transport.md) [M1.P4 replication contract](docs/phases/M1.P4-state-replication.md), and [M1.P5 measurements and limits](docs/phases/M1.P5-responsive-clients.md).

`npm test` now includes real loopback HTTP integration tests; a restricted environment must permit local server connections. `npm run build` includes the static sparring page/client, but its multiplayer API requires `npm run spike`; static hosting alone cannot run the authority.

### Network lab

After joining both tabs, use **Network test** to select 50/100/150 ms target RTT with jitter and 1/2/3% application-message loss per direction. Click the arena to focus controls again. The readout shows live RTT, state age, received/applied inputs, pending markers, correction, terrain catch-up, and lab drops. HTTP itself remains reliable; this simulates missing application messages. Reset to Local before leaving. Joining under an impaired profile also delays every terrain page.

Run `npm run bench:network` for the seeded two-client virtual workload. Checked-in [results](docs/phases/M1.P5-network-results.json) and the [phase handoff](docs/phases/M1.P5-responsive-clients.md) document the scenario and limits. Harsh conditions can produce visible stalls/corrections, and a whole-world terrain transfer takes seconds; no production responsiveness guarantee is claimed.

## Play

- WASD: fly at up to 16 metres/second; mouse: aim.
- Hold left mouse / 1: Heaven-piercing bolt (9 qi, 0.28s cooldown).
- Q / 2: Severing crescent (16 qi, travelling energy blade, 0.65s cooldown).
- E / 3: Falling heaven (38 qi, 60–120m targeting range, depending on realm, 0.65s telegraph, 3.2s cooldown).
- Mouse wheel: smooth zoom from 0.8 to 24 pixels/metre.
- C: cinematic camera framing both cultivators; wheel returns to following you.
- Space / P: pause. R: revive both cultivators while preserving terrain damage.
- Realm selectors apply immediately. Rival aggression can be disabled for experiments.
- Restore terrain explicitly resets the landscape. Reviving does not restore it.

Try Nascent Soul against Qi Gathering, then reverse it. Each realm multiplies offense and defense by 3: a three-realm difference is 27×. Higher realms enlarge sword and area reach. Falling heaven has a 20 / 40 / 80 / 160 metre diameter across the four realms. The power ratio is your offensive multiplier relative to the rival's defense. Wards absorb 65% of incoming damage until depleted, and do not regenerate. Qi regenerates at 10/second. All three techniques can damage cover; falling heaven also excavates a broad crater. You are immune to your own techniques.

## Scale, durability, and persistence

The 512 × 512 metre world contains 128 × 128 four-metre terrain cells. Cultivators are roughly human-sized, with 0.75m collision radii. Trees have 55 durability; stone has 200. Terrain damage accumulates, destroyed cover stops blocking, and crater depth increases up to 12m. Depth currently affects appearance only, not movement or line of sight. Projectiles use substeps of at most 0.4m to prevent tunnelling through cells and actors. Movement slides along blocked axes. Sword crescents travel 36–162m with collision sampling, hit each actor once, and penetrate cover while cutting it; area attacks are delayed circles with distance falloff.

Terrain, partial cover durability and destruction counts autosave to this browser origin's localStorage every 1.5 seconds after changes and on page exit. Saves are validated before loading. Actors and projectiles are intentionally reset between page loads. Different browsers, origins or ports have separate saves. If browser storage is blocked/full, session terrain still works but cannot persist after closing. This is a bounded arena, not an infinite world.

## Architecture and future integration

- `src/sim.ts`: pure deterministic simulation; no Canvas, DOM, browser storage or wall clock. Coordinates are metres, time is seconds. Call `World.step(input, 1/60)` from a fixed-step host. Rendering never changes combat outcomes.
- `src/main.ts`: browser input, accumulator, camera, Canvas renderer, HUD and storage adapter. Rendering interpolates camera position and zoom; simulation runs at 60Hz. Long frame gaps are capped to avoid catch-up stalls.
- `tests/sim.test.ts`: deterministic replay, cover interception, damage, movement collisions, slash direction/cooldown, realm defense, delayed area damage and save round trips.
- `tools.mjs`: dependency-free TypeScript stripping, static build and loopback-only local preview.

For Severed Heaven, import the simulation module and adapt its actor state and `step` input to the host's combat data. Keep the host's rendering and persistence adapters outside the simulation. Effects are transient simulation records consumed by the renderer; terrain mutation increments `revision` so adapters can cache and save changes. Terrain save format version 1 is independent of rendering.

This slice deliberately uses simple rival pursuit and attack cadence, not pathfinding; cover can trap or delay the rival. No multiplayer, progression, elevation physics, knockback or arbitrary mesh fracturing yet. Scars use a cell model. Attacks use prototype balance values; they need playtesting before becoming an integration contract. The optional Google font falls back to installed fonts when offline.

## First design checkpoint

Direction selected: fast, responsive duels plus overwhelming realm-scale destruction. Current next decisions: whether to add a dodge/dash, how far high-realm attacks should reach beyond this arena, and whether broken terrain should hinder movement. These are intentionally still open; play the slice before locking them in.

## Scale and impact pass

The selected direction is attacks spanning the visible battlefield. Nascent Soul now produces an actual 160m diameter terrain blast; the simulation tests verify destruction across that footprint. Projectile impact radii and slash reach also grow with realm. The world and its human-sized cultivators do not resize to fake the effect.

`src/impact.ts` is a separate presentation adapter. It observes transient simulation effects and creates capped debris, dust, shock fronts, a brief hit-stop, a limited warm exposure flash, screen shake and procedural bass/noise audio. It never mutates combat state. Large attacks trigger a camera pullback during charge, hold the wider frame on impact, then smoothly return to your selected zoom. Audio starts after a user gesture. Impact audio and Cinematic impact can be disabled independently; the latter also disables automatic impact framing, flash, shake and hit-stop. The browser's reduced-motion preference is respected initially. Debris and shockwaves remain visible as combat feedback.

Trees now have layered crowns and long shadows. Paths, courtyards and four stone-walled shrine buildings provide human-scale references. Shrine roofs disappear when enough supporting wall cells are destroyed. Existing terrain saves are preserved: use Restore terrain if you want the newly generated shrines in an older save. Architecture shares ordinary cover durability; roofs are a visual representation of the surviving supports.

Validation: ten simulation tests, TypeScript strict checking and a static build pass. Browser checks confirm realm changes, enlarged destruction, camera pullback and rendering without breaking the existing controls. Audio synthesis is implemented but listening quality still needs player feedback.

## Flight and technique update

Shift dashes along your movement direction; when stationary it dashes along your aim. The burst covers 17.6m in 0.16s, costs 10 qi, and has a 0.7s cooldown. It grants no invulnerability and cannot cross solid cover, living actors, or arena boundaries. Movement accelerates to 16m/s in about 65ms and brakes in about 50ms. Collision displacement is substepped at 0.3m even during a dash. Actor rendering interpolates between fixed simulation states, with a faster camera follow.

A tapered luminous wake, twin orbiting ribbons and dash afterimages provide the flying effect. `src/technique-visuals.ts` owns these visuals, the filled sword crescent, bolt comet geometry, and the descending five-finger palm. Sword waves are simulated separately in `World.waves`; their terrain cuts and single-hit tracking are real combat state. Reviving clears waves and visual trails.

Falling Heaven now approaches from the casting cultivator's side while descending, with the wrist toward its source and fingers pointing at the target. Cast source and heading are captured at release, so subsequent caster movement does not rotate a committed strike. Its damage still uses the existing circular shock footprint. The luminous palm is the strike's presentation, not a separate hand-shaped collision mesh.

Bolts now have a white-hot spearhead, a wider realm-scaled glow, a long tapered comet tail and energy filaments. Their existing collision, damage and impact radii are preserved.

Validation after this update: 15 simulation tests pass, including dash cost/cooldown, high-speed collision blocking, movement acceleration/braking/diagonal speed, ranged crescent damage and terrain cutting, and palm source/direction retention. TypeScript strict checks and static build pass. Browser checks cover the dash ribbon, travelling crescent and oriented palm impact.

## Attack performance fix

Terrain now carries per-cell mutation stamps. The renderer repaints only the changed bounding region, padded for shadows and shrine roofs, rather than rebuilding every tree, rock and ground detail across the entire 512m map on each projectile impact or travelling sword step. Initial load, restored terrain and loaded saves still repaint fully. Unknown external mutations conservatively trigger a full repaint. Mutation stamps are transient and excluded from terrain saves.

Impact noise is generated once per audio context and reused. HUD updates are limited to roughly 12Hz while world animation remains on requestAnimationFrame. Terrain serialization waits until active projectiles, sword waves and particles settle, or until page exit, avoiding autosave work in the middle of sustained attacks. Sixteen tests, strict TypeScript checking and the static build pass; repeated bolts and a high-realm crescent were exercised in the browser. No hardware-specific frame-rate guarantee has been established.

## Converging bolt volley

Each bolt cast now launches five projectiles in a symmetric fan. Cubic paths spread them outward and bend them toward the aim sampled at release. They converge 16–180m along that direction (minimum distance keeps nearby aiming from collapsing the fan), then continue forward. Moving the cursor affects subsequent volleys, not bolts already in flight. All paths retain 0.4m collision substeps, so cover can intercept individual bolts; flanking bolts may pass around narrow cover.

The volley retains the 9 qi cost and 0.28s cooldown. Each bolt carries one fifth of the original damage and terrain damage budget. Impact sound triggers are coalesced over 60ms and smaller impact particle bursts are capped to keep five simultaneous hits from multiplying effect work unnecessarily. Eighteen tests pass, including opening spread, convergence, fixed aim, shared damage, expiry and cover interception; TypeScript checking and build also pass.

## Irregular bursts and drifting flight (current tuning)

This update supersedes the earlier movement and volley timing values above. Flight now tops out at 30m/s. Steering blends velocity toward the input with a time-based exponential response; releasing movement applies gentle drag, retaining roughly 58% of speed after 0.2s and producing about 11m of coasting from full speed. Small residual velocities eventually settle to zero. Diagonals remain speed-normalized and collision substeps are unchanged. Dash retains its 110m/s burst and now carries 30m/s momentum into flight. Camera follow uses a time-based exponential response too.

A volley costs 9 qi and has a 0.95s cooldown. Its five fan positions are shuffled, with one immediate bolt and subsequent releases spaced randomly 45–110ms apart. Curve angles and flight times vary; each convergence point has bounded aim error of up to 1m plus 3.5% of target distance. Aim is committed at cast time; each delayed projectile begins from the caster's position at its own release. Death cancels pending releases. All randomness uses world-owned seeded state, keeping fixed-input simulation reproducible while successive volleys vary. Bolts still split the original total damage budget.

Validation: 19 tests pass, with revised tests for inertia, bounded diagonal speed, uneven launch timing, aiming error, cooldown, moving release positions and pending-shot cancellation. TypeScript checking and static build pass. Browser checks cover steering, drift and staggered firing in the same session.

## Switchable 2.5D presentation experiment

The prototype now starts in a tilted view. Press V or use the header view button to compare the same live battle with top-down. The terrain projects through a 0.28-radian yaw and a 0.58 vertical scale. Input uses the exact inverse transform: mouse picking lands on the ground plane, while WASD directions remain relative to the screen. Existing collision, metre scale, terrain saves, damage, drift, attack timing and realm rules stay in the simulation.

`src/projection.ts` contains the pure projection, inverse and height-offset helpers. `src/depth-scene.ts` renders depth-sorted tree/rock billboards, extruded shrine walls and roofs, and upright hovering cultivators with ground shadows. Foreground foliage fades near a cultivator. Cached sprites avoid rebuilding foliage geometry every frame. Ground terrain remains cached and repaints only damaged regions. View switching invalidates the ground image once. Surviving shrine walls determine whether its roof remains visible.

Flight ribbons and attacks are offset above the ground, with particles and the descending palm using screen-vertical height. Damage labels stay upright. This is an orthographic 2.5D presentation, not full 3D physics: visual height does not allow flying over collision obstacles or change hit detection. Sorting tall objects is approximate, especially where large effects overlap structures. Existing scars are retained; Restore terrain shows the generated landscape and shrines again if you want an unscarred comparison.

Validation: 24 tests pass, including projection/inverse round trips, screen-relative input and height direction, plus the existing combat tests. TypeScript checking and static build pass. Browser checks cover switching both ways, drifting flight, the sword crescent, firing and the palm strike in the tilted view.

## Physical elevation and aerial combat (current)

F rises and G descends at up to 14m/s; release to hover. The altitude readout shows clearance above the local floor and absolute world altitude. Absolute altitude can be negative in valleys and excavated craters. Flight is bounded between 0.65m above the ground and 65m absolute altitude. Horizontal drift stays intact. A slope higher than your current clearance blocks movement until you climb; trees (7m), stone (3m) and surviving shrine roofs (7.5m) can be flown over. The rival adjusts altitude toward yours.

The height field contains a roughly 13m ridge and a valley around -6m, plus gentle rolling relief. Each cell stores its base elevation and accumulated excavation depth. Craters now physically lower the floor, up to 12m below the original surface. Hovering actors keep their absolute altitude when ground is excavated beneath them; descend to enter the crater. The renderer uses a chunk-cached, shaded height mesh, updating affected chunks after terrain mutations. Trees, structures, shadows, flight trails, attacks and cursor picking follow the physical height field. Ground targeting uses a ray against that surface; pointing at a cultivator's visible figure aims at their current height.

Bolts follow height-aware paths, can strike a ridge or cover, clear low obstacles, and miss a cultivator above/below them. Crescents travel at release altitude and can similarly miss; they stop against rising ground and do not excavate ground far beneath a high airborne wave. Falling Heaven holds briefly, then physically sweeps downward through altitude, damaging each enemy at most once before its terrain impact. A cultivator above the palm's entire descent is out of its reach. These rules remain pure simulation code, separate from the 2.5D renderer.

Terrain saves use version 2. Version 1 saves migrate by adding the generated base height while retaining scars, durability and destruction counts. Spawn/revive clearance is placed relative to the saved floor. The browser storage key stays the same so previous terrain is found. Restore terrain regenerates the fresh ridge, valley and cover if an old battlefield is heavily excavated.

Limits: this is a 4m height field with a single surface per position, not volumetric terrain, caves or overhangs. Chunk/depth ordering at steep slopes and tall props is approximate. Shrine foundations use a sampled ground height. No falling damage or vertical knockback is included in this first elevation slice.

Validation: 37 tests pass, covering height fields, ascent/descent, ridge/canopy/roof blocking, aerial projectile misses and hits, crescent altitude, palm descent, physical craters, save migration and slope-aware picking, plus all earlier combat and projection checks. Strict TypeScript checking and the static build pass. Browser checks confirm migrated crater floors, F/G altitude changes, camera tracking, and the shaded height mesh.

## Cursor assistance and optional soft lock (current)

Aim near the rival's visible figure, ground shadow, or the vertical space between them. An 84px acquisition halo automatically chooses a live target within 180m in either 2.5D or top-down. Brackets and the targeting status show when assistance is active. Aim elsewhere for free ground targeting.

Middle-click or T acquires the nearby assisted target; repeat to release. Esc releases immediately. A soft lock retains the target when the cursor moves away, until death, revival, manual release, or exceeding 220m. It does not remove terrain collisions or make attacks guaranteed hits. The lock button also works without a middle mouse button.

Assisted bolts retain their irregular five-shot fan, launch delays, 9 qi cost, 0.95s cooldown, shared damage budget and small aim variation. After the fan opens, they steer toward the target's moving position and altitude with a small amount of lead. Tracking is bounded to 2.8 radians/second for cursor-assisted shots and 3.3 for locked shots; bolts can overshoot, hit terrain, lose tracking or expire. Shots keep the target selected at release instead of switching victims as the cursor moves. Existing in-flight guidance is not cancelled by releasing the UI lock.

Assisted crescents launch along a height-corrected trajectory, with unchanged total speed and bounded lifetime. They do not home after release. Assisted palms commit to the target's current horizontal position, begin above that target's altitude, and descend through the altitude column to the ground. Their location stays fixed so movement can evade them. These targeting rules also apply to the rival's aimed attacks.

`src/targeting.ts` provides pure acquisition, range and bounded 3D steering helpers. Screen projection and lock input remain in the browser adapter; actual height-aware trajectories and collisions remain in the simulation.

Validation: 48 tests pass. New checks cover generous acquisition near figure/shadow, acquisition/retention ranges, turning limits, hits on stationary and moving airborne targets without caster altitude matching, terrain interception, lost/dead targets, assisted crescent height and speed, and high-target palm descent. TypeScript strict checking and static build pass. Browser checks confirm middle-click lock, Esc release, cursor assistance, and a full volley hit from a different altitude with the cursor away from the locked rival.

## Steerable Heavenly Step and time dilation (current)

Press Shift to enter Heavenly Step. Steer throughout with WASD; F/G altitude control remains responsive. The player keeps normal 30m/s flight speed while the battlefield slows. Direction changes turn smoothly, and the step carries its velocity into normal flight when it ends. It costs 10 qi; retriggering during the step does not refresh it. Recovery is 1.1 seconds after the active window.

| Realm | Active duration | Battlefield speed | Unobstructed travel |
| --- | --- | --- | --- |
| Qi Gathering | 0.65s | 35% | 19.5m |
| Foundation | 0.90s | 28% | 27m |
| Golden Core | 1.20s | 22% | 36m |
| Nascent Soul | 1.55s | 18% | 46.5m |

Time dilation eases in and out. Rival decisions, movement, altitude pursuit, all projectiles from both sides, palm windups and visual particles follow the slowed scene clock. Player movement, input, cooldowns and qi recovery follow real time. This first version slows the entire battlefield rather than a spatial bubble. Terrain collisions still block movement and attacks; the step grants no invulnerability. A cyan edge glow, flight trail and WORLD / YOU status identify the active window. Reduced cinematic motion suppresses the edge streaks.

The pure tuning lives in src/time-flow.ts; simulation clocks remain independent from rendering. Validation: 56 tests pass, including realm scaling, steering, travel distance, momentum, altitude responsiveness, enemy movement, attack timing, cooldowns, collision/damage and time recovery after death. Strict TypeScript checking and static build pass. Browser testing confirms a steerable Nascent Soul step with WORLD 18% / YOU 100% and the active visual treatment.

## Longer, realm-scaled Heavenly Step

Heavenly Step now boosts flight speed as well as slowing the battlefield. Steering, altitude control, collision handling and retained momentum remain active. Normal flight stays at 30m/s.

| Realm | Active duration | Step speed | Unobstructed travel |
| --- | --- | --- | --- |
| Qi Gathering | 0.95s | 45m/s | 42.75m |
| Foundation | 1.25s | 60m/s | 75m |
| Golden Core | 1.65s | 78m/s | 128.7m |
| Nascent Soul | 2.10s | 100m/s | 210m |

These values supersede the previous duration and speed table. Time dilation strength, 10 qi cost and 1.1s recovery after the active window are unchanged.

## Longer maneuvering window (latest tuning)

Heavenly Step now trades some burst speed for more time to steer. Current profiles supersede the earlier dash tables:

| Realm | Active duration | Step speed | Unobstructed travel |
| --- | --- | --- | --- |
| Qi Gathering | 1.5s | 38m/s | 57m |
| Foundation | 2.0s | 48m/s | 96m |
| Golden Core | 2.6s | 60m/s | 156m |
| Nascent Soul | 3.3s | 72m/s | 237.6m |

Realm-scaled time dilation, responsive steering, retained momentum, 10 qi cost and 1.1s recovery remain unchanged. Normal flight is still 30m/s.

## Semi-automatic altitude clearance and rendering work

Auto altitude clearance is enabled by default in the browser and can be disabled with its checkbox. While moving or drifting, the player samples a three-lane corridor ahead (roughly 0.6 seconds of travel, capped at 44m). Assistance rises at up to 24m/s to clear terrain, trees, rocks and intact shrine roofs by 2m. It never automatically descends or follows a rival's altitude. F/G override it while held; normal altitude limits and collisions remain. Severe terrain changes or close obstacles can still briefly block movement while the player climbs. The simulation opts in through input.autoAltitude, independently of rendering.

Height rendering now skips cell-stamp scans on unchanged frames, rather than checking roughly 20,000 stamps every frame. Dirty-region painting remains intact; clean chunks advance their checked revision after a scan. Depth sorting calculates projection once per visible item rather than repeatedly inside sort comparisons. These reduce repeated CPU work; no hardware FPS gain has been measured.

Validation: 60 tests pass, strict type checking and build pass. New checks cover normal and fast-dash tree clearance, ridge crossing, held altitude after clearing terrain, manual descent, disabled assistance, idle behavior and the ceiling. Browser verification confirms the enabled control and ascent out of the saved cratered landscape without repairing terrain.
