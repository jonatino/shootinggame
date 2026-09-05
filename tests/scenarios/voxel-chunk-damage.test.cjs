'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createRuntime}=require('../support/game-runtime.cjs');

test('cannon fire keeps carving a tilted facade after its original building is destroyed',()=>{
  const runtime=createRuntime({gameplay:true,seed:960});
  const result=runtime.json(`(()=>{
    const dObj={voxelManaged:true,alive:false,destroyed:true,hp:0};
    const st=voxelPhysics.registerBuilding({dObj,x:0,y:20,z:0,width:4,height:4,depth:2,
      voxelSize:0.5,shape:'solid',anchorBase:false,simulateLoads:false});
    dObj.voxelStructure=st;voxelPhysics.update(1/120);
    const subject=voxelPhysics.chunks[0],initial=subject.count;
    subject.mesh.quaternion.setFromEuler(new THREE.Euler(0.65,0.3,0.1));
    const rotation=subject.mesh.quaternion.clone();
    const world=(c,k)=>V(c.lx[k],c.ly[k],c.lz[k])
      .applyQuaternion(c.mesh.quaternion).add(c.mesh.position);
    const before=Array.from({length:initial},(_,k)=>world(subject,k));
    const remaining=()=>voxelPhysics.chunks.reduce((n,c)=>n+c.count,0);
    const fireAt=(c,local)=>{
      const dir=V(0,0,-1).applyQuaternion(c.mesh.quaternion);
      const origin=local.clone().applyQuaternion(c.mesh.quaternion).add(c.mesh.position);
      scene.updateMatrixWorld(true);voxelPhysics.syncVisuals();
      rc.set(origin,dir);rc.near=0;rc.far=20;
      const hit=rc.intersectObjects(collectShotTargets(origin,dir,20),false)[0];
      if(!hit||!hit.object.userData.voxelChunk)return false;
      damageStructureFromBullet(structuralTargetForMesh(hit.object),hit.object,
        hit.point,dir,WEAPONS.cannon,UP);
      return true;
    };
    const hit=fireAt(subject,V(0.25,0.25,3));
    const firstRemoved=initial-remaining();
    let maxJump=0;
    for(const c of voxelPhysics.chunks)for(let k=0;k<c.count;k++)
      maxJump=Math.max(maxJump,Math.min(...before.map(p=>p.distanceTo(world(c,k)))));
    const rotationError=subject.mesh.quaternion.angleTo(rotation);
    let shots=1,stalled=false;
    while(voxelPhysics.chunks.length&&shots<initial){
      const c=voxelPhysics.chunks[0],count=remaining();
      if(!fireAt(c,V(c.lx[0],c.ly[0],c.radius+1))||remaining()>=count){stalled=true;break;}
      shots++;
    }
    return {hit,firstRemoved,maxJump,rotationError,stalled,shots,remaining:remaining(),
      staticCells:st.activeN,debris:voxelPhysics.stats().debris,destroyed:debrisKilled,
      retired:!occluders.includes(subject.mesh)&&!standables.includes(subject.mesh)};
  })()`);
  assert.equal(result.hit,true);
  assert.equal(result.firstRemoved,8,'a cannon round must retain its eight-cell penetration budget');
  assert.ok(result.maxJump<1e-5,`surviving bricks jumped on impact: ${JSON.stringify(result)}`);
  assert.ok(result.rotationError<1e-7);
  assert.equal(result.stalled,false,'continued fire must keep destroying the fallen wall');
  assert.equal(result.remaining,0);
  assert.equal(result.staticCells,0,'shooting a fallen wall must not reconstruct the original building');
  assert.equal(result.destroyed,256);
  assert.ok(result.debris>0&&result.debris<=3600);
  assert.equal(result.retired,true);
});

test('small arms retain accumulated cell damage through detachment and hit tilted brick corners',()=>{
  const runtime=createRuntime({gameplay:true,seed:961});
  const result=runtime.json(`(()=>{
    const dObj={voxelManaged:true,alive:false,destroyed:true,hp:0};
    const st=voxelPhysics.registerBuilding({dObj,x:0,y:20,z:0,width:2,height:2,depth:2,
      voxelSize:0.5,shape:'solid',anchorBase:false,simulateLoads:false});
    dObj.voxelStructure=st;st.damage.fill(0.5);voxelPhysics.update(1/120);
    const c=voxelPhysics.chunks[0],initial=c.count;
    c.mesh.quaternion.setFromEuler(new THREE.Euler(0.65,0.3,0));
    const point=V(c.lx[0]+st.sx*0.46,c.ly[0]+st.sy*0.46,c.lz[0]-st.sz*0.47)
      .applyQuaternion(c.mesh.quaternion).add(c.mesh.position);
    const dir=V(0,0,1).applyQuaternion(c.mesh.quaternion),counts=[];
    for(let shot=0;shot<3;shot++){
      damageStructureFromBullet(dObj,c.mesh,point,dir,WEAPONS.pistol,UP);
      counts.push(voxelPhysics.chunks.reduce((n,c)=>n+c.count,0));
    }
    return {initial,counts,debris:voxelPhysics.stats().debris};
  })()`);
  assert.deepEqual(result.counts,[result.initial,result.initial,result.initial-1]);
  assert.ok(result.debris>0);
});

test('shooting the last bridge between two falling sections releases both with continuous motion',()=>{
  const runtime=createRuntime({seed:962});
  const result=runtime.json(`(()=>{
    const st=voxelPhysics.registerBuilding({x:0,y:20,z:0,width:5,height:2,depth:1,
      voxelSize:1,anchorBase:false,simulateLoads:false,
      occupancy:(lx,ly,lz,x,y)=>x!==2||y===0});
    voxelPhysics.update(1/120);const c=voxelPhysics.chunks[0];
    c.mesh.quaternion.setFromEuler(new THREE.Euler(0.6,0.2,0.1));
    c.vel.set(1,-2,3);c.axis.set(1,0,0);c.omega=0.4;
    const position=c.mesh.position.clone(),rotation=c.mesh.quaternion.clone();
    const world=k=>V(c.lx[k],c.ly[k],c.lz[k]).applyQuaternion(rotation).add(position);
    const before=Array.from({length:c.count},(_,k)=>world(k));
    const bridge=Array.from({length:c.count},(_,k)=>k).find(k=>Math.abs(c.lx[k])<0.01);
    const direction=V(0,0,-1),impulse=3;
    const expectedVelocity=c.vel.clone().addScaledVector(direction,impulse/Math.sqrt(c.count));
    voxelPhysics.damageChunk(c.mesh,direction,impulse,world(bridge));
    let maxJump=0,maxVelocityError=0,maxRotationError=0;
    for(const part of voxelPhysics.chunks){
      const expected=V().crossVectors(part.axis.clone().multiplyScalar(part.omega),
        part.mesh.position.clone().sub(position)).add(expectedVelocity);
      maxVelocityError=Math.max(maxVelocityError,expected.distanceTo(part.vel));
      maxRotationError=Math.max(maxRotationError,rotation.angleTo(part.mesh.quaternion));
      for(let k=0;k<part.count;k++){
        const p=V(part.lx[k],part.ly[k],part.lz[k])
          .applyQuaternion(part.mesh.quaternion).add(part.mesh.position);
        maxJump=Math.max(maxJump,Math.min(...before.map(old=>old.distanceTo(p))));
      }
    }
    const sizes=voxelPhysics.chunks.map(part=>part.count).sort((a,b)=>a-b);
    for(let tick=0;tick<12;tick++)voxelPhysics.update(1/120);
    return {sizes,maxJump,maxVelocityError,maxRotationError,
      finite:voxelPhysics.chunks.every(part=>part.mesh.position.toArray().every(Number.isFinite))};
  })()`);
  assert.deepEqual(result.sizes,[4,4],'severed masonry must not remain one rigid slab');
  assert.ok(result.maxJump<1e-5);
  assert.ok(result.maxVelocityError<1e-6);
  assert.ok(result.maxRotationError<1e-7);
  assert.equal(result.finite,true);
});

test('an explosion destroys nearby detached bricks without skipping another chunk or damaging distant rubble',()=>{
  const runtime=createRuntime({seed:963});
  const result=runtime.json(`(()=>{
    const fields=[0,1.2,10].map(x=>voxelPhysics.registerBuilding({x,y:20,z:0,
      width:1,height:1,depth:1,voxelSize:0.5,shape:'solid',anchorBase:false,simulateLoads:false}));
    voxelPhysics.update(1/120);
    const subjects=fields.map(st=>voxelPhysics.chunks.find(c=>c.st===st));
    const farPosition=subjects[2].mesh.position.clone();
    voxelPhysics.blastChunks(V(0,20,0),10);voxelPhysics.syncVisuals();
    return {counts:fields.map(st=>voxelPhysics.chunks.filter(c=>c.st===st).reduce((n,c)=>n+c.count,0)),
      farTravel:subjects[2].mesh.position.distanceTo(farPosition),farSpeed:subjects[2].vel.length(),
      debris:voxelPhysics.stats().debris};
  })()`);
  assert.equal(result.counts[0],0);
  assert.ok(result.counts[1]<8,'removing a chunk must not skip its neighbor in the explosion');
  assert.equal(result.counts[2],8);
  assert.equal(result.farTravel,0);
  assert.equal(result.farSpeed,0);
  assert.ok(result.debris>0);
});
