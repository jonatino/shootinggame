/* Renderer, audio, shared state, broadphase, and effects pools. Loaded in order from index.html. */
'use strict';
const errBox=document.getElementById('err');
window.addEventListener('error',e=>{
  errBox.style.display='block';
  errBox.textContent='⚠ '+(e.message||'script error')+' (line '+(e.lineno||'?')+')';
});

/* ---- lightweight synthesized SFX (no assets, WebAudio) ---- */
const Sfx=(()=>{
  let ctx=null,master=null,muted=true;
  const DEFAULT_GAIN=0.5;
  const audioStateBox=document.getElementById('audio');
  function updateAudioUi(){if(audioStateBox)audioStateBox.textContent=muted?'AUDIO OFF':'AUDIO ON';}
  function ac(){
    if(muted)return null;
    if(!ctx){
      const AC=window.AudioContext||window.webkitAudioContext;
      if(!AC)return null;
      ctx=new AC();
      master=ctx.createGain();
      master.gain.value=DEFAULT_GAIN;
      master.connect(ctx.destination);
    }
    if(ctx.state==='suspended'){
      const resume=ctx.resume();
      if(resume&&typeof resume.catch==='function')resume.catch(()=>{});
    }
    return ctx;
  }
  function setMuted(next){
    muted=!!next;
    updateAudioUi();
    if(!muted){
      const c=ac();
      if(c&&master)master.gain.setTargetAtTime(DEFAULT_GAIN,c.currentTime,0.015);
    }else if(ctx&&master){
      master.gain.setTargetAtTime(0,ctx.currentTime,0.015);
    }
  }
  function toggle(){setMuted(!muted);return !muted;}
  function env(g,t0,peak,dur,attack){attack=attack||0.004;
    g.gain.setValueAtTime(0.0001,t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002,peak),t0+attack);
    g.gain.exponentialRampToValueAtTime(0.0001,t0+attack+dur);
  }
  function osc(type,f0,f1,dur,peak,delay,attack){
    const c=ac();if(!c)return;
    const t0=c.currentTime+(delay||0);
    const o=c.createOscillator(),g=c.createGain();
    o.type=type;o.frequency.setValueAtTime(Math.max(1,f0),t0);
    if(f1!==null)o.frequency.exponentialRampToValueAtTime(Math.max(1,f1),t0+dur);
    env(g,t0,peak,dur,attack);
    o.connect(g);g.connect(master);o.start(t0);o.stop(t0+dur+0.08+(delay||0));
  }
  function noise(dur,peak,cut,cutEnd,delay){
    const c=ac();if(!c)return;
    const t0=c.currentTime+(delay||0);
    const len=Math.max(1,Math.floor(c.sampleRate*dur));
    const buf=c.createBuffer(1,len,c.sampleRate);
    const data=buf.getChannelData(0);
    for(let i=0;i<len;i++)data[i]=(Math.random()*2-1)*(1-i/len);
    const n=c.createBufferSource();n.buffer=buf;
    const g=c.createGain(),f=c.createBiquadFilter();
    f.type='lowpass';
    f.frequency.setValueAtTime(cut,t0);
    if(cutEnd)f.frequency.exponentialRampToValueAtTime(Math.max(50,cutEnd),t0+dur);
    env(g,t0,peak,dur);
    n.connect(f);f.connect(g);g.connect(master);n.start(t0);
  }
  updateAudioUi();
  return {
    init(){if(!muted)ac();},
    toggle,
    setMuted,
    isMuted(){return muted;},
    pistol(){osc('square',540,190,0.07,0.30,null);noise(0.04,0.18,3800,900);},
    rifle(){osc('square',680,240,0.05,0.26,null);noise(0.035,0.2,4200,1100);},
    shotgun(){noise(0.22,0.5,1900,280);osc('square',210,55,0.16,0.36,null);},
    rpg(){noise(0.45,0.45,900,180);osc('sawtooth',150,38,0.42,0.4,null);},
    explosion(){noise(0.8,0.75,760,70);osc('sine',95,28,0.62,0.62,null);},
    hit(){osc('square',320,150,0.07,0.2,null);},
    hurt(){osc('sine',230,85,0.26,0.34,null);noise(0.2,0.24,1300,320);},
    pickup(){osc('sine',520,900,0.12,0.2,null);osc('sine',680,1100,0.12,0.16,null,0.05);},
    kill(){osc('square',900,420,0.08,0.2,null);osc('square',620,280,0.08,0.15,null,0.06);},
    jump(){osc('square',120,240,0.1,0.12,null);},
    reload(){noise(0.12,0.2,3000,1500);osc('sine',380,820,0.09,0.18,null,0.03);}
  };
})();

const V=(x,y,z)=>new THREE.Vector3(x,y,z);
const UP=V(0,1,0), DOWN=V(0,-1,0);

const renderer=new THREE.WebGLRenderer({antialias:true});
renderer.setSize(innerWidth,innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene=new THREE.Scene();
scene.background=new THREE.Color(0x8fb8d8);
scene.fog=new THREE.Fog(0x8fb8d8,90,260);
const camera=new THREE.PerspectiveCamera(75,innerWidth/innerHeight,0.1,500);

scene.add(new THREE.HemisphereLight(0xcfe8ff,0x6b5b45,0.85));
const sun=new THREE.DirectionalLight(0xfff2d8,1.15);
sun.position.set(40,60,25);
sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048);
sun.shadow.camera.left=-80;sun.shadow.camera.right=80;
sun.shadow.camera.top=80;sun.shadow.camera.bottom=-80;
sun.shadow.camera.far=220;
sun.shadow.bias=-0.0004;
scene.add(sun);

addEventListener('resize',()=>{
  camera.aspect=innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight);
});

const M={
  rock:new THREE.MeshPhongMaterial({color:0x8d8272,flatShading:true,shininess:8}),
  brick:new THREE.MeshLambertMaterial({color:0x9a5a46}),
  brickDark:new THREE.MeshLambertMaterial({color:0x6b3d2c}),
  stone:new THREE.MeshLambertMaterial({color:0x99958c}),
  wood:new THREE.MeshLambertMaterial({color:0x8a6a42}),
  woodDark:new THREE.MeshLambertMaterial({color:0x6f5433}),
  trim:new THREE.MeshLambertMaterial({color:0xb8a888}),
  roof:new THREE.MeshLambertMaterial({color:0x5d4436}),
  glass:new THREE.MeshPhongMaterial({color:0x8fd0e0,shininess:120,transparent:true,opacity:0.82}),
  marble:new THREE.MeshLambertMaterial({color:0xd8d4cc}),
  fabric:new THREE.MeshLambertMaterial({color:0xb04a3a,side:THREE.DoubleSide}),
  dark:new THREE.MeshLambertMaterial({color:0x2a2622}),
  sandbag:new THREE.MeshLambertMaterial({color:0xc6b888}),
  metal:new THREE.MeshPhongMaterial({color:0x444a52,shininess:60}),
  red:new THREE.MeshLambertMaterial({color:0xb83232}),
  green:new THREE.MeshLambertMaterial({color:0x3a8a48}),
  rpg:new THREE.MeshPhongMaterial({color:0x4a523a,shininess:40})
};

const proxies=[],standables=[],boxes=[],cyls=[],occluders=[];
let staticBoxGridDirty=true;
/* Camera obstruction rays used to test every visible mesh, including hundreds
   of distant settled shards after a collapse. Keep a separate static XZ hash
   for ray candidates and append only moving debris whose current bounds cross
   the ray corridor. The final ray/triangle intersection is unchanged. */
const CAMERA_OCCLUDER_GRID_CELL=8;
const cameraOccluderGrid=new Map(),cameraOccluderGridLarge=[],cameraOccluderGridCandidates=[];
const cameraDynamicOccluders=[];
const cameraRayEnd=V(),cameraRayMin=V(),cameraRayMax=V();
let cameraOccluderGridDirty=true,cameraOccluderQueryStamp=0;
function isCameraDynamicOccluder(mesh){
  const ud=mesh&&mesh.userData;
  return !!(ud&&(ud.kind==='cell'||ud.cameraFade||ud.staticFragment||ud.sleeping));
}
function cameraOccluderGridKey(x,z){return x+'_'+z;}
function addOccluder(mesh){
  if(!mesh)return mesh;
  if(occluders.indexOf(mesh)<0){
    occluders.push(mesh);
    cameraOccluderGridDirty=true;
  }
  if(isCameraDynamicOccluder(mesh)&&cameraDynamicOccluders.indexOf(mesh)<0)
    cameraDynamicOccluders.push(mesh);
  return mesh;
}
function removeOccluder(mesh){
  if(!mesh)return;
  const oi=occluders.indexOf(mesh);
  if(oi>=0){occluders.splice(oi,1);cameraOccluderGridDirty=true;}
  const di=cameraDynamicOccluders.indexOf(mesh);
  if(di>=0)cameraDynamicOccluders.splice(di,1);
}
function rebuildCameraOccluderGrid(){
  cameraOccluderGrid.clear();
  cameraOccluderGridLarge.length=0;
  for(const mesh of occluders){
    if(!mesh||isCameraDynamicOccluder(mesh))continue;
    const bounds=box3Of(mesh);
    const minX=Math.floor(bounds.min.x/CAMERA_OCCLUDER_GRID_CELL);
    const maxX=Math.floor(bounds.max.x/CAMERA_OCCLUDER_GRID_CELL);
    const minZ=Math.floor(bounds.min.z/CAMERA_OCCLUDER_GRID_CELL);
    const maxZ=Math.floor(bounds.max.z/CAMERA_OCCLUDER_GRID_CELL);
    const entry={mesh,bounds,_cameraQueryStamp:0};
    const span=(maxX-minX+1)*(maxZ-minZ+1);
    if(span>64){cameraOccluderGridLarge.push(entry);continue;}
    for(let gx=minX;gx<=maxX;gx++)for(let gz=minZ;gz<=maxZ;gz++){
      const key=cameraOccluderGridKey(gx,gz);
      let bucket=cameraOccluderGrid.get(key);
      if(!bucket){bucket=[];cameraOccluderGrid.set(key,bucket);}
      bucket.push(entry);
    }
  }
  cameraOccluderGridDirty=false;
}
function getCameraOccluderCandidates(origin,dir,far){
  if(cameraOccluderGridDirty)rebuildCameraOccluderGrid();
  cameraOccluderGridCandidates.length=0;
  let stamp=++cameraOccluderQueryStamp;
  if(stamp>=2147483647){cameraOccluderQueryStamp=1;stamp=1;}
  cameraRayEnd.copy(origin).addScaledVector(dir,far);
  const margin=0.65;
  const minX=Math.floor((Math.min(origin.x,cameraRayEnd.x)-margin)/CAMERA_OCCLUDER_GRID_CELL);
  const maxX=Math.floor((Math.max(origin.x,cameraRayEnd.x)+margin)/CAMERA_OCCLUDER_GRID_CELL);
  const minZ=Math.floor((Math.min(origin.z,cameraRayEnd.z)-margin)/CAMERA_OCCLUDER_GRID_CELL);
  const maxZ=Math.floor((Math.max(origin.z,cameraRayEnd.z)+margin)/CAMERA_OCCLUDER_GRID_CELL);
  const appendEntry=entry=>{
    if(!entry||entry._cameraQueryStamp===stamp)return;
    entry._cameraQueryStamp=stamp;
    cameraOccluderGridCandidates.push(entry.mesh);
  };
  for(let gx=minX;gx<=maxX;gx++)for(let gz=minZ;gz<=maxZ;gz++){
    const bucket=cameraOccluderGrid.get(cameraOccluderGridKey(gx,gz));
    if(bucket)for(const entry of bucket)appendEntry(entry);
  }
  for(const entry of cameraOccluderGridLarge)appendEntry(entry);
  /* Active and settled chunks move or rotate, so their broadphase entries are
     numeric bounds refreshed by the rigid solver. Query their XZ overlap here
     rather than rebuilding the static mesh hash on every physics step. */
  cameraRayMin.set(Math.min(origin.x,cameraRayEnd.x)-margin,0,Math.min(origin.z,cameraRayEnd.z)-margin);
  cameraRayMax.set(Math.max(origin.x,cameraRayEnd.x)+margin,0,Math.max(origin.z,cameraRayEnd.z)+margin);
  for(const mesh of cameraDynamicOccluders){
    const ud=mesh&&mesh.userData;
    if(!ud)continue;
    let minx,maxx,minz,maxz;
    if(ud.staticFragment&&ud.fractureBox){
      minx=ud.fractureBox.min.x;maxx=ud.fractureBox.max.x;
      minz=ud.fractureBox.min.z;maxz=ud.fractureBox.max.z;
    }else if(ud.minX!==undefined){
      minx=ud.minX;maxx=ud.maxX;minz=ud.minZ;maxz=ud.maxZ;
    }else{
      /* Unknown moving occluders are rare; retaining them is safer than
         silently allowing a camera to pass through a new dynamic asset. */
      cameraOccluderGridCandidates.push(mesh);
      continue;
    }
    if(maxx<cameraRayMin.x||minx>cameraRayMax.x||
       maxz<cameraRayMin.z||minz>cameraRayMax.z)continue;
    cameraOccluderGridCandidates.push(mesh);
  }
  return cameraOccluderGridCandidates;
}
function addPhysicsBox(box){
  if(!box)return box;
  /* Fracture cells are registered in the broadphase while the authored shell
     is still intact. Activation only flips this flag, so the first blast does
     not rebuild a several-hundred-box static grid or allocate duplicate Box3
     entries. The exact box remains the same rigid collision volume. */
  if(!box._physicsRegistered){
    box._physicsRegistered=true;
    boxes.push(box);
    staticBoxGridDirty=true;
  }
  if(box.active!==true)staticBoxGridDirty=true;
  box.active=true;
  return box;
}
function addDormantPhysicsBox(box){
  if(!box)return box;
  if(!box._physicsRegistered){
    box._physicsRegistered=true;
    boxes.push(box);
    staticBoxGridDirty=true;
  }
  box.active=false;
  return box;
}
function removePhysicsBox(box){
  if(box&&box._physicsRegistered&&box.active!==false){
    box.active=false;
    staticBoxGridDirty=true;
  }
}
let gripMeshes=[],allProxyMeshes=[],proxyByMesh=new Map(),HOLDS=[];
let climbGraphDirty=false;
const climbGraphAddedMeshes=new Set(),climbGraphRemovedMeshes=new Set();
let bulletLines=[],rockets=[],explosions=[],chunks=[],particles=[],fractureQueue=[],settledFragments=[];
const fractureQueueByMesh=new Map();
const structuralImpactEvents=[];
const settledBoxSet=new Set();
const wakingSettled=new Set();
const deferredSettledWakes=[];
let kills=0,debrisKilled=0;
const MAX_CHUNKS=300;
/* Voxel support field adapted from the local Bitgate structural reference.
   The game already cooks exact fracture cells for every building, so this
   field supplies the reference's load-bearing behavior without replacing
   authored geometry with a runtime-generated mesh. */
const VOXEL_SUPPORT_MAX_DISTANCE=255;
const VOXEL_SUPPORT_PASSES=2;
const VOXEL_SUPPORT_PREMIUM=0.05;
const VOXEL_CRUSH_LOAD=3.2;
const VOXEL_OVERHANG_LOAD=1.55;
/* A large collapse can fail dozens of cells on the same physics tick. Keep
   activation work bounded so the render thread does not hitch, while every
   released body still enters the same rigid solver on the next available tick. */
const FRACTURE_RELEASE_BUDGET=32;
const DEBRIS_GRAVITY=22;
const DEBRIS_FIXED_STEP=1/120;
/* Debris always advances at the same fixed rate. Switching to a larger catch-up
   step after a hitch made contacts change character exactly when a pile was
   trying to settle, which read as a one-frame pause/shape shift. The render
   delta is already clamped to 50 ms, so twelve 120 Hz steps cover a short
   hitch while keeping the solver bounded under a pathological stall. */
const DEBRIS_MAX_SUBSTEPS=12;
const DEBRIS_AIR_DRAG=0.998;
const DEBRIS_ANGULAR_DRAG=0.985;
const DEBRIS_GROUND_RESTITUTION=0.06;
const DEBRIS_CHUNK_RESTITUTION=0.08;
const DEBRIS_FRICTION=0.78;
const DEBRIS_STATIC_FRICTION=0.88;
const DEBRIS_SOLVER_ITERATIONS=4;
const DEBRIS_CONTACT_SLOP=0.002;
const DEBRIS_POSITION_PERCENT=0.78;
/* Sleep only after the rigid contact island is genuinely supported and its
   residual motion is below a visible threshold. The old 0.045 limits were
   tighter than the solver's contact precision, so rubble kept rolling at
   imperceptible contact motion forever and never handed off to static rubble. */
const DEBRIS_REST_SPEED=0.11;
const DEBRIS_REST_SPIN=0.10;
const DEBRIS_CONTACT_REFINE_INTERVAL=2;
const DEBRIS_CONTACT_REFINE_BUDGET=64;
/* Sleeping is a contact constraint, not an elapsed-time animation pause. A
   body has to remain supported and nearly motionless for several fixed solver
   steps before it leaves the active set; otherwise a brief corner contact can
   freeze a still-falling slab. */
const DEBRIS_SLEEP_FRAMES=18;
/* A sloped face can carry a resting body even when its contact normal is not
   close to vertical. Keep the threshold conservative so a purely vertical
   wall still cannot freeze a falling shard in place. */
const DEBRIS_SUPPORT_Y=0.18;
let debrisAccumulator=0;
let debrisPhysicsStep=0,debrisContactDt=DEBRIS_FIXED_STEP;
/* re-used effect geometry to avoid per-shot/per-particle allocation and GC churn */
const geoBullet=new THREE.CylinderGeometry(0.08,0.08,1,6);
const geoSpark=new THREE.SphereGeometry(0.22,8,6);
const geoParticle=new THREE.SphereGeometry(0.5,6,4);
const geoFlash=new THREE.SphereGeometry(2,16,12);
const geoSmoke=new THREE.SphereGeometry(0.22,5,3);
const geoFire=new THREE.SphereGeometry(0.14,5,4);
const geoImpact=new THREE.SphereGeometry(0.075,4,3);
const geoDamage=new THREE.CircleGeometry(0.12,7);
const geoRocket=new THREE.ConeGeometry(0.15,0.6,8);
const matRocket=new THREE.MeshPhongMaterial({color:0x4a3a2a});
const SHARED_GEO=new Set([geoBullet,geoSpark,geoParticle,geoFlash,geoSmoke,geoFire,geoImpact,geoDamage,geoRocket]);
const deferredGeometryDisposals=[],deferredGeometryDisposalSet=new Set();
const DEFERRED_GEOMETRY_DISPOSAL_BUDGET=6;
function deferGeometryDispose(geometry){
  if(!geometry||SHARED_GEO.has(geometry)||deferredGeometryDisposalSet.has(geometry))return;
  deferredGeometryDisposalSet.add(geometry);
  deferredGeometryDisposals.push(geometry);
}
function flushDeferredGeometryDisposals(){
  let budget=DEFERRED_GEOMETRY_DISPOSAL_BUDGET;
  while(budget-->0&&deferredGeometryDisposals.length){
    const geometry=deferredGeometryDisposals.pop();
    deferredGeometryDisposalSet.delete(geometry);
    if(geometry&&geometry.dispose)geometry.dispose();
  }
}
const dynamicChunkMaterials=new Map();
const MAX_PARTICLES=260;
/* Particle geometry is shared, but opacity is animated per instance, so the
   materials themselves cannot be shared between live effects. Recycle them by
   effect family instead of allocating and disposing dozens of WebGL material
   objects on every RPG impact. This keeps the visual blend modes unchanged
   while making repeated destruction much friendlier to the renderer/GC. */
const particleMaterialPools={smoke:[],fire:[],impact:[],mark:[]};
function acquireParticleMaterial(kind,color){
  const pool=particleMaterialPools[kind]||particleMaterialPools.smoke;
  let material=pool.pop();
  if(!material){
    if(kind==='fire'||kind==='impact')
      material=new THREE.MeshBasicMaterial({transparent:true,opacity:0.9,
        blending:THREE.AdditiveBlending,depthWrite:false});
    else if(kind==='mark')
      material=new THREE.MeshBasicMaterial({transparent:true,opacity:0.72,
        depthWrite:false,side:THREE.DoubleSide});
    else
      material=new THREE.MeshLambertMaterial({transparent:true,opacity:0.7,
        depthWrite:false});
  }
  material.color.set(color===undefined?0xffffff:color);
  material.opacity=kind==='mark'?0.72:(kind==='smoke'?0.7:0.9);
  material.transparent=true;
  material.depthWrite=false;
  if(kind==='fire'||kind==='impact')material.blending=THREE.AdditiveBlending;
  else material.blending=THREE.NormalBlending;
  if(kind==='mark')material.side=THREE.DoubleSide;
  if(!material.userData)material.userData={};
  material.userData.particlePoolLease=true;
  material.needsUpdate=true;
  return material;
}
function makeParticleMesh(geometry,kind,color){
  const p=new THREE.Mesh(geometry,acquireParticleMaterial(kind,color));
  p.userData.particleMaterialKind=kind;
  p.userData.particleMaterialReleased=false;
  return p;
}
function releaseParticleMaterial(p){
  if(!p||!p.material)return;
  if(p.userData&&p.userData.particleMaterialReleased)return;
  if(p.userData)p.userData.particleMaterialReleased=true;
  const kind=p.userData&&p.userData.particleMaterialKind;
  const pool=particleMaterialPools[kind];
  if(pool&&p.material.userData&&p.material.userData.particlePoolLease){
    p.material.opacity=0;
    p.material.userData.particlePoolLease=false;
    pool.push(p.material);
  }else if(p.material.dispose)p.material.dispose();
}
function addParticle(p){
  if(!p)return p;
  /* Effects are transient and visually interchangeable. Reclaim the oldest
     one at the cap so repeated RPG fire cannot create a garbage-collection
     spike or an unbounded transparent draw list. */
  if(particles.length>=MAX_PARTICLES){
    const old=particles.shift();
    if(old){
      scene.remove(old);
      if(old.geometry&&!SHARED_GEO.has(old.geometry))old.geometry.dispose();
      releaseParticleMaterial(old);
    }
  }
  particles.push(p);
  return p;
}
function dynamicChunkMaterial(base){
  let material=dynamicChunkMaterials.get(base);
  if(material)return material;
  material=base.clone();
  if(material.transparent){
    /* Broken glass should read as a cloud of moving shards, not as a second
       opaque blue room. Keep the intact facade's authored opacity, but make
       released transparent bodies light enough to see the player and the
       structural failure behind them. */
    material.opacity=base===M.glass?Math.min(material.opacity,0.2):Math.max(material.opacity,0.48);
    if(base===M.glass){
      /* Broken glass is a collection of independent facets. Double-sided,
         flat-shaded faces keep the authored chips readable while the lower
         alpha prevents hundreds of overlapping shards from becoming a solid
         blue wall that hides the actual collapse. */
      material.side=THREE.DoubleSide;
      material.flatShading=true;
    }
    material.depthWrite=false;
    material.needsUpdate=true;
  }
  dynamicChunkMaterials.set(base,material);
  return material;
}

const voxelPhysics=createVoxelDestructionEngine({
  THREE,scene,groundY:0,
  addStaticBox:addPhysicsBox,
  removeStaticBox:removePhysicsBox,
  addOccluder,
  removeOccluder,
  addStandable(mesh){if(standables.indexOf(mesh)<0)standables.push(mesh);},
  removeStandable(mesh){const i=standables.indexOf(mesh);if(i>=0)standables.splice(i,1);},
  pushFromObb(pos,position,half,axes,radius){
    return pushPositionFromObb(pos,position,half,axes,radius);
  },
  onDestroyed(count){
    debrisKilled+=count;
    updateStatsUI();
  }
});

function fract(n){return n-Math.floor(n);}
function h3(a,b,c){return fract(Math.sin(a*127.1+b*311.7+c*74.7)*43758.5453);}
function sm(t){return t*t*(3-2*t);}
function smooth5(t){return t*t*t*(t*(t*6-15)+10);}
function lerp(a,b,t){return a+(b-a)*t;}
function noise3(x,y,z){
  const xi=Math.floor(x),yi=Math.floor(y),zi=Math.floor(z);
  const u=sm(x-xi),v=sm(y-yi),w=sm(z-zi);
  return lerp(
    lerp(lerp(h3(xi,yi,zi),h3(xi+1,yi,zi),u),lerp(h3(xi,yi+1,zi),h3(xi+1,yi+1,zi),u),v),
    lerp(lerp(h3(xi,yi,zi+1),h3(xi+1,yi+1,zi),u),lerp(h3(xi,yi+1,zi+1),h3(xi+1,yi+1,zi),u),v),w);
}
function rand(a,b){return a+Math.random()*(b-a);}
