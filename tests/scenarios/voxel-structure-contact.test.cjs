'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createRuntime}=require('../support/game-runtime.cjs');

test('a core touching the inside of a hollow shell separates toward the room',()=>{
  const runtime=createRuntime({seed:951});
  const result=runtime.json(`(()=>{
    const shell=voxelPhysics.registerBuilding({x:0,y:10,z:0,width:5,height:4,depth:5,
      voxelSize:1,anchorBase:false,simulateLoads:false,
      occupancy:(lx,ly,lz,x,y,z,nx,ny,nz)=>x===0||x===nx-1||z===0||z===nz-1});
    const core=voxelPhysics.registerBuilding({x:1.1,y:10,z:0,width:1,height:4,depth:1,
      voxelSize:1,shape:'solid',anchorBase:false,simulateLoads:false});
    voxelPhysics.update(1/120);
    const outer=voxelPhysics.chunks.find(c=>c.st===shell);
    const inner=voxelPhysics.chunks.find(c=>c.st===core);
    const centerOfMass=()=>
      (outer.mesh.position.x*outer.count+inner.mesh.position.x*inner.count)/(outer.count+inner.count);
    const before={inner:inner.mesh.position.x,outer:outer.mesh.position.x,com:centerOfMass()};
    voxelPhysics.update(1/120);
    return {before,inner:inner.mesh.position.x,outer:outer.mesh.position.x,com:centerOfMass()};
  })()`);
  assert.ok(result.inner<result.before.inner-0.015,
    `the shell pushed its core out through the wall: ${JSON.stringify(result)}`);
  assert.ok(result.outer>result.before.outer,'the shell receives the opposite contact correction');
  assert.ok(Math.abs(result.com-result.before.com)<1e-8,'contacts must preserve the center of mass');
});

test('cannon damage to a brick house cannot eject its core through position correction',()=>{
  const runtime=createRuntime({seed:950});
  const result=runtime.json(`(()=>{
    const st=voxelPhysics.registerBuilding({x:0,z:0,width:8,height:7,depth:6,voxelSize:0.68});
    const initial=st.activeN;let shot=0,maxCorrection=0,maxStep=0,maxChunks=0,tracked=0;
    for(let tick=0;tick<480;tick++){
      if(tick<240&&tick%4===0){
        voxelPhysics.damagePath(st,V(-3.5+(shot%12)*0.64,
          0.7+Math.floor(shot/12)*0.32,3.01),V(0,0,-1),2.65,3.2,0.66,8);
        shot++;
      }
      const before=new Map(voxelPhysics.chunks.map(c=>[c,{
        p:c.mesh.position.clone(),v:c.vel.clone(),mode:c.mode}]));
      voxelPhysics.update(1/120,true);
      maxChunks=Math.max(maxChunks,voxelPhysics.chunks.length);
      for(const c of voxelPhysics.chunks){
        const old=before.get(c);if(!old||old.mode!=='free'||c.mode!=='free')continue;
        tracked++;
        const expected=old.p.clone().addScaledVector(old.v,1/120);
        expected.y-=9.81/(120*120);
        maxCorrection=Math.max(maxCorrection,c.mesh.position.distanceTo(expected));
        maxStep=Math.max(maxStep,c.mesh.position.distanceTo(old.p));
      }
    }
    return {removed:initial-st.activeN,maxChunks,tracked,maxCorrection,maxStep,
      finite:voxelPhysics.chunks.every(c=>c.mesh.position.toArray().every(Number.isFinite))};
  })()`);
  assert.ok(result.removed>100&&result.maxChunks>=2&&result.tracked>100,
    `the shot pattern must create colliding structural sections: ${JSON.stringify(result)}`);
  assert.equal(result.finite,true);
  assert.ok(result.maxCorrection<0.15,
    `a collision teleported a connected section: ${JSON.stringify(result)}`);
  assert.ok(result.maxStep<0.2,`a section popped out during the collapse: ${JSON.stringify(result)}`);
});
