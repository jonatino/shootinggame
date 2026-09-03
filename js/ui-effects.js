/* HUD feedback, particles, rockets, and explosion visuals. Loaded in order from index.html. */
const hintEl=document.getElementById('hint');
const hintProxyCandidates=[];
let hintFlash='',hintTimer=0;
function flashHint(msg,bad){
  hintFlash=msg;
  /* Keep action feedback visible long enough to read. Previously the next
     60 Hz hint update erased a failed-grab reason before a player could see it,
     which made a valid wall feel unresponsive during testing. */
  hintTimer=Math.max(hintTimer,0.55);
  hintEl.textContent=msg;
  hintEl.className=bad?'bad':'';
}
function updateHint(dt){
  hintTimer-=dt;
  if(hintFlash){hintFlash='';return;}
  if(hintTimer>0)return;
  hintTimer=0.08;
  hintFwd.set(-Math.sin(camYaw),0,-Math.cos(camYaw));
  hintOrigin.set(player.pos.x,player.pos.y+1.3,player.pos.z);
  rc.set(hintOrigin,hintFwd);rc.far=2.4;rc.near=0.01;
  hintProxyCandidates.length=0;
  for(const mesh of getCameraOccluderCandidates(hintOrigin,hintFwd,2.4))
    if(proxyByMesh.has(mesh))hintProxyCandidates.push(mesh);
  const hits=rc.intersectObjects(hintProxyCandidates,false);
  let msg='';
  let actionPrompt=false;
  if(player.mode==='ground'){
    lowVaultActionDir.copy(hintFwd);
    if(canPromptLowVault(lowVaultActionDir)){
      msg='VAULT';
      actionPrompt=true;
    }
  }
  if(!msg&&hits.length){
    const pr=proxyByMesh.get(hits[0].object);
    if(pr&&!pr.grip)msg='NO GRIP — polished surface';
    else if(player.mode==='ground')msg='HOLD SHIFT + W — climb';
  }
  if(!msg&&player.mode==='ground'){
    /* Show the same forgiving nearby-grip affordance used by tryGrab. This
       keeps the prompt useful on faceted surfaces where a single center ray is
       visually off a triangle even though the player can make a valid reach. */
    /* Prompts only need a nearby live grip. The exact hang/body sweep belongs
       to the action itself; running it from this periodic HUD update validated
       dozens of dense rock holds and could stall the entire render loop. */
    const i=nearestHold(hintOrigin,hintOrigin.y,2.7);
    if(i>=0){
      const h=HOLDS[i];
      msg=cameraFacesClimbHold(h,hintOrigin)?
        'HOLD SHIFT + W — climb':'TURN TOWARD CLIMB SURFACE';
    }
  }
  if(!msg&&player.mode==='hang'){
    const h=HOLDS[player.hold];
    if(h){
      const hasVault=h.vault&&h.vaultMesh&&surfaceObjectIsLive(h.vaultMesh);
      const hasUp=liveTraversalLinkCount(h,'up')>0;
      const hasSide=liveTraversalLinkCount(h,'side')>0;
      msg=hasVault?'VAULT':
        (hasUp?'SHIFT + W — climb higher':(hasSide?'A / D — traverse':'S — let go'));
      actionPrompt=hasVault;
    }
  }
  hintEl.textContent=msg;
  hintEl.className=msg.indexOf('NO GRIP')===0?'bad':(actionPrompt?'action':'');
}

function updateStatsUI(){
  const w=wpnStats();
  document.getElementById('wpn').textContent=w.name;
  document.getElementById('ammo').textContent='∞ / ∞';
  document.getElementById('hp').textContent='HP '+player.hp;
  document.getElementById('hpfill').style.width=Math.max(0,player.hp)+'%';
  document.getElementById('hpfill').style.background=player.hp>50?'#5ed068':player.hp>25?'#e8b04a':'#e25a4a';
  const voxelStats=voxelPhysics.stats();
  document.getElementById('kill').textContent='KILLS '+kills+' · SLABS '+voxelStats.chunks+
    ' · RUBBLE '+voxelStats.debris;
}
setInterval(updateStatsUI,250);

const hitEl=document.getElementById('hit');
let hitFade=0;
function showHit(){hitFade=1;Sfx.hurt();}

const markerEl=document.getElementById('marker');
let markerTimer=0;
function showMarker(){
  markerEl.classList.remove('show');
  void markerEl.offsetWidth;
  markerEl.classList.add('show');
  markerTimer=0.18;
}
function updateMarker(dt){
  if(markerTimer>0){
    markerTimer-=dt;
    if(markerTimer<=0)markerEl.classList.remove('show');
  }
}
function updateHitUI(dt){
  if(hitFade>0){
    hitFade=Math.max(0,hitFade-dt*4);
    hitEl.style.opacity=hitFade*0.7;
  }
  const low=document.getElementById('lowhp');
  const lowHp=started&&player.hp<30;
  if(lowHp){low.style.display='block';low.classList.add('pulse');}
  else{low.style.display='none';low.classList.remove('pulse');}
}

function updateBulletLines(dt){
  for(let i=bulletLines.length-1;i>=0;i--){
    const b=bulletLines[i];
    b.life-=dt;
    b.line.material.opacity=Math.max(0,b.life/b.lifeMax);
    if(b.life<=0){
      releaseBulletEffect(b.line);
      bulletLines.splice(i,1);
    }
  }
}

function updateRockets(dt){
  for(let i=rockets.length-1;i>=0;i--){
    const r=rockets[i];
    rocketPrev.copy(r.pos);
    r.pos.addScaledVector(r.vel,dt);
    /* Integrate the same constant-gravity trajectory used by the launch
       solver. The previous semi-implicit step added one extra frame of drop,
       so even a mathematically corrected shot landed below the reticle. */
    r.pos.y-=0.5*ROCKET_GRAVITY*dt*dt;
    r.vel.y-=ROCKET_GRAVITY*dt;
    r.life-=dt;
    r.mesh.position.copy(r.pos);
    r.dir.copy(r.vel).normalize();
    r.mesh.quaternion.setFromUnitVectors(UP,r.dir);
    r.trailTimer-=dt;
    if(r.trailTimer<=0){
      r.trailTimer=0.06;
      const smoke=makeParticleMesh(geoSmoke,'smoke',0xb8b8b8);
      smoke.position.copy(r.pos);
      smoke.userData.life=0.9;
      smoke.userData.lifeMax=0.9;
      smoke.userData.vel=V(rand(-0.5,0.5),1+rand(0,0.6),rand(-0.5,0.5));
      scene.add(smoke);
      addParticle(smoke);
      if(Math.random()<0.4){
        const fire=makeParticleMesh(geoFire,'fire',0xff8030);
        fire.position.copy(r.pos);
        fire.userData.life=0.2;fire.userData.lifeMax=0.2;
        fire.userData.vel=V(0,0,0);
        scene.add(fire);
        addParticle(fire);
      }
    }
    if(r.life<=0){scene.remove(r.mesh);rockets.splice(i,1);continue;}
    let hit=false,hitPoint=null;
    rocketTravel.subVectors(r.pos,rocketPrev);
    const travel=rocketTravel.length();
    if(travel>0.001){
      rocketAxis.copy(rocketTravel).multiplyScalar(1/travel);
      rc.set(rocketPrev,rocketAxis);rc.far=travel+0.2;rc.near=0.001;
      /* Projectiles collide with every solid visual and voxel actor that the
         reticle can resolve, including roofs, trim, and already-fallen chunks. */
      const hits=rc.intersectObjects(collectShotTargets(),false);
      if(hits.length){hit=true;hitPoint=hits[0].point.clone();}
    }
    if(!hit&&r.pos.y<0.1){hit=true;hitPoint=r.pos.clone();}
    if(hit){
      scene.remove(r.mesh);
      explode(hitPoint);
      rockets.splice(i,1);
    }
  }
}

function updateExplosions(dt){
  for(let i=explosions.length-1;i>=0;i--){
    const e=explosions[i];
    e.life-=dt;
    const k=1-e.life/e.lifeMax;
    e.mesh.scale.setScalar(1+k*(e.maxScale-1));
    e.mesh.material.opacity=Math.max(0,e.life/e.lifeMax);
    if(e.life<=0){
      scene.remove(e.mesh);
      if(!SHARED_GEO.has(e.mesh.geometry))e.mesh.geometry.dispose();
      e.mesh.material.dispose();
      explosions.splice(i,1);
    }
  }
}

const chunkSpinAxis=V();
const chunkSpinQuaternion=new THREE.Quaternion();
const chunkInverseQuaternion=new THREE.Quaternion();
const blastImpulseWorld=V(),blastTorqueWorld=V(),blastLever=V(),blastTangential=V();
const activateAway=V(),activateVelocity=V(),blastActiveDelta=V();
const satNormal=V(),satContact=V(),satSupportA=V(),satSupportB=V(),satSupportDir=V();
const structuralImpactMarkNormal=V();
const satCross=V(),satInvCross=V(),satTorque=V(),satLocal=V(),satWorld=V();
const contactRA=V(),contactRB=V(),contactVelA=V(),contactVelB=V(),contactRelativeVel=V();
const contactImpulse=V(),contactTangent=V(),groundSupport=V();
const rollingAxis=V(),rollingImpulse=V(),rollingDelta=V();
const fractureFailureCenter=V(),fractureFailureDir=V(),fractureFailureAxis=V();
const activeChunkSet=new Set();
let supportPathStamp=0;
