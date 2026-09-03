'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {createRuntime} = require('../support/game-runtime.cjs');

test('climb test places a wall directly in front of the player and grabs immediately', () => {
  const runtime = createRuntime({seed: 12});
  const result = runtime.json(String.raw`(()=>{
    __gameTest.setPlayer([0,0,0]);
    __gameTest.setCameraYaw(0);
    __gameTest.addBox({
      center:[0,2,-0.8],size:[2,4,0.25],
      climbable:true,standable:true
    });
    const graph=__gameTest.buildClimbGraph();
    const attached=__gameTest.startGrab(false);
    __gameTest.stepAttach(120);
    return {graph,attached,settled:__gameTest.playerState()};
  })()`);

  assert.ok(result.graph.holds > 0);
  assert.ok(result.graph.links > 0);
  assert.equal(result.attached.mode, 'attach');
  assert.deepEqual(result.attached.pos, [0, 0, 0]);
  assert.equal(result.settled.mode, 'hang');
  assert.equal(result.settled.onGround, false);
  assert.equal(runtime.evaluate('__gameTest.rendererFrames()'), 0);
});

test('running off a climbable edge requires explicit climb-down input to reattach', () => {
  const runtime = createRuntime({seed: 31});
  const result = runtime.json(String.raw`(()=>{
    __gameTest.addBox({
      center:[0,2,-0.8],size:[2,4,0.25],
      climbable:true,standable:true
    });
    __gameTest.buildClimbGraph();

    __gameTest.setPlayer([0,0.65,0]);
    player.onGround=false;
    __gameTest.stepGround(1,[0,0,-1],{forward:true,sprint:true});
    const automatic=__gameTest.playerState();

    __gameTest.setPlayer([0,0.65,0]);
    player.onGround=false;
    player.climbBuffer=0;
    climbDownIntentUntil=performance.now()+420;
    __gameTest.stepGround(1,[0,0,-1],{forward:true,sprint:true});
    return {automatic,explicit:__gameTest.playerState()};
  })()`);

  assert.equal(result.automatic.mode, 'ground');
  assert.equal(result.automatic.onGround, false);
  assert.equal(result.explicit.mode, 'attach');
  assert.equal(result.explicit.onGround, false);
});

test('a deliberate jump grabs the wall at airborne height instead of restarting at its base', () => {
  const runtime = createRuntime({seed: 37});
  const result = runtime.json(String.raw`(()=>{
    __gameTest.setPlayer([0,0,1.2]);
    __gameTest.setCameraYaw(0);
    __gameTest.addBox({
      center:[0,2.5,-0.8],size:[2,5,0.25],
      climbable:true,standable:true
    });
    __gameTest.buildClimbGraph();
    keys.ShiftLeft=true;keys.KeyW=true;
    player.jumpBuffer=0.14;
    const direction=new THREE.Vector3(0,0,-1);
    let ticks=0;
    for(;ticks<120&&player.mode==='ground';ticks++){
      __testClock.advance(1000/120);
      groundStep(1/120,direction);
    }
    const attached={
      state:__gameTest.playerState(),
      fromY:player.attachFrom.y,
      targetY:player.moveTo>=0?hangPos(player.moveTo,new THREE.Vector3()).y:null,
      launchY:player.jumpLaunchY
    };
    keys.ShiftLeft=false;keys.KeyW=false;
    __gameTest.stepAttach(120);
    return {ticks,attached,settled:__gameTest.playerState()};
  })()`);

  assert.equal(result.attached.state.mode, 'attach');
  assert.ok(result.attached.fromY >= result.attached.launchY + 0.3,
    `grab began before gaining jump height: ${result.attached.fromY}`);
  assert.ok(result.attached.targetY >= result.attached.fromY,
    `grab moved down from ${result.attached.fromY} to ${result.attached.targetY}`);
  assert.equal(result.settled.mode, 'hang');
  assert.ok(result.settled.pos[1] > 0.5,
    `airborne climb restarted at wall base: ${result.settled.pos[1]}`);
});

test('a player standing on an object starts climbing at that object height', () => {
  const runtime = createRuntime({seed: 43});
  const result = runtime.json(String.raw`(()=>{
    __gameTest.addBox({
      center:[0,0.5,0.4],size:[1,1,1],standable:true
    });
    __gameTest.addBox({
      center:[0,3,-0.8],size:[2,6,0.25],climbable:true,standable:true
    });
    __gameTest.buildClimbGraph();
    __gameTest.setPlayer([0,1,0.2]);
    __gameTest.setCameraYaw(0);
    const startY=player.pos.y;
    tryGrab(false);
    return {
      state:__gameTest.playerState(),
      startY,
      targetY:player.moveTo>=0?hangPos(player.moveTo,new THREE.Vector3()).y:null
    };
  })()`);

  assert.equal(result.state.mode, 'attach');
  assert.ok(result.targetY >= result.startY - 0.08,
    `climb target ${result.targetY} fell below object top ${result.startY}`);
});

test('A and D complete horizontal transfers in opposite wall directions', () => {
  const transfer = key => {
    const runtime = createRuntime({seed: 41});
    const result = runtime.json(String.raw`(()=>{
      __gameTest.setPlayer([0,0,0]);
      __gameTest.setCameraYaw(0);
      __gameTest.addBox({
        center:[0,2,-0.8],size:[2,4,0.25],
        climbable:true,standable:true
      });
      __gameTest.buildClimbGraph();
      __gameTest.startGrab(false);
      __gameTest.stepAttach(120);
      const from=player.hold;
      const fromX=HOLDS[from].pos.x;
      keys[${JSON.stringify(key)}]=true;
      hangStep(1/120);
      keys[${JSON.stringify(key)}]=false;
      const selected={mode:player.mode,from:player.moveFrom,to:player.moveTo};
      const direction=HOLDS[player.moveTo].pos.x-fromX;
      for(let i=0;i<240&&player.mode==='move';i++)moveStep(1/120);
      return {selected,direction,settled:__gameTest.playerState(),hold:player.hold};
    })()`);
    runtime.close();
    return result;
  };

  const left=transfer('KeyA');
  const right=transfer('KeyD');
  assert.equal(left.selected.mode, 'move');
  assert.equal(right.selected.mode, 'move');
  assert.ok(left.direction < 0, `A selected direction ${left.direction}`);
  assert.ok(right.direction > 0, `D selected direction ${right.direction}`);
  assert.equal(left.settled.mode, 'hang');
  assert.equal(right.settled.mode, 'hang');
  assert.notEqual(left.hold, left.selected.from);
  assert.notEqual(right.hold, right.selected.from);
});
