'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {createRuntime} = require('./support/game-runtime.cjs');

test('full authored world cooks on the CPU without rendering', () => {
  const runtime = createRuntime({fullWorld: true, seed: 9001});
  const state = runtime.json(String.raw`({
    voxel:voxelPhysics.stats(),
    boxes:boxes.length,
    standables:standables.length,
    occluders:occluders.length,
    enemies:enemies.length,
    dummies:dummies.length,
    pickups:pickups.length,
    rendererFrames:renderer.renderCount
  })`);

  assert.equal(state.voxel.structures, 49);
  assert.equal(state.voxel.voxels, 35304);
  assert.ok(state.boxes > 36000);
  assert.equal(state.enemies, 4);
  assert.equal(state.dummies, 8);
  assert.equal(state.pickups, 11);
  assert.equal(state.rendererFrames, 0);

  const graph = runtime.json('buildGraph()');
  assert.ok(graph.holds > 2900);
  assert.ok(graph.links > 12000);
  assert.equal(runtime.evaluate('renderer.renderCount'), 0);

  const traversalFireGate = runtime.json(String.raw`(()=>{
    const states=[
      ['attach','attach',0],
      ['transfer','move',0],
      ['hang','hang',0],
      ['vault','vault',0],
      ['vaultRecovery','ground',0.18]
    ];
    const results={};
    for(const [label,mode,recovery] of states){
      player.mode=mode;player.vaultRecovery=recovery;
      playerWpn.cooldown=0;playerWpn.reloading=0;
      weaponRecoilKick=0;weaponRecoilPitch=0;weaponRecoilRoll=0;
      const rocketsBefore=rockets.length,linesBefore=bulletLines.length;
      shoot();
      results[label]={
        cooldown:playerWpn.cooldown,
        recoil:[weaponRecoilKick,weaponRecoilPitch,weaponRecoilRoll],
        rockets:rockets.length-rocketsBefore,
        lines:bulletLines.length-linesBefore
      };
    }
    results.groundAllowed=(()=>{
      player.mode='ground';player.vaultRecovery=0;
      return playerCanShoot();
    })();
    return results;
  })()`);

  for(const state of ['attach','transfer','hang','vault','vaultRecovery']){
    assert.deepEqual(traversalFireGate[state], {
      cooldown:0,recoil:[0,0,0],rockets:0,lines:0
    }, `${state} must not fire`);
  }
  assert.equal(traversalFireGate.groundAllowed, true);

  const mantleCamera = runtime.json(String.raw`(()=>{
    const requestedYaw=0.61,requestedPitch=0.24;
    camYaw=requestedYaw;targetYaw=requestedYaw;
    camPitch=requestedPitch;targetPitch=requestedPitch;
    let chosen=-1;
    for(let i=0;i<HOLDS.length;i++){
      const h=HOLDS[i];
      if(!h.vault||!h.vaultMesh)continue;
      player.pos.copy(hangPos(i,new THREE.Vector3()));
      player.hold=i;player.mode='hang';player.onGround=false;
      player.cool=0;player.grace=0;
      if(startVault()){chosen=i;break;}
    }
    const start={camYaw,targetYaw,camPitch,targetPitch};
    for(let i=0;i<240&&player.mode==='vault';i++){
      vaultStep(1/120);
      updateCam(1/120);
    }
    return {
      chosen,start,
      end:{camYaw,targetYaw,camPitch,targetPitch},
      mode:player.mode
    };
  })()`);

  assert.ok(mantleCamera.chosen >= 0, 'authored world needs a mantle camera fixture');
  assert.deepEqual(mantleCamera.start, {
    camYaw:0.61,targetYaw:0.61,camPitch:0.24,targetPitch:0.24
  });
  assert.deepEqual(mantleCamera.end, mantleCamera.start);
  assert.equal(mantleCamera.mode, 'ground');

  const rockContact = runtime.json(String.raw`(()=>{
    /* This is the south face of the 15-unit summit rock shown in the manual
       regression. It used to select a hidden-cylinder hold behind the visible
       voxel face and report HANDHOLD OUT OF REACH. */
    player.pos.set(0,0,2.8568888888888884);
    player.mode='ground';player.onGround=true;player.hold=-1;
    player.cool=0;player.grace=0;
    camYaw=0;targetYaw=camYaw;
    hintOrigin.set(player.pos.x,1.3,player.pos.z);
    const nearbyCount=nearbyClimbHoldIndices(hintOrigin,2.7).length;
    let exactChecks=0,voxelRays=0;
    const originalHangPos=hangPos;
    const originalInstancedRaycast=THREE.InstancedMesh.prototype.raycast;
    hangPos=(...args)=>{exactChecks++;return originalHangPos(...args);};
    THREE.InstancedMesh.prototype.raycast=function(...args){
      if(this.userData&&this.userData.kind==='voxelField')voxelRays++;
      return originalInstancedRaycast.apply(this,args);
    };
    climbGrabRetryAt=0;
    tryGrab(false);
    hangPos=originalHangPos;
    THREE.InstancedMesh.prototype.raycast=originalInstancedRaycast;
    return {
      nearbyCount,exactChecks,voxelRays,mode:player.mode,target:player.moveTo,
      voxelSurface:!!(HOLDS[player.moveTo]&&HOLDS[player.moveTo].voxelSurface)
    };
  })()`);

  assert.ok(rockContact.nearbyCount < graph.holds / 10);
  assert.ok(rockContact.exactChecks <= 4);
  assert.equal(rockContact.voxelRays, 0);
  assert.equal(rockContact.mode, 'attach');
  assert.ok(rockContact.target >= 0);
  assert.equal(rockContact.voxelSurface, true);

  const summitClimb = runtime.json(String.raw`(()=>{
    keys.ShiftLeft=true;keys.KeyW=true;
    let maxY=player.pos.y,ticks=0;
    for(;ticks<1200;ticks++){
      if(player.mode==='attach'||player.mode==='move')moveStep(1/120);
      else if(player.mode==='hang')hangStep(1/120);
      else if(player.mode==='vault')vaultStep(1/120);
      else break;
      maxY=Math.max(maxY,player.pos.y);
    }
    keys.ShiftLeft=false;keys.KeyW=false;
    return {ticks,maxY,mode:player.mode,pos:player.pos.toArray()};
  })()`);

  assert.ok(summitClimb.ticks < 1200, 'summit climb must not stall on a voxel tier');
  assert.ok(summitClimb.maxY > 15, 'summit climb must clear the top lip');
  assert.equal(summitClimb.mode, 'ground');
  assert.ok(summitClimb.pos[1] > 14, 'summit mantle must land on the rock');

  const rockContactWork = runtime.json(String.raw`(()=>{
    player.pos.set(0,0,2.8568888888888884);player.vel.set(0,0,0);
    player.mode='ground';player.onGround=true;player.hold=-1;
    player.cool=0;player.grace=0;camYaw=0;targetYaw=0;
    keys.ShiftLeft=false;keys.KeyW=true;
    let voxelRays=0;
    const originalInstancedRaycast=THREE.InstancedMesh.prototype.raycast;
    THREE.InstancedMesh.prototype.raycast=function(...args){
      if(this.userData&&this.userData.kind==='voxelField')voxelRays++;
      return originalInstancedRaycast.apply(this,args);
    };
    const forward=new THREE.Vector3(0,0,-1);
    for(let i=0;i<60;i++){
      groundStep(1/60,forward);
      updateCam(1/60);
    }
    THREE.InstancedMesh.prototype.raycast=originalInstancedRaycast;
    keys.KeyW=false;
    return {
      voxelRays,
      nearbyBoxes:getPlayerStaticBoxCandidates().length,
      totalBoxes:boxes.length,
      pos:player.pos.toArray()
    };
  })()`);

  assert.ok(rockContactWork.voxelRays <= 60,
    'contact frames must raycast at most the local voxel field');
  assert.ok(rockContactWork.nearbyBoxes < rockContactWork.totalBoxes / 20,
    'contact collision must stay inside the static broadphase neighborhood');
  assert.ok(Math.abs(rockContactWork.pos[2]-2.8568888888888884) < 1e-6,
    'held movement must remain blocked by the rock');

  const localizedActorDamage = runtime.json(String.raw`(()=>{
    const enemy=enemies[0],leg=enemy.partStates.leftLeg;
    enemy.group.updateMatrixWorld(true);
    const hitPoint=leg.center.clone().applyMatrix4(leg.mesh.matrixWorld);
    const looseVoxelsBefore=voxelPhysics.stats().debris;
    const outcome=damageVoxelActor(enemy,leg.mesh,hitPoint,
      new THREE.Vector3(0,0,1),WEAPONS.pistol.dmg,2.2);
    const bodyRoot=enemy.rigidBody,legRoot=leg.rigidRoot;
    const release={
      outcome,alive:enemy.alive,groupVisible:enemy.group.visible,
      legDetached:leg.detached,
      bodyIsRigid:chunks.includes(bodyRoot),legIsRigid:chunks.includes(legRoot),
      bodyCoherent:enemy.group.parent===bodyRoot,
      legCoherent:leg.holder.parent===legRoot&&leg.mesh.count>1,
      looseVoxelDelta:voxelPhysics.stats().debris-looseVoxelsBefore
    };
    for(let i=0;i<360;i++)updateChunks(1/120);
    const bodyUp=new THREE.Vector3(0,1,0).applyQuaternion(bodyRoot.quaternion);
    return {release,bodyUp:bodyUp.toArray(),bodyY:bodyRoot.position.y};
  })()`);

  assert.deepEqual(localizedActorDamage.release.outcome, {
    hit:true,killed:true,detached:true,part:'leftLeg'
  });
  assert.equal(localizedActorDamage.release.alive, false);
  assert.equal(localizedActorDamage.release.groupVisible, true,
    'the remaining body must stay visible instead of being replaced by voxels');
  assert.equal(localizedActorDamage.release.legDetached, true);
  assert.equal(localizedActorDamage.release.bodyIsRigid, true);
  assert.equal(localizedActorDamage.release.legIsRigid, true);
  assert.equal(localizedActorDamage.release.bodyCoherent, true);
  assert.equal(localizedActorDamage.release.legCoherent, true);
  assert.equal(localizedActorDamage.release.looseVoxelDelta, 0,
    'a limb hit must not burst the complete actor into loose voxel debris');
  assert.ok(Math.abs(localizedActorDamage.bodyUp[1]) < 0.35,
    'a leg loss must topple the remaining body onto its side');
  assert.ok(localizedActorDamage.bodyY < 0.7,
    'the toppled body centre must come down to the ground');

  const dummyRespawn = runtime.json(String.raw`(()=>{
    const dummy=dummies[0],leg=dummy.partStates.rightLeg;
    dummy.group.updateMatrixWorld(true);
    const hitPoint=leg.center.clone().applyMatrix4(leg.mesh.matrixWorld);
    damageVoxelActor(dummy,leg.mesh,hitPoint,new THREE.Vector3(1,0,0),22,2);
    const oldBody=dummy.rigidBody,oldLeg=leg.rigidRoot;
    dummy.respawn=0;updateDummies(1/60);
    return {
      alive:dummy.alive,hp:dummy.hp,detached:leg.detached,
      bodyCleared:dummy.rigidBody===null,
      groupRestored:dummy.group.parent===scene&&leg.holder.parent===dummy.group,
      oldRootsRetired:chunks.indexOf(oldBody)<0&&chunks.indexOf(oldLeg)<0&&
        settledFragments.indexOf(oldBody)<0&&settledFragments.indexOf(oldLeg)<0,
      position:dummy.group.position.toArray(),rotation:dummy.group.quaternion.toArray()
    };
  })()`);

  assert.deepEqual(dummyRespawn, {
    alive:true,hp:20,detached:false,bodyCleared:true,groupRestored:true,
    oldRootsRetired:true,position:[10,0,5],rotation:[0,0,0,1]
  });
});
