'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const THREE=require('three');
const {createVoxelRuntime}=require('../support/voxel-runtime.cjs');

// Deliberately independent, straightforward world-space projections. This is
// slower than the engine's shared change of basis, and is the geometric oracle.
function referenceContact(a,b){
  const delta=new THREE.Vector3(b.x-a.x,b.y-a.y,b.z-a.z);
  const axes=[];
  for(let i=0;i<3;i++)axes.push(a.axes[i].clone(),b.axes[i].clone());
  for(const aa of a.axes)for(const bb of b.axes)axes.push(new THREE.Vector3().crossVectors(aa,bb));
  let best=null,depth=Infinity;
  const radius=(box,axis)=>Math.abs(box.axes[0].dot(axis))*box.bx+
    Math.abs(box.axes[1].dot(axis))*box.by+Math.abs(box.axes[2].dot(axis))*box.bz;
  for(const axis of axes){
    if(axis.length()<1e-6)continue;
    axis.normalize();
    const distance=delta.dot(axis),overlap=radius(a,axis)+radius(b,axis)-Math.abs(distance);
    if(overlap< -0.02)return null;
    if(overlap>=depth)continue;
    if(distance<0)axis.negate();
    depth=overlap;best={nx:axis.x,ny:axis.y,nz:axis.z,penetration:depth};
  }
  return best;
}

test('optimized rotated-box contacts match all fifteen geometric separating axes',()=>{
  const engine=createVoxelRuntime({seed:1101}).evaluate('subject');
  let seed=1101;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const box=q=>({kind:0,x:(random()-0.5)*4,y:(random()-0.5)*4,z:(random()-0.5)*4,
    bx:0.05+random()*2,by:0.05+random()*2,bz:0.05+random()*2,
    axes:[new THREE.Vector3(1,0,0),new THREE.Vector3(0,1,0),new THREE.Vector3(0,0,1)]
      .map(axis=>axis.applyQuaternion(q))});
  let touching=0,separated=0;
  for(let i=0;i<3000;i++){
    const rotation=()=>new THREE.Quaternion().setFromEuler(new THREE.Euler(random()*6,random()*6,random()*6));
    const qa=rotation(),qb=i%3?rotation():qa.clone().multiply(
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),1e-5));
    const a=box(qa),b=box(qb),actual=engine.orientedContact(a,b),expected=referenceContact(a,b);
    assert.equal(!!actual,!!expected,`seed 1101, pair ${i}: missed or invented contact`);
    if(!expected){separated++;continue;}
    touching++;
    assert.ok(Math.abs(actual.penetration-expected.penetration)<1e-8,`pair ${i}: contact depth`);
    // Near-parallel axes may tie; the chosen normal must still be a real minimum.
    const axis=new THREE.Vector3(actual.nx,actual.ny,actual.nz);
    assert.ok(Math.abs(axis.length()-1)<1e-10);
    const projection=entry=>entry.axes.reduce((sum,basis,k)=>
      sum+Math.abs(basis.dot(axis))*[entry.bx,entry.by,entry.bz][k],0);
    const depth=projection(a)+projection(b)-Math.abs((b.x-a.x)*axis.x+(b.y-a.y)*axis.y+(b.z-a.z)*axis.z);
    assert.ok(Math.abs(depth-expected.penetration)<1e-8,`pair ${i}: separating normal`);
  }
  assert.ok(touching>500&&separated>500,'exercise overlapping and separating pairs');
});
