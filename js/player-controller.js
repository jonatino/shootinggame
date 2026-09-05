/* Input, collision, traversal, and player movement. Loaded in order from index.html. */
const player={pos:V(8,0,16),vel:V(),mode:'ground',hold:-1,
  moveFrom:-1,moveTo:-1,attachT:0,moveDuration:0.36,attachFrom:V(),
  vaultFrom:V(),vaultTo:V(),vaultNormal:V(),vaultT:0,vaultDuration:0.68,vaultClearance:0.72,vaultPush:0.42,
  vaultForwardStart:0,
  vaultLandingNormal:V(0,1,0),vaultContactNormal:V(0,1,0),
  vaultKind:'none',vaultObstacle:null,vaultLandingMesh:null,
  vaultContactPoint:V(),vaultDirection:V(0,0,1),
  vaultObstacleHeight:0,vaultObstacleDepth:0,vaultEntrySpeed:0,
  vaultLeadLeft:true,
  vaultRecovery:0,vaultRecoveryDuration:0.28,
  landingSurface:null,landingAnchor:V(),landingY:0,landingRadius:1.35,
  climbBuffer:0,climbDir:V(),jumpClimbActive:false,jumpLaunchY:0,
  cool:0,grace:0,jumpGrace:0,jumpBuffer:0,onGround:true,heading:Math.PI,
  hp:100,respawnShield:0};
const PLAYER_HEIGHT=1.7,PLAYER_RADIUS=0.32;
const PLAYER_JUMP_HEIGHT=1.3;
const PLAYER_JUMP_SPEED=Math.sqrt(2*WORLD_GRAVITY*PLAYER_JUMP_HEIGHT);
const playerCollisionBefore=V(),playerCollisionCorrection=V(),playerCollisionNormal=V();
const playerStepIntended=V(),playerStepBlocked=V(),playerStepCandidate=V(),playerStepVelocity=V();
const PLAYER_STEP_HEIGHT=0.42,PLAYER_STEP_MIN_RISE=0.035;
/* Start from a readable over-the-shoulder angle. The old near-rear view was
   valid for navigation, but it lined the weapon up with the camera's depth
   axis and made the held rifle/pistol disappear into the torso. A modest side
   angle keeps the normal chase view while exposing the hands, elbows, and gun
   silhouette without changing the player's aim direction. */
let camYaw=0.72,camPitch=0.27,camShake=0;
let targetYaw=camYaw,targetPitch=camPitch,curFov=75;
const CAMERA_PITCH_MIN=-0.42,CAMERA_PITCH_MAX=1.25;
let sprinting=false;
let moveSpeed=0,camZoom=1,heldDist=5.6;
/* Fire-rate cooldown and physical recoil are separate signals. Cooldown says
   when the weapon may fire again; recoil is a short impulse shared by the
   stock, shoulders, torso, and muzzle. The crosshair and camera stay steady. */
const weaponRecoilProfiles={
  PISTOL:{load:0.34,pitch:0.045,roll:0.014},
  RIFLE:{load:0.24,pitch:0.032,roll:0.011},
  SHOTGUN:{load:0.7,pitch:0.105,roll:0.032},
  RPG:{load:0.95,pitch:0.16,roll:0.05},
  CANNON:{load:0.18,pitch:0.022,roll:0.009}
};
let weaponRecoilKick=0,weaponRecoilPitch=0,weaponRecoilRoll=0;
/* reusable vectors to avoid per-frame allocation in updateCam */
const camTmp1=V(),camTmp2=V(),camTmp3=V();
const moveFwd=V(),moveRight=V(),moveDir=V(),hintOrigin=V(),hintFwd=V();
const climbCameraForward=V(),climbCameraToHold=V(),climbCameraSurface=V();
const pickSideAxis=V(),pickSideDelta=V();
const movementAccelWorld=V();
let climbPhase=0,climbStepParity=0,landingKick=0,walkPhase=0,walkAmt=0,heading=Math.PI;
let weaponSprint=0,movementAccel=0;
let started=false;
/* game-loop replaces these no-op hooks after every classic script has loaded.
   Keeping the hooks here lets the input module remain usable in the CPU test
   harness, which intentionally does not load the renderer loop. */
let resumeGameLoop=()=>{},suspendGameLoop=()=>{};
let mouseHeld=false;
let mouseLookDragging=false,mouseLookReady=false,lastMouseX=0,lastMouseY=0;
const MOUSE_SENSITIVITY=0.0026;
let fireBlockUntil=0;
const climbIntentDir=V();
let climbIntentUntil=0;
let shiftIntentUntil=0;
let dropIntentUntil=0,spaceIntentUntil=0;
let vaultIntentUntil=0;
let climbDownIntentUntil=0;
const movementIntentDir=V();
let movementIntentUntil=0;
let movementInputSampled=false;
/* Preserve very short taps across a slow input/render boundary. Keep this
   brief: at the higher combat speeds, a longer grace period feels like ice. */
const MOVEMENT_INTENT_WINDOW=0.12;
const JUMP_BUFFER_DURATION=0.14;

const keys={};
const inputKeyAliases={
  w:'KeyW',a:'KeyA',s:'KeyS',d:'KeyD',c:'KeyC',
  W:'KeyW',A:'KeyA',S:'KeyS',D:'KeyD',C:'KeyC',
  KEYW:'KeyW',KEYA:'KeyA',KEYS:'KeyS',KEYD:'KeyD',KEYC:'KeyC',
  Shift:'ShiftLeft',ShiftLeft:'ShiftLeft',ShiftRight:'ShiftRight',
  SHIFT:'ShiftLeft',SHIFTLEFT:'ShiftLeft',SHIFTRIGHT:'ShiftRight',
  Space:'Space',SPACE:'Space',' ':'Space'
};
function normalizedInputCode(e){
  return inputKeyAliases[e.code]||inputKeyAliases[e.key]||e.code;
}
addEventListener('keydown',e=>{
  const code=normalizedInputCode(e);
  if(code==='Escape'&&started){e.preventDefault();pauseForFocusLoss();return;}
  if(!started)return;
  keys[code]=true;
  if(code==='Space')e.preventDefault();
  const inputNow=performance.now();
  const shiftCode=code==='ShiftLeft'||code==='ShiftRight';
  if(shiftCode)shiftIntentUntil=inputNow+0.28*1000;
  if(code==='KeyS')dropIntentUntil=inputNow+0.3*1000;
  if(code==='KeyC'&&!e.repeat)climbDownIntentUntil=inputNow+0.42*1000;
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
    if(!e.repeat)movementInputSampled=false;
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
  if(code==='Space'&&!e.repeat)player.jumpBuffer=JUMP_BUFFER_DURATION;
  if(!e.repeat){
    if(code==='Digit1')setWeapon('pistol');
    if(code==='Digit2')setWeapon('rifle');
    if(code==='Digit3')setWeapon('shotgun');
    if(code==='Digit4')setWeapon('rpg');
    if(code==='Digit5')setWeapon('cannon');
    if(code==='KeyE')tryPickup();
  }
});
addEventListener('keyup',e=>{
  const code=normalizedInputCode(e);
  keys[code]=false;
  if((code==='KeyW'||code==='KeyA'||code==='KeyS'||code==='KeyD')&&
     !keys.KeyW&&!keys.KeyA&&!keys.KeyS&&!keys.KeyD){
    /* Keep a tap that arrived entirely between physics samples alive for the
       short intent window. Once live input has reached a simulation frame,
       release it immediately so normal held movement never gains an icy tail. */
    if(movementInputSampled){
      movementIntentUntil=0;
      movementIntentDir.set(0,0,0);
    }
    movementInputSampled=false;
  }
});
addEventListener('mousedown',e=>{
  if(!started)return;
  if(e.button===2&&document.pointerLockElement!==renderer.domElement){
    mouseLookDragging=true;
    mouseLookReady=false;
    e.preventDefault();
    return;
  }
  if(performance.now()<fireBlockUntil)return;
  if(e.button===0){mouseHeld=true;shoot();}
});
addEventListener('mouseup',e=>{
  if(e.button===0)mouseHeld=false;
  if(e.button===2){mouseLookDragging=false;mouseLookReady=false;}
});
const startScreen=document.getElementById('start');
function clearGameInput(){
  mouseHeld=false;mouseLookDragging=false;mouseLookReady=false;
  climbIntentUntil=0;shiftIntentUntil=0;
  dropIntentUntil=0;spaceIntentUntil=0;vaultIntentUntil=0;
  climbDownIntentUntil=0;
  climbIntentDir.set(0,0,0);
  movementIntentUntil=0;movementIntentDir.set(0,0,0);movementInputSampled=false;
  player.jumpBuffer=0;player.climbBuffer=0;
  for(const code in keys)keys[code]=false;
}
function pauseForFocusLoss(){
  clearGameInput();
  started=false;
  suspendGameLoop();
  startScreen.style.display='flex';
  const title=document.getElementById('start-title');
  if(title)title.textContent='PAUSED';
  const button=document.getElementById('play-button');
  if(button)button.textContent='RESUME GAME';
  if(document.pointerLockElement===renderer.domElement&&document.exitPointerLock)
    document.exitPointerLock();
}
addEventListener('blur',pauseForFocusLoss);
document.addEventListener('visibilitychange',()=>{
  if(document.hidden)pauseForFocusLoss();
});
function applyMouseLookDelta(dx,dy){
  /* Mouse travel is the sole owner of camera yaw and pitch. Apply it to both
     live and target angles so the view never accelerates, drifts, or inherits
     a traversal-authored direction after the user stops moving the mouse. */
  const sensitivity=MOUSE_SENSITIVITY*gameSettings.sensitivity;
  const yawDelta=-dx*sensitivity;
  targetYaw+=yawDelta;
  camYaw+=yawDelta;
  const nextPitch=Math.max(CAMERA_PITCH_MIN,
    Math.min(CAMERA_PITCH_MAX,targetPitch+dy*sensitivity*(gameSettings.invertY?-1:1)));
  const pitchDelta=nextPitch-targetPitch;
  targetPitch=nextPitch;
  camPitch=Math.max(CAMERA_PITCH_MIN,Math.min(CAMERA_PITCH_MAX,camPitch+pitchDelta));
}
addEventListener('mousemove',e=>{
  if(!started)return;
  if(document.pointerLockElement===renderer.domElement){
    applyMouseLookDelta(e.movementX||0,e.movementY||0);
    return;
  }
  if(!mouseLookDragging)return;
  /* Ordinary right-drag remains available when an embedded browser declines
     pointer lock. It never moves or recenters the OS cursor. */
  if(!mouseLookReady){lastMouseX=e.clientX;lastMouseY=e.clientY;mouseLookReady=true;return;}
  const dx=e.clientX-lastMouseX,dy=e.clientY-lastMouseY;
  lastMouseX=e.clientX;lastMouseY=e.clientY;
  applyMouseLookDelta(dx,dy);
});
function requestGamePointerLock(){
  if(document.pointerLockElement===renderer.domElement||
     typeof renderer.domElement.requestPointerLock!=='function')return;
  try{
    /* Use the standard request with no raw/unadjusted-input option. Some
       embedded Windows hosts warp the desktop cursor while negotiating the
       optional raw-input mode, even though normal pointer lock works. */
    const request=renderer.domElement.requestPointerLock();
    if(request&&typeof request.then==='function')request.then(()=>{
      gameHadPointerLock=true;
    },()=>{});
  }catch(_){
    /* RMB-drag remains usable when pointer lock is unavailable. */
  }
}
let gameHadPointerLock=false;
document.addEventListener('pointerlockchange',()=>{
  mouseLookDragging=false;
  mouseLookReady=false;
  const locked=document.pointerLockElement===renderer.domElement;
  if(gameHadPointerLock&&!locked&&started)pauseForFocusLoss();
  gameHadPointerLock=locked;
});
renderer.domElement.addEventListener('click',()=>{
  if(started)requestGamePointerLock();
});
renderer.domElement.addEventListener('contextmenu',e=>{
  if(started)e.preventDefault();
});
function startGame(){
  if(started)return;
  Sfx.init();
  clearGameInput();
  mouseLookReady=false;
  fireBlockUntil=performance.now()+250;
  started=true;
  startScreen.style.display='none';
  resumeGameLoop();
  requestGamePointerLock();
}
startScreen.addEventListener('mousedown',e=>{
  if(e.target&&e.target.closest&&e.target.closest('#settings-panel'))return;
  e.preventDefault();
  e.stopPropagation();
  if(e.button===0)startGame();
});
const playButton=document.getElementById('play-button');
if(playButton)playButton.addEventListener('click',startGame);
startScreen.addEventListener('contextmenu',e=>{
  e.preventDefault();
  e.stopPropagation();
});
addEventListener('wheel',e=>{
  if(!started)return;
  if(e.deltaY===0)return;
  const units=e.deltaMode===1?16:(e.deltaMode===2?innerHeight:1);
  camZoom=Math.max(0.65,Math.min(1.7,camZoom+Math.max(-0.2,Math.min(0.2,e.deltaY*units*0.001))));
},{passive:true});

const pickupOrigin=V(),pickupDirection=V(),pickupHits=[];
function nearbyPickup(){
  let nearest=null,bestDistance=1.5;
  pickupOrigin.copy(player.pos);pickupOrigin.y+=1;
  for(const p of pickups){
    if(!p.alive)continue;
    const distance=p.pos.distanceTo(player.pos);
    if(distance>=bestDistance)continue;
    pickupDirection.copy(p.pos);pickupDirection.y+=0.5;pickupDirection.sub(pickupOrigin);
    const rayLength=pickupDirection.length();pickupDirection.normalize();
    rc.set(pickupOrigin,pickupDirection);rc.near=0;rc.far=Math.max(0,rayLength-0.08);
    pickupHits.length=0;
    rc.intersectObjects(getCameraOccluderCandidates(pickupOrigin,pickupDirection,rayLength),false,pickupHits);
    if(pickupHits.length)continue;
    nearest=p;bestDistance=distance;
  }
  return nearest;
}
function tryPickup(){
  const p=nearbyPickup();
  if(!p)return;
  if(p.kind==='health'&&player.hp>=100){flashHint('HEALTH FULL');return;}
  if(p.kind!=='health'&&playerWpn.cur===p.kind){flashHint('ALREADY EQUIPPED');return;}
  p.alive=false;p.group.visible=false;p.respawn=12;
  if(p.kind==='health'){
    const restored=Math.min(40,100-player.hp);player.hp+=restored;
    flashHint('+'+restored+' HEALTH');
  }else setWeapon(p.kind);
  Sfx.pickup();updateStatsUI();
}

function respawnPlayer(){
  clearGameInput();
  player.hp=100;player.respawnShield=1.5;
  player.pos.set(8,0,16);player.vel.set(0,0,0);
  player.mode='ground';player.onGround=true;
  player.hold=-1;player.moveFrom=-1;player.moveTo=-1;
  player.attachT=0;player.vaultT=0;player.vaultKind='none';
  player.vaultObstacle=null;player.vaultLandingMesh=null;player.landingSurface=null;
  player.vaultRecovery=0;player.cool=0;player.grace=0;player.jumpGrace=0;
  player.jumpClimbActive=false;player.jumpLaunchY=0;player.climbDir.set(0,0,0);
  landingKick=0;walkAmt=0;moveSpeed=0;movementAccel=0;movementAccelWorld.set(0,0,0);
  weaponRecoilKick=0;weaponRecoilPitch=0;weaponRecoilRoll=0;
  camShake=0;
  player.pos.y=groundBelow(player.pos.x,player.pos.z,12);
  resolveColliders();
  flashHint('RESPAWNED — back in the fight');
}
function damagePlayer(amount){
  if(!Number.isFinite(amount)||amount<=0||player.respawnShield>0)return false;
  player.hp=Math.max(0,player.hp-amount);
  showHit();
  if(player.hp<=0)respawnPlayer();
  updateStatsUI();
  return true;
}

const groundStaticProbe=V(),groundStandableCandidates=[],groundSurfaceHits=[];
const groundSurfaceNormal=V(),groundNormalMatrix=new THREE.Matrix3();
const PLAYER_MIN_GROUND_NORMAL=0.64; /* about 50 degrees from level */
function groundBelow(x,z,fromY,limitY){
  let best=0;
  /* Voxel fields already expose exact axis-aligned physics boxes in the static
     grid. Reading the handful beneath this point avoids asking Three.js to
     raycast every instance in every building once (and three times on a step
     collision). */
  groundStaticProbe.set(x,fromY,z);
  for(const box of getStaticBoxCandidatesAt(groundStaticProbe,0.05)){
    if(box.active===false||!box.voxelStructure)continue;
    if(x<box.min.x||x>box.max.x||z<box.min.z||z>box.max.z)continue;
    const top=box.max.y;
    if(top<=fromY+0.31&&(limitY===undefined||top<=limitY)&&top>best)best=top;
  }
  groundProbeOrigin.set(x,fromY+0.3,z);
  rc.set(groundProbeOrigin,DOWN);rc.far=Math.max(0.001,fromY+0.35);rc.near=0.001;
  groundStandableCandidates.length=0;
  for(const mesh of nearbyStandables(groundProbeOrigin,DOWN,rc.far)){
    /* Static voxel fields were handled exactly above. Dynamic chunks and all
       conventional meshes still use their real triangles. */
    if(mesh&&mesh.userData&&mesh.userData.kind==='voxelField')continue;
    groundStandableCandidates.push(mesh);
  }
  groundSurfaceHits.length=0;
  const hits=rc.intersectObjects(groundStandableCandidates,false,groundSurfaceHits);
  for(let i=0;i<hits.length;i++){
    const hit=hits[i];
    if(hit.face){
      groundNormalMatrix.getNormalMatrix(hit.object.matrixWorld);
      groundSurfaceNormal.copy(hit.face.normal).applyNormalMatrix(groundNormalMatrix);
      if(groundSurfaceNormal.y<PLAYER_MIN_GROUND_NORMAL)continue;
    }
    const y=hits[i].point.y;
    if(y<=fromY+0.31&&(limitY===undefined||y<=limitY)&&y>best)best=y;
  }
  return best;
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
  if(player.mode==='ground'&&player.vaultRecovery>0&&
     (player.vaultKind==='low'||player.vaultKind==='quick')){
    const obstacle=player.vaultObstacle&&player.vaultObstacle.userData&&
      player.vaultObstacle.userData.surfaceRoot||player.vaultObstacle;
    const landing=player.vaultLandingMesh&&player.vaultLandingMesh.userData&&
      player.vaultLandingMesh.userData.surfaceRoot||player.vaultLandingMesh;
    if(!ignoreA)ignoreA=obstacle;
    if(!ignoreB)ignoreB=landing;
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
  const directVault=player.vaultKind==='low'||player.vaultKind==='quick';
  const directVaultRecovery=player.mode==='ground'&&player.vaultRecovery>0&&directVault;
  if((player.mode==='vault'&&directVault)||directVaultRecovery){
    const obstacle=player.vaultObstacle&&player.vaultObstacle.userData&&
      player.vaultObstacle.userData.surfaceRoot||player.vaultObstacle;
    const landing=player.vaultLandingMesh&&player.vaultLandingMesh.userData&&
      player.vaultLandingMesh.userData.surfaceRoot||player.vaultLandingMesh;
    return !!mesh&&colliderMatchesSurface(mesh,obstacle,landing);
  }
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
  for(const i of nearbyClimbHoldIndices(p,maxD,mesh)){
    const h=HOLDS[i];
    if(!holdSurfaceIsLive(h))continue;
    const d=h.pos.distanceTo(p)+Math.abs(h.pos.y-chestY)*0.4;
    if(d<bd){bd=d;best=i;}
  }
  return best;
}

/* At contact distance a voxel face centre can sit half a cell to one side of
   the camera ray even though the face itself is directly ahead. Keep a modest
   forward cone here; the stricter surface-normal test below still prevents a
   grab around the back of an edge. */
const CLIMB_CAMERA_HOLD_DOT=0.62;
const CLIMB_CAMERA_SURFACE_DOT=0.68;
const CLIMB_CROSSHAIR_LATERAL_LIMIT=0.42;
const QUICK_CLIMB_CROSSHAIR_LIP_DROP=0.9;
function sampleTraversalCrosshair(maxPlayerDistance){
  traversalAimObject=null;
  camera.updateMatrixWorld(true);
  camera.getWorldDirection(traversalAimDirection).normalize();
  traversalAimOrigin.copy(camera.position);
  traversalAimChest.set(player.pos.x,player.pos.y+1.25,player.pos.z);
  const far=traversalAimOrigin.distanceTo(traversalAimChest)+
    maxPlayerDistance+0.8;
  rc.set(traversalAimOrigin,traversalAimDirection);rc.far=far;rc.near=0.02;
  traversalAimMeshCandidates.length=0;
  traversalAimVoxelMeshes.clear();
  for(const mesh of getCameraOccluderCandidates(
    traversalAimOrigin,traversalAimDirection,far)){
    if(mesh&&mesh.userData&&mesh.userData.kind==='voxelField')
      traversalAimVoxelMeshes.add(mesh);
    else traversalAimMeshCandidates.push(mesh);
  }
  /* Instanced voxel fields can contain thousands of cells. Their active cells
     already live in the local static-box grid, so intersect those nearby exact
     cell bounds instead of asking InstancedMesh.raycast to scan the whole rock. */
  const hits=rc.intersectObjects(traversalAimMeshCandidates,false);
  let bestDistance=hits.length?hits[0].distance:far+1;
  if(hits.length){
    traversalAimObject=hits[0].object;
    traversalAimPoint.copy(hits[0].point);
  }
  traversalAimRayEnd.copy(traversalAimOrigin)
    .addScaledVector(traversalAimDirection,far);
  traversalAimRayBounds.minX=Math.min(traversalAimOrigin.x,traversalAimRayEnd.x)-0.02;
  traversalAimRayBounds.maxX=Math.max(traversalAimOrigin.x,traversalAimRayEnd.x)+0.02;
  traversalAimRayBounds.minZ=Math.min(traversalAimOrigin.z,traversalAimRayEnd.z)-0.02;
  traversalAimRayBounds.maxZ=Math.max(traversalAimOrigin.z,traversalAimRayEnd.z)+0.02;
  for(const box of getStaticBoxCandidates(traversalAimRayBounds)){
    if(!traversalAimVoxelMeshes.has(box.owner))continue;
    const point=rc.ray.intersectBox(box,traversalAimBoxPoint);
    if(!point)continue;
    const distance=point.distanceTo(traversalAimOrigin);
    if(distance<rc.near||distance>far||distance>=bestDistance)continue;
    bestDistance=distance;
    traversalAimObject=box.owner;
    traversalAimPoint.copy(point);
  }
  if(!traversalAimObject)return false;
  /* The first visible solid under the reticle owns traversal intent. Do not ray
     through it to a convenient climb proxy behind or beside the player's path. */
  const flat=Math.hypot(traversalAimPoint.x-player.pos.x,
    traversalAimPoint.z-player.pos.z);
  const vertical=traversalAimPoint.y-traversalAimChest.y;
  if(flat>maxPlayerDistance||vertical<-2.1||vertical>2.5)return false;
  return true;
}
function traversalCrosshairMatchesSurface(mesh,maxPlayerDistance){
  if(!sampleTraversalCrosshair(maxPlayerDistance))return false;
  const surface=mesh&&mesh.userData&&mesh.userData.surfaceRoot||mesh;
  return colliderMatchesSurface(traversalAimObject,surface,null);
}
function traversalCrosshairMatchesQuickSurface(mesh,maxPlayerDistance,contact){
  const directHit=sampleTraversalCrosshair(maxPlayerDistance);
  const surface=mesh&&mesh.userData&&mesh.userData.surfaceRoot||mesh;
  if(directHit)return colliderMatchesSurface(traversalAimObject,surface,null);
  /* A short ledge may sit just below the reticle even when it is horizontally
     centered. Follow the camera ray to the contacted depth and probe only
     downward through that exact screen-space column. This preserves reverse-
     ramp pull-ups without widening acquisition toward either shoulder. */
  if(traversalAimObject||!contact)return false;
  const horizontalLengthSq=traversalAimDirection.x*traversalAimDirection.x+
    traversalAimDirection.z*traversalAimDirection.z;
  if(horizontalLengthSq<0.01)return false;
  traversalAimDelta.subVectors(contact,traversalAimOrigin);
  const along=(traversalAimDelta.x*traversalAimDirection.x+
    traversalAimDelta.z*traversalAimDirection.z)/horizontalLengthSq;
  if(along<0)return false;
  /* Step a few centimetres past the vertical face so the downward ray samples
     the upper surface instead of landing exactly on a voxel/triangle seam. */
  traversalAimPoint.copy(traversalAimOrigin)
    .addScaledVector(traversalAimDirection,along+0.1);
  return lowVaultProbeDown(traversalAimPoint.x,traversalAimPoint.z,
    traversalAimPoint.y+0.08,QUICK_CLIMB_CROSSHAIR_LIP_DROP,
    surface,NaN,0,false);
}
function cameraFacesClimbHold(h,origin){
  if(!h)return false;
  origin=origin||player.pos;
  climbCameraForward.set(-Math.sin(camYaw),0,-Math.cos(camYaw));
  climbCameraToHold.set(h.pos.x-origin.x,0,h.pos.z-origin.z);
  const flat=climbCameraToHold.length();
  if(flat>0.12){
    climbCameraToHold.multiplyScalar(1/flat);
    if(climbCameraForward.dot(climbCameraToHold)<CLIMB_CAMERA_HOLD_DOT)return false;
  }
  climbCameraSurface.copy(h.out).setY(0);
  if(climbCameraSurface.lengthSq()<0.04)return false;
  climbCameraSurface.normalize();
  return climbCameraForward.dot(climbCameraSurface)<=-CLIMB_CAMERA_SURFACE_DOT;
}

const CLIMB_GRAB_EXACT_BUDGET=4;
const CLIMB_GRAB_RETRY_MS=100;
const climbGrabCandidateScores=new Map(),climbGrabCandidateIndices=[];
const climbGrabRayMeshesSeen=new Set(),climbGrabProxyCandidates=[];
let climbGrabRetryAt=0;
function queueClimbGrabCandidate(index,score){
  const previous=climbGrabCandidateScores.get(index);
  if(previous!==undefined){
    if(score<previous)climbGrabCandidateScores.set(index,score);
    return;
  }
  climbGrabCandidateScores.set(index,score);
  climbGrabCandidateIndices.push(index);
}

function tryGrab(air,allowDescent=false){
  if(player.cool>0||player.grace>0)return;
  const grabNow=performance.now();
  if(grabNow<climbGrabRetryAt)return;
  climbCameraForward.set(-Math.sin(camYaw),0,-Math.cos(camYaw));
  climbGrabOrigin.set(player.pos.x,player.pos.y+1.25,player.pos.z);
  climbGrabSide.crossVectors(UP,climbCameraForward);
  if(climbGrabSide.lengthSq()<0.001)climbGrabSide.set(1,0,0);
  else climbGrabSide.normalize();
  const candidateReach=air?2.45:2.05;
  const crosshairRequired=!allowDescent;
  if(crosshairRequired&&!sampleTraversalCrosshair(candidateReach+0.35)){
    climbGrabRetryAt=grabNow+CLIMB_GRAB_RETRY_MS;
    return;
  }
  let polished=false;
  let gripHit=false,linkedHold=false,reachRejected=false;
  let blocked=false,bestHold=-1;
  climbGrabCandidateScores.clear();
  climbGrabCandidateIndices.length=0;
  climbGrabRayMeshesSeen.clear();
  /* The hold hash is already the most selective broadphase. Prefer it before
     any triangle ray: voxel-rock holds are exact physical faces, and scanning
     a 2,000-instance rock merely to rediscover those nearby nodes caused the
     contact hitch this query is meant to prevent. */
  climbGrabOrigin.set(player.pos.x,player.pos.y+1.25,player.pos.z);
  for(const i of nearbyClimbHoldIndices(climbGrabOrigin,candidateReach)){
    const h=HOLDS[i];
    if(!holdSurfaceIsLive(h))continue;
    if(crosshairRequired){
      const root=holdSurfaceRoot(h);
      if(!colliderMatchesSurface(traversalAimObject,root,null))continue;
      traversalAimDelta.subVectors(h.pos,traversalAimPoint);
      if(Math.abs(traversalAimDelta.dot(climbGrabSide))>
         CLIMB_CROSSHAIR_LATERAL_LIMIT)continue;
    }
    climbGrabCandidate.subVectors(h.pos,climbGrabOrigin);
    const vertical=climbGrabCandidate.y;
    const flat=Math.hypot(climbGrabCandidate.x,climbGrabCandidate.z);
    const distance=Math.hypot(flat,vertical);
    if(distance>candidateReach||flat<0.18||vertical<-1.65||vertical>1.8)continue;
    climbGrabCandidateDir.set(climbGrabCandidate.x,0,climbGrabCandidate.z).normalize();
    const facing=climbCameraForward.dot(climbGrabCandidateDir);
    if(facing<CLIMB_CAMERA_HOLD_DOT||
       !cameraFacesClimbHold(h,climbGrabOrigin))continue;
    gripHit=true;linkedHold=true;
    queueClimbGrabCandidate(i,distance+(1-facing)*0.8+Math.abs(vertical)*0.16);
  }
  if(!climbGrabCandidateIndices.length&&!crosshairRequired){
    /* Sparse and polished surfaces still need an exact hit for useful feedback.
       Restrict the shoulder fan to proxy meshes in this short ray corridor;
       hidden fracture proxies with nearby holds were already handled above. */
    for(let fan=0;fan<3;fan++){
      const offset=fan===0?-0.22:(fan===1?0:0.22);
      climbGrabOrigin.set(player.pos.x,player.pos.y+1.25,player.pos.z)
        .addScaledVector(climbGrabSide,offset);
      climbGrabRay.copy(climbCameraForward).addScaledVector(climbGrabSide,offset*0.12).normalize();
      rc.set(climbGrabOrigin,climbGrabRay);rc.far=air?2.1:1.6;rc.near=0.01;
      climbGrabProxyCandidates.length=0;
      for(const mesh of getCameraOccluderCandidates(climbGrabOrigin,climbGrabRay,rc.far))
        if(proxyByMesh.has(mesh))climbGrabProxyCandidates.push(mesh);
      const hits=rc.intersectObjects(climbGrabProxyCandidates,false);
      for(const hit of hits){
        const pr=proxyByMesh.get(hit.object);
        if(!pr)continue;
        if(!pr.grip){polished=true;continue;}
        gripHit=true;
        if(climbGrabRayMeshesSeen.has(hit.object))continue;
        climbGrabRayMeshesSeen.add(hit.object);
        for(const i of nearbyClimbHoldIndices(hit.point,3.0,hit.object)){
          const h=HOLDS[i];
          if(!holdSurfaceIsLive(h)||!cameraFacesClimbHold(h,climbGrabOrigin))continue;
          const distance=h.pos.distanceTo(hit.point)+Math.abs(h.pos.y-climbGrabOrigin.y)*0.4;
          if(distance>=3.0)continue;
          linkedHold=true;
          queueClimbGrabCandidate(i,hit.distance+distance*0.12+0.18);
        }
      }
    }
  }
  climbGrabCandidateIndices.sort((a,b)=>
    climbGrabCandidateScores.get(a)-climbGrabCandidateScores.get(b));
  let exactChecks=0;
  for(const i of climbGrabCandidateIndices){
    const h=HOLDS[i];
    /* Do not enter a hang when the ground or a nearby platform leaves less
       than one arm-span between the candidate root and the grip. */
    hangPos(i,climbPathToPos);
    /* Normal Shift+W is ascent-only. A roof runner can pass within reach of a
       lower hold after leaving the edge; accepting that hold here is what
       pulled the player back toward the building. Only the dedicated descent
       action may choose a hang root below the current feet. */
    if(!allowDescent&&climbPathToPos.y<player.pos.y-(air?0:0.08))continue;
    if(!climbPoseReachable(i,climbPathToPos)){
      reachRejected=true;
      continue;
    }
    /* Cheap direction/reach rejection must not consume the swept-clearance
       budget. From atop a prop, several closer holds can be below the player's
       feet; counting those used to hide the valid airborne-level hold above. */
    if(exactChecks++>=CLIMB_GRAB_EXACT_BUDGET)break;
    if(!climbAttachClearance(h,player.pos,climbPathToPos)){
      blocked=true;
      continue;
    }
    bestHold=i;
    break;
  }
  if(bestHold>=0){
    if(allowDescent)climbDownIntentUntil=0;
    climbGrabRetryAt=0;
    player.landingSurface=null;
    player.onGround=false;
    player.jumpClimbActive=false;
    player.mode='attach';player.moveTo=bestHold;
    player.attachFrom.copy(player.pos);player.attachT=0;
    climbPhase=0;climbStepParity=0;
    player.vel.set(0,0,0);
    return;
  }
  /* Failed exact checks are stable for several frames while the capsule is
     pressed against the same face. A short retry interval prevents held
     Shift+W from rerunning the expensive rock sweep at render frequency, yet
     still reacts promptly when the player slides to a new hold. */
  climbGrabRetryAt=grabNow+CLIMB_GRAB_RETRY_MS;
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
  if(h.voxelSurface){
    /* A voxel rock tapers as a staircase. Local top faces belong to the wall
       being traversed, not to the floor under a hanging pose; clamping onto
       each terrace lifts the shoulders above their hands and makes the next
       tier unreachable. Only the authored world floor limits the first hold. */
    out.y=Math.max(0,out.y);
    keepClimbBodyClear(out,h);
    return out;
  }
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
const vaultPathNormal=V(),vaultPathSample=V(),vaultTargetExpected=V();
const vaultTargetFlat=V(),vaultTargetSide=V();
const vaultDesiredPos=V(),vaultMotionFrom=V(),vaultMotionDelta=V();
const vaultExitVelocity=V();
const lowVaultForward=V(),lowVaultProbeSide=V(),lowVaultProbeOrigin=V(),lowVaultProbePoint=V();
const lowVaultProbeNormal=V(0,1,0),lowVaultFrontPoint=V(),lowVaultTopPoint=V();
const lowVaultTopNormal=V(0,1,0),lowVaultLandingPoint=V(),lowVaultLandingNormal=V(0,1,0);
let lowVaultProbeMesh=null;
const LOW_VAULT_MIN_HEIGHT=PLAYER_STEP_HEIGHT+0.055;
const LOW_VAULT_MAX_HEIGHT=1.32;
const LOW_VAULT_MAX_DEPTH=1.55;
const LOW_VAULT_DEPTH_STEP=0.12;
const LOW_VAULT_PROBE_SIDE_OFFSETS=[0,0.055,-0.055,0.11,-0.11];
const lowVaultActionDir=V();
/* Space uses a prompted direct pull-up between low-cover traversal and the full
   handhold graph. This range deliberately overlaps the vault range: the action
   tries a through-vault first, then lands on top when the object is too deep or
   clustered to cross. The upper limit follows standing shoulder + arm reach. */
const QUICK_CLIMB_MIN_HEIGHT=LOW_VAULT_MIN_HEIGHT;
const QUICK_CLIMB_MAX_HEIGHT=2.15;
const QUICK_CLIMB_LOOK_AHEAD=0.96;
const QUICK_CLIMB_PLANT_PHASE=0.14;
const QUICK_CLIMB_APPROACH_END=0.24;
const QUICK_CLIMB_STANCE_GAP=0.39;
const QUICK_CLIMB_LIFT_PORTION=0.82;
/* Probe from hand height down to the waist. A thin ramp approached from its
   raised end has empty space at waist height, so a single low ray passes under
   the lip even though the edge is comfortably reachable. */
const QUICK_CLIMB_EDGE_HEIGHTS=[2.0,1.76,1.52,1.28,1.04,0.8,0.58];
const QUICK_CLIMB_EDGE_SIDE_OFFSETS=[0,0.045,-0.045,0.09,-0.09];
const QUICK_CLIMB_LANDING_DEPTHS=[0.42,0.54,0.68,0.84,1.02];
const QUICK_CLIMB_FOOTPRINT=[
  [-0.2,0],[0.2,0],[0,-0.22],[0,0.22],
  [-0.16,-0.18],[-0.16,0.18],[0.16,-0.18],[0.16,0.18]
];
const QUICK_CLIMB_SEAM_OFFSETS=[[0,0],[0.045,0],[-0.045,0],[0,0.045],[0,-0.045]];
const quickClimbForward=V(),quickClimbSide=V(),quickClimbWallNormal=V();
const quickClimbSamplePoint=V(),quickClimbShoulder=V(),quickClimbHand=V();
const quickClimbLandingCenter=V(),quickClimbLandingPoint=V(),quickClimbLandingNormal=V(0,1,0);
const quickClimbContactPoint=V(),quickClimbTopPoint=V(),quickClimbTopNormal=V(0,1,0);
const quickClimbTarget={
  obstacle:null,landingMesh:null,height:0,depth:0,clearance:0,push:0,forwardStart:0
};
let quickClimbPathBlocked=false;
const climbDesiredPos=V(),climbMotionFrom=V(),climbMotionDelta=V();
const climbGrabOrigin=V(),climbGrabSide=V(),climbGrabRay=V(),climbGrabCandidate=V(),climbGrabCandidateDir=V();
const traversalAimOrigin=V(),traversalAimDirection=V(),traversalAimPoint=V(),
  traversalAimChest=V(),traversalAimDelta=V(),traversalAimRayEnd=V(),
  traversalAimBoxPoint=V();
const traversalAimMeshCandidates=[],traversalAimVoxelMeshes=new Set();
const traversalAimRayBounds={minX:0,maxX:0,minZ:0,maxZ:0};
let traversalAimObject=null;
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
  holdSurfaceAnchor(h,climbSurfacePoint,climbSurfaceNormal);
  const rootData=root.userData;
  if(h.voxelSurface&&rootData&&rootData.kind==='voxelField'){
    /* During traversal this field is already excluded from capsule collision.
       Enforce the contacted face plane, not every lower terrace in the same
       rock. Resolving the full vertical capsule against a protruding step
       pushes the hips outward while the hands target the recessed next tier,
       creating an impossible arm span at every taper. The transfer's outward
       arc carries the lower body over that step; unrelated geometry remains
       fully collision-tested by resolveColliders. */
    climbBodyNormal.copy(climbSurfaceNormal).setY(0);
    if(climbBodyNormal.lengthSq()>0.04){
      climbBodyNormal.normalize();
      climbBodyCorrection.subVectors(pos,climbSurfacePoint);
      const gap=climbBodyCorrection.dot(climbBodyNormal);
      if(gap<0.48)pos.addScaledVector(climbBodyNormal,0.48-gap);
    }
    return pos;
  }
  const targets=climbBodySurfaceMeshes(h);
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

/* The standing player collider begins just above the root, and the mantle rig
   never draws a boot below it. Keep a small extra gap over the sampled lip so
   neither the capsule nor the rendered feet can cut through its top edge. */
const MANTLE_LIP_ROOT_CLEARANCE=0.04;
function mantleForwardStart(from,to,clearance,lipY){
  const requiredY=(Number.isFinite(lipY)?lipY:to.y-0.02)+MANTLE_LIP_ROOT_CLEARANCE;
  /* Find the first point on the existing vertical arc that is genuinely above
     the lip. One extra sample is deliberate: fixed-step interpolation between
     the last lift-only frame and the first forward frame then stays clear too. */
  const samples=128;
  for(let i=1;i<samples;i++){
    const t=i/samples,s=smooth5(t);
    const y=lerp(from.y,to.y,s)+4*t*(1-t)*clearance;
    if(y>=requiredY)return Math.min(0.9,(i+1)/samples);
  }
  return -1;
}
function vaultPathPoint(from,to,t,clearance,push,normal,forwardStart,linear,out){
  const verticalS=linear?t:smooth5(t);
  let forwardS=t;
  if(!linear){
    const phase=Math.max(0,Math.min(1,
      (t-forwardStart)/Math.max(0.001,1-forwardStart)));
    forwardS=smooth5(phase);
  }
  out.set(
    lerp(from.x,to.x,forwardS),
    lerp(from.y,to.y,verticalS)+4*t*(1-t)*clearance,
    lerp(from.z,to.z,forwardS)
  );
  /* A handhold mantle applies its inward flourish only during actual forward
     travel. The former time-based push entered the wall while the body was
     still below the top, which was the visible corner/edge clipping. */
  const pushPhase=linear?t:forwardS;
  out.addScaledVector(normal,-Math.sin(pushPhase*Math.PI)*push);
  return out;
}
function quickClimbMotionProgress(t){
  return Math.max(0,Math.min(1,
    (t-QUICK_CLIMB_PLANT_PHASE)/(1-QUICK_CLIMB_PLANT_PHASE)));
}
function quickClimbVerticalY(fromY,toY,t,clearance){
  const motionT=quickClimbMotionProgress(t);
  /* Finish the powered lift before the complete action ends. The remaining
     time belongs to moving the hips across the lip and settling the feet; using
     the whole duration for lift compressed all forward travel into the final
     few frames. */
  const liftT=Math.max(0,Math.min(1,motionT/QUICK_CLIMB_LIFT_PORTION));
  const verticalS=smooth5(liftT);
  /* A squared bell curve has zero velocity at both endpoints. The old
     parabola started the root upward at full speed and stopped it abruptly on
     the landing, which made the pull-up read as scripted translation. */
  const oneMinus=1-motionT;
  const liftArc=16*motionT*motionT*oneMinus*oneMinus;
  return lerp(fromY,toY,verticalS)+liftArc*clearance;
}
function quickClimbForwardStart(from,to,clearance,lipY){
  const requiredY=(Number.isFinite(lipY)?lipY:to.y-0.02)+MANTLE_LIP_ROOT_CLEARANCE;
  const samples=128;
  for(let i=1;i<samples;i++){
    const t=i/samples;
    if(quickClimbVerticalY(from.y,to.y,t,clearance)>=requiredY)
      return Math.min(0.9,(i+1)/samples);
  }
  return -1;
}
function quickClimbPathPoint(from,to,t,clearance,push,normal,forwardStart,
  contact,out){
  const approach=smooth5(Math.max(0,Math.min(1,t/QUICK_CLIMB_APPROACH_END)));
  const stanceX=contact.x+normal.x*QUICK_CLIMB_STANCE_GAP;
  const stanceZ=contact.z+normal.z*QUICK_CLIMB_STANCE_GAP;
  const forwardPhase=Math.max(0,Math.min(1,
    (t-forwardStart)/Math.max(0.001,1-forwardStart)));
  const forwardS=smooth5(forwardPhase);
  let x=lerp(from.x,stanceX,approach);
  let z=lerp(from.z,stanceZ,approach);
  if(forwardPhase>0){
    x=lerp(stanceX,to.x,forwardS);
    z=lerp(stanceZ,to.z,forwardS);
  }
  const motionT=quickClimbMotionProgress(t),oneMinus=1-motionT;
  const weightLoad=16*motionT*motionT*oneMinus*oneMinus;
  out.set(x,quickClimbVerticalY(from.y,to.y,t,clearance),z);
  /* Keep the hips a fraction outside the edge while the hands take the load.
     The offset fades before touchdown and never changes the landing point. */
  out.addScaledVector(normal,weightLoad*push);
  return out;
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
    for(const box of getStaticBoxCandidatesAt(climbPathSample)){
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
    for(const box of getStaticBoxCandidatesAt(climbPathSample)){
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
function vaultPathClearance(h,from,to,clearance,push,forwardStart){
  holdSurfaceAnchor(h,climbSurfacePoint,climbSurfaceNormal);
  vaultPathNormal.copy(climbSurfaceNormal).setY(0);
  if(vaultPathNormal.lengthSq()<1e-4)vaultPathNormal.set(0,0,1);
  else vaultPathNormal.normalize();
  /* Sample more densely than the render frame rate so a thin railing or a
     freshly settled shard cannot be skipped between the start and landing. */
  const vaultRoot=holdSurfaceRoot(h);
  for(let i=1;i<=18;i++){
    const t=i/18;
    vaultPathPoint(from,to,t,clearance,push,vaultPathNormal,
      forwardStart,false,vaultPathSample);
    for(const box of getStaticBoxCandidatesAt(vaultPathSample)){
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

function lowVaultSurfaceRoot(mesh){
  return mesh&&mesh.userData&&mesh.userData.surfaceRoot||mesh||null;
}
function lowVaultSameSurface(mesh,surface){
  return !!mesh&&!!surface&&colliderMatchesSurface(mesh,surface,null);
}
function lowVaultSurfaceStable(mesh){
  if(!surfaceObjectIsLive(mesh))return false;
  const ud=mesh.userData||{};
  /* A body that can translate underneath the player is not a vault. Frozen
     fracture pieces are safe to use, but active chunks and detached voxel
     islands must finish settling before traversal can depend on them. */
  if(ud.voxelChunk||ud.kind==='voxelChunk')return false;
  if(ud.released&&!ud.sleeping&&!ud.staticFragment)return false;
  return true;
}
function lowVaultProbeDown(x,z,fromY,far,requiredSurface,expectedY,tolerance,requireStandable){
  lowVaultProbeOrigin.set(x,fromY,z);
  rc.set(lowVaultProbeOrigin,DOWN);rc.far=far;rc.near=0.001;
  const hits=rc.intersectObjects(
    getCameraOccluderCandidates(lowVaultProbeOrigin,DOWN,far),false);
  lowVaultProbeMesh=null;
  for(const hit of hits){
    if(!hit.face)continue;
    const normal=wn(hit,hit.object,worldNormalScratch);
    if(normal.y<=0.62)continue;
    if(requiredSurface&&!lowVaultSameSurface(hit.object,requiredSurface))continue;
    if(Number.isFinite(expectedY)&&Math.abs(hit.point.y-expectedY)>tolerance)continue;
    if(!lowVaultSurfaceStable(hit.object))continue;
    if(requireStandable&&
       (standables.indexOf(hit.object)<0||!mantleHitHasOpenColumn(hit)))continue;
    lowVaultProbePoint.copy(hit.point);
    lowVaultProbeNormal.copy(normal).normalize();
    lowVaultProbeMesh=hit.object;
    return true;
  }
  return false;
}
function lowVaultLandingAt(x,z,fromY,far,obstacleSurface){
  lowVaultProbeOrigin.set(x,fromY,z);
  rc.set(lowVaultProbeOrigin,DOWN);rc.far=far;rc.near=0.001;
  const hits=rc.intersectObjects(
    getCameraOccluderCandidates(lowVaultProbeOrigin,DOWN,far),false);
  lowVaultProbeMesh=null;
  for(const hit of hits){
    if(!hit.face)continue;
    const normal=wn(hit,hit.object,worldNormalScratch);
    if(normal.y<=0.62)continue;
    /* The first physical top under the landing footprint owns the result. Do
       not ray through an unsafe moving/high surface and silently choose the
       ground below it. */
    if(lowVaultSameSurface(hit.object,obstacleSurface)||
       !lowVaultSurfaceStable(hit.object))return false;
    lowVaultProbePoint.copy(hit.point);
    lowVaultProbeNormal.copy(normal).normalize();
    lowVaultProbeMesh=hit.object;
    return true;
  }
  return false;
}
function lowVaultPathClearance(from,to,clearance,push,obstacle,landing){
  const obstacleRoot=lowVaultSurfaceRoot(obstacle);
  const landingRoot=lowVaultSurfaceRoot(landing);
  vaultPathNormal.copy(lowVaultForward).negate();
  /* Low vaults use linear forward progress so the root never pauses at either
     end. The vertical arc represents a tucked pelvis; the validated obstacle
     is intentionally allowed beneath it while every unrelated collider still
     tests against the full player volume. */
  for(let i=1;i<=18;i++){
    const t=i/18;
    vaultPathPoint(from,to,t,clearance,push,vaultPathNormal,
      0,true,vaultPathSample);
    for(const box of getStaticBoxCandidatesAt(vaultPathSample)){
      if(box.active===false)continue;
      if(settledBoxSet.has(box)||
         colliderMatchesSurface(box.owner,obstacleRoot,landingRoot))continue;
      if(playerOverlapsBox(vaultPathSample,box))return false;
    }
    for(const cyl of cyls){
      if(colliderMatchesSurface(cyl.mesh,obstacleRoot,landingRoot))continue;
      if(playerOverlapsCylinder(vaultPathSample,cyl))return false;
    }
    for(const c of chunks){
      if(colliderMatchesSurface(c,obstacleRoot,landingRoot))continue;
      if(playerOverlapsChunk(vaultPathSample,c.userData))return false;
    }
    for(const c of settledFragments){
      if(colliderMatchesSurface(c,obstacleRoot,landingRoot))continue;
      if(playerOverlapsChunk(vaultPathSample,c.userData))return false;
    }
  }
  return true;
}

function quickClimbSupportInRange(center,minY,maxY,requiredSurface){
  const probeY=maxY+0.72;
  const probeFar=Math.max(1.08,probeY-minY+0.08);
  for(const offset of QUICK_CLIMB_SEAM_OFFSETS){
    quickClimbSamplePoint.copy(center)
      .addScaledVector(quickClimbForward,offset[0])
      .addScaledVector(quickClimbSide,offset[1]);
    if(lowVaultProbeDown(quickClimbSamplePoint.x,quickClimbSamplePoint.z,
      probeY,probeFar,requiredSurface,NaN,0,true)&&
      lowVaultProbePoint.y>=minY&&lowVaultProbePoint.y<=maxY)return true;
  }
  return false;
}

function quickClimbPoseReachable(contact,wallNormal){
  quickClimbSide.crossVectors(UP,wallNormal);
  if(quickClimbSide.lengthSq()<0.04)quickClimbSide.set(1,0,0);
  else quickClimbSide.normalize();
  for(const sideSign of[-1,1]){
    quickClimbShoulder.copy(player.pos).addScaledVector(UP,1.51)
      .addScaledVector(wallNormal,CLIMB_SHOULDER_OFFSET)
      .addScaledVector(quickClimbSide,sideSign*0.31);
    quickClimbHand.copy(contact).addScaledVector(wallNormal,0.12)
      .addScaledVector(UP,0.02)
      .addScaledVector(quickClimbSide,sideSign*0.2);
    /* A standing reach can extend slightly farther than a sustained hang, but
       retain a safety margin inside the rendered two-bone arm chain. */
    if(quickClimbShoulder.distanceTo(quickClimbHand)>CLIMB_ARM_REACH+0.06)return false;
  }
  return true;
}

function quickClimbLandingClear(target){
  for(const box of getStaticBoxCandidatesAt(target)){
    if(box.active===false)continue;
    if(playerOverlapsBox(target,box))return false;
  }
  for(const cyl of cyls)if(playerOverlapsCylinder(target,cyl))return false;
  for(const c of chunks)if(playerOverlapsChunk(target,c.userData))return false;
  for(const c of settledFragments)if(playerOverlapsChunk(target,c.userData))return false;
  return true;
}

function quickClimbPathClearance(from,to,clearance,push,forwardStart){
  /* The root remains outside the wall until its feet are above the lip, so the
     obstacle can participate in this sweep like every other collider. This is
     stricter than simply ignoring the intended landing object and catches an
     overhang or second tier occupying the pull-up corridor. */
  for(let i=1;i<=18;i++){
    const t=i/18;
    quickClimbPathPoint(from,to,t,clearance,push,quickClimbWallNormal,
      forwardStart,quickClimbContactPoint,vaultPathSample);
    for(const box of getStaticBoxCandidatesAt(vaultPathSample)){
      if(box.active===false)continue;
      if(playerOverlapsBox(vaultPathSample,box))return false;
    }
    for(const cyl of cyls)if(playerOverlapsCylinder(vaultPathSample,cyl))return false;
    for(const c of chunks)if(playerOverlapsChunk(vaultPathSample,c.userData))return false;
    for(const c of settledFragments)
      if(playerOverlapsChunk(vaultPathSample,c.userData))return false;
  }
  return true;
}

function findQuickClimbTarget(dir,validatePath){
  quickClimbPathBlocked=false;
  const recoveringMantle=player.vaultRecovery>0&&player.vaultKind!=='low';
  if(player.mode!=='ground'||!player.onGround||player.cool>0||player.grace>0||
     recoveringMantle||dir.lengthSq()<0.01)return null;
  quickClimbForward.copy(dir).setY(0);
  if(quickClimbForward.lengthSq()<0.01)return null;
  quickClimbForward.normalize();
  quickClimbSide.crossVectors(UP,quickClimbForward);
  if(quickClimbSide.lengthSq()<0.04)quickClimbSide.set(1,0,0);
  else quickClimbSide.normalize();

  const baseY=player.pos.y;
  let obstacle=null,obstacleDistance=Infinity;
  /* Prefer the closest facing surface across the complete reachable edge.
     Small lateral offsets avoid aiming the only ray exactly through a voxel
     seam, which is common at the visual centre of these even-width ramps. */
  for(const height of QUICK_CLIMB_EDGE_HEIGHTS){
    for(const sideOffset of QUICK_CLIMB_EDGE_SIDE_OFFSETS){
      lowVaultProbeOrigin.copy(player.pos).addScaledVector(UP,height)
        .addScaledVector(quickClimbSide,sideOffset);
      rc.set(lowVaultProbeOrigin,quickClimbForward);
      rc.far=QUICK_CLIMB_LOOK_AHEAD;rc.near=0.02;
      const hits=rc.intersectObjects(getCameraOccluderCandidates(
        lowVaultProbeOrigin,quickClimbForward,QUICK_CLIMB_LOOK_AHEAD),false);
      for(const hit of hits){
        if(!hit.face||hit.object===ground||!lowVaultSurfaceStable(hit.object))continue;
        wn(hit,hit.object,worldNormalScratch);
        worldNormalScratch.setY(0);
        if(worldNormalScratch.lengthSq()<0.2)continue;
        worldNormalScratch.normalize();
        if(worldNormalScratch.dot(quickClimbForward)>-0.35)continue;
        if(hit.distance<obstacleDistance){
          obstacleDistance=hit.distance;
          obstacle=hit.object;
          lowVaultFrontPoint.copy(hit.point);
          quickClimbWallNormal.copy(worldNormalScratch);
        }
        break;
      }
    }
  }
  if(!obstacle)return null;
  /* Pull-ups use the same reticle contract as handhold grabs. The player-centre
     probe can pass beside the shoulder-offset crosshair in third person; only
     accept it when the actual centre-view ray hits this surface too. */
  if(!traversalCrosshairMatchesQuickSurface(obstacle,
    QUICK_CLIMB_LOOK_AHEAD+0.7,lowVaultFrontPoint))return null;
  const obstacleRoot=lowVaultSurfaceRoot(obstacle);

  /* Resolve the actual upper face just inside the contacted lip. Aggregate box
     height is not enough for broken voxel props or sloped authored geometry. */
  lowVaultProbePoint.copy(lowVaultFrontPoint).addScaledVector(quickClimbForward,0.075);
  const topProbeY=baseY+QUICK_CLIMB_MAX_HEIGHT+0.4;
  if(!lowVaultProbeDown(lowVaultProbePoint.x,lowVaultProbePoint.z,topProbeY,
    QUICK_CLIMB_MAX_HEIGHT+0.75,obstacleRoot,NaN,0,true))return null;
  quickClimbTopPoint.copy(lowVaultProbePoint);
  quickClimbTopNormal.copy(lowVaultProbeNormal);
  const obstacleHeight=quickClimbTopPoint.y-baseY;
  if(obstacleHeight<QUICK_CLIMB_MIN_HEIGHT||obstacleHeight>QUICK_CLIMB_MAX_HEIGHT)return null;

  quickClimbContactPoint.copy(quickClimbTopPoint);
  quickClimbContactPoint.x=lowVaultFrontPoint.x+quickClimbForward.x*0.055;
  quickClimbContactPoint.z=lowVaultFrontPoint.z+quickClimbForward.z*0.055;
  quickClimbContactPoint.y+=0.015;
  if(!quickClimbPoseReachable(quickClimbContactPoint,quickClimbWallNormal))return null;

  let landingMesh=null,landingDepth=0,foundLanding=false;
  for(const depth of QUICK_CLIMB_LANDING_DEPTHS){
    quickClimbLandingCenter.copy(lowVaultFrontPoint)
      .addScaledVector(quickClimbForward,depth);
    quickClimbLandingCenter.y=quickClimbTopPoint.y;
    /* Follow the real surface behind the lip. A ramp descends from its reverse
       edge, while a voxelized slope changes height one terrace at a time; both
       are valid landings even though neither stays level with the contacted lip. */
    if(!quickClimbSupportInRange(quickClimbLandingCenter,
      quickClimbTopPoint.y-0.72,quickClimbTopPoint.y+0.12,null))continue;
    quickClimbLandingPoint.copy(lowVaultProbePoint);
    quickClimbLandingNormal.copy(lowVaultProbeNormal);
    landingMesh=lowVaultProbeMesh;
    const landingSurfaceY=quickClimbLandingPoint.y;
    let footprintClear=true;
    for(const offset of QUICK_CLIMB_FOOTPRINT){
      quickClimbSamplePoint.copy(quickClimbLandingCenter)
        .addScaledVector(quickClimbForward,offset[0])
        .addScaledVector(quickClimbSide,offset[1]);
      if(!quickClimbSupportInRange(quickClimbSamplePoint,
        landingSurfaceY-0.42,landingSurfaceY+0.22,null)){
        footprintClear=false;
        break;
      }
    }
    if(!footprintClear)continue;
    /* Re-sample the center after the footprint fan so its exact mesh/normal own
       the landing state rather than whichever edge sample happened to run last. */
    if(!quickClimbSupportInRange(quickClimbLandingCenter,
      landingSurfaceY-0.08,landingSurfaceY+0.08,null))continue;
    quickClimbLandingPoint.copy(lowVaultProbePoint).addScaledVector(UP,0.02);
    quickClimbLandingNormal.copy(lowVaultProbeNormal);
    landingMesh=lowVaultProbeMesh;
    if(!quickClimbLandingClear(quickClimbLandingPoint))continue;
    landingDepth=depth;
    foundLanding=true;
    break;
  }
  if(!foundLanding||!landingMesh)return null;

  const heightBlend=Math.max(0,Math.min(1,
    (obstacleHeight-QUICK_CLIMB_MIN_HEIGHT)/
    (QUICK_CLIMB_MAX_HEIGHT-QUICK_CLIMB_MIN_HEIGHT)));
  /* Unlike a running vault, a pull-up should rise close to the wall and only
     crest the lip by a few tenths. A restrained arc reads as upper-body effort
     instead of launching the whole character above the platform. */
  const landingDrop=Math.max(0,quickClimbTopPoint.y-quickClimbLandingPoint.y);
  /* When the landing descends behind the edge, add enough lift to get the feet
     over the contacted lip before forward travel begins. */
  const clearance=0.26+heightBlend*0.08+Math.min(0.5,landingDrop*1.2);
  const push=0.045+heightBlend*0.025;
  const forwardStart=quickClimbForwardStart(player.pos,quickClimbLandingPoint,
    clearance,quickClimbTopPoint.y);
  if(forwardStart<0)return null;
  if(validatePath&&!quickClimbPathClearance(player.pos,quickClimbLandingPoint,
    clearance,push,forwardStart)){
    quickClimbPathBlocked=true;
    return null;
  }

  quickClimbTarget.obstacle=obstacle;
  quickClimbTarget.landingMesh=landingMesh;
  quickClimbTarget.height=obstacleHeight;
  quickClimbTarget.depth=landingDepth;
  quickClimbTarget.clearance=clearance;
  quickClimbTarget.push=push;
  quickClimbTarget.forwardStart=forwardStart;
  return quickClimbTarget;
}

function canPromptQuickClimb(dir){
  return !!findQuickClimbTarget(dir,false);
}

function tryQuickClimb(dir){
  const target=findQuickClimbTarget(dir,true);
  if(!target){
    if(quickClimbPathBlocked)flashHint('CLIMB BLOCKED — clear the landing',true);
    return false;
  }
  player.vaultLeadLeft=!player.vaultLeadLeft;
  player.vaultKind='quick';
  player.vaultObstacle=target.obstacle;
  player.vaultLandingMesh=target.landingMesh;
  player.vaultContactPoint.copy(quickClimbContactPoint);
  player.vaultContactNormal.copy(quickClimbTopNormal);
  player.vaultDirection.copy(quickClimbForward);
  player.vaultNormal.copy(quickClimbWallNormal);
  player.vaultLandingNormal.copy(quickClimbLandingNormal);
  player.vaultObstacleHeight=target.height;
  player.vaultObstacleDepth=target.depth;
  player.vaultEntrySpeed=Math.hypot(player.vel.x,player.vel.z);
  player.vaultFrom.copy(player.pos);
  player.vaultTo.copy(quickClimbLandingPoint);
  const heightBlend=Math.max(0,Math.min(1,
    (target.height-QUICK_CLIMB_MIN_HEIGHT)/
    (QUICK_CLIMB_MAX_HEIGHT-QUICK_CLIMB_MIN_HEIGHT)));
  /* Leave time for the hands to find the lip before the hips rise, then scale
     the pull for height. This remains a quick traversal action, but no longer
     compresses a full plant/pull/step-through into half a second. */
  player.vaultDuration=0.69+heightBlend*0.13;
  player.vaultClearance=target.clearance;
  player.vaultPush=target.push;
  player.vaultForwardStart=target.forwardStart;
  player.vaultT=0;
  player.vaultRecovery=0;
  player.vaultRecoveryDuration=0.22;
  player.mode='vault';
  player.hold=-1;player.moveFrom=-1;player.moveTo=-1;
  player.vel.set(0,0,0);player.onGround=false;
  player.landingSurface=null;player.climbBuffer=0;
  player.heading=Math.atan2(quickClimbForward.x,quickClimbForward.z);
  return true;
}

const lowVaultPromptRange={near:0,far:0};
function lowVaultXZRayInterval(minX,maxX,minZ,maxZ,dir,padding,maxDistance,out){
  let near=0,far=maxDistance;
  minX-=padding;maxX+=padding;minZ-=padding;maxZ+=padding;
  if(Math.abs(dir.x)<0.0001){
    if(player.pos.x<minX||player.pos.x>maxX)return false;
  }else{
    let a=(minX-player.pos.x)/dir.x,b=(maxX-player.pos.x)/dir.x;
    if(a>b){const swap=a;a=b;b=swap;}
    near=Math.max(near,a);far=Math.min(far,b);
    if(near>far)return false;
  }
  if(Math.abs(dir.z)<0.0001){
    if(player.pos.z<minZ||player.pos.z>maxZ)return false;
  }else{
    let a=(minZ-player.pos.z)/dir.z,b=(maxZ-player.pos.z)/dir.z;
    if(a>b){const swap=a;a=b;b=swap;}
    near=Math.max(near,a);far=Math.min(far,b);
    if(near>far)return false;
  }
  if(far<0||near>maxDistance)return false;
  out.near=Math.max(0,near);out.far=far;
  return out.far>=out.near;
}

function canPromptLowVault(dir){
  const recoveringMantle=player.vaultRecovery>0&&player.vaultKind!=='low';
  if(player.mode!=='ground'||!player.onGround||player.cool>0||player.grace>0||
     recoveringMantle||dir.lengthSq()<0.01)return false;
  lowVaultForward.copy(dir).setY(0);
  if(lowVaultForward.lengthSq()<0.01)return false;
  lowVaultForward.normalize();

  /* Find the first waist-level collision cell with a very small static-grid
     query. The authored surface owns the aggregate dimensions below, so a
     voxelized sandbag is classified as one cover object instead of hundreds
     of tiny, incomplete obstacles. */
  const lookAhead=1.08,corridorFar=LOW_VAULT_MAX_DEPTH+1.08;
  let candidates=getPlayerStaticBoxCandidates(lookAhead+0.45);
  let obstacleBox=null,obstacleRoot=null,obstacleNear=Infinity;
  for(const box of candidates){
    if(box.active===false||!box.owner||box.min.y>player.pos.y+0.42||
       box.max.y<player.pos.y+0.12)continue;
    if(!lowVaultXZRayInterval(box.min.x,box.max.x,box.min.z,box.max.z,
      lowVaultForward,0.08,lookAhead,lowVaultPromptRange)||
      lowVaultPromptRange.near>=obstacleNear)continue;
    obstacleBox=box;
    obstacleRoot=lowVaultSurfaceRoot(box.owner);
    obstacleNear=lowVaultPromptRange.near;
  }
  if(!obstacleBox||!obstacleRoot||!lowVaultSurfaceStable(obstacleRoot))return false;

  /* Voxel structures already cache their authored world bounds. Reading those
     scalars is constant-time even for the 35k-voxel scene; non-voxel cover
     falls back to the complete physics box that produced the near hit. */
  const obstacleData=obstacleRoot.userData||{};
  const obstacleStructure=obstacleData.voxelStructure;
  const obstacleMinX=obstacleStructure?obstacleStructure.origin.x:obstacleBox.min.x;
  const obstacleMaxX=obstacleStructure?
    obstacleStructure.origin.x+obstacleStructure.nx*obstacleStructure.sx:obstacleBox.max.x;
  const obstacleMinY=obstacleStructure?obstacleStructure.origin.y:obstacleBox.min.y;
  const obstacleMaxY=obstacleStructure?
    obstacleStructure.origin.y+obstacleStructure.ny*obstacleStructure.sy:obstacleBox.max.y;
  const obstacleMinZ=obstacleStructure?obstacleStructure.origin.z:obstacleBox.min.z;
  const obstacleMaxZ=obstacleStructure?
    obstacleStructure.origin.z+obstacleStructure.nz*obstacleStructure.sz:obstacleBox.max.z;
  const obstacleHeight=obstacleMaxY-player.pos.y;
  const sizeX=obstacleMaxX-obstacleMinX,sizeZ=obstacleMaxZ-obstacleMinZ;
  if(obstacleHeight<LOW_VAULT_MIN_HEIGHT||obstacleHeight>LOW_VAULT_MAX_HEIGHT||
     obstacleMinY>player.pos.y+0.34||
     (sizeX>LOW_VAULT_MAX_DEPTH*2&&sizeZ>LOW_VAULT_MAX_DEPTH*2)||
     !lowVaultXZRayInterval(obstacleMinX,obstacleMaxX,obstacleMinZ,obstacleMaxZ,
       lowVaultForward,0.035,corridorFar,lowVaultPromptRange))return false;
  const obstacleFar=lowVaultPromptRange.far;
  const depth=obstacleFar-obstacleNear;
  if(depth<0.12||depth>LOW_VAULT_MAX_DEPTH+0.2)return false;

  const landingDistance=obstacleFar+0.62;
  const landingX=player.pos.x+lowVaultForward.x*landingDistance;
  const landingZ=player.pos.z+lowVaultForward.z*landingDistance;
  candidates=getPlayerStaticBoxCandidates(landingDistance+0.55);
  for(const box of candidates){
    if(box.active===false||!box.owner||
       lowVaultSurfaceRoot(box.owner)===obstacleRoot)continue;
    const blocksBody=box.min.y<player.pos.y+1.58&&box.max.y>player.pos.y+0.18;
    if(blocksBody&&landingX>box.min.x-0.32&&landingX<box.max.x+0.32&&
       landingZ>box.min.z-0.32&&landingZ<box.max.z+0.32)return false;
    if(box.max.y>player.pos.y+1.32&&
       lowVaultXZRayInterval(box.min.x,box.max.x,box.min.z,box.max.z,
         lowVaultForward,0.24,Math.min(corridorFar,landingDistance+0.2),
         lowVaultPromptRange))return false;
  }
  return true;
}

function tryLowVault(dir,speed,targetSpeed){
  /* Space can be pressed with the capsule already touching low cover. Give the
     explicit action a bounded start assist; established movement still
     supplies its real speed and therefore keeps walk/sprint timing distinct. */
  const assistedSpeed=Math.max(speed,Math.min(targetSpeed||speed,8.8));
  const recoveringMantle=player.vaultRecovery>0&&player.vaultKind!=='low';
  if(player.mode!=='ground'||!player.onGround||dir.lengthSq()<0.01||assistedSpeed<4.2||
     player.cool>0||player.grace>0||recoveringMantle)return false;
  lowVaultForward.copy(dir).setY(0);
  if(lowVaultForward.lengthSq()<0.01)return false;
  lowVaultForward.normalize();
  const baseY=player.pos.y;
  const lookAhead=Math.max(0.78,Math.min(1.08,0.64+assistedSpeed*0.017));
  lowVaultProbeOrigin.copy(player.pos).addScaledVector(UP,0.34);
  rc.set(lowVaultProbeOrigin,lowVaultForward);rc.far=lookAhead;rc.near=0.02;
  const hits=rc.intersectObjects(
    getCameraOccluderCandidates(lowVaultProbeOrigin,lowVaultForward,lookAhead),false);
  let obstacle=null;
  for(const hit of hits){
    if(!hit.face||hit.object===ground||!lowVaultSurfaceStable(hit.object))continue;
    lowVaultProbeNormal.copy(wn(hit,hit.object,worldNormalScratch)).setY(0);
    if(lowVaultProbeNormal.lengthSq()<0.2)continue;
    lowVaultProbeNormal.normalize();
    if(lowVaultProbeNormal.dot(lowVaultForward)>-0.3)continue;
    obstacle=hit.object;
    lowVaultFrontPoint.copy(hit.point);
    break;
  }
  if(!obstacle)return false;
  const obstacleRoot=lowVaultSurfaceRoot(obstacle);
  const probeY=baseY+LOW_VAULT_MAX_HEIGHT+0.42;
  const probeFar=LOW_VAULT_MAX_HEIGHT+0.78;
  lowVaultProbeSide.set(-lowVaultForward.z,0,lowVaultForward.x);
  let probeSideOffset=0,foundTop=false;
  for(const sideOffset of LOW_VAULT_PROBE_SIDE_OFFSETS){
    lowVaultProbePoint.copy(lowVaultFrontPoint).addScaledVector(lowVaultForward,0.07)
      .addScaledVector(lowVaultProbeSide,sideOffset);
    if(!lowVaultProbeDown(lowVaultProbePoint.x,lowVaultProbePoint.z,probeY,probeFar,
      obstacleRoot,NaN,0))continue;
    probeSideOffset=sideOffset;
    foundTop=true;
    break;
  }
  if(!foundTop)return false;
  lowVaultTopPoint.copy(lowVaultProbePoint);
  lowVaultTopNormal.copy(lowVaultProbeNormal);
  const obstacleHeight=lowVaultTopPoint.y-baseY;
  if(obstacleHeight<LOW_VAULT_MIN_HEIGHT||obstacleHeight>LOW_VAULT_MAX_HEIGHT)return false;

  let lastSolid=0.07,edgeDepth=-1,depthMisses=0;
  for(let depth=0.07+LOW_VAULT_DEPTH_STEP;
      depth<=LOW_VAULT_MAX_DEPTH+LOW_VAULT_DEPTH_STEP;depth+=LOW_VAULT_DEPTH_STEP){
    lowVaultProbePoint.copy(lowVaultFrontPoint).addScaledVector(lowVaultForward,depth)
      .addScaledVector(lowVaultProbeSide,probeSideOffset);
    if(lowVaultProbeDown(lowVaultProbePoint.x,lowVaultProbePoint.z,probeY,probeFar,
      obstacleRoot,lowVaultTopPoint.y,0.24)){
      lastSolid=depth;
      depthMisses=0;
      continue;
    }
    /* Voxel instances intentionally leave a tiny visual bevel between cells.
       One downward ray can land in that seam, so require a second consecutive
       miss before declaring the obstacle finished. */
    depthMisses++;
    if(depthMisses>=2){
      edgeDepth=lastSolid+LOW_VAULT_DEPTH_STEP*0.5;
      break;
    }
  }
  /* A narrow hand/foot contact is still vaultable, but a surface that remains
     solid beyond this budget is a platform or building and must use climbing. */
  if(edgeDepth<0.15||edgeDepth>LOW_VAULT_MAX_DEPTH)return false;
  const landingDistance=edgeDepth+0.62;
  lowVaultProbePoint.copy(lowVaultFrontPoint).addScaledVector(lowVaultForward,landingDistance);
  const landingProbeY=Math.max(baseY,lowVaultTopPoint.y)+0.86;
  const landingProbeFar=landingProbeY-baseY+0.62;
  if(!lowVaultLandingAt(lowVaultProbePoint.x,lowVaultProbePoint.z,
    landingProbeY,landingProbeFar,obstacleRoot))return false;
  lowVaultLandingPoint.copy(lowVaultProbePoint);
  lowVaultLandingNormal.copy(lowVaultProbeNormal);
  const landingDelta=lowVaultLandingPoint.y-baseY;
  if(landingDelta<-0.42||landingDelta>0.36)return false;
  const heightBlend=Math.max(0,Math.min(1,
    (obstacleHeight-LOW_VAULT_MIN_HEIGHT)/(LOW_VAULT_MAX_HEIGHT-LOW_VAULT_MIN_HEIGHT)));
  const speedBlend=Math.max(0,Math.min(1,
    (assistedSpeed-PLAYER_WALK_SPEED)/
    Math.max(0.01,PLAYER_SPRINT_SPEED-PLAYER_WALK_SPEED)));
  const depthBlend=Math.max(0,Math.min(1,edgeDepth/LOW_VAULT_MAX_DEPTH));
  const clearance=0.48+heightBlend*0.2+speedBlend*0.055;
  const push=0.07+depthBlend*0.1;
  lowVaultLandingPoint.addScaledVector(UP,0.02);
  if(!lowVaultPathClearance(player.pos,lowVaultLandingPoint,clearance,push,
    obstacle,lowVaultProbeMesh))return false;

  player.vaultLeadLeft=!player.vaultLeadLeft;
  player.vaultKind='low';
  player.vaultObstacle=obstacle;
  player.vaultLandingMesh=lowVaultProbeMesh;
  player.vaultContactPoint.copy(lowVaultTopPoint).addScaledVector(lowVaultForward,
    Math.min(0.2,edgeDepth*0.32)).addScaledVector(lowVaultTopNormal,0.035);
  player.vaultContactNormal.copy(lowVaultTopNormal);
  player.vaultDirection.copy(lowVaultForward);
  player.vaultNormal.copy(lowVaultForward).negate();
  player.vaultLandingNormal.copy(lowVaultLandingNormal);
  player.vaultObstacleHeight=obstacleHeight;
  player.vaultObstacleDepth=edgeDepth;
  player.vaultEntrySpeed=assistedSpeed;
  player.vaultFrom.copy(player.pos);
  player.vaultTo.copy(lowVaultLandingPoint);
  player.vaultDuration=Math.max(0.3,Math.min(0.44,
    0.39-speedBlend*0.075+heightBlend*0.035+depthBlend*0.025));
  player.vaultClearance=clearance;
  player.vaultPush=push;
  player.vaultForwardStart=0;
  player.vaultT=0;
  player.vaultRecovery=0;
  player.vaultRecoveryDuration=0.18;
  player.mode='vault';
  player.hold=-1;player.moveFrom=-1;player.moveTo=-1;
  player.vel.set(0,0,0);player.onGround=false;
  player.landingSurface=null;player.climbBuffer=0;
  player.heading=Math.atan2(lowVaultForward.x,lowVaultForward.z);
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
  vaultTargetExpected.copy(h.vault);
  const previousLipOffset=Number.isFinite(h.vaultLipY)?
    h.vaultLipY-h.vault.y:-0.02;
  holdSurfaceAnchor(h,climbSurfacePoint,climbSurfaceNormal);
  mantleProbeAxes(climbSurfaceNormal,vaultTargetFlat,vaultTargetSide);
  const result=mantleDownHit(vaultTargetExpected,vaultTargetFlat,vaultTargetSide,
    MANTLE_LANDING_FOOTPRINT,vaultTargetExpected.y+0.92,1.9,(hit)=>{
      if(!surfaceObjectIsLive(hit.object))return false;
      if(hit.point.y<player.pos.y+0.38||
         Math.abs(hit.point.y-vaultTargetExpected.y)>0.45)return false;
      const dx=hit.point.x-vaultTargetExpected.x,dz=hit.point.z-vaultTargetExpected.z;
      if(dx*dx+dz*dz>0.72*0.72)return false;
      const hitRoot=hit.object.userData&&hit.object.userData.surfaceRoot||hit.object;
      const sameParent=structuralColliderParent(hitRoot)&&
        structuralColliderParent(hitRoot)===structuralColliderParent(previousRoot);
      return hitRoot===previousRoot||sameParent;
    });
  if(!result)return false;
  h.vault.copy(result.hit.point).addScaledVector(UP,0.02);
  h.vaultMesh=result.hit.object;
  h.vaultNormal.copy(result.normal).normalize();
  /* A moving structural cell carries its lip and landing together. Retain the
     measured height offset while the exact landing point is revalidated. */
  h.vaultLipY=h.vault.y+Math.max(-0.48,Math.min(0.48,previousLipOffset));
  return true;
}

function startVault(){
  const h=HOLDS[player.hold];
  if(!h||!h.vault||!holdSurfaceIsLive(h))return false;
  if(h.vaultMesh&&!surfaceObjectIsLive(h.vaultMesh)){
    /* A stored mantle target can outlive a destructible landing surface. Do not
       reuse that stale point and drive the player through newly missing rubble. */
    h.vault=null;h.vaultMesh=null;h.vaultLipY=NaN;return false;
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
  const forwardStart=mantleForwardStart(player.pos,h.vault,clearance,h.vaultLipY);
  if(forwardStart<0||!vaultPathClearance(h,player.pos,h.vault,clearance,push,forwardStart)){
    flashHint('VAULT BLOCKED — clear the landing',true);
    return false;
  }
  /* Alternate the plant side so repeated mantles do not use one fixed
     mannequin pose. The hand and foot timing below follow this side. */
  player.vaultLeadLeft=!player.vaultLeadLeft;
  player.vaultKind='mantle';
  player.vaultObstacle=holdSurfaceRoot(h);
  player.vaultLandingMesh=h.vaultMesh;
  player.vaultContactPoint.copy(climbSurfacePoint);
  player.vaultContactNormal.copy(player.vaultLandingNormal);
  player.vaultDirection.copy(player.vaultNormal).negate().setY(0).normalize();
  player.vaultObstacleHeight=rise;
  player.vaultObstacleDepth=horizontal;
  player.vaultEntrySpeed=0;
  player.vaultRecovery=0;
  player.vaultRecoveryDuration=0.28;
  player.mode='vault';
  player.vaultFrom.copy(player.pos);
  player.vaultTo.copy(h.vault);
  player.vaultDuration=duration;
  player.vaultPush=push;
  player.vaultClearance=clearance;
  player.vaultForwardStart=forwardStart;
  player.vaultT=0;
  /* Mantling owns body movement only. Camera yaw and pitch remain entirely
     under mouse input so reaching a lip cannot turn the player's view. */
  player.vel.set(0,0,0);player.onGround=false;
  return true;
}

function mantleTarget(h){
  /* Use the same footprint sampler as graph cooking. The live minimum height
     prevents a newly moved surface below the hanging body from becoming a
     landing while still allowing a valid roof beside a visual voxel seam. */
  return findMantleLanding(h,player.pos.y+0.38);
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
  for(const j of nearbyClimbHoldIndices(h.pos,2.2)){
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
  h.vault=null;h.vaultMesh=null;h.vaultLipY=NaN;h.vaultNormal.set(0,1,0);
  const refreshedTarget=mantleTarget(h);
  if(refreshedTarget&&startVault())return true;
  /* mantleTarget keeps a reusable vector while probing. Do not leave that
     zero-vector placeholder looking like a valid cache after every failed
     probe; the next input must be able to retry a fresh landing search. */
  h.vault=null;h.vaultMesh=null;h.vaultLipY=NaN;h.vaultNormal.set(0,1,0);
  return false;
}

function afterArrive(){
  const h=HOLDS[player.hold];
  const climbIntentActive=performance.now()<climbIntentUntil;
  if(((keys.ShiftLeft||keys.ShiftRight)&&(keys.KeyW||player.climbBuffer>0))||
      climbIntentActive)tryUp(h);
}

/* Ground movement is tuned to a deliberate tactical-shooter scale. Normal
   movement matches a rifle-out pace, while Shift provides a modest traversal
   boost instead of turning the player into an arcade-speed sprinter. */
const PLAYER_WALK_SPEED=6.75;
const PLAYER_SPRINT_SPEED=8.4375;
const PLAYER_GROUND_ACCEL=32;
const PLAYER_GROUND_BRAKE=44;
const PLAYER_AIR_ACCEL=5;
const PLAYER_AIR_DRAG=0.12;
const ceilingProbe=V(),ceilingHits=[];
const ceilingProbeOffsets=[[0,0],[0.28,0],[-0.28,0],[0,0.28],[0,-0.28],
  [0.2,0.2],[-0.2,0.2],[0.2,-0.2],[-0.2,-0.2]];
function resolvePlayerCeiling(previousY){
  if(player.pos.y<=previousY)return;
  const previousHead=previousY+PLAYER_HEIGHT;
  let ceiling=Infinity;
  ceilingProbe.set(player.pos.x,previousHead-0.015,player.pos.z);
  const far=player.pos.y-previousY+0.035;
  const candidates=getCameraOccluderCandidates(ceilingProbe,UP,far);
  if(!candidates.length)return;
  /* Query exact underside triangles at the capsule footprint. Sweeping from
     the previous head height catches thin ceilings even after a slow frame. */
  for(const offset of ceilingProbeOffsets){
    ceilingProbe.set(player.pos.x+offset[0],previousHead-0.015,player.pos.z+offset[1]);
    rc.set(ceilingProbe,UP);rc.near=0;rc.far=far;
    ceilingHits.length=0;
    rc.intersectObjects(candidates,false,ceilingHits);
    if(ceilingHits.length)ceiling=Math.min(ceiling,ceilingHits[0].point.y);
  }
  if(ceiling<Infinity){
    player.pos.y=Math.max(previousY,ceiling-PLAYER_HEIGHT-0.005);
    player.vel.y=0;
  }
}

function groundStep(dt,dir){
  const run=(keys.ShiftLeft||keys.ShiftRight);
  const frameStartX=player.pos.x,frameStartZ=player.pos.z;
  /* Keep the jump request alive for as long as Space remains physically held.
     A landing can occur long after the original keydown buffer expires; this
     lets that same hold launch again on the exact contact frame. Contextual
     vaults and pull-ups below still get first refusal whenever already grounded. */
  if(keys.Space&&gameSettings.autoJump)player.jumpBuffer=Math.max(player.jumpBuffer,JUMP_BUFFER_DURATION);
  if(player.vaultRecovery<=0&&
     (player.vaultKind==='low'||player.vaultKind==='quick')){
    player.vaultKind='none';player.vaultObstacle=null;player.vaultLandingMesh=null;
  }
  /* These are root-motion speeds, not animation multipliers. Shift remains
     useful for rotation without overwhelming close-range positioning. */
  const spd=run?PLAYER_SPRINT_SPEED:PLAYER_WALK_SPEED;
  const wasOnGround=player.onGround;
  const previousLocomotionSpeed=walkAmt;
  if(wasOnGround)player.jumpGrace=0.12;
  const incomingVertical=player.vel.y;
  const hasInput=dir.lengthSq()>0.01;
  /* A mantle lands with both feet loaded and the root velocity explicitly
     zeroed. Let held movement input build back over the same recovery window;
     applying full sprint acceleration on the first ground frame can pull the
     player straight back off a narrow ledge before the landing pose settles. */
  const recoveryDuration=Math.max(0.01,player.vaultRecoveryDuration||0.28);
  const recoveryT=player.vaultRecovery>0?
    Math.max(0,Math.min(1,1-player.vaultRecovery/recoveryDuration)):1;
  /* A low vault exits with live running momentum. Its recovery is purely a
     body-pose blend; throttling the input here would recreate the exact hitch
     the contextual traversal is meant to remove. */
  const recoveryInput=player.vaultRecovery>0&&player.vaultKind!=='low'?
    lerp(0.15,1,smooth5(recoveryT)):1;
  const desiredX=dir.x*spd*recoveryInput,desiredZ=dir.z*spd*recoveryInput;
  const velocityBeforeX=player.vel.x,velocityBeforeZ=player.vel.z;
  const velocityBlend=1-Math.exp(-
    (wasOnGround?(hasInput?PLAYER_GROUND_ACCEL:PLAYER_GROUND_BRAKE):
      (hasInput?PLAYER_AIR_ACCEL:PLAYER_AIR_DRAG))*dt);
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
  const vaultEntrySpeed=Math.hypot(player.vel.x,player.vel.z);
  if(player.jumpBuffer>0&&player.onGround){
    /* Contextual traversal follows the camera-facing prompt. This keeps the
       action deterministic even when Space lands between movement samples or
       the player is holding a sideways key while looking at the obstacle. Low
       cover is crossed first; a reachable taller top becomes a direct pull-up. */
    lowVaultActionDir.copy(moveFwd).setY(0);
    if(tryLowVault(lowVaultActionDir,vaultEntrySpeed,spd)||
       tryQuickClimb(lowVaultActionDir)){
      player.jumpBuffer=0;
      moveSpeed+=(vaultEntrySpeed-moveSpeed)*Math.min(1,dt*8);
      walkAmt=0;
      sprinting=false;
      return;
    }
  }
  const py=player.pos.y;
  /* Sweep fast ground motion in short deterministic increments. The old
     single translation could move the capsule through a thin wall or a
     freshly settled shard before resolveColliders had a chance to react;
     micro-steps keep the same cheap collision model while making contact
     continuous at sprint speed. */
  const travel=player.vel.length()*dt+0.5*WORLD_GRAVITY*dt*dt;
  const motionSteps=Math.max(1,Math.min(32,Math.ceil(travel/0.14)));
  const motionDt=dt/motionSteps;
  let stepTestedThisFrame=false;
  for(let i=0;i<motionSteps;i++){
    playerCollisionBefore.copy(player.pos);
    playerStepIntended.copy(player.pos);
    playerStepIntended.x+=player.vel.x*motionDt;
    playerStepIntended.z+=player.vel.z*motionDt;
    playerStepVelocity.copy(player.vel);
    player.pos.x+=player.vel.x*motionDt;
    player.pos.y+=player.vel.y*motionDt-0.5*WORLD_GRAVITY*motionDt*motionDt;
    player.vel.y-=WORLD_GRAVITY*motionDt;
    player.pos.z+=player.vel.z*motionDt;
    resolvePlayerCeiling(playerCollisionBefore.y);
    /* Resolve a crossed support before side contacts can eject the falling
       capsule from its top. Never snap an ascending jump onto a surface. */
    if(player.vel.y<=0&&!wasOnGround){
      const floor=groundBelow(player.pos.x,player.pos.z,playerCollisionBefore.y+0.02,
        playerCollisionBefore.y+0.04);
      if(player.pos.y<=floor&&playerCollisionBefore.y>=floor-0.04){
        player.pos.y=floor;player.vel.y=0;
      }
    }
    const collided=resolveColliders();
    /* Position correction is the contact normal for this lightweight player
       collider. Remove only the velocity component pushing into that contact;
       the tangential component survives, so running along a wall slides
       naturally instead of stuttering against it. */
    playerCollisionCorrection.subVectors(player.pos,playerStepIntended).setY(0);
    const correctionLengthSq=playerCollisionCorrection.lengthSq();
    if(collided&&correctionLengthSq>1e-6){
      playerCollisionNormal.copy(playerCollisionCorrection).multiplyScalar(1/Math.sqrt(correctionLengthSq));
      const intoContact=player.vel.dot(playerCollisionNormal);
      if(intoContact<0)player.vel.addScaledVector(playerCollisionNormal,-intoContact);
    }
    if(collided&&!stepTestedThisFrame&&wasOnGround&&player.grace<=0&&
       Math.abs(incomingVertical)<1.0){
      stepTestedThisFrame=true;
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
      let headroom=true;
      if(!stepBlocked&&stepRise>PLAYER_STEP_MIN_RISE&&stepRise<=PLAYER_STEP_HEIGHT+0.04){
        player.pos.y=stepGround;
        resolvePlayerCeiling(playerCollisionBefore.y);
        headroom=player.pos.y>=stepGround-1e-5;
      }
      if(!stepBlocked&&headroom&&stepRise>PLAYER_STEP_MIN_RISE&&
         stepRise<=PLAYER_STEP_HEIGHT+0.04&&horizontalError<0.07){
        player.pos.y=stepGround;
        player.vel.x=playerStepVelocity.x;
        player.vel.y=0;
        player.vel.z=playerStepVelocity.z;
        player.onGround=true;
        player.landingSurface=null;
      }else player.pos.copy(playerStepBlocked);
    }
  }
  const gh=groundBelow(player.pos.x,player.pos.z,Math.max(py,player.pos.y)+0.8,
    Math.max(py,player.pos.y)+0.04);
  if(player.pos.y<=gh){
    player.pos.y=gh;player.vel.y=0;player.onGround=true;
    player.jumpClimbActive=false;
    if(!wasOnGround&&incomingVertical<-1.8)landingKick=Math.min(1.15,-incomingVertical/7.6);
  }
  else{
    player.onGround=wasOnGround&&player.vel.y<=0&&(player.pos.y-gh)<0.08;
    if(player.onGround){player.pos.y=gh;player.vel.y=0;}
    if(player.onGround)player.jumpClimbActive=false;
  }
  if(player.jumpBuffer>0&&(player.onGround||player.jumpGrace>0)){
    player.vel.y=PLAYER_JUMP_SPEED;player.onGround=false;player.jumpGrace=0;player.jumpBuffer=0;
    player.jumpClimbActive=true;player.jumpLaunchY=player.pos.y;
    player.landingSurface=null;Sfx.jump();
  }
  const climbIntentActive=performance.now()<climbIntentUntil;
  const climbDownIntentActive=performance.now()<climbDownIntentUntil;
  const climbing=run;
  if(((climbing&&keys.KeyW)||climbIntentActive)&&
     (dir.lengthSq()>0.01||climbIntentDir.lengthSq()>0.01)){
    /* Preserve the intended approach for a few frames. Input and camera are
       sampled independently from the physics step, so requiring a perfect
       same-frame ray hit made sprinting past a hold feel randomly missed. */
    player.climbDir.copy(dir.lengthSq()>0.01?dir:climbIntentDir);
    player.climbBuffer=0.16;
  }
  /* Shift+W may grab a wall, but it must not skip straight from ground into a
     pull-up. Reachable tops use the contextual SPACE prompt above. Once the
     player is actually hanging/climbing, tryUp retains its automatic ascent. */
  /* A deliberate jump may carry its gained height into a climb. Waiting for a
     short physical rise prevents Space+Shift+W from selecting the wall's first
     ground-level hold on the launch frame. Walking off a roof never sets this
     flag, so falling remains authoritative until C explicitly asks for a grab. */
  const airborneJumpClimb=player.jumpClimbActive&&!player.onGround&&
    player.pos.y>=player.jumpLaunchY+0.3;
  if(climbDownIntentActive)tryGrab(!player.onGround,true);
  else if((player.onGround||airborneJumpClimb)&&
          (climbing||climbIntentActive)&&player.climbBuffer>0&&
          player.climbDir.lengthSq()>0.01)tryGrab(airborneJumpClimb);
  /* Third-person combat uses a camera-facing strafe stance: W advances, S
     backpedals, and A/D strafe while the chest and muzzle stay aimed through
     the reticle. Basing heading on the last movement direction let an idle or
     reversing player show their front to the chase camera while the shot ray
     continued backward through the cursor. Traversal takes over its own wall
     heading as soon as tryGrab changes mode, and vault recovery keeps the
     authored obstacle-crossing pose until combat is available again. */
  if(player.mode==='ground'&&player.vaultRecovery<=0)
    player.heading=Math.atan2(-Math.sin(camYaw),-Math.cos(camYaw));
  const locomotionSpeed=Math.hypot(
    player.pos.x-frameStartX,player.pos.z-frameStartZ)/Math.max(0.001,dt);
  const speedAcceleration=Math.max(-1,Math.min(1,
    (locomotionSpeed-previousLocomotionSpeed)/Math.max(0.001,dt)/12));
  movementAccel=dampValue(movementAccel,speedAcceleration,18,dt);
  moveSpeed+=(locomotionSpeed-moveSpeed)*Math.min(1,dt*8);
  walkAmt=locomotionSpeed;
  const moving=locomotionSpeed>0.08&&player.onGround;
  sprinting=moving&&run;
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
  const climbDownIntentActive=performance.now()<climbDownIntentUntil;
  const vaultIntent=keys.Space||performance.now()<vaultIntentUntil;
  if(vaultIntent){
    /* The startup graph is only a hint. A ledge can become reachable after the
       player transfers to a new hold, and a destructible top can also replace
       the mesh that was sampled at load time. Probe the current hold on the
       input edge so SPACE remains a reliable mantle action instead of silently
       turning into a drop just because the cache was empty. */
    if(!h.vault||!h.vaultMesh||!surfaceObjectIsLive(h.vaultMesh)){
      h.vault=null;h.vaultMesh=null;h.vaultLipY=NaN;h.vaultNormal.set(0,1,0);
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
  if(climbDownIntentActive){
    climbDownIntentUntil=0;
    if(h.down.length){
      const next=pickMin(h,h.down);
      if(startMove(next))return;
    }
    /* No lower handhold remains, so the explicit descent action releases the
       wall with a small outward clearance impulse. */
    player.mode='ground';
    player.vel.copy(climbSurfaceNormal).setY(0).normalize().multiplyScalar(1.4);
    player.vel.y=1;
    player.pos.addScaledVector(player.vel,0.04);
    player.cool=0.4;
    player.grace=0.45;
    player.onGround=false;
    return;
  }
  const dropIntent=keys.KeyS||keys.Space||performance.now()<dropIntentUntil;
  if(dropIntent){
    if(keys.KeyS&&h.down.length){
      const next=pickMin(h,h.down);
      if(startMove(next))return;
    }
    player.mode='ground';
    player.vel.copy(climbSurfaceNormal).setY(0).normalize().multiplyScalar(1.4);
    player.vel.y=(keys.Space||performance.now()<spaceIntentUntil)?PLAYER_JUMP_SPEED:1;
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
  const dur=player.mode==='attach'?
    Math.max(0.32,Math.min(0.46,from.distanceTo(to)/5.0)):
    Math.max(0.26,from.distanceTo(to)/2.2);
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
  const lowVault=player.vaultKind==='low';
  const quickClimb=player.vaultKind==='quick';
  const directVault=lowVault||quickClimb;
  const h=directVault?null:HOLDS[player.hold];
  if(!directVault&&(!holdSurfaceIsLive(h)||
     (h.vaultMesh&&!surfaceObjectIsLive(h.vaultMesh)))){
    releaseTraversal(h);return;
  }
  if(quickClimb&&(!lowVaultSurfaceStable(player.vaultObstacle)||
     !lowVaultSurfaceStable(player.vaultLandingMesh))){
    releaseTraversal(null);return;
  }
  player.vaultT+=dt/player.vaultDuration;
  const k=Math.min(1,player.vaultT);
  /* A low-cover vault carries forward momentum through both endpoints;
     the handhold mantle keeps its deliberate pull-up easing. */
  if(quickClimb)
    quickClimbPathPoint(player.vaultFrom,player.vaultTo,k,
      player.vaultClearance,player.vaultPush,player.vaultNormal,
      player.vaultForwardStart,player.vaultContactPoint,vaultDesiredPos);
  else
    vaultPathPoint(player.vaultFrom,player.vaultTo,k,
      player.vaultClearance,player.vaultPush,player.vaultNormal,
      player.vaultForwardStart,lowVault,vaultDesiredPos);
  /* Re-run the lightweight body clearance while the mantle is in flight. The
     start probe guards the planned path, but moving rubble or another prop can
     enter that corridor during the vault. Ignore only the wall and landing
     surfaces that the animation is intentionally crossing. */
  vaultMotionFrom.copy(player.pos);
  vaultMotionDelta.subVectors(vaultDesiredPos,vaultMotionFrom);
  const vaultDistance=vaultMotionDelta.length();
  const vaultSteps=Math.max(1,Math.min(4,Math.ceil(vaultDistance/0.16)));
  vaultMotionDelta.multiplyScalar(1/vaultSteps);
  const vaultWall=directVault?lowVaultSurfaceRoot(player.vaultObstacle):holdSurfaceRoot(h);
  const landingObject=directVault?player.vaultLandingMesh:h.vaultMesh;
  const vaultLanding=lowVaultSurfaceRoot(landingObject);
  for(let i=0;i<vaultSteps;i++){
    /* Advance from the corrected position, rather than repeatedly rebuilding
       the same interpolation from vaultMotionFrom. This preserves a shove from
       a moving shard or wall corner through the rest of the mantle frame. */
    player.pos.add(vaultMotionDelta);
    resolveColliders(vaultWall,vaultLanding);
  }
  if(k>=1){
    const wallRoot=vaultWall;
    const landingRoot=vaultLanding;
    /* The target was just validated against this top face. Do not let a
       higher shelf behind the lip win the first downward ray and yank the
       player upward at the last frame of the mantle. */
    const landingY=groundBelow(player.pos.x,player.pos.z,
      player.pos.y+0.6,player.vaultTo.y+0.28);
    /* Preserve the body’s forward travel across the lip. The old zero-velocity
       handoff made a mantle visibly pause on the landing frame and forced the
       recovery pose to restart movement from rest. Use the horizontal tangent
       of the authored vault path as a modest exit impulse; normal ground
       resolution and the recovery blend still own the final contact. */
    if(lowVault){
      vaultExitVelocity.copy(player.vaultDirection).setY(0);
      if(vaultExitVelocity.lengthSq()<0.001)
        vaultExitVelocity.subVectors(player.vaultTo,player.vaultFrom).setY(0);
      if(vaultExitVelocity.lengthSq()>0.001){
        vaultExitVelocity.normalize().multiplyScalar(Math.max(8,
          Math.min(PLAYER_SPRINT_SPEED,player.vaultEntrySpeed*0.88)));
      }else vaultExitVelocity.set(0,0,0);
    }else{
      vaultExitVelocity.subVectors(player.vaultTo,player.vaultFrom).setY(0);
      const exitDistance=vaultExitVelocity.length();
      if(exitDistance>0.001){
        const pathExit=exitDistance/Math.max(0.42,player.vaultDuration)*0.95;
        const carriedEntry=quickClimb?player.vaultEntrySpeed*0.28:0;
        vaultExitVelocity.multiplyScalar(Math.min(2.8,Math.max(0.65,
          pathExit,carriedEntry))/exitDistance);
      }
      else vaultExitVelocity.set(0,0,0);
    }
    player.mode='ground';player.vel.copy(vaultExitVelocity);
    if(lowVault)player.pos.y=landingY;
    else if(landingY>0)player.pos.y=landingY;
    /* The mantle is intentionally crossing these two surfaces. Resolving them
       as a side collision on the same frame pushes the player off the ledge
       before the next ground probe, which looked like a teleport to y=0. Keep
       nearby rubble collidable, but let the validated wall/top contact finish
       the handoff. */
    resolveColliders(wallRoot,landingRoot);
    const finalGround=groundBelow(player.pos.x,player.pos.z,player.pos.y+0.6,player.vaultTo.y+0.28);
    if(lowVault)player.pos.y=finalGround;
    else if(finalGround>0)player.pos.y=finalGround;
    else if(landingY>0)player.pos.y=landingY;
    player.landingSurface=landingRoot&&surfaceObjectIsLive(landingRoot)?landingRoot:null;
    player.landingAnchor.copy(player.pos);
    player.landingY=player.pos.y;
    player.landingRadius=lowVault?0.9:(quickClimb?0.78:1.35);
    /* Land facing over the obstacle. The camera remains on the outward side,
       behind the player; using the outward normal for both headings turned the
       character 180 degrees to face the camera on touchdown. */
    player.onGround=true;
    player.heading=lowVault?
      Math.atan2(player.vaultDirection.x,player.vaultDirection.z):
      Math.atan2(-player.vaultNormal.x,-player.vaultNormal.z);
    /* Keep the weight-bearing landing pose for a brief, live recovery window.
       Switching directly from the vault IK targets to the weapon targets on
       the next frame made the feet and shoulders pop even though the physical
       root had landed correctly. */
    player.vaultRecoveryDuration=lowVault?0.18:(quickClimb?0.22:0.28);
    player.vaultRecovery=player.vaultRecoveryDuration;
    /* Landing never writes camera yaw; the user's last mouse direction remains
       stable across the entire climb, mantle, and roof exit. */
    landingKick=lowVault?0.2:0.32;
    /* Give the camera enough time to complete its orbit around the landing
       side before normal obstruction correction resumes. Movement remains
       live during this window; only the just-cleared mantle corridor is
       treated as recoverable camera space. */
    /* Only suppress the just-cleared obstacle for a couple of simulation
       frames. The body can keep blending out of its landing pose for 180 ms,
       but physics must already be eligible to vault a second close barrier;
       tying both concerns to the same timer caused an impossible dead stop in
       chained cover. */
    player.cool=lowVault?0.035:(quickClimb?0.1:0.25);
    player.grace=lowVault?0.05:(quickClimb?0.55:1.8);
    if(lowVault){
      moveSpeed=Math.max(moveSpeed,vaultExitVelocity.length());
      walkAmt=vaultExitVelocity.length();
    }
  }
}
