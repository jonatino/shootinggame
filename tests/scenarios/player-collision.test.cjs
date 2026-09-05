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

test('holding Space immediately jumps again on each landing', () => {
  const runtime = createRuntime({seed: 22});
  const result = runtime.json(String.raw`(()=>{
    __gameTest.setPlayer([0,0,0]);
    keys.Space=true;
    const dt=1/120,direction=new THREE.Vector3();
    let takeoffs=0,previousVelocityY=0,maxY=0;
    for(let i=0;i<720;i++){
      __testClock.advance(dt*1000);
      groundStep(dt,direction);
      if(player.vel.y>0&&previousVelocityY<=0)takeoffs++;
      previousVelocityY=player.vel.y;
      maxY=Math.max(maxY,player.pos.y);
      player.cool=Math.max(0,player.cool-dt);
      player.grace=Math.max(0,player.grace-dt);
      player.jumpGrace=Math.max(0,player.jumpGrace-dt);
      player.jumpBuffer=Math.max(0,player.jumpBuffer-dt);
      player.climbBuffer=Math.max(0,player.climbBuffer-dt);
      player.vaultRecovery=Math.max(0,player.vaultRecovery-dt);
    }
    keys.Space=false;
    return {takeoffs,maxY,state:__gameTest.playerState()};
  })()`);

  assert.ok(result.takeoffs>=5,
    `held Space only produced ${result.takeoffs} takeoffs`);
  assert.ok(result.maxY>1.25,
    `held jumps never left the ground: max y=${result.maxY}`);
  assert.ok(result.maxY<1.32, 'shared gravity must preserve the authored jump height');
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

test('voxel collider toggles do not rebuild the complete static world hash', () => {
  const runtime = createRuntime({seed: 24});
  const result = runtime.json(String.raw`(()=>{
    __gameTest.addBox({center:[0,1,-1],size:[2,2,0.5],standable:false});
    const original=boxes[0],point=new THREE.Vector3(0,1,-1);
    const initiallyPresent=getStaticBoxCandidatesAt(point,1).includes(original);
    const initiallyClean=!staticBoxGridDirty;
    removePhysicsBox(original);
    const stayedCleanAfterRemove=!staticBoxGridDirty;
    const absentWhileInactive=!getStaticBoxCandidatesAt(point,1).includes(original);
    addPhysicsBox(original);
    const stayedCleanAfterRestore=!staticBoxGridDirty;
    const presentAfterRestore=getStaticBoxCandidatesAt(point,1).includes(original);
    const added=new THREE.Box3(
      new THREE.Vector3(20,0,20),new THREE.Vector3(21,1,21));
    addPhysicsBox(added);
    const newBoxWasIndexed=getStaticBoxCandidatesAt(
      new THREE.Vector3(20.5,0.5,20.5),1).includes(added);
    return {initiallyPresent,initiallyClean,stayedCleanAfterRemove,
      absentWhileInactive,stayedCleanAfterRestore,presentAfterRestore,
      newBoxWasIndexed};
  })()`);

  assert.deepEqual(result, {
    initiallyPresent:true,initiallyClean:true,stayedCleanAfterRemove:true,
    absentWhileInactive:true,stayedCleanAfterRestore:true,
    presentAfterRestore:true,newBoxWasIndexed:true
  });
});
