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

The physics-refinement scenarios add 240 m/s fragment sweeps against 2 cm walls,
ballistic free fall and spin-axis stability, friction, removal of a sleeping
pile's support, camera wall retraction, slope and headroom limits, audio/randomness
isolation, projectile visual recycling, pickup reach and visibility checks, and
prevention of destroyed building cells regenerating from tiny resting fragments.

Voxel chunk motion scenarios cover shooting tilted free and pivoting sections,
blast release with inherited momentum, and continuous rotation under repeated
hits. These guard against building interiors jumping out when the spin axis changes.

Debris support scenarios cover internal wall seams, adjoining tiers, real ledges
and their removal, fast downward wall contacts, gravity of a colliding airborne
rubble cloud, and detached sections sliding down vertical walls. These use only
the CPU harness and check motion and support rather than elapsed real time.

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
