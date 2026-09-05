'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createRuntime}=require('../support/game-runtime.cjs');

for(const y of [5.3,5.9])test(`a fragment at height ${y} slides off a continuous wall instead of sleeping on an internal seam`,()=>{
  const runtime=createRuntime({seed:930});
  const result=runtime.json(`(()=>{
    const wall=voxelPhysics.registerBuilding({x:0,y:5,z:0,width:1,height:10,depth:4,
      voxelSize:1,shape:'solid',simulateLoads:false});
    voxelPhysics.emitDebris(V(0.2,${y},0),V(),0.35);
    for(let t=0;t<360;t++)voxelPhysics.update(1/120);
    const m=new THREE.Matrix4();voxelPhysics.debrisMesh.getMatrixAt(0,m);
    return {position:m.elements.slice(12,15),voxels:wall.activeN};
  })()`);
  assert.ok(result.position[1]<0.4,`fragment remained suspended: ${result.position}`);
  assert.equal(result.voxels,40,'resolving an overlap must not destroy the wall');
});

test('a fragment settles on a real ledge and falls when that support is shot away',()=>{
  const runtime=createRuntime({seed:931});
  const result=runtime.json(`(()=>{
    // A narrow ledge isolates loss of support from the shot's secondary rubble
    // impacts and from landing back on neighboring, unbroken top cells.
    const ledge=voxelPhysics.registerBuilding({x:0,y:2,z:0,width:0.4,height:4,depth:0.4,
      voxelSize:1,shape:'solid',simulateLoads:false});
    voxelPhysics.emitDebris(V(0,4.4,0),V(),0.35);
    const m=new THREE.Matrix4();
    const read=()=>{voxelPhysics.debrisMesh.getMatrixAt(0,m);return m.elements[13];};
    for(let i=0;i<240;i++)voxelPhysics.update(1/120);
    const rested=read();
    for(let i=0;i<60;i++)voxelPhysics.update(1/120);
    const quiet=read();
    voxelPhysics.damageAt(ledge,V(0,3.5,0),10,V(0,0,1));
    for(let i=0;i<48;i++)voxelPhysics.update(1/120);
    return {rested,quiet,fallen:read()};
  })()`);
  assert.ok(result.rested>4.15&&result.rested<4.35,JSON.stringify(result));
  assert.ok(Math.abs(result.rested-result.quiet)<0.005,'a supported fragment should settle');
  assert.ok(result.fallen<result.quiet-0.3,`lost support did not wake the fragment: ${JSON.stringify(result)}`);
});

test('a dense airborne rubble cloud retains gravitational acceleration while pieces collide',()=>{
  const runtime=createRuntime({seed:935});
  const result=runtime.json(`(()=>{
    for(let y=0;y<12;y++)for(let x=0;x<3;x++)for(let z=0;z<3;z++)
      voxelPhysics.emitDebris(V(x*0.5,20+y*0.5,z*0.5),V(),0.4);
    const m=new THREE.Matrix4();
    const centerOfMass=()=>{let sum=0;for(let i=0;i<108;i++){
      voxelPhysics.debrisMesh.getMatrixAt(i,m);sum+=m.elements[13];
    }return sum/108;};
    voxelPhysics.syncVisuals();const before=centerOfMass();
    for(let t=0;t<120;t++)voxelPhysics.update(1/120);
    return {before,after:centerOfMass(),pieces:voxelPhysics.stats().debris};
  })()`);
  assert.equal(result.pieces,108);
  assert.ok(Math.abs(result.after-(result.before-9.81/2))<0.002,
    `contacts cancelled the cloud's gravity: ${JSON.stringify(result)}`);
});

test('fast fragments cannot bounce off buried horizontal seams in a vertical wall',()=>{
  const runtime=createRuntime({seed:936});
  const result=runtime.json(`(()=>{
    voxelPhysics.registerBuilding({x:0,y:5,z:0,width:1,height:10,depth:4,
      voxelSize:1,shape:'solid',simulateLoads:false});
    voxelPhysics.emitDebris(V(0.6,5.4,0),V(0,-30,0),0.35);
    for(let t=0;t<10;t++)voxelPhysics.update(1/120);
    const m=new THREE.Matrix4();voxelPhysics.debrisMesh.getMatrixAt(0,m);
    return m.elements.slice(12,15);
  })()`);
  const time=10/120;
  assert.ok(Math.abs(result[1]-(5.4-30*time-9.81*time*time/2))<0.001,
    `an internal face reflected the fragment upwards: ${result}`);
  assert.ok(result[0]>0.7,'fragment should separate from the wall');
});

test('the interface between adjoining building tiers cannot support a fragment',()=>{
  const runtime=createRuntime({seed:930});
  const result=runtime.json(`(()=>{
    for(const y of [2.5,7.5])voxelPhysics.registerBuilding({x:0,y,z:0,
      width:1,height:5,depth:4,voxelSize:1,shape:'solid',simulateLoads:false});
    voxelPhysics.emitDebris(V(0.2,4.9,0),V(),0.35);
    for(let t=0;t<360;t++)voxelPhysics.update(1/120);
    const m=new THREE.Matrix4();voxelPhysics.debrisMesh.getMatrixAt(0,m);
    return m.elements.slice(12,15);
  })()`);
  assert.ok(result[1]<0.4,`fragment froze inside the tier interface: ${result}`);
});

test('a detached section in contact with a vertical wall keeps falling along it',()=>{
  const runtime=createRuntime({seed:934});
  const result=runtime.json(`(()=>{
    voxelPhysics.registerBuilding({x:4,y:10,z:0,width:1,height:2,depth:1,
      voxelSize:0.5,shape:'solid',anchorBase:false,simulateLoads:false});
    voxelPhysics.update(1/120);
    const subject=voxelPhysics.chunks[0];
    voxelPhysics.registerBuilding({x:0,y:10,z:0,width:1,height:20,depth:4,
      voxelSize:1,shape:'solid',simulateLoads:false});
    subject.mode='free';subject.mesh.position.set(0.7,10,0);
    subject.mesh.quaternion.identity();subject.axis.set(0,1,0);
    subject.omega=0;subject.vel.set(-0.05,0,0);
    for(let i=0;i<120;i++)voxelPhysics.update(1/120);
    return {position:subject.mesh.position.toArray(),velocity:subject.vel.toArray(),
      live:voxelPhysics.chunks.includes(subject)};
  })()`);
  assert.equal(result.live,true);
  assert.ok(result.position[0]>=0.98,`section remained inside the wall: ${result.position}`);
  assert.ok(result.position[1]<5.15&&result.position[1]>4.9,
    `wall contact cancelled falling motion: ${JSON.stringify(result)}`);
  assert.ok(Math.abs(result.velocity[1]+9.81)<0.05);
});
