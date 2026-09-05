'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createRuntime}=require('../support/game-runtime.cjs');

test('swept loose fragments hit a 2 cm wall at 240 m/s and preserve nearby misses',()=>{
  for(const z of [0,1.3]){
    const runtime=createRuntime({seed:901});
    const result=runtime.json(`(()=>{
      const wall=voxelPhysics.registerBuilding({x:0,y:1,z:0,
        width:0.02,height:2,depth:2,voxelSize:0.5,shape:'solid',simulateLoads:false});
      voxelPhysics.emitDebris(V(-1,1,${z}),V(240,0,0),0.08);
      voxelPhysics.update(1/120);
      const m=new THREE.Matrix4();voxelPhysics.debrisMesh.getMatrixAt(0,m);
      return {x:m.elements[12],remaining:wall.activeN};
    })()`);
    if(z===0)assert.ok(result.x<-0.04,`fragment crossed thin wall: ${result.x}`);
    else assert.ok(Math.abs(result.x-1)<1e-5,`near miss was blocked: ${result.x}`);
    assert.equal(result.remaining,16);
  }
});

test('loose fragment free fall follows gravity and maintains a constant world spin axis',()=>{
  const runtime=createRuntime({seed:902});
  const result=runtime.json(`(()=>{
    voxelPhysics.emitDebris(V(0,20,0),V(),0.2);
    voxelPhysics.syncVisuals();
    const m=new THREE.Matrix4(),p=V(),s=V();
    const read=()=>{const q=new THREE.Quaternion();
      voxelPhysics.debrisMesh.getMatrixAt(0,m);m.decompose(p,q,s);return q;};
    const q0=read();voxelPhysics.update(1/120);const q1=read();
    voxelPhysics.update(1/120);const q2=read();
    const first=q1.clone().multiply(q0.clone().invert());
    const second=q2.clone().multiply(q1.clone().invert());
    for(let i=2;i<120;i++)voxelPhysics.update(1/120);
    read();return {y:p.y,scale:s.toArray(),axisError:first.angleTo(second)};
  })()`);
  assert.ok(Math.abs(result.y-(20-9.81/2))<0.0001,`incorrect gravity: ${result.y}`);
  assert.ok(result.axisError<0.001,`spin axis wandered: ${result.axisError}`);
  for(const scale of result.scale)assert.ok(Math.abs(scale-0.2)<1e-6);
});

test('ground friction slows rubble by contact force instead of deleting sliding momentum',()=>{
  const runtime=createRuntime({seed:903});
  const result=runtime.json(`(()=>{
    voxelPhysics.emitDebris(V(0,0.15,0),V(4,0,0),0.3);
    for(let i=0;i<30;i++)voxelPhysics.update(1/120);
    const m=new THREE.Matrix4();voxelPhysics.debrisMesh.getMatrixAt(0,m);
    return {x:m.elements[12],y:m.elements[13]};
  })()`);
  assert.ok(result.x>0.65&&result.x<1,`unphysical sliding distance: ${result.x}`);
  assert.ok(result.y>=0.15);
});

test('removing the support of a quiet rubble pile wakes its dependent fragments',()=>{
  const runtime=createRuntime({seed:904});
  const result=runtime.json(`(()=>{
    const base=new THREE.Mesh(new THREE.BoxGeometry(4,1,4),new THREE.MeshBasicMaterial());
    base.position.set(0,2,0);base.userData={half:V(2,0.5,2),position:base.position,
      vel:V(),angVel:V(),invMass:0,sleeping:true};settledFragments.push(base);
    const read=()=>{const m=new THREE.Matrix4(),out=[];
      for(let i=0;i<voxelPhysics.stats().debris;i++){
        voxelPhysics.debrisMesh.getMatrixAt(i,m);out.push(m.elements[13]);
      }return out;};
    voxelPhysics.emitDebris(V(0,3.1,0),V(),0.6);
    for(let i=0;i<120;i++)voxelPhysics.update(1/120);
    voxelPhysics.emitDebris(V(0,read()[0]+1.1,0),V(),0.6);
    for(let i=0;i<180;i++)voxelPhysics.update(1/120);
    const settled=read();
    for(let i=0;i<30;i++)voxelPhysics.update(1/120);
    const quiet=read();base.position.x=20;
    for(let i=0;i<48;i++)voxelPhysics.update(1/120);
    return {settled,quiet,fallen:read()};
  })()`);
  assert.equal(result.quiet.length,2);
  assert.ok(result.quiet[1]>result.quiet[0]+0.45,'upper fragment must rest on the lower fragment');
  for(let i=0;i<2;i++){
    assert.ok(Math.abs(result.quiet[i]-result.settled[i])<0.005,'pile must first settle');
    assert.ok(result.fallen[i]<result.quiet[i]-0.3,
      `unsupported fragment ${i} floated: ${JSON.stringify(result)}`);
  }
});

test('camera retracts before a thin wall immediately and returns smoothly to open space',()=>{
  const runtime=createRuntime({gameplay:true,seed:905});
  const result=runtime.json(`(()=>{
    gameSettings.cameraMotion=0;camYaw=targetYaw=camPitch=targetPitch=0;
    camZoom=1;heldDist=5.6;
    const wall=__addBox({center:[0,2,0.65],size:[5,4,0.05]});
    updateCam(1/144);const blocked=camera.position.z;
    removeOccluder(wall);removePhysicsBox(boxes[0]);
    updateCam(1/144);const returning=camera.position.z;
    for(let i=0;i<120;i++)updateCam(1/120);
    return {blocked,returning,clear:camera.position.z};
  })()`);
  assert.ok(result.blocked<0.625,`camera went through the wall: ${result.blocked}`);
  assert.ok(result.returning>result.blocked&&result.returning<1);
  assert.ok(result.clear>5);
});

test('walkable surface probes reject steep faces but accept moderate slopes',()=>{
  const runtime=createRuntime({seed:906});
  const result=runtime.json(`(()=>{
    const slope=__addBox({center:[0,2,0],size:[4,0.1,4]});
    slope.rotation.x=Math.PI/3;slope.updateMatrixWorld(true);
    const steep=groundBelow(0,0,4);
    slope.rotation.x=Math.PI/6;slope.updateMatrixWorld(true);
    return {steep,walkable:groundBelow(0,0,4)};
  })()`);
  assert.equal(result.steep,0);
  assert.ok(result.walkable>2&&result.walkable<2.1);
});

test('enabling audio leaves gameplay randomness unchanged and reuses noise buffers',()=>{
  function run(enabled){
    const runtime=createRuntime({gameplay:true,seed:907});
    return runtime.json(`(()=>{
      let allocations=0;
      const parameter=()=>({setValueAtTime(){},exponentialRampToValueAtTime(){},setTargetAtTime(){}});
      const node=()=>({connect(){},start(){},stop(){},gain:parameter(),frequency:parameter()});
      window.AudioContext=class {
        constructor(){this.sampleRate=8000;this.currentTime=0;this.state='running';this.destination={};}
        createGain(){return node();}createOscillator(){return node();}
        createBiquadFilter(){return node();}createBufferSource(){return node();}
        createBuffer(channels,len){allocations++;return {getChannelData:()=>new Float32Array(len)};}
      };
      Sfx.setMuted(${!enabled});
      for(let i=0;i<60;i++)Sfx.cannon();
      return {allocations,next:[Math.random(),Math.random(),Math.random()]};
    })()`);
  }
  const muted=run(false),audible=run(true);
  assert.deepEqual(audible.next,muted.next);
  assert.equal(audible.allocations,1);
  assert.equal(muted.allocations,0);
});

test('enemy projectiles have reusable visible tracers that are removed on impact or expiry',()=>{
  const runtime=createRuntime({gameplay:true,seed:908});
  const result=runtime.json(`(()=>{
    enemyShoot({pos:V(4,0,0)},V(0,0,-1));
    updateEnemyBullets(1/120);syncEnemyBulletVisuals(0.5);
    const first=enemyBullets[0].mesh;
    const visible=first.parent===scene&&first.visible&&first.geometry===geoBullet;
    const color=first.material.color.getHex();
    enemyBullets[0].life=0;updateEnemyBullets(1/120);
    const released=first.parent===null&&bulletEffectPools.enemyTracer.includes(first);
    enemyShoot({pos:V(4,0,0)},V(0,0,-1));
    updateEnemyBullets(1/120);syncEnemyBulletVisuals(1);
    const reused=enemyBullets[0].mesh===first;
    __addBox({center:[4,1.5,-0.5],size:[2,2,0.05]});
    for(let i=0;i<12;i++)updateEnemyBullets(1/120);
    return {visible,color,released,reused,remaining:enemyBullets.length,
      pooled:bulletEffectPools.enemyTracer.length,attached:first.parent!==null};
  })()`);
  assert.deepEqual(result,{visible:true,color:0xff6a35,released:true,reused:true,
    remaining:0,pooled:1,attached:false});
});

test('health pickups require physical reach and are preserved at full health',()=>{
  const runtime=createRuntime({gameplay:true,seed:909});
  const result=runtime.json(`(()=>{
    const pickup={alive:true,kind:'health',pos:V(0,0,-1),group:new THREE.Group(),respawn:0};
    pickups.push(pickup);tryPickup();const preserved=pickup.alive;
    player.hp=45;player.pos.y=4;tryPickup();const otherFloor=player.hp;
    player.pos.y=0;
    const wall=__addBox({center:[0,1,-0.5],size:[3,2,0.05]});
    tryPickup();const behindWall=player.hp;
    removeOccluder(wall);removePhysicsBox(boxes[0]);
    for(let i=0;i<60;i++)updateHint(1/60);
    const prompt=hintEl.textContent;
    tryPickup();return {preserved,otherFloor,behindWall,prompt,hp:player.hp,
      consumed:!pickup.alive,hidden:!pickup.group.visible,respawn:pickup.respawn};
  })()`);
  assert.deepEqual(result,{preserved:true,otherFloor:45,behindWall:45,
    prompt:'E — restore health',hp:85,consumed:true,hidden:true,respawn:12});
});

test('stepping up beneath a low ceiling cannot raise the capsule into the roof',()=>{
  const runtime=createRuntime({seed:910});
  const result=runtime.json(`(()=>{
    __addBox({center:[0,0.18,-0.9],size:[2,0.36,0.8]});
    __addBox({center:[0,1.92,-0.8],size:[4,0.08,4]});
    let maxY=0;
    for(let i=0;i<120;i++){__stepGround(1,[0,0,-1]);maxY=Math.max(maxY,player.pos.y);}
    return {maxY,state:__playerState()};
  })()`);
  assert.ok(result.maxY<0.18,`step put the player's head through the ceiling: ${result.maxY}`);
  assert.ok(result.state.pos[2]>-0.5);
});

test('a resting chip cannot regenerate a full destroyed building voxel',()=>{
  const runtime=createRuntime({seed:911});
  const result=runtime.json(`(()=>{
    const st=voxelPhysics.registerBuilding({x:0,y:1,z:0,width:2,height:2,depth:2,
      voxelSize:0.5,shape:'solid',simulateLoads:false});
    const index=(3*st.nz+2)*st.nx+2;
    voxelPhysics.damageAt(st,V(0.25,1.75,0.25),10,V(0,1,0));
    const removed=!st.alive[index];
    voxelPhysics.emitDebris(V(0.25,1.58,0.25),V(),0.08);
    for(let i=0;i<400;i++)voxelPhysics.update(1/120);
    return {removed,regenerated:!!st.alive[index],voxels:st.activeN};
  })()`);
  assert.equal(result.removed,true);
  assert.equal(result.regenerated,false);
  assert.ok(result.voxels<64);
});
