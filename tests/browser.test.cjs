'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {openGamePage} = require('./support/browser-runtime.cjs');
require('./browser-collapse.test.cjs');

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
    assert.equal(state.world.structures, 63);
    assert.ok(state.world.voxels > 35304);
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
      window.__browserInputSafety.allowSimulatedLock(false);
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

    const mouseLook = await runtime.page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      const before = window.__browserGameTest.state().camera;
      canvas.dispatchEvent(new MouseEvent('mousemove', {
        clientX: 80, clientY: 60, bubbles: true
      }));
      canvas.dispatchEvent(new MouseEvent('mousemove', {
        clientX: 180, clientY: 130, bubbles: true
      }));
      const passive = window.__browserGameTest.state().camera;
      canvas.dispatchEvent(new MouseEvent('mousedown', {
        button: 2, clientX: 180, clientY: 130, bubbles: true, cancelable: true
      }));
      canvas.dispatchEvent(new MouseEvent('mousemove', {
        clientX: 180, clientY: 130, bubbles: true
      }));
      canvas.dispatchEvent(new MouseEvent('mousemove', {
        clientX: 220, clientY: 150, bubbles: true
      }));
      window.dispatchEvent(new MouseEvent('mouseup', {
        button: 2, bubbles: true
      }));
      const dragged = window.__browserGameTest.state().camera;
      const menuEvent = new MouseEvent('contextmenu', {
        button: 2, bubbles: true, cancelable: true
      });
      const menuAllowed = canvas.dispatchEvent(menuEvent);
      return {
        before, passive, dragged,
        pointerLocked:document.pointerLockElement!==null,
        contextMenuPrevented:!menuAllowed
      };
    });

    assert.deepEqual(mouseLook.passive, mouseLook.before,
      'ordinary cursor motion must not steer the camera');
    assert.notDeepEqual(mouseLook.dragged, mouseLook.before,
      'right-button dragging must steer the camera');
    assert.equal(mouseLook.pointerLocked, false,
      'a denied pointer-lock request must leave right-drag usable');
    assert.equal(mouseLook.contextMenuPrevented, true);

    const weaponSelection = await runtime.page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        code:'Digit4', key:'4', bubbles:true
      }));
      const slotFour=window.__browserGameTest.state().weapon;
      window.dispatchEvent(new KeyboardEvent('keydown', {
        code:'Digit5', key:'5', bubbles:true
      }));
      return {
        slotFour,
        slotFive:window.__browserGameTest.state().weapon,
        cannonVisible:gunCannon.visible,
        rpgVisible:gunRpg.visible,
        pointerLocked:document.pointerLockElement!==null
      };
    });

    assert.deepEqual(weaponSelection, {
      slotFour:{key:'rpg',label:'MACHINE RPG'},
      slotFive:{key:'cannon',label:'A-10 20MM CANNON'},
      cannonVisible:true,rpgVisible:false,pointerLocked:false
    });

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
    await runtime.page.keyboard.press('Escape');
    const escaped=await runtime.page.evaluate(()=>({
      state:window.__browserGameTest.state(),
      title:document.getElementById('start-title').textContent
    }));
    assert.equal(escaped.state.started,false);
    assert.deepEqual(escaped.state.pressedKeys,[]);
    assert.equal(escaped.title,'PAUSED');
    const inputSafety=await runtime.page.evaluate(()=>window.__browserInputSafety.state());
    assert.ok(inputSafety.requests>0,'play must exercise the intercepted capture request');
    assert.equal(inputSafety.nativeLocked,false);
    assert.deepEqual(runtime.errors,[]);
    t.diagnostic(`browser ready in ${runtime.readyMs.toFixed(1)} ms; no traversal frames used`);
  } finally {
    await runtime.close();
  }
});

test('pause settings persist and simulated pointer-lock loss pauses without native mouse capture',async()=>{
  const runtime=await openGamePage();
  try{
    await runtime.page.setViewportSize({width:1280,height:720});
    await runtime.page.waitForFunction(()=>document.getElementById('load').style.display==='none');
    await runtime.page.locator('#settings-panel summary').click();
    await runtime.page.locator('#invert-y').check();
    await runtime.page.locator('#auto-jump').uncheck();
    await runtime.page.locator('#quality').selectOption('performance');
    await runtime.page.locator('#camera-motion').selectOption('0');
    const settings=await runtime.page.evaluate(()=>({
      playing:started,stored:JSON.parse(localStorage.getItem(SETTINGS_KEY)),
      shadows:renderer.shadowMap.enabled,ratio:renderer.getPixelRatio()
    }));
    assert.equal(settings.playing,false,'editing settings must not start or shoot');
    assert.equal(settings.stored.invertY,true);
    assert.equal(settings.stored.autoJump,false);
    assert.equal(settings.stored.cameraMotion,0);
    assert.equal(settings.stored.quality,'performance');
    assert.equal(settings.shadows,false);
    assert.equal(settings.ratio,1);
    await runtime.page.locator('#quality').selectOption('high');
    await runtime.page.locator('#invert-y').uncheck();
    await runtime.page.locator('#auto-jump').check();
    await runtime.page.screenshot({path:'test-results/astra-settings.png'});
    await runtime.page.evaluate(()=>window.__browserInputSafety.allowSimulatedLock(true));
    await runtime.page.locator('#play-button').click();
    await runtime.page.waitForFunction(()=>document.pointerLockElement!==null);
    const simulated=await runtime.page.evaluate(()=>window.__browserInputSafety.state());
    assert.equal(simulated.simulatedLocked,true);
    assert.equal(simulated.nativeLocked,false,'a simulated lock must never capture the system pointer');
    await runtime.page.evaluate(()=>window.__browserInputSafety.releaseSimulatedLock());
    await runtime.page.waitForFunction(()=>!started);
    const paused=await runtime.page.evaluate(()=>({
      input:Object.values(keys).some(Boolean)||mouseHeld,
      display:document.getElementById('start').style.display
    }));
    assert.deepEqual(paused,{input:false,display:'flex'});
    await runtime.page.locator('#play-button').click();
    await runtime.page.waitForFunction(()=>started);
    await runtime.page.evaluate(()=>{
      __browserGameTest.pause();
      __browserGameTest.placePlayer({x:8,y:0,z:16});
      __browserGameTest.setCamera(0.72,0.27);
      __browserGameTest.step(1);renderer.render(scene,camera);
    });
    await runtime.page.screenshot({path:'test-results/astra-game.png'});
    const finalInput=await runtime.page.evaluate(()=>window.__browserInputSafety.state());
    assert.equal(finalInput.nativeLocked,false);
    assert.ok(finalInput.requests>=2);
    assert.deepEqual(runtime.errors,[]);
  }finally{await runtime.close();}
});
