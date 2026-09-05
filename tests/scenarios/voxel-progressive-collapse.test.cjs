'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createVoxelRuntime}=require('../support/voxel-runtime.cjs');

for(const seed of [1001,1002,1003])test(`a heavy falling section punches through successive floors and the object below (seed ${seed})`,()=>{
  const runtime=createVoxelRuntime({seed});
  const result=runtime.json(`(()=>{
    const floors=[3,6,9].map(y=>subject.registerBuilding({x:0,y,z:0,
      width:6,height:0.5,depth:6,voxelSize:0.5,shape:'solid',
      strength:40,cellType:3,simulateLoads:false}));
    const crate=subject.registerBuilding({x:0,y:0.75,z:0,width:1.5,height:1.5,
      depth:1.5,voxelSize:0.5,shape:'solid',materialKind:'wood',strength:25,simulateLoads:false});
    const counts=floors.map(st=>st.activeN),crateCount=crate.activeN;
    const falling=subject.registerBuilding({x:0,y:15,z:0,width:2,height:4,depth:2,
      voxelSize:0.5,shape:'solid',cellType:2,anchorBase:false,simulateLoads:false});
    subject.update(1/120);const c=subject.chunks.find(c=>c.st===falling);
    let belowFirst=false,belowLast=false,peakCrateDamage=0;
    for(let tick=0;tick<600;tick++){
      subject.update(1/120,true);
      if(subject.chunks.includes(c)){
        belowFirst ||= c.mesh.position.y<8;
        belowLast ||= c.mesh.position.y<3;
      }
      peakCrateDamage=Math.max(peakCrateDamage,crateCount-crate.activeN);
    }
    return {holes:floors.map((st,i)=>counts[i]-st.activeN),belowFirst,belowLast,
      peakCrateDamage,restored:falling.activeN,debris:subject.stats().debris,
      finite:subject.debrisState().every(b=>b.position.concat(b.velocity).every(Number.isFinite))};
  })()`);
  assert.ok(result.holes.every(n=>n>=4),`floors caught an unrealistically rigid plug: ${JSON.stringify(result)}`);
  assert.equal(result.belowFirst,true,'the large section must retain downward motion after the first floor fails');
  assert.ok(result.peakCrateDamage>0,`falling masonry did not damage the object underneath: ${JSON.stringify(result)}`);
  assert.equal(result.restored,0,'fallen masonry cannot be cemented back into its authored grid');
  assert.equal(result.finite,true);
  assert.ok(result.debris>0&&result.debris<=3600);
});

test('a soft landing never rebuilds a detached section inside its former building grid',()=>{
  const runtime=createVoxelRuntime({seed:1004});
  const result=runtime.json(`(()=>{
    const st=subject.registerBuilding({x:0,z:0,width:1,height:2,depth:1,
      voxelSize:0.5,shape:'solid',simulateLoads:false});
    const cut=[];
    for(let x=0;x<2;x++)for(let z=0;z<2;z++)cut.push(V(-0.25+x*0.5,0.75,-0.25+z*0.5));
    for(const p of cut)subject.damageAt(st,p,10,V(0,0,1));
    const afterCut=st.activeN;let restored=0;
    for(let tick=0;tick<480;tick++){
      subject.update(1/120,true);restored=Math.max(restored,st.activeN-afterCut);
    }
    return {afterCut,restored,debris:subject.stats().debris};
  })()`);
  assert.equal(result.restored,0,`a soft impact repaired shot-out masonry: ${JSON.stringify(result)}`);
});

test('rotated bricks with overlapping bounding boxes fall freely when their actual faces are separated',()=>{
  const runtime=createVoxelRuntime({seed:1008,allowSleep:false});
  const result=runtime.json(`(()=>{
    const q=new THREE.Quaternion().setFromAxisAngle(V(0,1,0),Math.PI/4);
    const offset=V(1.2,0,0).applyQuaternion(q);
    subject.emitDebris(V(0,20,0),V(),1);
    subject.emitDebris(V(offset.x,20,offset.z),V(),1);
    subject.setDebrisPose(0,q.toArray());subject.setDebrisPose(1,q.toArray());
    const before=subject.debrisState();
    for(let tick=0;tick<120;tick++)subject.update(1/120,true);
    return {before,after:subject.debrisState()};
  })()`);
  for(let k=0;k<2;k++){
    const a=result.before[k],b=result.after[k];
    assert.ok(Math.abs(b.position[0]-a.position[0])<1e-6);
    assert.ok(Math.abs(b.position[2]-a.position[2])<1e-6);
    assert.ok(Math.abs(b.position[1]-(20-9.81/2))<0.0001);
  }
});

for(const seed of [1010,1011])test(`a cannon breach clears its airborne rubble instead of retaining a suspended cloud (seed ${seed})`,()=>{
  const runtime=createVoxelRuntime({seed});
  const result=runtime.json(`(()=>{
    // Authored Northwest Spire dimensions, wall/floor pattern and cannon cadence.
    const st=subject.registerBuilding({x:0,z:0,width:24,height:30,depth:22,voxelSize:1.58});
    let shot=0,initialCloud=0;
    const cloud=()=>subject.debrisState().filter(b=>b.position[1]>15&&b.position[2]>9.4).length;
    for(let tick=0;tick<1440;tick++){
      if(tick<360&&tick%6===0){
        subject.damagePath(st,V(-7+(shot%6)*1.5,12+Math.floor(shot/6)*0.9,11.01),
          V(0,0,-1),2.65,3.2,0.66,8);shot++;
      }
      subject.update(1/120,true);
      if(tick<360)initialCloud=Math.max(initialCloud,cloud());
    }
    return {initialCloud,remainingCloud:cloud(),debris:subject.stats().debris,
      loose:subject.debrisState().filter(b=>b.position[1]<15).length};
  })()`);
  assert.ok(result.initialCloud>=10,`the burst must first make airborne debris: ${JSON.stringify(result)}`);
  assert.ok(result.remainingCloud<=3,`the breach still contains suspended rubble: ${JSON.stringify(result)}`);
  assert.ok(result.loose>50,'debris must fall and remain in the scene');
});

test('a brick overhanging the edge of a damaged floor tips off instead of balancing in the air',()=>{
  const runtime=createVoxelRuntime({seed:1005});
  const result=runtime.json(`(()=>{
    const ledge=subject.registerBuilding({x:0,y:2,z:0,width:1,height:4,depth:3,
      voxelSize:1,shape:'solid',simulateLoads:false});
    subject.emitDebris(V(0.75,4.45,0),V(),0.6);
    for(let tick=0;tick<480;tick++)subject.update(1/120,true);
    return {body:subject.debrisState()[0],remaining:ledge.activeN};
  })()`);
  assert.ok(result.body.position[1]<0.8,`a corner contact became a shelf: ${JSON.stringify(result)}`);
  assert.equal(result.remaining,12,'sliding off a strong ledge must not destroy it');
});

for(const strength of [40,1e9])test(`a fast section cannot skip a thin floor (strength ${strength})`,()=>{
  const runtime=createVoxelRuntime({seed:1006});
  const result=runtime.json(`(()=>{
    const floor=subject.registerBuilding({x:0,y:4,z:0,width:3,height:0.1,depth:3,
      voxelSize:0.25,shape:'solid',strength:${strength},simulateLoads:false});
    subject.registerBuilding({x:0,y:5,z:0,width:0.5,height:0.5,depth:0.5,
      voxelSize:0.25,shape:'solid',anchorBase:false,simulateLoads:false});
    subject.update(1/120);const c=subject.chunks[0];c.vel.y=-200;
    subject.update(1/120,true);
    return {removed:144-floor.activeN,y:c.mesh.position.y,vy:c.vel.y};
  })()`);
  if(strength===40)assert.ok(result.removed>=4,`the section tunneled without breaking the floor: ${JSON.stringify(result)}`);
  else{
    assert.equal(result.removed,0);
    assert.ok(result.y>4.25,`the section crossed an unbroken floor: ${JSON.stringify(result)}`);
  }
});

test('a heavy section crushes a weak bearing under sustained weight without needing a long drop',()=>{
  const runtime=createVoxelRuntime({seed:1007});
  const result=runtime.json(`(()=>{
    const bearing=subject.registerBuilding({x:0,y:3,z:0,width:1,height:0.5,depth:1,
      voxelSize:0.5,shape:'solid',strength:3,simulateLoads:false});
    const st=subject.registerBuilding({x:0,y:5.3,z:0,width:1,height:4,depth:1,
      voxelSize:0.5,shape:'solid',anchorBase:false,simulateLoads:false});
    subject.update(1/120);const c=subject.chunks[0];
    for(let tick=0;tick<240;tick++)subject.update(1/120,true);
    return {remaining:bearing.activeN,y:c.mesh.position.y};
  })()`);
  assert.ok(result.remaining<4,`the bearing carried an unlimited load: ${JSON.stringify(result)}`);
  assert.ok(result.y<3);
});
