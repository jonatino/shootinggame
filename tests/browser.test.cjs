'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {openGamePage} = require('./support/browser-runtime.cjs');

test('browser loads, renders, and gates paused input behind the play screen', async t => {
  const runtime = await openGamePage();
  try {
    const initialView = await runtime.page.evaluate(() =>
      window.__browserGameTest.state());
    const initialCameraDistance = Math.hypot(
      initialView.cameraPosition[0] - initialView.position[0],
      initialView.cameraPosition[2] - initialView.position[2]
    );
    assert.ok(initialView.cameraPosition[1] > initialView.position[1] + 1.5,
      `pre-play camera is not above the player: ${initialView.cameraPosition}`);
    assert.ok(initialCameraDistance > 2 && initialCameraDistance < 8,
      `pre-play camera is not at chase distance: ${initialCameraDistance}`);

    const state = await runtime.page.evaluate(() => {
      window.__browserGameTest.pause();
      return window.__browserGameTest.placePlayer({x: 3, y: 0, z: -4});
    });
    const canvas = await runtime.page.locator('canvas').count();

    assert.equal(canvas, 1);
    assert.deepEqual(state.position, [3, 0, -4]);
    assert.deepEqual(state.velocity, [0, 0, 0]);
    assert.equal(state.mode, 'ground');
    assert.equal(state.started, false);
    assert.ok(state.renderFrames > 0);
    assert.equal(state.world.structures, 49);
    assert.equal(state.world.voxels, 35304);
    assert.deepEqual(runtime.errors, []);

    await runtime.page.waitForFunction(
      () => document.getElementById('load').style.display === 'none',
      null,
      {timeout: 15000}
    );
    await runtime.page.waitForTimeout(100);
    const stillPaused = await runtime.page.evaluate(() =>
      window.__browserGameTest.state());
    assert.equal(stillPaused.renderFrames, initialView.renderFrames,
      'click-to-play screen must not schedule recurring renders');

    const playGate = await runtime.page.evaluate(() => {
      const start = document.getElementById('start');
      const beforeDisplay = getComputedStyle(start).display;
      const before = window.__browserGameTest.state();
      start.dispatchEvent(new KeyboardEvent('keydown', {
        code: 'KeyW', key: 'w', bubbles: true
      }));
      start.dispatchEvent(new MouseEvent('mousemove', {
        clientX: 40, clientY: 40, bubbles: true
      }));
      start.dispatchEvent(new MouseEvent('mousemove', {
        clientX: 180, clientY: 120, bubbles: true
      }));
      start.dispatchEvent(new WheelEvent('wheel', {deltaY: 100, bubbles: true}));
      start.dispatchEvent(new MouseEvent('click', {button: 0, bubbles: true}));
      start.dispatchEvent(new MouseEvent('mousedown', {
        button: 2, bubbles: true, cancelable: true
      }));
      const ignored = window.__browserGameTest.state();

      start.dispatchEvent(new MouseEvent('mousedown', {
        button: 0, bubbles: true, cancelable: true
      }));
      const playing = window.__browserGameTest.state();
      return {before, ignored, playing, beforeDisplay};
    });

    assert.equal(playGate.before.started, false);
    assert.equal(playGate.beforeDisplay, 'flex');
    assert.equal(playGate.ignored.started, false);
    assert.deepEqual(playGate.ignored.camera, playGate.before.camera);
    assert.equal(playGate.ignored.zoom, playGate.before.zoom);
    assert.deepEqual(playGate.ignored.pressedKeys, []);
    assert.equal(playGate.playing.started, true);

    await runtime.page.waitForFunction(previous =>
      window.__browserGameTest.state().renderFrames > previous,
      stillPaused.renderFrames,
      {timeout: 2000}
    );
    const runningBefore = await runtime.page.evaluate(() =>
      window.__browserGameTest.state());
    await runtime.page.waitForTimeout(100);
    const runningAfter = await runtime.page.evaluate(() =>
      window.__browserGameTest.state());
    assert.ok(runningAfter.renderFrames > runningBefore.renderFrames,
      'render loop did not continue after play');

    const blurred = await runtime.page.evaluate(() => {
      const start = document.getElementById('start');
      window.dispatchEvent(new Event('blur'));
      return {
        state:window.__browserGameTest.state(),
        display:start.style.display
      };
    });
    assert.equal(blurred.state.started, false);
    assert.equal(blurred.display, 'flex');
    await runtime.page.waitForTimeout(100);
    const pausedAfterBlur = await runtime.page.evaluate(() =>
      window.__browserGameTest.state());
    assert.equal(pausedAfterBlur.renderFrames, blurred.state.renderFrames,
      'focus-loss play screen must stop recurring renders');

    const refocused = await runtime.page.evaluate(() => {
      const start = document.getElementById('start');
      window.dispatchEvent(new Event('focus'));
      return {
        state:window.__browserGameTest.state(),
        display:start.style.display
      };
    });
    assert.equal(refocused.state.started, false);
    assert.equal(refocused.display, 'flex');
    await runtime.page.waitForTimeout(60);
    const focusedFrames = await runtime.page.evaluate(() =>
      window.__browserGameTest.state().renderFrames);
    assert.equal(focusedFrames, blurred.state.renderFrames,
      'window focus alone must not resume rendering');

    const resumed = await runtime.page.evaluate(() => {
      const start = document.getElementById('start');
      start.dispatchEvent(new MouseEvent('mousedown', {
        button: 0, bubbles: true, cancelable: true
      }));
      return {
        state:window.__browserGameTest.state(),
        display:start.style.display
      };
    });
    assert.equal(resumed.state.started, true);
    assert.equal(resumed.display, 'none');
    await runtime.page.waitForFunction(previous =>
      window.__browserGameTest.state().renderFrames > previous,
      blurred.state.renderFrames,
      {timeout: 2000}
    );
    t.diagnostic(`browser ready in ${runtime.readyMs.toFixed(1)} ms; no traversal frames used`);
  } finally {
    await runtime.close();
  }
});
