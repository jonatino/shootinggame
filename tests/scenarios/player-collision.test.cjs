'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {createRuntime} = require('../support/game-runtime.cjs');

test('ground movement stays within the tactical movement speed budget', () => {
  const runtime = createRuntime({seed: 19});
  const speeds = runtime.json(String.raw`(()=>{
    const sample=(sprint)=>{
      __gameTest.setPlayer([0,0,0]);
      __gameTest.stepGround(240,[0,0,-1],{forward:true,sprint});
      const state=__gameTest.playerState();
      return Math.hypot(state.vel[0],state.vel[2]);
    };
    return {walk:sample(false),sprint:sample(true)};
  })()`);

  assert.ok(Math.abs(speeds.walk-6.75)<0.01,
    `walk speed drifted to ${speeds.walk}`);
  assert.ok(Math.abs(speeds.sprint-8.4375)<0.01,
    `sprint speed drifted to ${speeds.sprint}`);
});

test('sprint movement cannot tunnel through a thin wall', () => {
  const runtime = createRuntime({seed: 20});
  const state = runtime.json(String.raw`(()=>{
    __gameTest.setPlayer([0,0,0]);
    __gameTest.addBox({center:[0,1,-1],size:[4,2,0.25],standable:false});
    __gameTest.stepGround(240,[0,0,-1],{forward:true,sprint:true});
    return __gameTest.playerState();
  })()`);

  assert.equal(state.mode, 'ground');
  assert.equal(state.onGround, true);
  assert.ok(state.pos[2] > -0.7, `player crossed the wall at z=${state.pos[2]}`);
  assert.equal(state.vel[2], 0);
});
