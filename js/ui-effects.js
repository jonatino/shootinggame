/* HUD feedback, particles, and explosion visuals. Loaded in order from index.html. */
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
  const pickup=nearbyPickup();
  if(pickup){
    hintEl.textContent=pickup.kind==='health'?
      (player.hp<100?'E — restore health':'HEALTH FULL'):
      ('E — equip '+pickup.kind.toUpperCase());
    hintEl.className='';
    return;
  }
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
    }else if(canPromptQuickClimb(lowVaultActionDir)){
      msg='CLIMB UP';
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

function setHudText(id,value){
  const element=document.getElementById(id);
  if(element.textContent!==value)element.textContent=value;
}
function updateStatsUI(){
  const w=wpnStats();
  setHudText('wpn',w.displayName||w.name);
  setHudText('ammo','∞ / ∞');
  setHudText('hp','HP '+player.hp);
  const hpFill=document.getElementById('hpfill');
  const hpWidth=Math.max(0,player.hp)+'%';
  const hpColor=player.hp>50?'#5ed068':player.hp>25?'#e8b04a':'#e25a4a';
  if(hpFill.style.width!==hpWidth)hpFill.style.width=hpWidth;
  if(hpFill.style.background!==hpColor)hpFill.style.background=hpColor;
  const voxelStats=voxelPhysics.stats();
  setHudText('kill','KILLS '+kills+' · SLABS '+voxelStats.chunks+
    ' · RUBBLE '+voxelStats.debris);
}
setInterval(updateStatsUI,250);

const hitEl=document.getElementById('hit');
let hitFade=0;
function showHit(){hitFade=1;Sfx.hurt();}

const markerEl=document.getElementById('marker');
let markerTimer=0,markerAnimationSerial=0;
function showMarker(){
  const markerClass=++markerAnimationSerial&1?'show-a':'show-b';
  markerEl.classList.remove(markerClass==='show-a'?'show-b':'show-a');
  markerEl.classList.add(markerClass);
  markerTimer=0.18;
}
function updateMarker(dt){
  if(markerTimer>0){
    markerTimer-=dt;
    if(markerTimer<=0)markerEl.classList.remove('show-a','show-b');
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

function updateParticles(dt){
  if(muzzleLight&&muzzleLight.life!==undefined){
    muzzleLight.life-=dt;
    if(muzzleLight.life<=0){muzzleLight.intensity=0;}
    else muzzleLight.intensity=Math.max(0,muzzleLight.intensity-dt*40);
  }
  for(let i=particles.length-1;i>=0;i--){
    const p=particles[i];
    p.userData.life-=dt;
    if(p.userData.vel){
      p.userData.vel.y-=2*dt;
      p.position.addScaledVector(p.userData.vel,dt);
    }
    const k=p.userData.life/p.userData.lifeMax;
    p.material.opacity=Math.max(0,k*(p.userData.opacityScale===undefined?0.7:p.userData.opacityScale));
    const baseScale=p.userData.baseScale===undefined?1:p.userData.baseScale;
    if(!p.userData.staticScale)p.scale.setScalar(baseScale*(0.6+(1-k)*1.2));
    if(p.userData.life<=0||p.position.y<0){
      scene.remove(p);
      if(!SHARED_GEO.has(p.geometry))p.geometry.dispose();
      releaseParticleMaterial(p);
      particles.splice(i,1);
    }
  }
}

const enemyTracerDirection=V();
function syncEnemyBulletVisuals(alpha){
  for(const bullet of enemyBullets){
    if(!bullet.mesh){bullet.mesh=acquireBulletEffect('enemyTracer');scene.add(bullet.mesh);}
    const speed=bullet.vel.length();
    const travelled=(bullet.age||0)*speed-(1-alpha)*bullet.prev.distanceTo(bullet.pos);
    const length=Math.max(0.02,Math.min(1.1,travelled));
    enemyTracerDirection.copy(bullet.vel).normalize();
    bullet.mesh.position.lerpVectors(bullet.prev,bullet.pos,alpha)
      .addScaledVector(enemyTracerDirection,-length*0.5);
    bullet.mesh.quaternion.setFromUnitVectors(UP,enemyTracerDirection);
    bullet.mesh.scale.set(0.32,length,0.32);
  }
}
