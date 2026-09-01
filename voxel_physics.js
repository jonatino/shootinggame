(function(root){
'use strict';

root.createVoxelDestructionEngine=function createVoxelDestructionEngine(options){
  const THREE=options.THREE,scene=options.scene;
  const addStaticBox=options.addStaticBox||(()=>{});
  const removeStaticBox=options.removeStaticBox||(()=>{});
  const addOccluder=options.addOccluder||(()=>{});
  const removeOccluder=options.removeOccluder||(()=>{});
  const addStandable=options.addStandable||(()=>{});
  const removeStandable=options.removeStandable||(()=>{});
  const pushFromObb=options.pushFromObb||null;
  const onDestroyed=options.onDestroyed||(()=>{});
  const groundY=options.groundY||0;

  const FIXED_STEP=1/120,MAX_STEPS=10,GRAVITY=30;
  const SOFT_LAND=9,ROLL_MAX=14,SHATTER_SPEED=24;
  const TOPPLE_MARGIN=0.45,TOPPLE_MIN_VOXELS=34,TOPPLE_MIN_HEIGHT=4;
  const TOPPLE_OMEGA_MAX=2.2,AIR_BREAK=9,SHED_RATE=6,SHED_MIN=24;
  const MAX_DEBRIS=3600;
  const structures=[],chunks=[];
  const topologyPending=new Set();
  let accumulator=0,structureAccumulator=0,destroyedPending=0;

  const voxelGeometry=new THREE.BoxGeometry(1,1,1);
  /* Match the prototype's instancing path exactly. Instance colors are driven
     by InstancedMesh.instanceColor; forcing material.vertexColors asks Three
     for a per-vertex color stream that this shared box geometry does not own. */
  const voxelMaterial=new THREE.MeshLambertMaterial({color:0xffffff});
  const debrisMaterial=new THREE.MeshLambertMaterial({color:0xffffff});
  const dummy=new THREE.Object3D(),tmpColor=new THREE.Color(),tmpColorB=new THREE.Color();
  const tmpPos=new THREE.Vector3(),tmpPosB=new THREE.Vector3(),tmpVel=new THREE.Vector3();
  const tmpDir=new THREE.Vector3(),tmpAxis=new THREE.Vector3(),tmpCross=new THREE.Vector3();
  const tmpContactNormal=new THREE.Vector3();
  const tmpQuat=new THREE.Quaternion(),tmpHalf=new THREE.Vector3();
  const playerAxes=[new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3()];
  const playerCubePos=new THREE.Vector3();

  function hash01(i){
    let h=Math.imul(i^0x9e3779b9,2654435761)>>>0;
    h^=h>>>15;h=Math.imul(h,2246822519)>>>0;h^=h>>>13;
    return (h>>>0)/4294967296;
  }
  function indexOf(st,x,y,z){return (y*st.nz+z)*st.nx+x;}
  function coords(st,i,out){
    out.x=i%st.nx;
    out.z=Math.floor(i/st.nx)%st.nz;
    out.y=Math.floor(i/(st.nx*st.nz));
    return out;
  }
  const coord={x:0,y:0,z:0};
  function inBounds(st,x,y,z){return x>=0&&x<st.nx&&y>=0&&y<st.ny&&z>=0&&z<st.nz;}
  function cellCenter(st,i,out){
    coords(st,i,coord);
    return out.set(
      st.origin.x+(coord.x+0.5)*st.sx,
      st.origin.y+(coord.y+0.5)*st.sy,
      st.origin.z+(coord.z+0.5)*st.sz
    );
  }
  function forNeighbours(st,i,fn){
    coords(st,i,coord);
    const x=coord.x,y=coord.y,z=coord.z;
    if(x+1<st.nx)fn(i+1);if(x>0)fn(i-1);
    if(z+1<st.nz)fn(i+st.nx);if(z>0)fn(i-st.nx);
    if(y+1<st.ny)fn(i+st.nx*st.nz);if(y>0)fn(i-st.nx*st.nz);
  }
  function setAxes(q,axes){
    const x=q.x,y=q.y,z=q.z,w=q.w;
    axes[0].set(1-2*(y*y+z*z),2*(x*y+w*z),2*(x*z-w*y));
    axes[1].set(2*(x*y-w*z),1-2*(x*x+z*z),2*(y*z+w*x));
    axes[2].set(2*(x*z+w*y),2*(y*z-w*x),1-2*(x*x+y*y));
  }

  const debrisMesh=new THREE.InstancedMesh(voxelGeometry,debrisMaterial,MAX_DEBRIS);
  debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  /* The reference debris casts shadows but does not receive them. Letting a
     shard receive the parent facade's dense instanced shadow turns the entire
     small cube black and was the source of the floating ink-blot artifacts. */
  debrisMesh.frustumCulled=false;debrisMesh.castShadow=true;debrisMesh.receiveShadow=false;
  debrisMesh.raycast=()=>{};
  debrisMesh.setColorAt(0,tmpColor.setRGB(1,1,1));
  debrisMesh.count=0;scene.add(debrisMesh);
  const dpx=new Float32Array(MAX_DEBRIS),dpy=new Float32Array(MAX_DEBRIS),dpz=new Float32Array(MAX_DEBRIS);
  const dvx=new Float32Array(MAX_DEBRIS),dvy=new Float32Array(MAX_DEBRIS),dvz=new Float32Array(MAX_DEBRIS);
  const drx=new Float32Array(MAX_DEBRIS),dry=new Float32Array(MAX_DEBRIS),drz=new Float32Array(MAX_DEBRIS);
  const dwx=new Float32Array(MAX_DEBRIS),dwy=new Float32Array(MAX_DEBRIS),dwz=new Float32Array(MAX_DEBRIS);
  const dsize=new Float32Array(MAX_DEBRIS),dage=new Float32Array(MAX_DEBRIS);
  const dcr=new Float32Array(MAX_DEBRIS),dcg=new Float32Array(MAX_DEBRIS),dcb=new Float32Array(MAX_DEBRIS);
  const dfrozen=new Uint8Array(MAX_DEBRIS);
  let debrisN=0,debrisSteal=0,debrisColorDirty=false;

  function debrisSlot(){
    if(debrisN<MAX_DEBRIS)return debrisN++;
    for(let n=0;n<64;n++){
      debrisSteal=(debrisSteal+1)%MAX_DEBRIS;
      if(dfrozen[debrisSteal])return debrisSteal;
    }
    debrisSteal=(debrisSteal+1)%MAX_DEBRIS;
    return debrisSteal;
  }
  function spawnDebris(x,y,z,vx,vy,vz,size,r,g,b){
    const k=debrisSlot();
    dpx[k]=x;dpy[k]=y;dpz[k]=z;dvx[k]=vx;dvy[k]=vy;dvz[k]=vz;
    drx[k]=Math.random()*Math.PI*2;dry[k]=Math.random()*Math.PI*2;drz[k]=Math.random()*Math.PI*2;
    dwx[k]=(Math.random()-0.5)*8;dwy[k]=(Math.random()-0.5)*8;dwz[k]=(Math.random()-0.5)*8;
    dsize[k]=Math.max(0.08,size);dage[k]=0;dfrozen[k]=0;
    dcr[k]=r;dcg[k]=g;dcb[k]=b;
    debrisMesh.setColorAt(k,tmpColor.setRGB(r,g,b));debrisColorDirty=true;
    return k;
  }
  function splitDebris(k){
    if(dsize[k]<0.22)return;
    const next=dsize[k]*0.52;
    spawnDebris(dpx[k]+(Math.random()-0.5)*dsize[k],dpy[k],dpz[k]+(Math.random()-0.5)*dsize[k],
      dvx[k]*0.55+(Math.random()-0.5)*4,Math.abs(dvy[k])*0.2+1+Math.random()*2,
      dvz[k]*0.55+(Math.random()-0.5)*4,next,dcr[k],dcg[k],dcb[k]);
    dsize[k]=next;dvx[k]=dvx[k]*0.55+(Math.random()-0.5)*4;
    dvy[k]=Math.abs(dvy[k])*0.2+1+Math.random()*2;dvz[k]=dvz[k]*0.55+(Math.random()-0.5)*4;
  }
  function removeDebris(k){
    const last=--debrisN;
    if(k!==last){
      dpx[k]=dpx[last];dpy[k]=dpy[last];dpz[k]=dpz[last];
      dvx[k]=dvx[last];dvy[k]=dvy[last];dvz[k]=dvz[last];
      drx[k]=drx[last];dry[k]=dry[last];drz[k]=drz[last];
      dwx[k]=dwx[last];dwy[k]=dwy[last];dwz[k]=dwz[last];
      dsize[k]=dsize[last];dage[k]=dage[last];dfrozen[k]=dfrozen[last];
      dcr[k]=dcr[last];dcg[k]=dcg[last];dcb[k]=dcb[last];
      debrisMesh.setColorAt(k,tmpColor.setRGB(dcr[k],dcg[k],dcb[k]));
      debrisColorDirty=true;
    }
  }

  function solidifyDebris(k){
    for(const st of structures){
      const x=Math.floor((dpx[k]-st.origin.x)/st.sx);
      const y=Math.floor((dpy[k]-st.origin.y)/st.sy);
      const z=Math.floor((dpz[k]-st.origin.z)/st.sz);
      if(!inBounds(st,x,y,z)||y<1)continue;
      const i=indexOf(st,x,y,z);if(st.alive[i]||!st.alive[i-st.nx*st.nz])continue;
      cellCenter(st,i,tmpPosB);
      if(Math.abs(tmpPosB.x-dpx[k])>st.sx*0.72||
         Math.abs(tmpPosB.y-dpy[k])>st.sy*0.85||
         Math.abs(tmpPosB.z-dpz[k])>st.sz*0.72)continue;
      addCell(st,x,y,z,3);st.strength[i]=55;
      st.cr[i]=dcr[k];st.cg[i]=dcg[k];st.cb[i]=dcb[k];st.damage[i]=0.4;
      addCellBox(st,i);st.destroyed=false;st.dirty=true;st.dirtyTopology=true;
      topologyPending.add(st);removeDebris(k);return true;
    }
    return false;
  }

  function addCell(st,x,y,z,type){
    const i=indexOf(st,x,y,z);if(st.alive[i])return;
    st.alive[i]=1;st.type[i]=type;st.damage[i]=0;
    const jitter=0.88+hash01(i)*0.22;
    /* Keep the reference engine's load scale. Structural load is counted in
       voxel weights, so shrinking these values into single digits makes an
       untouched multi-storey wall crush itself before any damage occurs. */
    let strength=360,r=st.baseColor.r,g=st.baseColor.g,b=st.baseColor.b;
    if(type===2){strength=380;r*=0.72;g*=0.75;b*=0.83;}
    /* Keep the prototype's floor/slab strength as well; changing this number
       alters when a damaged load path buckles even if the mesh looks equal. */
    else if(type===3){strength=40;r*=0.82;g*=0.82;b*=0.84;}
    else if(type===4){strength=360;r=0.42;g=0.66;b=0.78;}
    else{r*=0.9+jitter*0.12;g*=0.9+jitter*0.12;b*=0.9+jitter*0.12;}
    st.strength[i]=strength*jitter;
    st.cr[i]=r;st.cg[i]=g;st.cb[i]=b;
    st.posInActive[i]=st.activeN;st.activeIdx[st.activeN++]=i;
  }
  function addCellBox(st,i){
    if(st.boxes[i]&&st.boxes[i].active!==false)return;
    cellCenter(st,i,tmpPos);
    const box=new THREE.Box3(
      new THREE.Vector3(tmpPos.x-st.sx*0.5,tmpPos.y-st.sy*0.5,tmpPos.z-st.sz*0.5),
      new THREE.Vector3(tmpPos.x+st.sx*0.5,tmpPos.y+st.sy*0.5,tmpPos.z+st.sz*0.5)
    );
    box.owner=st.mesh;box.voxelIndex=i;box.voxelStructure=st;
    st.boxes[i]=box;addStaticBox(box);
  }
  function detachCell(st,i){
    if(!st.alive[i])return false;
    st.alive[i]=0;
    const p=st.posInActive[i],last=st.activeIdx[--st.activeN];
    st.activeIdx[p]=last;st.posInActive[last]=p;st.posInActive[i]=-1;
    if(st.boxes[i])removeStaticBox(st.boxes[i]);
    st.dirty=true;st.dirtyTopology=true;
    /* Props can be supported by another voxel structure (stacked crates, a
       flag on a rock, scaffolding on a slab). Whenever that support changes,
       re-run the dependent fields instead of leaving them pinned in space. */
    for(const other of structures)
      if(other!==st&&!other.anchorBase&&other.activeN)topologyPending.add(other);
    return true;
  }
  function killCell(st,i,power,dx,dy,dz,spawn){
    if(!st.alive[i])return false;
    const load=st.load[i],strength=Math.max(1,st.strength[i]);
    forNeighbours(st,i,n=>{
      if(st.alive[n])st.damage[n]+=Math.max(0,load/strength-0.35)*0.12;
    });
    cellCenter(st,i,tmpPos);
    if(spawn!==false){
      const high=power>=0.62,count=high?3:1,size=high?Math.min(st.sx,st.sy,st.sz)*0.42:Math.min(st.sx,st.sy,st.sz)*0.9;
      for(let n=0;n<count;n++)spawnDebris(
        tmpPos.x+(Math.random()-0.5)*st.sx*0.5,tmpPos.y+(Math.random()-0.5)*st.sy*0.5,tmpPos.z+(Math.random()-0.5)*st.sz*0.5,
        dx*(3+10*power)+(Math.random()-0.5)*3,dy*(3+10*power)+1+Math.random()*2,
        dz*(3+10*power)+(Math.random()-0.5)*3,size,st.cr[i],st.cg[i],st.cb[i]);
      destroyedPending++;
    }
    detachCell(st,i);topologyPending.add(st);
    return true;
  }

  function refreshStructure(st){
    if(!st.dirty)return;
    dummy.quaternion.identity();
    for(let a=0;a<st.activeN;a++){
      const i=st.activeIdx[a];coords(st,i,coord);
      dummy.position.set((coord.x+0.5)*st.sx,(coord.y+0.5)*st.sy,(coord.z+0.5)*st.sz);
      dummy.scale.set(st.sx*0.94,st.sy*0.94,st.sz*0.94);dummy.updateMatrix();
      st.mesh.setMatrixAt(a,dummy.matrix);
      st.mesh.setColorAt(a,tmpColor.setRGB(st.cr[i],st.cg[i],st.cb[i]));
      st.instanceToCell[a]=i;
    }
    st.mesh.count=st.activeN;st.mesh.instanceMatrix.needsUpdate=true;
    if(st.mesh.instanceColor)st.mesh.instanceColor.needsUpdate=true;
    st.dirty=false;
  }

  function registerBuilding(config){
    const targetSize=config.voxelSize||0.68;
    const solid=config.shape==='solid';
    const occupancy=typeof config.occupancy==='function'?config.occupancy:null;
    const detailed=solid||!!occupancy;
    const nx=Math.max(detailed?1:5,Math.round(config.width/targetSize));
    const ny=Math.max(detailed?1:6,Math.round(config.height/targetSize));
    const nz=Math.max(detailed?1:5,Math.round(config.depth/targetSize));
    const count=nx*ny*nz;
    const st={
      dObj:config.dObj||null,nx,ny,nz,count,
      materialKind:config.materialKind||'masonry',shape:solid?'solid':'shell',
      sx:config.width/nx,sy:config.height/ny,sz:config.depth/nz,
      origin:new THREE.Vector3(config.x-config.width*0.5,
        (config.y===undefined?groundY:config.y-config.height*0.5),config.z-config.depth*0.5),
      baseColor:new THREE.Color(config.color||0x999999),
      alive:new Uint8Array(count),type:new Uint8Array(count),strength:new Float32Array(count),
      damage:new Float32Array(count),load:new Float32Array(count),inflight:new Float32Array(count),
      overTime:new Float32Array(count),freeHeight:new Float32Array(count),slender:new Float32Array(count),
      supportDistance:new Uint16Array(count),grounded:new Uint8Array(count),
      activeIdx:new Int32Array(count),posInActive:new Int32Array(count),activeN:0,
      queue:new Int32Array(count),component:new Int32Array(count),mark:new Uint32Array(count),markEpoch:0,
      basin:new Int32Array(count),pathScore:new Float32Array(count),pathHops:new Int32Array(count),
      cr:new Float32Array(count),cg:new Float32Array(count),cb:new Float32Array(count),
      boxes:new Array(count),instanceToCell:new Int32Array(count),
      dirty:true,dirtyTopology:true,destroyed:false,
      anchorBase:config.anchorBase!==false,
      simulateLoads:config.simulateLoads!==false
    };
    st.posInActive.fill(-1);
    st.slender.fill(1);
    const floorStep=Math.max(4,Math.round(2.65/st.sy));
    const cx=Math.floor(nx*0.5),cz=Math.floor(nz*0.5);
    for(let y=0;y<ny;y++)for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
      if(occupancy){
        const lx=-config.width*0.5+(x+0.5)*st.sx;
        const ly=-config.height*0.5+(y+0.5)*st.sy;
        const lz=-config.depth*0.5+(z+0.5)*st.sz;
        if(!occupancy(lx,ly,lz,x,y,z,nx,ny,nz))continue;
        const type=config.cellType!==undefined?config.cellType:
          (st.materialKind==='glass'?4:(st.materialKind==='wood'?3:1));
        addCell(st,x,y,z,type);
        const i=indexOf(st,x,y,z);
        if(config.strength!==undefined)
          st.strength[i]=Math.max(1,config.strength*(0.88+hash01(i)*0.22));
        if(typeof config.colorAt==='function'){
          const sampled=config.colorAt(lx,ly,lz,x,y,z);
          if(sampled!==undefined&&sampled!==null){
            if(sampled.isColor)tmpColorB.copy(sampled);else tmpColorB.set(sampled);
            st.cr[i]=tmpColorB.r;st.cg[i]=tmpColorB.g;st.cb[i]=tmpColorB.b;
          }
        }
        continue;
      }
      if(solid){
        const type=config.cellType!==undefined?config.cellType:
          (st.materialKind==='glass'?4:(st.materialKind==='wood'?3:3));
        addCell(st,x,y,z,type);
        if(config.strength!==undefined){
          const i=indexOf(st,x,y,z);
          st.strength[i]=Math.max(1,config.strength*(0.88+hash01(i)*0.22));
        }
        continue;
      }
      const wall=x===0||x===nx-1||z===0||z===nz-1;
      /* The reference towers stand on wall/core footings, not a solid raft.
         Filling y=0 across the footprint makes the support hull nearly
         impossible to move outside the centre of mass and suppresses the
         characteristic whole-wall toppling after foundation damage. */
      const slab=y===ny-1||(y>0&&y%floorStep===0);
      const core=(x===cx||x===Math.max(0,cx-1))&&(z===cz||z===Math.max(0,cz-1));
      if(!wall&&!slab&&!core)continue;
      let type=wall?(st.materialKind==='glass'?4:1):(slab?3:2);
      if(core)type=2;
      if(wall&&!slab&&!core&&y>1){
        const band=y%floorStep;
        const along=(z===0||z===nz-1)?x:z;
        const span=(z===0||z===nz-1)?nx:nz;
        const window=band>=1&&band<=Math.min(2,floorStep-1)&&along>1&&along<span-2&&((along>>1)&1)===1;
        if(window)type=4;
      }
      addCell(st,x,y,z,type);
    }
    st.mesh=new THREE.InstancedMesh(voxelGeometry,voxelMaterial,count);
    st.mesh.position.copy(st.origin);st.mesh.castShadow=true;st.mesh.receiveShadow=true;
    st.mesh.frustumCulled=false;st.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    st.mesh.userData={kind:'voxelField',cameraFade:true,voxelStructure:st};
    st.mesh.setColorAt(0,tmpColor.setRGB(1,1,1));
    scene.add(st.mesh);addOccluder(st.mesh);addStandable(st.mesh);
    structures.push(st);
    refreshStructure(st);
    for(let a=0;a<st.activeN;a++)addCellBox(st,st.activeIdx[a]);
    if(!st.anchorBase)topologyPending.add(st);
    return st;
  }

  function computeSupport(st){
    st.grounded.fill(0);st.supportDistance.fill(65535);
    let qs=0,qe=0;
    for(let z=0;z<st.nz;z++)for(let x=0;x<st.nx;x++){
      const i=indexOf(st,x,0,z);if(!st.alive[i])continue;
      let supported=st.anchorBase;
      if(!supported){
        cellCenter(st,i,tmpPos);
        const bottom=tmpPos.y-st.sy*0.5;
        if(bottom<=groundY+0.08)supported=true;
        else{
          tmpPosB.set(tmpPos.x,bottom-0.04,tmpPos.z);
          if(findStaticVoxelAt(tmpPosB,st)){
            coords(contactStructure,contactIndex,coord);
            const top=contactStructure.origin.y+(coord.y+1)*contactStructure.sy;
            const above=coord.y+1<contactStructure.ny?
              contactIndex+contactStructure.nx*contactStructure.nz:-1;
            const tolerance=Math.max(0.11,st.sy*0.55);
            /* A pole or stacked prop may be intentionally socketed into the
               supporting voxel rather than resting on its exact top plane. */
            supported=(above<0||!contactStructure.alive[above])&&
              bottom<=top+tolerance&&
              bottom>=top-contactStructure.sy-tolerance;
          }
        }
      }
      if(supported){st.grounded[i]=1;st.queue[qe++]=i;}
    }
    while(qs<qe){
      const i=st.queue[qs++];
      forNeighbours(st,i,n=>{if(st.alive[n]&&!st.grounded[n]){st.grounded[n]=1;st.queue[qe++]=n;}});
    }
    qs=0;qe=0;
    for(let a=0;a<st.activeN;a++){
      const i=st.activeIdx[a];coords(st,i,coord);
      if(coord.y===0||(st.alive[i-st.nx*st.nz])){
        st.supportDistance[i]=0;st.queue[qe++]=i;
      }
    }
    while(qs<qe){
      const i=st.queue[qs++];coords(st,i,coord);
      const x=coord.x,y=coord.y,z=coord.z,next=st.supportDistance[i]+1;
      const visit=n=>{if(st.alive[n]&&st.supportDistance[n]===65535){st.supportDistance[n]=next;st.queue[qe++]=n;}};
      if(x+1<st.nx)visit(i+1);if(x>0)visit(i-1);
      if(z+1<st.nz)visit(i+st.nx);if(z>0)visit(i-st.nx);
    }
    st.dirtyTopology=false;
  }

  function chunkWorld(chunk,k,out){
    return out.set(chunk.lx[k],chunk.ly[k],chunk.lz[k]).applyQuaternion(chunk.mesh.quaternion).add(chunk.mesh.position);
  }
  function chunkVelocity(chunk,world,out){
    out.copy(chunk.vel);
    if(chunk.omega!==0){
      tmpCross.subVectors(world,chunk.mesh.position);
      tmpAxis.copy(chunk.axis).multiplyScalar(chunk.omega);
      tmpCross.crossVectors(tmpAxis,tmpCross);out.add(tmpCross);
    }
    return out;
  }
  function refreshChunkInstance(chunk,k){
    dummy.position.set(chunk.lx[k],chunk.ly[k],chunk.lz[k]);dummy.quaternion.identity();
    dummy.scale.set(chunk.st.sx*0.94,chunk.st.sy*0.94,chunk.st.sz*0.94);dummy.updateMatrix();
    chunk.mesh.setMatrixAt(k,dummy.matrix);
    chunk.mesh.setColorAt(k,tmpColor.setRGB(chunk.cr[k],chunk.cg[k],chunk.cb[k]));
  }
  function spawnChunk(st,list,tip){
    if(!list.length)return null;
    /* The prototype stores every detached slab bottom-up. Impact resolution
       then consumes the loaded edge first instead of exploding an arbitrary
       iteration order. */
    const sorted=Array.from(list).sort((a,b)=>(Math.floor(a/(st.nx*st.nz))-
      Math.floor(b/(st.nx*st.nz))));
    let mx=0,my=0,mz=0;
    for(const i of sorted){cellCenter(st,i,tmpPos);mx+=tmpPos.x;my+=tmpPos.y;mz+=tmpPos.z;}
    mx/=sorted.length;my/=sorted.length;mz/=sorted.length;
    const capacity=sorted.length;
    const mesh=new THREE.InstancedMesh(voxelGeometry,voxelMaterial,capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;
    mesh.castShadow=true;mesh.receiveShadow=false;mesh.position.set(mx,my,mz);
    const chunk={
      st,mesh,count:capacity,capacity,
      lx:new Float32Array(capacity),ly:new Float32Array(capacity),lz:new Float32Array(capacity),
      cr:new Float32Array(capacity),cg:new Float32Array(capacity),cb:new Float32Array(capacity),
      strength:new Float32Array(capacity),type:new Uint8Array(capacity),
      vel:new THREE.Vector3(),axis:new THREE.Vector3(1,0,0),angle:0,omega:0,alpha:0,
      mode:tip?'pivot':'free',pivot:new THREE.Vector3(),pivotOffset:new THREE.Vector3(),
      radius:0,minLocalY:Infinity,bounces:0,shedAccumulator:0,restTime:0,
      previousPosition:new THREE.Vector3(mx,my,mz),previousAngle:0
    };
    for(let k=0;k<capacity;k++){
      const i=sorted[k];cellCenter(st,i,tmpPos);
      chunk.lx[k]=tmpPos.x-mx;chunk.ly[k]=tmpPos.y-my;chunk.lz[k]=tmpPos.z-mz;
      chunk.cr[k]=st.cr[i];chunk.cg[k]=st.cg[i];chunk.cb[k]=st.cb[i];
      chunk.strength[k]=st.strength[i];chunk.type[k]=st.type[i];
      chunk.radius=Math.max(chunk.radius,Math.hypot(chunk.lx[k],chunk.ly[k],chunk.lz[k]));
      chunk.minLocalY=Math.min(chunk.minLocalY,chunk.ly[k]);
      refreshChunkInstance(chunk,k);detachCell(st,i);
    }
    mesh.count=capacity;mesh.instanceMatrix.needsUpdate=true;
    if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
    mesh.userData={kind:'voxelChunk',cameraFade:true,voxelChunk:chunk,voxelStructure:st};
    if(tip){
      chunk.axis.copy(tip.axis).normalize();chunk.pivot.copy(tip.pivot);
      chunk.pivotOffset.set(mx-tip.pivot.x,my-tip.pivot.y,mz-tip.pivot.z);
      chunk.omega=0.06;chunk.alpha=tip.alpha;
    }
    scene.add(mesh);addOccluder(mesh);addStandable(mesh);chunks.push(chunk);
    st.dirty=true;refreshStructure(st);
    return chunk;
  }

  function supportPass(st){
    computeSupport(st);
    st.markEpoch=(st.markEpoch+1)>>>0;if(st.markEpoch===0){st.mark.fill(0);st.markEpoch=1;}
    const epoch=st.markEpoch;
    for(let i=0;i<st.count;i++){
      if(!st.alive[i]||st.grounded[i]||st.mark[i]===epoch)continue;
      let qs=0,qe=0;st.queue[qe++]=i;st.mark[i]=epoch;
      while(qs<qe){
        const j=st.queue[qs++];st.component[qs-1]=j;
        forNeighbours(st,j,n=>{
          if(st.alive[n]&&!st.grounded[n]&&st.mark[n]!==epoch){st.mark[n]=epoch;st.queue[qe++]=n;}
        });
      }
      const list=Array.from(st.queue.subarray(0,qe));
      if(list.length>=4)spawnChunk(st,list,null);
      else for(const j of list)killCell(st,j,0.2,0,-0.4,0,true);
    }
  }

  function convexHull(points){
    if(points.length<=2)return points.slice();
    points.sort((a,b)=>a.x-b.x||a.z-b.z);
    const cross=(o,a,b)=>(a.x-o.x)*(b.z-o.z)-(a.z-o.z)*(b.x-o.x);
    const lower=[];
    for(const p of points){while(lower.length>=2&&cross(lower[lower.length-2],lower[lower.length-1],p)<=0)lower.pop();lower.push(p);}
    const upper=[];
    for(let i=points.length-1;i>=0;i--){const p=points[i];while(upper.length>=2&&cross(upper[upper.length-2],upper[upper.length-1],p)<=0)upper.pop();upper.push(p);}
    lower.pop();upper.pop();return lower.concat(upper);
  }
  function supportScan(points,px,pz){
    if(!points.length)return null;
    if(points.length===1)return{out:Math.hypot(px-points[0].x,pz-points[0].z),x:points[0].x,z:points[0].z};
    const hull=convexHull(points),inside=(()=>{
      if(hull.length<3)return false;
      let sign=0;
      for(let i=0;i<hull.length;i++){
        const a=hull[i],b=hull[(i+1)%hull.length];
        const c=(b.x-a.x)*(pz-a.z)-(b.z-a.z)*(px-a.x);
        if(Math.abs(c)<1e-6)continue;
        const s=c>0?1:-1;if(sign&&s!==sign)return false;sign=s;
      }
      return true;
    })();
    if(inside)return{out:0,x:px,z:pz};
    let best=Infinity,bx=points[0].x,bz=points[0].z;
    const edgeCount=hull.length===2?1:hull.length;
    for(let i=0;i<edgeCount;i++){
      const a=hull[i],b=hull[(i+1)%hull.length],ex=b.x-a.x,ez=b.z-a.z;
      const den=ex*ex+ez*ez||1,t=Math.max(0,Math.min(1,((px-a.x)*ex+(pz-a.z)*ez)/den));
      const qx=a.x+ex*t,qz=a.z+ez*t,d=Math.hypot(px-qx,pz-qz);
      if(d<best){best=d;bx=qx;bz=qz;}
    }
    return{out:best,x:bx,z:bz};
  }
  function stabilityPass(st){
    computeSupport(st);
    st.markEpoch=(st.markEpoch+1)>>>0;if(st.markEpoch===0){st.mark.fill(0);st.markEpoch=1;}
    const epoch=st.markEpoch;
    const tipJobs=[];
    for(let i=0;i<st.count;i++){
      coords(st,i,coord);
      /* y=0 is this local field's bedrock-facing footing. Excluding it from
         the body mirrors the reference grid's global bedrock layer and lets
         the supported structure pivot while its remaining footing stays put. */
      if(coord.y===0||!st.alive[i]||!st.grounded[i]||st.mark[i]===epoch)continue;
      let qs=0,qe=0,mx=0,my=0,mz=0,minY=st.ny,maxY=0;
      st.queue[qe++]=i;st.mark[i]=epoch;
      while(qs<qe){
        const j=st.queue[qs++];st.component[qs-1]=j;coords(st,j,coord);
        mx+=coord.x+0.5;my+=coord.y+0.5;mz+=coord.z+0.5;
        minY=Math.min(minY,coord.y);maxY=Math.max(maxY,coord.y);
        forNeighbours(st,j,n=>{
          coords(st,n,coord);
          if(coord.y>0&&st.alive[n]&&st.grounded[n]&&st.mark[n]!==epoch){
            st.mark[n]=epoch;st.queue[qe++]=n;
          }
        });
      }
      if(qe<TOPPLE_MIN_VOXELS||maxY-minY<TOPPLE_MIN_HEIGHT)continue;
      const supports=[];
      for(let k=0;k<qe;k++){
        const j=st.component[k];coords(st,j,coord);
        if(coord.y>0&&st.alive[j-st.nx*st.nz]&&st.mark[j-st.nx*st.nz]!==epoch){
          cellCenter(st,j,tmpPos);
          supports.push({i:j,x:tmpPos.x,z:tmpPos.z,gx:coord.x,gz:coord.z,
            strength:st.strength[j]});
        }
      }
      if(!supports.length)continue;
      const comX=st.origin.x+(mx/qe)*st.sx,comZ=st.origin.z+(mz/qe)*st.sz;
      const wholeScan=supportScan(supports,comX,comZ);if(!wholeScan)continue;

      /* Cluster comparable footing cells, then attribute the body through the
         strongest available path. A weak bridge can tear without dragging a
         healthy wall/core basin over with it—the defining v16 stability fix. */
      const supN=supports.length,uf=new Int32Array(supN);
      for(let s=0;s<supN;s++)uf[s]=s;
      const find=s=>{let r=s;while(uf[r]!==r)r=uf[r];while(uf[s]!==r){const p=uf[s];uf[s]=r;s=p;}return r;};
      for(let a=0;a<supN;a++)for(let b=a+1;b<supN;b++){
        if(Math.abs(supports[a].gx-supports[b].gx)>1||Math.abs(supports[a].gz-supports[b].gz)>1)continue;
        const ratio=Math.min(supports[a].strength,supports[b].strength)/
          Math.max(1,supports[a].strength,supports[b].strength);
        if(ratio<0.5)continue;
        const ra=find(a),rb=find(b);if(ra!==rb)uf[ra]=rb;
      }
      for(let k=0;k<qe;k++){
        const j=st.component[k];st.basin[j]=-1;st.pathScore[j]=0;st.pathHops[j]=2147483647;
      }
      const heap=[];
      const heapBetter=(a,b)=>a.score>b.score*1.25||
        (b.score<=a.score*1.25&&a.hops<b.hops);
      const heapPush=node=>{
        heap.push(node);let c=heap.length-1;
        while(c>0){const p=(c-1)>>1;if(!heapBetter(heap[c],heap[p]))break;
          const swap=heap[c];heap[c]=heap[p];heap[p]=swap;c=p;}
      };
      const heapPop=()=>{
        const top=heap[0],tail=heap.pop();if(heap.length){heap[0]=tail;let p=0;
          for(;;){const l=p*2+1,r=l+1;let best=p;
            if(l<heap.length&&heapBetter(heap[l],heap[best]))best=l;
            if(r<heap.length&&heapBetter(heap[r],heap[best]))best=r;
            if(best===p)break;const swap=heap[p];heap[p]=heap[best];heap[best]=swap;p=best;}}
        return top;
      };
      for(let s=0;s<supN;s++){
        const v=supports[s].i,score=Math.min(st.strength[v],400);
        st.basin[v]=s;st.pathScore[v]=score;st.pathHops[v]=0;
        heapPush({i:v,basin:s,score,hops:0});
      }
      while(heap.length){
        const node=heapPop(),j=node.i;
        if(st.basin[j]!==node.basin||st.pathScore[j]!==node.score||st.pathHops[j]!==node.hops)continue;
        forNeighbours(st,j,n=>{
          if(!st.alive[n]||st.mark[n]!==epoch)return;
          const score=Math.min(node.score,Math.min(st.strength[n],400)),hops=node.hops+1;
          const better=st.basin[n]<0||score>st.pathScore[n]*1.25||
            (score*1.25>=st.pathScore[n]&&hops<st.pathHops[n]);
          if(!better)return;
          st.basin[n]=node.basin;st.pathScore[n]=score;st.pathHops[n]=hops;
          heapPush({i:n,basin:node.basin,score,hops});
        });
      }

      const clusters=new Map();
      for(let s=0;s<supN;s++){
        const root=find(s);let cluster=clusters.get(root);
        if(!cluster){cluster={cells:[],supports:[],mx:0,mz:0,minY:st.ny,maxY:0};clusters.set(root,cluster);}
        cluster.supports.push(supports[s]);
      }
      for(let k=0;k<qe;k++){
        const j=st.component[k],seed=st.basin[j];if(seed<0)continue;
        const cluster=clusters.get(find(seed));if(!cluster)continue;
        coords(st,j,coord);cluster.cells.push(j);cluster.mx+=st.origin.x+(coord.x+0.5)*st.sx;
        cluster.mz+=st.origin.z+(coord.z+0.5)*st.sz;
        cluster.minY=Math.min(cluster.minY,coord.y);cluster.maxY=Math.max(cluster.maxY,coord.y);
      }
      const margin=Math.min(st.sx,st.sz)*TOPPLE_MARGIN;
      const hardOut=Math.min(st.sx,st.sz)*2.5;
      const unstable=[];let anyExtreme=false;
      for(const cluster of clusters.values()){
        if(!cluster.cells.length)continue;
        cluster.comX=cluster.mx/cluster.cells.length;cluster.comZ=cluster.mz/cluster.cells.length;
        cluster.scan=supportScan(cluster.supports,cluster.comX,cluster.comZ);
        if(!cluster.scan)continue;
        if(cluster.scan.out>hardOut)anyExtreme=true;
        if(cluster.scan.out>margin)unstable.push(cluster);
      }
      if(!unstable.length||wholeScan.out<=margin&&!anyExtreme)continue;
      for(const cluster of unstable){
        if(tipJobs.length>=3||cluster.cells.length<TOPPLE_MIN_VOXELS||
           cluster.maxY-cluster.minY<TOPPLE_MIN_HEIGHT)continue;
        let dx=cluster.comX-cluster.scan.x,dz=cluster.comZ-cluster.scan.z;
        const dl=Math.hypot(dx,dz)||1;dx/=dl;dz/=dl;
        const height=Math.max(st.sy,(cluster.maxY-cluster.minY+1)*st.sy);
        tipJobs.push({list:cluster.cells,tip:{
          axis:new THREE.Vector3(dz,0,-dx),
          pivot:new THREE.Vector3(cluster.scan.x,st.origin.y+st.sy*0.22,cluster.scan.z),
          alpha:2.6*GRAVITY*Math.min(cluster.scan.out,6)/(height*height)
        }});
      }
    }
    for(const job of tipJobs)spawnChunk(st,job.list,job.tip);
  }

  function solveLoads(st,dt){
    /* Compact props use topology and rigid-body support, but should not crush
       themselves merely because a detailed voxelization gives a thin post a
       large numerical cell count. Buildings keep the full load solver. */
    if(!st.activeN||!st.simulateLoads)return;
    computeSupport(st);st.inflight.fill(0);st.load.fill(0);
    for(let pass=0;pass<2;pass++){
      for(let y=st.ny-1;y>=0;y--)for(let z=0;z<st.nz;z++)for(let x=0;x<st.nx;x++){
        const i=indexOf(st,x,y,z);if(!st.alive[i])continue;
        const load=1+st.inflight[i];st.inflight[i]=0;if(pass===1)st.load[i]=load;
        if(y===0)continue;
        if(pass===0){
          let lateral=0;
          if(x+1<st.nx&&st.alive[i+1])lateral++;
          if(x>0&&st.alive[i-1])lateral++;
          if(z+1<st.nz&&st.alive[i+st.nx])lateral++;
          if(z>0&&st.alive[i-st.nx])lateral++;
          const above=i+st.nx*st.nz,hasAbove=y+1<st.ny&&st.alive[above];
          st.freeHeight[i]=lateral<=1?(hasAbove?st.freeHeight[above]+1:1):0;
          const slenderHeight=st.freeHeight[i]/4;
          st.slender[i]=1/(1+slenderHeight*slenderHeight);
        }
        const below=i-st.nx*st.nz;
        if(st.alive[below]&&st.grounded[below]){st.inflight[below]+=load;continue;}
        const d=st.supportDistance[i],effective=Math.max(0.4,st.strength[i]*(1-0.7*Math.min(st.damage[i],1))*st.slender[i]);
        let targets=[];
        const gather=strongOnly=>{
          targets=[];
          const add=n=>{
            if(!st.alive[n]||st.supportDistance[n]>=d)return;
            if(strongOnly){
              const neighbourStrength=Math.max(0.4,st.strength[n]*(1-0.7*Math.min(st.damage[n],1))*st.slender[n]);
              if(neighbourStrength<effective*0.5)return;
            }
            targets.push(n);
          };
          if(x+1<st.nx)add(i+1);if(x>0)add(i-1);if(z+1<st.nz)add(i+st.nx);if(z>0)add(i-st.nx);
        };
        gather(true);if(!targets.length)gather(false);
        if(!targets.length){st.damage[i]+=(load/effective)*1.6*dt;continue;}
        const transmitted=Math.min(load,effective*0.4);
        const share=transmitted/targets.length+0.03+0.05*Math.min(d,8);
        for(const n of targets)st.inflight[n]+=share;
        const excess=load-transmitted;
        if(excess>0)st.damage[i]+=(excess/effective)*1.6*dt;
      }
    }
    const failures=[];
    for(let a=0;a<st.activeN;a++){
      const i=st.activeIdx[a];coords(st,i,coord);if(coord.y===0)continue;
      const effective=Math.max(0.4,st.strength[i]*(1-0.7*Math.min(st.damage[i],1))*st.slender[i]);
      const u=st.load[i]/effective;
      if(u>=2.2){failures.push(i);continue;}
      if(u>=1.02){
        st.overTime[i]+=dt*(u-1)*6;
        st.damage[i]+=dt*(u-1)*0.08;
        if(st.overTime[i]>0.6||st.damage[i]>=1){failures.push(i);continue;}
      }else{
        st.overTime[i]=Math.max(0,st.overTime[i]-dt*0.5);
        if(u>=0.8)st.damage[i]+=dt*(u-0.8)*1.4*0.02;
        else if(u<0.5)st.damage[i]=Math.max(0,st.damage[i]-dt*0.015);
      }
      if(st.damage[i]>=1)failures.push(i);
      if(failures.length>=120)break;
    }
    if(failures.length){
      for(const i of failures)killCell(st,i,0.28,0,-0.35,0,true);
      processTopology(st);
    }
  }

  function spallPass(st,dt){
    if(!st.activeN)return;
    const failures=[];
    for(let a=0;a<st.activeN;a++){
      const i=st.activeIdx[a];coords(st,i,coord);
      if(coord.y===0||(st.type[i]!==1&&st.type[i]!==4)||st.damage[i]<0.15)continue;
      st.damage[i]+=0.07*dt;
      forNeighbours(st,i,n=>{
        if(st.alive[n]&&(st.type[n]===1||st.type[n]===4)&&st.damage[n]<0.9)
          st.damage[n]+=0.05*dt;
      });
      if(st.damage[i]>=1)failures.push(i);
      if(failures.length>=120)break;
    }
    if(!failures.length)return;
    for(const i of failures)killCell(st,i,0.15,0,-0.3,0,true);
    processTopology(st);
  }

  let contactStructure=null,contactIndex=-1;
  function findStaticVoxelAt(point,ignore){
    contactStructure=null;contactIndex=-1;
    for(const st of structures){
      if(st===ignore||!st.activeN)continue;
      const x=Math.floor((point.x-st.origin.x)/st.sx),y=Math.floor((point.y-st.origin.y)/st.sy),z=Math.floor((point.z-st.origin.z)/st.sz);
      if(!inBounds(st,x,y,z))continue;
      const i=indexOf(st,x,y,z);
      if(st.alive[i]){contactStructure=st;contactIndex=i;return true;}
    }
    return false;
  }
  function chunkSupportScan(chunk){
    const supports=[];
    for(let k=0;k<chunk.count;k++){
      chunkWorld(chunk,k,tmpPos);
      const bottom=tmpPos.y-chunk.st.sy*0.48;
      if(bottom<=groundY+0.08){supports.push({x:tmpPos.x,z:tmpPos.z});continue;}
      tmpPosB.set(tmpPos.x,bottom-0.04,tmpPos.z);
      if(!findStaticVoxelAt(tmpPosB,null))continue;
      coords(contactStructure,contactIndex,coord);
      const top=contactStructure.origin.y+(coord.y+1)*contactStructure.sy;
      if(Math.abs(top-bottom)<=Math.max(chunk.st.sy,contactStructure.sy)*0.3)supports.push({x:tmpPos.x,z:tmpPos.z});
    }
    if(!supports.length)return null;
    return supportScan(supports,chunk.mesh.position.x,chunk.mesh.position.z);
  }
  function removeChunk(chunk){
    removeOccluder(chunk.mesh);removeStandable(chunk.mesh);scene.remove(chunk.mesh);
    const i=chunks.indexOf(chunk);if(i>=0)chunks.splice(i,1);
  }

  function restoreChunkVoxel(chunk,k,world){
    /* Prefer the slab's own lattice, then allow it to land on a compatible
       neighboring voxel field. This is the per-building equivalent of the
       prototype's global `addVox`: a soft landing becomes load-bearing cells,
       never a rigid body whose transform is abruptly frozen. */
    for(let pass=0;pass<=structures.length;pass++){
      const st=pass===0?chunk.st:structures[pass-1];
      if(pass>0&&st===chunk.st)continue;
      const x=Math.floor((world.x-st.origin.x)/st.sx);
      const y=Math.floor((world.y-st.origin.y)/st.sy);
      const z=Math.floor((world.z-st.origin.z)/st.sz);
      if(!inBounds(st,x,y,z))continue;
      const i=indexOf(st,x,y,z);if(st.alive[i])continue;
      if(y>0&&!st.alive[i-st.nx*st.nz])continue;
      cellCenter(st,i,tmpPosB);
      if(Math.abs(tmpPosB.x-world.x)>st.sx*0.72||
         Math.abs(tmpPosB.y-world.y)>st.sy*0.82||
         Math.abs(tmpPosB.z-world.z)>st.sz*0.72)continue;
      addCell(st,x,y,z,chunk.type[k]||3);
      st.strength[i]=Math.max(1,chunk.strength[k]||55);
      st.cr[i]=chunk.cr[k];st.cg[i]=chunk.cg[k];st.cb[i]=chunk.cb[k];
      addCellBox(st,i);st.destroyed=false;st.dirty=true;st.dirtyTopology=true;
      topologyPending.add(st);
      return true;
    }
    return false;
  }

  function resolveChunkImpact(chunk,impact){
    const n=chunk.count,soft=impact<SOFT_LAND&&n<300;
    let minOY=Infinity,maxOY=-Infinity;
    for(let k=0;k<n;k++){
      minOY=Math.min(minOY,chunk.ly[k]);maxOY=Math.max(maxOY,chunk.ly[k]);
    }
    const span=Math.max(0.001,maxOY-minOY);
    const baseSize=Math.min(chunk.st.sx,chunk.st.sy,chunk.st.sz);
    let removed=0;
    for(let k=0;k<n;k++){
      chunkWorld(chunk,k,tmpPos);chunkVelocity(chunk,tmpPos,tmpVel);
      const heightFrac=1-(chunk.ly[k]-minOY)/span;
      const spinSpeed=tmpVel.length();
      const power=soft?0:Math.min(1,(impact/SHATTER_SPEED)*
        (0.35+0.65*heightFrac)*(0.7+0.6*Math.min(1,n/700))+
        spinSpeed/SHATTER_SPEED*0.55);

      /* A hard slab wounds the exact standing voxel it contacts before that
         slab voxel is resolved. This produces the prototype's footprint crush
         instead of a second radial explosion. */
      if(!soft&&findStaticVoxelAt(tmpPos,null)){
        contactStructure.damage[contactIndex]+=Math.min(1.6,power*1.8+0.3);
        if(contactStructure.damage[contactIndex]>=1)
          killCell(contactStructure,contactIndex,0.62,0,-0.5,0,true);
      }

      if((soft||power<0.3)&&restoreChunkVoxel(chunk,k,tmpPos))continue;
      removed++;
      if(power<0.3){
        spawnDebris(tmpPos.x,tmpPos.y+baseSize*0.35,tmpPos.z,
          tmpVel.x*0.4+(Math.random()-0.5)*2,Math.abs(tmpVel.y)*0.2+0.5,
          tmpVel.z*0.4+(Math.random()-0.5)*2,baseSize*0.96,
          chunk.cr[k],chunk.cg[k],chunk.cb[k]);
        continue;
      }
      const pieces=power>=0.62?4:2;
      const size=baseSize*(power>=0.62?0.25:0.5);
      const dirX=Math.random()-0.5,dirZ=Math.random()-0.5;
      for(let p=0;p<pieces;p++)spawnDebris(
        tmpPos.x+(Math.random()-0.5)*baseSize*0.6,tmpPos.y,
        tmpPos.z+(Math.random()-0.5)*baseSize*0.6,
        tmpVel.x*0.55+dirX*(2+10*power)+(Math.random()-0.5)*4,
        Math.abs(tmpVel.y)*0.3+1+Math.random()*3,
        tmpVel.z*0.55+dirZ*(2+10*power)+(Math.random()-0.5)*4,
        size,chunk.cr[k],chunk.cg[k],chunk.cb[k]);
    }
    destroyedPending+=removed;removeChunk(chunk);return true;
  }
  function shedChunk(chunk,dt){
    if(chunk.count<=SHED_MIN)return;
    const speed=Math.abs(chunk.vel.y)+Math.hypot(chunk.vel.x,chunk.vel.z)+chunk.omega*chunk.radius;
    if(speed<=AIR_BREAK){chunk.shedAccumulator=0;return;}
    chunk.shedAccumulator+=(speed-AIR_BREAK)*SHED_RATE*dt*Math.min(1,chunk.count/240);
    let quota=Math.min(5,Math.floor(chunk.shedAccumulator));chunk.shedAccumulator-=quota;
    while(quota-->0&&chunk.count>SHED_MIN){
      let best=-1,bestSpeed=-1;
      for(let n=0;n<8;n++){
        const k=(Math.random()*chunk.count)|0;chunkWorld(chunk,k,tmpPos);chunkVelocity(chunk,tmpPos,tmpVel);
        const s=tmpVel.lengthSq();if(s>bestSpeed){bestSpeed=s;best=k;}
      }
      if(best<0)break;
      chunkWorld(chunk,best,tmpPos);chunkVelocity(chunk,tmpPos,tmpVel);
      spawnDebris(tmpPos.x,tmpPos.y,tmpPos.z,tmpVel.x,tmpVel.y,tmpVel.z,
        Math.min(chunk.st.sx,chunk.st.sy,chunk.st.sz)*0.9,chunk.cr[best],chunk.cg[best],chunk.cb[best]);
      const last=--chunk.count;
      if(best!==last){
        chunk.lx[best]=chunk.lx[last];chunk.ly[best]=chunk.ly[last];chunk.lz[best]=chunk.lz[last];
        chunk.cr[best]=chunk.cr[last];chunk.cg[best]=chunk.cg[last];chunk.cb[best]=chunk.cb[last];
        chunk.strength[best]=chunk.strength[last];chunk.type[best]=chunk.type[last];
        refreshChunkInstance(chunk,best);
      }
      chunk.mesh.count=chunk.count;chunk.mesh.instanceMatrix.needsUpdate=true;
      if(chunk.mesh.instanceColor)chunk.mesh.instanceColor.needsUpdate=true;
      destroyedPending++;
    }
  }
  function chunkStep(dt){
    for(let ci=chunks.length-1;ci>=0;ci--){
      const chunk=chunks[ci];
      if(chunk.mode==='pivot'){
        chunk.omega=Math.min(TOPPLE_OMEGA_MAX,chunk.omega+chunk.alpha*(1+3*chunk.angle)*dt);
        chunk.angle+=chunk.omega*dt;tmpQuat.setFromAxisAngle(chunk.axis,chunk.angle);
        chunk.mesh.quaternion.copy(tmpQuat);
        tmpPos.copy(chunk.pivotOffset).applyQuaternion(tmpQuat).add(chunk.pivot);chunk.mesh.position.copy(tmpPos);
        let impact=0;
        for(let k=0;k<chunk.count;k++){
          chunkWorld(chunk,k,tmpPos);const dist=tmpPos.distanceTo(chunk.pivot);
          if(dist<Math.min(chunk.st.sx,chunk.st.sy,chunk.st.sz)*2.5)continue;
          const speed=chunk.omega*dist;
          if(tmpPos.y-chunk.st.sy*0.48<=groundY){impact=Math.max(impact,speed);break;}
          /* Detached cells are no longer alive, so it is safe—and essential—to
             collide with this structure too. Otherwise a falling wall can pass
             straight through the surviving corner/foundation that should catch
             it, generate torque, and break it apart. */
          if(findStaticVoxelAt(tmpPos,null)){impact=Math.max(impact,speed);break;}
        }
        if(impact>0){resolveChunkImpact(chunk,Math.max(7,impact));continue;}
        if(chunk.angle>1.3){
          chunk.mode='free';tmpAxis.copy(chunk.axis).multiplyScalar(chunk.omega);
          tmpCross.copy(chunk.mesh.position).sub(chunk.pivot);chunk.vel.crossVectors(tmpAxis,tmpCross);
        }
        shedChunk(chunk,dt);continue;
      }
      chunk.previousPosition.copy(chunk.mesh.position);chunk.previousAngle=chunk.angle;
      chunk.vel.y-=GRAVITY*dt;chunk.mesh.position.addScaledVector(chunk.vel,dt);
      chunk.angle+=chunk.omega*dt;chunk.mesh.quaternion.setFromAxisAngle(chunk.axis,chunk.angle);
      let groundContact=false,staticContact=false,minY=Infinity,staticLift=0;
      tmpContactNormal.set(0,0,0);
      for(let k=0;k<chunk.count;k++){
        chunkWorld(chunk,k,tmpPos);minY=Math.min(minY,tmpPos.y-chunk.st.sy*0.48);
        if(tmpPos.y-chunk.st.sy*0.48<=groundY)groundContact=true;
        if(findStaticVoxelAt(tmpPos,null)){
          staticContact=true;cellCenter(contactStructure,contactIndex,tmpPosB);
          const nx=(tmpPos.x-tmpPosB.x)/Math.max(0.001,contactStructure.sx);
          const ny=(tmpPos.y-tmpPosB.y)/Math.max(0.001,contactStructure.sy);
          const nz=(tmpPos.z-tmpPosB.z)/Math.max(0.001,contactStructure.sz);
          const ax=Math.abs(nx),ay=Math.abs(ny),az=Math.abs(nz);
          if(ay>=ax&&ay>=az){
            if(ny>=0){
              tmpContactNormal.set(0,1,0);
              const top=tmpPosB.y+contactStructure.sy*0.5;
              staticLift=Math.max(staticLift,top-(tmpPos.y-chunk.st.sy*0.48));
            }else if(tmpContactNormal.lengthSq()===0)tmpContactNormal.set(0,-1,0);
          }else if(tmpContactNormal.y<=0&&ax>=az)tmpContactNormal.set(nx>=0?1:-1,0,0);
          else if(tmpContactNormal.y<=0)tmpContactNormal.set(0,0,nz>=0?1:-1);
        }
      }
      const impact=Math.abs(chunk.vel.y)+Math.abs(chunk.omega)*chunk.radius*0.5;
      let supportingContact=false;
      if(staticContact){
        /* Roll back the swept pose before applying the collision impulse. A
           soft side hit must never become a sleep signal while the body is
           still embedded in—or hanging from—the wall it just left. */
        chunk.mesh.position.copy(chunk.previousPosition);chunk.angle=chunk.previousAngle;
        chunk.mesh.quaternion.setFromAxisAngle(chunk.axis,chunk.angle);
        if(tmpContactNormal.y>0&&staticLift>0)chunk.mesh.position.y+=staticLift+0.01;
        const vn=chunk.vel.dot(tmpContactNormal);
        if(vn<0)chunk.vel.addScaledVector(tmpContactNormal,-1.28*vn);
        chunk.vel.x*=0.68;chunk.vel.z*=0.68;chunk.omega*=-0.48;
        supportingContact=tmpContactNormal.y>0.5;
      }
      if(groundContact){
        /* Re-evaluate the lowest point if a wall collision rolled the pose
           back, then place the body exactly on the ground plane. */
        minY=Infinity;for(let k=0;k<chunk.count;k++){chunkWorld(chunk,k,tmpPos);minY=Math.min(minY,tmpPos.y-chunk.st.sy*0.48);}
        if(minY<groundY)chunk.mesh.position.y+=groundY-minY;
        const bounceLimit=chunk.count>800?1:3;
        /* This is the v16 slab lifecycle: moderate landings may roll a few
           times; the next contact resolves into re-cemented voxels or rubble.
           There is no timer that can stop a rigid body in mid-pose. */
        if(impact>=ROLL_MAX||chunk.bounces>=bounceLimit){
          resolveChunkImpact(chunk,impact);continue;
        }
        const horizontal=Math.hypot(chunk.vel.x,chunk.vel.z);
        if(chunk.vel.y<0)chunk.vel.y=Math.abs(chunk.vel.y)*0.28+0.5;
        chunk.vel.x*=0.72;chunk.vel.z*=0.72;chunk.bounces++;
        if(horizontal>0.5){chunk.axis.set(chunk.vel.z/horizontal,0,-chunk.vel.x/horizontal);chunk.omega=Math.min(2.3,Math.abs(chunk.omega)*0.55+horizontal*0.38);}
        else chunk.omega*=0.45;
        supportingContact=true;
      }
      const shatterThreshold=SHATTER_SPEED*(chunk.count>450?0.82:1);
      if((groundContact||staticContact)&&impact>=shatterThreshold){resolveChunkImpact(chunk,impact);continue;}
      const motion=chunk.vel.length()+Math.abs(chunk.omega)*chunk.radius;
      const support=supportingContact?chunkSupportScan(chunk):null;
      const supportMargin=Math.min(chunk.st.sx,chunk.st.sz)*0.38;
      const stableSupport=!!support&&support.out<=supportMargin;
      if(supportingContact&&!stableSupport){
        let dx,dz;
        if(support){dx=chunk.mesh.position.x-support.x;dz=chunk.mesh.position.z-support.z;}
        else{
          dx=chunk.mesh.position.x-(chunk.st.origin.x+chunk.st.nx*chunk.st.sx*0.5);
          dz=chunk.mesh.position.z-(chunk.st.origin.z+chunk.st.nz*chunk.st.sz*0.5);
        }
        const length=Math.hypot(dx,dz)||1;dx/=length;dz/=length;
        tmpAxis.set(dz,0,-dx);
        if(chunk.axis.dot(tmpAxis)<0)tmpAxis.multiplyScalar(-1);
        chunk.axis.lerp(tmpAxis,1-Math.exp(-10*dt)).normalize();
        const supportOffset=support?Math.max(support.out,supportMargin):supportMargin*1.5;
        const angularAcceleration=GRAVITY*Math.min(2.5,supportOffset)/Math.max(0.4,chunk.radius*chunk.radius);
        chunk.omega=Math.min(TOPPLE_OMEGA_MAX,Math.abs(chunk.omega)+angularAcceleration*dt);
        chunk.vel.x+=dx*GRAVITY*0.045*dt;chunk.vel.z+=dz*GRAVITY*0.045*dt;
        /* A rolled-back swept collision can otherwise repeat at exactly the
           same ledge forever. Move an unstable centre of mass infinitesimally
           past the support edge so the accumulated torque can advance. */
        chunk.mesh.position.x+=dx*0.018;chunk.mesh.position.z+=dz*0.018;
        chunk.restTime=0;
      }
      if(stableSupport&&motion<1.15){
        chunk.restTime+=dt;chunk.vel.multiplyScalar(Math.exp(-8*dt));chunk.omega*=Math.exp(-10*dt);
        /* A tiny de-jitter window is enough to confirm a support contact. The
           body then returns to the voxel field; it never enters a frozen mesh
           mode, which was the visibly impossible "pause" in the old solver. */
        if(chunk.restTime>=0.12){resolveChunkImpact(chunk,motion);continue;}
      }else if(motion>1.6)chunk.restTime=0;
      else chunk.restTime=Math.max(0,chunk.restTime-dt*0.2);
      if(stableSupport&&Math.abs(chunk.vel.y)<0.18)chunk.vel.y=0;
      if(chunks.indexOf(chunk)>=0)shedChunk(chunk,dt);
    }
  }

  function processTopology(st){
    topologyPending.delete(st);refreshStructure(st);
    if(!st.activeN){st.destroyed=true;return;}
    supportPass(st);refreshStructure(st);
    if(st.activeN)stabilityPass(st);
    refreshStructure(st);
  }

  function blastStructure(st,epicenter,force){
    if(!st||!st.activeN)return 0;
    const radius=Math.min(3.15,2.15+Math.max(0,force)*0.07),r2=radius*radius;
    const minX=Math.max(0,Math.floor((epicenter.x-radius-st.origin.x)/st.sx));
    const maxX=Math.min(st.nx-1,Math.ceil((epicenter.x+radius-st.origin.x)/st.sx));
    const minY=Math.max(0,Math.floor((epicenter.y-radius-st.origin.y)/st.sy));
    const maxY=Math.min(st.ny-1,Math.ceil((epicenter.y+radius-st.origin.y)/st.sy));
    const minZ=Math.max(0,Math.floor((epicenter.z-radius-st.origin.z)/st.sz));
    const maxZ=Math.min(st.nz-1,Math.ceil((epicenter.z+radius-st.origin.z)/st.sz));
    let killed=0;
    for(let y=minY;y<=maxY;y++)for(let z=minZ;z<=maxZ;z++)for(let x=minX;x<=maxX;x++){
      const i=indexOf(st,x,y,z);if(!st.alive[i])continue;
      cellCenter(st,i,tmpPos);tmpDir.subVectors(tmpPos,epicenter);
      const d2=tmpDir.lengthSq();if(d2>r2)continue;
      const d=Math.sqrt(d2),falloff=1-d/radius;if(d>0.001)tmpDir.multiplyScalar(1/d);else tmpDir.set(1,0,0);
      if(falloff>0.43||st.type[i]===4&&falloff>0.2){
        if(killCell(st,i,0.48+falloff*0.52,tmpDir.x,Math.abs(tmpDir.y)+0.25,tmpDir.z,true))killed++;
      }else{
        st.damage[i]+=falloff*1.3;
        if(st.damage[i]>=1&&killCell(st,i,0.35,tmpDir.x,0.2,tmpDir.z,true))killed++;
      }
    }
    if(killed)processTopology(st);
    return killed;
  }
  function blastChunks(epicenter,force){
    for(const chunk of chunks){
      const dist=Math.max(0,chunk.mesh.position.distanceTo(epicenter)-chunk.radius);
      if(dist>3.5)continue;
      tmpDir.subVectors(chunk.mesh.position,epicenter);
      if(tmpDir.lengthSq()<1e-5)tmpDir.set(1,0,0);else tmpDir.normalize();
      const falloff=1-Math.min(1,dist/3.5),impulse=(2+force*0.55)*falloff/Math.max(1,Math.sqrt(chunk.count*0.08));
      chunk.vel.addScaledVector(tmpDir,impulse);chunk.vel.y+=0.8+falloff*2.2;
      chunk.axis.set(-tmpDir.z,0,tmpDir.x).normalize();chunk.omega=Math.min(2.8,chunk.omega+0.4+falloff*1.2);
    }
  }
  function blast(epicenter,force){
    blastChunks(epicenter,force);
    let killed=0;for(const st of structures)killed+=blastStructure(st,epicenter,force);
    flushDestroyed();return killed;
  }
  function damageAt(st,point,power,dir){
    if(!st||!st.activeN)return false;
    const gx=Math.floor((point.x-st.origin.x)/st.sx),gy=Math.floor((point.y-st.origin.y)/st.sy),gz=Math.floor((point.z-st.origin.z)/st.sz);
    let best=-1,bestD=Infinity;
    for(let y=Math.max(0,gy-1);y<=Math.min(st.ny-1,gy+1);y++)for(let z=Math.max(0,gz-1);z<=Math.min(st.nz-1,gz+1);z++)for(let x=Math.max(0,gx-1);x<=Math.min(st.nx-1,gx+1);x++){
      const i=indexOf(st,x,y,z);if(!st.alive[i])continue;cellCenter(st,i,tmpPos);
      const d=tmpPos.distanceToSquared(point);if(d<bestD){bestD=d;best=i;}
    }
    if(best<0)return false;
    const brittle=st.type[best]===4?0.42:1;
    st.damage[best]+=power/brittle;
    if(st.damage[best]>=1){
      tmpDir.copy(dir||new THREE.Vector3(0,0,1)).normalize();killCell(st,best,Math.min(0.75,0.2+power*0.25),tmpDir.x,Math.abs(tmpDir.y)+0.15,tmpDir.z,true);
      processTopology(st);flushDestroyed();return true;
    }
    return false;
  }
  function damageChunk(mesh,dir,power){
    const chunk=mesh&&mesh.userData&&mesh.userData.voxelChunk;if(!chunk)return false;
    tmpDir.copy(dir||new THREE.Vector3(0,0,1)).normalize();
    chunk.vel.addScaledVector(tmpDir,Math.max(0.05,power)/Math.max(1,Math.sqrt(chunk.count)));
    chunk.axis.set(-tmpDir.z,0.2,tmpDir.x).normalize();chunk.omega=Math.min(3,chunk.omega+0.15+power*0.02);
    return true;
  }

  function staticVoxelTopAt(point){
    if(!findStaticVoxelAt(point,null))return null;
    coords(contactStructure,contactIndex,coord);
    return contactStructure.origin.y+(coord.y+1)*contactStructure.sy;
  }
  function frozenDebrisSupported(k){
    const half=dsize[k]*0.5,bottom=dpy[k]-half;
    if(bottom<=groundY+0.045)return true;
    /* A shard may have settled on a voxel that is destroyed by a later blast.
       Frozen used to mean "never integrate again", leaving that shard pinned
       to the old contact point in empty air. Revalidate the exact exposed top
       every fixed step and return unsupported pieces to gravity immediately. */
    tmpPos.set(dpx[k],bottom-0.03,dpz[k]);
    const top=staticVoxelTopAt(tmpPos);
    if(top===null)return false;
    coords(contactStructure,contactIndex,coord);
    const above=coord.y+1<contactStructure.ny?
      contactIndex+contactStructure.nx*contactStructure.nz:-1;
    const exposedTop=above<0||!contactStructure.alive[above];
    return exposedTop&&Math.abs(bottom-top)<=Math.max(0.065,dsize[k]*0.22);
  }
  function debrisStep(dt){
    for(let k=0;k<debrisN;k++){
      dage[k]+=dt;
      if(dfrozen[k]){
        if(!frozenDebrisSupported(k)){
          dfrozen[k]=0;
          dvy[k]=Math.min(dvy[k],-0.2);
          continue;
        }
        if(dage[k]>=2.2&&solidifyDebris(k))k--;
        continue;
      }
      const half=dsize[k]*0.5,previousBottom=dpy[k]-half;
      dvy[k]-=GRAVITY*dt;dpx[k]+=dvx[k]*dt;dpy[k]+=dvy[k]*dt;dpz[k]+=dvz[k]*dt;
      if(dpy[k]-half<groundY){
        const speed=Math.hypot(dvx[k],dvy[k],dvz[k]);if(speed>13)splitDebris(k);
        dpy[k]=groundY+half;dvy[k]=Math.abs(dvy[k])*0.25;dvx[k]*=0.62;dvz[k]*=0.62;
        dwx[k]*=0.55;dwy[k]*=0.55;dwz[k]*=0.55;
        if(Math.abs(dvy[k])<0.8&&dvx[k]*dvx[k]+dvz[k]*dvz[k]<0.55)dfrozen[k]=1;
      }else if(dage[k]>0.12&&dvy[k]<=0){
        const bottom=dpy[k]-half;
        /* Query immediately below the swept bottom face. Sampling inside the
           shard made a vertical facade look like a floor and pinned blast
           fragments halfway up walls. A valid support must have been crossed
           from above during this fixed step. */
        tmpPos.set(dpx[k],bottom-0.025,dpz[k]);
        const top=staticVoxelTopAt(tmpPos);
        let exposedTop=false;
        if(top!==null){
          coords(contactStructure,contactIndex,coord);
          const above=coord.y+1<contactStructure.ny?
            contactIndex+contactStructure.nx*contactStructure.nz:-1;
          exposedTop=above<0||!contactStructure.alive[above];
        }
        const crossedTop=top!==null&&exposedTop&&bottom<=top+0.02&&
          previousBottom>=top-Math.max(0.06,Math.abs(dvy[k])*dt*1.25);
        if(crossedTop){
          const speed=Math.hypot(dvx[k],dvy[k],dvz[k]);
          let brokeSupport=false;
          if(speed>11){
            contactStructure.damage[contactIndex]+=Math.min(0.6,(speed-8)*0.035);
            if(contactStructure.damage[contactIndex]>=1)
              brokeSupport=killCell(contactStructure,contactIndex,0.38,0,-0.3,0,true);
          }
          if(brokeSupport)continue;
          dpy[k]=top+half;dvy[k]=Math.abs(dvy[k])*0.28;dvx[k]*=0.48;dvz[k]*=0.48;
          if(speed<3.5)dfrozen[k]=1;
        }
      }
      drx[k]+=dwx[k]*dt;dry[k]+=dwy[k]*dt;drz[k]+=dwz[k]*dt;
    }
  }
  function refreshDebris(){
    debrisMesh.count=debrisN;
    for(let k=0;k<debrisN;k++){
      dummy.position.set(dpx[k],dpy[k],dpz[k]);dummy.rotation.set(drx[k],dry[k],drz[k]);
      dummy.scale.setScalar(dsize[k]);dummy.updateMatrix();debrisMesh.setMatrixAt(k,dummy.matrix);
    }
    debrisMesh.instanceMatrix.needsUpdate=true;
    if(debrisColorDirty&&debrisMesh.instanceColor){debrisMesh.instanceColor.needsUpdate=true;debrisColorDirty=false;}
  }
  function fixedStep(dt){
    chunkStep(dt);debrisStep(dt);
    if(topologyPending.size){for(const st of Array.from(topologyPending))processTopology(st);}
  }
  function flushDestroyed(){if(destroyedPending){onDestroyed(destroyedPending);destroyedPending=0;}}
  function update(dt){
    accumulator+=Math.max(0,Math.min(0.05,dt));let steps=0;
    while(accumulator>=FIXED_STEP&&steps<MAX_STEPS){fixedStep(FIXED_STEP);accumulator-=FIXED_STEP;steps++;}
    structureAccumulator+=dt;
    if(structureAccumulator>=0.05){
      const sdt=Math.min(0.12,structureAccumulator);structureAccumulator=0;
      for(const st of structures){solveLoads(st,sdt);spallPass(st,sdt);}
    }
    for(const st of structures)refreshStructure(st);refreshDebris();flushDestroyed();
  }

  function surfaceAlive(st,point,radius){
    if(!st||!st.activeN)return false;
    const r=radius||0.9;
    const gx=Math.floor((point.x-st.origin.x)/st.sx),gy=Math.floor((point.y-st.origin.y)/st.sy),gz=Math.floor((point.z-st.origin.z)/st.sz);
    const rx=Math.max(1,Math.ceil(r/st.sx)),ry=Math.max(1,Math.ceil(r/st.sy)),rz=Math.max(1,Math.ceil(r/st.sz));
    for(let y=Math.max(0,gy-ry);y<=Math.min(st.ny-1,gy+ry);y++)for(let z=Math.max(0,gz-rz);z<=Math.min(st.nz-1,gz+rz);z++)for(let x=Math.max(0,gx-rx);x<=Math.min(st.nx-1,gx+rx);x++){
      const i=indexOf(st,x,y,z);if(!st.alive[i])continue;cellCenter(st,i,tmpPos);if(tmpPos.distanceToSquared(point)<=r*r)return true;
    }
    return false;
  }
  function pushPlayer(position,radius){
    if(!pushFromObb)return false;
    let pushed=false;
    for(const chunk of chunks){
      const dx=position.x-chunk.mesh.position.x,dz=position.z-chunk.mesh.position.z;
      if(dx*dx+dz*dz>(chunk.radius+radius+1)*(chunk.radius+radius+1))continue;
      setAxes(chunk.mesh.quaternion,playerAxes);tmpHalf.set(chunk.st.sx*0.47,chunk.st.sy*0.47,chunk.st.sz*0.47);
      for(let k=0;k<chunk.count;k++){
        chunkWorld(chunk,k,playerCubePos);
        if(pushFromObb(position,playerCubePos,tmpHalf,playerAxes,radius))pushed=true;
      }
    }
    return pushed;
  }
  function stats(){return{structures:structures.length,voxels:structures.reduce((n,st)=>n+st.activeN,0),chunks:chunks.length,debris:debrisN};}

  function emitDebris(position,velocity,size,color){
    const c=color||tmpColor.setRGB(0.65,0.65,0.65);
    spawnDebris(position.x,position.y,position.z,velocity.x,velocity.y,velocity.z,
      size,c.r,c.g,c.b);
    destroyedPending++;
  }

  return{
    registerBuilding,blast,blastStructure,blastChunks,damageAt,damageChunk,update,
    surfaceAlive,pushPlayer,stats,emitDebris,structures,chunks,debrisMesh
  };
};

})(window);
