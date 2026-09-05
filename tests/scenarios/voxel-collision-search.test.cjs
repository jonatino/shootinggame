'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createVoxelRuntime}=require('../support/voxel-runtime.cjs');

function assertComplete(audit){
  assert.deepEqual(audit.actual.map(c=>c.key),audit.expected.map(c=>c.key),
    'spatial searches must find every contact found by exhaustive pair testing');
  for(let i=0;i<audit.actual.length;i++)assert.ok(
    Math.abs(audit.actual[i].depth-audit.expected[i].depth)<1e-7,'retain the deepest real contact');
  assert.ok(audit.actual.length>20,'the comparison must include touching bodies');
}

test('cached section faces match surviving neighbours after rotation and fracture',()=>{
  const runtime=createVoxelRuntime({seed:1122});
  const result=runtime.json(`(()=>{
    subject.registerBuilding({x:0,y:40,z:0,width:3,height:3,depth:3,voxelSize:0.5,
      shape:'solid',anchorBase:false,simulateLoads:false});
    subject.update(1/120);
    const original=subject.chunks[0],initial=original.count;
    const normals=[V(1,0,0),V(-1,0,0),V(0,1,0),V(0,-1,0),V(0,0,1),V(0,0,-1)];
    for(let i=0;i<24;i++)normals.push(V(Math.random()-0.5,Math.random()-0.5,Math.random()-0.5).normalize());
    let checked=0,buried=0,failures=0;
    for(let phase=0;phase<3;phase++){
      if(phase===1)subject.damageChunk(original.mesh,V(1,0,0),7.95,original.mesh.position.clone(),3,0.6,8);
      for(const chunk of subject.chunks){
        chunk.mesh.quaternion.setFromEuler(new THREE.Euler(phase*0.42,phase*0.29,-phase*0.31));
        const inverse=chunk.mesh.quaternion.clone().invert(),st=chunk.st;
        const cells=Array.from(chunk.cellIndex.subarray(0,chunk.count),i=>
          [i%st.nx,Math.floor(i/(st.nx*st.nz)),Math.floor(i/st.nx)%st.nz]);
        for(let k=0;k<chunk.count;k++){
          for(const normal of normals){
            const local=normal.clone().applyQuaternion(inverse).toArray();
            let axis=0;for(let a=1;a<3;a++)if(Math.abs(local[a])>Math.abs(local[axis]))axis=a;
            const neighbour=cells[k].slice();neighbour[axis]+=Math.sign(local[axis]);
            const expected=!cells.some(c=>c.every((v,a)=>v===neighbour[a]));
            if(subject.exposedFace(chunk,k,normal)!==expected)failures++;
            checked++;
          }
          if(!chunk.exposedFaces[k])buried++;
        }
      }
    }
    return {checked,buried,failures,initial,remaining:subject.chunks.reduce((n,c)=>n+c.count,0)};
  })()`);
  assert.equal(result.failures,0,JSON.stringify(result));
  assert.ok(result.checked>10000&&result.buried>0);
  assert.ok(result.remaining<result.initial,'damage must invalidate the face cache');
});

for(const count of [240,384])
test(`rubble bands find all ${count} mixed-size contacts across negative coordinates and sleeping neighbours`,()=>{
  const runtime=createVoxelRuntime({seed:1102});
  const audit=runtime.json(`(()=>{
    for(let k=0;k<${count};k++){
      subject.emitDebris(V((Math.random()-0.5)*5,20+Math.random()*2,(Math.random()-0.5)*5),
        V(),[0.08,0.24,0.65,1.2][k%4]);
      if(k%3===0)subject.sleepDebris(k);
    }
    return subject.collisionAudit();
  })()`);
  assertComplete(audit);
});

for(const seed of [1103,1104])
test(`rotated section lattices find all rubble, interior and fine-cell contacts (seed ${seed})`,()=>{
  const runtime=createVoxelRuntime({seed});
  const audits=runtime.json(`(()=>{
    subject.registerBuilding({x:0,y:40,z:0,width:3,height:3,depth:3,voxelSize:0.5,
      anchorBase:false,simulateLoads:false,
      occupancy:(lx,ly,lz,x,y,z,nx,ny,nz)=>x===0||x===nx-1||z===0||z===nz-1});
    subject.registerBuilding({x:10,y:40,z:0,width:1,height:2,depth:1,voxelSize:0.25,
      shape:'solid',anchorBase:false,simulateLoads:false});
    subject.update(1/120);
    const [shell,core]=subject.chunks;
    shell.mesh.position.set(-2,30,-2);core.mesh.position.set(-1,30,-2);
    shell.mesh.quaternion.setFromEuler(new THREE.Euler(0.2,0.3,0.12));
    core.mesh.quaternion.setFromEuler(new THREE.Euler(-0.15,0.15,-0.08));
    for(let k=0;k<100;k++)subject.emitDebris(
      V(-4+Math.random()*5,28+Math.random()*4,-4+Math.random()*4),V(),0.1+Math.random()*0.6);
    const first=subject.collisionAudit();
    // Change the surviving lattice through the real weapon/fracture path.
    subject.damageChunk(shell.mesh,V(1,0,0),7.95,shell.mesh.position.clone(),3,1,8);
    return [first,subject.collisionAudit()];
  })()`);
  for(const audit of audits){
    assertComplete(audit);
    assert.ok(audit.searchedCount<audit.count,'the reference must also test buried cells');
  }
});

test('large external bodies cannot inflate fine-voxel collision searches',()=>{
  const runtime=createVoxelRuntime({seed:1105});
  const audit=runtime.json(`(()=>{
    subject.registerBuilding({x:0,y:40,z:0,width:2,height:2,depth:0.4,voxelSize:0.1,
      shape:'solid',anchorBase:false,simulateLoads:false});
    subject.update(1/120);
    const section=subject.chunks[0];section.mesh.position.set(0,20,0);
    const base=new THREE.Mesh(new THREE.BoxGeometry(),M.stone);
    base.position.set(0,19,0);base.quaternion.setFromEuler(new THREE.Euler(0,0,0.1));
    base.userData={position:base.position,half:V(5,0.25,4),vel:V(),angVel:V(),invMass:0,sleeping:true};
    settledFragments.push(base);
    for(let k=0;k<100;k++)subject.emitDebris(V(-1+Math.random()*2,19+Math.random()*2,0.2),V(),0.25);
    return subject.collisionAudit();
  })()`);
  assertComplete(audit);
  assert.ok(audit.work.pairs<audit.count*20,
    `a large body caused a quadratic cell search: ${JSON.stringify({work:audit.work,count:audit.count})}`);
});
