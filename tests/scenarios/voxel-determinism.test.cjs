'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {createRuntime} = require('../support/game-runtime.cjs');

function runBlast(seed) {
  const runtime = createRuntime({seed});
  return runtime.json(String.raw`(()=>{
    __gameTest.registerVoxel({
      x:0,y:1,z:0,width:2,height:2,depth:2,
      voxelSize:0.5,shape:'solid',color:0x999999
    });
    const killed=__gameTest.blastVoxel([0,1,0],8);
    __gameTest.stepVoxels(120);
    return {killed,snapshot:__gameTest.voxelSnapshot()};
  })()`);
}

test('seeded voxel destruction produces an exact replayable state', () => {
  const first = runBlast(12345);
  const replay = runBlast(12345);

  assert.equal(first.killed, 64);
  assert.equal(first.snapshot.stats.voxels, 0);
  assert.equal(first.snapshot.stats.debris, 192);
  assert.deepEqual(replay, first);
});

test('random seed is part of the scenario instead of hidden global state', () => {
  const first = runBlast(111);
  const second = runBlast(222);

  assert.deepEqual(second.snapshot.stats, first.snapshot.stats);
  assert.notDeepEqual(second.snapshot.matrices, first.snapshot.matrices);
});

test('cannon-strength path damage shreds a capped voxel tunnel per round', () => {
  const runtime = createRuntime({seed: 333});
  const result = runtime.json(String.raw`(()=>{
    const structure=__gameTest.registerVoxel({
      x:0,y:2,z:0,width:4,height:4,depth:4,
      voxelSize:0.5,shape:'solid',color:0x996644
    });
    const before=structure.activeN;
    const killed=voxelPhysics.damagePath(structure,
      new THREE.Vector3(0,2,2),new THREE.Vector3(0,0,-1),
      2.65,3.2,0.66,8);
    return {
      killed,removed:before-structure.activeN,
      debris:voxelPhysics.stats().debris
    };
  })()`);

  assert.deepEqual(result, {killed:8,removed:8,debris:12});
});

test('stable structures sleep until real damage wakes the load solver', () => {
  const runtime = createRuntime({seed: 334});
  const result = runtime.json(String.raw`(()=>{
    const structure=__gameTest.registerVoxel({
      x:0,y:1,z:0,width:2,height:2,depth:2,
      voxelSize:0.5,shape:'solid',color:0x996644
    });
    voxelPhysics.update(0.05);
    const slept=!structure.physicsActive;
    const damageBefore=structure.damage.reduce((sum,value)=>sum+value,0);
    voxelPhysics.damageAt(structure,new THREE.Vector3(0,1,1),0.2,
      new THREE.Vector3(0,0,-1));
    const damageAfterHit=structure.damage.reduce((sum,value)=>sum+value,0);
    const woke=structure.physicsActive;
    voxelPhysics.update(0.05);
    const damageAfterStep=structure.damage.reduce((sum,value)=>sum+value,0);
    return {slept,woke,damageBefore,damageAfterHit,damageAfterStep,
      stillSolving:structure.physicsActive};
  })()`);

  assert.equal(result.slept, true);
  assert.equal(result.woke, true);
  assert.equal(result.damageBefore, 0);
  assert.ok(result.damageAfterHit > 0);
  assert.notEqual(result.damageAfterStep, result.damageAfterHit,
    'woken structural damage must continue through the unchanged load solver');
  assert.equal(result.stillSolving, true);
});

test('a topology edit wakes only voxel fields that can depend on that support', () => {
  const runtime = createRuntime({seed: 335});
  const result = runtime.json(String.raw`(()=>{
    const add=(x,y,anchorBase)=>voxelPhysics.registerBuilding({
      x,y,z:0,width:1,height:1,depth:1,voxelSize:0.5,
      shape:'solid',color:0x888888,anchorBase,simulateLoads:false
    });
    const baseA=add(0,0.5,true),topA=add(0,1.5,false);
    const baseB=add(20,0.5,true),topB=add(20,1.5,false);
    voxelPhysics.update(0.05);
    const before=[baseA,topA,baseB,topB].map(structure=>structure.physicsActive);
    voxelPhysics.damageAt(baseA,new THREE.Vector3(0.25,0.75,0.25),2,
      new THREE.Vector3(0,-1,0));
    const after=[baseA,topA,baseB,topB].map(structure=>structure.physicsActive);
    return {before,after};
  })()`);

  assert.deepEqual(result.before, [false,false,false,false]);
  assert.deepEqual(result.after, [true,true,false,false]);
});

test('loose destroyed voxels separate instead of clipping through one another', () => {
  const runtime = createRuntime({seed: 444});
  const result = runtime.json(String.raw`(()=>{
    voxelPhysics.emitDebris(new THREE.Vector3(-0.2,2,0),new THREE.Vector3(),1,
      new THREE.Color(0.7,0.6,0.5));
    voxelPhysics.emitDebris(new THREE.Vector3(0.2,2,0),new THREE.Vector3(),1,
      new THREE.Color(0.7,0.6,0.5));
    voxelPhysics.update(1/120);
    const matrix=new THREE.Matrix4(),positions=[];
    for(let i=0;i<2;i++){
      voxelPhysics.debrisMesh.getMatrixAt(i,matrix);
      positions.push(new THREE.Vector3().setFromMatrixPosition(matrix).toArray());
    }
    return {count:voxelPhysics.stats().debris,positions};
  })()`);

  assert.equal(result.count, 2);
  assert.ok(Math.abs(result.positions[1][0]-result.positions[0][0])>0.95,
    `destroyed voxels still overlap: ${JSON.stringify(result.positions)}`);
});

test('voxel debris collides with rubble settled by the legacy body solver', () => {
  const runtime = createRuntime({seed: 445});
  const result = runtime.json(String.raw`(()=>{
    const settled=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),
      new THREE.MeshBasicMaterial());
    settled.position.set(0.2,2,0);
    settled.userData={
      half:new THREE.Vector3(0.5,0.5,0.5),position:settled.position,
      vel:new THREE.Vector3(),angVel:new THREE.Vector3(),invMass:0,sleeping:true
    };
    settledFragments.push(settled);
    voxelPhysics.emitDebris(new THREE.Vector3(-0.2,2,0),new THREE.Vector3(),1,
      new THREE.Color(0.7,0.6,0.5));
    voxelPhysics.update(1/120);
    const matrix=new THREE.Matrix4();
    voxelPhysics.debrisMesh.getMatrixAt(0,matrix);
    const debrisPosition=new THREE.Vector3().setFromMatrixPosition(matrix);
    return {
      separation:settled.position.x-debrisPosition.x,
      settled:settled.position.toArray(),sleeping:settled.userData.sleeping
    };
  })()`);

  assert.ok(result.separation>0.95,
    `voxel debris crossed settled rubble: ${result.separation}`);
  assert.deepEqual(result.settled, [0.2,2,0]);
  assert.equal(result.sleeping, true);
});

test('detached voxel slabs collide as bodies while falling', () => {
  const runtime = createRuntime({seed: 555});
  const result = runtime.json(String.raw`(()=>{
    for(const y of [4,5.4])voxelPhysics.registerBuilding({
      x:0,y,z:0,width:1,height:1,depth:1,voxelSize:0.5,
      shape:'solid',color:0x887766,anchorBase:false,simulateLoads:false
    });
    voxelPhysics.update(1/120);
    const initial=voxelPhysics.chunks.slice()
      .sort((a,b)=>a.mesh.position.y-b.mesh.position.y);
    initial[1].vel.y=-12;
    for(let i=0;i<12;i++)voxelPhysics.update(1/120);
    return {
      count:voxelPhysics.chunks.length,
      y:voxelPhysics.chunks.map(chunk=>chunk.mesh.position.y).sort((a,b)=>a-b),
      vy:voxelPhysics.chunks.map(chunk=>chunk.vel.y).sort((a,b)=>a-b)
    };
  })()`);

  assert.equal(result.count, 2);
  assert.ok(result.y[1]-result.y[0]>0.9,
    `falling slabs interpenetrated: ${JSON.stringify(result.y)}`);
  assert.ok(result.vy[1]-result.vy[0]>1.5,
    `falling slabs did not exchange momentum: ${JSON.stringify(result.vy)}`);
});

test('fast loose voxels cannot tunnel through an intact voxel wall', () => {
  const runtime = createRuntime({seed: 666});
  const result = runtime.json(String.raw`(()=>{
    const wall=voxelPhysics.registerBuilding({
      x:0,y:1,z:0,width:0.5,height:2,depth:2,voxelSize:0.5,
      shape:'solid',color:0x999999,simulateLoads:false
    });
    voxelPhysics.emitDebris(new THREE.Vector3(-1,1,0),
      new THREE.Vector3(30,0,0),0.35,new THREE.Color(0.7,0.6,0.5));
    for(let i=0;i<6;i++)voxelPhysics.update(1/120);
    const matrix=new THREE.Matrix4();
    voxelPhysics.debrisMesh.getMatrixAt(0,matrix);
    const position=new THREE.Vector3().setFromMatrixPosition(matrix);
    return {x:position.x,remaining:wall.activeN};
  })()`);

  assert.ok(result.x<-0.25,
    `fast debris crossed the intact wall: x=${result.x}`);
  assert.equal(result.remaining, 16);
});

test('an RPG blast wakes and throws an already settled debris field', () => {
  const runtime = createRuntime({seed: 777});
  const result = runtime.json(String.raw`(()=>{
    for(const x of [-1.2,-0.6,0,0.6,1.2])
      voxelPhysics.emitDebris(new THREE.Vector3(x,0.2,0),new THREE.Vector3(),0.4,
        new THREE.Color(0.7,0.6,0.5));
    const readPositions=()=>{
      const matrix=new THREE.Matrix4(),values=[];
      for(let i=0;i<voxelPhysics.stats().debris;i++){
        voxelPhysics.debrisMesh.getMatrixAt(i,matrix);
        values.push(new THREE.Vector3().setFromMatrixPosition(matrix).toArray());
      }
      return values;
    };
    for(let i=0;i<120;i++)voxelPhysics.update(1/120);
    const resting=readPositions();
    for(let i=0;i<30;i++)voxelPhysics.update(1/120);
    const still=readPositions();
    const affected=voxelPhysics.blastDebris(new THREE.Vector3(0,0.2,0),10);
    for(let i=0;i<12;i++)voxelPhysics.update(1/120);
    const thrown=readPositions();
    let restDrift=0,blastMove=0,rise=0;
    for(let i=0;i<resting.length;i++){
      const rest=new THREE.Vector3().fromArray(resting[i]);
      const before=new THREE.Vector3().fromArray(still[i]);
      const after=new THREE.Vector3().fromArray(thrown[i]);
      restDrift=Math.max(restDrift,rest.distanceTo(before));
      blastMove=Math.max(blastMove,before.distanceTo(after));
      rise=Math.max(rise,after.y-before.y);
    }
    return {affected,restDrift,blastMove,rise};
  })()`);

  assert.equal(result.affected, 5);
  assert.ok(result.restDrift<1e-5, `settled debris drifted: ${result.restDrift}`);
  assert.ok(result.blastMove>1, `blast barely moved debris: ${result.blastMove}`);
  assert.ok(result.rise>0.5, `blast did not lift debris: ${result.rise}`);
});
