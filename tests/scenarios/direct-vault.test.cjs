'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {createRuntime} = require('../support/game-runtime.cjs');

test('low cover directly ahead can be detected and vaulted without an approach walk', () => {
  const runtime = createRuntime({seed: 10});
  const started = runtime.json(String.raw`(()=>{
    __gameTest.setPlayer([0,0,0]);
    __gameTest.addBox({center:[0,0.45,-0.9],size:[1.8,0.9,0.7]});
    return {
      prompt:__gameTest.lowVaultPrompt([0,0,-1]),
      started:__gameTest.startLowVault([0,0,-1],8,16),
      state:__gameTest.playerState()
    };
  })()`);

  assert.equal(started.prompt, true);
  assert.equal(started.started, true);
  assert.equal(started.state.mode, 'vault');
  assert.equal(started.state.obstacleHeight, 0.9);

  const landed = runtime.json(String.raw`(()=>{
    __gameTest.stepVault(120);
    return __gameTest.playerState();
  })()`);
  assert.equal(landed.mode, 'ground');
  assert.equal(landed.onGround, true);
  assert.ok(landed.pos[2] < -1.7, `expected landing beyond cover, got z=${landed.pos[2]}`);
  assert.equal(runtime.evaluate('__gameTest.rendererFrames()'), 0);
});

test('vault prompt rejects cover outside the allowed height range in place', () => {
  const runtime = createRuntime({seed: 11});

  const results = runtime.json(String.raw`(()=>{
    const heights=[0.35,0.9,1.5];
    const accepted=[];
    for(const height of heights){
      __gameTest.clear();
      __gameTest.setPlayer([0,0,0]);
      __gameTest.addBox({center:[0,height*0.5,-0.9],size:[1.8,height,0.7]});
      accepted.push(__gameTest.lowVaultPrompt([0,0,-1]));
    }
    return accepted;
  })()`);

  assert.deepEqual(results, [false, true, false]);
});

test('a mantle clears the wall top before crossing its outer corner', () => {
  const runtime = createRuntime({seed: 47});
  const result = runtime.json(String.raw`(()=>{
    const wall=__gameTest.addBox({
      center:[0,2,-2],size:[2,4,4],climbable:true,standable:true
    });
    __gameTest.buildClimbGraph();
    let edge=-1;
    for(let i=0;i<HOLDS.length;i++){
      const h=HOLDS[i];
      if(!h.vault||h.out.z<0.8)continue;
      if(edge<0||h.pos.x>HOLDS[edge].pos.x)edge=i;
    }
    if(edge<0)return {edge,started:false,clipped:false,state:__gameTest.playerState()};

    const wallBox=boxes.find(box=>box.owner===wall);
    player.hold=edge;
    player.pos.copy(hangPos(edge,new THREE.Vector3()));
    player.mode='hang';player.onGround=false;
    const started=startVault();
    let clipped=false,ticks=0;
    while(player.mode==='vault'&&ticks++<240){
      vaultStep(1/120);
      if(player.mode==='vault'&&playerOverlapsBox(player.pos,wallBox))clipped=true;
    }
    return {edge,started,clipped,ticks,state:__gameTest.playerState()};
  })()`);

  assert.ok(result.edge >= 0, 'fixture needs a mantle hold near the outside corner');
  assert.equal(result.started, true);
  assert.equal(result.clipped, false, 'mantle capsule entered the wall top/corner');
  assert.equal(result.state.mode, 'ground');
  assert.equal(result.state.onGround, true);
  assert.ok(result.state.pos[1] >= 4, `expected landing on the wall, got y=${result.state.pos[1]}`);
});
