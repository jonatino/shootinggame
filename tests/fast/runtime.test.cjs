'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {createRuntime} = require('../support/game-runtime.cjs');

test('CPU runtime boots a tiny world without rendering', () => {
  const runtime = createRuntime({seed: 1});
  const counts = runtime.json('__gameTest.staticCounts()');

  assert.deepEqual(counts, {boxes: 0, standables: 1, occluders: 1});
  assert.equal(runtime.evaluate('__gameTest.rendererFrames()'), 0);
  assert.deepEqual(runtime.errors, []);
});

test('virtual clock advances simulation time without waiting for wall time', () => {
  const runtime = createRuntime({seed: 2, startTimeMs: 100});

  runtime.evaluate('__gameTest.stepGround(120,[0,0,0])');

  assert.equal(Math.round(runtime.clock.now()), 1100);
  assert.equal(runtime.evaluate('__gameTest.rendererFrames()'), 0);
});
