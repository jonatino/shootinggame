/* Enemy, dummy, pickup, and projectile updates. Loaded in order from index.html. */
const ACTOR_PART_DURABILITY={
  torso:45,head:8,leftArm:12,rightArm:12,leftLeg:9,rightLeg:9,gun:5
};
const actorRigidCentre=V(),actorRigidDirection=V(),actorRigidAxis=V();
const actorBoundsMin=V(),actorBoundsMax=V(),actorBoundsPoint=V();
const actorBoundsInverse=new THREE.Matrix4();
const actorRigidQuaternion=new THREE.Quaternion();

function ensureActorPartHealth(actor){
  if(!actor||!actor.partStates)return;
  for(const state of Object.values(actor.partStates)){
    if(state.maxHp>0)continue;
    state.maxHp=ACTOR_PART_DURABILITY[state.name]||12;
    state.hp=state.maxHp;
  }
}

function actorPartIsAttached(actor,name){
  const state=actor&&actor.partStates&&actor.partStates[name];
  return !!(state&&!state.detached);
}

function actorPartWorldCentre(state,out){
  state.mesh.updateMatrixWorld(true);
  return out.copy(state.center).applyMatrix4(state.mesh.matrixWorld);
}

function removeActorRigidRoot(root){
  if(!root)return;
  let index=chunks.indexOf(root);
  if(index>=0)chunks.splice(index,1);
  index=settledFragments.indexOf(root);
  if(index>=0){settledFragments.splice(index,1);markSettledGridDirty();}
  const box=root.userData&&root.userData.fractureBox;
  if(box){
    removePhysicsBox(box);
    settledBoxSet.delete(box);
    const boxIndex=boxes.indexOf(box);
    if(boxIndex>=0)boxes.splice(boxIndex,1);
    root.userData.fractureBox=null;
    staticBoxGridDirty=true;
  }
  removeOccluder(root);
  index=standables.indexOf(root);
  if(index>=0)standables.splice(index,1);
  if(root.parent)root.parent.remove(root);
}

function activateActorRigidRoot(root,size,actor,partState,epicenter,direction,force,isBody){
  root.userData={
    kind:isBody?'actorBody':'actorPart',actorRigid:true,voxelActor:actor,
    actorPartState:partState||null,size:size.clone(),
    mass:isBody?4.8:Math.max(0.22,size.x*size.y*size.z*3.6),
    fractureKind:'wood',fractureTinted:true
  };
  if(chunks.length>=MAX_CHUNKS)freeChunkSlot(epicenter);
  activateChunk(root,epicenter,Math.max(0.7,force||1),true,null);
  actorRigidDirection.copy(direction||root.position).setY(0);
  if(actorRigidDirection.lengthSq()<0.0001&&epicenter)
    actorRigidDirection.subVectors(root.position,epicenter).setY(0);
  if(actorRigidDirection.lengthSq()<0.0001)
    actorRigidDirection.set(Math.sin(actor.group.rotation.y),0,Math.cos(actor.group.rotation.y));
  actorRigidDirection.normalize();
  actorRigidAxis.crossVectors(UP,actorRigidDirection);
  if(actorRigidAxis.lengthSq()<0.0001)actorRigidAxis.set(1,0,0);
  else actorRigidAxis.normalize();
  if(isBody){
    /* A dead character stays one articulated voxel object. Give the shared
       rigid solver a low, off-centre impulse so it pivots and lands like a
       felled column instead of bursting into a cloud of independent cubes. */
    const shove=Math.min(3.2,0.3+Math.max(0,force||0)*0.2);
    /* Start just clear of the floor so the initial angular impulse is not
       cancelled by an already-penetrating foot contact. Eight radians per
       second is enough to carry this narrow upright OBB past its balance
       point; gravity and the ordinary contact solver own the rest of the fall. */
    root.position.y+=0.08;
    root.userData.vel.copy(actorRigidDirection).multiplyScalar(shove);
    root.userData.vel.y=0.8+Math.min(0.6,Math.max(0,force||0)*0.04);
    root.userData.angVel.copy(actorRigidAxis)
      .multiplyScalar(8+Math.min(1.2,Math.max(0,force||0)*0.08));
  }else{
    const launch=Math.min(7,1.2+Math.max(0,force||0)*0.48);
    root.userData.vel.copy(actorRigidDirection).multiplyScalar(launch);
    root.userData.vel.y=1.4+Math.min(3.2,Math.max(0,force||0)*0.22);
    root.userData.angVel.copy(actorRigidAxis).multiplyScalar(4.2+launch*0.32);
    root.userData.angVel.y=(partState&&partState.name.length%3-1)*0.9;
  }
  chunks.push(root);
  return root;
}

function detachVoxelActorPart(actor,name,epicenter,direction,force){
  const state=actor&&actor.partStates&&actor.partStates[name];
  if(!state||state.detached||name==='torso')return null;
  actor.group.updateMatrixWorld(true);
  actorPartWorldCentre(state,actorRigidCentre);
  state.holder.getWorldQuaternion(actorRigidQuaternion);
  const root=new THREE.Group();
  root.position.copy(actorRigidCentre);root.quaternion.copy(actorRigidQuaternion);
  scene.add(root);root.updateMatrixWorld(true);
  root.attach(state.holder);
  state.detached=true;
  state.rigidRoot=activateActorRigidRoot(root,state.size,actor,state,
    epicenter||actorRigidCentre,direction,force,false);
  if(name==='gun')actor.disarmed=true;
  if(name==='rightArm'&&actorPartIsAttached(actor,'gun')){
    detachVoxelActorPart(actor,'gun',epicenter,direction,Math.max(0.8,(force||1)*0.7));
    actor.disarmed=true;
  }
  if(!actorPartIsAttached(actor,'leftArm')&&!actorPartIsAttached(actor,'rightArm'))
    actor.disarmed=true;
  return state.rigidRoot;
}

function measureAttachedActor(actor){
  actor.group.updateMatrixWorld(true);
  actorBoundsInverse.copy(actor.group.matrixWorld).invert();
  actorBoundsMin.set(Infinity,Infinity,Infinity);
  actorBoundsMax.set(-Infinity,-Infinity,-Infinity);
  let points=0;
  for(const state of Object.values(actor.partStates||{})){
    if(state.detached)continue;
    const cells=state.mesh.userData.voxelCells||[];
    const pad=(state.mesh.userData.voxelCellSize||0.1)*0.58;
    state.mesh.updateMatrixWorld(true);
    for(const cell of cells){
      actorBoundsPoint.copy(cell).applyMatrix4(state.mesh.matrixWorld)
        .applyMatrix4(actorBoundsInverse);
      actorBoundsMin.x=Math.min(actorBoundsMin.x,actorBoundsPoint.x-pad);
      actorBoundsMin.y=Math.min(actorBoundsMin.y,actorBoundsPoint.y-pad);
      actorBoundsMin.z=Math.min(actorBoundsMin.z,actorBoundsPoint.z-pad);
      actorBoundsMax.x=Math.max(actorBoundsMax.x,actorBoundsPoint.x+pad);
      actorBoundsMax.y=Math.max(actorBoundsMax.y,actorBoundsPoint.y+pad);
      actorBoundsMax.z=Math.max(actorBoundsMax.z,actorBoundsPoint.z+pad);
      points++;
    }
  }
  if(!points){actorBoundsMin.set(-0.28,0.05,-0.2);actorBoundsMax.set(0.28,1.6,0.2);}
  return {
    center:actorBoundsMin.clone().add(actorBoundsMax).multiplyScalar(0.5),
    size:actorBoundsMax.clone().sub(actorBoundsMin)
  };
}

function toppleVoxelActor(actor,epicenter,direction,force){
  if(!actor||actor.rigidBody)return actor&&actor.rigidBody;
  const bounds=measureAttachedActor(actor);
  actor.group.updateMatrixWorld(true);
  actorRigidCentre.copy(bounds.center).applyMatrix4(actor.group.matrixWorld);
  actor.group.getWorldQuaternion(actorRigidQuaternion);
  const root=new THREE.Group();
  root.position.copy(actorRigidCentre);root.quaternion.copy(actorRigidQuaternion);
  scene.add(root);root.updateMatrixWorld(true);
  root.attach(actor.group);
  actor.rigidBody=activateActorRigidRoot(root,bounds.size,actor,null,
    epicenter||actorRigidCentre,direction,force,true);
  return actor.rigidBody;
}

function killVoxelActor(actor,epicenter,direction,force){
  if(!actor||!actor.alive)return false;
  actor.alive=false;actor.disarmed=true;
  if(actor.actorKind==='dummy')actor.respawn=8;
  toppleVoxelActor(actor,epicenter,direction,force);
  return true;
}

function damageVoxelActor(actor,mesh,point,direction,damage,force){
  if(!actor||!actor.alive)return {hit:false,killed:false,detached:false,part:null};
  ensureActorPartHealth(actor);
  const state=mesh&&mesh.userData&&mesh.userData.actorPartState;
  if(!state||state.detached)return {hit:false,killed:false,detached:false,part:null};
  const name=state.name;
  state.hp-=damage;
  const actorDamage=name==='gun'?0:(name==='head'?damage*1.5:damage);
  actor.hp-=actorDamage;
  const shouldDetach=name!=='torso'&&(state.hp<=0||(force||0)>=8);
  if(shouldDetach)detachVoxelActorPart(actor,name,point,direction,force);
  const criticalLoss=shouldDetach&&
    (name==='head'||name==='leftLeg'||name==='rightLeg');
  const killed=actor.hp<=0||criticalLoss;
  if(killed)killVoxelActor(actor,point,direction,force);
  return {hit:true,killed,detached:shouldDetach,part:name};
}

function damageVoxelActorFromBlast(actor,epicenter,damage,force){
  if(!actor||!actor.alive)return {hit:false,killed:false,detached:[]};
  ensureActorPartHealth(actor);
  actor.group.updateMatrixWorld(true);
  actorRigidDirection.subVectors(actor.pos,epicenter).setY(0);
  if(actorRigidDirection.lengthSq()<0.0001)actorRigidDirection.set(0,0,1);
  else actorRigidDirection.normalize();
  const candidates=[];
  for(const state of Object.values(actor.partStates||{})){
    if(state.detached||state.name==='torso')continue;
    const centre=actorPartWorldCentre(state,V());
    candidates.push({state,distance:centre.distanceToSquared(epicenter)});
  }
  candidates.sort((a,b)=>a.distance-b.distance);
  const detachCount=damage>=80?4:(damage>=35?2:(damage>=8?1:0));
  const detached=[];
  for(let i=0;i<Math.min(detachCount,candidates.length);i++){
    const state=candidates[i].state;
    detachVoxelActorPart(actor,state.name,epicenter,actorRigidDirection,force);
    detached.push(state.name);
  }
  actor.hp-=damage;
  const criticalLoss=detached.some(name=>
    name==='head'||name==='leftLeg'||name==='rightLeg');
  const killed=actor.hp<=0||criticalLoss;
  if(killed)killVoxelActor(actor,epicenter,actorRigidDirection,force);
  return {hit:true,killed,detached};
}

function resetVoxelActor(actor){
  if(!actor)return;
  if(actor.rigidBody){
    scene.attach(actor.group);
    removeActorRigidRoot(actor.rigidBody);
    actor.rigidBody=null;
  }else if(actor.group.parent!==scene){
    scene.attach(actor.group);
  }
  actor.group.position.copy(actor.spawnPos||actor.pos);
  actor.group.quaternion.identity();actor.group.scale.set(1,1,1);
  actor.group.visible=true;
  for(const state of Object.values(actor.partStates||{})){
    if(state.rigidRoot){
      actor.group.attach(state.holder);
      removeActorRigidRoot(state.rigidRoot);
      state.rigidRoot=null;
    }else if(state.holder.parent!==actor.group){
      actor.group.attach(state.holder);
    }
    state.holder.position.copy(state.restPosition);
    state.holder.quaternion.copy(state.restQuaternion);
    state.holder.scale.copy(state.restScale);
    state.holder.visible=true;state.mesh.visible=true;
    state.detached=false;state.maxHp=ACTOR_PART_DURABILITY[state.name]||12;
    state.hp=state.maxHp;
  }
  actor.pos.copy(actor.spawnPos||actor.pos);
  actor.hp=actor.maxHp;actor.alive=true;actor.disarmed=false;
  actor.vel&&actor.vel.set(0,0,0);
  actor.group.updateMatrixWorld(true);
}

function updateEnemies(dt){
  for(const e of enemies){
    if(!e.alive)continue;
    let moving=false;
    e.cooldown=Math.max(0,e.cooldown-dt);
    e.recoil=Math.max(0,e.recoil-dt*4);
    const toPlayer=enemyToPlayer.subVectors(player.pos,e.pos);
    toPlayer.y=0;
    const dist=toPlayer.length();
    if(dist>0.001)toPlayer.normalize();
    const seePlayer=dist<28;
    let blocked=false;
    if(seePlayer){
      enemyRayOrigin.set(e.pos.x,e.pos.y+1.5,e.pos.z);
      enemyRayDir.copy(toPlayer);
      rc.set(enemyRayOrigin,enemyRayDir);
      rc.far=dist;rc.near=0.1;
      const hits=rc.intersectObjects(occluders,false);
      if(hits.length&&hits[0].distance<dist-1)blocked=true;
    }
    if(seePlayer&&!blocked){
      e.state='attack';
      const desiredYaw=Math.atan2(toPlayer.x,toPlayer.z);
      e.group.rotation.y+=(desiredYaw-e.group.rotation.y)*(1-Math.exp(-6*dt));
      if(!e.disarmed&&e.cooldown<=0){
        e.cooldown=1.6+Math.random()*0.6;
        e.recoil=0.15;
        enemyShoot(e,toPlayer);
      }
    }else{
      e.state='patrol';
      const wp=e.path[e.target];
      const to=enemyToPlayer.subVectors(wp,e.pos);to.y=0;
      if(to.length()<1.2){
        e.target=(e.target+1)%e.path.length;
      }else{
        to.normalize();
        e.pos.addScaledVector(to,2.2*dt);
        moving=true;
      }
      const desiredYaw=Math.atan2(to.x,to.z);
      e.group.rotation.y+=(desiredYaw-e.group.rotation.y)*(1-Math.exp(-6*dt));
    }
    e.group.position.copy(e.pos);
    e.walkPhase+=dt*(moving?10:2.2);
    const stride=moving?Math.sin(e.walkPhase)*0.62:Math.sin(e.walkPhase)*0.035;
    if(actorPartIsAttached(e,'leftLeg'))e.parts.leftLeg.rotation.x=stride;
    if(actorPartIsAttached(e,'rightLeg'))e.parts.rightLeg.rotation.x=-stride;
    e.parts.torso.rotation.z=moving?Math.sin(e.walkPhase*0.5)*0.035:0;
    if(e.state==='attack'){
      if(actorPartIsAttached(e,'leftArm'))e.parts.leftArm.rotation.x=-0.98;
      if(actorPartIsAttached(e,'rightArm'))e.parts.rightArm.rotation.x=-1.08-e.recoil*1.8;
    }else{
      if(actorPartIsAttached(e,'leftArm'))e.parts.leftArm.rotation.x=-0.68-stride*0.16;
      if(actorPartIsAttached(e,'rightArm'))e.parts.rightArm.rotation.x=-0.84+stride*0.12;
    }
    if(actorPartIsAttached(e,'gun'))e.parts.gun.position.z=0.18-e.recoil*0.42;
  }
}
const enemyBullets=[];
const solidTargets=[];
const enemyToPlayer=V(),enemyRayOrigin=V(),enemyRayDir=V(),enemyBulletDelta=V(),enemyBulletRayDir=V();
const enemyBulletTravel=V(),enemyBulletClosest=V();
function enemyShoot(e,dir){
  const dmg=8;
  const origin=e.pos.clone().add(V(0,1.5,0));
  const spread=new THREE.Vector3((Math.random()-0.5)*0.05,(Math.random()-0.5)*0.05,(Math.random()-0.5)*0.05);
  const d=dir.clone().add(spread).normalize();
  const speed=22;
  enemyBullets.push({pos:origin.clone(),prev:origin.clone(),vel:d.multiplyScalar(speed),life:2.5,dmg,color:0xff8866});
}

function updateEnemyBullets(dt){
  if(enemyBullets.length===0)return;
  solidTargets.length=0;
  for(const mesh of occluders)solidTargets.push(mesh);
  for(let i=enemyBullets.length-1;i>=0;i--){
    const b=enemyBullets[i];
    b.prev.copy(b.pos);
    b.pos.addScaledVector(b.vel,dt);
    b.life-=dt;
    if(b.life<=0){enemyBullets.splice(i,1);continue;}
    enemyBulletTravel.subVectors(b.pos,b.prev);
    const travel=enemyBulletTravel.length();
    let wallDist=Infinity;
    if(travel>0.001){
      enemyBulletRayDir.copy(enemyBulletTravel).multiplyScalar(1/travel);
      rc.set(b.prev,enemyBulletRayDir);rc.far=travel+0.05;rc.near=0.001;
      const hits=rc.intersectObjects(solidTargets,false);
      if(hits.length)wallDist=hits[0].distance;
    }
    const travelSq=enemyBulletTravel.lengthSq();
    const hitT=travelSq>1e-6?Math.max(0,Math.min(1,enemyBulletDelta.subVectors(player.pos,b.prev).dot(enemyBulletTravel)/travelSq)):0;
    enemyBulletClosest.copy(b.prev).addScaledVector(enemyBulletTravel,hitT);
    const d=enemyBulletDelta.subVectors(enemyBulletClosest,player.pos);
    if(hitT*travel<=wallDist+0.02&&Math.abs(d.y)<1.2&&Math.hypot(d.x,d.z)<0.45){
      player.hp-=b.dmg;
      showHit();
      updateStatsUI();
      enemyBullets.splice(i,1);
      if(player.hp<=0){
        player.hp=100;
        player.pos.set(8,0,16);
        player.vel.set(0,0,0);
        player.mode='ground';
        player.landingSurface=null;
        updateStatsUI();
      }
      continue;
    }
    if(wallDist<Infinity)enemyBullets.splice(i,1);
  }
}

function updateDummies(dt){
  for(const d of dummies){
    if(d.alive){
      if(d.tilt>0){
        d.tilt=Math.max(0,d.tilt-dt*2);
        d.group.rotation.x=d.tilt*0.6;
        d.group.rotation.z=d.tilt*0.3;
      }
    }else{
      d.respawn-=dt;
      if(d.respawn<=0){
        resetVoxelActor(d);d.tilt=0;d.respawn=0;
      }
    }
  }
}
function updatePickups(dt){
  for(const p of pickups){
    if(p.alive){
      p.group.rotation.y+=dt*1.2;
    }else{
      p.respawn-=dt;
      if(p.respawn<=0){
        p.alive=true;p.group.visible=true;
      }
    }
  }
}
