'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createRuntime}=require('../support/game-runtime.cjs');

for(const detached of [false,true])
test(`${detached?'detached':'intact'} voxel rays match exhaustive hits through rotation, scaling and short ranges`,()=>{
  const runtime=createRuntime({seed:1121});
  const result=runtime.json(`(()=>{
    const st=voxelPhysics.registerBuilding({x:0,y:30,z:0,width:5,height:6,depth:3,
      voxelSize:0.4,shape:'solid',anchorBase:${!detached},simulateLoads:false});
    ${detached?'voxelPhysics.update(1/120);':''}
    const chunk=${detached?'voxelPhysics.chunks[0]':'null'},mesh=chunk?chunk.mesh:st.mesh;
    const referenceGeometry=mesh.geometry.clone();referenceGeometry.boundingSphere=null;
    referenceGeometry.computeBoundingSphere();
    let rays=0,hitRays=0,maxVisited=0,maxError=0;
    const failures=[];
    function compare(origin,direction,near,far){
      rc.set(origin,direction);rc.near=near;rc.far=far;
      const actual=[];mesh.raycast(rc,actual);
      maxVisited=Math.max(maxVisited,(chunk||st).lastRaycastCellTests);
      const originalGeometry=mesh.geometry;mesh.geometry=referenceGeometry;
      const expected=[];THREE.InstancedMesh.prototype.raycast.call(mesh,rc,expected);
      mesh.geometry=originalGeometry;
      const sort=(a,b)=>a.distance-b.distance||a.instanceId-b.instanceId||a.faceIndex-b.faceIndex;
      actual.sort(sort);expected.sort(sort);rays++;
      if(expected.length)hitRays++;
      if(actual.length!==expected.length){failures.push({rays,actual:actual.length,expected:expected.length});return;}
      for(let i=0;i<actual.length;i++){
        const a=actual[i],b=expected[i];maxError=Math.max(maxError,a.point.distanceTo(b.point));
        if(a.instanceId!==b.instanceId||a.faceIndex!==b.faceIndex||a.point.distanceTo(b.point)>1e-8||
          a.face.normal.distanceTo(b.face.normal)>1e-8)failures.push({rays,instance:a.instanceId,expected:b.instanceId});
      }
    }
    for(let phase=0;phase<3;phase++){
      mesh.quaternion.setFromEuler(new THREE.Euler(phase*0.43,phase*0.31,-phase*0.17));
      mesh.scale.set(1+phase*0.2,1-phase*0.1,1+phase*0.3);mesh.updateMatrixWorld(true);
      if(phase===1){
        if(chunk)voxelPhysics.damageChunk(mesh,V(1,0,0),7.95,mesh.position.clone(),3,0.6,8);
        else voxelPhysics.damagePath(st,V(0,30,2),V(0,0,-1),2.65,3.2,0.6,8);
      }
      for(let sample=0;sample<48;sample++){
        const count=chunk?chunk.count:st.activeN,k=(sample*97)%count;
        const matrix=new THREE.Matrix4();mesh.getMatrixAt(k,matrix);
        const target=V().setFromMatrixPosition(matrix).applyMatrix4(mesh.matrixWorld);
        const origin=target.clone().add(V(Math.cos(sample*2.4)*9,3+sample%5,Math.sin(sample*2.4)*9));
        const direction=target.clone().sub(origin).normalize();
        compare(origin,direction,0,40);compare(origin,direction,0,0.2);
        compare(origin,direction,8,11);compare(target,direction,0,2);
        rc.set(origin,direction);rc.near=0;rc.far=40;
        const hits=[];mesh.raycast(rc,hits);hits.sort((a,b)=>a.distance-b.distance);
        if(hits.length)compare(origin,direction,hits[0].distance,hits[0].distance);
      }
    }
    return {rays,hitRays,maxVisited,maxError,failures:failures.slice(0,8),
      visitLimit:st.nx+st.ny+st.nz+3,count:mesh.count};
  })()`);
  assert.deepEqual(result.failures,[],JSON.stringify(result));
  assert.ok(result.hitRays>100);
  assert.equal(result.maxError,0);
  assert.ok(result.maxVisited>0&&result.maxVisited<=result.visitLimit);
  assert.ok(result.maxVisited<result.count/10,'ray work must follow crossed cells, not total body size');
});
