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

test('reachable cover above vault height gets a direct pull-up onto its top', () => {
  const runtime = createRuntime({seed: 19});
  const started = runtime.json(String.raw`(()=>{
    __gameTest.setPlayer([0,0,0]);
    __gameTest.addBox({center:[0,0.85,-0.9],size:[2,1.7,1.1]});
    return {
      lowPrompt:__gameTest.lowVaultPrompt([0,0,-1]),
      climbPrompt:__gameTest.quickClimbPrompt([0,0,-1]),
      started:__gameTest.startQuickClimb([0,0,-1]),
      state:__gameTest.playerState()
    };
  })()`);

  assert.equal(started.lowPrompt, false);
  assert.equal(started.climbPrompt, true);
  assert.equal(started.started, true);
  assert.equal(started.state.mode, 'vault');
  assert.equal(started.state.vaultKind, 'quick');
  assert.equal(started.state.obstacleHeight, 1.7);

  const landed = runtime.json(String.raw`(()=>{
    let clipped=false,ticks=0;
    while(player.mode==='vault'&&ticks++<120){
      vaultStep(1/120);
      if(player.mode==='vault'&&playerOverlapsBox(player.pos,boxes[0]))clipped=true;
    }
    return {clipped,ticks,state:__gameTest.playerState()};
  })()`);
  assert.equal(landed.clipped, false, 'pull-up capsule entered the obstacle');
  assert.equal(landed.state.mode, 'ground');
  assert.equal(landed.state.onGround, true);
  assert.ok(landed.state.pos[1] >= 1.7,
    `expected landing on cover, got y=${landed.state.pos[1]}`);
  assert.ok(landed.state.pos[2] < -0.55&&landed.state.pos[2] > -1.45,
    `expected landing within the cover top, got z=${landed.state.pos[2]}`);
});

test('the prompted pull-up eases through plant, lift, and step-through phases', () => {
  const runtime = createRuntime({seed: 20});
  const motion = runtime.json(String.raw`(()=>{
    __gameTest.setPlayer([0,0,0]);
    __gameTest.addBox({center:[0,0.85,-0.9],size:[2,1.7,1.1]});
    const started=tryQuickClimb(new THREE.Vector3(0,0,-1));
    const point=new THREE.Vector3(),previous=new THREE.Vector3();
    let firstStep=0,lastStep=0,peakStep=0,peakHorizontalStep=0,plantHeight=0;
    for(let i=0;i<=100;i++){
      quickClimbPathPoint(player.vaultFrom,player.vaultTo,i/100,
        player.vaultClearance,player.vaultPush,player.vaultNormal,
        player.vaultForwardStart,player.vaultContactPoint,point);
      if(i===10)plantHeight=point.y-player.vaultFrom.y;
      if(i){
        const step=point.distanceTo(previous);
        const horizontalStep=Math.hypot(point.x-previous.x,point.z-previous.z);
        if(i===1)firstStep=step;
        if(i===100)lastStep=step;
        peakStep=Math.max(peakStep,step);
        peakHorizontalStep=Math.max(peakHorizontalStep,horizontalStep);
      }
      previous.copy(point);
    }
    return {started,duration:player.vaultDuration,
      forwardStart:player.vaultForwardStart,plantHeight,
      firstStep,lastStep,peakStep,peakHorizontalStep};
  })()`);

  assert.equal(motion.started, true);
  assert.ok(motion.duration>=0.68&&motion.duration<=0.86);
  assert.ok(motion.plantHeight<0.01,
    'the hands need time to plant before the root begins lifting');
  assert.ok(motion.forwardStart>0.5&&motion.forwardStart<0.72,
    'forward transfer should follow the pull without being crammed into touchdown');
  assert.ok(motion.firstStep<motion.peakStep*0.1);
  assert.ok(motion.lastStep<motion.peakStep*0.1);
  assert.ok(motion.peakHorizontalStep<0.05,
    'the root must not zip across the lip in one late movement spike');
});

test('Space falls back to a top landing when low cover is too deep to vault through', () => {
  const runtime = createRuntime({seed: 21});
  const result = runtime.json(String.raw`(()=>{
    __gameTest.setPlayer([0,0,0]);
    __gameTest.addBox({center:[0,0.5,-1.45],size:[2,1,2.2]});
    const lowPrompt=__gameTest.lowVaultPrompt([0,0,-1]);
    const climbPrompt=__gameTest.quickClimbPrompt([0,0,-1]);
    player.jumpBuffer=0.14;
    __gameTest.stepGround(1,[0,0,0]);
    return {lowPrompt,climbPrompt,state:__gameTest.playerState()};
  })()`);

  assert.equal(result.lowPrompt, false);
  assert.equal(result.climbPrompt, true);
  assert.equal(result.state.mode, 'vault');
  assert.equal(result.state.vaultKind, 'quick');

  const inputGate = runtime.json(String.raw`(()=>{
    __gameTest.clear();
    __gameTest.setPlayer([0,0,0]);
    __gameTest.addBox({center:[0,0.85,-0.9],size:[2,1.7,1.1]});
    __gameTest.stepGround(1,[0,0,-1],{forward:true,sprint:true});
    const sprintState=__gameTest.playerState();
    player.jumpBuffer=0.14;
    __gameTest.stepGround(1,[0,0,0]);
    return {sprintState,spaceState:__gameTest.playerState()};
  })()`);
  assert.equal(inputGate.sprintState.mode, 'ground',
    'Shift+W must not pull a grounded player directly onto an object');
  assert.equal(inputGate.sprintState.vaultKind, 'none');
  assert.equal(inputGate.spaceState.mode, 'vault');
  assert.equal(inputGate.spaceState.vaultKind, 'quick');
});

test('direct pull-up rejects an unreachable or undersized landing top', () => {
  const runtime = createRuntime({seed: 23});
  const accepted = runtime.json(String.raw`(()=>{
    const fixtures=[
      {center:[0,1.2,-0.9],size:[2,2.4,1.1]},
      {center:[0,0.85,-0.58],size:[2,1.7,0.34]}
    ];
    const results=[];
    for(const fixture of fixtures){
      __gameTest.clear();
      __gameTest.setPlayer([0,0,0]);
      __gameTest.addBox(fixture);
      results.push(__gameTest.quickClimbPrompt([0,0,-1]));
    }
    return results;
  })()`);

  assert.deepEqual(accepted, [false, false]);
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
