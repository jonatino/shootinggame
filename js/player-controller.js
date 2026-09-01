/* Input, collision, traversal, and player movement. Loaded in order from index.html. */
const player={pos:V(8,0,16),vel:V(),mode:'ground',hold:-1,
  moveFrom:-1,moveTo:-1,attachT:0,moveDuration:0.36,attachFrom:V(),
  vaultFrom:V(),vaultTo:V(),vaultNormal:V(),vaultT:0,vaultDuration:0.68,vaultClearance:0.72,vaultPush:0.42,
  vaultLandingNormal:V(0,1,0),
  vaultLeadLeft:true,
  vaultRecovery:0,
  landingSurface:null,landingAnchor:V(),landingY:0,landingRadius:1.35,
  climbBuffer:0,climbDir:V(),
  cool:0,grace:0,jumpGrace:0,jumpBuffer:0,onGround:true,heading:Math.PI,
  hp:100};
const playerCollisionBefore=V(),playerCollisionCorrection=V(),playerCollisionNormal=V();
const playerStepIntended=V(),playerStepBlocked=V(),playerStepCandidate=V(),playerStepVelocity=V();
const PLAYER_STEP_HEIGHT=0.42,PLAYER_STEP_MIN_RISE=0.035;
/* Start from a readable over-the-shoulder angle. The old near-rear view was
   valid for navigation, but it lined the weapon up with the camera's depth
   axis and made the held rifle/pistol disappear into the torso. A modest side
   angle keeps the normal chase view while exposing the hands, elbows, and gun
   silhouette without changing the player's aim direction. */
let camYaw=0.72,camPitch=0.27,camShake=0;
let targetYaw=camYaw,targetPitch=camPitch,camRoll=0,curFov=75,bobPhase=0;
let camRollTarget=0,camBobAmt=0,sprinting=false,camPitchKick=0,camYawKick=0,camFovKick=0;
let moveSpeed=0,camZoom=1,heldDist=5.6;
/* Fire-rate cooldown and physical recoil are separate signals. Cooldown says
   when the weapon may fire again; recoil is a short impulse shared by the
   stock, shoulders, torso, and muzzle so automatic fire does not leave the
   body frozen while only the crosshair twitches. */
const weaponRecoilProfiles={
  PISTOL:{load:0.34,pitch:0.045,roll:0.014},
  RIFLE:{load:0.24,pitch:0.032,roll:0.011},
  SHOTGUN:{load:0.7,pitch:0.105,roll:0.032},
  RPG:{load:0.95,pitch:0.16,roll:0.05}
};
let weaponRecoilKick=0,weaponRecoilPitch=0,weaponRecoilRoll=0;
/* reusable vectors to avoid per-frame allocation in updateCam */
const camTmp1=V(),camTmp2=V(),camTmp3=V(),camAltDir=V(),camBestDir=V();
const camClimbNormal=V(),camClimbSide=V();
const cameraOrbitOffsets=[Math.PI*0.5,-Math.PI*0.5,Math.PI*0.34,-Math.PI*0.34,Math.PI*0.75,-Math.PI*0.75];
const moveFwd=V(),moveRight=V(),moveDir=V(),camMoveFwd=V(),camMoveRight=V(),hintOrigin=V(),hintFwd=V();
const movementAccelWorld=V();
let climbPhase=0,climbStepParity=0,landingKick=0,walkPhase=0,walkAmt=0,heading=Math.PI;
let weaponSprint=0,movementAccel=0;
let started=false;
let mouseHeld=false;
let mouseLookReady=false,lastMouseX=0,lastMouseY=0;
let fireBlockUntil=0;
const climbIntentDir=V();
let climbIntentUntil=0;
let shiftIntentUntil=0;
let dropIntentUntil=0,spaceIntentUntil=0;
let vaultIntentUntil=0;
const movementIntentDir=V();
let movementIntentUntil=0;
/* Preserve very short taps across a slow input/render boundary. Keep this
   brief: at the higher combat speeds, a longer grace period feels like ice. */
const MOVEMENT_INTENT_WINDOW=0.12;

const keys={};
const inputKeyAliases={
  w:'KeyW',a:'KeyA',s:'KeyS',d:'KeyD',
  W:'KeyW',A:'KeyA',S:'KeyS',D:'KeyD',
  KEYW:'KeyW',KEYA:'KeyA',KEYS:'KeyS',KEYD:'KeyD',
  Shift:'ShiftLeft',ShiftLeft:'ShiftLeft',ShiftRight:'ShiftRight',
  SHIFT:'ShiftLeft',SHIFTLEFT:'ShiftLeft',SHIFTRIGHT:'ShiftRight',
  Space:'Space',SPACE:'Space',' ':'Space'
};
function normalizedInputCode(e){
  return inputKeyAliases[e.code]||inputKeyAliases[e.key]||e.code;
}
addEventListener('keydown',e=>{
  const code=normalizedInputCode(e);
  keys[code]=true;
  if(code==='Space')e.preventDefault();
  if(!started)return;
  const inputNow=performance.now();
  const shiftCode=code==='ShiftLeft'||code==='ShiftRight';
  if(shiftCode)shiftIntentUntil=inputNow+0.28*1000;
  if(code==='KeyS')dropIntentUntil=inputNow+0.3*1000;
  if(code==='Space'){
    dropIntentUntil=inputNow+0.3*1000;spaceIntentUntil=inputNow+0.3*1000;
    if(player.mode==='hang')vaultIntentUntil=inputNow+0.34*1000;
  }
  /* CUA/embedded browsers can deliver a short Shift+W chord entirely between
     two physics samples. Preserve the actual world-space approach for a tiny
     input window so sprinting at a ledge still enters the same grab test as a
     normally held keyboard chord. */
  const separatedChord=code==='KeyW'&&inputNow<shiftIntentUntil;
  const liveChord=keys.KeyW&&(keys.ShiftLeft||keys.ShiftRight);
  const chorded=(code==='KeyW'&&(e.shiftKey||separatedChord||liveChord))||
    (shiftCode&&liveChord);
  if(chorded){
    const ix=(keys.KeyD?1:0)-(keys.KeyA?1:0);
    const iz=(keys.KeyW?1:0)-(keys.KeyS?1:0)||(code==='KeyW'?1:0);
    /* Compute from the camera angle directly; the first chord can arrive
       before the first simulation tick has populated the reusable movement
       vectors. */
    const fwdX=-Math.sin(camYaw),fwdZ=-Math.cos(camYaw);
    const rightX=-fwdZ,rightZ=fwdX;
    climbIntentDir.set(fwdX*iz+rightX*ix,0,fwdZ*iz+rightZ*ix);
    if(climbIntentDir.lengthSq()>0.0001){
      climbIntentDir.normalize();
      /* Keep the chord alive through the short pull-in animation. Embedded
         test input often releases both keys immediately, but the player still
         expects that one intentional chord to finish its first hand transfer. */
      climbIntentUntil=inputNow+0.52*1000;
    }
  }
  if(code==='KeyW'||code==='KeyA'||code==='KeyS'||code==='KeyD'){
    const ix=(keys.KeyD?1:0)-(keys.KeyA?1:0);
    const iz=(keys.KeyW?1:0)-(keys.KeyS?1:0);
    const fwdX=-Math.sin(camYaw),fwdZ=-Math.cos(camYaw);
    const rightX=-fwdZ,rightZ=fwdX;
    movementIntentDir.set(fwdX*iz+rightX*ix,0,fwdZ*iz+rightZ*ix);
    if(movementIntentDir.lengthSq()>0.0001){
      movementIntentDir.normalize();
      movementIntentUntil=performance.now()+MOVEMENT_INTENT_WINDOW*1000;
    }
  }
  if(code==='KeyS'||code==='Space')climbIntentUntil=0;
  if(code==='Space')movementIntentUntil=0;
  if(code==='KeyM'&&!e.repeat)Sfx.toggle();
  if(code==='Space')player.jumpBuffer=0.14;
  if(code==='Digit1')setWeapon('pistol');
  if(code==='Digit2')setWeapon('rifle');
  if(code==='Digit3')setWeapon('shotgun');
  if(code==='Digit4')setWeapon('rpg');
  if(code==='KeyE')tryPickup();
});
addEventListener('keyup',e=>{
  const code=normalizedInputCode(e);
  keys[code]=false;
  if((code==='KeyW'||code==='KeyA'||code==='KeyS'||code==='KeyD')&&
     !keys.KeyW&&!keys.KeyA&&!keys.KeyS&&!keys.KeyD){
    movementIntentUntil=0;
    movementIntentDir.set(0,0,0);
  }
});
addEventListener('mousedown',e=>{
  if(!started||performance.now()<fireBlockUntil)return;
  if(e.button===0){mouseHeld=true;shoot();}
});
addEventListener('mouseup',e=>{if(e.button===0)mouseHeld=false;});
addEventListener('blur',()=>{
  mouseHeld=false;mouseLookReady=false;climbIntentUntil=0;shiftIntentUntil=0;
  dropIntentUntil=0;spaceIntentUntil=0;vaultIntentUntil=0;
  climbIntentDir.set(0,0,0);
  movementIntentUntil=0;movementIntentDir.set(0,0,0);
  for(const code in keys)keys[code]=false;
});
addEventListener('mousemove',e=>{
  if(!started)return;
  let dx=0,dy=0;
  if(document.pointerLockElement){
    dx=e.movementX;dy=e.movementY;
  }else{
    /* Pointer lock is unavailable in some embedded/local browsers. Keep the
       same relative-feel camera by integrating ordinary cursor deltas. */
    if(!mouseLookReady){lastMouseX=e.clientX;lastMouseY=e.clientY;mouseLookReady=true;return;}
    dx=e.clientX-lastMouseX;dy=e.clientY-lastMouseY;
    lastMouseX=e.clientX;lastMouseY=e.clientY;
  }
  targetYaw-=dx*0.0026;
  targetPitch=Math.max(-0.1,Math.min(1.25,targetPitch+dy*0.0026));
});
function requestGamePointerLock(){
  if(document.pointerLockElement===renderer.domElement)return;
  try{
    const request=renderer.domElement.requestPointerLock();
    if(request&&typeof request.catch==='function')request.catch(()=>{});
  }catch(_){
    /* Pointer lock is optional; some embedded browsers reject the request. */
  }
}
renderer.domElement.addEventListener('click',requestGamePointerLock);
document.getElementById('start').addEventListener('mousedown',e=>e.stopPropagation());
document.getElementById('start').addEventListener('click',()=>{
  Sfx.init();
  mouseLookReady=false;
  fireBlockUntil=performance.now()+250;
  requestGamePointerLock();
  document.getElementById('start').style.display='none';
});
addEventListener('wheel',e=>{camZoom=Math.max(0.65,Math.min(1.7,camZoom+(e.deltaY>0?0.1:-0.1)));},{passive:true});

function tryPickup(){
  for(const p of pickups){
    if(!p.alive)continue;
    const d=Math.hypot(p.pos.x-player.pos.x,p.pos.z-player.pos.z);
    if(d<1.5){
      p.alive=false;
      p.group.visible=false;
      p.respawn=12;
      if(p.kind==='health'){
        player.hp=Math.min(100,player.hp+40);
      }else if(p.kind==='ammo'){
      }else if(p.kind==='pistol'||p.kind==='rifle'||p.kind==='shotgun'){
        setWeapon(p.kind);
      }
      Sfx.pickup();
      updateStatsUI();
      return;
    }
  }
}

function groundBelow(x,z,fromY,limitY){
  groundProbeOrigin.set(x,fromY+0.3,z);
  rc.set(groundProbeOrigin,DOWN);rc.far=fromY+0.35;rc.near=0.001;
  const hits=rc.intersectObjects(standables,false);
  for(let i=0;i<hits.length;i++)
    if(hits[i].point.y<=fromY+0.31&&
       (limitY===undefined||hits[i].point.y<=limitY))return hits[i].point.y;
  return 0;
}

const playerObbAxes=[V(),V(),V()],playerObbHalf=V();
const playerObbWorldPosition=V(),playerObbWorldQuaternion=new THREE.Quaternion();
function setAxesFromQuaternion(q,axes){
  const x=q.x,y=q.y,z=q.z,w=q.w;
  axes[0].set(1-2*(y*y+z*z),2*(x*y+w*z),2*(x*z-w*y));
  axes[1].set(2*(x*y-w*z),1-2*(x*x+z*z),2*(y*z+w*x));
  axes[2].set(2*(x*z+w*y),2*(y*z-w*x),1-2*(x*x+y*y));
}
function setupOwnerObb(owner,ownerData,half,axes,outPosition){
  owner.updateMatrixWorld(true);
  outPosition.setFromMatrixPosition(owner.matrixWorld);
  playerObbWorldQuaternion.setFromRotationMatrix(owner.matrixWorld);
  half.copy(ownerData.size).multiplyScalar(0.5);
  setAxesFromQuaternion(playerObbWorldQuaternion,axes);
  return outPosition;
}
function pushPositionFromObb(pos,position,half,axes,radius){
  /* Most rubble is nowhere near the player. Reject it with a sphere test before
     expanding the OBB axes; the exact contact correction below is unchanged. */
  const broadRadius=half.length()+radius;
  const broadDx=pos.x-position.x,broadDz=pos.z-position.z;
  if(broadDx*broadDx+broadDz*broadDz>broadRadius*broadRadius)return false;
  const ey=Math.abs(axes[0].y)*half.x+Math.abs(axes[1].y)*half.y+Math.abs(axes[2].y)*half.z;
  if(pos.y+1.6<position.y-ey||pos.y+0.25>position.y+ey)return false;
  const axis0=axes[0],axis2=axes[2];
  const len0=Math.hypot(axis0.x,axis0.z),len2=Math.hypot(axis2.x,axis2.z);
  /* A nearly vertical piece has no useful 2D local frame. Keep the old AABB
     fallback for that rare orientation rather than making the player pass
     through a standing fragment. */
  if(len0<0.08||len2<0.08){
    const ex=Math.abs(axes[0].x)*half.x+Math.abs(axes[1].x)*half.y+Math.abs(axes[2].x)*half.z;
    const ez=Math.abs(axes[0].z)*half.x+Math.abs(axes[1].z)*half.y+Math.abs(axes[2].z)*half.z;
    const minx=position.x-ex-radius,maxx=position.x+ex+radius;
    const minz=position.z-ez-radius,maxz=position.z+ez+radius;
    if(pos.x<=minx||pos.x>=maxx||pos.z<=minz||pos.z>=maxz)return false;
    const d1=pos.x-minx,d2=maxx-pos.x,d3=pos.z-minz,d4=maxz-pos.z;
    const m=Math.min(d1,d2,d3,d4);
    if(m===d1)pos.x=minx;else if(m===d2)pos.x=maxx;
    else if(m===d3)pos.z=minz;else pos.z=maxz;
    return true;
  }
  const u0x=axis0.x/len0,u0z=axis0.z/len0;
  const u2x=axis2.x/len2,u2z=axis2.z/len2;
  const h0=half.x*len0+
    half.y*Math.abs(axes[1].x*u0x+axes[1].z*u0z)+
    half.z*Math.abs(axis2.x*u0x+axis2.z*u0z);
  const h2=half.x*Math.abs(axis0.x*u2x+axis0.z*u2z)+
    half.y*Math.abs(axes[1].x*u2x+axes[1].z*u2z)+half.z*len2;
  const dx=pos.x-position.x,dz=pos.z-position.z;
  const q0=dx*u0x+dz*u0z,q2=dx*u2x+dz*u2z;
  const push0=h0+radius-Math.abs(q0),push2=h2+radius-Math.abs(q2);
  if(push0<=0||push2<=0)return false;
  if(push0<push2){
    const sign=q0<0?-1:1;
    pos.x+=u0x*push0*sign;pos.z+=u0z*push0*sign;
  }else{
    const sign=q2<0?-1:1;
    pos.x+=u2x*push2*sign;pos.z+=u2z*push2*sign;
  }
  return true;
}
function pushPlayerFromObb(position,half,axes,radius){
  return pushPositionFromObb(player.pos,position,half,axes,radius);
}
const playerActiveChunkCandidates=[],playerActiveChunkSeen=new Set();
const playerSettledChunkCandidates=[],playerSettledChunkSeen=new Set();
const PLAYER_DEBRIS_QUERY_REACH=6.0;
function getPlayerActiveChunkCandidates(){
  playerActiveChunkCandidates.length=0;
  playerActiveChunkSeen.clear();
  if(!chunks.length)return playerActiveChunkCandidates;
  /* The physics solver rebuilds this XZ hash after every fixed pass. Reuse that
     exact broadphase for the player, with a conservative reach for the largest
     ordinary cell. If the first physics pass has not built it yet, fall back to
     the complete set once so startup never loses a collision. */
  if(activeChunkGridStamp<=0||activeChunkGridCount!==chunks.length){
    for(const c of chunks)playerActiveChunkCandidates.push(c);
    return playerActiveChunkCandidates;
  }
  const reach=PLAYER_DEBRIS_QUERY_REACH;
  const minX=Math.floor((player.pos.x-reach)/ACTIVE_CHUNK_GRID_CELL);
  const maxX=Math.floor((player.pos.x+reach)/ACTIVE_CHUNK_GRID_CELL);
  const minZ=Math.floor((player.pos.z-reach)/ACTIVE_CHUNK_GRID_CELL);
  const maxZ=Math.floor((player.pos.z+reach)/ACTIVE_CHUNK_GRID_CELL);
  const append=c=>{
    if(!c||playerActiveChunkSeen.has(c))return;
    const body=c.userData;
    if(!body||body.maxX<player.pos.x-0.34||body.minX>player.pos.x+0.34||
       body.maxZ<player.pos.z-0.34||body.minZ>player.pos.z+0.34)return;
    playerActiveChunkSeen.add(c);
    playerActiveChunkCandidates.push(c);
  };
  for(let gx=minX;gx<=maxX;gx++)for(let gz=minZ;gz<=maxZ;gz++){
    const bucket=activeChunkGrid.get(gx+'_'+gz);
    if(bucket)for(const c of bucket)append(c);
  }
  for(const c of activeChunkGridLarge)append(c);
  return playerActiveChunkCandidates;
}
function getPlayerSettledChunkCandidates(){
  playerSettledChunkCandidates.length=0;
  playerSettledChunkSeen.clear();
  if(!settledFragments.length)return playerSettledChunkCandidates;
  if(settledGridDirty)rebuildSettledGrid();
  const reach=SETTLED_GRID_SMALL_RADIUS+0.34;
  const minX=Math.floor((player.pos.x-reach)/SETTLED_GRID_CELL);
  const maxX=Math.floor((player.pos.x+reach)/SETTLED_GRID_CELL);
  const minZ=Math.floor((player.pos.z-reach)/SETTLED_GRID_CELL);
  const maxZ=Math.floor((player.pos.z+reach)/SETTLED_GRID_CELL);
  const append=c=>{
    if(c&&!playerSettledChunkSeen.has(c)){
      playerSettledChunkSeen.add(c);
      playerSettledChunkCandidates.push(c);
    }
  };
  for(let gx=minX;gx<=maxX;gx++)for(let gz=minZ;gz<=maxZ;gz++){
    const bucket=settledGrid.get(settledGridKey(gx,gz));
    if(bucket)for(const c of bucket)append(c);
  }
  for(const c of settledGridLarge)append(c);
  return playerSettledChunkCandidates;
}
function overlapsPlayerObb(pos,position,half,axes,radius){
  const ey=Math.abs(axes[0].y)*half.x+Math.abs(axes[1].y)*half.y+Math.abs(axes[2].y)*half.z;
  if(pos.y+1.62<=position.y-ey||pos.y+0.06>=position.y+ey)return false;
  const axis0=axes[0],axis2=axes[2];
  const len0=Math.hypot(axis0.x,axis0.z),len2=Math.hypot(axis2.x,axis2.z);
  if(len0<0.08||len2<0.08){
    const ex=Math.abs(axes[0].x)*half.x+Math.abs(axes[1].x)*half.y+Math.abs(axes[2].x)*half.z;
    const ez=Math.abs(axes[0].z)*half.x+Math.abs(axes[1].z)*half.y+Math.abs(axes[2].z)*half.z;
    return pos.x>position.x-ex-radius&&pos.x<position.x+ex+radius&&
      pos.z>position.z-ez-radius&&pos.z<position.z+ez+radius;
  }
  const u0x=axis0.x/len0,u0z=axis0.z/len0;
  const u2x=axis2.x/len2,u2z=axis2.z/len2;
  const h0=half.x*len0+
    half.y*Math.abs(axes[1].x*u0x+axes[1].z*u0z)+
    half.z*Math.abs(axis2.x*u0x+axis2.z*u0z);
  const h2=half.x*Math.abs(axis0.x*u2x+axis0.z*u2z)+
    half.y*Math.abs(axes[1].x*u2x+axes[1].z*u2z)+half.z*len2;
  const dx=pos.x-position.x,dz=pos.z-position.z;
  return h0+radius-Math.abs(dx*u0x+dz*u0z)>0&&
    h2+radius-Math.abs(dx*u2x+dz*u2z)>0;
}

function structuralColliderParent(node){
  const ud=node&&node.userData;
  return ud&&ud.parent&&ud.parent.cells?ud.parent:null;
}
function colliderMatchesSurface(owner,a,b){
  const surface=owner&&owner.userData&&owner.userData.surfaceRoot||owner;
  if(surface&&(surface===a||surface===b||owner===a||owner===b))return true;
  /* A climb hold usually comes from one hidden fracture cell, but the player's
     body occupies the wall corridor beside several neighboring cells and
     structural trims/roofs. Treat the same destructible as one traversal
     surface so those sibling colliders cannot shove the body through the wall
     while the path and hand anchors already keep it on the outside face. */
  const ownerParent=structuralColliderParent(owner);
  if(!ownerParent)return false;
  if(structuralColliderParent(a)===ownerParent||structuralColliderParent(b)===ownerParent)return true;
  /* Adjacent sections of one authored rock column share a climb frame even
     though each section owns a separate rigid body after fracture. */
  const family=ownerParent.climbFamilyKey;
  if(!family)return false;
  const aParent=structuralColliderParent(a),bParent=structuralColliderParent(b);
  return (aParent&&aParent.climbFamilyKey===family)||
    (bParent&&bParent.climbFamilyKey===family);
}
function resolveColliders(ignoreA,ignoreB){
  /* A mantle finishes on a surface that is still wrapped by the old wall
     collider. Keep that validated pair out of side-push resolution during the
     short recovery window, otherwise the first ground frame ejects the player
     from the very ledge the downward probe just found. Nearby rubble remains
     fully collidable. */
  if(player.mode==='ground'&&player.grace>0&&player.hold>=0){
    const recovery=HOLDS[player.hold];
    const recoveryWall=holdSurfaceRoot(recovery);
    const recoveryLanding=recovery&&recovery.vaultMesh&&
      (recovery.vaultMesh.userData&&recovery.vaultMesh.userData.surfaceRoot||recovery.vaultMesh);
    if(!ignoreA)ignoreA=recoveryWall;
    if(!ignoreB)ignoreB=recoveryLanding;
  }
  let landingProtection=false,collided=false;
  if(player.mode==='ground'&&player.onGround&&player.landingSurface){
    const dx=player.pos.x-player.landingAnchor.x,dz=player.pos.z-player.landingAnchor.z;
    const nearLanding=dx*dx+dz*dz<=player.landingRadius*player.landingRadius;
    const surfaceLive=surfaceObjectIsLive(player.landingSurface);
    if(nearLanding&&surfaceLive&&player.pos.y>=player.landingY-0.72){
      landingProtection=true;
      if(!ignoreA)ignoreA=player.landingSurface;
      if(!ignoreB)ignoreB=player.landingSurface;
    }else if(!nearLanding||!surfaceLive||player.pos.y<player.landingY-0.72){
      player.landingSurface=null;
    }
  }
  const r=0.32;
  /* A single push can leave the player inside a second overlapping rubble
     piece. Two cheap passes resolve the common stacked-fragment case without
     giving the character a heavyweight rigid-body solver. */
  for(let pass=0;pass<2;pass++){
    for(const b of getPlayerStaticBoxCandidates()){
      if(settledBoxSet.has(b))continue;
      const owner=b.owner,ownerData=owner&&owner.userData;
      if(landingProtection){
        /* Rock stacks and fractured roots can overlap the top face that the
           mantle probe approved. Their coarse boxes are useful for blocking a
           walking player, but would incorrectly shove a grounded mantle off
           the ledge as soon as grace expires. Protect only nearby static
           support volumes for this landing footprint; active debris still uses
           the exact OBB pass below. */
        const ownerPos=owner&&owner.position;
        const nearSupport=ownerPos&&
          (ownerPos.x-player.landingAnchor.x)**2+(ownerPos.z-player.landingAnchor.z)**2<=
            (player.landingRadius+0.9)**2;
        const aroundLanding=player.landingY+1.8>=b.min.y&&player.landingY-0.6<=b.max.y;
        if(nearSupport&&aroundLanding)continue;
      }
      if(colliderMatchesSurface(owner,ignoreA,ignoreB))continue;
      if(player.pos.y+1.6<b.min.y||player.pos.y+0.25>b.max.y)continue;
      if(ownerData&&(ownerData.kind==='cell'||ownerData.kind==='roof'||
        ownerData.kind==='trim'||ownerData.kind==='groupShell'||
        ownerData.kind==='groupChunk')&&ownerData.size){
        const ownerPosition=setupOwnerObb(owner,ownerData,playerObbHalf,
          playerObbAxes,playerObbWorldPosition);
        if(pushPlayerFromObb(ownerPosition,playerObbHalf,playerObbAxes,r))collided=true;
        continue;
      }
      const minx=b.min.x-r,maxx=b.max.x+r,minz=b.min.z-r,maxz=b.max.z+r;
      if(player.pos.x>minx&&player.pos.x<maxx&&player.pos.z>minz&&player.pos.z<maxz){
        const d1=player.pos.x-minx,d2=maxx-player.pos.x,d3=player.pos.z-minz,d4=maxz-player.pos.z;
        const m=Math.min(d1,d2,d3,d4);
        if(m===d1)player.pos.x=minx;else if(m===d2)player.pos.x=maxx;
        else if(m===d3)player.pos.z=minz;else player.pos.z=maxz;
        collided=true;
      }
    }
    /* Active fracture pieces already have an OBB. Use that same contact frame
       for the player so a rotated fragment cannot become an invisible
       axis-aligned blocker during traversal. */
    for(const c of getPlayerActiveChunkCandidates()){
      const b=c.userData;
      if(!b||!b.half||!b.axes)continue;
      if(pushPlayerFromObb(b.position,b.half,b.axes,r))collided=true;
    }
    /* Capped/static rubble keeps its exact orientation and shares the same
       cheap OBB-expanded-cylinder test as active pieces. */
    for(const c of getPlayerSettledChunkCandidates()){
      const b=c.userData;
      if(!b||!b.half||!b.axes)continue;
      if(pushPlayerFromObb(b.position,b.half,b.axes,r))collided=true;
    }
    if(voxelPhysics.pushPlayer(player.pos,r))collided=true;
  }
  if(player.grace>0)return collided;
  for(const c of cyls){
    if(c.mesh===ignoreA||c.mesh===ignoreB||colliderMatchesSurface(c.mesh,ignoreA,ignoreB))continue;
    if(landingProtection&&
       (c.x-player.landingAnchor.x)**2+(c.z-player.landingAnchor.z)**2<=
         (player.landingRadius+0.9)**2&&player.landingY<=c.top+0.8)continue;
    if(player.pos.y>c.top)continue;
    const dx=player.pos.x-c.x,dz=player.pos.z-c.z;
    const d=Math.hypot(dx,dz),rr=c.r+r;
    if(d<rr&&d>0.001){player.pos.x=c.x+dx/d*rr;player.pos.z=c.z+dz/d*rr;collided=true;}
  }
  return collided;
}

let cameraFadeMesh=null;
const cameraFadeMeshes=[],cameraFadeStates=[],cameraFadeHits=[];
const cameraFadeCache=new WeakMap(),cameraFadeCacheEntries=[];
let cameraFadeCacheStamp=0;
const CAMERA_FADE_CACHE_MAX=48;
function isCameraFadeable(mesh){
  const ud=mesh&&mesh.userData;
  return !!(ud&&(ud.kind==='cell'||ud.kind==='cellShell'||ud.cameraFade||ud.staticFragment||ud.sleeping));
}
function isVaultCameraSurface(mesh){
  const traversing=player.mode==='attach'||player.mode==='move'||player.mode==='hang'||player.mode==='vault';
  /* Keep the wall/landing out of the chase-camera collision for the brief
     post-mantle recovery. The player has just crossed that plane; letting the
     camera collide with it on the first ground frame causes a hard snap into
     the character's back. */
  const exitingVault=player.mode==='ground'&&player.grace>0&&player.hold>=0;
  if(!traversing&&!exitingVault)return false;
  const h=HOLDS[player.hold]||HOLDS[player.moveTo];
  const wall=holdSurfaceRoot(h);
  if(mesh===wall)return true;
  if(player.mode!=='vault'&&!exitingVault)return false;
  const landing=h&&h.vaultMesh;
  const landingRoot=landing&&landing.userData&&landing.userData.surfaceRoot;
  return !!mesh&&(mesh===landing||mesh===landingRoot);
}
function updateCameraFade(meshes){
  const next=meshes||[];
  let unchanged=next.length===cameraFadeMeshes.length;
  if(unchanged)for(let i=0;i<next.length;i++)if(next[i]!==cameraFadeMeshes[i]){unchanged=false;break;}
  if(unchanged)return;
  for(const state of cameraFadeStates){
    state.mesh.material=state.material;
    state.material.needsUpdate=true;
  }
  cameraFadeStates.length=0;cameraFadeMeshes.length=0;cameraFadeMesh=null;
  for(const mesh of next){
    if(!mesh||!mesh.material||Array.isArray(mesh.material)||cameraFadeMeshes.indexOf(mesh)>=0)continue;
    const material=mesh.material;
    let state=cameraFadeCache.get(mesh);
    if(!state||state.material!==material||!state.fadeMaterial){
      if(state){
        const oldIndex=cameraFadeCacheEntries.indexOf(state);
        if(oldIndex>=0)cameraFadeCacheEntries.splice(oldIndex,1);
        if(state.fadeMaterial)state.fadeMaterial.dispose();
      }
      const fadeMaterial=material.clone();
      state={mesh,material,fadeMaterial,lastUsed:++cameraFadeCacheStamp};
      cameraFadeCache.set(mesh,state);
      cameraFadeCacheEntries.push(state);
    }else state.lastUsed=++cameraFadeCacheStamp;
    cameraFadeStates.push(state);cameraFadeMeshes.push(mesh);
    mesh.material=state.fadeMaterial;
    state.fadeMaterial.transparent=true;
    /* Several overlapping rubble pieces can sit between the camera and the
       player. A shallow alpha on each piece is clearer than one opaque slab. */
    state.fadeMaterial.opacity=Math.min(material.opacity,0.1);
    state.fadeMaterial.depthWrite=false;
    state.fadeMaterial.needsUpdate=true;
  }
  /* Keep the cache bounded. Only inactive entries are eligible, so a material
     currently assigned to a fading mesh is never disposed mid-frame. */
  while(cameraFadeCacheEntries.length>CAMERA_FADE_CACHE_MAX){
    let victim=-1,victimStamp=Infinity;
    for(let i=0;i<cameraFadeCacheEntries.length;i++){
      const state=cameraFadeCacheEntries[i];
      if(cameraFadeStates.indexOf(state)>=0)continue;
      if(state.lastUsed<victimStamp){victimStamp=state.lastUsed;victim=i;}
    }
    if(victim<0)break;
    const state=cameraFadeCacheEntries[victim];
    cameraFadeCache.delete(state.mesh);
    if(state.fadeMaterial)state.fadeMaterial.dispose();
    cameraFadeCacheEntries.splice(victim,1);
  }
  cameraFadeMesh=cameraFadeMeshes[0]||null;
}

function resolveCameraPosition(pos,ignore){
  const r=0.18;
  /* Ray shortening handles normal wall occlusion; this pass keeps the desired
     camera point outside hard world geometry. Fracture pieces are faded along
     the view ray instead of shoving the camera through a moving pile. */
  for(let pass=0;pass<2;pass++){
    let pushed=false;
    for(const box of getCameraStaticBoxCandidates(pos)){
      if(box.active===false)continue;
      if(settledBoxSet.has(box))continue;
      if(isVaultCameraSurface(box.owner))continue;
      if(box.owner&&isCameraFadeable(box.owner))continue;
      if(ignore&&ignore.userData&&box===ignore.userData.fractureBox)continue;
      const minx=box.min.x-r,maxx=box.max.x+r,miny=box.min.y-r,maxy=box.max.y+r,minz=box.min.z-r,maxz=box.max.z+r;
      if(pos.x<=minx||pos.x>=maxx||pos.y<=miny||pos.y>=maxy||pos.z<=minz||pos.z>=maxz)continue;
      const dx1=pos.x-minx,dx2=maxx-pos.x,dy1=pos.y-miny,dy2=maxy-pos.y,dz1=pos.z-minz,dz2=maxz-pos.z;
      const m=Math.min(dx1,dx2,dy1,dy2,dz1,dz2);
      if(m===dx1)pos.x=minx;else if(m===dx2)pos.x=maxx;
      else if(m===dy1)pos.y=miny;else if(m===dy2)pos.y=maxy;
      else if(m===dz1)pos.z=minz;else pos.z=maxz;
      pushed=true;
    }
    if(!pushed)break;
  }
}

function nearestHold(p,chestY,maxD,mesh){
  let best=-1,bd=maxD;
  for(let i=0;i<HOLDS.length;i++){
    if(mesh&&HOLDS[i].mesh!==mesh)continue;
    if(!holdSurfaceIsLive(HOLDS[i]))continue;
    const d=HOLDS[i].pos.distanceTo(p)+Math.abs(HOLDS[i].pos.y-chestY)*0.4;
    if(d<bd){bd=d;best=i;}
  }
  return best;
}

function nearestReachableHold(p,chestY,maxD,mesh){
  let best=-1,bd=maxD;
  for(let i=0;i<HOLDS.length;i++){
    if(mesh&&HOLDS[i].mesh!==mesh)continue;
    if(!holdSurfaceIsLive(HOLDS[i]))continue;
    const d=HOLDS[i].pos.distanceTo(p)+Math.abs(HOLDS[i].pos.y-chestY)*0.4;
    if(d>=bd)continue;
    /* Select against the actual hang root and two-bone arm length, not just
       the graph point distance. A dense pole/facade can contain a closer
       sample that is too high or too far around the edge; skipping that one
       lets the next valid handhold win instead of reporting a false failure. */
    hangPos(i,climbPathToPos);
    if(!climbPoseReachable(i,climbPathToPos))continue;
    bd=d;best=i;
  }
  return best;
}

function tryGrab(dir,air){
  if(player.cool>0||player.grace>0)return;
  climbGrabOrigin.set(player.pos.x,player.pos.y+1.25,player.pos.z);
  climbGrabSide.crossVectors(UP,dir);
  if(climbGrabSide.lengthSq()<0.001)climbGrabSide.set(1,0,0);
  else climbGrabSide.normalize();
  let polished=false;
  let gripHit=false,linkedHold=false,reachRejected=false;
  let blocked=false,bestHold=-1,bestDistance=Infinity;
  /* A small lateral fan makes grabbing tolerant of a shoulder-width approach
     while still using the same exact proxy surface and clearance tests. The
     old single center ray often hit a corner or missed a ledge by a few
     centimeters, then left the player in an awkward half-attached pose. */
  for(let fan=0;fan<3;fan++){
    const offset=fan===0?-0.22:(fan===1?0:0.22);
    climbGrabOrigin.set(player.pos.x,player.pos.y+1.25,player.pos.z)
      .addScaledVector(climbGrabSide,offset);
    climbGrabRay.copy(dir).addScaledVector(climbGrabSide,offset*0.12).normalize();
    rc.set(climbGrabOrigin,climbGrabRay);rc.far=air?2.1:1.6;rc.near=0.01;
    const hits=rc.intersectObjects(allProxyMeshes,false);
    for(const hit of hits){
      const pr=proxyByMesh.get(hit.object);
      if(!pr)continue;
      if(!pr.grip){polished=true;continue;}
      gripHit=true;
      const i=nearestReachableHold(hit.point,climbGrabOrigin.y,3.0,hit.object);
      if(i<0)continue;
      linkedHold=true;
      /* Do not enter a hang when the ground or a nearby platform leaves less
         than one arm-span between the candidate root and the grip. The old
         grab accepted those low side samples, then the collision solver kept
         the hips on the floor while both arms tried to reach through the
         chest. */
      hangPos(i,climbPathToPos);
      if(!climbPoseReachable(i,climbPathToPos)){
        reachRejected=true;
        continue;
      }
      if(!climbAttachClearance(HOLDS[i],player.pos,climbPathToPos)){
        blocked=true;
        continue;
      }
      if(hit.distance<bestDistance){bestDistance=hit.distance;bestHold=i;}
      break;
    }
  }
  if(bestHold<0){
    /* The fan ray is the precise path, but a faceted proxy can still leave a
       one-frame gap between the player's approach vector and the nearest hand
       node. Offer a small proximity assist only when the candidate is in front
       of the player, the wall normal faces the approach, and a second ray can
       confirm a nearby grip. Reach and swept clearance below remain the final
       authority, so this cannot pull the body through a corner. */
    const candidateReach=air?2.85:2.55;
    let fallbackScore=Infinity;
    for(let i=0;i<HOLDS.length;i++){
      const h=HOLDS[i];
      if(!holdSurfaceIsLive(h))continue;
      climbGrabCandidate.subVectors(h.pos,climbGrabOrigin);
      const vertical=climbGrabCandidate.y;
      const flat=Math.hypot(climbGrabCandidate.x,climbGrabCandidate.z);
      const distance=Math.hypot(flat,vertical);
      if(distance>candidateReach||flat<0.18||vertical<-1.65||vertical>1.8)continue;
      climbGrabCandidateDir.set(climbGrabCandidate.x,0,climbGrabCandidate.z).normalize();
      const facing=dir.dot(climbGrabCandidateDir);
      if(facing<0.22)continue;
      hangPos(i,climbPathToPos);
      if(!climbPoseReachable(i,climbPathToPos)){
        reachRejected=true;
        continue;
      }
      rc.set(climbGrabOrigin,climbGrabCandidateDir);
      rc.far=Math.min(2.8,flat+0.42);rc.near=0.01;
      const sight=rc.intersectObjects(allProxyMeshes,false);
      let visibleGrip=false;
      for(const hit of sight){
        const pr=proxyByMesh.get(hit.object);
        if(pr&&pr.grip)visibleGrip=true;
        if(visibleGrip)break;
      }
      /* A hand node is already authored on the climb surface. If the proxy ray
         misses its tiny triangle at a grazing angle, the swept attach test is a
         better obstruction check than rejecting the nearby grip outright. */
      const score=distance+(1-facing)*0.8+Math.abs(vertical)*0.16+
        (visibleGrip?0:0.18);
      if(score<fallbackScore){fallbackScore=score;bestHold=i;bestDistance=distance;}
    }
    if(bestHold>=0){
      hangPos(bestHold,climbPathToPos);
      if(!climbPoseReachable(bestHold,climbPathToPos)){
        reachRejected=true;bestHold=-1;
      }else if(!climbAttachClearance(HOLDS[bestHold],player.pos,climbPathToPos)){
        blocked=true;bestHold=-1;
      }
    }
  }
  if(bestHold>=0){
    hangPos(bestHold,climbPathToPos);
    player.landingSurface=null;
    player.onGround=false;
    player.mode='attach';player.moveTo=bestHold;
    player.attachFrom.copy(player.pos);player.attachT=0;
    climbPhase=0;climbStepParity=0;
    player.vel.set(0,0,0);
    return;
  }
  if(blocked)flashHint('CLIMB BLOCKED — clear the approach',true);
  else if(polished)flashHint('NO GRIP — polished surface',true);
  else if(reachRejected)flashHint('HANDHOLD OUT OF REACH',true);
  else if(gripHit&&!linkedHold)flashHint('NO HANDHOLD — move along the surface',true);
}

function hangPos(i,out){
  const h=HOLDS[i];
  out=out||V();
  if(!h){
    out.copy(player.pos);
    return out;
  }
  holdSurfaceAnchor(h,climbSurfacePoint,climbSurfaceNormal);
  /* Place the body below the grip. The player root is near the feet and the
     shoulder is about 1.66 units above it; keeping the chest roughly 0.45
     below the hands gives the elbows a loaded bend instead of the old arms-
     level-with-the-hold mannequin pose. The outward gap keeps the backpack and
     hips clear of thin ledges while the hands remain close to the surface. */
  out.copy(climbSurfacePoint).addScaledVector(UP,-2.05).addScaledVector(climbSurfaceNormal,CLIMB_ROOT_OFFSET);
  let gh=0;
  /* A vertical climb can pass over the crown of a rock or a ledge. The old
     unconditional ground clamp treated that surface as a floor and lifted
     the root several metres above its hand target, forcing the IK chain to
     collapse both arms toward the chest. Only clamp to a support that is
     actually below the hold; higher geometry belongs to the wall clearance
     solve, not the player's hanging root. */
  /* Only use a floor that is materially below the sampled hand surface. A
     concave rock can expose a higher shelf directly behind a handhold; using
     that shelf as the hang root lifts the pelvis into the ledge and makes the
     arm chain fail its reach test even though the hold itself is valid. */
  /* Apply the body-clear pass again after a support lift. This makes the pose
     used to start a transfer identical to the pose reached at its end. */
  for(let pass=0;pass<2;pass++){
    keepClimbBodyClear(out,h);
    gh=groundBelow(out.x,out.z,h.pos.y,climbSurfacePoint.y-0.38);
    if(out.y<gh){out.y=gh;if(pass===0)continue;}
    break;
  }
  return out;
}

/* A traversal root must leave enough vertical clearance for the shoulders to
   reach the palms without stretching through the two-bone arm chain. This is
   deliberately a cheap start-of-action test; the live wall/body clearance
   sweep remains authoritative once the climb is in motion. */
function climbPoseReachable(i,root,handSpread){
  const h=HOLDS[i];
  if(!h||!root)return false;
  handSpread=handSpread===undefined?CLIMB_HAND_SPREAD:handSpread;
  holdSurfaceAnchor(h,climbSurfacePoint,climbSurfaceNormal);
  /* A mantle often starts with the chest already close to the lip. The old
     0.62-unit vertical gate rejected valid ledges before the real 3D shoulder-
     to-palm reach and swept clearance checks could run, leaving the player
     frozen in a hang. Keep a small minimum shoulder clearance, but let the
     actual two-bone distance decide whether the arm can reach. */
  if(climbSurfacePoint.y-root.y<0.46)return false;
  climbPoseSide.crossVectors(UP,climbSurfaceNormal);
  if(climbPoseSide.lengthSq()<0.04)climbPoseSide.set(1,0,0);
  else climbPoseSide.normalize();
  climbPoseShoulder.copy(root).addScaledVector(UP,1.51)
    .addScaledVector(climbSurfaceNormal,CLIMB_SHOULDER_OFFSET);
  for(const side of[-handSpread,handSpread]){
    climbPoseHand.copy(climbSurfacePoint).addScaledVector(UP,0.05)
      .addScaledVector(climbSurfaceNormal,CLIMB_HAND_OFFSET)
      .addScaledVector(climbPoseSide,side);
    if(climbPoseShoulder.distanceTo(climbPoseHand)>CLIMB_ARM_REACH)return false;
  }
  return true;
}

function startMove(j){
  if(j<0||j>=HOLDS.length)return false;
  if(!holdSurfaceIsLive(HOLDS[j]))return false;
  if(player.mode==='hang'&&player.hold<0)return false;
  if(player.mode==='hang'&&player.hold>=0){
    climbPathFromPos.copy(player.pos);
    hangPos(j,climbPathToPos);
    if(!climbPoseReachable(j,climbPathToPos,CLIMB_TRANSFER_HAND_SPREAD))return false;
    if(!climbPathClearance(HOLDS[player.hold],HOLDS[j],climbPathFromPos,climbPathToPos)){
      flashHint('CLIMB BLOCKED — clear the route',true);
      return false;
    }
  }
  player.mode='move';player.moveFrom=player.hold;player.moveTo=j;player.attachT=0;
  player.onGround=false;
  player.landingSurface=null;
  climbPhase=0;climbStepParity^=1;
  return true;
}

const climbPathFromPos=V(),climbPathToPos=V(),climbPathNormal=V(),climbPathSample=V();
const climbPathSurfaceFrom=V(),climbPathSurfaceTo=V(),climbPathSurface=V();
const vaultPathNormal=V(),vaultPathSample=V(),vaultTargetProbe=V(),vaultTargetRay=V();
const vaultDesiredPos=V(),vaultMotionFrom=V(),vaultMotionDelta=V();
const vaultExitVelocity=V();
const climbDesiredPos=V(),climbMotionFrom=V(),climbMotionDelta=V();
const climbGrabOrigin=V(),climbGrabSide=V(),climbGrabRay=V(),climbGrabCandidate=V(),climbGrabCandidateDir=V();
function holdSurfaceRoot(h){
  const mesh=h&&h.mesh;
  return mesh&&mesh.userData&&mesh.userData.surfaceRoot||mesh||null;
}
function holdSurfaceIsLive(h){
  const root=holdSurfaceRoot(h);
  const ud=root&&root.userData;
  const raycastOnly=!!(ud&&ud.raycastOnly);
  const parent=ud&&ud.parent;
  if(parent&&parent.voxelManaged&&
     !voxelPhysics.surfaceAlive(parent.voxelStructure,h.pos,0.92))return false;
  return !!(root&&root.parent&&(root.visible!==false||raycastOnly)&&root.geometry&&
    !(ud&&ud.surfaceDetached)&&!(ud&&ud.kind==='cell'&&ud.climbProxy===false));
}
function surfaceObjectIsLive(mesh){
  const root=mesh&&mesh.userData&&mesh.userData.surfaceRoot||mesh;
  const ud=root&&root.userData;
  const raycastOnly=!!(ud&&ud.raycastOnly);
  const parent=ud&&ud.parent;
  if(parent&&parent.voxelManaged&&
     (!parent.voxelStructure||!parent.voxelStructure.activeN))return false;
  return !!(root&&root.parent&&(root.visible!==false||raycastOnly)&&root.geometry&&
    !(ud&&ud.surfaceDetached)&&
    !(ud&&ud.kind==='cell'&&ud.climbProxy===false&&!ud.staticFragment));
}
const climbSurfacePoint=V(),climbSurfacePointB=V(),climbSurfaceNormal=V(),climbSurfaceOrigin=V(),climbSurfaceRay=V();
const climbNormalFrom=V(),climbNormalTo=V();
const climbPoseShoulder=V(),climbPoseHand=V(),climbPoseSide=V();
  /* Hands and soles sit just outside the sampled surface. The previous 0.30-unit
     gap kept the body safe but made palms and boots visibly float away from a wall. */
const CLIMB_ROOT_OFFSET=0.5,CLIMB_BODY_OFFSET=0.11,CLIMB_HAND_OFFSET=0.19,CLIMB_FOOT_OFFSET=0.18;
/* A supported hang needs a little shoulder-width separation. Keeping both
   palms almost on top of the same graph sample made the far arm disappear
   behind a faceted rock even though the IK chain was valid. */
const CLIMB_HAND_SPREAD=0.27,CLIMB_TRANSFER_HAND_SPREAD=0.18;
/* Keep traversal targets just inside the authored upper+forearm chain. The
   IK solver still has a tiny safety margin, but it must never hide a stretch
   by silently clamping a hand that the body cannot physically reach. */
const CLIMB_ARM_REACH=0.72;
/* The climbing shoulder is shifted toward the wall by the same local shoulder
   reach used in updateGuy. Measuring it as another outward body offset made
   valid rock holds look unreachable even though the rendered joint was close
   enough to the palm. */
const CLIMB_SHOULDER_OFFSET=-0.02;
const climbBodyProbe=V(),climbBodyRay=V(),climbBodyNormal=V(),climbBodyDirection=V(),
  climbBodySide=V(),climbBodyActual=V(),climbBodyCorrection=V(),climbBodyWorst=V(),climbBodyTargets=[];
const climbBodySampleOffsets=[0.55,1.15,1.7];
function climbBodySurfaceMeshes(h){
  const root=holdSurfaceRoot(h);
  climbBodyTargets.length=0;
  const dObj=structuralColliderParent(root);
  /* A normal box asset uses its cooked cell field from startup. An irregular
     surface keeps its authored mesh authoritative until the first fracture;
     sampling hidden rock cells before that handoff would put the body against a
     coarse box that the player cannot actually see. */
  if(dObj&&(!dObj.surfaceShell||dObj.fieldRevealed)){
    for(const cell of dObj.cells){
      if(cell&&cell.parent&&cell.geometry&&
         (cell.visible||cell.userData.raycastOnly))climbBodyTargets.push(cell);
    }
  }
  if(root&&climbBodyTargets.indexOf(root)<0)climbBodyTargets.push(root);
  return climbBodyTargets;
}
function keepClimbBodyClear(pos,h){
  const root=holdSurfaceRoot(h);
  if(!root||!root.parent||!root.geometry)return pos;
  const targets=climbBodySurfaceMeshes(h);
  holdSurfaceAnchor(h,climbSurfacePoint,climbSurfaceNormal);
  climbBodyNormal.copy(climbSurfaceNormal).setY(0);
  if(climbBodyNormal.lengthSq()<0.04)return pos;
  climbBodyNormal.normalize();
  climbBodySide.crossVectors(UP,climbBodyNormal);
  if(climbBodySide.lengthSq()<0.04)climbBodySide.set(1,0,0);
  else climbBodySide.normalize();
  climbBodyCorrection.set(0,0,0);
  climbBodyWorst.set(0,0,0);
  let correctionSamples=0;
  let worstPenetration=0;
  for(const offset of climbBodySampleOffsets){
    /* Sweep the torso ring through the wall normal and both shoulder sides.
       The old center ray protected a flat wall but could miss the neighboring
       face at a corner, leaving a shoulder or backpack visibly embedded. */
    for(let sweep=-1;sweep<=1;sweep++){
      climbBodyDirection.copy(climbBodyNormal)
        .addScaledVector(climbBodySide,sweep*0.5).normalize();
      climbBodyProbe.set(pos.x,pos.y+offset,pos.z)
        .addScaledVector(climbBodyDirection,1.45);
      climbBodyRay.copy(climbBodyDirection).negate();
      rc.set(climbBodyProbe,climbBodyRay);rc.far=1.7;rc.near=0.001;
      const hits=rc.intersectObjects(targets,false);
      for(const hit of hits){
        /* Keep the probe horizontal so it still samples the wall corridor, but
           retain the hit normal's vertical component for the response. Dropping
           Y here made an overhang or sloped face push only sideways, leaving the
           chest/backpack intersecting the underside. */
        climbBodyActual.copy(wn(hit,hit.object,worldNormalScratch));
        if(climbBodyActual.lengthSq()<0.04||climbBodyActual.dot(climbBodyDirection)<0.15)continue;
        /* `hit.distance` is measured from the outward probe back to the wall.
           Subtracting the probe offset gives the signed gap from the root to
           that wall: positive outside, negative when the torso has crossed
           into it. The old order inverted this test and could push a clipped
           body farther through a concave face. */
        const bodyToSurface=hit.distance-1.45;
        if(bodyToSurface<0.48){
          const penetration=0.48-bodyToSurface;
          climbBodyCorrection.addScaledVector(climbBodyActual,penetration);
          if(penetration>worstPenetration){
            worstPenetration=penetration;
            climbBodyWorst.copy(climbBodyActual).multiplyScalar(penetration);
          }
          correctionSamples++;
        }
        break;
      }
    }
  }
  if(correctionSamples){
    climbBodyCorrection.multiplyScalar(1/correctionSamples);
    const correction=climbBodyCorrection.length();
    /* Averaging is smooth on a flat wall, but it can cancel at a concave
       corner where the chest is penetrating one face more than the other.
       Blend toward the worst measured face only when the average is clearly
       under-correcting; this preserves gentle corner motion without allowing
       the backpack or shoulder to remain inside geometry. */
    const worstLength=climbBodyWorst.length();
    if(worstLength>0&&correction<worstLength*0.72){
      climbBodyCorrection.lerp(climbBodyWorst,0.65);
    }
    const correctedLength=climbBodyCorrection.length();
    if(correctedLength>0.001)
       pos.addScaledVector(climbBodyCorrection,Math.min(0.34,correctedLength+0.025)/correctedLength);
  }
  /* The surface sweep protects irregular meshes, but authored fracture cells
     have an exact rigid OBB. Resolve that expanded capsule too, so a shoulder
     cannot remain inside a wall corner between two ray samples. Run two cheap
     passes because the first face can expose a neighboring cell. */
  for(let pass=0;pass<2;pass++)for(const mesh of targets){
    const ud=mesh&&mesh.userData;
    if(!ud||ud.kind!=='cell'||!ud.size||!mesh.quaternion)continue;
    playerObbHalf.copy(ud.size).multiplyScalar(0.5);
    setAxesFromQuaternion(mesh.quaternion,playerObbAxes);
    pushPositionFromObb(pos,mesh.position,playerObbHalf,playerObbAxes,0.32);
  }
  return pos;
}
function holdSurfaceAnchor(h,point,normal){
  if(!h){
    point.set(0,0,0);
    normal.set(0,0,1);
    return;
  }
  const root=holdSurfaceRoot(h);
  const rootData=root&&root.userData;
  const raycastOnly=!!(rootData&&rootData.raycastOnly);
  /* Static authored surfaces are safe to cache. Released fracture cells are
     live rigid bodies, so refresh their frame only after the physics transform
     changes; this keeps hand/foot targets and clearance rays on the same
     moving piece without adding a raycast to every static hold. */
  const movingCell=!!(rootData&&rootData.kind==='cell'&&rootData.released&&!rootData.sleeping);
  if(movingCell){
    root.updateMatrixWorld(true);
    /* Holds are authored in world space during graph cooking. Once their cell
       becomes a rigid body, preserve the hold's local attachment and rebuild
       its world position from the body's current transform; otherwise the
       hand target stays at the old wall location while the slab falls away. */
    if(!h.surfaceLocalReady){
      h.surfaceLocalPos.copy(h.pos);
      root.worldToLocal(h.surfaceLocalPos);
      h.surfaceLocalReady=true;
    }
    h.pos.copy(h.surfaceLocalPos).applyMatrix4(root.matrixWorld);
    const q=root.quaternion,p=h.surfaceTransformQuat;
    if(!h.surfaceTransformReady||
       h.surfaceTransformPos.distanceToSquared(root.position)>1e-8||
       Math.abs(p.dot(q))<0.999999){
      h.surfaceReady=false;
      h.surfaceTransformPos.copy(root.position);
      p.copy(q);
      h.surfaceTransformReady=true;
    }
  }
  if(h.surfaceReady&&holdSurfaceIsLive(h)){
    point.copy(h.surfacePos);
    normal.copy(h.surfaceOut);
    return;
  }
  h.surfaceReady=false;
  point.copy(h.pos);
  normal.copy(h.out).setY(0).normalize();
  if(!root||!root.parent||(root.visible===false&&!raycastOnly)||!root.geometry){
    h.surfacePos.copy(point);h.surfaceOut.copy(normal);h.surfaceReady=false;
    return;
  }
  /* Re-project the proxy hold onto the real render mesh. Rocks deliberately
     use a cheaper climb proxy, so this small inward ray prevents the chest,
     palms, and boots from being placed inside a high-resolution overhang. */
  climbSurfaceOrigin.copy(h.pos).addScaledVector(normal,1.25);
  climbSurfaceRay.copy(normal).negate();
  rc.set(climbSurfaceOrigin,climbSurfaceRay);rc.far=2.6;rc.near=0.001;
  const hits=rc.intersectObject(root,false);
  for(const hit of hits){
    const actual=wn(hit,root,worldNormalScratch);actual.y=0;
    if(actual.lengthSq()<0.04||actual.dot(normal)<0.05)continue;
    point.copy(hit.point);
    normal.copy(actual).normalize();
    h.surfacePos.copy(point);h.surfaceOut.copy(normal);h.surfaceReady=true;
    if(!h.surfaceTransformReady){
      h.surfaceTransformPos.copy(root.position);
      h.surfaceTransformQuat.copy(root.quaternion);
      h.surfaceTransformReady=true;
    }
    return;
  }
  h.surfacePos.copy(point);h.surfaceOut.copy(normal);h.surfaceReady=true;
  if(!h.surfaceTransformReady){
    h.surfaceTransformPos.copy(root.position);
    h.surfaceTransformQuat.copy(root.quaternion);
    h.surfaceTransformReady=true;
  }
}

function releaseTraversal(h){
  /* Keep the last real surface frame when a wall disappears or a corner
     invalidates the hold. The sampled normal is more reliable than the coarse
     proxy normal for the release impulse and prevents ejecting into geometry. */
  const out=h&&h.surfaceOut&&h.surfaceOut.lengthSq()>0.001?h.surfaceOut:
    (h&&h.out&&h.out.lengthSq()>0.001?h.out:null);
  player.mode='ground';
  player.hold=-1;
  player.moveFrom=-1;
  player.moveTo=-1;
  player.attachT=0;
  player.vel.set(0,0,0);
  if(out){
    player.vel.copy(out).setY(0).normalize().multiplyScalar(1.25);
    player.vel.y=1.2;
    player.pos.addScaledVector(player.vel,0.04);
  }else player.vel.y=1.2;
  player.cool=0.35;
  player.grace=0.7;
  player.landingSurface=null;
  player.onGround=false;
  climbPhase=0;
}
function vaultSurfaceBox(box,h){
  const root=holdSurfaceRoot(h),landing=h&&h.vaultMesh;
  const landingRoot=landing&&landing.userData&&landing.userData.surfaceRoot;
  const owner=box&&box.owner;
  if(!owner)return false;
  /* A fractured wall is represented by several sibling cell colliders. The
     mantle intentionally crosses that wall plane, so ignoring only the exact
     hit cell leaves its neighboring cells as false blockers and makes valid
     corner vaults fail. Treat the wall and landing's structural parent as one
     validated traversal surface; unrelated buildings, props, and rubble stay
     in the clearance test. */
  return owner===root||owner===landing||owner===landingRoot||
    colliderMatchesSurface(owner,root,landingRoot);
}
function playerOverlapsBox(pos,box){
  const owner=box.owner,ownerData=owner&&owner.userData;
  if(ownerData&&(ownerData.kind==='cell'||ownerData.kind==='roof'||
    ownerData.kind==='trim'||ownerData.kind==='groupShell'||
    ownerData.kind==='groupChunk')&&ownerData.size){
    const ownerPosition=setupOwnerObb(owner,ownerData,playerObbHalf,
      playerObbAxes,playerObbWorldPosition);
    return overlapsPlayerObb(pos,ownerPosition,playerObbHalf,playerObbAxes,0.31);
  }
  const r=0.31;
  if(pos.y+1.62<=box.min.y||pos.y+0.06>=box.max.y)return false;
  return pos.x>box.min.x-r&&pos.x<box.max.x+r&&pos.z>box.min.z-r&&pos.z<box.max.z+r;
}
function playerOverlapsChunk(pos,body){
  if(!body||!body.half||!body.axes)return false;
  return overlapsPlayerObb(pos,body.position,body.half,body.axes,0.31);
}
function playerOverlapsCylinder(pos,cyl){
  if(!cyl||pos.y>cyl.top)return false;
  const dx=pos.x-cyl.x,dz=pos.z-cyl.z;
  const radius=cyl.r+0.31;
  return dx*dx+dz*dz<radius*radius;
}
function climbPathClearance(fromHold,toHold,from,to){
  holdSurfaceAnchor(fromHold,climbPathSurfaceFrom,climbNormalFrom);
  holdSurfaceAnchor(toHold,climbPathSurfaceTo,climbNormalTo);
  climbPathNormal.copy(climbNormalFrom).lerp(climbNormalTo,0.5).setY(0);
  if(climbPathNormal.lengthSq()<1e-4){
    climbPathNormal.copy(climbNormalFrom).setY(0);
    if(climbPathNormal.lengthSq()<1e-4)climbPathNormal.set(0,0,1);
  }
  climbPathNormal.normalize();
  const fromRoot=holdSurfaceRoot(fromHold),toRoot=holdSurfaceRoot(toHold);
  for(let i=1;i<=10;i++){
    const t=i/10,s=smooth5(t);
    climbPathSample.lerpVectors(from,to,s);
    /* Follow the turning wall frame instead of using one averaged normal for
       the whole transfer. On a faceted corner the averaged direction can point
       into the rock even when both endpoint holds have a clear body corridor. */
    climbPathNormal.lerpVectors(climbNormalFrom,climbNormalTo,s).setY(0);
    if(climbPathNormal.lengthSq()<1e-4)climbPathNormal.copy(climbNormalFrom).setY(0);
    if(climbPathNormal.lengthSq()<1e-4)climbPathNormal.set(0,0,1);
    else climbPathNormal.normalize();
    /* Give the chest a small outward arc while the hands transfer around a
       corner. The animation uses the same arc, so the test covers the actual
       swept body volume instead of a straight line through the wall. */
    climbPathSample.addScaledVector(climbPathNormal,Math.sin(Math.PI*t)*0.18);
    climbPathSurface.lerpVectors(climbPathSurfaceFrom,climbPathSurfaceTo,s);
    const outwardGap=(climbPathSample.x-climbPathSurface.x)*climbPathNormal.x+
      (climbPathSample.z-climbPathSurface.z)*climbPathNormal.z;
    if(outwardGap<0.34)return false;
    for(const box of boxes){
      if(box.active===false)continue;
      if(settledBoxSet.has(box)||colliderMatchesSurface(box.owner,fromRoot,toRoot))continue;
      if(playerOverlapsBox(climbPathSample,box))return false;
    }
    for(const cyl of cyls){
      if(cyl.mesh===fromRoot||cyl.mesh===toRoot||colliderMatchesSurface(cyl.mesh,fromRoot,toRoot))continue;
      if(playerOverlapsCylinder(climbPathSample,cyl))return false;
    }
    for(const c of chunks)if(playerOverlapsChunk(climbPathSample,c.userData))return false;
    for(const c of settledFragments)if(playerOverlapsChunk(climbPathSample,c.userData))return false;
  }
  return true;
}
function climbAttachClearance(h,from,to){
  const root=holdSurfaceRoot(h);
  holdSurfaceAnchor(h,climbPathSurfaceFrom,climbNormalFrom);
  climbPathNormal.copy(climbNormalFrom).setY(0);
  if(climbPathNormal.lengthSq()<1e-4)climbPathNormal.set(0,0,1);
  else climbPathNormal.normalize();
  /* The attach is a short physical pull into the wall. Sample the whole torso
     path, not only the final hand reach, so a valid grip cannot drag the
     backpack through a sill, railing, neighboring rubble, or a nearby cell. */
  for(let i=1;i<=10;i++){
    const t=i/10,s=smooth5(t);
    climbPathSample.lerpVectors(from,to,s);
    climbPathSample.addScaledVector(climbPathNormal,Math.sin(Math.PI*t)*0.12);
    const outwardGap=(climbPathSample.x-climbPathSurfaceFrom.x)*climbPathNormal.x+
      (climbPathSample.z-climbPathSurfaceFrom.z)*climbPathNormal.z;
    if(outwardGap<0.34)return false;
    for(const box of boxes){
      if(box.active===false)continue;
      if(settledBoxSet.has(box)||colliderMatchesSurface(box.owner,root,null))continue;
      if(playerOverlapsBox(climbPathSample,box))return false;
    }
    for(const cyl of cyls){
      if(cyl.mesh===root||colliderMatchesSurface(cyl.mesh,root,null))continue;
      if(playerOverlapsCylinder(climbPathSample,cyl))return false;
    }
    for(const c of chunks)if(playerOverlapsChunk(climbPathSample,c.userData))return false;
    for(const c of settledFragments)if(playerOverlapsChunk(climbPathSample,c.userData))return false;
  }
  return true;
}
function vaultPathClearance(h,from,to,clearance,push){
  holdSurfaceAnchor(h,climbSurfacePoint,climbSurfaceNormal);
  vaultPathNormal.copy(climbSurfaceNormal).setY(0);
  if(vaultPathNormal.lengthSq()<1e-4)vaultPathNormal.set(0,0,1);
  else vaultPathNormal.normalize();
  /* Sample more densely than the render frame rate so a thin railing or a
     freshly settled shard cannot be skipped between the start and landing. */
  const vaultRoot=holdSurfaceRoot(h);
  for(let i=1;i<=18;i++){
    const t=i/18,s=smooth5(t);
    vaultPathSample.lerpVectors(from,to,s);
    vaultPathSample.y+=4*t*(1-t)*clearance;
    vaultPathSample.addScaledVector(vaultPathNormal,-Math.sin(t*Math.PI)*push);
    for(const box of boxes){
      if(box.active===false)continue;
      if(settledBoxSet.has(box)||vaultSurfaceBox(box,h))continue;
      if(playerOverlapsBox(vaultPathSample,box))return false;
    }
    for(const cyl of cyls){
      if(cyl.mesh===vaultRoot||colliderMatchesSurface(cyl.mesh,vaultRoot,h.vaultMesh&&
        (h.vaultMesh.userData&&h.vaultMesh.userData.surfaceRoot||h.vaultMesh)))continue;
      if(playerOverlapsCylinder(vaultPathSample,cyl))return false;
    }
    for(const c of chunks)if(playerOverlapsChunk(vaultPathSample,c.userData))return false;
    for(const c of settledFragments)if(playerOverlapsChunk(vaultPathSample,c.userData))return false;
  }
  return true;
}

function refreshVaultTarget(h){
  if(!h||!h.vault||!h.vaultMesh)return false;
  /* The graph is cooked at load time, but a roof or a settled fragment can
     change the landing face before the player reaches it. Re-sample the exact
     cached footprint so the vault always ends on a real, current top surface.
     Accept a neighboring surface from the same structural parent when the
     original cell has been replaced by the fracture field. */
  const previousRoot=h.vaultMesh.userData&&h.vaultMesh.userData.surfaceRoot||h.vaultMesh;
  vaultTargetProbe.set(h.vault.x,h.vault.y+0.92,h.vault.z);
  vaultTargetRay.copy(DOWN);
  rc.set(vaultTargetProbe,vaultTargetRay);rc.far=1.9;rc.near=0.001;
  const hits=rc.intersectObjects(standables,false);
  for(const hit of hits){
      const normal=wn(hit,hit.object,worldNormalScratch);
    if(normal.y<=0.55||!surfaceObjectIsLive(hit.object))continue;
    if(hit.point.y<player.pos.y+0.38||Math.abs(hit.point.y-h.vault.y)>0.45)continue;
    const dx=hit.point.x-h.vault.x,dz=hit.point.z-h.vault.z;
    if(dx*dx+dz*dz>0.72*0.72)continue;
    const hitRoot=hit.object.userData&&hit.object.userData.surfaceRoot||hit.object;
    const sameParent=structuralColliderParent(hitRoot)&&
      structuralColliderParent(hitRoot)===structuralColliderParent(previousRoot);
    if(hitRoot!==previousRoot&&!sameParent)continue;
    h.vault.copy(hit.point).addScaledVector(UP,0.02);
    h.vaultMesh=hit.object;
    h.vaultNormal.copy(normal).normalize();
    return true;
  }
  return false;
}

function startVault(){
  const h=HOLDS[player.hold];
  if(!h||!h.vault||!holdSurfaceIsLive(h))return false;
  if(h.vaultMesh&&!surfaceObjectIsLive(h.vaultMesh)){
    /* A stored mantle target can outlive a destructible landing surface. Do not
       reuse that stale point and drive the player through newly missing rubble. */
    h.vault=null;h.vaultMesh=null;return false;
  }
  if(!refreshVaultTarget(h))return false;
  holdSurfaceAnchor(h,climbSurfacePoint,climbSurfaceNormal);
  /* A mantle starts from the same supported hang pose as a normal transfer.
     Reject low holds whose floor collision would leave the shoulders behind
     the lip; otherwise the release phase has to stretch an arm several units
     and reads as a missing limb instead of a weight-bearing push. */
  if(!climbPoseReachable(player.hold,player.pos))return false;
  player.vaultNormal.copy(climbSurfaceNormal);
  player.vaultLandingNormal.copy(h.vaultNormal&&h.vaultNormal.lengthSq()>0.25?h.vaultNormal:UP).normalize();
  const dx=h.vault.x-player.pos.x,dz=h.vault.z-player.pos.z;
  const horizontal=Math.hypot(dx,dz);
  const rise=Math.max(0,h.vault.y-player.pos.y);
  if(rise<0.38)return false;
  const duration=Math.max(0.58,Math.min(0.9,0.52+horizontal*0.12+rise*0.025));
  /* The target is on the far side of the lip. A small inward push through the
     apex makes the motion read as a mantle instead of a vertical teleport. */
  const push=Math.max(0.34,Math.min(0.82,0.34+horizontal*0.12+rise*0.05));
  const clearance=Math.max(0.82,Math.min(1.5,0.68+rise*0.38+horizontal*0.1));
  if(!vaultPathClearance(h,player.pos,h.vault,clearance,push)){
    flashHint('VAULT BLOCKED — clear the landing',true);
    return false;
  }
  /* Alternate the plant side so repeated mantles do not use one fixed
     mannequin pose. The hand and foot timing below follow this side. */
  player.vaultLeadLeft=!player.vaultLeadLeft;
  player.mode='vault';
  player.vaultFrom.copy(player.pos);
  player.vaultTo.copy(h.vault);
  player.vaultDuration=duration;
  player.vaultPush=push;
  player.vaultClearance=clearance;
  player.vaultT=0;
  /* Start the camera's slow orbit before the body reaches the lip. Camera yaw
     describes the side of the player where the chase camera sits, so the
     outward normal places it behind a body that continues inward over the
     obstacle. Body and camera headings intentionally use opposite signs. */
  targetYaw=Math.atan2(player.vaultNormal.x,player.vaultNormal.z);
  player.vel.set(0,0,0);player.onGround=false;
  return true;
}

function mantleTarget(h){
  /* tryUp clears the graph-time target before probing the live landing surface;
     keep the cache reusable without requiring every caller to manufacture a
     new vector. */
  if(!h.vault)h.vault=V();
  holdSurfaceAnchor(h,climbSurfacePoint,climbSurfaceNormal);
  const flat=V(climbSurfaceNormal.x,0,climbSurfaceNormal.z);
  if(flat.lengthSq()<1e-4)flat.set(0,0,1);
  flat.normalize();
  const minimumLandingY=player.pos.y+0.38;
  for(const off of[-0.4,-0.2,0.1,0.35,0.6,0.85]){
    const o=V(h.pos.x,h.pos.y+2.2,h.pos.z).addScaledVector(flat,off);
    rc.set(o,DOWN);rc.far=4.6;rc.near=0.001;
    const hits=rc.intersectObjects(standables,false);
    for(const hit of hits){
      const hitNormal=wn(hit,hit.object,worldNormalScratch);
      if(hitNormal.y<=0.55||hit.point.y<=h.pos.y-0.45)continue;
      const land=hit.point.clone().addScaledVector(flat,-0.38).add(V(0,0.02,0));
      rc.set(V(land.x,land.y+1.2,land.z),DOWN);rc.far=2.4;rc.near=0.001;
      const chk=rc.intersectObjects(standables,false);
      for(const landing of chk){
        const landingNormal=wn(landing,landing.object,worldNormalScratch);
        if(landingNormal.y<=0.55||landing.point.y<minimumLandingY||
           Math.abs(landing.point.y-land.y)>=0.5)continue;
        const landingDx=landing.point.x-h.pos.x,landingDz=landing.point.z-h.pos.z;
        if(landingDx*landingDx+landingDz*landingDz>2.2*2.2)continue;
        const lipDx=landing.point.x-land.x,lipDz=landing.point.z-land.z;
        if(lipDx*lipDx+lipDz*lipDz>0.72*0.72)continue;
        if(!surfaceObjectIsLive(landing.object))continue;
        /* Store the surface found by the same probe that approved the target.
           This prevents a mantle from using a graph-time point that now ends in
           open air after rubble or another prop has changed the scene. */
        /* The downward probe is authoritative for all three coordinates. Keep
           the exact hit point instead of carrying the earlier lip sample into
           the animation; that sample can be a few centimeters outside a thin
           top face even when the probe itself found a valid landing. */
        h.vault.copy(landing.point);h.vault.y+=0.02;
        h.vaultMesh=landing.object;
        h.vaultNormal.copy(landingNormal).normalize();
        return h.vault;
      }
      /* A missing landing probe is not a safe mantle. Try another sample along
         the lip instead of accepting an unverified point that can clip through
         a thin ledge or a freshly destroyed roof. */
    }
  }
  return null;
}

function pickMin(h,arr){
  let best=-1,bd=1e9;
  for(const j of arr){
    if(j<0||j>=HOLDS.length||!holdSurfaceIsLive(HOLDS[j]))continue;
    const hd=Math.hypot(HOLDS[j].pos.x-h.pos.x,HOLDS[j].pos.z-h.pos.z);
    if(hd<bd){bd=hd;best=j;}
  }
  return best;
}
function pickSide(h,sgn){
  pickSideAxis.crossVectors(UP,h.out);
  let best=-1,bp=0;
  for(const j of h.side){
    if(j<0||j>=HOLDS.length||!holdSurfaceIsLive(HOLDS[j]))continue;
    const d=pickSideDelta.subVectors(HOLDS[j].pos,h.pos).dot(pickSideAxis)*sgn;
    if(d>bp){bp=d;best=j;}
  }
  return best;
}

function liveTraversalLinkCount(h,kind){
  if(!h)return 0;
  const links=h[kind];
  if(!links||!links.length)return 0;
  let count=0;
  for(const j of links)
    if(j>=0&&j<HOLDS.length&&holdSurfaceIsLive(HOLDS[j]))count++;
  return count;
}

const climbUpCandidates=[];
function tryUp(h){
  if(!h)return false;
  /* A validated mantle is the natural continuation at a lip. The old order
     always consumed an upward handhold first, even when the graph had already
     found a walkable top surface; that made the player climb into the edge and
     left the smoother vault path effectively unreachable. startVault performs
     the live landing, reach, and swept-clearance checks, so a blocked mantle
     can still fall back to an ordinary hand transfer. */
  if(h.vault&&h.vaultMesh&&surfaceObjectIsLive(h.vaultMesh))
    if(startVault())return true;
  /* A graph neighborhood can contain several upward samples around a
     faceted corner. Test them in reach order instead of trusting one nearest
     sample: a single blocked edge should not strand the player when another
     handhold on the same course has a clear swept body path. */
  climbUpCandidates.length=0;
  for(const j of h.up)
    if(j>=0&&j<HOLDS.length&&holdSurfaceIsLive(HOLDS[j]))
      climbUpCandidates.push(j);
  /* Tall low-poly rails may have been cooked before an intermediate sample
     was linked, and a destructible facade can also rebuild its local graph
     after a fracture. Search only a small same-surface neighborhood on the
     input edge; this is deliberately not part of the per-frame solver. */
  const holdRoot=holdSurfaceRoot(h),holdParent=structuralColliderParent(holdRoot);
  for(let j=0;j<HOLDS.length;j++){
    if(j===player.hold||climbUpCandidates.indexOf(j)>=0)continue;
    const candidate=HOLDS[j];
    if(!holdSurfaceIsLive(candidate))continue;
    const candidateRoot=holdSurfaceRoot(candidate);
    const candidateParent=structuralColliderParent(candidateRoot);
    const sameSurface=candidate.mesh===h.mesh||candidateRoot===holdRoot||
      (!!holdParent&&candidateParent===holdParent);
    if(!sameSurface||!climbNormalsCompatible(h,candidate))continue;
    const dx=candidate.pos.x-h.pos.x,dz=candidate.pos.z-h.pos.z,
      dy=candidate.pos.y-h.pos.y,hd=Math.hypot(dx,dz);
    if(dy<=0.25||dy>1.85||hd>1.2)continue;
    climbUpCandidates.push(j);
  }
  climbUpCandidates.sort((a,b)=>{
    const A=HOLDS[a],B=HOLDS[b];
    const ad=Math.hypot(A.pos.x-h.pos.x,A.pos.z-h.pos.z)+Math.abs(A.pos.y-h.pos.y)*0.35;
    const bd=Math.hypot(B.pos.x-h.pos.x,B.pos.z-h.pos.z)+Math.abs(B.pos.y-h.pos.y)*0.35;
    return ad-bd;
  });
  for(const next of climbUpCandidates)if(startMove(next))return true;
  /* The startup graph already found a mantle surface. Keep that target as a
     first live candidate; startVault rechecks its mesh, reach, and swept body
     corridor, so a valid mantle is not discarded just because a later probe
     sees another nearby ledge first. */
  if(h.vault&&h.vaultMesh&&surfaceObjectIsLive(h.vaultMesh))
    if(startVault())return true;
  /* Re-sample the landing now rather than trusting the startup graph. The world
     can contain moving rubble by the time the player reaches this hold. */
  h.vault=null;h.vaultMesh=null;h.vaultNormal.set(0,1,0);
  const refreshedTarget=mantleTarget(h);
  if(refreshedTarget&&startVault())return true;
  /* mantleTarget keeps a reusable vector while probing. Do not leave that
     zero-vector placeholder looking like a valid cache after every failed
     probe; the next input must be able to retry a fresh landing search. */
  h.vault=null;h.vaultMesh=null;h.vaultNormal.set(0,1,0);
  return false;
}

function afterArrive(){
  const h=HOLDS[player.hold];
  const climbIntentActive=performance.now()<climbIntentUntil;
  if(((keys.ShiftLeft||keys.ShiftRight)&&(keys.KeyW||player.climbBuffer>0))||
      climbIntentActive)tryUp(h);
}

/* Fast arcade-shooter traversal. World geometry is intentionally oversized,
   so realistic metre-per-second values read as a slow jog here. These values
   drive the player root itself; animation and FOV only follow the real speed. */
const PLAYER_WALK_SPEED=16.0;
const PLAYER_SPRINT_SPEED=26.0;
const PLAYER_GROUND_ACCEL=60;
const PLAYER_GROUND_BRAKE=72;

function groundStep(dt,dir){
  const run=(keys.ShiftLeft||keys.ShiftRight);
  /* Combat movement needs to cross this large arena decisively. These are
     deliberate gameplay speeds, not animation multipliers: ordinary WASD is
     already quick and Shift is a genuinely fast sprint. */
  const spd=run?PLAYER_SPRINT_SPEED:PLAYER_WALK_SPEED;
  const wasOnGround=player.onGround;
  const previousHorizontalSpeed=Math.hypot(player.vel.x,player.vel.z);
  if(wasOnGround)player.jumpGrace=0.12;
  const incomingVertical=player.vel.y;
  const hasInput=dir.lengthSq()>0.01;
  /* A mantle lands with both feet loaded and the root velocity explicitly
     zeroed. Let held movement input build back over the same recovery window;
     applying full sprint acceleration on the first ground frame can pull the
     player straight back off a narrow ledge before the landing pose settles. */
  const recoveryT=player.vaultRecovery>0?
    Math.max(0,Math.min(1,1-player.vaultRecovery/0.28)):1;
  const recoveryInput=player.vaultRecovery>0?
    lerp(0.15,1,smooth5(recoveryT)):1;
  const desiredX=dir.x*spd*recoveryInput,desiredZ=dir.z*spd*recoveryInput;
  const velocityBeforeX=player.vel.x,velocityBeforeZ=player.vel.z;
  const velocityBlend=1-Math.exp(-
    (hasInput?PLAYER_GROUND_ACCEL:PLAYER_GROUND_BRAKE)*dt);
  /* Preserve momentum briefly so starts, stops, and direction changes read as
     body weight instead of a binary strafe toggle. */
  player.vel.x+=(desiredX-player.vel.x)*velocityBlend;
  player.vel.z+=(desiredZ-player.vel.z)*velocityBlend;
  /* Keep a bounded directional acceleration signal for the rig. A scalar speed
     delta can tell braking from acceleration, but it cannot tell a strafe from
     a turn. The body and weapon use this filtered world-space signal below so
     shoulders, elbows, and the muzzle lag in the direction inertia actually
     acts instead of animating from a generic walk oscillator. */
  const accelScale=1/Math.max(0.001,dt)/12;
  const targetAccelX=Math.max(-1,Math.min(1,(player.vel.x-velocityBeforeX)*accelScale));
  const targetAccelZ=Math.max(-1,Math.min(1,(player.vel.z-velocityBeforeZ)*accelScale));
  movementAccelWorld.x=dampValue(movementAccelWorld.x,targetAccelX,18,dt);
  movementAccelWorld.z=dampValue(movementAccelWorld.z,targetAccelZ,18,dt);
  player.vel.y-=22*dt;
  const py=player.pos.y;
  /* Sweep fast ground motion in short deterministic increments. The old
     single translation could move the capsule through a thin wall or a
     freshly settled shard before resolveColliders had a chance to react;
     micro-steps keep the same cheap collision model while making contact
     continuous at sprint speed. */
  const travel=Math.hypot(player.vel.x,player.vel.z)*dt;
  const motionSteps=Math.max(1,Math.min(12,Math.ceil(travel/0.14)));
  const motionDt=dt/motionSteps;
  let steppedThisFrame=false;
  for(let i=0;i<motionSteps;i++){
    playerCollisionBefore.copy(player.pos);
    playerStepIntended.copy(player.pos);
    playerStepIntended.x+=player.vel.x*motionDt;
    playerStepIntended.z+=player.vel.z*motionDt;
    playerStepVelocity.copy(player.vel);
    player.pos.x+=player.vel.x*motionDt;
    player.pos.y+=player.vel.y*motionDt;
    player.pos.z+=player.vel.z*motionDt;
    const collided=resolveColliders();
    /* Position correction is the contact normal for this lightweight player
       collider. Remove only the velocity component pushing into that contact;
       the tangential component survives, so running along a wall slides
       naturally instead of stuttering against it. */
    playerCollisionCorrection.subVectors(player.pos,playerCollisionBefore).setY(0);
    const correctionLengthSq=playerCollisionCorrection.lengthSq();
    if(correctionLengthSq>1e-6){
      playerCollisionNormal.copy(playerCollisionCorrection).multiplyScalar(1/Math.sqrt(correctionLengthSq));
      const intoContact=player.vel.dot(playerCollisionNormal);
      if(intoContact>0)player.vel.addScaledVector(playerCollisionNormal,-intoContact);
    }
    if(collided&&!steppedThisFrame&&wasOnGround&&player.grace<=0&&
       Math.abs(incomingVertical)<1.0){
      /* Treat a small obstruction as a step only when the raised capsule can
         clear it and a real standable top exists below the step limit. A
         failed probe restores the already-corrected position, so walls and
         tall debris keep their normal slide/block behavior. */
      playerStepBlocked.copy(player.pos);
      const baseGround=groundBelow(playerCollisionBefore.x,playerCollisionBefore.z,
        playerCollisionBefore.y+0.9);
      playerStepCandidate.copy(playerStepIntended);
      playerStepCandidate.y=Math.max(playerCollisionBefore.y,baseGround)+PLAYER_STEP_HEIGHT+0.02;
      player.pos.copy(playerStepCandidate);
      const stepBlocked=resolveColliders();
      const stepGround=groundBelow(player.pos.x,player.pos.z,player.pos.y+0.9);
      const stepRise=stepGround-baseGround;
      const horizontalError=Math.hypot(
        player.pos.x-playerStepIntended.x,player.pos.z-playerStepIntended.z);
      if(!stepBlocked&&stepRise>PLAYER_STEP_MIN_RISE&&
         stepRise<=PLAYER_STEP_HEIGHT+0.04&&horizontalError<0.07){
        player.pos.y=stepGround;
        player.vel.x=playerStepVelocity.x;
        player.vel.y=0;
        player.vel.z=playerStepVelocity.z;
        player.onGround=true;
        player.landingSurface=null;
        steppedThisFrame=true;
      }else player.pos.copy(playerStepBlocked);
    }
  }
  const gh=groundBelow(player.pos.x,player.pos.z,Math.max(py,player.pos.y)+0.8);
  if(player.pos.y<=gh){
    player.pos.y=gh;player.vel.y=0;player.onGround=true;
    if(!wasOnGround&&incomingVertical<-1.8)landingKick=Math.min(1.15,-incomingVertical/7.6);
  }
  else player.onGround=(player.pos.y-gh)<0.08;
  if(player.jumpBuffer>0&&(player.onGround||player.jumpGrace>0)){
    player.vel.y=7.6;player.onGround=false;player.jumpGrace=0;player.jumpBuffer=0;
    player.landingSurface=null;Sfx.jump();
  }
  const climbIntentActive=performance.now()<climbIntentUntil;
  const climbing=run;
  if(((climbing&&keys.KeyW)||climbIntentActive)&&
     (dir.lengthSq()>0.01||climbIntentDir.lengthSq()>0.01)){
    /* Preserve the intended approach for a few frames. Input and camera are
       sampled independently from the physics step, so requiring a perfect
       same-frame ray hit made sprinting past a hold feel randomly missed. */
    player.climbDir.copy(dir.lengthSq()>0.01?dir:climbIntentDir);
    player.climbBuffer=0.16;
  }
  if((climbing||climbIntentActive)&&player.climbBuffer>0&&
     player.climbDir.lengthSq()>0.01)
    tryGrab(player.climbDir,!player.onGround);
  if(dir.lengthSq()>0.01)player.heading=Math.atan2(dir.x,dir.z);
  const horizontalSpeed=Math.hypot(player.vel.x,player.vel.z);
  const speedAcceleration=Math.max(-1,Math.min(1,
    (horizontalSpeed-previousHorizontalSpeed)/Math.max(0.001,dt)/12));
  movementAccel=dampValue(movementAccel,speedAcceleration,18,dt);
  moveSpeed+=(horizontalSpeed-moveSpeed)*Math.min(1,dt*8);
  walkAmt=horizontalSpeed;
  const moving=horizontalSpeed>0.08&&player.onGround;
  sprinting=moving&&run&&horizontalSpeed>1.0;
  camMoveFwd.set(-Math.sin(camYaw),0,-Math.cos(camYaw));
  camMoveRight.set(-camMoveFwd.z,0,camMoveFwd.x);
  const strafe=dir.x*camMoveRight.x+dir.z*camMoveRight.z;
  camRollTarget=Math.max(-0.12,Math.min(0.12,strafe*0.05));
  if(moving){
    bobPhase+=dt*Math.min(34,9+horizontalSpeed*0.95);
    camBobAmt=Math.min(camBobAmt+dt*3,0.06);
  }else{
    camBobAmt=Math.max(camBobAmt-dt*6,0);
    bobPhase*=0.9;
  }
}

function hangStep(dt){
  climbPhase+=dt*2.6;
  const h=HOLDS[player.hold];
  if(!holdSurfaceIsLive(h)){releaseTraversal(h);return;}
  /* Refresh the contact frame before a manual drop so S/SPACE leaves from the
     actual wall plane instead of the low-resolution hold direction. */
  holdSurfaceAnchor(h,climbSurfacePoint,climbSurfaceNormal);
  keepClimbBodyClear(player.pos,h);
  resolveColliders(holdSurfaceRoot(h));
  const run=(keys.ShiftLeft||keys.ShiftRight);
  const climbIntentActive=performance.now()<climbIntentUntil;
  const vaultIntent=keys.Space||performance.now()<vaultIntentUntil;
  if(vaultIntent){
    /* The startup graph is only a hint. A ledge can become reachable after the
       player transfers to a new hold, and a destructible top can also replace
       the mesh that was sampled at load time. Probe the current hold on the
       input edge so SPACE remains a reliable mantle action instead of silently
       turning into a drop just because the cache was empty. */
    if(!h.vault||!h.vaultMesh||!surfaceObjectIsLive(h.vaultMesh)){
      h.vault=null;h.vaultMesh=null;h.vaultNormal.set(0,1,0);
      mantleTarget(h);
    }
    if(h.vault&&h.vaultMesh&&startVault())return;
  }
  if((run&&keys.KeyW)||climbIntentActive)player.climbBuffer=0.16;
  const wantUp=(run||climbIntentActive)&&
    (keys.KeyW||climbIntentActive||player.climbBuffer>0);
  if(wantUp){
    if(tryUp(h))return;
  }
  const dropIntent=keys.KeyS||keys.Space||performance.now()<dropIntentUntil;
  if(dropIntent){
    if(keys.KeyS&&h.down.length){
      const next=pickMin(h,h.down);
      if(startMove(next))return;
    }
    player.mode='ground';
    player.vel.copy(climbSurfaceNormal).setY(0).normalize().multiplyScalar(1.4);
    player.vel.y=(keys.Space||performance.now()<spaceIntentUntil)?7.0:1;
    player.pos.addScaledVector(player.vel,0.04);
    player.cool=0.4;
    player.grace=0.45;
    player.onGround=false;
    return;
  }
  let sd=(keys.KeyD?1:0)-(keys.KeyA?1:0);
  if(sd===0&&performance.now()<movementIntentUntil){
    /* A short A/D tap can arrive between hang samples just like Shift/W. Read
       its world-space intent in the current wall frame so a transfer still
       chooses the correct side without treating forward motion as a strafe. */
    pickSideAxis.crossVectors(UP,climbSurfaceNormal);
    if(pickSideAxis.lengthSq()<0.04)pickSideAxis.set(1,0,0);
    else pickSideAxis.normalize();
    const sideIntent=movementIntentDir.dot(pickSideAxis);
    if(Math.abs(sideIntent)>0.22)sd=sideIntent>0?1:-1;
  }
  if(sd!==0){
    const j=pickSide(h,sd);
    if(j>=0)startMove(j);
  }
}

function moveStep(dt){
  if(player.moveTo<0||player.moveTo>=HOLDS.length||
     (player.mode==='move'&&(player.moveFrom<0||player.moveFrom>=HOLDS.length))){
    releaseTraversal(HOLDS[player.moveFrom]||HOLDS[player.moveTo]);
    return;
  }
  const fromHold=player.mode==='attach'?null:HOLDS[player.moveFrom];
  const toHold=HOLDS[player.moveTo];
  if(!toHold||!holdSurfaceIsLive(toHold)||
     (fromHold&& !holdSurfaceIsLive(fromHold))){
    releaseTraversal(fromHold||toHold);
    return;
  }
  player.attachT+=dt;
  const from=player.mode==='attach'?player.attachFrom:hangPos(player.moveFrom,hangFromPos);
  const to=hangPos(player.moveTo,hangToPos);
  const dur=player.mode==='attach'?0.24:Math.max(0.26,from.distanceTo(to)/2.2);
  player.moveDuration=dur;
  const k=Math.min(1,player.attachT/dur);
  const s=k*k*(3-2*k);
  /* Build the intended root position separately, then travel toward it from
     the already-corrected physical position. Re-l.-erp-ing from the original
     spline every frame used to overwrite a wall correction on the next tick,
     which made the torso and backpack repeatedly re-enter corners. */
  climbDesiredPos.lerpVectors(from,to,s);
  if(player.mode==='move'){
    const fromHold=HOLDS[player.moveFrom],toHold=HOLDS[player.moveTo];
    if(fromHold&&toHold){
      /* Swing the chest away from corners while the hands transfer. The
         outward arc prevents the torso from cutting through the wall plane.
         This offset is applied to the physical root as well as the render rig
         so a corner cannot visually clear the wall while the collider clips. */
      holdSurfaceAnchor(fromHold,climbSurfacePoint,climbNormalFrom);
      holdSurfaceAnchor(toHold,climbSurfacePointB,climbNormalTo);
      climbHoldNormal.copy(climbNormalFrom).lerp(climbNormalTo,s).normalize();
      climbDesiredPos.addScaledVector(climbHoldNormal,Math.sin(k*Math.PI)*0.18);
    }
  }
  climbMotionFrom.copy(player.pos);
  climbMotionDelta.subVectors(climbDesiredPos,climbMotionFrom);
  const climbDistance=climbMotionDelta.length();
  const climbSteps=Math.max(1,Math.min(4,Math.ceil(climbDistance/0.12)));
  climbMotionDelta.multiplyScalar(1/climbSteps);
  const climbCollisionA=holdSurfaceRoot(fromHold),climbCollisionB=holdSurfaceRoot(toHold);
  for(let step=0;step<climbSteps;step++){
    player.pos.add(climbMotionDelta);
    keepClimbBodyClear(player.pos,k<0.5?(fromHold||toHold):toHold);
    resolveColliders(climbCollisionA,climbCollisionB);
  }
  climbPhase+=dt*8.5;
  if(k>=1){
    const arrivedHold=player.moveTo;
    player.hold=arrivedHold;
    player.mode='hang';
    player.onGround=false;
    player.moveFrom=-1;player.moveTo=-1;player.attachT=0;
    afterArrive();
  }
}

function vaultStep(dt){
  const h=HOLDS[player.hold];
  if(!holdSurfaceIsLive(h)||(h.vaultMesh&&!surfaceObjectIsLive(h.vaultMesh))){
    releaseTraversal(h);return;
  }
  player.vaultT+=dt/player.vaultDuration;
  const k=Math.min(1,player.vaultT);
  const s=smooth5(k);
  vaultDesiredPos.lerpVectors(player.vaultFrom,player.vaultTo,s);
  vaultDesiredPos.y+=4*k*(1-k)*player.vaultClearance;
  /* Clear the lip at mid-vault by travelling through the wall plane, then
     settle back onto the landing surface instead of hovering in front of it. */
  vaultDesiredPos.addScaledVector(player.vaultNormal,-Math.sin(k*Math.PI)*player.vaultPush);
  /* Re-run the lightweight body clearance while the mantle is in flight. The
     start probe guards the planned path, but moving rubble or another prop can
     enter that corridor during the vault. Ignore only the wall and landing
     surfaces that the animation is intentionally crossing. */
  vaultMotionFrom.copy(player.pos);
  vaultMotionDelta.subVectors(vaultDesiredPos,vaultMotionFrom);
  const vaultDistance=vaultMotionDelta.length();
  const vaultSteps=Math.max(1,Math.min(4,Math.ceil(vaultDistance/0.16)));
  vaultMotionDelta.multiplyScalar(1/vaultSteps);
  const vaultWall=holdSurfaceRoot(h),vaultLanding=h.vaultMesh&&
    (h.vaultMesh.userData&&h.vaultMesh.userData.surfaceRoot||h.vaultMesh);
  for(let i=0;i<vaultSteps;i++){
    /* Advance from the corrected position, rather than repeatedly rebuilding
       the same interpolation from vaultMotionFrom. This preserves a shove from
       a moving shard or wall corner through the rest of the mantle frame. */
    player.pos.add(vaultMotionDelta);
    resolveColliders(vaultWall,vaultLanding);
  }
  if(k>=1){
    const wallRoot=holdSurfaceRoot(h);
    const landingObject=h.vaultMesh;
    const landingRoot=landingObject&&landingObject.userData&&landingObject.userData.surfaceRoot||landingObject;
    /* The target was just validated against this top face. Do not let a
       higher shelf behind the lip win the first downward ray and yank the
       player upward at the last frame of the mantle. */
    const landingY=groundBelow(player.pos.x,player.pos.z,player.pos.y+0.6,player.vaultTo.y+0.28);
    /* Preserve the body’s forward travel across the lip. The old zero-velocity
       handoff made a mantle visibly pause on the landing frame and forced the
       recovery pose to restart movement from rest. Use the horizontal tangent
       of the authored vault path as a modest exit impulse; normal ground
       resolution and the recovery blend still own the final contact. */
    vaultExitVelocity.subVectors(player.vaultTo,player.vaultFrom).setY(0);
    const exitDistance=vaultExitVelocity.length();
    if(exitDistance>0.001)
      vaultExitVelocity.multiplyScalar(Math.min(2.8,Math.max(0.65,
        exitDistance/Math.max(0.42,player.vaultDuration)*0.95))/exitDistance);
    else vaultExitVelocity.set(0,0,0);
    player.mode='ground';player.vel.copy(vaultExitVelocity);
    if(landingY>0)player.pos.y=landingY;
    /* The mantle is intentionally crossing these two surfaces. Resolving them
       as a side collision on the same frame pushes the player off the ledge
       before the next ground probe, which looked like a teleport to y=0. Keep
       nearby rubble collidable, but let the validated wall/top contact finish
       the handoff. */
    resolveColliders(wallRoot,landingRoot);
    const finalGround=groundBelow(player.pos.x,player.pos.z,player.pos.y+0.6,player.vaultTo.y+0.28);
    if(finalGround>0)player.pos.y=finalGround;
    else if(landingY>0)player.pos.y=landingY;
    player.landingSurface=landingRoot&&surfaceObjectIsLive(landingRoot)?landingRoot:null;
    player.landingAnchor.copy(player.pos);
    player.landingY=player.pos.y;
    /* Land facing over the obstacle. The camera remains on the outward side,
       behind the player; using the outward normal for both headings turned the
       character 180 degrees to face the camera on touchdown. */
    player.onGround=true;
    player.heading=Math.atan2(-player.vaultNormal.x,-player.vaultNormal.z);
    /* Keep the weight-bearing landing pose for a brief, live recovery window.
       Switching directly from the vault IK targets to the weapon targets on
       the next frame made the feet and shoulders pop even though the physical
       root had landed correctly. */
    player.vaultRecovery=0.28;
    /* Keep the chase camera on the same landing-side orbit that was eased in
       during the mantle. Resetting to the wall-facing yaw here made the camera
       reverse direction on the exact frame the feet reached the top surface. */
    targetYaw=Math.atan2(player.vaultNormal.x,player.vaultNormal.z);
    landingKick=0.32;
    /* Give the camera enough time to complete its orbit around the landing
       side before normal obstruction correction resumes. Movement remains
       live during this window; only the just-cleared mantle corridor is
       treated as recoverable camera space. */
    player.cool=0.25;player.grace=1.8;
  }
}
