'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createRuntime}=require('../support/game-runtime.cjs');

function tiltedChunk(mode){
  const runtime=createRuntime({seed:920});
  runtime.evaluate(`
    const st=voxelPhysics.registerBuilding({x:0,y:20,z:0,width:1,height:4,depth:1,
      voxelSize:0.5,shape:'solid',anchorBase:false,simulateLoads:false});
    voxelPhysics.update(1/120);
    const subject=voxelPhysics.chunks[0];
    subject.mode='${mode}';subject.angle=0.65;subject.omega=0.4;subject.alpha=0.3;
    subject.axis.set(1,0,0);subject.vel.set(0,0,0);
    subject.mesh.quaternion.setFromAxisAngle(subject.axis,subject.angle);
    subject.pivot.set(0,18,0);subject.pivotOffset.set(0,2,0);
    subject.mesh.position.copy(subject.pivotOffset)
      .applyQuaternion(subject.mesh.quaternion).add(subject.pivot);
    const beforePosition=subject.mesh.position.clone(),beforeRotation=subject.mesh.quaternion.clone();
    const beforePoint=V(subject.lx[0],subject.ly[0],subject.lz[0])
      .applyQuaternion(beforeRotation).add(beforePosition);
    const inherited=subject.mode==='pivot'?V().crossVectors(
      subject.axis.clone().multiplyScalar(subject.omega),
      beforePosition.clone().sub(subject.pivot)):subject.vel.clone();
  `);
  return runtime;
}

for(const mode of ['free','pivot'])test(`shooting a ${mode} slab changes motion without resetting its existing pose`,()=>{
  const runtime=tiltedChunk(mode);
  const result=runtime.json(`(()=>{
    const direction=V(-1,0,0),power=9;
    voxelPhysics.damageChunk(subject.mesh,direction,power);
    const immediate={position:subject.mesh.position.distanceTo(beforePosition),
      rotation:subject.mesh.quaternion.angleTo(beforeRotation),mode:subject.mode,
      impulse:subject.vel.clone().sub(inherited).dot(direction)};
    voxelPhysics.update(1/120);
    const point=V(subject.lx[0],subject.ly[0],subject.lz[0])
      .applyQuaternion(subject.mesh.quaternion).add(subject.mesh.position);
    return {immediate,rotation:subject.mesh.quaternion.angleTo(beforeRotation),
      travel:point.distanceTo(beforePoint),expectedImpulse:power/Math.sqrt(subject.count)};
  })()`);
  assert.equal(result.immediate.position,0);
  assert.ok(result.immediate.rotation<1e-7);
  assert.equal(result.immediate.mode,'free');
  assert.ok(Math.abs(result.immediate.impulse-result.expectedImpulse)<1e-6);
  assert.ok(result.rotation<=3/120+1e-6,`rotation jumped by ${result.rotation} radians`);
  assert.ok(result.travel<0.1,`the slab popped ${result.travel} metres in one tick`);
});

test('a blast releases a tilted pivot with its existing momentum and orientation',()=>{
  const runtime=tiltedChunk('pivot');
  const result=runtime.json(`(()=>{
    voxelPhysics.blastChunks(subject.mesh.position.clone().add(V(2,0,0)),3);
    const immediate={mode:subject.mode,position:subject.mesh.position.distanceTo(beforePosition),
      rotation:subject.mesh.quaternion.angleTo(beforeRotation),
      verticalImpulse:subject.vel.y-inherited.y};
    voxelPhysics.update(1/120);
    return {immediate,rotation:subject.mesh.quaternion.angleTo(beforeRotation),
      travel:subject.mesh.position.distanceTo(beforePosition)};
  })()`);
  assert.equal(result.immediate.mode,'free');
  assert.equal(result.immediate.position,0);
  assert.ok(result.immediate.rotation<1e-7);
  assert.ok(result.immediate.verticalImpulse>0.8);
  assert.ok(result.rotation<=2.8/120+1e-6,`blast reset rotation by ${result.rotation}`);
  assert.ok(result.travel<0.1,`blast teleported slab ${result.travel} metres`);
});

test('repeated shots and a vertical blast keep a falling section rotation continuous',()=>{
  const runtime=tiltedChunk('free');
  const result=runtime.json(`(()=>{
    let maxTurn=0,maxNormError=0;
    for(let tick=0;tick<60;tick++){
      const previous=subject.mesh.quaternion.clone();
      if(tick%4===0)voxelPhysics.damageChunk(subject.mesh,V(tick%8===0?1:-1,0,0),7.95);
      if(tick===20)voxelPhysics.blastChunks(subject.mesh.position.clone().add(V(0,2,0)),3);
      voxelPhysics.update(1/120);
      maxTurn=Math.max(maxTurn,previous.angleTo(subject.mesh.quaternion));
      maxNormError=Math.max(maxNormError,Math.abs(subject.mesh.quaternion.length()-1));
    }
    return {maxTurn,maxNormError,live:voxelPhysics.chunks.includes(subject)};
  })()`);
  assert.equal(result.live,true);
  assert.ok(result.maxTurn<=3/120+1e-6,`sustained hits snapped rotation: ${result.maxTurn}`);
  assert.ok(result.maxNormError<1e-10);
});
