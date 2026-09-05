# Test harness

The default regression loop is deterministic and CPU-only. It loads the real
game scripts into a tiny synthetic world, replaces wall time and randomness,
and advances fixed ticks directly. It does not create WebGL, wait for animation
frames, or walk a player across the authored map to reach a test subject.

## Commands

- `npm test` — default tiny-world CPU regressions.
- `npm run test:full` — full authored-world cooking and climb-graph integration.
- `npm run test:browser` — rendering, mouse lock/fallback, pause, and settings checks.
- `npm run test:stress` — seeded full-world support failure, secondary blasts, and bounded rubble; records CPU timings in `test-results/astra-stress.json`.
- `npm run test:all` — CPU scenarios, full-world integration, stress, and browser checks.
- `npm run test:bench` — measured timings and comparison with the old
  30-minute-per-prompt loop.
- `npm run test:collapse-perf -- current - house` — guarded browser CPU/render
  profile of footing damage and a blast, including about 1,000 rubble pieces.
  Use `chain` instead of `house` for six blasts and the full 3,600-piece pool.
  Append `realtime` to exercise normal animation-frame catch-up and record frame
  intervals. The default steps eight simulated seconds at a fixed display rate.
  Fixed samples disable the CPU catch-up budget inside the test page to measure
  the same two physics ticks per sample; real-time samples retain the budget.
  Replace `-` with a saved `voxel_physics.js` path for a before/after comparison.
  An optional final argument selects a saved `js/game-loop.js` as well.
  Profiles, frame samples and screenshots go to `test-results/collapse-<label>.*`.
- `npm run test:rapid-fire-perf -- current - fire` — ten seconds of rapid cannon
  fire and sweeping camera turns in a damaged full world at 1600 × 1000. Uses
  real animation frames and records simulation time and shots alongside frame,
  CPU and render timings, so slowing simulation cannot hide a regression. Use
  `look` instead of `fire` to measure camera turns without additional shots.
  Replace `-` with a saved source directory containing `voxel_physics.js` and
  `js/` for comparison. Profiles, samples and screenshots go to
  `test-results/rapid-<label>.*`. All input remains inside the guarded test page.
  Append `fixed` to replay exactly 600 frames and 1,200 physics ticks with the
  catch-up budget disabled in the test page. This measures equal CPU work;
  supplied frame intervals are excluded from its timing summary.

## Scenario rules

1. Use the CPU harness unless the behavior fundamentally belongs to WebGL, the
   DOM, pointer lock, or real browser event delivery.
2. Build the smallest world that can reproduce the behavior.
3. Place the player and subject directly at the interaction. A climbing test
   starts at the wall; a weapon test starts with its target in range.
4. Advance simulation ticks directly. Never use sleeps to represent gameplay.
5. Include the random seed in every scenario that uses randomness.
6. Browser tests must use `tests/browser/direct-control.js` to pause, place, and
   step the game. They must not spend frames walking to an unrelated subject.

Tests and browser-only controls live under `tests/`; no test branches are added
to production game files.

`createRuntime({gameplay:true,seed})` loads the real combat, character, HUD, actors,
and fixed game loop into the tiny world. This covers firing cadence across display
rates, capsule hits and cover, rocket ballistics, respawn, and stall handling
without cooking the authored map. Movement scenarios cover ceilings, thin landing
platforms, air momentum, held jumps, and the existing traversal behavior.
Synthetic physics costs also verify that the frame CPU budget yields after
complete fixed ticks and discards overdue work without banking a catch-up burst.

The physics-refinement scenarios add 240 m/s fragment sweeps against 2 cm walls,
ballistic free fall and spin-axis stability, friction, removal of a sleeping
pile's support, camera wall retraction, slope and headroom limits, audio/randomness
isolation, projectile visual recycling, pickup reach and visibility checks, and
prevention of destroyed building cells regenerating from tiny resting fragments.

Voxel chunk motion scenarios cover shooting tilted free and pivoting sections,
blast release with inherited momentum, and continuous rotation under repeated
hits. These guard against building interiors jumping out when the spin axis changes.

Voxel chunk damage scenarios fire through tilted detached facades after their
original building is destroyed. They cover continued cannon penetration, retained
small-arms damage, local explosions, and severed sections keeping their world pose
and momentum as they split. Destroyed sections must leave rendering, raycast, and
collision lists while rubble remains within the existing pool limit.

Debris support scenarios cover internal wall seams, adjoining tiers, real ledges
and their removal, fast downward wall contacts, gravity of a colliding airborne
rubble cloud, and detached sections sliding down vertical walls. These use only
the CPU harness and check motion and support rather than elapsed real time.

Rubble rest regressions measure linear motion, spin, and positional drift in
108- and 640-brick piles, including runs with the physical sleep gate disabled
inside the CPU sandbox. Foundation-supported and mixed-size piles exercise static
support reactions under unequal loads. The tests also check prolonged free fall
and energy transfer from spinning sections. The solver must dissipate motion
through contact forces; age limits, forced sleeping, or deleting bricks cannot
satisfy these checks.

Structural contact regressions put a core against the inside of a hollow shell
and replay a cannon burst into the brick house's footing. They check the contact
direction, conservation of the centre of mass, and per-tick correction distance
so an interlocking core cannot be pushed out through its surrounding facade.

Collision search regressions compare optimized searches against exhaustive body
pairs, including rotated and fractured sections, fine cell grids, mixed-size
rubble, sleeping neighbours and negative coordinates. A large external body
must not cause quadratic voxel searches. Another 3,000 seeded box pairs compare
all fifteen separating axes against independent world-space projections, with
near-parallel edges included. These checks enforce geometry and bounded work;
the separate performance replay reports timings without hardware-specific limits.
The exhaustive reference includes buried cells omitted by the surface search.
Cached face exposure is checked independently against surviving neighbours after
rotation and fracture. Ray searches compare exact hit points, faces and instance
IDs against Three.js's exhaustive instanced-mesh raycast, including transformed
and damaged sections, rays starting inside them, and short near/far intervals.

Progressive collapse scenarios drop heavy sections through three floors and a
crate, including seeded debris between the falling section and its supports.
They cover impact work, sustained bearing loads, fast thin-floor impacts, ledge
tipping, disconnected collision bounds, and soft landings without rebuilding
the original grid. Two cannon replays use the Northwest Spire's authored grid
and measure clearance of the breach after firing stops. Rotated loose bricks
must touch at their real faces, and pile contacts must converge with sleeping
disabled. The browser replay saves the intact facade, active breach, and settled
result for visual comparison using the same guarded browser runtime.

Browser checks exercise both denied and simulated pointer lock, actual settings
controls, Escape, focus loss, and rendering. They save menu and game screenshots
under `test-results/`. Stress timings exclude WebGL/GPU work and deliberately have
no hardware-dependent pass threshold; finite state and physics pool limits are
the assertions.

## System mouse isolation

Automated tests must never capture, recenter, or move the system mouse. Headless
Chromium can still affect it when real pointer lock is requested. Always create
test pages with `openGamePage()`: it installs `browser/input-safety.js` before any
game code, intercepts native capture/release APIs, and simulates lock state and
events entirely inside the test document. The tests verify that Chromium's native
pointer-lock state remains unlocked, including during simulated lock scenarios.
Do not bypass this guard or run real pointer-lock experiments in automated tests.
