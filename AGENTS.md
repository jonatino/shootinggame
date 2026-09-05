# Testing

- Tests must never capture, recenter, or move the user's system mouse. This also
  applies to headless browsers: native pointer lock can affect the desktop cursor.
- Use `tests/support/browser-runtime.cjs` and its `openGamePage()` helper for browser
  tests. It installs `tests/browser/input-safety.js` before any game code and mocks
  all pointer-lock APIs. Simulate lock state through `__browserInputSafety`.
- Never bypass the input guard or exercise native pointer lock in automated tests.
- Prefer the deterministic CPU harness for gameplay/physics regressions. Use the
  browser only for rendering, DOM, and simulated input behavior; see `tests/README.md`.
