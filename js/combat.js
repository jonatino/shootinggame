/* Weapons, projectiles, explosions, and structural damage. Loaded in order from index.html. */
const WEAPONS={
  pistol:{name:'PISTOL',mag:12,reserve:48,dmg:22,rof:0.16,spread:0.005,max:96},
  rifle:{name:'RIFLE',mag:30,reserve:90,dmg:14,rof:0.09,spread:0.012,max:150},
  shotgun:{name:'SHOTGUN',mag:6,reserve:24,dmg:9,rof:0.55,spread:0.08,pellets:7,max:36},
  rpg:{name:'RPG',mag:1,reserve:99,dmg:250,rof:0.7,spread:0,max:99,projectile:'rocket'}
};
const playerWpn={cur:'rpg',mag:1,reserve:99,cooldown:0,reloading:0};
const shotTargets=[];
function collectShotTargets(){
  shotTargets.length=0;
  for(const mesh of occluders)shotTargets.push(mesh);
  for(const e of enemies)if(e.alive)shotTargets.push(...e.voxelMeshes);
  for(const d of dummies)if(d.alive)shotTargets.push(...d.voxelMeshes);
  shotTargets.push(ground);
  return shotTargets;
}
/* Small-arms fire can create several short-lived tracer and impact meshes per
   frame. Recycle the meshes and their per-instance materials so sustained
   fire does not turn visual feedback into a garbage-collection hitch. */
const bulletEffectPools={tracer:[],spark:[]};
function acquireBulletEffect(kind){
  const pool=bulletEffectPools[kind]||bulletEffectPools.tracer;
  let line=pool.pop();
  if(!line){
    const material=kind==='tracer'
      ?new THREE.MeshBasicMaterial({color:0xfff066,transparent:true,opacity:1.0})
      :new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:1.0,
        blending:THREE.AdditiveBlending,depthWrite:false});
    line=new THREE.Mesh(kind==='tracer'?geoBullet:geoSpark,material);
    line.userData.bulletEffectKind=kind;
  }
  line.visible=true;
  line.material.opacity=1;
  line.quaternion.identity();
  line.scale.set(1,1,1);
  return line;
}
function releaseBulletEffect(line){
  if(!line)return;
  scene.remove(line);
  line.visible=false;
  line.material.opacity=0;
  const pool=bulletEffectPools[line.userData.bulletEffectKind]||bulletEffectPools.tracer;
  pool.push(line);
}
const shotEye=V(),shotAimPoint=V(),shotStart=V(),shotBaseDir=V(),shotRayDir=V(),
  shotSpread=V(),shotEnd=V(),shotVector=V(),shotMid=V(),shotAxis=V();
function wpnStats(){return WEAPONS[playerWpn.cur];}
function setWeapon(name){
  if(!WEAPONS[name])return;
  if(WEAPONS[playerWpn.cur]&&playerWpn.cur!==name){
    WEAPONS[playerWpn.cur]._savedMag=playerWpn.mag;
    WEAPONS[playerWpn.cur]._savedRes=playerWpn.reserve;
  }
  playerWpn.cur=name;
  const w=WEAPONS[name];
  playerWpn.mag=w._savedMag!==undefined?w._savedMag:w.mag;
  playerWpn.reserve=w._savedRes!==undefined?Math.min(w.max,w._savedRes):w.reserve;
  playerWpn.reloading=0;
  if(typeof updateGunVisual==='function')updateGunVisual();
  updateStatsUI();
}
function startReload(){return;}
function finishReload(){}

/* Keep the RPG powerful at the impact point without turning a near miss into
   a map-wide damage pulse. Self splash is tighter still and respects cover. */
const RPG_BLAST_RADIUS=3.4;
const RPG_SELF_DAMAGE_RADIUS=1.75;
const RPG_SELF_DAMAGE=36;

function distanceToBox(point,box){
  const dx=point.x<box.min.x?box.min.x-point.x:(point.x>box.max.x?point.x-box.max.x:0);
  const dy=point.y<box.min.y?box.min.y-point.y:(point.y>box.max.y?point.y-box.max.y:0);
  const dz=point.z<box.min.z?box.min.z-point.z:(point.z>box.max.z?point.z-box.max.z:0);
  return Math.hypot(dx,dy,dz);
}

const blastRayDir=V(),blastTarget=V(),blastPlayerTarget=V(),blastMarkNormal=V();
const blastClosestPoint=V(),blastCandidatePoint=V();
function destructibleBlastTarget(dObj,point,out){
  if(!dObj||!dObj.fragmented||!dObj.fracturePrepared){
    dObj.worldBox.clampPoint(point,out);
    return out;
  }
  let bestSq=Infinity;
  const considerBox=box=>{
    if(!box)return;
    box.clampPoint(point,blastCandidatePoint);
    const dx=blastCandidatePoint.x-point.x,dy=blastCandidatePoint.y-point.y,
      dz=blastCandidatePoint.z-point.z,dsq=dx*dx+dy*dy+dz*dz;
    if(dsq<bestSq){bestSq=dsq;out.copy(blastCandidatePoint);}
  };
  const considerBody=body=>{
    if(!body||body.minX===undefined)return;
    blastCandidatePoint.set(
      Math.max(body.minX,Math.min(point.x,body.maxX)),
      Math.max(body.minY,Math.min(point.y,body.maxY)),
      Math.max(body.minZ,Math.min(point.z,body.maxZ))
    );
    const dx=blastCandidatePoint.x-point.x,dy=blastCandidatePoint.y-point.y,
      dz=blastCandidatePoint.z-point.z,dsq=dx*dx+dy*dy+dz*dz;
    if(dsq<bestSq){bestSq=dsq;out.copy(blastCandidatePoint);}
  };
  for(const c of dObj.cells||[]){
    const ud=c&&c.userData;
    if(!ud)continue;
    if(ud.fractureBox)considerBox(ud.fractureBox);
    else if(ud.released)considerBody(ud);
  }
  for(const extra of dObj.structuralExtras||[]){
    const mesh=extra&&extra.mesh,ud=mesh&&mesh.userData;
    if(!mesh||ud&&ud.released)continue;
    considerBox(ud&&ud.fractureBox);
  }
  if(bestSq===Infinity)dObj.worldBox.clampPoint(point,out);
  return out;
}
function destructibleBlastDistance(dObj,point){
  destructibleBlastTarget(dObj,point,blastClosestPoint);
  return blastClosestPoint.distanceTo(point);
}
function blastExposure(epicenter,dObj){
  destructibleBlastTarget(dObj,epicenter,blastTarget);
  blastRayDir.subVectors(blastTarget,epicenter);
  const distance=blastRayDir.length();
  if(distance<0.1)return 1;
  blastRayDir.multiplyScalar(1/distance);
  rc.set(epicenter,blastRayDir);rc.far=distance-0.06;rc.near=0.04;
  const hits=rc.intersectObjects(occluders,false);
  let blockers=0;
  for(const hit of hits){
    const object=hit.object,ud=object&&object.userData;
    /* Ignore the target's own intact root and its already-cooked cells. A
       different solid between the epicenter and the target is actual cover. */
    if(object===dObj.root||object===dObj.roof||object===dObj.trimTop||
       (ud&&ud.parent===dObj)||
       (ud&&ud.voxelStructure&&ud.voxelStructure.dObj===dObj)||
       (ud&&ud.structuralRoot===dObj.root)||object===ground)continue;
    blockers++;
    if(blockers>=2)break;
  }
  return blockers?Math.pow(0.38,blockers):1;
}

function blastExposureToPlayer(epicenter){
  blastPlayerTarget.set(player.pos.x,player.pos.y+1.0,player.pos.z);
  blastRayDir.subVectors(blastPlayerTarget,epicenter);
  const distance=blastRayDir.length();
  if(distance<0.1)return 1;
  blastRayDir.multiplyScalar(1/distance);
  /* Start just outside the impact point so a rocket embedded in a wall does
     not count that same wall twice before checking the player's cover. */
  const origin=blastTarget.copy(epicenter).addScaledVector(blastRayDir,0.08);
  rc.set(origin,blastRayDir);rc.far=Math.max(0.05,distance-0.12);rc.near=0.01;
  const hits=rc.intersectObjects(occluders,false);
  let blockers=0;
  for(const hit of hits){
    const object=hit.object;
    if(object===ground)continue;
    /* A moving/settled fracture cell is still real cover. Count the first
       solid barrier and stop; multiple translucent overlaps should not make
       the player completely immune. */
    blockers++;
    if(blockers>=1)break;
  }
  return blockers?0.22:1;
}

function fireRocket(start,dir){
  const rocket=new THREE.Mesh(geoRocket,matRocket);
  rocket.castShadow=true;
  rocket.position.copy(start);
  rocket.quaternion.setFromUnitVectors(UP,dir);
  scene.add(rocket);
  rockets.push({
    mesh:rocket,pos:start.clone(),vel:dir.clone().multiplyScalar(45),
    life:4.0,trailTimer:0,dir:dir.clone()
  });
}

function explode(epicenter){
  Sfx.explosion();
  const R=RPG_BLAST_RADIUS;
  /* A second blast can catch pieces still in the release queue; they are not
     magically immune just because their parent structure has already fractured. */
  for(const event of fractureQueue){
    const box=event.mesh.userData.fractureBox;
    const dist=box?distanceToBox(epicenter,box):Infinity;
    if(dist<=R){
      const falloff=1-dist/R;
      event.delay=0;
      event.directHit=true;
      event.epicenter=epicenter;
      event.blastForce=Math.max(event.blastForce,12*falloff);
    }
  }
  /* Previously settled rubble can be disturbed by a later blast. This keeps
     the scene interactive after the first collapse without simulating every
     piece forever. */
  applyBlastToActiveDebris(epicenter,10);
  voxelPhysics.blastChunks(epicenter,10);
  for(const d of destructibles){
    /* A fractured structure remains addressable: later blasts can punch the
       standing section apart even after its original root mesh is gone. */
    if(!d.voxelManaged&&!d.alive&&!d.fragmented&&!d.fracturePrepared)continue;
    if(d.voxelManaged&&(!d.voxelStructure||!d.voxelStructure.activeN))continue;
    /* A blast affects the nearest surface, not only the object's centre. */
    const dist=destructibleBlastDistance(d,epicenter);
    if(dist>R)continue;
    const falloff=1-dist/R;
    const exposedFalloff=falloff*blastExposure(epicenter,d);
    /* Voxel damage is already visible as removed cells and exposed edges.
       The old flat fracture decal has no surface to remain attached to once
       cells detach, so on voxel structures it appears to float in mid-air. */
    if(!d.voxelManaged&&exposedFalloff>0.18){
      blastMarkNormal.copy(blastRayDir).negate();
      if(blastMarkNormal.lengthSq()<0.01)blastMarkNormal.copy(UP);
      spawnStructuralMark(epicenter,blastMarkNormal,
        Math.min(0.38,0.12+exposedFalloff*0.18));
    }
    if(!d.destroyed)d.hp-=exposedFalloff*90;
    if(!d.destroyed&&d.hp<=0){
      shatterBuilding(d,epicenter,10*exposedFalloff);
    }else if(d.fragmented||exposedFalloff>0.3){
      /* The first strong hit removes only the local cells. The remaining
         structure stays load-bearing until a later hit or a support failure
         propagates through it, which gives the building a believable damaged
         phase instead of an all-or-nothing transformation. */
      fractureBuildingAt(d,epicenter,10*exposedFalloff,false);
    }
  }
  for(const e of enemies){
    if(!e.alive)continue;
    const dist=V().subVectors(e.pos,epicenter).length();
    if(dist>R)continue;
    const dmg=Math.round(120*(1-dist/R));
    e.hp-=dmg;
    if(e.hp<=0){
      e.alive=false;
      burstVoxelActor(e,epicenter,11*(1-dist/R)+4);
      scene.remove(e.group);
      kills++;
    }else{
      const to=V().subVectors(e.pos,epicenter).normalize();
      e.pos.addScaledVector(to,2*(1-dist/R));
    }
  }
  for(const d of dummies){
    if(!d.alive)continue;
    const dist=d.pos.distanceTo(epicenter);if(dist>R)continue;
    d.hp-=Math.round(100*(1-dist/R));
    d.tilt=Math.min(1.5,d.tilt+0.8*(1-dist/R));
    if(d.hp<=0){
      d.alive=false;d.respawn=8;
      burstVoxelActor(d,epicenter,10*(1-dist/R)+3.5);
    }
  }
  blastPlayerTarget.set(player.pos.x,player.pos.y+1.0,player.pos.z);
  const pDist=blastPlayerTarget.distanceTo(epicenter);
  if(pDist<RPG_SELF_DAMAGE_RADIUS){
    const cover=blastExposureToPlayer(epicenter);
    const dmg=Math.round(RPG_SELF_DAMAGE*(1-pDist/RPG_SELF_DAMAGE_RADIUS)*cover);
    if(dmg>0){player.hp-=dmg;showHit();}
    if(player.hp<=0){
      player.hp=100;player.pos.set(8,0,16);player.vel.set(0,0,0);player.mode='ground';player.landingSurface=null;
    }
    updateStatsUI();
  }
  const flash=new THREE.Mesh(
    geoFlash,
    new THREE.MeshBasicMaterial({color:0xfff4a0,transparent:true,opacity:0.95})
  );
  flash.position.copy(epicenter);
  scene.add(flash);
  explosions.push({mesh:flash,life:0.4,lifeMax:0.4,scale:1,maxScale:4.5});
  for(let i=0;i<20;i++){
    const p=makeParticleMesh(geoParticle,'smoke',0x6a6a6a);
    p.scale.setScalar(0.8+Math.random()*1);
    p.position.copy(epicenter);
    const ang=Math.random()*Math.PI*2;
    const r=Math.random()*0.5;
    p.userData.vel=V(Math.cos(ang)*r,2+Math.random()*3,Math.sin(ang)*r);
    p.userData.life=1.4+Math.random()*0.6;
    p.userData.lifeMax=p.userData.life;
    scene.add(p);
    addParticle(p);
  }
  for(let i=0;i<15;i++){
    const p=makeParticleMesh(geoFire,'fire',0xffb04a);
    p.scale.setScalar(0.85+Math.random()*0.35);
    p.position.copy(epicenter);
    const dir=new THREE.Vector3(rand(-1,1),rand(0.3,1),rand(-1,1)).normalize();
    p.userData.vel=dir.multiplyScalar(8+Math.random()*8);
    p.userData.life=0.6+Math.random()*0.3;
    p.userData.lifeMax=p.userData.life;
    scene.add(p);
    addParticle(p);
  }
  camShake=Math.min(0.6,camShake+0.5);
}

let muzzleLight=null;
function ensureMuzzleLight(){
  if(muzzleLight)return muzzleLight;
  muzzleLight=new THREE.PointLight(0xffc46a,0,14,2);
  scene.add(muzzleLight);
  return muzzleLight;
}
function spawnMuzzle(start,dir){
  const ml=ensureMuzzleLight();
  ml.position.copy(start).addScaledVector(dir,0.4);
  ml.intensity=3.5;
  ml.life=0.05;
  for(let i=0;i<3;i++){
    const f=makeParticleMesh(geoFire,'fire',0xffc46a);
    f.scale.setScalar(0.65+Math.random()*0.45);
    f.position.copy(start).addScaledVector(dir,0.35+Math.random()*0.3);
    f.userData.vel=V(rand(-0.6,0.6),rand(-0.4,0.8),rand(-0.6,0.6));
    f.userData.life=0.06+Math.random()*0.05;f.userData.lifeMax=f.userData.life;
    scene.add(f);
    addParticle(f);
  }
}
function spawnImpact(point,normal,color){
  for(let i=0;i<6;i++){
    const p=makeParticleMesh(geoImpact,'impact',color||0xffd9a0);
    p.scale.setScalar(0.7+Math.random()*0.65);
    p.position.copy(point);
    p.userData.vel=V(rand(-2,2),rand(0,2.5),rand(-2,2)).normalize().multiplyScalar(2+Math.random()*3);
    p.userData.life=0.25+Math.random()*0.2;p.userData.lifeMax=p.userData.life;
    scene.add(p);
    addParticle(p);
  }
}

const damageMarkAxis=V(0,0,1),damageMarkNormal=V();
function spawnStructuralMark(point,normal,size){
  damageMarkNormal.copy(normal||UP).normalize();
  const mark=makeParticleMesh(geoDamage,'mark',0x30261f);
  mark.position.copy(point).addScaledVector(damageMarkNormal,0.018);
  mark.quaternion.setFromUnitVectors(damageMarkAxis,damageMarkNormal);
  mark.scale.setScalar(Math.max(0.035,size||0.08));
  mark.userData.life=3.2+Math.random()*1.4;
  mark.userData.lifeMax=mark.userData.life;
  mark.userData.opacityScale=0.78;
  mark.userData.staticScale=true;
  scene.add(mark);
  addParticle(mark);
}

function structuralTargetForMesh(mesh){
  const ud=mesh&&mesh.userData;
  if(ud&&ud.voxelChunk&&ud.voxelChunk.st)return ud.voxelChunk.st.dObj;
  if(ud&&ud.voxelStructure)return ud.voxelStructure.dObj;
  if(ud&&ud.parent&&ud.parent.cells)return ud.parent;
  if(ud&&ud.structuralRoot){
    for(const d of destructibles)if(d.root===ud.structuralRoot)return d;
  }
  for(const d of destructibles)
    if(mesh===d.root||mesh===d.roof||mesh===d.trimTop)return d;
  return null;
}

const structuralLocalPoint=V(),structuralInverse=new THREE.Matrix4();
function structuralCellForPoint(dObj,point){
  if(!dObj||!dObj.cells||!dObj.cells.length)return null;
  const grid=dObj.grid;
  const root=dObj.root;
  const matrix=dObj.rootMatrix||(root&&root.matrixWorld);
  if(grid&&matrix){
    structuralInverse.copy(matrix).invert();
    structuralLocalPoint.copy(point).applyMatrix4(structuralInverse);
    const ix=Math.max(0,Math.min(grid.nx-1,Math.floor(
      (structuralLocalPoint.x-(grid.ox-dObj.size.x*0.5))/grid.cellW)));
    const iy=Math.max(0,Math.min(grid.ny-1,Math.floor(
      (structuralLocalPoint.y-(grid.oy-dObj.size.y*0.5))/grid.cellH)));
    const iz=Math.max(0,Math.min(grid.nz-1,Math.floor(
      (structuralLocalPoint.z-(grid.oz-dObj.size.z*0.5))/grid.cellD)));
    const cell=dObj.cellGrid&&dObj.cellGrid[ix]&&dObj.cellGrid[ix][iy]&&dObj.cellGrid[ix][iy][iz];
    if(cell&&!cell.userData.released)return cell;
  }
  let best=null,bestDist=Infinity;
  for(const cell of dObj.cells){
    if(cell.userData.released)continue;
    const dist=cell.userData.fractureBox?distanceToBox(point,cell.userData.fractureBox):cell.position.distanceToSquared(point);
    if(dist<bestDist){bestDist=dist;best=cell;}
  }
  return best;
}

function resolveStructuralExtraSupports(dObj,extra){
  if(!dObj||!extra||extra.supportCells)return extra;
  const mesh=extra.mesh,grid=dObj.grid,cellGrid=dObj.cellGrid;
  if(!mesh||!grid||!cellGrid){
    extra.supportCells=extra.cell?[extra.cell]:[];
    extra.requiredSupports=1;
    return extra;
  }
  const extraBox=box3Of(mesh);
  const extraCenterY=(extraBox.min.y+extraBox.max.y)*0.5;
  const overlapsXZ=(cell)=>{
    const box=cell.userData.fractureBox||box3Of(cell);
    return Math.min(extraBox.max.x,box.max.x)-Math.max(extraBox.min.x,box.min.x)>0.025&&
      Math.min(extraBox.max.z,box.max.z)-Math.max(extraBox.min.z,box.min.z)>0.025;
  };
  let supportRow=-1;
  if(extra.kind==='roof'||mesh===dObj.roof||mesh===dObj.trimTop){
    /* The roof and cap trim are supported by the top course, not by the one
       arbitrary cell nearest their center. */
    supportRow=grid.ny-1;
  }else{
    let bestScore=Infinity;
    for(let iy=0;iy<grid.ny;iy++){
      let count=0,centerY=0;
      for(let ix=0;ix<grid.nx;ix++)for(let iz=0;iz<grid.nz;iz++){
        const cell=cellGrid[ix][iy][iz];
        if(!cell||!overlapsXZ(cell))continue;
        const box=cell.userData.fractureBox||box3Of(cell);
        centerY+=(box.min.y+box.max.y)*0.5;count++;
      }
      if(!count)continue;
      centerY/=count;
      const score=Math.abs(centerY-extraCenterY)-Math.min(0.12,count*0.01);
      if(score<bestScore){bestScore=score;supportRow=iy;}
    }
  }
  if(supportRow<0)supportRow=Math.max(0,Math.min(grid.ny-1,grid.ny-1));
  const supports=[];
  for(let ix=0;ix<grid.nx;ix++)for(let iz=0;iz<grid.nz;iz++){
    const cell=cellGrid[ix][supportRow][iz];
    if(cell&&overlapsXZ(cell))supports.push(cell);
  }
  if(!supports.length&&extra.cell)supports.push(extra.cell);
  extra.supportCells=supports;
  extra.cell=supports[0]||extra.cell||null;
  /* A slab supported over a row can tolerate a local missing cell, but should
     release once most of its support line is gone. One-cell attachments keep
     the exact one-support behavior used by small trims and props. */
  extra.requiredSupports=Math.max(1,Math.min(supports.length,
    Math.ceil(supports.length*0.25)));
  return extra;
}

function voxelCellAt(dObj,x,y,z){
  const grid=dObj&&dObj.grid,cellGrid=dObj&&dObj.cellGrid;
  if(!grid||!cellGrid||x<0||x>=grid.nx||y<0||y>=grid.ny||z<0||z>=grid.nz)return null;
  return cellGrid[x][y][z];
}
function voxelCellIsLive(cell){
  const ud=cell&&cell.userData;
  return !!(ud&&!ud.released&&!ud.fractureQueued);
}
function voxelIndexForCell(dObj,cell){
  const grid=dObj&&dObj.grid,ud=cell&&cell.userData;
  if(!grid||!ud)return -1;
  return (ud.gridY*grid.nz+ud.gridZ)*grid.nx+ud.gridX;
}
function ensureVoxelSupportField(dObj){
  const grid=dObj&&dObj.grid;
  if(!grid)return null;
  const count=grid.nx*grid.ny*grid.nz;
  let field=dObj.voxelField;
  if(!field||field.count!==count){
    field={
      count,
      load:new Float32Array(count),
      inflight:new Float32Array(count),
      supportDistance:new Uint16Array(count),
      unstable:new Uint8Array(count),
      queue:new Int32Array(count)
    };
    dObj.voxelField=field;
  }
  return field;
}

/* The reference demo routes load through a support-distance field instead of
   polling a timed settle queue. Our authored fracture cells are the game's
   voxels, so apply the same rule to the existing structural grid: vertical
   support wins, side faces can carry a load when they have a shorter path to
   ground, and a disconnected or overloaded cell becomes a real fracture
   candidate. Nothing here changes a mesh or its shape. */
function solveVoxelSupportField(dObj){
  const grid=dObj&&dObj.grid,field=ensureVoxelSupportField(dObj);
  if(!grid||!field)return null;
  field.supportDistance.fill(VOXEL_SUPPORT_MAX_DISTANCE);
  field.load.fill(0);field.inflight.fill(0);field.unstable.fill(0);
  let qHead=0,qTail=0;
  const seed=(cell)=>{
    if(!voxelCellIsLive(cell))return;
    const index=voxelIndexForCell(dObj,cell);
    if(index<0||field.supportDistance[index]!==VOXEL_SUPPORT_MAX_DISTANCE)return;
    field.supportDistance[index]=0;
    field.queue[qTail++]=index;
  };
  for(const cell of dObj.cells){
    const ud=cell.userData;
    if(!voxelCellIsLive(cell))continue;
    if(ud.gridY===0||voxelCellIsLive(voxelCellAt(dObj,ud.gridX,ud.gridY-1,ud.gridZ)))seed(cell);
  }
  while(qHead<qTail){
    const index=field.queue[qHead++];
    const x=index%grid.nx,z=Math.floor(index/grid.nx)%grid.nz,y=Math.floor(index/(grid.nx*grid.nz));
    const nextDistance=Math.min(VOXEL_SUPPORT_MAX_DISTANCE-1,field.supportDistance[index]+1);
    const neighbours=[
      voxelCellAt(dObj,x-1,y,z),voxelCellAt(dObj,x+1,y,z),
      voxelCellAt(dObj,x,y,z-1),voxelCellAt(dObj,x,y,z+1)
    ];
    for(const next of neighbours){
      if(!voxelCellIsLive(next))continue;
      const nextIndex=voxelIndexForCell(dObj,next);
      if(field.supportDistance[nextIndex]!==VOXEL_SUPPORT_MAX_DISTANCE)continue;
      field.supportDistance[nextIndex]=nextDistance;
      field.queue[qTail++]=nextIndex;
    }
  }

  /* Two passes mirror the reference's inflight load propagation. A top course
     can hand load sideways before the lower course is evaluated, so keeping a
     second pass avoids making the answer depend on x/z iteration order. */
  for(let pass=0;pass<VOXEL_SUPPORT_PASSES;pass++){
    for(let y=grid.ny-1;y>=0;y--)for(let x=0;x<grid.nx;x++)for(let z=0;z<grid.nz;z++){
      const cell=voxelCellAt(dObj,x,y,z);
      if(!voxelCellIsLive(cell))continue;
      const index=voxelIndexForCell(dObj,cell);
      const load=1+field.inflight[index];
      field.inflight[index]=0;
      if(pass===VOXEL_SUPPORT_PASSES-1)field.load[index]=load;
      if(y===0)continue;
      const below=voxelCellAt(dObj,x,y-1,z);
      const belowIndex=voxelIndexForCell(dObj,below);
      if(voxelCellIsLive(below)&&field.supportDistance[belowIndex]!==VOXEL_SUPPORT_MAX_DISTANCE){
        field.inflight[belowIndex]+=load;
        continue;
      }
      const distance=field.supportDistance[index];
      const side=[];
      for(const next of [
        voxelCellAt(dObj,x-1,y,z),voxelCellAt(dObj,x+1,y,z),
        voxelCellAt(dObj,x,y,z-1),voxelCellAt(dObj,x,y,z+1)
      ]){
        if(!voxelCellIsLive(next))continue;
        const nextIndex=voxelIndexForCell(dObj,next);
        if(field.supportDistance[nextIndex]<distance)side.push(nextIndex);
      }
      if(!side.length){
        field.unstable[index]=1;
        continue;
      }
      const share=load/side.length+VOXEL_SUPPORT_PREMIUM*Math.min(distance,8);
      for(const nextIndex of side)field.inflight[nextIndex]+=share;
    }
  }
  const materialScale=dObj.fractureKind==='glass'?0.72:
    (dObj.fractureKind==='wood'?0.86:1);
  const capacity=VOXEL_CRUSH_LOAD*(1+grid.ny*0.18)*materialScale;
  for(const cell of dObj.cells){
    const ud=cell.userData,index=voxelIndexForCell(dObj,cell);
    if(!voxelCellIsLive(cell)){
      ud.voxelLoad=0;ud.voxelSupportDistance=VOXEL_SUPPORT_MAX_DISTANCE;ud.voxelUnstable=false;
      continue;
    }
    const supported=field.supportDistance[index]!==VOXEL_SUPPORT_MAX_DISTANCE;
    const overloaded=field.load[index]>capacity&&ud.gridY>0;
    const overhang=field.load[index]>VOXEL_OVERHANG_LOAD&&ud.gridY>0&&!supported;
    ud.voxelLoad=field.load[index];
    ud.voxelSupportDistance=field.supportDistance[index];
    ud.voxelUnstable=!!(field.unstable[index]||overloaded||overhang);
    if(ud.voxelUnstable)field.unstable[index]=1;
  }
  dObj.voxelFieldRevision=(dObj.voxelFieldRevision||0)+1;
  return field;
}

function damageStructureFromBullet(dObj,mesh,point,dir,w,normal){
  if(!dObj||(!dObj.voxelManaged&&!dObj.alive&&!dObj.fragmented))return;
  if(dObj.voxelManaged){
    const meshData=mesh&&mesh.userData;
    const power=w.name==='SHOTGUN'?0.72:(w.name==='RIFLE'?0.34:0.18);
    const broke=meshData&&meshData.voxelChunk
      ?voxelPhysics.damageChunk(mesh,dir,power*3)
      :voxelPhysics.damageAt(dObj.voxelStructure,point,power,dir);
    if(!dObj.destroyed)dObj.hp-=power*3.5;
    if(dObj.hp<=0){dObj.alive=false;dObj.destroyed=true;}
    if(broke)spawnDebrisDust(point,Math.min(1,0.35+power));
    return;
  }
  /* Small arms chip the facade; they do not convert the whole building into a
     grid on the first hit. Repeated fire accumulates structural damage, while
     a shotgun concentrates enough force to matter locally. */
  const damage=w.name==='SHOTGUN'?3.0:(w.name==='RIFLE'?1.8:0.55);
  dObj.hp-=damage;
  spawnStructuralMark(point,normal,Math.min(0.16,0.045+damage*0.012));
  const ud=mesh&&mesh.userData;
  const cell=ud&&ud.parent===dObj&&ud.cellRef&&!ud.cellRef.userData.released
    ?ud.cellRef:(ud&&ud.kind==='cell'&&ud.parent===dObj&&!ud.released
      ?mesh:structuralCellForPoint(dObj,point));
  let localBreak=false;
  if(cell){
    const cellDamage=w.name==='SHOTGUN'?3.0:(w.name==='RIFLE'?1.8:0.55);
    const materialResistance=dObj.fractureKind==='glass'?0.62:
      (dObj.fractureKind==='wood'?0.84:1);
    const threshold=(w.name==='SHOTGUN'?9.0:(w.name==='RIFLE'?10.8:16.5))*
      materialResistance;
    cell.userData.impactDamage=(cell.userData.impactDamage||0)+cellDamage;
    if(cell.userData.impactDamage>=threshold){
      cell.userData.impactDamage=0;
      materializeFracture(dObj);
      localBreak=queueFractureCell(dObj,cell,point,
        Math.min(5,1.4+cellDamage*0.65),true,false);
    }
  }
  if(ud&&ud.kind==='cell'&&ud.released){
    const body=ud;
    const kick=(w.name==='SHOTGUN'?1.35:(w.name==='RIFLE'?0.55:0.2))/Math.max(0.25,body.mass||1);
    body.vel.addScaledVector(dir,kick);
    body.angVel.y+=kick*0.7;
    body.sleeping=false;
  }
  if(localBreak){
    spawnDebrisDust(point,Math.min(1,0.34+damage*0.12));
  }
  if(!dObj.destroyed&&dObj.hp<=0)
    shatterBuilding(dObj,point,Math.min(8,1.4+damage*0.55));
}

function damageStructureFromImpact(dObj,mesh,point,strength,normal){
  if(!dObj||(!dObj.voxelManaged&&!dObj.alive&&!dObj.fragmented)||strength<0.5)return false;
  if(dObj.voxelManaged){
    const meshData=mesh&&mesh.userData;
    if(meshData&&meshData.voxelChunk)
      return voxelPhysics.damageChunk(mesh,normal||UP,Math.min(6,strength*0.2));
    return voxelPhysics.damageAt(dObj.voxelStructure,point,
      Math.min(1.2,strength*0.13),normal||UP);
  }
  const ud=mesh&&mesh.userData;
  const cell=ud&&ud.parent===dObj&&ud.cellRef&&!ud.cellRef.userData.released
    ?ud.cellRef:(ud&&ud.kind==='cell'&&ud.parent===dObj&&!ud.released
      ?mesh:structuralCellForPoint(dObj,point));
  if(!cell)return false;
  /* A falling slab transfers a bounded amount of local energy to the wall. It
     can punch the cell it actually hits, but it does not turn a single impact
     into a radial explosion or launch the whole structure. */
  const materialKind=dObj.fractureKind||'masonry';
  const globalDamageScale=materialKind==='glass'?0.46:
    (materialKind==='wood'?0.38:0.31);
  const globalDamage=Math.min(4.5,strength*globalDamageScale);
  if(!dObj.destroyed)dObj.hp-=globalDamage;
  cell.userData.impactDamage=(cell.userData.impactDamage||0)+strength;
  structuralImpactMarkNormal.copy(normal||UP).negate();
  spawnStructuralMark(point,structuralImpactMarkNormal,Math.min(0.22,0.055+strength*0.009));
  /* A contact load breaks brittle glass before a masonry course, while wood
     yields in between. This is a material failure threshold, not a timed
     release: the fragment still enters the same rigid solver only after the
     accumulated impact energy crosses it. */
  const impactThreshold=materialKind==='glass'?4.6:
    (materialKind==='wood'?6.4:(materialKind==='roof'?5.8:8.2));
  if(cell.userData.impactDamage<impactThreshold){
    if(!dObj.destroyed&&dObj.hp<=0)shatterBuilding(dObj,point,Math.min(8,1.2+strength*0.24));
    return false;
  }
  cell.userData.impactDamage=0;
  materializeFracture(dObj);
  const broke=queueFractureCell(dObj,cell,point,Math.min(5,0.8+strength*0.3),true,false);
  if(broke){
    spawnDebrisDust(point,Math.min(1,0.3+strength*0.035));
  }
  if(!dObj.destroyed&&dObj.hp<=0)shatterBuilding(dObj,point,Math.min(8,1.2+strength*0.24));
  return broke;
}

function queueStructuralImpact(dObj,mesh,point,strength,normal){
  structuralImpactEvents.push({
    dObj,mesh,point:point.clone(),strength,
    normal:(normal||UP).clone()
  });
}

function flushStructuralImpactEvents(){
  for(const event of structuralImpactEvents)
    damageStructureFromImpact(event.dObj,event.mesh,event.point,event.strength,event.normal);
  structuralImpactEvents.length=0;
}

function spawnDebrisDust(point,intensity){
  const count=intensity>0.75?2:1;
  for(let i=0;i<count;i++){
    const p=makeParticleMesh(geoSmoke,'smoke',0x776d61);
    p.scale.setScalar((1.8+Math.random()*1.4)*intensity);
    p.userData.baseScale=p.scale.x;
    p.position.set(point.x+rand(-0.16,0.16),Math.max(0.04,point.y+0.04),point.z+rand(-0.16,0.16));
    p.userData.vel=V(rand(-0.65,0.65)*intensity,0.45+Math.random()*0.8*intensity,rand(-0.65,0.65)*intensity);
    p.userData.life=0.55+Math.random()*0.3;
    p.userData.lifeMax=p.userData.life;
    p.userData.opacityScale=0.34;
    scene.add(p);
    addParticle(p);
  }
}

function shoot(){
  const w=wpnStats();
  if(playerWpn.cooldown>0||playerWpn.reloading>0)return;
  playerWpn.cooldown=w.rof;
  const recoil=weaponRecoilProfiles[w.name]||weaponRecoilProfiles.RPG;
  weaponRecoilKick=Math.min(1.35,weaponRecoilKick+recoil.load);
  weaponRecoilPitch=Math.min(0.3,weaponRecoilPitch+recoil.pitch);
  weaponRecoilRoll=Math.max(-0.14,Math.min(0.14,
    weaponRecoilRoll+(Math.random()-0.5)*recoil.roll));
  const shotSnd={PISTOL:Sfx.pistol,RIFLE:Sfx.rifle,SHOTGUN:Sfx.shotgun,RPG:Sfx.rpg};
  if(shotSnd[w.name])shotSnd[w.name]();
  const kickAmp=w.projectile==='rocket'?0.05:(w.name==='SHOTGUN'?0.055:(w.name==='RIFLE'?0.028:0.035));
  camPitchKick+=kickAmp;
  camFovKick=Math.max(camFovKick,2.5);
  const crossEl=document.getElementById('cross');
  crossEl.classList.remove('recoil');void crossEl.offsetWidth;crossEl.classList.add('recoil');
  const eye=shotEye.set(player.pos.x,player.pos.y+1.55,player.pos.z);
  camera.getWorldDirection(tmpDir);
  tmpDir.normalize();
  const aimPoint=shotAimPoint.copy(camera.position).addScaledVector(tmpDir,80);
  const camDir=shotBaseDir.subVectors(aimPoint,eye).normalize();
  /* Fire from the rendered muzzle so the projectile, flash, and weapon stay aligned. */
  const start=shotStart.fromArray(weaponMuzzlePoints[playerWpn.cur]||weaponMuzzlePoints.rpg);
  guy.updateMatrixWorld(true);
  gunGroup.localToWorld(start);
  spawnMuzzle(start,camDir);
  if(w.projectile==='rocket'){
    shotSpread.set((Math.random()-0.5)*0.02,(Math.random()-0.5)*0.02,(Math.random()-0.5)*0.02);
    const dir=shotRayDir.copy(camDir).add(shotSpread).normalize();
    fireRocket(start,dir);
    updateStatsUI();
    return;
  }
  const pellets=w.pellets||1;
  const targets=collectShotTargets();
  for(let p=0;p<pellets;p++){
    shotSpread.set((Math.random()-0.5)*w.spread,(Math.random()-0.5)*w.spread,(Math.random()-0.5)*w.spread);
    const dir=shotRayDir.copy(camDir).add(shotSpread).normalize();
    rc.set(start,dir);rc.far=120;rc.near=0.1;
    const hits=rc.intersectObjects(targets,false);
    const end=shotEnd.copy(start).addScaledVector(dir,80);
    let hitTarget=null,hitKind=null,structuralTarget=null;
    if(hits.length){
      end.copy(hits[0].point);
      const obj=hits[0].object;
      for(const e of enemies){
        if(e.alive&&actorContainsMesh(e,obj)){hitTarget=e;hitKind='enemy';break;}
      }
      if(!hitTarget){
        for(const d of dummies){
          if(d.alive&&actorContainsMesh(d,obj)){hitTarget=d;hitKind='dummy';break;}
        }
      }
      if(!hitTarget)structuralTarget=structuralTargetForMesh(obj);
    }
    const v3=shotVector.subVectors(end,start);
    const len=v3.length();
    if(len<0.05)continue;
    const mid=shotMid.copy(start).addScaledVector(v3,0.5);
    const tracer=acquireBulletEffect('tracer');
    tracer.scale.y=Math.max(0.001,len);
    tracer.position.copy(mid);
    tracer.quaternion.setFromUnitVectors(UP,shotAxis.copy(v3).normalize());
    scene.add(tracer);
    bulletLines.push({line:tracer,life:0.45,lifeMax:0.45});
    const spark=acquireBulletEffect('spark');
    spark.position.copy(end);
    scene.add(spark);
    bulletLines.push({line:spark,life:0.28,lifeMax:0.28});
    if(hits.length&&hits[0].face){
      const inrm=wn(hits[0],hits[0].object,worldNormalScratch);
      spawnImpact(end,inrm);
    }
    if(hitTarget&&hitKind==='enemy'){
      Sfx.hit();
      showMarker();
      hitTarget.hp-=w.dmg;
      if(hitTarget.hp<=0){
        hitTarget.alive=false;
        Sfx.kill();
        burstVoxelActor(hitTarget,end,7.5);
        scene.remove(hitTarget.group);
        makePickup('ammo',hitTarget.pos.x,hitTarget.pos.z);
        kills++;
      }
    }else if(hitTarget&&hitKind==='dummy'){
      Sfx.hit();
      hitTarget.hp-=w.dmg;
      hitTarget.tilt=Math.min(1.5,hitTarget.tilt+0.4);
      if(hitTarget.hp<=0){
        hitTarget.alive=false;
        hitTarget.respawn=8;
        burstVoxelActor(hitTarget,end,6.5);
      }
    }else if(structuralTarget){
      damageStructureFromBullet(structuralTarget,hits[0].object,end,dir,w,
        hits[0].face?wn(hits[0],hits[0].object,worldNormalScratch):UP);
    }
  }
  updateStatsUI();
}
