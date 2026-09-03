# Test harness

The default regression loop is deterministic and CPU-only. It loads the real
game scripts into a tiny synthetic world, replaces wall time and randomness,
and advances fixed ticks directly. It does not create WebGL, wait for animation
frames, or walk a player across the authored map to reach a test subject.

## Commands

- `npm test` — default tiny-world CPU regressions.
- `npm run test:full` — full authored-world cooking and climb-graph integration.
- `npm run test:browser` — one browser startup/rendering smoke test.
- `npm run test:all` — all three tiers.
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
