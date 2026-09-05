'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createRuntime, projectRoot} = require('./support/game-runtime.cjs');

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
    skyscrapers:skyscrapers.map(tower=>({
      name:tower.name,height:tower.height,tiers:tower.tiers.length
    })),
    rendererFrames:renderer.renderCount
  })`);

  assert.equal(state.voxel.structures, 63);
  assert.ok(state.boxes > 36000);
  assert.equal(state.skyscrapers.length, 4);
  assert.ok(Math.min(...state.skyscrapers.map(tower=>tower.height)) >= 70);
  assert.ok(Math.max(...state.skyscrapers.map(tower=>tower.height)) >= 95);
  assert.ok(state.skyscrapers.every(tower=>tower.tiers >= 3));
  assert.equal(state.enemies, 4);
  assert.equal(state.dummies, 8);
  assert.equal(state.pickups, 11);
  assert.equal(state.rendererFrames, 0);

  const graph = runtime.json('buildGraph()');
  assert.ok(graph.holds > 2900);
  assert.ok(graph.links > 12000);
  assert.equal(runtime.evaluate('renderer.renderCount'), 0);

  const voxelFieldCulling = runtime.json(String.raw`(()=>{
    const boundsValid=voxelPhysics.structures.every(structure=>{
      const sphere=structure.mesh.geometry.boundingSphere;
      if(!structure.mesh.frustumCulled||!sphere)return false;
      const halfDiagonal=Math.hypot(structure.nx*structure.sx,
        structure.ny*structure.sy,structure.nz*structure.sz)*0.5;
      return sphere.radius>=halfDiagonal;
    });
    const structure=voxelPhysics.structures[26];
    let facade=null;
    for(let y=1;y<structure.ny-1&&!facade;y++)for(let x=1;x<structure.nx-1;x++){
      const i=(y*structure.nz+structure.nz-1)*structure.nx+x;
      if(structure.alive[i]){facade={x,y};break;}
    }
    const origin=new THREE.Vector3(
      structure.origin.x+(facade.x+0.5)*structure.sx,
      structure.origin.y+(facade.y+0.5)*structure.sy,
      structure.origin.z+structure.nz*structure.sz+5);
    const direction=new THREE.Vector3(0,0,-1);
    scene.updateMatrixWorld(true);
    const broadTargets=collectShotTargets(origin,direction,SHOT_MAX_DISTANCE).slice();
    const allTargets=occluders.slice();
    for(const enemy of enemies)if(enemy.alive)allTargets.push(...actorTargetMeshes(enemy));
    for(const dummy of dummies)if(dummy.alive)allTargets.push(...actorTargetMeshes(dummy));
    if(allTargets.indexOf(ground)<0)allTargets.push(ground);
    rc.set(origin,direction);rc.far=SHOT_MAX_DISTANCE;
    const broadHit=rc.intersectObjects(broadTargets,false)[0];
    rc.set(origin,direction);rc.far=SHOT_MAX_DISTANCE;
    const exhaustiveHit=rc.intersectObjects(allTargets,false)[0];
    return {
      boundsValid,broadCount:broadTargets.length,allCount:allTargets.length,
      sameObject:!!broadHit&&!!exhaustiveHit&&broadHit.object===exhaustiveHit.object,
      hitDistanceError:broadHit&&exhaustiveHit?
        broadHit.point.distanceTo(exhaustiveHit.point):Infinity,
      hitKind:broadHit&&broadHit.object.userData.kind
    };
  })()`);

  assert.equal(voxelFieldCulling.boundsValid, true,
    'every static voxel field needs a conservative aggregate frustum bound');
  assert.equal(voxelFieldCulling.sameObject, true,
    'the shot broadphase must preserve the exhaustive raycast result');
  assert.ok(voxelFieldCulling.hitDistanceError < 1e-8);
  assert.equal(voxelFieldCulling.hitKind, 'voxelField');
  assert.ok(voxelFieldCulling.broadCount < voxelFieldCulling.allCount / 10,
    'a skyscraper shot must not raycast every world occluder');

  const voxelRayTraversal = runtime.json(String.raw`(()=>{
    const structure=voxelPhysics.structures[26],mesh=structure.mesh;
    const referenceGeometry=mesh.geometry.clone();
    referenceGeometry.boundingSphere=null;
    referenceGeometry.computeBoundingSphere();
    scene.updateMatrixWorld(true);
    let mismatches=0,maxPointError=0,maxCellTests=0,compared=0;
    for(let sample=0;sample<96;sample++){
      const cell=structure.activeIdx[(sample*97)%structure.activeN];
      const x=cell%structure.nx;
      const z=Math.floor(cell/structure.nx)%structure.nz;
      const y=Math.floor(cell/(structure.nx*structure.nz));
      const target=new THREE.Vector3(
        structure.origin.x+(x+0.5)*structure.sx,
        structure.origin.y+(y+0.5)*structure.sy,
        structure.origin.z+(z+0.5)*structure.sz);
      const angle=sample*2.399963229728653;
      const origin=target.clone().add(new THREE.Vector3(
        Math.cos(angle)*25,8+sample%7,Math.sin(angle)*25));
      const direction=target.clone().sub(origin).normalize();
      rc.set(origin,direction);rc.near=0.01;rc.far=SHOT_MAX_DISTANCE;
      const accelerated=[];mesh.raycast(rc,accelerated);
      maxCellTests=Math.max(maxCellTests,structure.lastRaycastCellTests||0);
      const aggregateGeometry=mesh.geometry;
      mesh.geometry=referenceGeometry;
      const exhaustive=[];
      THREE.InstancedMesh.prototype.raycast.call(mesh,rc,exhaustive);
      mesh.geometry=aggregateGeometry;
      accelerated.sort((a,b)=>a.distance-b.distance||a.instanceId-b.instanceId);
      exhaustive.sort((a,b)=>a.distance-b.distance||a.instanceId-b.instanceId);
      if(accelerated.length!==exhaustive.length){mismatches++;continue;}
      if(!accelerated.length)continue;
      compared++;
      const pointError=accelerated[0].point.distanceTo(exhaustive[0].point);
      maxPointError=Math.max(maxPointError,pointError);
      if(pointError>1e-8||
         accelerated[0].instanceId!==exhaustive[0].instanceId||
         accelerated[0].face.normal.distanceTo(exhaustive[0].face.normal)>1e-8)
        mismatches++;
    }
    referenceGeometry.dispose();
    return {mismatches,maxPointError,maxCellTests,compared,
      activeInstances:structure.activeN};
  })()`);

  assert.equal(voxelRayTraversal.mismatches, 0,
    'grid traversal must return the exhaustive instance hit, face, and point');
  assert.equal(voxelRayTraversal.maxPointError, 0);
  assert.equal(voxelRayTraversal.compared, 96);
  assert.ok(voxelRayTraversal.maxCellTests < voxelRayTraversal.activeInstances / 20,
    'a tower ray must visit its crossed grid cells, not every rendered instance');

  const exactVoxelCulling = runtime.json(String.raw`(()=>{
    const testCamera=new THREE.PerspectiveCamera(75,16/9,0.1,500);
    const frustum=new THREE.Frustum(),projection=new THREE.Matrix4();
    const sphereTest=THREE.Frustum.prototype.__voxelBoundsIntersectsObject;
    let sphereInstances=0,boxInstances=0;
    scene.updateMatrixWorld(true);
    for(let sample=0;sample<24;sample++){
      const angle=sample*Math.PI*2/24;
      testCamera.position.set(Math.cos(angle)*18,8,Math.sin(angle)*18);
      testCamera.lookAt(0,12,0);testCamera.updateMatrixWorld(true);
      projection.multiplyMatrices(testCamera.projectionMatrix,
        testCamera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projection);
      for(const structure of voxelPhysics.structures){
        if(sphereTest.call(frustum,structure.mesh))sphereInstances+=structure.activeN;
        if(frustum.intersectsObject(structure.mesh))boxInstances+=structure.activeN;
      }
    }
    return {sphereInstances,boxInstances};
  })()`);

  assert.ok(exactVoxelCulling.boxInstances < exactVoxelCulling.sphereInstances,
    'exact tower bounds should reject sphere false positives without hiding visible cells');

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
      playerWpn.cooldown=0;
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

  const machineRpg = runtime.json(String.raw`(()=>{
    setWeapon('rpg');
    updateStatsUI();
    const start=new THREE.Vector3(0,20,0),dir=new THREE.Vector3(0,0,-1);
    let firstRocket=null;
    for(let i=0;i<MAX_ACTIVE_ROCKETS+7;i++){
      fireRocket(start,dir);
      if(i===0)firstRocket=rockets[0].mesh;
    }
    const result={
      name:WEAPONS.rpg.name,
      displayName:WEAPONS.rpg.displayName,
      automatic:WEAPONS.rpg.automatic,
      rof:WEAPONS.rpg.rof,
      roundsPerMinute:Math.round(60/WEAPONS.rpg.rof),
      hud:document.getElementById('wpn').textContent,
      activeRockets:rockets.length,
      firstRocketExpired:firstRocket.parent===null
    };
    while(rockets.length)scene.remove(rockets.pop().mesh);
    return result;
  })()`);

  assert.deepEqual(machineRpg, {
    name:'RPG',displayName:'MACHINE RPG',automatic:true,rof:0.075,
    roundsPerMinute:800,hud:'MACHINE RPG',activeRockets:48,
    firstRocketExpired:true
  });

  const cannon = runtime.json(String.raw`(()=>{
    setWeapon('cannon');
    player.mode='ground';player.onGround=true;player.vaultRecovery=0;
    updateStatsUI();updateGunVisual();
    const beforeSpin=cannonRotor.rotation.z;
    mouseHeld=true;
    for(let i=0;i<20;i++)updateGuy(1/120);
    mouseHeld=false;
    return {
      name:WEAPONS.cannon.name,
      displayName:WEAPONS.cannon.displayName,
      automatic:WEAPONS.cannon.automatic,
      rof:WEAPONS.cannon.rof,
      roundsPerMinute:Math.round(60/WEAPONS.cannon.rof),
      damage:WEAPONS.cannon.dmg,
      structuralPower:WEAPONS.cannon.structuralPower,
      structurePenetration:WEAPONS.cannon.structurePenetration,
      structureRadius:WEAPONS.cannon.structureRadius,
      structureCells:WEAPONS.cannon.structureCells,
      impactForce:WEAPONS.cannon.impactForce,
      hud:document.getElementById('wpn').textContent,
      visible:gunCannon.visible&&!gunRpg.visible,
      barrels:cannonRotor.children.filter(child=>child.userData.cannonBarrel).length,
      spun:cannonRotor.rotation.z!==beforeSpin
    };
  })()`);

  assert.deepEqual(cannon, {
    name:'CANNON',displayName:'A-10 20MM CANNON',automatic:true,rof:0.028,
    roundsPerMinute:2143,damage:110,structuralPower:2.65,
    structurePenetration:3.2,structureRadius:0.66,structureCells:8,impactForce:15,
    hud:'A-10 20MM CANNON',visible:true,barrels:6,spun:true
  });

  const cameraFacingCombat = runtime.json(String.raw`(()=>{
    player.pos.set(8,0,16);player.vel.set(0,0,0);
    player.mode='ground';player.onGround=true;player.vaultRecovery=0;
    player.heading=0;heading=0;
    camYaw=-1.17;targetYaw=camYaw;camPitch=0.16;targetPitch=camPitch;
    const idle=new THREE.Vector3();
    for(let i=0;i<60;i++){
      groundStep(1/120,idle);
      updateCam(1/120);
      updateGuy(1/120);
    }
    const cameraForward=new THREE.Vector3(-Math.sin(camYaw),0,-Math.cos(camYaw)).normalize();
    const characterForward=new THREE.Vector3(
      Math.sin(guy.rotation.y),0,Math.cos(guy.rotation.y)).normalize();
    const expectedHeading=Math.atan2(cameraForward.x,cameraForward.z);
    guy.updateMatrixWorld(true);
    const cameraAim=new THREE.Vector3();camera.getWorldDirection(cameraAim).normalize();
    const weaponRotation=new THREE.Quaternion();gunGroup.getWorldQuaternion(weaponRotation);
    const weaponForward=new THREE.Vector3(0,0,-1).applyQuaternion(weaponRotation).normalize();
    return {
      headingError:Math.abs(angDiff(player.heading,expectedHeading)),
      facingDot:cameraForward.dot(characterForward),
      weaponDot:cameraAim.dot(weaponForward)
    };
  })()`);

  assert.ok(cameraFacingCombat.headingError < 1e-9,
    'ground combat heading must be owned by the camera, even without movement input');
  assert.ok(cameraFacingCombat.facingDot > 0.999,
    'the rendered character must turn their back to the chase camera and face the reticle');
  assert.ok(cameraFacingCombat.weaponDot > 0.995,
    'the visible barrel must follow camera yaw and pitch instead of firing backward');

  const strafeHorizon = runtime.json(String.raw`(()=>{
    const result={};
    for(const [label,direction] of [['left',-1],['right',1]]){
      player.pos.set(90,0,90);player.vel.set(0,0,0);
      player.mode='ground';player.onGround=true;player.vaultRecovery=0;
      camYaw=0.48;targetYaw=camYaw;camPitch=0.22;targetPitch=camPitch;
      camPitchKick=0;camYawKick=0;camShake=0;
      const strafe=new THREE.Vector3(direction,0,0);
      for(let i=0;i<120;i++){
        groundStep(1/120,strafe);
        updateCam(1/120);
      }
      const forward=new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion).normalize();
      const actualUp=new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion).normalize();
      const levelUp=new THREE.Vector3(0,1,0)
        .addScaledVector(forward,-forward.y).normalize();
      result[label]=Math.acos(Math.max(-1,Math.min(1,actualUp.dot(levelUp))));
    }
    return result;
  })()`);

  assert.ok(strafeHorizon.left < 1e-6,
    `left strafe rolled the horizon by ${strafeHorizon.left} radians`);
  assert.ok(strafeHorizon.right < 1e-6,
    `right strafe rolled the horizon by ${strafeHorizon.right} radians`);

  const walkingCameraHeight = runtime.json(String.raw`(()=>{
    player.pos.set(-80,0,-80);player.vel.set(0,0,0);
    player.mode='ground';player.onGround=true;player.vaultRecovery=0;
    camYaw=0;targetYaw=0;camPitch=0.2;targetPitch=0.2;
    camPitchKick=0;camYawKick=0;camShake=0;heldDist=5.6*camZoom;
    const idle=new THREE.Vector3(),strafe=new THREE.Vector3(1,0,0);
    for(let i=0;i<120;i++){
      groundStep(1/120,idle);
      updateCam(1/120);
    }
    let min=Infinity,max=-Infinity;
    for(let i=0;i<120;i++){
      groundStep(1/120,strafe);
      updateCam(1/120);
      const relativeY=camera.position.y-player.pos.y;
      min=Math.min(min,relativeY);max=Math.max(max,relativeY);
    }
    return {min,max,range:max-min};
  })()`);

  assert.ok(walkingCameraHeight.range < 1e-6,
    `walking moved the camera vertically by ${walkingCameraHeight.range}`);

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

  const reverseRampQuickClimb = runtime.json(String.raw`(()=>{
    /* Approach the raised end of ramp(-15,15,0), matching the reverse-side
       climb shown in the manual regression screenshot. */
    const direction=new THREE.Vector3(-1,0,0);
    const resetApproach=()=>{
      player.pos.set(-12.85,0,15);player.vel.set(0,0,0);
      player.mode='ground';player.onGround=true;player.hold=-1;
      player.moveFrom=-1;player.moveTo=-1;
      player.cool=0;player.grace=0;player.vaultRecovery=0;
      player.vaultKind='none';player.jumpBuffer=0;player.climbBuffer=0;
      player.landingSurface=null;
      camYaw=Math.PI/2;targetYaw=camYaw;camPitch=0;targetPitch=0;heldDist=5.6;
      moveFwd.copy(direction);
      updateCam(1);
    };
    resetApproach();
    const prompt=canPromptQuickClimb(direction);
    hintTimer=0;hintFlash='';updateHint(0.1);
    const hint={text:hintEl.textContent,className:hintEl.className};
    keys.ShiftLeft=true;keys.KeyW=true;
    groundStep(1/120,direction);
    keys.ShiftLeft=false;keys.KeyW=false;
    const automatic={mode:player.mode,vaultKind:player.vaultKind};

    resetApproach();
    keys.Space=true;player.jumpBuffer=0.14;
    groundStep(1/120,direction);
    keys.Space=false;
    const started=player.mode==='vault'&&player.vaultKind==='quick';
    let ticks=0,clipped=false;
    while(started&&player.mode==='vault'&&ticks<240){
      vaultStep(1/120);
      for(const box of getStaticBoxCandidatesAt(player.pos)){
        if(box.active!==false&&playerOverlapsBox(player.pos,box)){
          clipped=true;break;
        }
      }
      ticks++;
    }
    return {
      prompt,hint,automatic,started,ticks,clipped,mode:player.mode,
      pos:player.pos.toArray(),height:player.pos.y
    };
  })()`);

  assert.equal(reverseRampQuickClimb.prompt, true,
    'the raised reverse side of the wooden ramp must show the quick-climb prompt');
  assert.deepEqual(reverseRampQuickClimb.hint, {
    text:'CLIMB UP',className:'action'
  });
  assert.notDeepEqual(reverseRampQuickClimb.automatic, {
    mode:'vault',vaultKind:'quick'
  }, 'Shift+W must not auto-pull a grounded player onto the ramp');
  assert.equal(reverseRampQuickClimb.started, true,
    'Space must start the prompted quick climb on the raised reverse side');
  assert.equal(reverseRampQuickClimb.clipped, false,
    'the reverse-ramp quick climb must not pass through authored collision');
  assert.equal(reverseRampQuickClimb.mode, 'ground');
  assert.ok(reverseRampQuickClimb.ticks < 240,
    'the reverse-ramp quick climb must finish');
  assert.ok(reverseRampQuickClimb.pos[0] < -13.4,
    'the quick climb must pull the player onto the ramp');
  assert.ok(reverseRampQuickClimb.height > 1.45,
    'the quick climb must land on the raised ramp surface');

  const rockContact = runtime.json(String.raw`(()=>{
    /* This is the south face of the 15-unit summit rock shown in the manual
       regression. It used to select a hidden-cylinder hold behind the visible
       voxel face and report HANDHOLD OUT OF REACH. */
    player.pos.set(0,0,2.8568888888888884);
    player.mode='ground';player.onGround=true;player.hold=-1;
    player.cool=0;player.grace=0;
    camYaw=0;targetYaw=camYaw;camPitch=0;targetPitch=0;heldDist=5.6;
    updateCam(1);
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

  const cannonBrickBreach = runtime.json(String.raw`(()=>{
    const structure=houseA.voxelStructure;
    const beforeVoxels=structure.activeN;
    const beforeDebris=voxelPhysics.stats().debris;
    damageStructureFromBullet(houseA,structure.mesh,
      new THREE.Vector3(-13,3.5,-2.99),new THREE.Vector3(0,0,-1),
      WEAPONS.cannon,new THREE.Vector3(0,0,1));
    return {
      removed:beforeVoxels-structure.activeN,
      debris:voxelPhysics.stats().debris-beforeDebris
    };
  })()`);

  assert.ok(cannonBrickBreach.removed>=8,
    `one cannon round removed only ${cannonBrickBreach.removed} authored brick voxels`);
  assert.ok(cannonBrickBreach.debris>=12,
    'the cannon breach must throw visible masonry debris');

  /* game-loop is normally omitted from the deterministic runtime so no RAF is
     scheduled. Load it last and drive the performance HUD directly. */
  runtime.evaluate(fs.readFileSync(path.join(projectRoot,'js/game-loop.js'),'utf8'),
    'js/game-loop.js');
  const performanceHud = runtime.json(String.raw`(()=>{
    resetPerformanceHud(0);
    for(let i=0;i<30;i++)
      updatePerformanceHud(1000/60,(i+1)*1000/60);
    const points=document.getElementById('frametime-graph')
      .getAttribute('points').trim().split(/\s+/);
    return {
      fps:document.getElementById('fps-value').textContent,
      frameTime:document.getElementById('frametime-value').textContent,
      status:document.getElementById('perf').className,
      graphPoints:points.length
    };
  })()`);

  assert.deepEqual(performanceHud, {
    fps:'60 FPS',frameTime:'16.7 ms',status:'good',graphPoints:120
  });
});
