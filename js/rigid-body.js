/* Legacy rigid debris contacts, support, settling, and fracture release. Loaded in order from index.html. */
function hasStaticSupportPath(body){
  if(!body)return false;
  if(body.staticSupported)return true;
  if(body._supportPathStamp===supportPathStamp)return !!body._supportPathResult;
  /* Mark before walking so a pair of leaning slabs cannot make a circular
     support graph look grounded. A separate path to a static contact can still
     prove the body stable later in this same search. */
  body._supportPathStamp=supportPathStamp;
  body._supportPathResult=false;
  for(const support of body.supportChunks||[]){
    const supportBody=support&&support.userData;
    if(!supportBody||!activeChunkSet.has(support))continue;
    if(hasStaticSupportPath(supportBody)){
      body._supportPathResult=true;
      break;
    }
  }
  return body._supportPathResult;
}
function hasQuietSupportPath(body){
  if(!body)return false;
  if(body.staticSupported)return true;
  if(body._quietSupportStamp===supportPathStamp)return !!body._quietSupportResult;
  /* Mark before walking so two leaning fragments cannot make one another look
     quiet through a circular support link. A support path is only quiet when
     every dynamic member that carries the load is already below the same
     residual-energy thresholds used by the sleep gate. */
  body._quietSupportStamp=supportPathStamp;
  body._quietSupportResult=false;
  const quietSpeedSq=DEBRIS_REST_SPEED*DEBRIS_REST_SPEED;
  const quietSpinSq=DEBRIS_REST_SPIN*DEBRIS_REST_SPIN;
  for(const support of body.supportChunks||[]){
    const supportBody=support&&support.userData;
    if(!supportBody||!activeChunkSet.has(support))continue;
    if(supportBody.vel.lengthSq()>quietSpeedSq||
       supportBody.angVel.lengthSq()>quietSpinSq)continue;
    if(hasQuietSupportPath(supportBody)){
      body._quietSupportResult=true;
      break;
    }
  }
  return body._quietSupportResult;
}
const SETTLED_GRID_CELL=4;
const SETTLED_GRID_SMALL_RADIUS=4.5;
const settledGrid=new Map(),settledGridCandidates=[],settledGridLarge=[];
let settledGridDirty=true;
/* Active debris changes position every fixed step, so unlike the static field
   its broadphase is rebuilt per solver pass. The cell is deliberately smaller
   than the largest ordinary fragment; overlapping AABBs therefore share a
   bucket while distant pieces never enter the exact OBB solver. */
const ACTIVE_CHUNK_GRID_CELL=2.5;
const activeChunkGrid=new Map(),activeChunkGridPool=[],activeChunkGridCandidates=[],activeChunkGridLarge=[];
const activeContactPairsA=[],activeContactPairsB=[];
let activeChunkGridStamp=0,activeChunkPairStamp=0,activeChunkGridCount=0;
const staticWorldQuaternion=new THREE.Quaternion();
const staticBody={
  mesh:null,position:V(),half:V(),axes:[V(1,0,0),V(0,1,0),V(0,0,1)],
  invMass:0,invInertia:V(),vel:V(),angVel:V(),radius:0,
  restitution:DEBRIS_GROUND_RESTITUTION,friction:DEBRIS_STATIC_FRICTION
};
let satBestOverlap=0,satBestX=0,satBestY=0,satBestZ=0;

function settledGridKey(x,z){return x+'_'+z;}
function markSettledGridDirty(){settledGridDirty=true;}
function rebuildSettledGrid(){
  settledGrid.clear();settledGridLarge.length=0;
  for(const c of settledFragments){
    const ud=c.userData;
    if((ud.radius||0)>SETTLED_GRID_SMALL_RADIUS){
      settledGridLarge.push(c);
      continue;
    }
    const gx=Math.floor(c.position.x/SETTLED_GRID_CELL),gz=Math.floor(c.position.z/SETTLED_GRID_CELL);
    let bucket=settledGrid.get(settledGridKey(gx,gz));
    if(!bucket){bucket=[];settledGrid.set(settledGridKey(gx,gz),bucket);}
    bucket.push(c);
  }
  settledGridDirty=false;
}
function getSettledCandidates(body){
  if(settledGridDirty)rebuildSettledGrid();
  settledGridCandidates.length=0;
  if(!settledFragments.length)return settledGridCandidates;
  const reach=body.radius+SETTLED_GRID_SMALL_RADIUS+0.05;
  const minX=Math.floor((body.position.x-reach)/SETTLED_GRID_CELL);
  const maxX=Math.floor((body.position.x+reach)/SETTLED_GRID_CELL);
  const minZ=Math.floor((body.position.z-reach)/SETTLED_GRID_CELL);
  const maxZ=Math.floor((body.position.z+reach)/SETTLED_GRID_CELL);
  for(let gx=minX;gx<=maxX;gx++)for(let gz=minZ;gz<=maxZ;gz++){
    const bucket=settledGrid.get(settledGridKey(gx,gz));
    if(bucket)for(const c of bucket)settledGridCandidates.push(c);
  }
  for(const c of settledGridLarge)settledGridCandidates.push(c);
  return settledGridCandidates;
}

/* Static fracture cells are numerous but spatially sparse. Keep their broad
   phase separate from the rigid solver: the exact OBB test below still runs
   for every candidate, while unrelated floors, walls, and distant buildings
   never enter the hot loop. The grid is rebuilt only when a collider is added
   or removed, so destruction keeps the same collision set without paying a
   full rebuild on every fixed step. */
const STATIC_BOX_GRID_CELL=4;
const staticBoxGrid=new Map(),staticBoxGridCandidates=[],staticBoxGridLarge=[];
let staticBoxGridStamp=0;
function staticBoxGridKey(x,z){return x+'_'+z;}
function rebuildStaticBoxGrid(){
  staticBoxGrid.clear();staticBoxGridLarge.length=0;
  for(const box of boxes){
    if(settledBoxSet.has(box))continue;
    const minX=Math.floor(box.min.x/STATIC_BOX_GRID_CELL);
    const maxX=Math.floor(box.max.x/STATIC_BOX_GRID_CELL);
    const minZ=Math.floor(box.min.z/STATIC_BOX_GRID_CELL);
    const maxZ=Math.floor(box.max.z/STATIC_BOX_GRID_CELL);
    const span=(maxX-minX+1)*(maxZ-minZ+1);
    if(span>64){staticBoxGridLarge.push(box);continue;}
    for(let gx=minX;gx<=maxX;gx++)for(let gz=minZ;gz<=maxZ;gz++){
      const key=staticBoxGridKey(gx,gz);
      let bucket=staticBoxGrid.get(key);
      if(!bucket){bucket=[];staticBoxGrid.set(key,bucket);}
      bucket.push(box);
    }
  }
  staticBoxGridDirty=false;
}
function getStaticBoxCandidates(body){
  if(staticBoxGridDirty)rebuildStaticBoxGrid();
  staticBoxGridCandidates.length=0;
  let stamp=++staticBoxGridStamp;
  if(stamp>=2147483647){staticBoxGridStamp=1;stamp=1;}
  const minX=Math.floor((body.minX-0.05)/STATIC_BOX_GRID_CELL);
  const maxX=Math.floor((body.maxX+0.05)/STATIC_BOX_GRID_CELL);
  const minZ=Math.floor((body.minZ-0.05)/STATIC_BOX_GRID_CELL);
  const maxZ=Math.floor((body.maxZ+0.05)/STATIC_BOX_GRID_CELL);
  const append=box=>{
    if(box.active===false)return;
    if(box._staticGridStamp===stamp)return;
    box._staticGridStamp=stamp;
    staticBoxGridCandidates.push(box);
  };
  for(let gx=minX;gx<=maxX;gx++)for(let gz=minZ;gz<=maxZ;gz++){
    const bucket=staticBoxGrid.get(staticBoxGridKey(gx,gz));
    if(bucket)for(const box of bucket)append(box);
  }
  for(const box of staticBoxGridLarge)append(box);
  return staticBoxGridCandidates;
}

const cameraStaticBoxCandidates=[];
function getCameraStaticBoxCandidates(pos){
  if(staticBoxGridDirty)rebuildStaticBoxGrid();
  cameraStaticBoxCandidates.length=0;
  let stamp=++staticBoxGridStamp;
  if(stamp>=2147483647){staticBoxGridStamp=1;stamp=1;}
  /* Camera collision is a point expanded by `r`, with one extra margin for
     the second push pass. Querying the neighbouring cells preserves the exact
     AABB test in resolveCameraPosition while avoiding a full scan of every
     fracture cell after a large blast. */
  const reach=0.75;
  const minX=Math.floor((pos.x-reach)/STATIC_BOX_GRID_CELL);
  const maxX=Math.floor((pos.x+reach)/STATIC_BOX_GRID_CELL);
  const minZ=Math.floor((pos.z-reach)/STATIC_BOX_GRID_CELL);
  const maxZ=Math.floor((pos.z+reach)/STATIC_BOX_GRID_CELL);
  const append=box=>{
    if(box.active===false||settledBoxSet.has(box))return;
    if(box._staticGridStamp===stamp)return;
    box._staticGridStamp=stamp;
    cameraStaticBoxCandidates.push(box);
  };
  for(let gx=minX;gx<=maxX;gx++)for(let gz=minZ;gz<=maxZ;gz++){
    const bucket=staticBoxGrid.get(staticBoxGridKey(gx,gz));
    if(bucket)for(const box of bucket)append(box);
  }
  for(const box of staticBoxGridLarge)append(box);
  return cameraStaticBoxCandidates;
}

const playerStaticBoxCandidates=[];
function getStaticBoxCandidatesAt(position,queryReach){
  if(staticBoxGridDirty)rebuildStaticBoxGrid();
  playerStaticBoxCandidates.length=0;
  let stamp=++staticBoxGridStamp;
  if(stamp>=2147483647){staticBoxGridStamp=1;stamp=1;}
  /* The player is a small expanded cylinder. Query only the grid cells around
     that footprint; the old full `boxes` scan became needlessly expensive once
     a fractured building had hundreds of static cells in the scene. */
  const reach=queryReach===undefined?0.78:Math.max(0.78,queryReach);
  const minX=Math.floor((position.x-reach)/STATIC_BOX_GRID_CELL);
  const maxX=Math.floor((position.x+reach)/STATIC_BOX_GRID_CELL);
  const minZ=Math.floor((position.z-reach)/STATIC_BOX_GRID_CELL);
  const maxZ=Math.floor((position.z+reach)/STATIC_BOX_GRID_CELL);
  const append=box=>{
    if(box.active===false)return;
    if(box._staticGridStamp===stamp)return;
    box._staticGridStamp=stamp;
    playerStaticBoxCandidates.push(box);
  };
  for(let gx=minX;gx<=maxX;gx++)for(let gz=minZ;gz<=maxZ;gz++){
    const bucket=staticBoxGrid.get(staticBoxGridKey(gx,gz));
    if(bucket)for(const box of bucket)append(box);
  }
  for(const box of staticBoxGridLarge)append(box);
  return playerStaticBoxCandidates;
}
function getPlayerStaticBoxCandidates(queryReach){
  return getStaticBoxCandidatesAt(player.pos,queryReach);
}

function updateChunkAxes(body){
  setAxesFromQuaternion(body.mesh.quaternion,body.axes);
}

function updateChunkBounds(body){
  const a=body.axes,half=body.half;
  const ex=half.x*Math.abs(a[0].x)+half.y*Math.abs(a[1].x)+half.z*Math.abs(a[2].x);
  const ey=half.x*Math.abs(a[0].y)+half.y*Math.abs(a[1].y)+half.z*Math.abs(a[2].y);
  const ez=half.x*Math.abs(a[0].z)+half.y*Math.abs(a[1].z)+half.z*Math.abs(a[2].z);
  body.minX=body.position.x-ex;body.maxX=body.position.x+ex;
  body.minY=body.position.y-ey;body.maxY=body.position.y+ey;
  body.minZ=body.position.z-ez;body.maxZ=body.position.z+ez;
}

function prepareChunkBody(c){
  const ud=c.userData;
  const size=ud.size||V(0.1,0.1,0.1);
  ud.mesh=c;
  ud.position=c.position;
  if(!ud.vel)ud.vel=V();
  if(!ud.angVel)ud.angVel=V();
  if(!ud.half)ud.half=V();
  ud.half.set(Math.max(0.03,Math.abs(size.x)*0.5),Math.max(0.03,Math.abs(size.y)*0.5),Math.max(0.03,Math.abs(size.z)*0.5));
  if(!ud.axes)ud.axes=[V(),V(),V()];
  if(!ud.invInertia)ud.invInertia=V();
  const sx=Math.max(0.06,Math.abs(size.x)),sy=Math.max(0.06,Math.abs(size.y)),sz=Math.max(0.06,Math.abs(size.z));
  const mass=Math.max(0.15,ud.mass||0.75);
  ud.mass=mass;ud.invMass=1/mass;
  const kind=ud.fractureKind||'masonry';
  /* Contact response follows the material, not one global dice-roll model:
     glass is light and slides, wood carries a little flex/bounce, and masonry
     stays heavy and grabs the ground. These coefficients are fixed at release
     time and do not alter the rigid body's shape. */
  ud.restitution=kind==='glass'?0.14:(kind==='wood'?0.12:(kind==='roof'?0.08:0.045));
  ud.friction=kind==='glass'?0.34:(kind==='wood'?0.58:(kind==='roof'?0.7:0.82));
  const ix=mass*(sy*sy+sz*sz)/12;
  const iy=mass*(sx*sx+sz*sz)/12;
  const iz=mass*(sx*sx+sy*sy)/12;
  ud.invInertia.set(ix>1e-5?1/ix:0,iy>1e-5?1/iy:0,iz>1e-5?1/iz:0);
  ud.radius=ud.half.length();
  if(!ud.supportChunks)ud.supportChunks=[];
  if(ud.impactCooldown===undefined)ud.impactCooldown=0;
  if(ud.structuralImpactCooldown===undefined)ud.structuralImpactCooldown=0;
  if(ud.restFrames===undefined)ud.restFrames=0;
  if(ud.staticSupported===undefined)ud.staticSupported=false;
  ud.sleeping=false;
  updateChunkAxes(ud);
  updateChunkBounds(ud);
}

function pairRestitution(a,b,fallback){
  const ar=a&&a.restitution===undefined?fallback:(a&&a.restitution!==undefined?a.restitution:fallback);
  const br=b&&b.restitution===undefined?fallback:(b&&b.restitution!==undefined?b.restitution:fallback);
  return Math.sqrt(Math.max(0.01,ar)*Math.max(0.01,br));
}
function pairFriction(a,b,fallback){
  const ar=a&&a.friction===undefined?fallback:(a&&a.friction!==undefined?a.friction:fallback);
  const br=b&&b.friction===undefined?fallback:(b&&b.friction!==undefined?b.friction:fallback);
  return Math.sqrt(Math.max(0.04,ar)*Math.max(0.04,br));
}

function activateChunk(c,epicenter,blastForce,directHit,failureDir){
  const ud=c.userData;
  if(ud.kind==='cell'){
    setFractureClimbProxy(c,false);
    exposeCellClimbNeighbors(c);
    retireCellShell(c);
  }
  directHit=directHit!==false;
  prepareChunkBody(c);
  ud.sleeping=false;ud.staticFragment=false;ud.supported=false;ud.staticSupported=false;
  ud.structuralSupport=false;
  ud.restFrames=0;
  ud.supportChunk=null;
  if(ud.supportChunks)ud.supportChunks.length=0;
  ud.cameraFade=true;
  const away=activateAway.subVectors(c.position,epicenter);
  const dist=away.length();
  if(dist>0.001)away.multiplyScalar(1/dist);
  else{
    away.set(rand(-1,1),0,rand(-1,1));
    if(away.lengthSq()<0.001)away.set(1,0,0);
    else away.normalize();
  }
  const falloff=directHit?Math.max(0,1-dist/RPG_BLAST_RADIUS):0;
  /* Treat the fracture as a structure, not a bag of equal-weight dice:
     upper pieces are freer to launch while lower pieces retain more of the
     building's load and start the collapse from the base. */
  const parent=ud.parent;
  retireStructuralDecorationsForCell(parent,c);
  const heightT=parent&&parent.size&&ud.relPos
    ?Math.max(0,Math.min(1,(ud.relPos.y+parent.size.y*0.5)/Math.max(0.01,parent.size.y)))
    :0.72;
  const velocity=activateVelocity.set(0,0,0);
  if(directHit){
    const structuralKick=0.48+heightT*0.7;
    const massKick=Math.min(2.4,Math.max(0.55,1/Math.sqrt(ud.mass)));
    const impulse=Math.min(12,blastForce*(0.16+falloff*0.62)*massKick*structuralKick);
    blastTangential.set(-away.z,0,away.x);
    const structuralLift=falloff*(0.16+heightT*0.55)-(1-heightT)*0.18;
    velocity.set(
      away.x*impulse+blastTangential.x*rand(-0.35,0.35),
      Math.max(-5,Math.min(7,away.y*impulse*0.32+structuralLift+rand(-0.12,0.12))),
      away.z*impulse+blastTangential.z*rand(-0.35,0.35)
    );
  }else{
    /* A support failure is not another explosion. Let gravity take over and
       bias the first motion toward the missing support so a slab tips and
       drops through its failed side instead of translating like a projectile. */
    if(failureDir&&failureDir.lengthSq()>0.001){
      velocity.x=failureDir.x*(0.18+heightT*0.24);
      velocity.z=failureDir.z*(0.18+heightT*0.24);
    }
    velocity.y=-0.08-heightT*0.16;
  }
  /* prepareChunkBody already owns these vectors. Copy the new state into them
     instead of replacing them on every release, which otherwise created a
     short-lived allocation for every shard in the first collapse wave. */
  ud.vel.copy(velocity);
  ud.angVel.set(0,0,0);
  if(directHit){
    /* Apply the blast at the exposed side of the cell. A centered radial hit
       produces almost no spin; off-centre lift and the small breakup tangent
       generate the roll that a real slab would carry into the fall. */
    const mass=Math.max(0.15,ud.mass||1);
    blastImpulseWorld.copy(velocity).multiplyScalar(mass);
    blastLever.copy(away).multiplyScalar(-Math.min(0.8,Math.max(0.12,ud.radius*0.72)));
    blastTorqueWorld.crossVectors(blastLever,blastImpulseWorld);
    applyInverseInertia(ud,blastTorqueWorld,satWorld);
    ud.angVel.copy(satWorld);
    const spinKick=ud.fractureKind==='glass'
      ?0.18+heightT*0.34
      :(ud.fractureKind==='wood'?0.12+heightT*0.25:0.08+heightT*0.2);
    ud.angVel.addScaledVector(blastTangential,(0.25+falloff*0.75)*spinKick);
    const breakupJitter=ud.fractureKind==='glass'?0.24:
      (ud.fractureKind==='wood'?0.17:0.12);
    ud.angVel.x+=rand(-breakupJitter,breakupJitter)*spinKick;
    ud.angVel.y+=rand(-breakupJitter*0.84,breakupJitter*0.84)*spinKick;
    ud.angVel.z+=rand(-breakupJitter,breakupJitter)*spinKick;
  }else if(failureDir&&failureDir.lengthSq()>0.001){
    fractureFailureAxis.crossVectors(UP,failureDir).normalize();
    ud.angVel.copy(fractureFailureAxis).multiplyScalar(0.7+heightT*0.9);
    ud.angVel.y+=rand(-0.18,0.18);
  }else{
    ud.angVel.set(rand(-0.18,0.18),rand(-0.18,0.18),rand(-0.18,0.18));
  }
  /* The fragment geometry was pre-baked while hidden inside the intact shell.
     Never replace it here: a released piece is a rigid body, not a morphing
     volume. Its collision OBB intentionally remains the exact cell envelope. */
  ud.fracturedVisual=true;
  if(!ud.fractureTinted){
    /* Surface-backed rocks keep their authored render patch as a child of the
       rigid physics envelope. Tint that patch on release; the envelope itself
       stays material-hidden so its collision box cannot become a visible
       replacement shape. Ordinary box fragments keep their own material path. */
    const surfaceVisual=ud.surfaceVisual;
    if(surfaceVisual){
      surfaceVisual.material=dynamicChunkMaterial(
        ud.surfaceVisualBaseMaterial||surfaceVisual.material);
      surfaceVisual.visible=true;
    }else c.material=dynamicChunkMaterial(c.material);
    ud.fractureTinted=true;
  }else if(ud.surfaceVisual){
    ud.surfaceVisual.visible=true;
  }
  c.castShadow=true;
  c.receiveShadow=true;
  addOccluder(c);
  if(standables.indexOf(c)<0)standables.push(c);
}

function queueDeferredSettledWake(c,epicenter,blastForce,directHit){
  if(!c||!c.userData||!epicenter)return;
  const existing=deferredSettledWakes.find(pending=>pending.mesh===c);
  if(existing){
    existing.epicenter.copy(epicenter);
    existing.blastForce=Math.max(existing.blastForce,blastForce||0);
    existing.directHit=existing.directHit||directHit!==false;
    return;
  }
  deferredSettledWakes.push({
    mesh:c,epicenter:epicenter.clone(),blastForce:Math.max(0.6,blastForce||0.6),
    directHit:directHit!==false
  });
}

function wakeSettledFragment(c,epicenter,blastForce,directHit){
  const si=settledFragments.indexOf(c);
  if(si<0||wakingSettled.has(c))return false;
  if(chunks.length>=MAX_CHUNKS&&!freeChunkSlot(epicenter)){
    /* A blast that arrives while the active budget is full still has to be
       honored. Defer the wake until a genuinely settled body frees a slot;
       otherwise static rubble becomes accidentally immune to later impacts. */
    queueDeferredSettledWake(c,epicenter,blastForce,directHit);
    return false;
  }
  directHit=directHit!==false;
  wakingSettled.add(c);
  /* A sleeping body can be resting on another sleeping body. Preserve that
     support graph so a blast that moves the lower piece wakes the stack above
     it instead of leaving an impossible floating slab behind. */
  const dependents=[];
  for(const other of settledFragments){
    const otherData=other&&other.userData;
    const supports=otherData&&otherData.supportChunks;
    if(other!==c&&otherData&&
       (otherData.supportChunk===c||(supports&&supports.indexOf(c)>=0)))
      dependents.push(other);
  }
  const staticBox=c.userData.fractureBox;
  if(staticBox){
    removePhysicsBox(staticBox);
    settledBoxSet.delete(staticBox);
    c.userData.fractureBox=null;
  }
  settledFragments.splice(si,1);
  markSettledGridDirty();
  activateChunk(c,epicenter,blastForce,directHit,null);
  chunks.push(c);
  for(const other of dependents)
    wakeSettledFragment(other,epicenter,Math.max(0.6,blastForce*0.35),false);
  wakingSettled.delete(c);
  return true;
}

function wakeSettledDependents(support,epicenter,blastForce){
  const dependents=[];
  for(const other of settledFragments){
    const data=other&&other.userData,supports=data&&data.supportChunks;
    if(other!==support&&data&&
       (data.supportChunk===support||(supports&&supports.indexOf(support)>=0)))
      dependents.push(other);
  }
  for(const other of dependents)
    wakeSettledFragment(other,epicenter,blastForce,false);
}

function flushDeferredSettledWakes(){
  for(let i=deferredSettledWakes.length-1;i>=0;i--){
    const pending=deferredSettledWakes[i];
    if(settledFragments.indexOf(pending.mesh)<0){
      deferredSettledWakes.splice(i,1);
      continue;
    }
    if(wakeSettledFragment(pending.mesh,pending.epicenter,
      pending.blastForce,pending.directHit))
      deferredSettledWakes.splice(i,1);
  }
}

function applyBlastToActiveDebris(epicenter,blastForce){
  /* Remember the pre-blast active set. Bodies awakened from a settled stack
     receive only the wake impulse; they must not be iterated again as if they
     were already active blast targets, or a support wave gets double-launched. */
  const activeCount=chunks.length;
  for(let i=settledFragments.length-1;i>=0;i--){
    const c=settledFragments[i],ud=c.userData;
    const box=ud.fractureBox;
    const dist=box?distanceToBox(epicenter,box):Math.max(0,c.position.distanceTo(epicenter)-ud.radius);
    if(dist>RPG_BLAST_RADIUS)continue;
    wakeSettledFragment(c,epicenter,blastForce);
  }
  for(let i=0;i<activeCount&&i<chunks.length;i++){
    const c=chunks[i];
    const ud=c.userData;
    const delta=blastActiveDelta.subVectors(c.position,epicenter);
    const dist=Math.max(0,delta.length()-ud.radius);
    if(dist>RPG_BLAST_RADIUS)continue;
    if(delta.lengthSq()<0.001)delta.set(rand(-1,1),0,rand(-1,1)).normalize();
    else delta.normalize();
    const falloff=1-dist/RPG_BLAST_RADIUS;
    const impulse=Math.min(9,blastForce*(0.18+falloff*0.5)/Math.max(0.25,ud.mass||1));
    ud.vel.addScaledVector(delta,impulse);
    ud.vel.y+=0.5+falloff*1.8;
    const mass=Math.max(0.15,ud.mass||1);
    blastImpulseWorld.copy(delta).multiplyScalar(impulse*mass);
    blastImpulseWorld.y+=(0.5+falloff*1.8)*mass;
    blastLever.copy(delta).multiplyScalar(-Math.min(0.8,Math.max(0.12,ud.radius*0.65)));
    blastTorqueWorld.crossVectors(blastLever,blastImpulseWorld);
    applyInverseInertia(ud,blastTorqueWorld,satWorld);
    const wakeSpinScale=ud.fractureKind==='glass'?1.45:
      (ud.fractureKind==='wood'?1.18:1);
    ud.angVel.addScaledVector(satWorld,wakeSpinScale);
    ud.sleeping=false;
  }
}

function integrateChunkRotation(c,dt){
  const ud=c.userData;
  chunkSpinAxis.copy(ud.angVel);
  const spin=chunkSpinAxis.length();
  if(spin<0.0001)return;
  chunkSpinAxis.multiplyScalar(1/spin);
  chunkSpinQuaternion.setFromAxisAngle(chunkSpinAxis,spin*dt);
  c.quaternion.premultiply(chunkSpinQuaternion).normalize();
}

function staticizeChunk(c){
  const ci=chunks.indexOf(c);
  if(ci<0)return false;
  c.updateMatrixWorld(true);
  const ud=c.userData;
  /* Instanced voxel actors keep their collision envelope on the rigid root.
     Box3 cannot see the per-instance offsets in this Three.js revision, so
     preserve the solver's exact last OBB bounds when a body or limb sleeps. */
  const staticBox=ud.actorRigid
    ?new THREE.Box3(V(ud.minX,ud.minY,ud.minZ),V(ud.maxX,ud.maxY,ud.maxZ))
    :box3Of(c);
  staticBox.owner=c;
  ud.fractureBox=staticBox;ud.staticFragment=true;ud.sleeping=true;
  ud.restFrames=0;
  ud.invMass=0;
  ud.vel.set(0,0,0);ud.angVel.set(0,0,0);
  addPhysicsBox(staticBox);
  settledBoxSet.add(staticBox);
  settledFragments.push(c);
  markSettledGridDirty();
  chunks.splice(ci,1);
  return true;
}

function freeChunkSlot(epicenter){
  if(chunks.length<MAX_CHUNKS)return true;
  let candidate=null,bestScore=-Infinity;
  for(const c of chunks){
    const ud=c.userData;
    let supportedByMovingChunk=!!(ud.supportChunk&&chunks.indexOf(ud.supportChunk)>=0);
    if(!supportedByMovingChunk&&ud.supportChunks){
      for(const support of ud.supportChunks){
        if(chunks.indexOf(support)>=0){supportedByMovingChunk=true;break;}
      }
    }
    /* Only hand off a body that has already found static support and is below
       the same residual-energy threshold used by normal contact sleep. Never
       freeze a moving bridge or a piece still resting on a dynamic shard. */
    if(!ud.supported||
       (supportedByMovingChunk&&!ud.staticSupported)||
       (ud.structuralSupport&&!ud.supportChunk)||
       (ud.restFrames||0)<DEBRIS_SLEEP_FRAMES||
       ud.vel.lengthSq()>DEBRIS_REST_SPEED*DEBRIS_REST_SPEED||
       ud.angVel.lengthSq()>DEBRIS_REST_SPIN*DEBRIS_REST_SPIN)continue;
    const dx=c.position.x-epicenter.x,dy=c.position.y-epicenter.y,dz=c.position.z-epicenter.z;
    const score=dx*dx+dy*dy+dz*dz;
    if(score>bestScore){bestScore=score;candidate=c;}
  }
  return !!candidate&&staticizeChunk(candidate);
}

function supportPoint(body,dir,out){
  out.copy(body.position);
  out.addScaledVector(body.axes[0],body.half.x*(dir.dot(body.axes[0])>=0?1:-1));
  out.addScaledVector(body.axes[1],body.half.y*(dir.dot(body.axes[1])>=0?1:-1));
  out.addScaledVector(body.axes[2],body.half.z*(dir.dot(body.axes[2])>=0?1:-1));
  return out;
}

function satConsiderAxis(ax,ay,az,a,b,dx,dy,dz){
  const lenSq=ax*ax+ay*ay+az*az;
  if(lenSq<1e-10)return true;
  const invLen=1/Math.sqrt(lenSq);
  const nx=ax*invLen,ny=ay*invLen,nz=az*invLen;
  const aa=a.axes,ba=b.axes;
  const ra=a.half.x*Math.abs(nx*aa[0].x+ny*aa[0].y+nz*aa[0].z)+
    a.half.y*Math.abs(nx*aa[1].x+ny*aa[1].y+nz*aa[1].z)+
    a.half.z*Math.abs(nx*aa[2].x+ny*aa[2].y+nz*aa[2].z);
  const rb=b.half.x*Math.abs(nx*ba[0].x+ny*ba[0].y+nz*ba[0].z)+
    b.half.y*Math.abs(nx*ba[1].x+ny*ba[1].y+nz*ba[1].z)+
    b.half.z*Math.abs(nx*ba[2].x+ny*ba[2].y+nz*ba[2].z);
  const overlap=ra+rb-Math.abs(dx*nx+dy*ny+dz*nz);
  if(overlap<0)return false;
  if(overlap<satBestOverlap){
    satBestOverlap=overlap;satBestX=nx;satBestY=ny;satBestZ=nz;
  }
  return true;
}

function applyInverseInertia(body,vector,out){
  if(body.invMass<=0||!body.mesh){out.set(0,0,0);return out;}
  chunkInverseQuaternion.copy(body.mesh.quaternion).invert();
  satLocal.copy(vector).applyQuaternion(chunkInverseQuaternion).multiply(body.invInertia);
  out.copy(satLocal).applyQuaternion(body.mesh.quaternion);
  return out;
}

function angularEffectiveMass(body,r,dir){
  if(body.invMass<=0)return 0;
  satCross.crossVectors(r,dir);
  applyInverseInertia(body,satCross,satInvCross);
  return satCross.dot(satInvCross);
}

function applyBodyImpulse(body,impulse,r,sign){
  if(body.invMass<=0)return;
  body.vel.addScaledVector(impulse,sign*body.invMass);
  if(!body.mesh)return;
  satTorque.crossVectors(r,impulse).multiplyScalar(sign);
  applyInverseInertia(body,satTorque,satWorld);
  body.angVel.add(satWorld);
}

function contactVelocity(body,r,out){
  out.copy(body.vel);
  satCross.crossVectors(body.angVel,r);
  out.add(satCross);
  return out;
}

function applyRollingResistance(body,normal,load,friction){
  if(body.invMass<=0||!body.mesh||load<=0)return;
  /* Coulomb contact friction already brakes sliding. A box that is rocking on
     a chipped edge can still keep rotating when the friction point is near
     its center, though, so give the same contact load a small rolling/twist
     moment. This is a force-based contact response, not a timer that freezes
     an active body; it only exists while a real support impulse is present. */
  const spinAlongNormal=body.angVel.dot(normal);
  rollingAxis.copy(body.angVel).addScaledVector(normal,-spinAlongNormal);
  const rollingSpeed=rollingAxis.length();
  if(rollingSpeed>1e-5){
    rollingAxis.multiplyScalar(1/rollingSpeed);
    const rollingCoefficient=body.fractureKind==='glass'?0.08:
      (body.fractureKind==='wood'?0.11:(body.fractureKind==='roof'?0.14:0.16));
    const rollingLimit=load*Math.max(0.01,body.radius*rollingCoefficient)*
      Math.max(0.04,friction);
    rollingImpulse.copy(rollingAxis).multiplyScalar(-rollingLimit);
    applyInverseInertia(body,rollingImpulse,rollingDelta);
    const rollingResponse=rollingDelta.dot(rollingAxis);
    if(rollingResponse>=rollingSpeed)
      body.angVel.addScaledVector(rollingDelta,
        rollingSpeed/Math.max(1e-6,rollingResponse));
    else body.angVel.add(rollingDelta);
  }
  if(Math.abs(spinAlongNormal)>1e-5){
    const twistLimit=load*Math.max(0.006,body.radius*0.012)*
      Math.max(0.04,friction);
    rollingImpulse.copy(normal).multiplyScalar(spinAlongNormal>0?-twistLimit:twistLimit);
    applyInverseInertia(body,rollingImpulse,rollingDelta);
    const twistResponse=rollingDelta.dot(normal);
    if(Math.abs(twistResponse)>=Math.abs(spinAlongNormal))
      body.angVel.addScaledVector(rollingDelta,
        Math.abs(spinAlongNormal)/Math.max(1e-6,Math.abs(twistResponse)));
    else body.angVel.add(rollingDelta);
  }
}

function resolveRigidContact(a,b,penetration,normal,point,restitution,friction){
  const invTotal=a.invMass+b.invMass;
  if(invTotal<=0)return;
  const correction=Math.min(0.3,Math.max(0,penetration-DEBRIS_CONTACT_SLOP)*DEBRIS_POSITION_PERCENT/invTotal);
  if(a.invMass>0)a.position.addScaledVector(normal,-correction*a.invMass);
  if(b.invMass>0)b.position.addScaledVector(normal,correction*b.invMass);

  contactRA.subVectors(point,a.position);
  contactRB.subVectors(point,b.position);
  contactVelocity(a,contactRA,contactVelA);
  contactVelocity(b,contactRB,contactVelB);
  contactRelativeVel.subVectors(contactVelB,contactVelA);
  let normalImpulse=0;
  const normalVelocity=contactRelativeVel.dot(normal);
  /* Solve a small velocity-level penetration bias in addition to the exact
     position correction above. Without this term, a corner that is already
     separating can still be moved into the floor again by gravity on the next
     fixed step; the contact then keeps rocking forever instead of converging.
     This is a standard rigid-contact constraint, not a timer-based settle. */
  const penetrationBias=Math.max(0,penetration-DEBRIS_CONTACT_SLOP)/
    Math.max(DEBRIS_FIXED_STEP,debrisContactDt)*0.2;
  const bounceVelocity=normalVelocity<0?-normalVelocity*restitution:0;
  const targetNormalVelocity=Math.max(penetrationBias,bounceVelocity);
  if(normalVelocity<targetNormalVelocity){
    const normalMass=invTotal+angularEffectiveMass(a,contactRA,normal)+angularEffectiveMass(b,contactRB,normal);
    normalImpulse=(targetNormalVelocity-normalVelocity)/Math.max(1e-6,normalMass);
    contactImpulse.copy(normal).multiplyScalar(normalImpulse);
    applyBodyImpulse(a,contactImpulse,contactRA,-1);
    applyBodyImpulse(b,contactImpulse,contactRB,1);
  }
  /* A resting stack has almost no closing velocity on solver iterations after
     the first contact, so normalImpulse can be zero—or only a tiny positional
     correction—even though gravity is still loading the contact. Use at least
     the real per-step gravity load for static/rolling friction instead of
     letting rubble slide and spin forever. This is a contact constraint, not
     a timer-based freeze. */
  let supportImpulse=normalImpulse;
  if(normalVelocity<0.2){
    let gravitySupport=0;
    if(normal.y<-DEBRIS_SUPPORT_Y&&a.invMass>0)
      gravitySupport+=(1/a.invMass)*DEBRIS_GRAVITY*(-normal.y)*debrisContactDt;
    if(normal.y>DEBRIS_SUPPORT_Y&&b.invMass>0)
      gravitySupport+=(1/b.invMass)*DEBRIS_GRAVITY*normal.y*debrisContactDt;
    supportImpulse=Math.max(supportImpulse,gravitySupport);
  }
  if(supportImpulse<=0)return;
  contactVelocity(a,contactRA,contactVelA);
  contactVelocity(b,contactRB,contactVelB);
  contactRelativeVel.subVectors(contactVelB,contactVelA);
  contactTangent.copy(contactRelativeVel).addScaledVector(normal,-contactRelativeVel.dot(normal));
  const tangentSpeed=contactTangent.length();
  if(tangentSpeed<1e-5){
    applyRollingResistance(a,normal,supportImpulse,friction);
    applyRollingResistance(b,normal,supportImpulse,friction);
    return;
  }
  contactTangent.multiplyScalar(1/tangentSpeed);
  const tangentMass=invTotal+angularEffectiveMass(a,contactRA,contactTangent)+angularEffectiveMass(b,contactRB,contactTangent);
  const tangentImpulse=Math.max(-supportImpulse*friction,Math.min(supportImpulse*friction,
    -contactRelativeVel.dot(contactTangent)/Math.max(1e-6,tangentMass)));
  contactImpulse.copy(contactTangent).multiplyScalar(tangentImpulse);
  applyBodyImpulse(a,contactImpulse,contactRA,-1);
  applyBodyImpulse(b,contactImpulse,contactRB,1);
  applyRollingResistance(a,normal,supportImpulse,friction);
  applyRollingResistance(b,normal,supportImpulse,friction);
}

function findObbContact(a,b){
  const dx=b.position.x-a.position.x,dy=b.position.y-a.position.y,dz=b.position.z-a.position.z;
  satBestOverlap=Infinity;
  for(let i=0;i<3;i++){
    const axis=a.axes[i];
    if(!satConsiderAxis(axis.x,axis.y,axis.z,a,b,dx,dy,dz))return -1;
  }
  for(let i=0;i<3;i++){
    const axis=b.axes[i];
    if(!satConsiderAxis(axis.x,axis.y,axis.z,a,b,dx,dy,dz))return -1;
  }
  for(let i=0;i<3;i++)for(let j=0;j<3;j++){
    const aa=a.axes[i],bb=b.axes[j];
    if(!satConsiderAxis(aa.y*bb.z-aa.z*bb.y,aa.z*bb.x-aa.x*bb.z,aa.x*bb.y-aa.y*bb.x,a,b,dx,dy,dz))return -1;
  }
  satNormal.set(satBestX,satBestY,satBestZ);
  if(dx*satNormal.x+dy*satNormal.y+dz*satNormal.z<0)satNormal.negate();
  supportPoint(a,satNormal,satSupportA);
  satSupportDir.copy(satNormal).negate();
  supportPoint(b,satSupportDir,satSupportB);
  satContact.copy(satSupportA).add(satSupportB).multiplyScalar(0.5);
  /* A single support vertex is useful for an edge hit, but using it for a
     broad face contact applies friction at an artificial corner and injects
     spin into otherwise flat rubble stacks. Re-center only near-principal
     contacts on the shared contact plane; oblique edge/corner contacts keep
     their exact support point and torque. */
  if(Math.max(Math.abs(satNormal.x),Math.abs(satNormal.y),Math.abs(satNormal.z))>0.72){
    /* Clamp the friction point to the actual projected overlap. The midpoint
       of the two centers can sit beyond an edge when a slab lands near a
       corner, creating a fictitious lever arm and artificial spin. Keep the
       support-plane coordinate from the exact SAT support points, but center
       the two tangent coordinates inside the shared AABB patch. */
    const overlapMinX=Math.max(a.minX,b.minX),overlapMaxX=Math.min(a.maxX,b.maxX);
    const overlapMinY=Math.max(a.minY,b.minY),overlapMaxY=Math.min(a.maxY,b.maxY);
    const overlapMinZ=Math.max(a.minZ,b.minZ),overlapMaxZ=Math.min(a.maxZ,b.maxZ);
    satWorld.copy(satContact);
    const principalX=Math.abs(satNormal.x),principalY=Math.abs(satNormal.y),
      principalZ=Math.abs(satNormal.z);
    if(principalY>=principalX&&principalY>=principalZ){
      if(overlapMaxX>=overlapMinX)satWorld.x=(overlapMinX+overlapMaxX)*0.5;
      if(overlapMaxZ>=overlapMinZ)satWorld.z=(overlapMinZ+overlapMaxZ)*0.5;
    }else if(principalX>=principalZ){
      if(overlapMaxY>=overlapMinY)satWorld.y=(overlapMinY+overlapMaxY)*0.5;
      if(overlapMaxZ>=overlapMinZ)satWorld.z=(overlapMinZ+overlapMaxZ)*0.5;
    }else{
      if(overlapMaxX>=overlapMinX)satWorld.x=(overlapMinX+overlapMaxX)*0.5;
      if(overlapMaxY>=overlapMinY)satWorld.y=(overlapMinY+overlapMaxY)*0.5;
    }
    satContact.copy(satWorld);
  }
  return satBestOverlap;
}

function rebuildActiveChunkGrid(){
  /* The broadphase is rebuilt once per solver pass because contacts move OBBs.
     Recycle its short-lived bucket arrays instead of allocating a new array
     for every occupied grid cell during every fixed-step iteration. This keeps
     the exact candidate set while removing a large source of collapse-time GC. */
  for(const bucket of activeChunkGrid.values()){
    bucket.length=0;
    activeChunkGridPool.push(bucket);
  }
  activeChunkGrid.clear();
  activeChunkGridLarge.length=0;
  activeChunkGridCount=chunks.length;
  for(let i=0;i<chunks.length;i++){
    const c=chunks[i],body=c.userData;
    body._activeGridIndex=i;
    const minX=Math.floor((body.minX-0.04)/ACTIVE_CHUNK_GRID_CELL);
    const maxX=Math.floor((body.maxX+0.04)/ACTIVE_CHUNK_GRID_CELL);
    const minZ=Math.floor((body.minZ-0.04)/ACTIVE_CHUNK_GRID_CELL);
    const maxZ=Math.floor((body.maxZ+0.04)/ACTIVE_CHUNK_GRID_CELL);
    const span=(maxX-minX+1)*(maxZ-minZ+1);
    if(span>64){
      activeChunkGridLarge.push(c);
      continue;
    }
    for(let gx=minX;gx<=maxX;gx++)for(let gz=minZ;gz<=maxZ;gz++){
      const key=gx+'_'+gz;
      let bucket=activeChunkGrid.get(key);
      if(!bucket){
        bucket=activeChunkGridPool.pop()||[];
        activeChunkGrid.set(key,bucket);
      }
      bucket.push(c);
    }
  }
  let stamp=++activeChunkGridStamp;
  if(stamp>=2147483647){activeChunkGridStamp=1;stamp=1;}
  return stamp;
}

function resolveActiveChunkPairs(refineOnly,captureContacts){
  if(refineOnly){
    /* The first pass already found the only pairs that need another constraint
       iteration. Reuse those exact pairs instead of rebuilding the moving-body
       grid a second time; contact correction updates their cached bounds below. */
    const refineCount=Math.min(DEBRIS_CONTACT_REFINE_BUDGET,activeContactPairsA.length);
    for(let i=0;i<refineCount;i++){
      const a=activeContactPairsA[i],b=activeContactPairsB[i];
      const penetration=findObbContact(a,b);
      if(penetration<0)continue;
      if(satNormal.y<-DEBRIS_SUPPORT_Y){
        a.supported=true;a.supportChunk=b.mesh;
        if(a.supportChunks&&a.supportChunks.indexOf(b.mesh)<0)a.supportChunks.push(b.mesh);
      }
      if(satNormal.y>DEBRIS_SUPPORT_Y){
        b.supported=true;b.supportChunk=a.mesh;
        if(b.supportChunks&&b.supportChunks.indexOf(a.mesh)<0)b.supportChunks.push(a.mesh);
      }
      resolveRigidContact(a,b,penetration,satNormal,satContact,
        pairRestitution(a,b,DEBRIS_CHUNK_RESTITUTION),
        pairFriction(a,b,DEBRIS_FRICTION));
      updateChunkBounds(a);updateChunkBounds(b);
    }
    return 0;
  }
  const gridStamp=rebuildActiveChunkGrid();
  if(captureContacts){
    activeContactPairsA.length=0;
    activeContactPairsB.length=0;
  }
  for(let i=0;i<chunks.length;i++){
    const a=chunks[i].userData;
    activeChunkGridCandidates.length=0;
    let pairStamp=++activeChunkPairStamp;
    if(pairStamp>=2147483647){activeChunkPairStamp=1;pairStamp=1;}
    const append=c=>{
      if(!c||c===a.mesh)return;
      const b=c.userData;
      if(b._activeGridIndex<=i||b._activePairStamp===pairStamp)return;
      b._activePairStamp=pairStamp;
      activeChunkGridCandidates.push(c);
    };
    const minX=Math.floor((a.minX-0.04)/ACTIVE_CHUNK_GRID_CELL);
    const maxX=Math.floor((a.maxX+0.04)/ACTIVE_CHUNK_GRID_CELL);
    const minZ=Math.floor((a.minZ-0.04)/ACTIVE_CHUNK_GRID_CELL);
    const maxZ=Math.floor((a.maxZ+0.04)/ACTIVE_CHUNK_GRID_CELL);
    for(let gx=minX;gx<=maxX;gx++)for(let gz=minZ;gz<=maxZ;gz++){
      const bucket=activeChunkGrid.get(gx+'_'+gz);
      if(bucket)for(const c of bucket)append(c);
    }
    for(const c of activeChunkGridLarge)append(c);
    for(const c of activeChunkGridCandidates){
      const b=c.userData;
      if(b.minX>a.maxX+0.05||a.minX>b.maxX+0.05||
         b.minY>a.maxY+0.05||a.minY>b.maxY+0.05||
         b.minZ>a.maxZ+0.05||a.minZ>b.maxZ+0.05)continue;
      if(!broadphaseHit(a,b))continue;
      const penetration=findObbContact(a,b);
      if(penetration>=0){
        if(captureContacts){
          activeContactPairsA.push(a);
          activeContactPairsB.push(b);
        }
        if(satNormal.y<-DEBRIS_SUPPORT_Y){
          a.supported=true;a.supportChunk=b.mesh;
          if(a.supportChunks&&a.supportChunks.indexOf(b.mesh)<0)a.supportChunks.push(b.mesh);
        }
        if(satNormal.y>DEBRIS_SUPPORT_Y){
          b.supported=true;b.supportChunk=a.mesh;
          if(b.supportChunks&&b.supportChunks.indexOf(a.mesh)<0)b.supportChunks.push(a.mesh);
        }
        resolveRigidContact(a,b,penetration,satNormal,satContact,
          pairRestitution(a,b,DEBRIS_CHUNK_RESTITUTION),
          pairFriction(a,b,DEBRIS_FRICTION));
        updateChunkBounds(a);updateChunkBounds(b);
      }
    }
  }
  return gridStamp;
}

function broadphaseHit(a,b){
  const dx=b.position.x-a.position.x,dy=b.position.y-a.position.y,dz=b.position.z-a.position.z;
  const radius=a.radius+b.radius+0.05;
  return dx*dx+dy*dy+dz*dz<=radius*radius;
}

function resolveGround(body){
  supportPoint(body,DOWN,groundSupport);
  if(groundSupport.y>=0)return;
  body.supported=true;
  body.staticSupported=true;
  const incomingSpeed=Math.max(0,-body.vel.y);
  satNormal.set(0,-1,0);
  satContact.copy(groundSupport);satContact.y=0;
  staticBody.restitution=DEBRIS_GROUND_RESTITUTION;
  staticBody.friction=DEBRIS_STATIC_FRICTION;
  resolveRigidContact(body,staticBody,-groundSupport.y,satNormal,satContact,
    pairRestitution(body,staticBody,DEBRIS_GROUND_RESTITUTION),
    pairFriction(body,staticBody,DEBRIS_STATIC_FRICTION));
  if(incomingSpeed>3.2&&(body.impactCooldown||0)<=0){
    body.impactCooldown=0.22;
    spawnDebrisDust(satContact,Math.min(1.2,0.32+incomingSpeed*0.08));
  }
}

function resolveStaticBoxes(body){
  for(const box of getStaticBoxCandidates(body)){
    if(settledBoxSet.has(box))continue;
    const dx=Math.max(box.min.x-body.position.x,0,body.position.x-box.max.x);
    const dy=Math.max(box.min.y-body.position.y,0,body.position.y-box.max.y);
    const dz=Math.max(box.min.z-body.position.z,0,body.position.z-box.max.z);
    const radius=body.radius+0.05;
    if(box.max.x<body.minX-0.05||box.min.x>body.maxX+0.05||
       box.max.y<body.minY-0.05||box.min.y>body.maxY+0.05||
       box.max.z<body.minZ-0.05||box.min.z>body.maxZ+0.05)continue;
    if(dx*dx+dy*dy+dz*dz>radius*radius)continue;
    const owner=box.owner;
    const ownerData=owner&&owner.userData;
    const oriented=ownerData&&(ownerData.kind==='cell'||ownerData.kind==='roof'||
      ownerData.kind==='trim'||ownerData.kind==='groupShell'||
      ownerData.kind==='groupChunk'||ownerData.kind==='actorBody'||
      ownerData.kind==='actorPart')&&ownerData.size;
    if(oriented){
      /* The broadphase uses the cached AABB, but the narrowphase must use the
         actual piece frame. This keeps a rotated roof, wall fragment, or
         compound prop from behaving like a larger invisible axis-aligned
         crate. */
      staticBody.mesh=owner;
      owner.updateMatrixWorld(true);
      staticBody.position.setFromMatrixPosition(owner.matrixWorld);
      staticBody.half.copy(ownerData.size).multiplyScalar(0.5);
      staticWorldQuaternion.setFromRotationMatrix(owner.matrixWorld);
      setAxesFromQuaternion(staticWorldQuaternion,staticBody.axes);
    }else{
      staticBody.mesh=null;
      staticBody.position.set((box.min.x+box.max.x)*0.5,(box.min.y+box.max.y)*0.5,(box.min.z+box.max.z)*0.5);
      staticBody.half.set((box.max.x-box.min.x)*0.5,(box.max.y-box.min.y)*0.5,(box.max.z-box.min.z)*0.5);
      staticBody.axes[0].set(1,0,0);staticBody.axes[1].set(0,1,0);staticBody.axes[2].set(0,0,1);
    }
    updateChunkBounds(staticBody);
    const ownerMaterial=ownerData&&ownerData.parent&&ownerData.parent.fractureKind||
      (ownerData&&ownerData.fractureKind)||'';
    const materialRestitution=ownerMaterial==='glass'?0.14:
      (ownerMaterial==='wood'?0.12:(ownerMaterial==='roof'?0.08:DEBRIS_CHUNK_RESTITUTION));
    const materialFriction=ownerMaterial==='glass'?0.34:
      (ownerMaterial==='wood'?0.58:(ownerMaterial==='roof'?0.7:DEBRIS_STATIC_FRICTION));
    staticBody.restitution=ownerData&&ownerData.restitution!==undefined?
      ownerData.restitution:materialRestitution;
    staticBody.friction=ownerData&&ownerData.friction!==undefined?
      ownerData.friction:materialFriction;
    const penetration=findObbContact(body,staticBody);
    if(penetration>=0){
      const kind=ownerData&&ownerData.kind;
      const target=structuralTargetForMesh(owner);
      const bodyParent=body.mesh&&body.mesh.userData&&body.mesh.userData.parent;
      if(target&&target!==bodyParent&&(body.structuralImpactCooldown||0)<=0){
        contactRA.subVectors(satContact,body.position);
        contactRB.subVectors(satContact,staticBody.position);
        contactVelocity(body,contactRA,contactVelA);
        contactVelocity(staticBody,contactRB,contactVelB);
        contactRelativeVel.subVectors(contactVelB,contactVelA);
        const impactSpeed=Math.max(0,-contactRelativeVel.dot(satNormal));
        if(impactSpeed>2.6){
          const energy=0.5*Math.max(0.15,body.mass||1)*impactSpeed*impactSpeed;
          const strength=Math.min(18,energy*0.25);
          if(strength>=0.65){
            body.structuralImpactCooldown=0.24;
            queueStructuralImpact(target,owner,satContact,strength,satNormal);
          }
        }
      }
      const intactRootSupport=!!(target&&owner===target.root&&
        !target.fieldRevealed&&!target.fragmented);
      const structuralSupport=!!((kind&&
        (kind==='cell'||kind==='roof'||kind==='trim')&&ownerData&&!ownerData.released)||
        intactRootSupport);
      if(structuralSupport){
        body.structuralSupport=true;
        body.supported=true;
        body.staticSupported=true;
        if(body.supportChunks&&body.supportChunks.indexOf(owner)<0)
          body.supportChunks.push(owner);
        /* A slab can come to rest on a wall face, not only on its top face.
           Remember the first intact structural contact so the body may settle
           as a static leaner and can still be woken when that support fails. */
        if(!body.supportChunk)body.supportChunk=owner;
      }
      if(satNormal.y<-DEBRIS_SUPPORT_Y){
        body.supported=true;
        body.staticSupported=true;
        if(structuralSupport){
          body.supportChunk=owner;
          if(body.supportChunks&&body.supportChunks.indexOf(owner)<0)
            body.supportChunks.push(owner);
        }
      }
      resolveRigidContact(body,staticBody,penetration,satNormal,satContact,
        pairRestitution(body,staticBody,DEBRIS_CHUNK_RESTITUTION),
        pairFriction(body,staticBody,DEBRIS_STATIC_FRICTION));
    }
  }
}

function resolveSettledChunks(body){
  for(const c of getSettledCandidates(body)){
    const staticBody=c.userData;
    if(!staticBody||!staticBody.half||!staticBody.axes)continue;
    if(!broadphaseHit(body,staticBody))continue;
    const penetration=findObbContact(body,staticBody);
    if(penetration>=0){
      if(satNormal.y<-DEBRIS_SUPPORT_Y){
        body.supported=true;body.staticSupported=true;body.supportChunk=c;
        if(body.supportChunks&&body.supportChunks.indexOf(c)<0)body.supportChunks.push(c);
      }
      resolveRigidContact(body,staticBody,penetration,satNormal,satContact,
        pairRestitution(body,staticBody,DEBRIS_CHUNK_RESTITUTION),
        pairFriction(body,staticBody,DEBRIS_STATIC_FRICTION));
    }
  }
}

function simulateChunkStep(dt){
  debrisPhysicsStep=(debrisPhysicsStep+1)%2147483647;
  debrisContactDt=dt;
  for(const c of chunks){
    const ud=c.userData;
    ud.supported=false;
    ud.staticSupported=false;
    ud.structuralSupport=false;
    ud.supportChunk=null;
    if(ud.supportChunks)ud.supportChunks.length=0;
    ud.impactCooldown=Math.max(0,(ud.impactCooldown||0)-dt);
    ud.structuralImpactCooldown=Math.max(0,(ud.structuralImpactCooldown||0)-dt);
    ud.position=c.position;
    ud.vel.y-=DEBRIS_GRAVITY*dt;
    const drag=Math.pow(DEBRIS_AIR_DRAG,dt*60);
    ud.vel.multiplyScalar(drag);
    ud.angVel.multiplyScalar(Math.pow(DEBRIS_ANGULAR_DRAG,dt*60));
    c.position.addScaledVector(ud.vel,dt);
    integrateChunkRotation(c,dt);
    updateChunkAxes(ud);
    updateChunkBounds(ud);
  }

  /* Keep the full contact quality for ordinary piles. A saturated collapse
     still integrates every body at 120 Hz and keeps the exact OBB/friction/
     angular response, but uses one bounded all-body pass followed by a narrow
     second pass over only bodies that actually touched another moving body.
     That restores the extra constraint propagation that makes a dense pile
     settle like rigid slabs without bringing back the old all-pairs hitch. */
  const saturated=chunks.length>260;
  /* The base constraint pass still runs at 120 Hz. On a saturated pile the
     narrow corrective pass only needs to run every second fixed step; that is
     still a 60 Hz contact refresh, while a render frame that consumes several
     fixed steps does not pay for several extra pile passes. */
  const refineSaturated=saturated&&
    (debrisPhysicsStep%DEBRIS_CONTACT_REFINE_INTERVAL===0);
  const solverIterations=saturated?1:(chunks.length>192
    ?Math.max(3,DEBRIS_SOLVER_ITERATIONS-1):DEBRIS_SOLVER_ITERATIONS);
  for(let iteration=0;iteration<solverIterations;iteration++){
    for(const c of chunks){
      const ud=c.userData;
      resolveStaticBoxes(ud);
      resolveSettledChunks(ud);
      resolveGround(ud);
      updateChunkBounds(ud);
    }
    /* Distant active bodies are filtered through a transient XZ hash, but do
       not rebuild that hash for every Gauss-Seidel iteration. The first pass
       captures exact contacts, middle passes refine those same OBB pairs, and
       the final pass rebuilds once more so angular/positional corrections can
       expose a newly touching neighbour before the fixed step ends. */
    const rebuildContacts=iteration===0||iteration===solverIterations-1;
    resolveActiveChunkPairs(!rebuildContacts,rebuildContacts);
  }
  if(refineSaturated){
    /* A second Gauss-Seidel pass is restricted to the contact island captured
       above. Bodies that are still flying do not pay for another broadphase or
       receive an artificial sleep impulse. */
    resolveActiveChunkPairs(true);
  }
  flushStructuralImpactEvents();
  /* Real contact friction removes the last sliding/rolling energy, but a large
     rubble pile can spend many frames with a shallow edge contact that produces
     almost no normal impulse. Apply a small material-aware viscous loss only to
     bodies that are actually supported and already below a moving-contact speed
     cap. This is continuous contact dissipation, not a timer or a teleport to a
     sleep pose, and it lets the structural release wave keep finding slots. */
  for(const c of chunks){
    const ud=c.userData;
    if(!ud.supported)continue;
    const materialDamping=ud.fractureKind==='glass'?1.8:
      (ud.fractureKind==='wood'?3.0:4.1);
    const speed=ud.vel.length();
    if(speed<1.4)ud.vel.multiplyScalar(Math.exp(-materialDamping*debrisContactDt));
    const spin=ud.angVel.length();
    if(spin<2.6)ud.angVel.multiplyScalar(Math.exp(-materialDamping*0.72*debrisContactDt));
  }
  /* A body only leaves the active solver after the contact solve has kept both
     translation and rotation effectively motionless on real support for a few
     fixed steps. There is no time-only settle pause: a moving shard stays
     dynamic, and a later wake can restore the same rigid body. */
  activeChunkSet.clear();
  for(const c of chunks)activeChunkSet.add(c);
  /* Recompute support reachability for this solver step. A rubble island may
     contain several dynamic contacts, but it is only eligible to sleep when
     its low-energy support path reaches a real static/ground contact. */
  supportPathStamp++;
  if(supportPathStamp>=2147483647)supportPathStamp=1;
  for(let i=chunks.length-1;i>=0;i--){
    const c=chunks[i],ud=c.userData;
    const lowEnergy=ud.vel.lengthSq()<=DEBRIS_REST_SPEED*DEBRIS_REST_SPEED&&
      ud.angVel.lengthSq()<=DEBRIS_REST_SPIN*DEBRIS_REST_SPIN;
    const stableSupport=ud.staticSupported||hasStaticSupportPath(ud);
    const quietSupport=ud.staticSupported||hasQuietSupportPath(ud);
    /* A body may be supported through several still-dynamic pieces, but it can
       only become static after that support graph reaches ground/static rubble.
       This lets a quiet pile settle bottom-up while an airborne or cyclic
       support island remains a real rigid-body simulation. */
    if(!ud.supported||!stableSupport||!quietSupport||
       (ud.structuralSupport&&!ud.supportChunk)||!lowEnergy){
      ud.restFrames=0;
      continue;
    }
    ud.restFrames=Math.min(DEBRIS_SLEEP_FRAMES,(ud.restFrames||0)+1);
    if(ud.restFrames<DEBRIS_SLEEP_FRAMES)continue;
    staticizeChunk(c);
  }
}

function releaseFractureChunks(dt){
  let released=0;
  /* Once a pile is already large, leave a little more time for contact solving
     and traversal updates. This spreads only bookkeeping/activation cost; it
     never turns an energetic piece into static rubble or skips its physics. */
  const releaseBudget=chunks.length>240?20:FRACTURE_RELEASE_BUDGET;
  const releaseWave=new Set();
  for(let i=fractureQueue.length-1;i>=0;i--){
    if(released>=releaseBudget)break;
    const event=fractureQueue[i];
    event.delay-=dt;
    if(event.delay>0)continue;
    /* Do not let an upper slab become a free-floating projectile while its
       vertical face support is intact. Once that real load path is gone it is
       handed to the rigid solver immediately; gravity, contact, and angular
       momentum decide the collapse from that point on. There is no artificial
       settle timer. */
    const supports=event.supportCells||(event.support?[event.support]:[]);
    const braces=event.forceCollapse?[]:(event.braceCells||[]);
    fractureFailureDir.set(0,0,0);
    /* The base course carries the building's load through the ground. An
       ordinary local breach must not make every untouched foundation cell
       fall just because it has no higher cell in the graph; the base only
       leaves when it is directly broken or the event is an intentional
       catastrophic collapse. */
     if(!event.directHit&&!event.forceCollapse&&event.grounded){
       event.mesh.userData.fractureQueued=false;
       fractureQueueByMesh.delete(event.mesh);
       fractureQueue.splice(i,1);
       continue;
     }
    if(!event.directHit&&supports.length){
      let live=0;
      let failed=0;
      fractureFailureCenter.set(0,0,0);
      for(const support of supports){
        /* A support released earlier in this same sweep is still live for
           this decision. It becomes a failed load path on the next physics
           tick, which gives collapse a causal wave instead of a single-frame
           queue cascade. Once that tick arrives, hand the cell to the rigid
           solver even if the released piece still overlaps it: the exact OBB
           contact decides whether the pieces remain stacked or separate. */
        if(support&&(!support.userData.released||releaseWave.has(support)))live++;
        else if(support){fractureFailureCenter.add(support.position);failed++;}
      }
      for(const brace of braces){
        if(brace&&(!brace.userData.released||releaseWave.has(brace)))live++;
        else if(brace){fractureFailureCenter.add(brace.position);failed++;}
      }
       const required=Math.max(1,event.requiredSupports||1);
       if(live>=required){
         /* This cell is still supported. Do not keep polling it forever; the
            support-release path re-arms it when the load path changes. */
         event.mesh.userData.fractureQueued=false;
         fractureQueueByMesh.delete(event.mesh);
         fractureQueue.splice(i,1);
         continue;
       }
      if(failed){
        fractureFailureCenter.multiplyScalar(1/failed);
        fractureFailureDir.subVectors(fractureFailureCenter,event.mesh.position);
        fractureFailureDir.y=0;
        if(fractureFailureDir.lengthSq()>0.001)fractureFailureDir.normalize();
      }
    }
    if(!event.directHit&&fractureFailureDir.lengthSq()<0.001){
      /* A perfectly centered column failure has no radial direction, but a
         tall rigid block is still unstable. Use a deterministic, very small
         bias so each piece tips into contact instead of dropping as a frozen
         vertical tile; it remains gravity-driven and collision-resolved. */
      const u=event.mesh&&event.mesh.userData||{};
      const sx=u.gridX===undefined?Math.floor(event.mesh.position.x*10):u.gridX+1;
      const sz=u.gridZ===undefined?Math.floor(event.mesh.position.z*10):u.gridZ+1;
      const angle=h3(sx,((u.gridY===undefined?0:u.gridY)+1)*19,sz)*Math.PI*2;
      fractureFailureDir.set(Math.cos(angle),0,Math.sin(angle));
    }
    const c=event.mesh;
    const parent=c.userData&&c.userData.parent;
    if(parent&&!parent.fieldRevealed)
      revealFractureField(parent,event.epicenter,event.blastForce);
    /* The active-body budget is a performance guard, not a physics shortcut.
       The old overflow path turned a freshly failed, still-energetic piece into
       static rubble immediately. That created an invisible settle pause and
       made a large collapse look like a shape swap. Keep the event queued until
       the solver can retire a body that is already supported and motionless;
       every released piece then receives the same gravity, contact, and angular
       integration as the rest of the collapse. */
    if(chunks.length>=MAX_CHUNKS&&!freeChunkSlot(event.epicenter)){
      event.delay=DEBRIS_FIXED_STEP;
      continue;
    }
    if(parent&&parent.groupShell){
      /* One logical group cell may promote several authored child meshes. Make
         room for the whole release wave before detaching any of them; the
         active cap must never force half a compound prop into an untracked
         state or silently freeze the remainder. */
      let needed=0;
      for(const record of parent.groupShellPieces||[])
        if(!record.retired&&record.cell===c)needed++;
      while(chunks.length+needed>MAX_CHUNKS){
        if(!freeChunkSlot(event.epicenter))break;
      }
      if(chunks.length+needed>MAX_CHUNKS){
        event.delay=DEBRIS_FIXED_STEP;
        continue;
      }
    }
    c.userData.fractureQueued=false;
    const groupBodyCount=parent&&parent.groupShell?
      activateGroupShellCell(parent,c,event.epicenter,event.blastForce,
        event.directHit,fractureFailureDir):null;
    if(groupBodyCount===null){
      const staticBox=c.userData.fractureBox;
      if(staticBox){
        removePhysicsBox(staticBox);
        c.userData.fractureBox=null;
      }
      /* A settled fragment may have been resting on this intact cell. The
         support is now leaving the static field, so wake that dependent body
         before the released cell starts moving. */
      wakeSettledDependents(c,event.epicenter,Math.max(0.6,event.blastForce*0.35));
      activateChunk(c,event.epicenter,event.blastForce,event.directHit,fractureFailureDir);
      chunks.push(c);
      debrisKilled++;
      c.visible=true;
    }else{
      /* The logical fracture cell carries the support graph, while the
         authored child meshes above are the visible rigid bodies. Keep the
         logical cell hidden so it cannot double-render a coarse replacement. */
      c.visible=false;
      debrisKilled+=groupBodyCount;
    }
    released++;
    c.userData.released=true;
    if(parent){
      parent.releasedCount=(parent.releasedCount||0)+1;
      maybeHideDetachedStructuralRoot(parent);
    }
     releaseWave.add(c);
     queueFractureDependents(c,event);
    fractureQueueByMesh.delete(c);
    fractureQueue.splice(i,1);
  }
  if(released)updateStatsUI();
}

const DEBRIS_SHADOW_DISTANCE=38,DEBRIS_RECEIVE_DISTANCE=64;
function updateDebrisVisualBudget(){
  const castDistanceSq=DEBRIS_SHADOW_DISTANCE*DEBRIS_SHADOW_DISTANCE;
  const receiveDistanceSq=DEBRIS_RECEIVE_DISTANCE*DEBRIS_RECEIVE_DISTANCE;
  const update=(c)=>{
    const dx=c.position.x-camera.position.x,dy=c.position.y-camera.position.y,dz=c.position.z-camera.position.z;
    const distanceSq=dx*dx+dy*dy+dz*dz;
    /* Keep nearby rubble fully lit and receiving shadows. Far fragments still
       render, but stop contributing expensive shadow-map passes where the
       camera cannot resolve their individual silhouettes. */
    c.castShadow=distanceSq<=castDistanceSq;
    c.receiveShadow=distanceSq<=receiveDistanceSq;
  };
  for(const c of chunks)update(c);
  for(const c of settledFragments)update(c);
}

function updateChunks(dt){
  if(chunks.length||settledFragments.length)updateDebrisVisualBudget();
  if(deferredSettledWakes.length)flushDeferredSettledWakes();
  /* The render loop already clamps dt; preserve the full fixed-step backlog so
     debris never gets an artificial time jump or a fake frozen settle. */
  if(chunks.length===0&&fractureQueue.length===0&&deferredSettledWakes.length===0){
    debrisAccumulator=0;
    if(climbGraphDirty){
      if(climbGraphAddedMeshes.size||climbGraphRemovedMeshes.size)
        refreshClimbGraphIncremental();
      else rebuildClimbGraph(false);
      climbGraphDirty=false;
    }
    return;
  }
  debrisAccumulator+=Math.max(0,dt);
  releaseFractureChunks(dt);
  if(climbGraphDirty){
    if(climbGraphAddedMeshes.size||climbGraphRemovedMeshes.size)
      refreshClimbGraphIncremental();
    else rebuildClimbGraph(false);
    climbGraphDirty=false;
  }
  let steps=0;
  while(debrisAccumulator>=DEBRIS_FIXED_STEP&&steps<DEBRIS_MAX_SUBSTEPS){
    simulateChunkStep(DEBRIS_FIXED_STEP);
    debrisAccumulator-=DEBRIS_FIXED_STEP;
    steps++;
  }
  if(deferredSettledWakes.length)flushDeferredSettledWakes();
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
