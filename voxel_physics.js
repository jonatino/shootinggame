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
  const getExternalDynamicBodies=options.getDynamicBodies||(()=>[]);
  const getExternalSettledBodies=options.getSettledBodies||(()=>[]);
  const onDestroyed=options.onDestroyed||(()=>{});
  const groundY=options.groundY||0;

  /* Three r128 culls InstancedMesh objects with one aggregate sphere. That is
     extremely loose for a tall, narrow tower: its half-height radius can keep
     it in both the camera and shadow passes when its entire AABB is outside.
     Opt marked static/dynamic voxel fields into exact conservative world-box
     tests. This only rejects objects the frustum cannot possibly see. */
  const frustumPrototype=THREE.Frustum&&THREE.Frustum.prototype;
  if(frustumPrototype&&!frustumPrototype.__voxelBoundsIntersectsObject){
    const defaultIntersectsObject=frustumPrototype.intersectsObject;
    Object.defineProperty(frustumPrototype,'__voxelBoundsIntersectsObject',{
      value:defaultIntersectsObject,configurable:true
    });
    frustumPrototype.intersectsObject=function(object){
      const bounds=object&&object.userData&&object.userData.voxelFrustumBounds;
      return bounds?this.intersectsBox(bounds):defaultIntersectsObject.call(this,object);
    };
  }

  const FIXED_STEP=1/120,MAX_STEPS=12;
  const GRAVITY=Number.isFinite(options.gravity)&&options.gravity>0?options.gravity:9.81;
  const SOFT_LAND=9,ROLL_MAX=14,SHATTER_SPEED=24;
  const TOPPLE_MARGIN=0.45,TOPPLE_MIN_VOXELS=34,TOPPLE_MIN_HEIGHT=4;
  const TOPPLE_OMEGA_MAX=2.2,AIR_BREAK=9,SHED_RATE=6,SHED_MIN=24;
  const MAX_DEBRIS=3600;
  const structures=[],chunks=[];
  const STRUCTURE_GRID_CELL=8,structureGrid=new Map();
  let staticQueryGridX=NaN,staticQueryGridZ=NaN,staticQueryBucket=null;
  const topologyPending=new Set();
  let accumulator=0,structureAccumulator=0,destroyedPending=0;
  let topologyRevision=1;

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
  const voxelRayLocal=new THREE.Ray(),voxelRayInverse=new THREE.Matrix4();
  const voxelRayInstanceMatrix=new THREE.Matrix4(),voxelRayWorldMatrix=new THREE.Matrix4();
  const voxelRaycastMesh=new THREE.Mesh(voxelGeometry,voxelMaterial);
  const voxelRaycastHits=[],voxelRayRange={enter:0,exit:0};
  const playerAxes=[new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3()];
  const playerCubePos=new THREE.Vector3();
  const loadCandidates=new Int32Array(4),loadTargets=new Int32Array(4);
  const neighbourIndices=new Int32Array(6),lateralNeighbourIndices=new Int32Array(4);
  const supportNeighbourIndices=new Int32Array(8);
  const stabilityHeapIndex=[],stabilityHeapBasin=[],stabilityHeapScore=[],
    stabilityHeapHops=[];
  let stabilityHeapN=0,stabilityPopIndex=0,stabilityPopBasin=0,
    stabilityPopScore=0,stabilityPopHops=0;

  function hash01(i){
    let h=Math.imul(i^0x9e3779b9,2654435761)>>>0;
    h^=h>>>15;h=Math.imul(h,2246822519)>>>0;h^=h>>>13;
    return (h>>>0)/4294967296;
  }
  function stabilityHeapBetter(scoreA,hopsA,scoreB,hopsB){
    return scoreA>scoreB*1.25||(scoreB<=scoreA*1.25&&hopsA<hopsB);
  }
  function supportRoot(union,index){
    let root=index;
    while(union[root]!==root)root=union[root];
    while(union[index]!==root){
      const parent=union[index];union[index]=root;index=parent;
    }
    return root;
  }
  function stabilityHeapPush(index,basin,score,hops){
    let child=stabilityHeapN++;
    stabilityHeapIndex[child]=index;stabilityHeapBasin[child]=basin;
    stabilityHeapScore[child]=score;stabilityHeapHops[child]=hops;
    while(child>0){
      const parent=(child-1)>>1;
      if(!stabilityHeapBetter(stabilityHeapScore[child],stabilityHeapHops[child],
        stabilityHeapScore[parent],stabilityHeapHops[parent]))break;
      let swap=stabilityHeapIndex[child];stabilityHeapIndex[child]=stabilityHeapIndex[parent];
      stabilityHeapIndex[parent]=swap;
      swap=stabilityHeapBasin[child];stabilityHeapBasin[child]=stabilityHeapBasin[parent];
      stabilityHeapBasin[parent]=swap;
      swap=stabilityHeapScore[child];stabilityHeapScore[child]=stabilityHeapScore[parent];
      stabilityHeapScore[parent]=swap;
      swap=stabilityHeapHops[child];stabilityHeapHops[child]=stabilityHeapHops[parent];
      stabilityHeapHops[parent]=swap;child=parent;
    }
  }
  function stabilityHeapPop(){
    stabilityPopIndex=stabilityHeapIndex[0];
    stabilityPopBasin=stabilityHeapBasin[0];
    stabilityPopScore=stabilityHeapScore[0];
    stabilityPopHops=stabilityHeapHops[0];
    const last=--stabilityHeapN;
    if(last<=0)return;
    stabilityHeapIndex[0]=stabilityHeapIndex[last];
    stabilityHeapBasin[0]=stabilityHeapBasin[last];
    stabilityHeapScore[0]=stabilityHeapScore[last];
    stabilityHeapHops[0]=stabilityHeapHops[last];
    let parent=0;
    for(;;){
      const left=parent*2+1,right=left+1;let best=parent;
      if(left<stabilityHeapN&&stabilityHeapBetter(stabilityHeapScore[left],
        stabilityHeapHops[left],stabilityHeapScore[best],stabilityHeapHops[best]))best=left;
      if(right<stabilityHeapN&&stabilityHeapBetter(stabilityHeapScore[right],
        stabilityHeapHops[right],stabilityHeapScore[best],stabilityHeapHops[best]))best=right;
      if(best===parent)break;
      let swap=stabilityHeapIndex[parent];stabilityHeapIndex[parent]=stabilityHeapIndex[best];
      stabilityHeapIndex[best]=swap;
      swap=stabilityHeapBasin[parent];stabilityHeapBasin[parent]=stabilityHeapBasin[best];
      stabilityHeapBasin[best]=swap;
      swap=stabilityHeapScore[parent];stabilityHeapScore[parent]=stabilityHeapScore[best];
      stabilityHeapScore[best]=swap;
      swap=stabilityHeapHops[parent];stabilityHeapHops[parent]=stabilityHeapHops[best];
      stabilityHeapHops[best]=swap;parent=best;
    }
  }
  function structureGridKey(x,z){return x+'_'+z;}
  function indexStructure(st){
    staticQueryGridX=NaN;
    const minX=Math.floor(st.origin.x/STRUCTURE_GRID_CELL);
    const maxX=Math.floor((st.origin.x+st.nx*st.sx)/STRUCTURE_GRID_CELL);
    const minZ=Math.floor(st.origin.z/STRUCTURE_GRID_CELL);
    const maxZ=Math.floor((st.origin.z+st.nz*st.sz)/STRUCTURE_GRID_CELL);
    for(let x=minX;x<=maxX;x++)for(let z=minZ;z<=maxZ;z++){
      const key=structureGridKey(x,z);
      let bucket=structureGrid.get(key);
      if(!bucket){bucket=[];structureGrid.set(key,bucket);}
      bucket.push(st);
    }
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
  function clipVoxelRayAxis(origin,direction,extent,range){
    if(Math.abs(direction)<1e-12)return origin>=0&&origin<=extent;
    let near=-origin/direction,far=(extent-origin)/direction;
    if(near>far){const swap=near;near=far;far=swap;}
    range.enter=Math.max(range.enter,near);range.exit=Math.min(range.exit,far);
    return range.exit>=range.enter;
  }
  function raycastStructureGrid(st,mesh,raycaster,intersects,chunk){
    const query=chunk||st;query.lastRaycastCellTests=0;
    if(!mesh.material||!(chunk?chunk.count:st.activeN))return;
    voxelRayInverse.copy(mesh.matrixWorld).invert();
    voxelRayLocal.copy(raycaster.ray).applyMatrix4(voxelRayInverse);
    if(chunk){
      if(chunk.raycastCellCount!==chunk.count){
        chunk.raycastCells.clear();
        for(let k=0;k<chunk.count;k++)chunk.raycastCells.set(chunk.cellIndex[k],k);
        const first=chunk.cellIndex[0];
        chunk.raycastGridOffset.set(chunk.lx[0]-(first%st.nx+0.5)*st.sx,
          chunk.ly[0]-(Math.floor(first/(st.nx*st.nz))+0.5)*st.sy,
          chunk.lz[0]-(Math.floor(first/st.nx)%st.nz+0.5)*st.sz);
        chunk.raycastCellCount=chunk.count;
      }
      voxelRayLocal.origin.sub(chunk.raycastGridOffset);
    }
    const origin=voxelRayLocal.origin,direction=voxelRayLocal.direction;
    // Clip camera, muzzle and ground probes to their actual range. Account for
    // scale when expressing the world-space near/far distances in this grid.
    const e=voxelRayInverse.elements,d=raycaster.ray.direction;
    const dx=e[0]*d.x+e[4]*d.y+e[8]*d.z,dy=e[1]*d.x+e[5]*d.y+e[9]*d.z,
      dz=e[2]*d.x+e[6]*d.y+e[10]*d.z,scale=Math.sqrt(dx*dx+dy*dy+dz*dz);
    voxelRayRange.enter=raycaster.near*scale;voxelRayRange.exit=raycaster.far*scale;
    if(!clipVoxelRayAxis(origin.x,direction.x,st.nx*st.sx,voxelRayRange)||
       !clipVoxelRayAxis(origin.y,direction.y,st.ny*st.sy,voxelRayRange)||
       !clipVoxelRayAxis(origin.z,direction.z,st.nz*st.sz,voxelRayRange)||
       voxelRayRange.exit<0)return;
    const entry=Math.max(0,voxelRayRange.enter),exit=voxelRayRange.exit;
    if(exit<entry)return;
    /* Step just inside the aggregate bounds so a negative ray entering on the
       maximum face selects the last grid cell rather than nx/ny/nz. */
    const sampleT=entry+Math.min(1e-7,(exit-entry)*0.5);
    let x=Math.max(0,Math.min(st.nx-1,
      Math.floor((origin.x+direction.x*sampleT)/st.sx)));
    let y=Math.max(0,Math.min(st.ny-1,
      Math.floor((origin.y+direction.y*sampleT)/st.sy)));
    let z=Math.max(0,Math.min(st.nz-1,
      Math.floor((origin.z+direction.z*sampleT)/st.sz)));
    const stepX=direction.x>0?1:(direction.x<0?-1:0);
    const stepY=direction.y>0?1:(direction.y<0?-1:0);
    const stepZ=direction.z>0?1:(direction.z<0?-1:0);
    const deltaX=stepX?st.sx/Math.abs(direction.x):Infinity;
    const deltaY=stepY?st.sy/Math.abs(direction.y):Infinity;
    const deltaZ=stepZ?st.sz/Math.abs(direction.z):Infinity;
    let nextX=stepX?(((stepX>0?x+1:x)*st.sx-origin.x)/direction.x):Infinity;
    let nextY=stepY?(((stepY>0?y+1:y)*st.sy-origin.y)/direction.y):Infinity;
    let nextZ=stepZ?(((stepZ>0?z+1:z)*st.sz-origin.z)/direction.z):Infinity;
    const tieEpsilon=1e-9;
    while(inBounds(st,x,y,z)){
      query.lastRaycastCellTests++;
      const cell=indexOf(st,x,y,z);
      if(chunk?chunk.raycastCells.has(cell):st.alive[cell]){
        const instanceId=chunk?chunk.raycastCells.get(cell):st.posInActive[cell];
        if(instanceId>=0&&instanceId<mesh.count){
          mesh.getMatrixAt(instanceId,voxelRayInstanceMatrix);
          voxelRayWorldMatrix.multiplyMatrices(mesh.matrixWorld,voxelRayInstanceMatrix);
          voxelRaycastMesh.geometry=voxelGeometry;
          voxelRaycastMesh.material=mesh.material;
          voxelRaycastMesh.matrixWorld.copy(voxelRayWorldMatrix);
          voxelRaycastHits.length=0;
          voxelRaycastMesh.raycast(raycaster,voxelRaycastHits);
          for(let i=0;i<voxelRaycastHits.length;i++){
            const hit=voxelRaycastHits[i];
            hit.instanceId=instanceId;hit.object=mesh;intersects.push(hit);
          }
        }
      }
      const next=Math.min(nextX,nextY,nextZ);
      if(!Number.isFinite(next)||next>exit+tieEpsilon)break;
      if(nextX<=next+tieEpsilon){x+=stepX;nextX+=deltaX;}
      if(nextY<=next+tieEpsilon){y+=stepY;nextY+=deltaY;}
      if(nextZ<=next+tieEpsilon){z+=stepZ;nextZ+=deltaZ;}
    }
    voxelRaycastHits.length=0;
  }
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
  function collectNeighbourIndices(st,i){
    const x=i%st.nx,z=Math.floor(i/st.nx)%st.nz;
    const y=Math.floor(i/(st.nx*st.nz));
    let n=0;
    if(x+1<st.nx)neighbourIndices[n++]=i+1;
    if(x>0)neighbourIndices[n++]=i-1;
    if(z+1<st.nz)neighbourIndices[n++]=i+st.nx;
    if(z>0)neighbourIndices[n++]=i-st.nx;
    if(y+1<st.ny)neighbourIndices[n++]=i+st.nx*st.nz;
    if(y>0)neighbourIndices[n++]=i-st.nx*st.nz;
    return n;
  }
  function collectLateralNeighbourIndices(st,i){
    const x=i%st.nx,z=Math.floor(i/st.nx)%st.nz;
    let n=0;
    if(x+1<st.nx)lateralNeighbourIndices[n++]=i+1;
    if(x>0)lateralNeighbourIndices[n++]=i-1;
    if(z+1<st.nz)lateralNeighbourIndices[n++]=i+st.nx;
    if(z>0)lateralNeighbourIndices[n++]=i-st.nx;
    return n;
  }
  function setAxes(q,axes){
    const x=q.x,y=q.y,z=q.z,w=q.w;
    axes[0].set(1-2*(y*y+z*z),2*(x*y+w*z),2*(x*z-w*y));
    axes[1].set(2*(x*y-w*z),1-2*(x*x+z*z),2*(y*z+w*x));
    axes[2].set(2*(x*z+w*y),2*(y*z-w*x),1-2*(x*x+y*y));
  }

  const debrisMesh=new THREE.InstancedMesh(voxelGeometry,debrisMaterial,MAX_DEBRIS);
  const debrisFrustumBounds=new THREE.Box3();
  debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  /* The reference debris casts shadows but does not receive them. Letting a
     shard receive the parent facade's dense instanced shadow turns the entire
     small cube black and was the source of the floating ink-blot artifacts. */
  debrisMesh.frustumCulled=true;debrisMesh.castShadow=true;debrisMesh.receiveShadow=false;
  debrisMesh.raycast=()=>{};
  debrisMesh.userData={voxelFrustumBounds:debrisFrustumBounds};
  debrisMesh.setColorAt(0,tmpColor.setRGB(1,1,1));
  debrisMesh.count=0;scene.add(debrisMesh);
  const dpx=new Float32Array(MAX_DEBRIS),dpy=new Float32Array(MAX_DEBRIS),dpz=new Float32Array(MAX_DEBRIS);
  const dvx=new Float32Array(MAX_DEBRIS),dvy=new Float32Array(MAX_DEBRIS),dvz=new Float32Array(MAX_DEBRIS);
  const dqx=new Float32Array(MAX_DEBRIS),dqy=new Float32Array(MAX_DEBRIS),
    dqz=new Float32Array(MAX_DEBRIS),dqw=new Float32Array(MAX_DEBRIS);
  const dwx=new Float32Array(MAX_DEBRIS),dwy=new Float32Array(MAX_DEBRIS),dwz=new Float32Array(MAX_DEBRIS);
  const dsize=new Float32Array(MAX_DEBRIS),dage=new Float32Array(MAX_DEBRIS);
  const dcr=new Float32Array(MAX_DEBRIS),dcg=new Float32Array(MAX_DEBRIS),dcb=new Float32Array(MAX_DEBRIS);
  const dfrozen=new Uint8Array(MAX_DEBRIS),ddynamicSupport=new Uint8Array(MAX_DEBRIS);
  const dstaticSupport=new Uint8Array(MAX_DEBRIS);
  const dstaticContacts=new Array(MAX_DEBRIS);
  const dgroundContacts=new Array(MAX_DEBRIS);
  const dcontactError=new Float32Array(MAX_DEBRIS);
  const dreactionX=new Float32Array(MAX_DEBRIS),dreactionY=new Float32Array(MAX_DEBRIS),
    dreactionZ=new Float32Array(MAX_DEBRIS);
  let reactionRevision=0;
  const dsupportRevision=new Uint32Array(MAX_DEBRIS);
  const debrisGeneration=new Uint32Array(MAX_DEBRIS);
  const dsupportParent=new Int32Array(MAX_DEBRIS),dsupportGeneration=new Uint32Array(MAX_DEBRIS);
  const dsupportDX=new Float32Array(MAX_DEBRIS),dsupportDY=new Float32Array(MAX_DEBRIS),
    dsupportDZ=new Float32Array(MAX_DEBRIS);
  const dsupportBody=new Array(MAX_DEBRIS);
  const supportCheckEpoch=new Uint32Array(MAX_DEBRIS),supportCheckResult=new Uint8Array(MAX_DEBRIS);
  const supportTrail=new Int32Array(MAX_DEBRIS);
  dsupportParent.fill(-1);
  let nextDebrisGeneration=0,debrisSupportEpoch=0;
  const dmatrixDirty=new Uint8Array(MAX_DEBRIS);
  const dhx=new Float32Array(MAX_DEBRIS),dhy=new Float32Array(MAX_DEBRIS),dhz=new Float32Array(MAX_DEBRIS);
  let debrisN=0,debrisSteal=0,debrisColorDirty=false;

  /* Every detached cell remains a physical body. A local 3-D broadphase keeps
     loose voxels, rigid voxel slabs, and the legacy rigid debris system in one
     contact set without falling back to an all-pairs scan. Entries and buckets
     are reused so a large collapse does not allocate garbage at 120 Hz. */
  const DYNAMIC_GRID_MIN_CELL=0.28,DYNAMIC_CONTACT_SLOP=0.002;
  const DYNAMIC_CONTACT_MARGIN=0.02;
  const DYNAMIC_POSITION_PERCENT=0.5,DYNAMIC_RESTITUTION=0.16;
  const DYNAMIC_FRICTION=0.48,DYNAMIC_SOLVER_PASSES=2,DYNAMIC_VELOCITY_PASSES=4;
  const dynamicGrid=new Map(),dynamicBuckets=[],dynamicEntries=[];
  const dynamicExternalEntries=[];
  const debrisCollisionEntries=new Array(MAX_DEBRIS),externalCollisionEntries=[];
  const externalSettledCollisionEntries=[];
  const debrisSweepEntries=[];
  const debrisSweepBands=new Map(),debrisSweepBandPool=[];
  const debrisBandLists=[[],[],[]],debrisBandOffsets=[0,0,0];
  let debrisSweepAxis=0,debrisBandAxis=1;
  const dynamicBodyContacts=new Map(),dynamicContactPool=[];
  const dynamicContactCache=new Map();
  let dynamicContactEpoch=0;
  const dynamicExternalBodyIds=new WeakMap();
  const dynamicVelocityA=new THREE.Vector3();
  const dynamicVelocityB=new THREE.Vector3(),dynamicTangent=new THREE.Vector3();
  const dynamicAxes=[new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3()];
  let dynamicBucketCount=0,dynamicContactCount=0,dynamicMaxExtent=0;
  let dynamicGridCell=DYNAMIC_GRID_MIN_CELL;
  let nextDynamicBodyId=MAX_DEBRIS+1;

  function orientedExtents(axes,hx,hy,hz,out){
    out.x=Math.abs(axes[0].x)*hx+Math.abs(axes[1].x)*hy+Math.abs(axes[2].x)*hz;
    out.y=Math.abs(axes[0].y)*hx+Math.abs(axes[1].y)*hy+Math.abs(axes[2].y)*hz;
    out.z=Math.abs(axes[0].z)*hx+Math.abs(axes[1].z)*hy+Math.abs(axes[2].z)*hz;
    return out;
  }
  function updateDebrisExtents(k){
    const x=dqx[k],y=dqy[k],z=dqz[k],w=dqw[k];
    const m00=1-2*(y*y+z*z),m01=2*(x*y-w*z),m02=2*(x*z+w*y);
    const m10=2*(x*y+w*z),m11=1-2*(x*x+z*z),m12=2*(y*z-w*x);
    const m20=2*(x*z-w*y),m21=2*(y*z+w*x),m22=1-2*(x*x+y*y);
    const half=dsize[k]*0.5;
    /* Loose voxels are cubes, so their rotated AABB is the absolute row sum
       of the same quaternion matrix. Keep the identical bounds without nine
       temporary Vector3 writes for every active shard at 120 Hz. */
    dhx[k]=Math.abs(m00)*half+Math.abs(m01)*half+Math.abs(m02)*half;
    dhy[k]=Math.abs(m10)*half+Math.abs(m11)*half+Math.abs(m12)*half;
    dhz[k]=Math.abs(m20)*half+Math.abs(m21)*half+Math.abs(m22)*half;
  }

  function rotateDebris(k,dt){
    /* Angular velocity is a world-space vector. Adding its components to
       Euler angles changes the spin axis as the cube turns and needs six
       trig calls per body per step. Integrate and normalize a quaternion. */
    const x=dqx[k],y=dqy[k],z=dqz[k],w=dqw[k];
    const ax=dwx[k]*dt*0.5,ay=dwy[k]*dt*0.5,az=dwz[k]*dt*0.5;
    const qx=x+ax*w+ay*z-az*y,qy=y+ay*w+az*x-ax*z;
    const qz=z+az*w+ax*y-ay*x,qw=w-ax*x-ay*y-az*z;
    const inv=1/Math.sqrt(qx*qx+qy*qy+qz*qz+qw*qw);
    dqx[k]=qx*inv;dqy[k]=qy*inv;dqz[k]=qz*inv;dqw[k]=qw*inv;
    updateDebrisExtents(k);
  }

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
    dummy.rotation.set(Math.random()*Math.PI*2,Math.random()*Math.PI*2,Math.random()*Math.PI*2);
    dqx[k]=dummy.quaternion.x;dqy[k]=dummy.quaternion.y;
    dqz[k]=dummy.quaternion.z;dqw[k]=dummy.quaternion.w;
    dwx[k]=(Math.random()-0.5)*8;dwy[k]=(Math.random()-0.5)*8;dwz[k]=(Math.random()-0.5)*8;
    dsize[k]=Math.max(0.08,size);dage[k]=0;dfrozen[k]=0;
    dcontactError[k]=0;dstaticContacts[k]=null;
    dreactionX[k]=0;dreactionY[k]=0;dreactionZ[k]=0;
    dgroundContacts[k]={nx:0,ny:1,nz:0,epoch:-1};
    dstaticSupport[k]=0;dsupportRevision[k]=0;
    debrisGeneration[k]=++nextDebrisGeneration;
    dsupportParent[k]=-1;dsupportBody[k]=null;supportCheckEpoch[k]=0;
    dcr[k]=r;dcg[k]=g;dcb[k]=b;
    updateDebrisExtents(k);ddynamicSupport[k]=0;dmatrixDirty[k]=1;
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
    updateDebrisExtents(k);dmatrixDirty[k]=1;
  }
  function addCell(st,x,y,z,type){
    const i=indexOf(st,x,y,z);if(st.alive[i])return;
    st.alive[i]=1;st.type[i]=type;st.damage[i]=0;
    st.collisionBoundsDirty=true;
    topologyRevision=(topologyRevision+1)>>>0;
    if(topologyRevision===0){topologyRevision=1;dsupportRevision.fill(0);}
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
  function activateStructurePhysics(st){
    if(st)st.physicsActive=true;
  }
  function activateDependentStructuresAtCell(st,i){
    /* A topology edit can only change another field's base support when one of
       its y=0 samples falls inside this voxel. Query the cell's XZ buckets and
       retain a conservative vertical test; waking every unanchored field made
       a cannon hit on one tower recompute all four skyscrapers. */
    const x=i%st.nx,z=Math.floor(i/st.nx)%st.nz,y=Math.floor(i/(st.nx*st.nz));
    const minX=st.origin.x+x*st.sx,maxX=minX+st.sx;
    const minY=st.origin.y+y*st.sy,maxY=minY+st.sy;
    const minZ=st.origin.z+z*st.sz,maxZ=minZ+st.sz;
    const gx0=Math.floor(minX/STRUCTURE_GRID_CELL);
    const gx1=Math.floor(maxX/STRUCTURE_GRID_CELL);
    const gz0=Math.floor(minZ/STRUCTURE_GRID_CELL);
    const gz1=Math.floor(maxZ/STRUCTURE_GRID_CELL);
    for(let gx=gx0;gx<=gx1;gx++)for(let gz=gz0;gz<=gz1;gz++){
      const nearby=structureGrid.get(structureGridKey(gx,gz));
      if(!nearby)continue;
      for(const other of nearby){
        if(other===st||other.anchorBase||!other.activeN)continue;
        const sampleY=other.origin.y-0.04;
        if(sampleY<minY||sampleY>maxY)continue;
        topologyPending.add(other);activateStructurePhysics(other);
      }
    }
  }
  function setStructureInstance(st,a,i){
    coords(st,i,coord);dummy.quaternion.identity();
    dummy.position.set((coord.x+0.5)*st.sx,(coord.y+0.5)*st.sy,
      (coord.z+0.5)*st.sz);
    dummy.scale.set(st.sx*0.94,st.sy*0.94,st.sz*0.94);dummy.updateMatrix();
    st.mesh.setMatrixAt(a,dummy.matrix);
    st.mesh.setColorAt(a,tmpColor.setRGB(st.cr[i],st.cg[i],st.cb[i]));
    st.instanceToCell[a]=i;
  }
  function markStructureInstanceUpload(st,a){
    const matrix=st.mesh.instanceMatrix;
    const matrixOffset=a*16,matrixEnd=matrixOffset+16;
    if(matrix.updateRange.count<0){
      matrix.updateRange.offset=matrixOffset;matrix.updateRange.count=16;
    }else{
      const start=Math.min(matrix.updateRange.offset,matrixOffset);
      const end=Math.max(matrix.updateRange.offset+matrix.updateRange.count,matrixEnd);
      matrix.updateRange.offset=start;matrix.updateRange.count=end-start;
    }
    matrix.needsUpdate=true;
    const color=st.mesh.instanceColor;
    if(!color)return;
    const colorOffset=a*3,colorEnd=colorOffset+3;
    if(color.updateRange.count<0){
      color.updateRange.offset=colorOffset;color.updateRange.count=3;
    }else{
      const start=Math.min(color.updateRange.offset,colorOffset);
      const end=Math.max(color.updateRange.offset+color.updateRange.count,colorEnd);
      color.updateRange.offset=start;color.updateRange.count=end-start;
    }
    color.needsUpdate=true;
  }
  function detachCell(st,i){
    if(!st.alive[i])return false;
    st.collisionBoundsDirty=true;
    st.alive[i]=0;
    topologyRevision=(topologyRevision+1)>>>0;
    if(topologyRevision===0){topologyRevision=1;dsupportRevision.fill(0);}
    const p=st.posInActive[i],last=st.activeIdx[--st.activeN];
    st.activeIdx[p]=last;st.posInActive[last]=p;st.posInActive[i]=-1;
    if(st.boxes[i])removeStaticBox(st.boxes[i]);
    if(st.mesh&&!st.dirty&&!st.bulkInstanceUpdate){
      if(p<st.activeN){setStructureInstance(st,p,last);markStructureInstanceUpload(st,p);}
      st.mesh.count=st.activeN;
    }else st.dirty=true;
    st.dirtyTopology=true;activateStructurePhysics(st);
    /* Props can be supported by another voxel structure (stacked crates, a
       flag on a rock, scaffolding on a slab). Whenever that support changes,
       re-run the dependent fields instead of leaving them pinned in space. */
    activateDependentStructuresAtCell(st,i);
    return true;
  }
  function killCell(st,i,power,dx,dy,dz,spawn){
    if(!st.alive[i])return false;
    const load=st.load[i],strength=Math.max(1,st.strength[i]);
    const neighbourN=collectNeighbourIndices(st,i);
    const neighbourDamage=Math.max(0,load/strength-0.35)*0.12;
    for(let n=0;n<neighbourN;n++){
      const next=neighbourIndices[n];
      if(st.alive[next])st.damage[next]+=neighbourDamage;
    }
    cellCenter(st,i,tmpPos);
    if(spawn!==false){
      const high=power>=0.62,count=high?3:1,size=high?Math.min(st.sx,st.sy,st.sz)*0.42:Math.min(st.sx,st.sy,st.sz)*0.9;
      for(let n=0;n<count;n++)spawnDebris(
        tmpPos.x+(Math.random()-0.5)*st.sx*0.5,tmpPos.y+(Math.random()-0.5)*st.sy*0.5,tmpPos.z+(Math.random()-0.5)*st.sz*0.5,
        dx*(3+10*power)+(Math.random()-0.5)*3,dy*(3+10*power)+1+Math.random()*2,
        dz*(3+10*power)+(Math.random()-0.5)*3,size,st.cr[i],st.cg[i],st.cb[i]);
      destroyedPending++;
    }
    detachCell(st,i);topologyPending.add(st);activateStructurePhysics(st);
    return true;
  }

  function refreshStructure(st){
    if(!st.dirty)return;
    for(let a=0;a<st.activeN;a++){
      const i=st.activeIdx[a];setStructureInstance(st,a,i);
    }
    st.mesh.count=st.activeN;
    st.mesh.instanceMatrix.updateRange.count=-1;
    st.mesh.instanceMatrix.needsUpdate=true;
    if(st.mesh.instanceColor){
      st.mesh.instanceColor.updateRange.count=-1;
      st.mesh.instanceColor.needsUpdate=true;
    }
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
      dObj:config.dObj||null,id:structures.length,nx,ny,nz,count,
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
      supportAt:new Int32Array(nx*nz),supportUnion:new Int32Array(count),
      cr:new Float32Array(count),cg:new Float32Array(count),cb:new Float32Array(count),
      boxes:new Array(count),instanceToCell:new Int32Array(count),
      /* Anchored, untouched fields are already in their only valid rest state.
         Their first real topology/damage edit wakes the identical load solve;
         unanchored stacked tiers still validate support on the first tick. */
      dirty:true,dirtyTopology:true,destroyed:false,
      physicsActive:config.anchorBase===false,
      bulkInstanceUpdate:false,
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
    /* InstancedMesh r128 disables frustum culling because it cannot infer the
       bounds of all instances. Give each field exact aggregate bounds so an
       off-screen skyscraper (and its shadow draw) costs nothing to render. */
    const renderGeometry=voxelGeometry.clone();
    renderGeometry.boundingSphere=new THREE.Sphere(
      new THREE.Vector3(config.width*0.5,config.height*0.5,config.depth*0.5),
      Math.hypot(config.width,config.height,config.depth)*0.5+0.01);
    st.mesh=new THREE.InstancedMesh(renderGeometry,voxelMaterial,count);
    st.mesh.raycast=function(raycaster,intersects){
      /* The instances are an occupied axis-aligned grid. Traverse only cells
         crossed by the ray, then run Three's unchanged BoxGeometry raycast on
         those exact instance matrices. This preserves face/UV/normal/distance
         results while avoiding thousands of impossible triangle tests for
         every high-rate cannon round. */
      raycastStructureGrid(st,this,raycaster,intersects);
    };
    st.mesh.position.copy(st.origin);st.mesh.castShadow=true;st.mesh.receiveShadow=true;
    st.mesh.frustumCulled=true;st.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    st.mesh.userData={
      kind:'voxelField',cameraFade:true,voxelStructure:st,
      voxelFrustumBounds:new THREE.Box3(st.origin.clone(),new THREE.Vector3(
        st.origin.x+st.nx*st.sx,st.origin.y+st.ny*st.sy,
        st.origin.z+st.nz*st.sz))
    };
    st.mesh.setColorAt(0,tmpColor.setRGB(1,1,1));
    scene.add(st.mesh);addOccluder(st.mesh);addStandable(st.mesh);
    structures.push(st);indexStructure(st);
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
      const neighbourN=collectNeighbourIndices(st,i);
      for(let n=0;n<neighbourN;n++){
        const next=neighbourIndices[n];
        if(st.alive[next]&&!st.grounded[next]){
          st.grounded[next]=1;st.queue[qe++]=next;
        }
      }
    }
    qs=0;qe=0;
    const layer=st.nx*st.nz;
    for(let a=0;a<st.activeN;a++){
      const i=st.activeIdx[a],y=Math.floor(i/layer);
      if(y===0||st.alive[i-layer]){
        st.supportDistance[i]=0;st.queue[qe++]=i;
      }
    }
    while(qs<qe){
      const i=st.queue[qs++],nextDistance=st.supportDistance[i]+1;
      const neighbourN=collectLateralNeighbourIndices(st,i);
      for(let n=0;n<neighbourN;n++){
        const next=lateralNeighbourIndices[n];
        if(st.alive[next]&&st.supportDistance[next]===65535){
          st.supportDistance[next]=nextDistance;st.queue[qe++]=next;
        }
      }
    }
    st.dirtyTopology=false;
  }

  function chunkWorld(chunk,k,out){
    return out.set(chunk.lx[k],chunk.ly[k],chunk.lz[k]).applyQuaternion(chunk.mesh.quaternion).add(chunk.mesh.position);
  }
  function chunkVelocity(chunk,world,out){
    if(chunk.mode==='pivot'){
      tmpAxis.copy(chunk.axis).multiplyScalar(chunk.omega);
      tmpCross.subVectors(world,chunk.pivot);
      return out.crossVectors(tmpAxis,tmpCross);
    }
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
  function createChunk(st,capacity){
    const mesh=new THREE.InstancedMesh(voxelGeometry,voxelMaterial,capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=true;
    mesh.castShadow=true;mesh.receiveShadow=false;
    const chunk={
      st,mesh,count:capacity,capacity,
      lx:new Float32Array(capacity),ly:new Float32Array(capacity),lz:new Float32Array(capacity),
      cr:new Float32Array(capacity),cg:new Float32Array(capacity),cb:new Float32Array(capacity),
      strength:new Float32Array(capacity),type:new Uint8Array(capacity),
      damage:new Float32Array(capacity),cellIndex:new Int32Array(capacity),
      collisionEntries:new Array(capacity),dynamicImpact:0,
      contactAxes:[new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3()],
      contactCells:new Set(),contactCellCount:-1,
      exposedFaces:new Uint8Array(capacity),worldFaceBits:new Uint8Array(6),
      contactEntryByCell:new Map(),contactEntryCount:-1,
      contactBounds:new THREE.Box3(),contactGridOffset:new THREE.Vector3(),
      raycastCells:new Map(),raycastCellCount:-1,raycastGridOffset:new THREE.Vector3(),
      vel:new THREE.Vector3(),axis:new THREE.Vector3(1,0,0),angle:0,omega:0,alpha:0,
      mode:'free',pivot:new THREE.Vector3(),pivotOffset:new THREE.Vector3(),
      radius:0,minLocalY:Infinity,bounces:0,shedAccumulator:0,restTime:0
    };
    mesh.userData={
      kind:'voxelChunk',cameraFade:true,voxelChunk:chunk,voxelStructure:st,
      voxelFrustumBounds:new THREE.Box3()
    };
    /* Moving sections keep their cell lattice. Three's default instanced ray
       path tested every brick for every shot, camera probe and ground query. */
    mesh.raycast=function(raycaster,intersects){
      raycastStructureGrid(st,this,raycaster,intersects,chunk);
    };
    return chunk;
  }
  function addChunk(chunk){
    const mesh=chunk.mesh;
    mesh.count=chunk.count;mesh.instanceMatrix.needsUpdate=true;
    if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
    refreshChunkFrustumBounds(chunk);
    scene.add(mesh);mesh.updateMatrixWorld(true);
    addOccluder(mesh);addStandable(mesh);chunks.push(chunk);
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
    const capacity=sorted.length,chunk=createChunk(st,capacity);
    chunk.mesh.position.set(mx,my,mz);
    st.bulkInstanceUpdate=true;
    for(let k=0;k<capacity;k++){
      const i=sorted[k];cellCenter(st,i,tmpPos);
      chunk.lx[k]=tmpPos.x-mx;chunk.ly[k]=tmpPos.y-my;chunk.lz[k]=tmpPos.z-mz;
      chunk.cr[k]=st.cr[i];chunk.cg[k]=st.cg[i];chunk.cb[k]=st.cb[i];
      chunk.strength[k]=st.strength[i];chunk.type[k]=st.type[i];
      chunk.damage[k]=st.damage[i];chunk.cellIndex[k]=i;
      chunk.radius=Math.max(chunk.radius,Math.hypot(chunk.lx[k],chunk.ly[k],chunk.lz[k]));
      chunk.minLocalY=Math.min(chunk.minLocalY,chunk.ly[k]);
      refreshChunkInstance(chunk,k);detachCell(st,i);
    }
    st.bulkInstanceUpdate=false;
    if(tip){
      chunk.mode='pivot';
      chunk.axis.copy(tip.axis).normalize();chunk.pivot.copy(tip.pivot);
      chunk.pivotOffset.set(mx-tip.pivot.x,my-tip.pivot.y,mz-tip.pivot.z);
      chunk.omega=0.06;chunk.alpha=tip.alpha;
    }
    addChunk(chunk);
    st.dirty=true;
    return chunk;
  }

  function refreshChunkFrustumBounds(chunk){
    const radius=chunk.radius+Math.hypot(chunk.st.sx,chunk.st.sy,chunk.st.sz)*0.5;
    const p=chunk.mesh.position,bounds=chunk.mesh.userData.voxelFrustumBounds;
    bounds.min.set(p.x-radius,p.y-radius,p.z-radius);
    bounds.max.set(p.x+radius,p.y+radius,p.z+radius);
  }

  function supportPass(st){
    computeSupport(st);
    let changed=false;
    st.markEpoch=(st.markEpoch+1)>>>0;if(st.markEpoch===0){st.mark.fill(0);st.markEpoch=1;}
    const epoch=st.markEpoch;
    for(let i=0;i<st.count;i++){
      if(!st.alive[i]||st.grounded[i]||st.mark[i]===epoch)continue;
      let qs=0,qe=0;st.queue[qe++]=i;st.mark[i]=epoch;
      while(qs<qe){
        const j=st.queue[qs++];st.component[qs-1]=j;
        const neighbourN=collectNeighbourIndices(st,j);
        for(let n=0;n<neighbourN;n++){
          const next=neighbourIndices[n];
          if(st.alive[next]&&!st.grounded[next]&&st.mark[next]!==epoch){
            st.mark[next]=epoch;st.queue[qe++]=next;
          }
        }
      }
      const list=Array.from(st.queue.subarray(0,qe));
      if(list.length>=4)spawnChunk(st,list,null);
      else for(const j of list)killCell(st,j,0.2,0,-0.4,0,true);
      changed=true;
    }
    return changed;
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
  function stabilityPass(st,supportReady){
    if(!supportReady)computeSupport(st);
    st.markEpoch=(st.markEpoch+1)>>>0;if(st.markEpoch===0){st.mark.fill(0);st.markEpoch=1;}
    const epoch=st.markEpoch;
    const tipJobs=[];
    const layer=st.nx*st.nz;
    for(let active=0;active<st.activeN;active++){
      const i=st.activeIdx[active],iy=Math.floor(i/layer);
      /* y=0 is this local field's bedrock-facing footing. Excluding it from
         the body mirrors the reference grid's global bedrock layer and lets
         the supported structure pivot while its remaining footing stays put. */
      if(iy===0||!st.grounded[i]||st.mark[i]===epoch)continue;
      let qs=0,qe=0,mx=0,my=0,mz=0,minY=st.ny,maxY=0;
      st.queue[qe++]=i;st.mark[i]=epoch;
      while(qs<qe){
        const j=st.queue[qs++];st.component[qs-1]=j;
        const jx=j%st.nx,jz=Math.floor(j/st.nx)%st.nz,jy=Math.floor(j/layer);
        mx+=jx+0.5;my+=jy+0.5;mz+=jz+0.5;
        minY=Math.min(minY,jy);maxY=Math.max(maxY,jy);
        const neighbourN=collectNeighbourIndices(st,j);
        for(let n=0;n<neighbourN;n++){
          const next=neighbourIndices[n];
          if(Math.floor(next/layer)>0&&st.alive[next]&&st.grounded[next]&&
             st.mark[next]!==epoch){
            st.mark[next]=epoch;st.queue[qe++]=next;
          }
        }
      }
      if(qe<TOPPLE_MIN_VOXELS||maxY-minY<TOPPLE_MIN_HEIGHT)continue;
      const supports=[];
      for(let k=0;k<qe;k++){
        const j=st.component[k],jy=Math.floor(j/layer);
        const jx=j%st.nx,jz=Math.floor(j/st.nx)%st.nz;
        if(jy>0&&st.alive[j-layer]&&st.mark[j-layer]!==epoch){
          const worldX=st.origin.x+(jx+0.5)*st.sx;
          const worldZ=st.origin.z+(jz+0.5)*st.sz;
          supports.push({i:j,x:worldX,z:worldZ,gx:jx,gz:jz,
            strength:st.strength[j]});
        }
      }
      if(!supports.length)continue;
      const comX=st.origin.x+(mx/qe)*st.sx,comZ=st.origin.z+(mz/qe)*st.sz;
      const wholeScan=supportScan(supports,comX,comZ);if(!wholeScan)continue;

      /* Cluster comparable footing cells, then attribute the body through the
         strongest available path. A weak bridge can tear without dragging a
         healthy wall/core basin over with it—the defining v16 stability fix. */
      const supN=supports.length,uf=st.supportUnion,supportAt=st.supportAt;
      for(let s=0;s<supN;s++)uf[s]=s;
      supportAt.fill(-1);
      let uniqueSupports=true;
      for(let s=0;s<supN;s++){
        const slot=supports[s].gz*st.nx+supports[s].gx;
        if(supportAt[slot]>=0)uniqueSupports=false;
        supportAt[slot]=s;
      }
      for(let a=0;a<supN;a++){
        let neighbourCount=0;
        if(uniqueSupports){
          const gx=supports[a].gx,gz=supports[a].gz;
          for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
            if((dx===0&&dz===0)||gx+dx<0||gx+dx>=st.nx||
               gz+dz<0||gz+dz>=st.nz)continue;
            const b=supportAt[(gz+dz)*st.nx+gx+dx];
            if(b>a)supportNeighbourIndices[neighbourCount++]=b;
          }
          /* Match the old ascending-b pair order so union roots—and therefore
             deterministic collapse ordering—remain byte-for-byte stable. */
          for(let n=1;n<neighbourCount;n++){
            const value=supportNeighbourIndices[n];let p=n-1;
            while(p>=0&&supportNeighbourIndices[p]>value){
              supportNeighbourIndices[p+1]=supportNeighbourIndices[p];p--;
            }
            supportNeighbourIndices[p+1]=value;
          }
        }
        const candidateCount=uniqueSupports?neighbourCount:supN-a-1;
        for(let n=0;n<candidateCount;n++){
          const b=uniqueSupports?supportNeighbourIndices[n]:a+1+n;
          if(!uniqueSupports&&
             (Math.abs(supports[a].gx-supports[b].gx)>1||
              Math.abs(supports[a].gz-supports[b].gz)>1))continue;
          const ratio=Math.min(supports[a].strength,supports[b].strength)/
            Math.max(1,supports[a].strength,supports[b].strength);
          if(ratio<0.5)continue;
          const ra=supportRoot(uf,a),rb=supportRoot(uf,b);
          if(ra!==rb)uf[ra]=rb;
        }
      }
      for(let k=0;k<qe;k++){
        const j=st.component[k];st.basin[j]=-1;st.pathScore[j]=0;st.pathHops[j]=2147483647;
      }
      stabilityHeapN=0;
      for(let s=0;s<supN;s++){
        const v=supports[s].i,score=Math.min(st.strength[v],400);
        st.basin[v]=s;st.pathScore[v]=score;st.pathHops[v]=0;
        stabilityHeapPush(v,s,score,0);
      }
      while(stabilityHeapN){
        stabilityHeapPop();
        const j=stabilityPopIndex,basin=stabilityPopBasin;
        const nodeScore=stabilityPopScore,nodeHops=stabilityPopHops;
        if(st.basin[j]!==basin||st.pathScore[j]!==nodeScore||
           st.pathHops[j]!==nodeHops)continue;
        const neighbourN=collectNeighbourIndices(st,j);
        for(let n=0;n<neighbourN;n++){
          const next=neighbourIndices[n];
          if(!st.alive[next]||st.mark[next]!==epoch)continue;
          const score=Math.min(nodeScore,Math.min(st.strength[next],400));
          const hops=nodeHops+1;
          const better=st.basin[next]<0||score>st.pathScore[next]*1.25||
            (score*1.25>=st.pathScore[next]&&hops<st.pathHops[next]);
          if(!better)continue;
          st.basin[next]=basin;st.pathScore[next]=score;
          st.pathHops[next]=hops;
          stabilityHeapPush(next,basin,score,hops);
        }
      }

      const clusters=new Map();
      for(let s=0;s<supN;s++){
        const root=supportRoot(uf,s);let cluster=clusters.get(root);
        if(!cluster){cluster={cells:[],supports:[],mx:0,mz:0,minY:st.ny,maxY:0};clusters.set(root,cluster);}
        cluster.supports.push(supports[s]);
      }
      for(let k=0;k<qe;k++){
        const j=st.component[k],seed=st.basin[j];if(seed<0)continue;
        const cluster=clusters.get(supportRoot(uf,seed));if(!cluster)continue;
        const jx=j%st.nx,jz=Math.floor(j/st.nx)%st.nz,jy=Math.floor(j/layer);
        cluster.cells.push(j);cluster.mx+=st.origin.x+(jx+0.5)*st.sx;
        cluster.mz+=st.origin.z+(jz+0.5)*st.sz;
        cluster.minY=Math.min(cluster.minY,jy);cluster.maxY=Math.max(cluster.maxY,jy);
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
    if(!st.activeN||!st.simulateLoads)return false;
    /* Ground reachability only changes when cells are added/removed. Reusing
       it between damage ticks preserves the exact load solution while avoiding
       another whole-building BFS on every 20 Hz structural update. */
    if(st.dirtyTopology)computeSupport(st);
    st.inflight.fill(0);st.load.fill(0);
    let evolving=false;
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
        const d=st.supportDistance[i],effective=Math.max(0.4,
          st.strength[i]*(1-0.7*Math.min(st.damage[i],1))*st.slender[i]);
        let candidateN=0;
        if(x+1<st.nx)loadCandidates[candidateN++]=i+1;
        if(x>0)loadCandidates[candidateN++]=i-1;
        if(z+1<st.nz)loadCandidates[candidateN++]=i+st.nx;
        if(z>0)loadCandidates[candidateN++]=i-st.nx;
        let targetN=0;
        for(let n=0;n<candidateN;n++){
          const target=loadCandidates[n];
          if(!st.alive[target]||st.supportDistance[target]>=d)continue;
          const neighbourStrength=Math.max(0.4,st.strength[target]*
            (1-0.7*Math.min(st.damage[target],1))*st.slender[target]);
          if(neighbourStrength>=effective*0.5)loadTargets[targetN++]=target;
        }
        if(!targetN)for(let n=0;n<candidateN;n++){
          const target=loadCandidates[n];
          if(st.alive[target]&&st.supportDistance[target]<d)
            loadTargets[targetN++]=target;
        }
        if(!targetN){
          const delta=(load/effective)*1.6*dt;
          if(delta>0){st.damage[i]+=delta;evolving=true;}
          continue;
        }
        const transmitted=Math.min(load,effective*0.4);
        const share=transmitted/targetN+0.03+0.05*Math.min(d,8);
        for(let n=0;n<targetN;n++)st.inflight[loadTargets[n]]+=share;
        const excess=load-transmitted;
        if(excess>0){st.damage[i]+=(excess/effective)*1.6*dt;evolving=true;}
      }
    }
    const failures=[];
    const layer=st.nx*st.nz;
    for(let a=0;a<st.activeN;a++){
      const i=st.activeIdx[a];if(Math.floor(i/layer)===0)continue;
      const effective=Math.max(0.4,st.strength[i]*(1-0.7*Math.min(st.damage[i],1))*st.slender[i]);
      const u=st.load[i]/effective;
      if(u>=2.2){failures.push(i);continue;}
      if(u>=1.02){
        st.overTime[i]+=dt*(u-1)*6;
        st.damage[i]+=dt*(u-1)*0.08;
        evolving=true;
        if(st.overTime[i]>0.6||st.damage[i]>=1){failures.push(i);continue;}
      }else{
        const oldOverTime=st.overTime[i];
        st.overTime[i]=Math.max(0,oldOverTime-dt*0.5);
        if(st.overTime[i]!==oldOverTime)evolving=true;
        if(u>=0.8){
          const delta=dt*(u-0.8)*1.4*0.02;
          if(delta>0){st.damage[i]+=delta;evolving=true;}
        }else if(u<0.5){
          const oldDamage=st.damage[i];
          st.damage[i]=Math.max(0,oldDamage-dt*0.015);
          if(st.damage[i]!==oldDamage)evolving=true;
        }
      }
      if(st.damage[i]>=1)failures.push(i);
      if(failures.length>=120)break;
    }
    if(failures.length){
      for(const i of failures)killCell(st,i,0.28,0,-0.35,0,true);
      processTopology(st);
      return true;
    }
    return evolving;
  }

  function spallPass(st,dt){
    if(!st.activeN)return false;
    const failures=[];
    let evolving=false;
    const layer=st.nx*st.nz;
    for(let a=0;a<st.activeN;a++){
      const i=st.activeIdx[a];
      if(Math.floor(i/layer)===0||(st.type[i]!==1&&st.type[i]!==4)||
         st.damage[i]<0.15)continue;
      st.damage[i]+=0.07*dt;evolving=true;
      const neighbourN=collectNeighbourIndices(st,i);
      for(let n=0;n<neighbourN;n++){
        const next=neighbourIndices[n];
        if(st.alive[next]&&(st.type[next]===1||st.type[next]===4)&&
           st.damage[next]<0.9)st.damage[next]+=0.05*dt;
      }
      if(st.damage[i]>=1)failures.push(i);
      if(failures.length>=120)break;
    }
    if(!failures.length)return evolving;
    for(const i of failures)killCell(st,i,0.15,0,-0.3,0,true);
    processTopology(st);
    return true;
  }

  let contactStructure=null,contactIndex=-1;
  function updateOccupiedBounds(st){
    if(!st.collisionBoundsDirty)return;
    let x0=st.nx,y0=st.ny,z0=st.nz,x1=-1,y1=-1,z1=-1;
    for(let a=0;a<st.activeN;a++){
      const i=st.activeIdx[a],x=i%st.nx,z=Math.floor(i/st.nx)%st.nz,
        y=Math.floor(i/(st.nx*st.nz));
      x0=Math.min(x0,x);y0=Math.min(y0,y);z0=Math.min(z0,z);
      x1=Math.max(x1,x);y1=Math.max(y1,y);z1=Math.max(z1,z);
    }
    st.occupiedMinX=st.origin.x+x0*st.sx;st.occupiedMaxX=st.origin.x+(x1+1)*st.sx;
    st.occupiedMinY=st.origin.y+y0*st.sy;st.occupiedMaxY=st.origin.y+(y1+1)*st.sy;
    st.occupiedMinZ=st.origin.z+z0*st.sz;st.occupiedMaxZ=st.origin.z+(z1+1)*st.sz;
    st.collisionBoundsDirty=false;
  }
  function findStaticVoxelAt(point,ignore){
    contactStructure=null;contactIndex=-1;
    const gx=Math.floor(point.x/STRUCTURE_GRID_CELL),gz=Math.floor(point.z/STRUCTURE_GRID_CELL);
    if(gx!==staticQueryGridX||gz!==staticQueryGridZ){
      staticQueryGridX=gx;staticQueryGridZ=gz;
      staticQueryBucket=structureGrid.get(structureGridKey(gx,gz));
    }
    const nearby=staticQueryBucket;
    if(!nearby)return false;
    for(const st of nearby){
      if(st===ignore||!st.activeN)continue;
      updateOccupiedBounds(st);
      if(point.y<st.occupiedMinY||point.y>=st.occupiedMaxY||
         point.x<st.occupiedMinX||point.x>=st.occupiedMaxX||
         point.z<st.occupiedMinZ||point.z>=st.occupiedMaxZ)continue;
      const x=Math.floor((point.x-st.origin.x)/st.sx),y=Math.floor((point.y-st.origin.y)/st.sy),z=Math.floor((point.z-st.origin.z)/st.sz);
      if(!inBounds(st,x,y,z))continue;
      const i=indexOf(st,x,y,z);
      if(st.alive[i]){contactStructure=st;contactIndex=i;return true;}
    }
    return false;
  }
  const staticFaceProbe=new THREE.Vector3();
  function staticFaceExposed(st,index,nx,ny,nz){
    const x=index%st.nx,y=Math.floor(index/(st.nx*st.nz)),z=Math.floor(index/st.nx)%st.nz;
    if(inBounds(st,x+nx,y+ny,z+nz)&&st.alive[indexOf(st,x+nx,y+ny,z+nz)])return false;
    if(structures.length<2)return true;
    /* Separately authored adjoining tiers share a solid interface too. */
    staticFaceProbe.set(st.origin.x+(x+0.5)*st.sx+nx*(st.sx*0.5+0.0001),
      st.origin.y+(y+0.5)*st.sy+ny*(st.sy*0.5+0.0001),
      st.origin.z+(z+0.5)*st.sz+nz*(st.sz*0.5+0.0001));
    const savedStructure=contactStructure,savedIndex=contactIndex;
    const blocked=findStaticVoxelAt(staticFaceProbe,st);
    contactStructure=savedStructure;contactIndex=savedIndex;
    return !blocked;
  }
  const staticOverlap={st:null,index:-1,nx:0,ny:0,nz:0,penetration:Infinity};
  function prepareChunkFaces(chunk){
    if(chunk.contactCellCount===chunk.count)return;
    const st=chunk.st,cells=chunk.contactCells;cells.clear();
    for(let k=0;k<chunk.count;k++)cells.add(chunk.cellIndex[k]);
    for(let k=0;k<chunk.count;k++){
      const i=chunk.cellIndex[k],x=i%st.nx,y=Math.floor(i/(st.nx*st.nz)),z=Math.floor(i/st.nx)%st.nz;
      chunk.exposedFaces[k]=(x===0||!cells.has(i-1)?1:0)|(x===st.nx-1||!cells.has(i+1)?2:0)|
        (y===0||!cells.has(i-st.nx*st.nz)?4:0)|(y===st.ny-1||!cells.has(i+st.nx*st.nz)?8:0)|
        (z===0||!cells.has(i-st.nx)?16:0)|(z===st.nz-1||!cells.has(i+st.nx)?32:0);
    }
    chunk.contactCellCount=chunk.count;
  }
  function localFaceBit(x,y,z){
    if(Math.abs(x)>=Math.abs(y)&&Math.abs(x)>=Math.abs(z))return x<0?1:2;
    if(Math.abs(y)>=Math.abs(z))return y<0?4:8;
    return z<0?16:32;
  }
  function setChunkContactAxes(chunk){
    const axes=chunk.contactAxes;setAxes(chunk.mesh.quaternion,axes);
    const bits=chunk.worldFaceBits;
    bits[0]=localFaceBit(-axes[0].x,-axes[1].x,-axes[2].x);
    bits[1]=localFaceBit(axes[0].x,axes[1].x,axes[2].x);
    bits[2]=localFaceBit(-axes[0].y,-axes[1].y,-axes[2].y);
    bits[3]=localFaceBit(axes[0].y,axes[1].y,axes[2].y);
    bits[4]=localFaceBit(-axes[0].z,-axes[1].z,-axes[2].z);
    bits[5]=localFaceBit(axes[0].z,axes[1].z,axes[2].z);
    prepareChunkFaces(chunk);
  }
  function chunkFaceExposed(chunk,k,nx,ny,nz){
    prepareChunkFaces(chunk);
    const mask=chunk.exposedFaces[k];if(!mask)return false;if(mask===63)return true;
    if(!ny&&!nz)return !!(mask&chunk.worldFaceBits[nx<0?0:1]);
    if(!nx&&!nz)return !!(mask&chunk.worldFaceBits[ny<0?2:3]);
    if(!nx&&!ny)return !!(mask&chunk.worldFaceBits[nz<0?4:5]);
    const axes=chunk.contactAxes;
    const x=axes[0].x*nx+axes[0].y*ny+axes[0].z*nz;
    const y=axes[1].x*nx+axes[1].y*ny+axes[1].z*nz;
    const z=axes[2].x*nx+axes[2].y*ny+axes[2].z*nz;
    return !!(mask&localFaceBit(x,y,z));
  }
  let staticOverlapStamp=0;
  function considerStaticSeparation(st,index,x,y,z,axis,sign,penetration){
    const stride=axis===0?1:axis===1?st.nx*st.nz:st.nx;
    const size=axis===0?st.sx:axis===1?st.sy:st.sz;
    const limit=axis===0?st.nx:axis===1?st.ny:st.nz;
    let coordinate=axis===0?x:axis===1?y:z,i=index;
    /* Adjacent occupied cells form one solid. Walking to an exposed face
       prevents a seam inside a wall from becoming an invisible shelf. Stop
       once this direction cannot beat the nearest known escape distance. */
    while(penetration<staticOverlap.penetration){
      coordinate+=sign;
      if(coordinate<0||coordinate>=limit||!st.alive[i+sign*stride]){
        if(!staticFaceExposed(st,i,axis===0?sign:0,axis===1?sign:0,axis===2?sign:0))return;
        staticOverlap.st=st;staticOverlap.index=i;
        staticOverlap.nx=axis===0?sign:0;
        staticOverlap.ny=axis===1?sign:0;
        staticOverlap.nz=axis===2?sign:0;
        staticOverlap.penetration=penetration;
        return;
      }
      i+=sign*stride;penetration+=size;
    }
  }
  function findStaticOverlap(px,py,pz,hx,hy,hz,chunk,k){
    if(chunk){prepareChunkFaces(chunk);if(!chunk.exposedFaces[k])return false;}
    const minX=px-hx,maxX=px+hx,minY=py-hy,maxY=py+hy,minZ=pz-hz,maxZ=pz+hz;
    const xp=!chunk||chunkFaceExposed(chunk,k,-1,0,0),xm=!chunk||chunkFaceExposed(chunk,k,1,0,0);
    const yp=!chunk||chunkFaceExposed(chunk,k,0,-1,0),ym=!chunk||chunkFaceExposed(chunk,k,0,1,0);
    const zp=!chunk||chunkFaceExposed(chunk,k,0,0,-1),zm=!chunk||chunkFaceExposed(chunk,k,0,0,1);
    staticOverlap.st=null;staticOverlap.penetration=Infinity;
    const stamp=++staticOverlapStamp;
    for(let gx=Math.floor(minX/STRUCTURE_GRID_CELL);gx<=Math.floor(maxX/STRUCTURE_GRID_CELL);gx++)
      for(let gz=Math.floor(minZ/STRUCTURE_GRID_CELL);gz<=Math.floor(maxZ/STRUCTURE_GRID_CELL);gz++){
        const bucket=structureGrid.get(structureGridKey(gx,gz));if(!bucket)continue;
        for(const st of bucket){
          if(st.staticOverlapStamp===stamp)continue;st.staticOverlapStamp=stamp;
          if(!st.activeN)continue;
          updateOccupiedBounds(st);
          if(maxX<=st.occupiedMinX||minX>=st.occupiedMaxX||
             maxY<=st.occupiedMinY||minY>=st.occupiedMaxY||
             maxZ<=st.occupiedMinZ||minZ>=st.occupiedMaxZ)continue;
          const x0=Math.max(0,Math.floor((minX-st.origin.x)/st.sx));
          const x1=Math.min(st.nx-1,Math.ceil((maxX-st.origin.x)/st.sx)-1);
          const y0=Math.max(0,Math.floor((minY-st.origin.y)/st.sy));
          const y1=Math.min(st.ny-1,Math.ceil((maxY-st.origin.y)/st.sy)-1);
          const z0=Math.max(0,Math.floor((minZ-st.origin.z)/st.sz));
          const z1=Math.min(st.nz-1,Math.ceil((maxZ-st.origin.z)/st.sz)-1);
          for(let y=y0;y<=y1;y++)for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){
            const i=indexOf(st,x,y,z);if(!st.alive[i])continue;
            const bx=st.origin.x+x*st.sx,by=st.origin.y+y*st.sy,bz=st.origin.z+z*st.sz;
            if(xp)considerStaticSeparation(st,i,x,y,z,0,1,bx+st.sx-minX);
            if(xm)considerStaticSeparation(st,i,x,y,z,0,-1,maxX-bx);
            if(yp)considerStaticSeparation(st,i,x,y,z,1,1,by+st.sy-minY);
            if(ym)considerStaticSeparation(st,i,x,y,z,1,-1,maxY-by);
            if(zp)considerStaticSeparation(st,i,x,y,z,2,1,bz+st.sz-minZ);
            if(zm)considerStaticSeparation(st,i,x,y,z,2,-1,maxZ-bz);
          }
        }
      }
    return staticOverlap.st!==null;
  }
  function resolveDebrisStaticVoxel(k){
    let hit=false;
    /* Full extents catch a resting shard overlapping the wall even when its
       centre and velocity-facing corner both lie outside the masonry. */
    for(let pass=0;pass<3;pass++){
      if(!findStaticOverlap(dpx[k],dpy[k],dpz[k],dhx[k],dhy[k],dhz[k]))break;
      const c=staticOverlap;
      hit=applyDebrisStaticContact(k,c.st,c.index,c.nx,c.ny,c.nz,c.penetration)||hit;
    }
    return hit;
  }
  const debrisBalanceProbe=new THREE.Vector3();
  function debrisContactOverhang(k,c){
    if(!c.st||c.ny<0.5)return false;
    if(dpx[k]>=c.x0&&dpx[k]<=c.x1&&dpz[k]>=c.z0&&dpz[k]<=c.z1)return false;
    debrisBalanceProbe.set(dpx[k],c.plane-0.015,dpz[k]);
    return !findStaticVoxelAt(debrisBalanceProbe,null);
  }
  function applyDebrisSurfaceImpulse(k,c,restitution=0,targetVelocity=0){
    const nx=c.nx,ny=c.ny,nz=c.nz;
    const normal=dvx[k]*nx+dvy[k]*ny+dvz[k]*nz;
    if(c.epoch!==dynamicContactEpoch){
      c.epoch=dynamicContactEpoch;c.normalImpulse=0;c.tx=0;c.ty=0;c.tz=0;
      c.bounce=normal<-0.8?-normal*restitution:0;
    }
    if(c.bounce>0)targetVelocity=Math.max(targetVelocity,c.bounce);
    const previous=c.normalImpulse;
    c.normalImpulse=Math.max(0,previous+targetVelocity-normal);
    const delta=c.normalImpulse-previous;
    dvx[k]+=nx*delta;dvy[k]+=ny*delta;dvz[k]+=nz*delta;
    const centerNormal=dvx[k]*nx+dvy[k]*ny+dvz[k]*nz;
    let tx=c.tx+dvx[k]-nx*centerNormal,ty=c.ty+dvy[k]-ny*centerNormal,
      tz=c.tz+dvz[k]-nz*centerNormal;
    const tangentSpeed=Math.sqrt(tx*tx+ty*ty+tz*tz);
    /* An edge outside the COM cannot supply a static resisting moment. Let
       the tipping reaction move that COM; cancelling it as flat-floor friction
       kept overhanging bricks spinning against a ledge indefinitely. */
    const limit=(debrisContactOverhang(k,c)?0:0.55)*c.normalImpulse;
    if(tangentSpeed>limit){const scale=limit/tangentSpeed;tx*=scale;ty*=scale;tz*=scale;}
    /* Accumulate both normal and Coulomb friction impulses. Later contacts
       may retract an earlier reaction; clipping only inward velocity turned
       a small fragment under a heavy brick into an energy source. */
    dvx[k]-=tx-c.tx;dvy[k]-=ty-c.ty;dvz[k]-=tz-c.tz;
    c.tx=tx;c.ty=ty;c.tz=tz;
  }
  function applyDebrisRollingResistance(k,velocityImpulse,friction){
    /* A rough brick contact carries a resisting moment bounded by its normal
       load. I = m*s*s/6 for a cube; this is an angular impulse, not air drag
       or an age-dependent loss of motion. */
    const spin=Math.hypot(dwx[k],dwy[k],dwz[k]);
    if(spin<1e-8||velocityImpulse<=0)return;
    const delta=6*velocityImpulse*0.12*friction/dsize[k];
    const scale=Math.max(0,1-delta/spin);
    dwx[k]*=scale;dwy[k]*=scale;dwz[k]*=scale;
  }
  function debrisQuiet(k){
    const speedSq=dvx[k]*dvx[k]+dvy[k]*dvy[k]+dvz[k]*dvz[k];
    const spinSq=dwx[k]*dwx[k]+dwy[k]*dwy[k]+dwz[k]*dwz[k];
    return speedSq<0.0025&&spinSq*dsize[k]*dsize[k]*0.25<0.0025&&dcontactError[k]<0.006;
  }
  function sleepDebris(k){
    dfrozen[k]=1;dvx[k]=0;dvy[k]=0;dvz[k]=0;
    dwx[k]=0;dwy[k]=0;dwz[k]=0;
  }
  function rememberDebrisStaticContact(k,st,index,nx,ny,nz){
    const contacts=dstaticContacts[k]||(dstaticContacts[k]=[]);
    let c=contacts.find(c=>c.nx===nx&&c.ny===ny&&c.nz===nz);
    if(!c){c={};contacts.push(c);}
    const x=index%st.nx,y=Math.floor(index/(st.nx*st.nz)),z=Math.floor(index/st.nx)%st.nz;
    const oldPlane=c.plane,oldStructure=c.st;
    c.st=st;c.index=index;c.nx=nx;c.ny=ny;c.nz=nz;c.revision=topologyRevision;
    c.x0=st.origin.x+x*st.sx;c.x1=c.x0+st.sx;
    c.y0=st.origin.y+y*st.sy;c.y1=c.y0+st.sy;
    c.z0=st.origin.z+z*st.sz;c.z1=c.z0+st.sz;
    c.plane=nx?(nx>0?c.x1:-c.x0):ny?(ny>0?c.y1:-c.y0):(nz>0?c.z1:-c.z0);
    if(c.plane!==oldPlane||st!==oldStructure)c.epoch=-1;
    return c;
  }
  function applyDebrisStaticContact(k,st,index,nx,ny,nz,penetration){
    const normalVelocity=dvx[k]*nx+dvy[k]*ny+dvz[k]*nz;
    const impact=Math.max(0,-normalVelocity);
    if(impact>1){
      const mass=Math.max(0.012,dsize[k]*dsize[k]*dsize[k]);
      const work=cellFractureWork(st,index),energy=mass*impact*impact*0.5;
      const spent=Math.min(energy,Math.max(0,1-st.damage[index])*work);
      st.damage[index]+=energy/work;
      activateStructurePhysics(st);
      if(st.damage[index]>=1&&killCell(st,index,0.42,nx*0.25,ny*0.25,
        nz*0.25,true)){
        const remaining=Math.sqrt(Math.max(0,impact*impact-2*spent/mass));
        dvx[k]+=nx*(impact-remaining);dvy[k]+=ny*(impact-remaining);
        dvz[k]+=nz*(impact-remaining);return false;
      }
    }
    /* Leave only roundoff clearance. A full contact slop here re-opened a
       gap every tick, so resting stacks kept falling into it indefinitely. */
    const correction=penetration+1e-6;
    dpx[k]+=nx*correction;dpy[k]+=ny*correction;dpz[k]+=nz*correction;
    dsupportRevision[k]=0;supportCheckEpoch[k]=0;
    const contact=rememberDebrisStaticContact(k,st,index,nx,ny,nz);
    applyDebrisSurfaceImpulse(k,contact,0.2);
    if(ny>0.55){
      ddynamicSupport[k]=1;
    }
    return true;
  }

  const debrisSweepRange={enter:0,exit:1,nx:0,ny:0,nz:0};
  let debrisSweepStamp=0;
  function clipDebrisSweepAxis(origin,motion,min,max,axis){
    if(Math.abs(motion)<1e-12)return origin>=min&&origin<=max;
    let near=(min-origin)/motion,far=(max-origin)/motion;
    if(near>far){const swap=near;near=far;far=swap;}
    if(near>debrisSweepRange.enter){
      debrisSweepRange.enter=near;
      const sign=motion>0?-1:1;
      debrisSweepRange.nx=axis===0?sign:0;
      debrisSweepRange.ny=axis===1?sign:0;
      debrisSweepRange.nz=axis===2?sign:0;
    }
    debrisSweepRange.exit=Math.min(debrisSweepRange.exit,far);
    return debrisSweepRange.enter<=debrisSweepRange.exit;
  }
  const staticSweep={st:null,index:-1,nx:0,ny:0,nz:0,time:1};
  function findStaticSweep(px,py,pz,hx,hy,hz,mx,my,mz,chunk,k){
    if(chunk){prepareChunkFaces(chunk);if(!chunk.exposedFaces[k])return false;}
    const minX=Math.min(px,px+mx)-hx,maxX=Math.max(px,px+mx)+hx;
    const minY=Math.min(py,py+my)-hy,maxY=Math.max(py,py+my)+hy;
    const minZ=Math.min(pz,pz+mz)-hz,maxZ=Math.max(pz,pz+mz)+hz;
    let hit=null,index=-1,time=1,nx=0,ny=0,nz=0;
    const stamp=++debrisSweepStamp;
    for(let gx=Math.floor(minX/STRUCTURE_GRID_CELL);gx<=Math.floor(maxX/STRUCTURE_GRID_CELL);gx++)
      for(let gz=Math.floor(minZ/STRUCTURE_GRID_CELL);gz<=Math.floor(maxZ/STRUCTURE_GRID_CELL);gz++){
        const bucket=structureGrid.get(structureGridKey(gx,gz));
        if(!bucket)continue;
        for(const st of bucket){
          if(st.debrisSweepStamp===stamp)continue;
          st.debrisSweepStamp=stamp;
          if(!st.activeN)continue;
          updateOccupiedBounds(st);
          if(maxX<st.occupiedMinX||minX>st.occupiedMaxX||
             maxY<st.occupiedMinY||minY>st.occupiedMaxY||
             maxZ<st.occupiedMinZ||minZ>st.occupiedMaxZ)continue;
          const x0=Math.max(0,Math.floor((minX-st.origin.x)/st.sx));
          const x1=Math.min(st.nx-1,Math.floor((maxX-st.origin.x)/st.sx));
          const y0=Math.max(0,Math.floor((minY-st.origin.y)/st.sy));
          const y1=Math.min(st.ny-1,Math.floor((maxY-st.origin.y)/st.sy));
          const z0=Math.max(0,Math.floor((minZ-st.origin.z)/st.sz));
          const z1=Math.min(st.nz-1,Math.floor((maxZ-st.origin.z)/st.sz));
          for(let y=y0;y<=y1;y++)for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){
            const i=indexOf(st,x,y,z);if(!st.alive[i])continue;
            const bx=st.origin.x+x*st.sx,by=st.origin.y+y*st.sy,bz=st.origin.z+z*st.sz;
            debrisSweepRange.enter=0;debrisSweepRange.exit=time;
            debrisSweepRange.nx=0;debrisSweepRange.ny=0;debrisSweepRange.nz=0;
            if(!clipDebrisSweepAxis(px,mx,bx-hx,bx+st.sx+hx,0)||
               !clipDebrisSweepAxis(py,my,by-hy,by+st.sy+hy,1)||
               !clipDebrisSweepAxis(pz,mz,bz-hz,bz+st.sz+hz,2))continue;
            /* Existing overlap belongs to the discrete depenetration pass. */
            if(!debrisSweepRange.nx&&!debrisSweepRange.ny&&!debrisSweepRange.nz)continue;
            if(!staticFaceExposed(st,i,debrisSweepRange.nx,debrisSweepRange.ny,debrisSweepRange.nz))continue;
            if(chunk&&!chunkFaceExposed(chunk,k,-debrisSweepRange.nx,-debrisSweepRange.ny,-debrisSweepRange.nz))continue;
            time=debrisSweepRange.enter;hit=st;index=i;
            nx=debrisSweepRange.nx;ny=debrisSweepRange.ny;nz=debrisSweepRange.nz;
          }
        }
      }
    if(!hit)return false;
    staticSweep.st=hit;staticSweep.index=index;staticSweep.time=time;
    staticSweep.nx=nx;staticSweep.ny=ny;staticSweep.nz=nz;
    return true;
  }
  function sweepDebrisStatic(k,mx,my,mz){
    const px=dpx[k],py=dpy[k],pz=dpz[k];
    if(!findStaticSweep(px,py,pz,dhx[k],dhy[k],dhz[k],mx,my,mz))return false;
    const {st,index,nx,ny,nz,time}=staticSweep;
    dpx[k]=px+mx*time;dpy[k]=py+my*time;dpz[k]=pz+mz*time;
    if(!applyDebrisStaticContact(k,st,index,nx,ny,nz,0)){
      const remaining=(1-time)*FIXED_STEP;
      dpx[k]+=dvx[k]*remaining;dpy[k]+=dvy[k]*remaining;dpz[k]+=dvz[k]*remaining;
    }
    return true;
  }
  function chunkSupportScan(chunk,halfY){
    const supports=[];
    for(let k=0;k<chunk.count;k++){
      chunkWorld(chunk,k,tmpPos);
      const bottom=tmpPos.y-halfY;
      if(bottom<=groundY+0.08){supports.push({x:tmpPos.x,z:tmpPos.z});continue;}
      tmpPosB.set(tmpPos.x,bottom-0.04,tmpPos.z);
      if(!findStaticVoxelAt(tmpPosB,null))continue;
      coords(contactStructure,contactIndex,coord);
      const top=contactStructure.origin.y+(coord.y+1)*contactStructure.sy;
      if(staticFaceExposed(contactStructure,contactIndex,0,1,0)&&
         Math.abs(top-bottom)<=Math.max(chunk.st.sy,contactStructure.sy)*0.3)
        supports.push({x:tmpPos.x,z:tmpPos.z});
    }
    if(!supports.length)return null;
    return supportScan(supports,chunk.mesh.position.x,chunk.mesh.position.z);
  }
  function removeChunk(chunk){
    removeOccluder(chunk.mesh);removeStandable(chunk.mesh);scene.remove(chunk.mesh);
    chunk.mesh.dispose();
    chunk.count=0;chunk.mesh.count=0;
    const i=chunks.indexOf(chunk);if(i>=0)chunks.splice(i,1);
  }

  function copyChunkCell(target,k,source,i){
    target.lx[k]=source.lx[i];target.ly[k]=source.ly[i];target.lz[k]=source.lz[i];
    target.cr[k]=source.cr[i];target.cg[k]=source.cg[i];target.cb[k]=source.cb[i];
    target.strength[k]=source.strength[i];target.type[k]=source.type[i];
    target.damage[k]=source.damage[i];target.cellIndex[k]=source.cellIndex[i];
  }
  function removeChunkCell(chunk,k){
    const last=--chunk.count;
    if(k!==last){copyChunkCell(chunk,k,chunk,last);refreshChunkInstance(chunk,k);}
    chunk.mesh.count=chunk.count;chunk.mesh.instanceMatrix.needsUpdate=true;
    if(chunk.mesh.instanceColor)chunk.mesh.instanceColor.needsUpdate=true;
  }
  function killChunkCell(chunk,k,power,dx,dy,dz){
    chunkWorld(chunk,k,tmpPos);chunkVelocity(chunk,tmpPos,tmpVel);
    const size=Math.min(chunk.st.sx,chunk.st.sy,chunk.st.sz);
    const high=power>=0.62,pieces=high?3:1;
    for(let n=0;n<pieces;n++)spawnDebris(tmpPos.x,tmpPos.y,tmpPos.z,
      tmpVel.x+dx*(3+10*power)+(Math.random()-0.5)*3,
      tmpVel.y+dy*(3+10*power)+1+Math.random()*2,
      tmpVel.z+dz*(3+10*power)+(Math.random()-0.5)*3,
      size*(high?0.42:0.9),chunk.cr[k],chunk.cg[k],chunk.cb[k]);
    destroyedPending++;removeChunkCell(chunk,k);
  }
  function copyChunkComponent(target,source,list){
    /* Recenter around the surviving mass while keeping every brick's world
       pose and tangential velocity. Sorting also makes in-place compaction
       safe: a destination never overwrites a source we have yet to copy. */
    list.sort((a,b)=>a-b);
    let mx=0,my=0,mz=0;
    for(const k of list){mx+=source.lx[k];my+=source.ly[k];mz+=source.lz[k];}
    mx/=list.length;my/=list.length;mz/=list.length;
    tmpPos.set(mx,my,mz).applyQuaternion(source.mesh.quaternion).add(source.mesh.position);
    chunkVelocity(source,tmpPos,tmpVel);
    target.vel.copy(tmpVel);target.mesh.position.copy(tmpPos);
    target.mesh.quaternion.copy(source.mesh.quaternion);
    target.axis.copy(source.axis);target.omega=source.omega;target.angle=source.angle;
    target.mode='free';target.bounces=source.bounces;target.restTime=0;
    target.radius=0;target.minLocalY=Infinity;
    for(let k=0;k<list.length;k++){
      copyChunkCell(target,k,source,list[k]);
      target.lx[k]-=mx;target.ly[k]-=my;target.lz[k]-=mz;
      target.radius=Math.max(target.radius,Math.hypot(target.lx[k],target.ly[k],target.lz[k]));
      target.minLocalY=Math.min(target.minLocalY,target.ly[k]);
      refreshChunkInstance(target,k);
    }
    target.count=list.length;target.mesh.count=target.count;
    target.mesh.instanceMatrix.needsUpdate=true;
    if(target.mesh.instanceColor)target.mesh.instanceColor.needsUpdate=true;
    target.mesh.updateMatrixWorld(true);refreshChunkFrustumBounds(target);
  }
  function fractureChunk(chunk){
    if(!chunk.count){removeChunk(chunk);return;}
    freePivotChunk(chunk);
    const slots=new Map(),visited=new Uint8Array(chunk.count),components=[];
    for(let k=0;k<chunk.count;k++)slots.set(chunk.cellIndex[k],k);
    for(let k=0;k<chunk.count;k++){
      if(visited[k])continue;
      const list=[k];visited[k]=1;
      for(let q=0;q<list.length;q++){
        const n=collectNeighbourIndices(chunk.st,chunk.cellIndex[list[q]]);
        for(let j=0;j<n;j++){
          const next=slots.get(neighbourIndices[j]);
          if(next===undefined||visited[next])continue;
          visited[next]=1;list.push(next);
        }
      }
      components.push(list);
    }
    components.sort((a,b)=>b.length-a.length);
    /* A cut cannot leave disconnected bricks attached through empty space.
       Keep substantial sections rigid; single bricks enter the rubble pool. */
    for(let i=components.length-1;i>=0;i--){
      const list=components[i];
      if(list.length<4){
        for(const k of list){
          chunkWorld(chunk,k,tmpPos);chunkVelocity(chunk,tmpPos,tmpVel);
          spawnDebris(tmpPos.x,tmpPos.y,tmpPos.z,tmpVel.x,tmpVel.y,tmpVel.z,
            Math.min(chunk.st.sx,chunk.st.sy,chunk.st.sz)*0.9,
            chunk.cr[k],chunk.cg[k],chunk.cb[k]);
          destroyedPending++;
        }
      }else if(i>0){
        const part=createChunk(chunk.st,list.length);
        copyChunkComponent(part,chunk,list);addChunk(part);
      }
    }
    if(components[0].length<4)removeChunk(chunk);
    else copyChunkComponent(chunk,chunk,components[0]);
  }

  function resolveChunkImpact(chunk,impact){
    const n=chunk.count,soft=impact<SOFT_LAND;
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

      removed++;
      if(power<0.3){
        /* A resting section becomes loose masonry at its actual pose. It
           cannot repair the authored lattice or gain a fresh upward kick. */
        const slot=spawnDebris(tmpPos.x,tmpPos.y,tmpPos.z,
          tmpVel.x,tmpVel.y,tmpVel.z,baseSize*0.94,
          chunk.cr[k],chunk.cg[k],chunk.cb[k]);
        dqx[slot]=chunk.mesh.quaternion.x;dqy[slot]=chunk.mesh.quaternion.y;
        dqz[slot]=chunk.mesh.quaternion.z;dqw[slot]=chunk.mesh.quaternion.w;
        dwx[slot]=chunk.axis.x*chunk.omega;dwy[slot]=chunk.axis.y*chunk.omega;
        dwz[slot]=chunk.axis.z*chunk.omega;updateDebrisExtents(slot);
        continue;
      }
      const pieces=power>=0.62?4:2;
      const size=baseSize*(power>=0.62?0.25:0.5);
      const dirX=Math.random()-0.5,dirZ=Math.random()-0.5;
      for(let p=0;p<pieces;p++)spawnDebris(
        tmpPos.x+(Math.random()-0.5)*baseSize*0.6,tmpPos.y,
        tmpPos.z+(Math.random()-0.5)*baseSize*0.6,
        tmpVel.x*0.55+dirX*(2+10*power)+(Math.random()-0.5)*4,
        tmpVel.y*0.55+(Math.random()-0.5)*Math.min(3,impact*0.15),
        tmpVel.z*0.55+dirZ*(2+10*power)+(Math.random()-0.5)*4,
        size,chunk.cr[k],chunk.cg[k],chunk.cb[k]);
    }
    destroyedPending+=removed;removeChunk(chunk);return true;
  }

  function cellFractureWork(st,i){
    /* Strength is measured in voxel weights by the load solver. Convert it
       to work across a fraction of a cell, retaining volume and material:
       chips cannot hit with the energy of a multi-storey section. */
    const brittle=st.type[i]===4?0.22:st.materialKind==='wood'?0.65:1;
    return Math.max(0.001,st.strength[i]*st.sx*st.sy*st.sz*GRAVITY*
      Math.min(st.sx,st.sy,st.sz)*0.16*brittle);
  }
  function crushChunkContacts(chunk,contacts,dt,damaged){
    const mass=chunk.count*chunk.st.sx*chunk.st.sy*chunk.st.sz;
    const workByAxis=[0,0,0];let broken=false;
    for(const c of contacts){
      const st=c.st,i=c.index,key=st.id+':'+i;
      if(!st.alive[i]||damaged.has(key))continue;
      damaged.add(key);
      const share=mass/contacts.length;
      const energy=share*c.speed*c.speed*0.5;
      const work=cellFractureWork(st,i);
      const remaining=Math.max(0,1-st.damage[i]);
      const loadRatio=c.ny>0.5?share/(st.sx*st.sy*st.sz*Math.max(1,st.strength[i])*
        Math.max(0.1,1-0.7*st.damage[i])):0;
      const delta=energy/work+Math.max(0,loadRatio-1)*dt*3;
      if(delta<=0)continue;
      st.damage[i]+=delta;activateStructurePhysics(st);
      workByAxis[c.nx?0:c.ny?1:2]+=Math.min(energy,remaining*work);
      if(st.damage[i]>=1){
        // Damage the contact face before any depenetration or bounce removes it.
        killCell(st,i,0.42,-c.nx*0.15,-c.ny*0.15,-c.nz*0.15,true);
        broken=true;
      }
    }
    for(let axis=0;axis<3;axis++){
      const name=axis===0?'x':axis===1?'y':'z',v=chunk.vel[name];
      if(workByAxis[axis]&&v)chunk.vel[name]=Math.sign(v)*
        Math.sqrt(Math.max(0,v*v-2*workByAxis[axis]/mass));
    }
    return broken;
  }
  function crushSupportsThroughRubble(dt){
    const supports=new Map();
    for(let i=0;i<dynamicContactCount;i++){
      const c=dynamicContactPool[i];
      const upper=c.ny>0.5?c.b:c.ny<-0.5?c.a:null;
      const lower=upper===c.b?c.a:c.b;
      if(!upper||lower.kind!==0)continue;
      let list=supports.get(upper.bodyId);
      if(!list){list=[];supports.set(upper.bodyId,list);}list.push(lower);
    }
    for(const chunk of chunks){
      const first=supports.get(chunk.collisionBodyId);if(!first)continue;
      const queue=first.slice(),visited=new Set(),contacts=new Map();
      for(let n=0;n<queue.length;n++){
        const entry=queue[n];if(visited.has(entry.bodyId))continue;
        visited.add(entry.bodyId);
        const below=supports.get(entry.bodyId);if(below)queue.push(...below);
        const faces=dstaticContacts[entry.index];if(!faces)continue;
        tmpPos.set(entry.x,entry.y,entry.z);chunkVelocity(chunk,tmpPos,tmpVel);
        for(const face of faces){
          if(face.ny<0.5||!face.st.alive[face.index])continue;
          if(Math.abs(dpy[entry.index]-dhy[entry.index]-face.plane)>DYNAMIC_CONTACT_MARGIN)continue;
          const key=face.st.id+':'+face.index,speed=Math.max(0,-tmpVel.y);
          if(!contacts.has(key)||speed>contacts.get(key).speed)
            contacts.set(key,{st:face.st,index:face.index,nx:0,ny:1,nz:0,speed});
        }
      }
      if(!contacts.size)continue;
      if(chunk.crushEpoch!==dynamicContactEpoch){
        chunk.crushEpoch=dynamicContactEpoch;chunk.crushedContacts=new Set();
      }
      crushChunkContacts(chunk,Array.from(contacts.values()),dt,chunk.crushedContacts);
    }
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
      removeChunkCell(chunk,best);
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
        let impact=0,groundHit=false;const contacts=new Map();
        setChunkContactAxes(chunk);
        orientedExtents(chunk.contactAxes,chunk.st.sx*0.48,chunk.st.sy*0.48,chunk.st.sz*0.48,tmpHalf);
        const hx=tmpHalf.x,hy=tmpHalf.y,hz=tmpHalf.z;
        for(let k=0;k<chunk.count;k++){
          chunkWorld(chunk,k,tmpPos);const dist=tmpPos.distanceTo(chunk.pivot);
          if(dist<Math.min(chunk.st.sx,chunk.st.sy,chunk.st.sz)*2.5)continue;
          const speed=chunk.omega*dist;
          if(tmpPos.y-hy<=groundY){impact=Math.max(impact,speed);groundHit=true;continue;}
          /* Detached cells are no longer alive, so it is safe—and essential—to
             collide with this structure too. Otherwise a falling wall can pass
             straight through the surviving corner/foundation that should catch
             it, generate torque, and break it apart. */
          if(findStaticOverlap(tmpPos.x,tmpPos.y,tmpPos.z,hx,hy,hz,chunk,k)){
            const c=staticOverlap;chunkVelocity(chunk,tmpPos,tmpVel);
            const normalSpeed=Math.max(0,-tmpVel.x*c.nx-tmpVel.y*c.ny-tmpVel.z*c.nz);
            contacts.set(c.st.id+':'+c.index,{st:c.st,index:c.index,
              nx:c.nx,ny:c.ny,nz:c.nz,speed:normalSpeed});
            impact=Math.max(impact,speed);
          }
        }
        if(contacts.size){
          // Release the hinge with its actual momentum before crushing a floor.
          freePivotChunk(chunk);
          if(crushChunkContacts(chunk,Array.from(contacts.values()),dt,new Set())&&!groundHit)continue;
        }
        if(impact>0){resolveChunkImpact(chunk,Math.max(7,impact));continue;}
        if(chunk.angle>1.3){
          freePivotChunk(chunk);
        }
        shedChunk(chunk,dt);continue;
      }
      chunk.vel.y-=GRAVITY*dt;
      const mx=chunk.vel.x*dt,my=chunk.vel.y*dt,mz=chunk.vel.z*dt;
      chunk.mesh.position.addScaledVector(chunk.vel,dt);
      chunk.angle+=chunk.omega*dt;
      /* Spin describes future motion, not the axis of every rotation the body
         has ever made. Rebuilding the pose from a changed axis and total angle
         teleported tilted walls/cores when a shot, blast, or contact hit them. */
      tmpQuat.setFromAxisAngle(chunk.axis,chunk.omega*dt);
      chunk.mesh.quaternion.premultiply(tmpQuat).normalize();
      setChunkContactAxes(chunk);
      setAxes(chunk.mesh.quaternion,dynamicAxes);
      orientedExtents(dynamicAxes,chunk.st.sx*0.48,chunk.st.sy*0.48,chunk.st.sz*0.48,tmpHalf);
      const hx=tmpHalf.x,hy=tmpHalf.y,hz=tmpHalf.z;
      let staticContact=false,minY=Infinity,supportingContact=false;
      const impact=Math.abs(chunk.vel.y)+Math.abs(chunk.omega)*chunk.radius*0.5;
      chunk.crushEpoch=dynamicContactEpoch;
      const damagedContacts=chunk.crushedContacts=new Set();
      if(Math.hypot(mx,my,mz)>Math.min(chunk.st.sx,chunk.st.sy,chunk.st.sz)*0.4){
        for(let pass=0;pass<4;pass++){
          const contacts=new Map();let first=null;
          for(let k=0;k<chunk.count;k++){
            chunkWorld(chunk,k,tmpPos);
            if(!findStaticSweep(tmpPos.x-mx,tmpPos.y-my,tmpPos.z-mz,
              hx,hy,hz,mx,my,mz,chunk,k))continue;
            const c=staticSweep;
            chunkVelocity(chunk,tmpPos,tmpVel);
            const hit={...c,speed:Math.max(0,-tmpVel.x*c.nx-tmpVel.y*c.ny-tmpVel.z*c.nz)};
            contacts.set(c.st.id+':'+c.index,hit);
            if(!first||hit.time<first.time)first=hit;
          }
          if(!first)break;
          if(crushChunkContacts(chunk,Array.from(contacts.values()),dt,damagedContacts))continue;
          tmpContactNormal.set(first.nx,first.ny,first.nz);
          const remaining=-(mx*first.nx+my*first.ny+mz*first.nz)*(1-first.time);
          chunk.mesh.position.addScaledVector(tmpContactNormal,remaining+1e-6);
          const vn=chunk.vel.dot(tmpContactNormal);
          if(vn<0)chunk.vel.addScaledVector(tmpContactNormal,-vn*1.12);
          staticContact=true;supportingContact=first.ny>0.5;
          break;
        }
      }
      /* Project the penetrated surface only. Rolling the entire pose back on
         a side contact undid gravity every tick and left detached sections
         hanging in their original wall, with an ever-growing fall velocity. */
      for(let pass=0;pass<3;pass++){
        let deepest=0;tmpContactNormal.set(0,0,0);
        const contacts=new Map();
        for(let k=0;k<chunk.count;k++){
          chunkWorld(chunk,k,tmpPos);
          if(!findStaticOverlap(tmpPos.x,tmpPos.y,tmpPos.z,hx,hy,hz,chunk,k))continue;
          const c=staticOverlap,key=c.st.id+':'+c.index;
          chunkVelocity(chunk,tmpPos,tmpVel);
          const speed=Math.max(0,-tmpVel.x*c.nx-tmpVel.y*c.ny-tmpVel.z*c.nz);
          const old=contacts.get(key);
          if(!old||speed>old.speed)contacts.set(key,{st:c.st,index:c.index,
            nx:c.nx,ny:c.ny,nz:c.nz,speed});
          if(staticOverlap.penetration>deepest){
            deepest=staticOverlap.penetration;
            tmpContactNormal.set(staticOverlap.nx,staticOverlap.ny,staticOverlap.nz);
          }
        }
        if(!deepest)break;
        if(crushChunkContacts(chunk,Array.from(contacts.values()),dt,damagedContacts))continue;
        staticContact=true;
        chunk.mesh.position.addScaledVector(tmpContactNormal,deepest+DYNAMIC_CONTACT_SLOP);
        const vn=chunk.vel.dot(tmpContactNormal);
        if(vn<0){
          const impulse=-vn*(1+(-vn>0.8?0.28:0));
          chunk.vel.addScaledVector(tmpContactNormal,impulse);
          tmpVel.copy(chunk.vel).addScaledVector(tmpContactNormal,-chunk.vel.dot(tmpContactNormal));
          const tangentSpeed=tmpVel.length();
          if(tangentSpeed>1e-8)chunk.vel.addScaledVector(tmpVel,-Math.min(1,0.55*impulse/tangentSpeed));
        }
        if(pass===0)chunk.omega*=-0.48;
        supportingContact=supportingContact||tmpContactNormal.y>0.5;
      }
      for(let k=0;k<chunk.count;k++){
        chunkWorld(chunk,k,tmpPos);minY=Math.min(minY,tmpPos.y-hy);
      }
      const groundContact=minY<=groundY;
      if(groundContact){
        if(minY<groundY)chunk.mesh.position.y+=groundY-minY;
        const bounceLimit=chunk.count>800?1:3;
        /* Moderate landings can roll; hard or repeated impacts break the
           section into loose masonry at its current pose. */
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
      const support=supportingContact?chunkSupportScan(chunk,hy):null;
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
        chunk.restTime=0;
      }
      if(stableSupport&&motion<1.15){
        chunk.restTime+=dt;chunk.vel.multiplyScalar(Math.exp(-8*dt));chunk.omega*=Math.exp(-10*dt);
        /* Confirm quiet contact before releasing the individual bricks.
           They retain their pose and must find support independently. */
        if(chunk.restTime>=0.12){resolveChunkImpact(chunk,motion);continue;}
      }else if(motion>1.6)chunk.restTime=0;
      else chunk.restTime=Math.max(0,chunk.restTime-dt*0.2);
      if(stableSupport&&Math.abs(chunk.vel.y)<0.18)chunk.vel.y=0;
      if(chunks.indexOf(chunk)>=0)shedChunk(chunk,dt);
    }
  }

  function dynamicGridKey(x,y,z){
    /* Exact 51-bit packing covers more than 18 km in each direction at the
       smallest grid size. Keep a collision-free fallback for custom worlds. */
    if(x>=-65536&&x<65536&&y>=-65536&&y<65536&&z>=-65536&&z<65536)
      return ((x+65536)*131072+y+65536)*131072+z+65536;
    return x+'_'+y+'_'+z;
  }
  function resetDynamicGrid(){
    for(let i=0;i<dynamicBucketCount;i++){
      dynamicBuckets[i].active.length=0;dynamicBuckets[i].frozen.length=0;
    }
    dynamicBucketCount=0;dynamicGrid.clear();dynamicEntries.length=0;
    dynamicExternalEntries.length=0;
    dynamicMaxExtent=0;
  }
  function appendDynamicEntry(entry){
    entry.order=dynamicEntries.length;dynamicEntries.push(entry);
    dynamicMaxExtent=Math.max(dynamicMaxExtent,entry.hx,entry.hy,entry.hz);
  }
  function populateDynamicGrid(){
    dynamicGridCell=Math.max(DYNAMIC_GRID_MIN_CELL,
      dynamicMaxExtent*2+DYNAMIC_CONTACT_MARGIN*2);
    for(const entry of dynamicEntries){
      entry.gx=Math.floor(entry.x/dynamicGridCell);
      entry.gy=Math.floor(entry.y/dynamicGridCell);
      entry.gz=Math.floor(entry.z/dynamicGridCell);
      const key=dynamicGridKey(entry.gx,entry.gy,entry.gz);
      let bucket=dynamicGrid.get(key);
      if(!bucket){
        bucket=dynamicBuckets[dynamicBucketCount];
        if(!bucket){bucket={active:[],frozen:[],gx:0,gy:0,gz:0};dynamicBuckets.push(bucket);}
        else{
          bucket.active.length=0;bucket.frozen.length=0;
        }
        bucket.gx=entry.gx;bucket.gy=entry.gy;bucket.gz=entry.gz;
        dynamicBucketCount++;dynamicGrid.set(key,bucket);
      }
      (entry.sleeping?bucket.frozen:bucket.active).push(entry);
    }
  }
  function prepareDebrisCollisionEntries(){
    debrisSweepEntries.length=debrisN;
    let sx=0,sy=0,sz=0,sxx=0,syy=0,szz=0;
    for(let k=0;k<debrisN;k++){
      let entry=debrisCollisionEntries[k];
      if(!entry){
        entry={kind:0,index:k,chunk:null,bodyId:0,x:0,y:0,z:0,hx:0,hy:0,hz:0,
          invMass:0,gx:0,gy:0,gz:0,order:0,sweepMin:0,sweepMax:0};
        debrisCollisionEntries[k]=entry;
      }
      entry.index=k;entry.bodyId=k+1;entry.x=dpx[k];entry.y=dpy[k];entry.z=dpz[k];
      entry.hx=dhx[k];entry.hy=dhy[k];entry.hz=dhz[k];
      if(!entry.axes)entry.axes=[new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3()];
      // Float32 storage slightly changes quaternion length; the SAT basis is orthonormal.
      tmpQuat.set(dqx[k],dqy[k],dqz[k],dqw[k]).normalize();setAxes(tmpQuat,entry.axes);
      entry.bx=entry.by=entry.bz=dsize[k]*0.5;
      entry.invMass=dfrozen[k]?0:1/Math.max(0.012,dsize[k]*dsize[k]*dsize[k]);
      entry.sleeping=!!dfrozen[k];
      // Keep the previous sweep order: coherent motion makes the next sort linear.
      if(!debrisSweepEntries[k])debrisSweepEntries[k]=entry;
      sx+=entry.x;sy+=entry.y;sz+=entry.z;
      sxx+=entry.x*entry.x;syy+=entry.y*entry.y;szz+=entry.z*entry.z;
    }
    /* Falling towers spread mostly vertically; a permanent X sweep scans a
       dense column of impossible pairs. Sweep the axis with greatest variance
       while preserving the same exact overlap tests and stable tie-break. */
    const count=Math.max(1,debrisN);
    const vx=sxx-sx*sx/count,vy=syy-sy*sy/count,vz=szz-sz*sz/count;
    debrisSweepAxis=vy>vx&&vy>=vz?1:(vz>vx?2:0);
    debrisBandAxis=debrisSweepAxis===0?(vy>vz?1:2):
      (debrisSweepAxis===1?(vx>vz?0:2):(vx>vy?0:1));
    for(const entry of debrisSweepEntries){
      const center=debrisSweepAxis===0?entry.x:(debrisSweepAxis===1?entry.y:entry.z);
      const extent=debrisSweepAxis===0?entry.hx:(debrisSweepAxis===1?entry.hy:entry.hz);
      entry.sweepMin=center-extent;entry.sweepMax=center+extent;
    }
  }
  function buildDynamicVoxelGrid(externalBodies,settledBodies){
    resetDynamicGrid();
    for(const chunk of chunks){
      setChunkContactAxes(chunk);
      setAxes(chunk.mesh.quaternion,dynamicAxes);
      orientedExtents(dynamicAxes,chunk.st.sx*0.47,chunk.st.sy*0.47,
        chunk.st.sz*0.47,tmpHalf);
      chunk.collisionInvMass=1/Math.max(0.05,
        chunk.count*chunk.st.sx*chunk.st.sy*chunk.st.sz);
      if(!chunk.collisionBodyId)chunk.collisionBodyId=nextDynamicBodyId++;
      const rebuildCells=chunk.contactEntryCount!==chunk.count;
      if(rebuildCells)chunk.contactEntryByCell.clear();
      chunk.contactBounds.makeEmpty();
      for(let k=0;k<chunk.count;k++){
        // Buried cells carry mass, but none of their faces can make contact.
        if(!chunk.exposedFaces[k])continue;
        let entry=chunk.collisionEntries[k];
        if(!entry){
          entry={kind:1,index:k,chunk:null,bodyId:0,x:0,y:0,z:0,hx:0,hy:0,hz:0,
            invMass:0,gx:0,gy:0,gz:0,order:0};
          chunk.collisionEntries[k]=entry;
        }
        entry.chunk=chunk;entry.index=k;entry.bodyId=chunk.collisionBodyId;
        entry.invMass=chunk.collisionInvMass;entry.sleeping=false;
        chunkWorld(chunk,k,tmpPos);
        entry.x=tmpPos.x;entry.y=tmpPos.y;entry.z=tmpPos.z;
        entry.hx=tmpHalf.x;entry.hy=tmpHalf.y;entry.hz=tmpHalf.z;
        entry.axes=chunk.contactAxes;
        entry.bx=chunk.st.sx*0.47;entry.by=chunk.st.sy*0.47;entry.bz=chunk.st.sz*0.47;
        appendDynamicEntry(entry);
        if(rebuildCells)chunk.contactEntryByCell.set(chunk.cellIndex[k],entry);
        chunk.contactBounds.min.min(tmpPos.set(entry.x-entry.hx,entry.y-entry.hy,entry.z-entry.hz));
        chunk.contactBounds.max.max(tmpPos.set(entry.x+entry.hx,entry.y+entry.hy,entry.z+entry.hz));
      }
      chunk.contactEntryCount=chunk.count;
      const first=chunk.cellIndex[0],st=chunk.st;
      chunk.contactGridOffset.set(chunk.lx[0]-(first%st.nx+0.5)*st.sx,
        chunk.ly[0]-(Math.floor(first/(st.nx*st.nz))+0.5)*st.sy,
        chunk.lz[0]-(Math.floor(first/st.nx)%st.nz+0.5)*st.sz);
    }
    for(let k=0;k<debrisN;k++)appendDynamicEntry(debrisCollisionEntries[k]);
    appendExternalDynamicBodies(externalBodies,
      externalCollisionEntries,false);
    appendExternalDynamicBodies(settledBodies,
      externalSettledCollisionEntries,true);
    if(dynamicExternalEntries.length)populateDynamicGrid();
  }
  function gatherChunkCandidate(entry,chunk,dt){
    const bounds=chunk.contactBounds,margin=DYNAMIC_CONTACT_MARGIN;
    if(entry.x+entry.hx+margin<bounds.min.x||entry.x-entry.hx-margin>bounds.max.x||
       entry.y+entry.hy+margin<bounds.min.y||entry.y-entry.hy-margin>bounds.max.y||
       entry.z+entry.hz+margin<bounds.min.z||entry.z-entry.hz-margin>bounds.max.z)return;
    const axes=chunk.contactAxes,st=chunk.st,offset=chunk.contactGridOffset;
    const dx=entry.x-chunk.mesh.position.x,dy=entry.y-chunk.mesh.position.y,dz=entry.z-chunk.mesh.position.z;
    const x=dx*axes[0].x+dy*axes[0].y+dz*axes[0].z-offset.x;
    const y=dx*axes[1].x+dy*axes[1].y+dz*axes[1].z-offset.y;
    const z=dx*axes[2].x+dy*axes[2].y+dz*axes[2].z-offset.z;
    // Float32 local cell centres may differ by a few micrometres after fracture.
    const pad=margin+1e-6*(1+chunk.radius);
    const hx=projectedEntryRadius(entry,axes[0].x,axes[0].y,axes[0].z)+st.sx*0.47+pad;
    const hy=projectedEntryRadius(entry,axes[1].x,axes[1].y,axes[1].z)+st.sy*0.47+pad;
    const hz=projectedEntryRadius(entry,axes[2].x,axes[2].y,axes[2].z)+st.sz*0.47+pad;
    const x0=Math.max(0,Math.ceil((x-hx)/st.sx-0.5)),x1=Math.min(st.nx-1,Math.floor((x+hx)/st.sx-0.5));
    const y0=Math.max(0,Math.ceil((y-hy)/st.sy-0.5)),y1=Math.min(st.ny-1,Math.floor((y+hy)/st.sy-0.5));
    const z0=Math.max(0,Math.ceil((z-hz)/st.sz-0.5)),z1=Math.min(st.nz-1,Math.floor((z+hz)/st.sz-0.5));
    if((x1-x0+1)*(y1-y0+1)*(z1-z0+1)>chunk.count){
      for(let k=0;k<chunk.count;k++)if(chunk.exposedFaces[k])
        queueDynamicVoxelPair(entry,chunk.collisionEntries[k],dt);
      return;
    }
    for(let iy=y0;iy<=y1;iy++)for(let iz=z0;iz<=z1;iz++)for(let ix=x0;ix<=x1;ix++){
      const other=chunk.contactEntryByCell.get(indexOf(st,ix,iy,iz));
      if(other)queueDynamicVoxelPair(entry,other,dt);
    }
  }
  function gatherChunkVoxelContacts(dt){
    /* Detached sections retain their authored cell lattice even while rotating.
       Query that lattice directly instead of comparing tiny cells against every
       cell in neighbouring coarse world buckets, including their own section. */
    for(let i=0;i<chunks.length;i++){
      const chunk=chunks[i];
      for(let k=0;k<debrisN;k++)gatherChunkCandidate(debrisCollisionEntries[k],chunk,dt);
      for(let j=i+1;j<chunks.length;j++){
        const other=chunks[j],source=chunk.count<=other.count?chunk:other;
        const target=source===chunk?other:chunk;
        if(!chunk.contactBounds.intersectsBox(other.contactBounds)){
          const a=chunk.contactBounds,b=other.contactBounds,m=DYNAMIC_CONTACT_MARGIN;
          if(a.max.x+m<b.min.x||a.min.x-m>b.max.x||a.max.y+m<b.min.y||a.min.y-m>b.max.y||
             a.max.z+m<b.min.z||a.min.z-m>b.max.z)continue;
        }
        for(let k=0;k<source.count;k++)if(source.exposedFaces[k])
          gatherChunkCandidate(source.collisionEntries[k],target,dt);
      }
    }
  }
  function appendExternalDynamicBodies(externalBodies,entryCache,forceSleeping){
    for(let i=0;i<externalBodies.length;i++){
      const mesh=externalBodies[i],body=mesh&&mesh.userData;
      if(!mesh||!body||!body.half||!body.vel||(!forceSleeping&&body.sleeping))continue;
      let entry=entryCache[i];
      if(!entry){
        entry={kind:2,index:i,body:null,bodyId:0,x:0,y:0,z:0,hx:0,hy:0,hz:0,
          invMass:0,gx:0,gy:0,gz:0,order:0};
        entryCache[i]=entry;
      }
      let bodyId=dynamicExternalBodyIds.get(mesh);
      if(!bodyId){bodyId=nextDynamicBodyId++;dynamicExternalBodyIds.set(mesh,bodyId);}
      setAxes(mesh.quaternion,dynamicAxes);
      orientedExtents(dynamicAxes,body.half.x,body.half.y,body.half.z,tmpHalf);
      entry.index=i;entry.body=body;entry.bodyId=bodyId;entry.x=mesh.position.x;
      entry.mesh=mesh;
      entry.y=mesh.position.y;entry.z=mesh.position.z;
      entry.hx=tmpHalf.x;entry.hy=tmpHalf.y;entry.hz=tmpHalf.z;
      if(!entry.axes)entry.axes=[new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3()];
      setAxes(mesh.quaternion,entry.axes);
      entry.bx=body.half.x;entry.by=body.half.y;entry.bz=body.half.z;
      entry.invMass=forceSleeping?0:Math.max(0,body.invMass||0);
      entry.sleeping=forceSleeping||!!body.sleeping;
      // Large legacy fragments query the voxel grid; they must not enlarge its
      // cells and put hundreds of unrelated bricks into the same bucket.
      dynamicExternalEntries.push(entry);
    }
  }
  function gatherExternalVoxelContacts(dt){
    for(const entry of dynamicExternalEntries){
      const padding=dynamicMaxExtent+DYNAMIC_CONTACT_MARGIN;
      const x0=Math.floor((entry.x-entry.hx-padding)/dynamicGridCell);
      const x1=Math.floor((entry.x+entry.hx+padding)/dynamicGridCell);
      const y0=Math.floor((entry.y-entry.hy-padding)/dynamicGridCell);
      const y1=Math.floor((entry.y+entry.hy+padding)/dynamicGridCell);
      const z0=Math.floor((entry.z-entry.hz-padding)/dynamicGridCell);
      const z1=Math.floor((entry.z+entry.hz+padding)/dynamicGridCell);
      const querySize=(x1-x0+1)*(y1-y0+1)*(z1-z0+1);
      if(querySize>dynamicBucketCount){
        // Also bound work for a custom fragment spanning most of the world.
        for(let i=0;i<dynamicBucketCount;i++){
          const bucket=dynamicBuckets[i];
          if(bucket.gx<x0||bucket.gx>x1||bucket.gy<y0||bucket.gy>y1||bucket.gz<z0||bucket.gz>z1)continue;
          gatherExternalBucketContacts(entry,bucket,dt);
        }
      }else for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)for(let z=z0;z<=z1;z++){
        const bucket=dynamicGrid.get(dynamicGridKey(x,y,z));
        if(bucket)gatherExternalBucketContacts(entry,bucket,dt);
      }
    }
  }
  function gatherExternalBucketContacts(entry,bucket,dt){
    for(const other of bucket.active)queueDynamicVoxelPair(entry,other,dt);
    if(!entry.sleeping)for(const other of bucket.frozen)queueDynamicVoxelPair(entry,other,dt);
  }
  function freePivotChunk(chunk){
    if(!chunk||chunk.mode!=='pivot')return;
    tmpAxis.copy(chunk.axis).multiplyScalar(chunk.omega);
    tmpCross.copy(chunk.mesh.position).sub(chunk.pivot);
    chunk.vel.crossVectors(tmpAxis,tmpCross);
    chunk.mode='free';
  }
  function addChunkAngularImpulse(chunk,x,y,z,spin,limit){
    const length=Math.hypot(x,y,z);
    if(length<1e-8)return;
    tmpAxis.set(x,y,z).multiplyScalar(spin/length)
      .addScaledVector(chunk.axis,chunk.omega);
    const speed=tmpAxis.length();
    chunk.omega=Math.min(limit,speed);
    if(speed>1e-8)chunk.axis.copy(tmpAxis).multiplyScalar(1/speed);
  }
  function dynamicEntryVelocity(entry,out){
    if(entry.kind===0)
      return out.set(dvx[entry.index],dvy[entry.index],dvz[entry.index]);
    if(entry.kind===1){
      freePivotChunk(entry.chunk);
      tmpPos.set(entry.x,entry.y,entry.z);
      return chunkVelocity(entry.chunk,tmpPos,out);
    }
    const body=entry.body;
    out.copy(body.vel);
    if(body.angVel){
      tmpCross.set(entry.x-body.position.x,entry.y-body.position.y,
        entry.z-body.position.z).cross(body.angVel).negate();
      out.add(tmpCross);
    }
    return out;
  }
  function moveDynamicEntry(entry,x,y,z){
    if(entry.invMass<=0)return;
    if(entry.kind===0){
      dpx[entry.index]+=x;dpy[entry.index]+=y;dpz[entry.index]+=z;
      dmatrixDirty[entry.index]=1;
      dsupportRevision[entry.index]=0;
      supportCheckEpoch[entry.index]=0;
    }else if(entry.kind===1){
      freePivotChunk(entry.chunk);
      entry.chunk.mesh.position.x+=x;entry.chunk.mesh.position.y+=y;
      entry.chunk.mesh.position.z+=z;entry.chunk.restTime=0;
    }else{
      entry.body.position.x+=x;entry.body.position.y+=y;entry.body.position.z+=z;
      entry.body.restFrames=0;entry.body.sleeping=false;
    }
    entry.x+=x;entry.y+=y;entry.z+=z;
  }
  function impulseDynamicEntry(entry,x,y,z){
    const inv=entry.invMass;if(inv<=0)return;
    const sx=x*inv,sy=y*inv,sz=z*inv;
    if(entry.kind===0){
      const k=entry.index;
      dvx[k]+=sx;dvy[k]+=sy;dvz[k]+=sz;
    }else if(entry.kind===1){
      freePivotChunk(entry.chunk);
      const chunk=entry.chunk;
      const rx=entry.x-chunk.mesh.position.x,ry=entry.y-chunk.mesh.position.y,
        rz=entry.z-chunk.mesh.position.z,inertia=chunkContactInverseInertia(entry);
      const wx=chunk.axis.x*chunk.omega+(ry*z-rz*y)*inertia;
      const wy=chunk.axis.y*chunk.omega+(rz*x-rx*z)*inertia;
      const wz=chunk.axis.z*chunk.omega+(rx*y-ry*x)*inertia;
      chunk.omega=Math.hypot(wx,wy,wz);
      if(chunk.omega>1e-8)chunk.axis.set(wx,wy,wz).multiplyScalar(1/chunk.omega);
      chunk.vel.x+=sx;chunk.vel.y+=sy;chunk.vel.z+=sz;chunk.restTime=0;
    }else{
      entry.body.vel.x+=sx;entry.body.vel.y+=sy;entry.body.vel.z+=sz;
      entry.body.restFrames=0;entry.body.sleeping=false;
    }
  }
  function chunkContactInverseInertia(entry){
    const c=entry.chunk;
    return entry.invMass/Math.max(0.005,c.radius*c.radius*0.4+
      (c.st.sx*c.st.sx+c.st.sy*c.st.sy+c.st.sz*c.st.sz)/18);
  }
  function dynamicAngularMass(entry,nx,ny,nz){
    if(entry.kind!==1||entry.invMass<=0)return 0;
    const p=entry.chunk.mesh.position,rx=entry.x-p.x,ry=entry.y-p.y,rz=entry.z-p.z;
    const cx=ry*nz-rz*ny,cy=rz*nx-rx*nz,cz=rx*ny-ry*nx;
    return (cx*cx+cy*cy+cz*cz)*chunkContactInverseInertia(entry);
  }
  function markDynamicSupport(entry,support){
    if(entry.kind===0){
      const k=entry.index;
      ddynamicSupport[k]=1;
      supportCheckEpoch[k]=0;
      /* A contact with a falling body is not a reason to sleep. Keep a real
         load path to quiet rubble or a settled legacy body, with slot identity
         so recycling the particle pool cannot attach to an unrelated shard. */
      if(support.kind===0&&dfrozen[support.index]){
        dsupportParent[k]=support.index;
        dsupportGeneration[k]=debrisGeneration[support.index];dsupportBody[k]=null;
        dsupportDX[k]=dpx[k]-dpx[support.index];dsupportDY[k]=dpy[k]-dpy[support.index];
        dsupportDZ[k]=dpz[k]-dpz[support.index];
      }else if(support.kind===2&&support.sleeping){
        dsupportParent[k]=-1;dsupportBody[k]=support.mesh;
      }
    }
  }
  function projectedEntryRadius(entry,x,y,z){
    const a=entry.axes;
    return Math.abs(a[0].x*x+a[0].y*y+a[0].z*z)*entry.bx+
      Math.abs(a[1].x*x+a[1].y*y+a[1].z*z)*entry.by+
      Math.abs(a[2].x*x+a[2].y*y+a[2].z*z)*entry.bz;
  }
  const orientedContact={nx:0,ny:0,nz:0,penetration:Infinity};
  const contactRotation=new Float64Array(9),contactAbsRotation=new Float64Array(9);
  const contactTranslationA=new Float64Array(3),contactTranslationB=new Float64Array(3);
  const contactHalfA=new Float64Array(3),contactHalfB=new Float64Array(3);
  function considerOrientedAxis(a,b,overlap,distance,x,y,z){
    if(overlap>=orientedContact.penetration)return true;
    if(distance<0){x=-x;y=-y;z=-z;}
    if(a.kind===1&&!chunkFaceExposed(a.chunk,a.index,x,y,z))return true;
    if(b.kind===1&&!chunkFaceExposed(b.chunk,b.index,-x,-y,-z))return true;
    orientedContact.nx=x;orientedContact.ny=y;orientedContact.nz=z;
    orientedContact.penetration=overlap;return true;
  }
  function findOrientedContact(a,b){
    const dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z;
    orientedContact.penetration=Infinity;
    const r=contactRotation,ar=contactAbsRotation,ta=contactTranslationA,tb=contactTranslationB;
    const ha=contactHalfA,hb=contactHalfB;
    ha[0]=a.bx;ha[1]=a.by;ha[2]=a.bz;hb[0]=b.bx;hb[1]=b.by;hb[2]=b.bz;
    /* All fifteen separating axes share this change of basis. Projecting both
       boxes from world space on every axis was the dominant collapse cost.
       Keep edge/edge axes and the exact contact margin, including near-parallel
       edges; an AABB or six-face-only shortcut can hold rotated rubble apart. */
    for(let i=0;i<3;i++){
      const aa=a.axes[i],bb=b.axes[i];
      ta[i]=dx*aa.x+dy*aa.y+dz*aa.z;tb[i]=dx*bb.x+dy*bb.y+dz*bb.z;
      for(let j=0;j<3;j++){
        const axis=b.axes[j],k=i*3+j;
        r[k]=aa.x*axis.x+aa.y*axis.y+aa.z*axis.z;ar[k]=Math.abs(r[k]);
      }
    }
    for(let i=0;i<3;i++){
      const aa=a.axes[i],bb=b.axes[i],row=i*3;
      const overlapA=ha[i]+ar[row]*hb[0]+ar[row+1]*hb[1]+ar[row+2]*hb[2]-Math.abs(ta[i]);
      if(overlapA<-DYNAMIC_CONTACT_MARGIN)return false;
      considerOrientedAxis(a,b,overlapA,ta[i],aa.x,aa.y,aa.z);
      const overlapB=hb[i]+ar[i]*ha[0]+ar[i+3]*ha[1]+ar[i+6]*ha[2]-Math.abs(tb[i]);
      if(overlapB<-DYNAMIC_CONTACT_MARGIN)return false;
      considerOrientedAxis(a,b,overlapB,tb[i],bb.x,bb.y,bb.z);
    }
    for(let i=0;i<3;i++)for(let j=0;j<3;j++){
      const aa=a.axes[i],bb=b.axes[j];
      const x=aa.y*bb.z-aa.z*bb.y,y=aa.z*bb.x-aa.x*bb.z,z=aa.x*bb.y-aa.y*bb.x;
      const lengthSq=x*x+y*y+z*z;if(lengthSq<1e-12)continue;
      const length=Math.sqrt(lengthSq),i1=(i+1)%3,i2=(i+2)%3,j1=(j+1)%3,j2=(j+2)%3;
      const distance=ta[i2]*r[i1*3+j]-ta[i1]*r[i2*3+j];
      const overlap=ha[i1]*ar[i2*3+j]+ha[i2]*ar[i1*3+j]+
        hb[j1]*ar[i*3+j2]+hb[j2]*ar[i*3+j1]-Math.abs(distance);
      if(overlap<-DYNAMIC_CONTACT_MARGIN*length)return false;
      const depth=overlap/length;
      if(depth<orientedContact.penetration)
        considerOrientedAxis(a,b,depth,distance,x/length,y/length,z/length);
    }
    return orientedContact.penetration!==Infinity;
  }
  function queueDynamicVoxelPair(a,b,dt,allowLoosePair){
    if(a.bodyId>b.bodyId){const swap=a;a=b;b=swap;}
    if(a.bodyId===b.bodyId)return;
    if(a.kind===2&&b.kind===2)return; /* the legacy solver owns this exact pair */
    if(a.kind===0&&b.kind===0&&!allowLoosePair)return;
    if(a.kind===0&&b.kind===0&&dfrozen[a.index]&&dfrozen[b.index])return;
    const dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z;
    const overlapX=a.hx+b.hx-Math.abs(dx);
    if(overlapX<-DYNAMIC_CONTACT_MARGIN)return;
    const overlapY=a.hy+b.hy-Math.abs(dy);
    if(overlapY<-DYNAMIC_CONTACT_MARGIN)return;
    const overlapZ=a.hz+b.hz-Math.abs(dz);
    if(overlapZ<-DYNAMIC_CONTACT_MARGIN)return;
    // Broadphase boxes only select candidates. Rotated bricks must actually touch.
    if(!findOrientedContact(a,b))return;
    const {penetration,nx,ny,nz}=orientedContact;
    if(a.kind===0)dcontactError[a.index]=Math.max(dcontactError[a.index],penetration);
    if(b.kind===0)dcontactError[b.index]=Math.max(dcontactError[b.index],penetration);
    /* Use the touching cells to choose the separating side. A hollow shell
       can surround its core, and detached floors can interlock with walls:
       their body centres do not identify which side of a surface is solid.
       Flipping this normal by body centre pushed the core through the facade
       on every solver pass, even with no outward velocity. */
    const pairKey=b.bodyId<1048576?a.bodyId*1048576+b.bodyId:a.bodyId+'_'+b.bodyId;
    let contact=dynamicBodyContacts.get(pairKey);
    if(contact&&contact.penetration>=penetration)return;
    if(!contact){
      contact=dynamicContactPool[dynamicContactCount];
      if(!contact){contact={};dynamicContactPool.push(contact);}
      dynamicContactCount++;dynamicBodyContacts.set(pairKey,contact);
    }
    contact.a=a;contact.b=b;contact.key=pairKey;contact.penetration=penetration;
    contact.nx=nx;contact.ny=ny;contact.nz=nz;
    // Contact iterations translate bodies, but do not rotate their collision basis.
    contact.radius=projectedEntryRadius(a,nx,ny,nz)+projectedEntryRadius(b,nx,ny,nz);
  }
  function solveLooseDebrisPairs(dt){
    if(debrisN<2)return;
    debrisSweepEntries.sort((a,b)=>a.sweepMin-b.sweepMin||a.index-b.index);
    /* Partition the sweep on a second spatial axis. A wide rubble carpet used
       to compare every brick against whole distant rows on each solver pass.
       A band spans the largest diameter plus the contact margin, so a touching
       pair must be in the same band or one of its two immediate neighbours.
       Merge those three sorted lists to retain the solver's stable pair order. */
    let bandSize=DYNAMIC_GRID_MIN_CELL,bandCount=0;
    for(const entry of debrisSweepEntries)bandSize=Math.max(bandSize,
      2*(debrisBandAxis===0?entry.hx:(debrisBandAxis===1?entry.hy:entry.hz))+DYNAMIC_CONTACT_MARGIN);
    debrisSweepBands.clear();
    for(let i=0;i<debrisN;i++){
      const entry=debrisSweepEntries[i];
      const bandIndex=Math.floor((debrisBandAxis===0?entry.x:
        (debrisBandAxis===1?entry.y:entry.z))/bandSize);
      entry.sweepBand=bandIndex;
      let band=debrisSweepBands.get(bandIndex);
      if(!band){
        band=debrisSweepBandPool[bandCount];
        if(!band){band={all:[],active:[],allCursor:0,activeCursor:0};debrisSweepBandPool.push(band);}
        band.all.length=0;band.active.length=0;band.allCursor=band.activeCursor=0;
        bandCount++;debrisSweepBands.set(bandIndex,band);
      }
      band.all.push(i);if(!entry.sleeping)band.active.push(i);
    }
    for(let i=0;i<debrisN;i++){
      const a=debrisSweepEntries[i],sweepMax=a.sweepMax;
      for(let slot=0;slot<3;slot++){
        const band=debrisSweepBands.get(a.sweepBand+slot-1);
        if(!band){debrisBandLists[slot]=null;continue;}
        const list=a.sleeping?band.active:band.all;
        let cursor=a.sleeping?band.activeCursor:band.allCursor;
        while(cursor<list.length&&list[cursor]<=i)cursor++;
        if(a.sleeping)band.activeCursor=cursor;else band.allCursor=cursor;
        debrisBandLists[slot]=list;debrisBandOffsets[slot]=cursor;
      }
      const list0=debrisBandLists[0],list1=debrisBandLists[1],list2=debrisBandLists[2];
      let p0=debrisBandOffsets[0],p1=debrisBandOffsets[1],p2=debrisBandOffsets[2];
      let j0=list0&&p0<list0.length?list0[p0]:debrisN;
      let j1=list1&&p1<list1.length?list1[p1]:debrisN;
      let j2=list2&&p2<list2.length?list2[p2]:debrisN;
      for(;;){
        const j=Math.min(j0,j1,j2);if(j===debrisN)break;
        if(j===j0)j0=++p0<list0.length?list0[p0]:debrisN;
        else if(j===j1)j1=++p1<list1.length?list1[p1]:debrisN;
        else j2=++p2<list2.length?list2[p2]:debrisN;
        const b=debrisSweepEntries[j];
        if(b.sweepMin>sweepMax+DYNAMIC_CONTACT_MARGIN)break;
        if(a.sleeping&&b.sleeping)continue;
        if((debrisSweepAxis!==0&&(b.x-b.hx>a.x+a.hx+DYNAMIC_CONTACT_MARGIN||
           a.x-a.hx>b.x+b.hx+DYNAMIC_CONTACT_MARGIN))||
           (debrisSweepAxis!==1&&(b.y-b.hy>a.y+a.hy+DYNAMIC_CONTACT_MARGIN||
           a.y-a.hy>b.y+b.hy+DYNAMIC_CONTACT_MARGIN))||
           (debrisSweepAxis!==2&&(b.z-b.hz>a.z+a.hz+DYNAMIC_CONTACT_MARGIN||
           a.z-a.hz>b.z+b.hz+DYNAMIC_CONTACT_MARGIN)))continue;
        queueDynamicVoxelPair(a,b,dt,true);
      }
    }
  }
  function wakeContactDebris(entry){
    if(entry.kind!==0||!dfrozen[entry.index])return;
    const k=entry.index;
    dfrozen[k]=0;ddynamicSupport[k]=0;dstaticSupport[k]=0;
    dsupportRevision[k]=0;supportCheckEpoch[k]=0;
    dsupportParent[k]=-1;dsupportBody[k]=null;
    entry.sleeping=false;
    entry.invMass=1/Math.max(0.012,dsize[k]*dsize[k]*dsize[k]);
  }
  function wakeDynamicContactBodies(contact){
    const a=contact.a,b=contact.b,nx=contact.nx,ny=contact.ny,nz=contact.nz;
    dynamicEntryVelocity(a,dynamicVelocityA);dynamicEntryVelocity(b,dynamicVelocityB);
    const closingSpeed=Math.max(0,
      (dynamicVelocityA.x-dynamicVelocityB.x)*nx+
      (dynamicVelocityA.y-dynamicVelocityB.y)*ny+
      (dynamicVelocityA.z-dynamicVelocityB.z)*nz);
    /* An impact can wake quiet rubble. Sustained weight cannot repeatedly
       nudge a sleeping brick and bank an invisible downward velocity in it. */
    if(closingSpeed>0.8){wakeContactDebris(a);wakeContactDebris(b);}
    contact.closingSpeed=closingSpeed;
  }
  function prepareDynamicContact(contact){
    const a=contact.a,b=contact.b,nx=contact.nx,ny=contact.ny,nz=contact.nz;
    const closingSpeed=contact.closingSpeed;
    const generationA=a.kind===0?debrisGeneration[a.index]:0;
    const generationB=b.kind===0?debrisGeneration[b.index]:0;
    const featureA=a.kind===1?a.chunk.cellIndex[a.index]:-1;
    const featureB=b.kind===1?b.chunk.cellIndex[b.index]:-1;
    let response=dynamicContactCache.get(contact.key);
    if(!response||response.epoch<dynamicContactEpoch-1||
       response.nx*nx+response.ny*ny+response.nz*nz<0.995||
       response.generationA!==generationA||response.generationB!==generationB||
       response.featureA!==featureA||response.featureB!==featureB||
       response.invA!==a.invMass||response.invB!==b.invMass){
      response={epoch:dynamicContactEpoch,nx,ny,nz,generationA,generationB,featureA,featureB,
        invA:a.invMass,invB:b.invMass,normalImpulse:0,tx:0,ty:0,tz:0,
        bounce:closingSpeed>0.8?closingSpeed*DYNAMIC_RESTITUTION:0};
      dynamicContactCache.set(contact.key,response);
    }
    response.nx=nx;response.ny=ny;response.nz=nz;
    contact.response=response;
    if(a.kind===1)a.chunk.dynamicImpact=Math.max(a.chunk.dynamicImpact,closingSpeed);
    if(b.kind===1)b.chunk.dynamicImpact=Math.max(b.chunk.dynamicImpact,closingSpeed);
  }
  function warmDynamicContact(contact){
    const response=contact.response;
    if(response.epoch===dynamicContactEpoch)return;
    response.epoch=dynamicContactEpoch;response.bounce=0;
    const along=response.tx*contact.nx+response.ty*contact.ny+response.tz*contact.nz;
    response.tx-=along*contact.nx;response.ty-=along*contact.ny;response.tz-=along*contact.nz;
    const impulse=response.normalImpulse;
    const x=-contact.nx*impulse+response.tx,y=-contact.ny*impulse+response.ty,
      z=-contact.nz*impulse+response.tz;
    impulseDynamicEntry(contact.a,x,y,z);impulseDynamicEntry(contact.b,-x,-y,-z);
  }
  function constrainDebrisSurfaces(k,entry,dt){
    const floor=groundY+dhy[k];
    if(dpy[k]<=floor+1e-5){
      if(dpy[k]<floor){
        dpy[k]=floor;dmatrixDirty[k]=1;
        dsupportRevision[k]=0;supportCheckEpoch[k]=0;
      }
      if(entry)entry.y=dpy[k];
      applyDebrisSurfaceImpulse(k,dgroundContacts[k]);
    }
    const contacts=dstaticContacts[k];if(!contacts)return;
    for(let i=contacts.length-1;i>=0;i--){
      const c=contacts[i],nx=c.nx,ny=c.ny,nz=c.nz;
      const separation=dpx[k]*nx+dpy[k]*ny+dpz[k]*nz-
        Math.abs(nx)*dhx[k]-Math.abs(ny)*dhy[k]-Math.abs(nz)*dhz[k]-c.plane;
      if(!c.st.alive[c.index]||separation>DYNAMIC_CONTACT_MARGIN||
         (!nx&&(dpx[k]+dhx[k]<=c.x0||dpx[k]-dhx[k]>=c.x1))||
         (!ny&&(dpy[k]+dhy[k]<=c.y0||dpy[k]-dhy[k]>=c.y1))||
         (!nz&&(dpz[k]+dhz[k]<=c.z0||dpz[k]-dhz[k]>=c.z1))||
         (c.revision!==topologyRevision&&!staticFaceExposed(c.st,c.index,nx,ny,nz))){
        contacts.splice(i,1);continue;
      }
      c.revision=topologyRevision;
      if(separation<0){
        dpx[k]-=nx*separation;dpy[k]-=ny*separation;dpz[k]-=nz*separation;
        dmatrixDirty[k]=1;dsupportRevision[k]=0;supportCheckEpoch[k]=0;
        if(entry){entry.x=dpx[k];entry.y=dpy[k];entry.z=dpz[k];}
      }
      /* Static masonry must react to the pile's load in the same iterations
         as loose contacts. A cached face is usable only while it still exists
         and overlaps this brick; any real gap remains free to close. */
      applyDebrisSurfaceImpulse(k,c,0,-Math.max(0,separation)/dt);
    }
  }
  function tipUnsupportedDebris(k,dt){
    if(dfrozen[k]||dpy[k]-dhy[k]<=groundY+0.02)return;
    const contacts=dstaticContacts[k];if(!contacts)return;
    const top=contacts.find(c=>c.ny>0.5&&c.epoch===dynamicContactEpoch&&c.st.alive[c.index]);
    if(!top)return;
    // Adjacent floor cells count too; a cached face is only one part of a floor.
    tmpPos.set(dpx[k],dpy[k]-dhy[k]-0.03,dpz[k]);
    if(findStaticVoxelAt(tmpPos,null))return;
    const dx=dpx[k]-Math.max(top.x0,Math.min(top.x1,dpx[k]));
    const dz=dpz[k]-Math.max(top.z0,Math.min(top.z1,dpz[k]));
    const offset=Math.hypot(dx,dz);if(offset<0.005)return;
    /* Gravity acts about the actual ledge, not the brick's AABB centre.
       Include the parallel-axis inertia and let the unsupported COM tip out
       over the edge. Friction alone cannot balance this missing moment. */
    const alpha=GRAVITY*offset/(dsize[k]*dsize[k]/6+offset*offset+dhy[k]*dhy[k]);
    const turn=alpha*dt,accel=turn*dhy[k];
    dvx[k]+=dx/offset*accel;dvz[k]+=dz/offset*accel;
    dwx[k]+=dz/offset*turn;dwz[k]-=dx/offset*turn;
    dcontactError[k]=Math.max(dcontactError[k],0.01);
  }
  function resolveDynamicVoxelContact(contact,dt,projectPosition){
    const a=contact.a,b=contact.b,penetration=contact.penetration;
    const nx=contact.nx,ny=contact.ny,nz=contact.nz;
    const invTotal=a.invMass+b.invMass;if(invTotal<=0)return 0;
    if(projectPosition){
      const currentPenetration=contact.radius-
        ((b.x-a.x)*nx+(b.y-a.y)*ny+(b.z-a.z)*nz);
      const correction=Math.min(0.9,
        Math.max(0,currentPenetration-DYNAMIC_CONTACT_SLOP)*DYNAMIC_POSITION_PERCENT)/invTotal;
      moveDynamicEntry(a,-nx*correction*a.invMass,-ny*correction*a.invMass,
        -nz*correction*a.invMass);
      moveDynamicEntry(b,nx*correction*b.invMass,ny*correction*b.invMass,
        nz*correction*b.invMass);
    }

    dynamicEntryVelocity(a,dynamicVelocityA);
    dynamicEntryVelocity(b,dynamicVelocityB);
    let rvx=dynamicVelocityB.x-dynamicVelocityA.x;
    let rvy=dynamicVelocityB.y-dynamicVelocityA.y;
    let rvz=dynamicVelocityB.z-dynamicVelocityA.z;
    const normalVelocity=rvx*nx+rvy*ny+rvz*nz;
    const response=contact.response,previousImpulse=response.normalImpulse;
    /* Keep a near contact across tiny gaps, but allow the bodies to close that
       gap at its actual distance per tick. A contact margin must never become
       an invisible floor that holds separated bricks in the air. */
    const separation=(b.x-a.x)*nx+(b.y-a.y)*ny+(b.z-a.z)*nz-contact.radius;
    const targetVelocity=separation>-DYNAMIC_CONTACT_SLOP?
      -(separation+DYNAMIC_CONTACT_SLOP)/dt:response.bounce;
    const normalMass=invTotal+dynamicAngularMass(a,nx,ny,nz)+dynamicAngularMass(b,nx,ny,nz);
    response.normalImpulse=Math.max(0,previousImpulse+
      (targetVelocity-normalVelocity)/normalMass);
    const normalImpulse=response.normalImpulse-previousImpulse;
    let velocityChange=Math.abs(normalImpulse)*normalMass;
    if(normalImpulse!==0){
      impulseDynamicEntry(a,-nx*normalImpulse,-ny*normalImpulse,-nz*normalImpulse);
      impulseDynamicEntry(b,nx*normalImpulse,ny*normalImpulse,nz*normalImpulse);
    }
    if(response.normalImpulse>0||response.tx||response.ty||response.tz){
      dynamicEntryVelocity(a,dynamicVelocityA);
      dynamicEntryVelocity(b,dynamicVelocityB);
      rvx=dynamicVelocityB.x-dynamicVelocityA.x;
      rvy=dynamicVelocityB.y-dynamicVelocityA.y;
      rvz=dynamicVelocityB.z-dynamicVelocityA.z;
      const along=rvx*nx+rvy*ny+rvz*nz;
      dynamicTangent.set(rvx-nx*along,rvy-ny*along,rvz-nz*along);
      const tangentSpeed=dynamicTangent.length();
      let tangentMass=invTotal;
      if(tangentSpeed>1e-8){
        const tx=dynamicTangent.x/tangentSpeed,ty=dynamicTangent.y/tangentSpeed,
          tz=dynamicTangent.z/tangentSpeed;
        tangentMass+=dynamicAngularMass(a,tx,ty,tz)+dynamicAngularMass(b,tx,ty,tz);
      }
      dynamicTangent.multiplyScalar(1/tangentMass);
      dynamicTangent.x+=response.tx;dynamicTangent.y+=response.ty;dynamicTangent.z+=response.tz;
      const tangentImpulse=dynamicTangent.length(),limit=response.normalImpulse*DYNAMIC_FRICTION;
      if(tangentImpulse>limit)dynamicTangent.multiplyScalar(limit/tangentImpulse);
      const tx=dynamicTangent.x-response.tx,ty=dynamicTangent.y-response.ty,
        tz=dynamicTangent.z-response.tz;
      velocityChange=Math.max(velocityChange,Math.hypot(tx,ty,tz)*tangentMass);
      impulseDynamicEntry(a,tx,ty,tz);impulseDynamicEntry(b,-tx,-ty,-tz);
      response.tx=dynamicTangent.x;response.ty=dynamicTangent.y;response.tz=dynamicTangent.z;
    }
    /* Ground and intact masonry react during the pair solve, so an upper
       contact cannot leave the base carrying an unopposed downward velocity. */
    if(a.kind===0)constrainDebrisSurfaces(a.index,a,dt);
    if(b.kind===0)constrainDebrisSurfaces(b.index,b,dt);
    if(penetration>=0){
      if(ny>0.55)markDynamicSupport(b,a);
      else if(ny<-0.55)markDynamicSupport(a,b);
    }
    return velocityChange;
  }
  function solveDynamicVoxelContacts(dt){
    /* Sleeping pile contacts persist until an impulse wakes either voxel. Only
       active particles need their support rebuilt every step; clearing the
       whole array made a settled pile wake and re-solve every other frame. */
    for(let k=0;k<debrisN;k++)if(!dfrozen[k])ddynamicSupport[k]=0;
    for(const chunk of chunks)chunk.dynamicImpact=0;
    const externalBodies=getExternalDynamicBodies()||[];
    const settledBodies=getExternalSettledBodies()||[];
    const hasMixedBodies=chunks.length>0||externalBodies.length>0||settledBodies.length>0;
    const solverPasses=DYNAMIC_SOLVER_PASSES;
    for(let pass=0;pass<solverPasses;pass++){
      dynamicBodyContacts.clear();dynamicContactCount=0;
      prepareDebrisCollisionEntries();
      solveLooseDebrisPairs(dt);
      if(hasMixedBodies){
        buildDynamicVoxelGrid(externalBodies,settledBodies);
        gatherChunkVoxelContacts(dt);
        gatherExternalVoxelContacts(dt);
      }
      /* Warm every touching pair before solving any of them. Interleaving
         warm starts with the solve makes each upper contact undo the support
         its lower neighbor just found. Retain only real, consecutive contacts. */
      /* Wake the whole contact set first, so cached impulses never use a
         sleeping mass after another contact has made that brick dynamic. */
      crushSupportsThroughRubble(dt);
      for(let i=0;i<dynamicContactCount;i++)wakeDynamicContactBodies(dynamicContactPool[i]);
      for(let i=0;i<dynamicContactCount;i++)prepareDynamicContact(dynamicContactPool[i]);
      for(let i=0;i<dynamicContactCount;i++)warmDynamicContact(dynamicContactPool[i]);
      for(let k=0;k<debrisN;k++)constrainDebrisSurfaces(k,debrisCollisionEntries[k],dt);
      /* Reuse the manifold for velocity iterations: propagate the pile's
         weight without repeatedly rebuilding the broadphase or projecting
         each overlap almost completely into its neighboring contacts. */
      for(let iteration=0;iteration<DYNAMIC_VELOCITY_PASSES;iteration++){
        let change=0;
        for(let i=0;i<dynamicContactCount;i++)change=Math.max(change,
          resolveDynamicVoxelContact(dynamicContactPool[i],dt,iteration===0));
        if(change<1e-5)break;
      }
      for(let i=0;i<dynamicContactCount;i++){
        const c=dynamicContactPool[i],load=c.response.normalImpulse/solverPasses;
        if(c.a.kind===0)applyDebrisRollingResistance(c.a.index,load*c.a.invMass,DYNAMIC_FRICTION);
        if(c.b.kind===0)applyDebrisRollingResistance(c.b.index,load*c.b.invMass,DYNAMIC_FRICTION);
      }
      for(let k=0;k<debrisN;k++){
        const ground=dgroundContacts[k];
        if(ground.epoch===dynamicContactEpoch)
          applyDebrisRollingResistance(k,ground.normalImpulse/solverPasses,0.55);
        const contacts=dstaticContacts[k];if(!contacts)continue;
        for(const c of contacts)if(c.epoch===dynamicContactEpoch&&!debrisContactOverhang(k,c))
          applyDebrisRollingResistance(k,c.normalImpulse/solverPasses,0.55);
      }
    }
    for(const [key,response] of dynamicContactCache)
      if(response.epoch!==dynamicContactEpoch)dynamicContactCache.delete(key);
    dreactionX.fill(0,0,debrisN);dreactionY.fill(0,0,debrisN);dreactionZ.fill(0,0,debrisN);
    for(let i=0;i<dynamicContactCount;i++){
      const c=dynamicContactPool[i],r=c.response;if(r.bounce)continue;
      const x=-c.nx*r.normalImpulse+r.tx,y=-c.ny*r.normalImpulse+r.ty,
        z=-c.nz*r.normalImpulse+r.tz;
      if(c.a.kind===0){const k=c.a.index,m=c.a.invMass;
        dreactionX[k]+=x*m;dreactionY[k]+=y*m;dreactionZ[k]+=z*m;}
      if(c.b.kind===0){const k=c.b.index,m=c.b.invMass;
        dreactionX[k]-=x*m;dreactionY[k]-=y*m;dreactionZ[k]-=z*m;}
    }
    for(let k=0;k<debrisN;k++){
      constrainDebrisSurfaces(k,debrisCollisionEntries[k],dt);
      const ground=dgroundContacts[k];
      if(ground.epoch===dynamicContactEpoch&&!ground.bounce){
        dreactionX[k]-=ground.tx;dreactionY[k]+=ground.normalImpulse-ground.ty;
        dreactionZ[k]-=ground.tz;
      }
      const faces=dstaticContacts[k];if(faces)for(const c of faces){
        if(c.epoch!==dynamicContactEpoch||c.bounce)continue;
        dreactionX[k]+=c.nx*c.normalImpulse-c.tx;
        dreactionY[k]+=c.ny*c.normalImpulse-c.ty;
        dreactionZ[k]+=c.nz*c.normalImpulse-c.tz;
      }
      tipUnsupportedDebris(k,dt);
      /* Sleeping only skips integration after contact forces have removed
         both linear and angular motion on a real support path. */
      if(debrisQuiet(k)&&debrisHasSupportPath(k,settledBodies)){
        sleepDebris(k);
        dstaticSupport[k]=0;dsupportRevision[k]=0;
      }
    }
    reactionRevision=topologyRevision;
    const impacted=chunks.filter(chunk=>chunk.dynamicImpact>=
      SHATTER_SPEED*(chunk.count>450?0.82:1));
    for(const chunk of impacted)
      if(chunks.indexOf(chunk)>=0)resolveChunkImpact(chunk,chunk.dynamicImpact);
  }

  function processTopology(st){
    topologyPending.delete(st);activateStructurePhysics(st);
    if(!st.activeN){st.destroyed=true;refreshStructure(st);return;}
    const supportChanged=supportPass(st);
    if(st.activeN)stabilityPass(st,!supportChanged);
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
        activateStructurePhysics(st);
        if(st.damage[i]>=1&&killCell(st,i,0.35,tmpDir.x,0.2,tmpDir.z,true))killed++;
      }
    }
    if(killed)processTopology(st);
    return killed;
  }
  function blastChunks(epicenter,force){
    const radius=Math.min(3.15,2.15+Math.max(0,force)*0.07);
    /* Fracturing can remove this body and append new sections. Walk the
       original bodies backwards so each receives the explosion only once. */
    for(let ci=chunks.length-1;ci>=0;ci--){
      const chunk=chunks[ci];
      const dist=Math.max(0,chunk.mesh.position.distanceTo(epicenter)-chunk.radius);
      if(dist>3.5)continue;
      tmpDir.subVectors(chunk.mesh.position,epicenter);
      if(tmpDir.lengthSq()<1e-5)tmpDir.set(1,0,0);else tmpDir.normalize();
      const falloff=1-Math.min(1,dist/3.5),impulse=(2+force*0.55)*falloff/Math.max(1,Math.sqrt(chunk.count*0.08));
      /* Preserve the tangent velocity and current pose before adding the hit.
         A new impulse must not re-orbit the body around its original footing. */
      freePivotChunk(chunk);
      chunk.vel.addScaledVector(tmpDir,impulse);chunk.vel.y+=0.8+falloff*2.2;
      addChunkAngularImpulse(chunk,-tmpDir.z,0,tmpDir.x,0.4+falloff*1.2,2.8);
      chunk.restTime=0;
      let killed=0;
      for(let k=chunk.count-1;k>=0;k--){
        chunkWorld(chunk,k,tmpPos);tmpDir.subVectors(tmpPos,epicenter);
        const distance=tmpDir.length();if(distance>radius)continue;
        const localFalloff=1-distance/radius;
        if(distance>0.001)tmpDir.multiplyScalar(1/distance);else tmpDir.set(1,0,0);
        const direct=localFalloff>0.43||chunk.type[k]===4&&localFalloff>0.2;
        if(!direct)chunk.damage[k]+=localFalloff*1.3;
        if(!direct&&chunk.damage[k]<1)continue;
        killChunkCell(chunk,k,direct?0.48+localFalloff*0.52:0.35,
          tmpDir.x,direct?Math.abs(tmpDir.y)+0.25:0.2,tmpDir.z);
        killed++;
      }
      if(killed)fractureChunk(chunk);
    }
    flushDestroyed();
  }
  function blastDebris(epicenter,force){
    const radius=3.5;
    let affected=0;
    for(let k=0;k<debrisN;k++){
      tmpDir.set(dpx[k]-epicenter.x,dpy[k]-epicenter.y,dpz[k]-epicenter.z);
      const centerDistance=tmpDir.length();
      const dist=Math.max(0,centerDistance-Math.max(dhx[k],dhy[k],dhz[k]));
      if(dist>radius)continue;
      if(centerDistance<1e-5){
        const angle=hash01(k+Math.floor(dage[k]*1000)+17)*Math.PI*2;
        tmpDir.set(Math.cos(angle),0.22,Math.sin(angle)).normalize();
      }else tmpDir.multiplyScalar(1/centerDistance);
      const falloff=1-Math.min(1,dist/radius);
      const mass=Math.max(0.012,dsize[k]*dsize[k]*dsize[k]);
      const impulse=Math.min(26,(2.4+Math.max(0,force)*0.82)*falloff/
        Math.max(0.42,Math.sqrt(mass)));
      dvx[k]+=tmpDir.x*impulse;dvy[k]+=tmpDir.y*impulse+0.9+falloff*2.8;
      dvz[k]+=tmpDir.z*impulse;
      const spin=(1.5+falloff*6)/Math.max(0.35,dsize[k]);
      dwx[k]+=tmpDir.z*spin;dwy[k]+=(hash01(k+31)-0.5)*spin;
      dwz[k]-=tmpDir.x*spin;
      dfrozen[k]=0;ddynamicSupport[k]=0;
      dstaticSupport[k]=0;dsupportRevision[k]=0;affected++;
    }
    return affected;
  }
  function blast(epicenter,force){
    blastChunks(epicenter,force);blastDebris(epicenter,force);
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
    activateStructurePhysics(st);
    if(st.damage[best]>=1){
      tmpDir.copy(dir||new THREE.Vector3(0,0,1)).normalize();killCell(st,best,Math.min(0.75,0.2+power*0.25),tmpDir.x,Math.abs(tmpDir.y)+0.15,tmpDir.z,true);
      processTopology(st);flushDestroyed();return true;
    }
    return false;
  }
  const MAX_PATH_DAMAGE_CELLS=32;
  const pathDamageIndices=new Int32Array(MAX_PATH_DAMAGE_CELLS);
  const pathDamageScores=new Float32Array(MAX_PATH_DAMAGE_CELLS);
  function damagePath(st,point,dir,power,length,radius,maxCells){
    if(!st||!st.activeN||!point||!dir||dir.lengthSq()<1e-8)return 0;
    tmpAxis.copy(dir).normalize();
    const pathLength=Math.max(0.05,length||0.05);
    const pathRadius=Math.max(0.01,radius||0.01);
    const limit=Math.max(1,Math.min(MAX_PATH_DAMAGE_CELLS,
      Math.floor(maxCells||1)));
    const endX=point.x+tmpAxis.x*pathLength;
    const endY=point.y+tmpAxis.y*pathLength;
    const endZ=point.z+tmpAxis.z*pathLength;
    const cellRadius=Math.min(st.sx,st.sy,st.sz)*0.42;
    const effectiveRadius=pathRadius+cellRadius;
    const radiusSq=effectiveRadius*effectiveRadius;
    const alongPad=(Math.abs(tmpAxis.x)*st.sx+Math.abs(tmpAxis.y)*st.sy+
      Math.abs(tmpAxis.z)*st.sz)*0.5;
    const minX=Math.max(0,Math.floor((Math.min(point.x,endX)-effectiveRadius-st.origin.x)/st.sx));
    const maxX=Math.min(st.nx-1,Math.floor((Math.max(point.x,endX)+effectiveRadius-st.origin.x)/st.sx));
    const minY=Math.max(0,Math.floor((Math.min(point.y,endY)-effectiveRadius-st.origin.y)/st.sy));
    const maxY=Math.min(st.ny-1,Math.floor((Math.max(point.y,endY)+effectiveRadius-st.origin.y)/st.sy));
    const minZ=Math.max(0,Math.floor((Math.min(point.z,endZ)-effectiveRadius-st.origin.z)/st.sz));
    const maxZ=Math.min(st.nz-1,Math.floor((Math.max(point.z,endZ)+effectiveRadius-st.origin.z)/st.sz));
    let candidateCount=0;
    for(let y=minY;y<=maxY;y++)for(let z=minZ;z<=maxZ;z++)for(let x=minX;x<=maxX;x++){
      const i=indexOf(st,x,y,z);if(!st.alive[i])continue;
      cellCenter(st,i,tmpPos);
      const rx=tmpPos.x-point.x,ry=tmpPos.y-point.y,rz=tmpPos.z-point.z;
      const along=rx*tmpAxis.x+ry*tmpAxis.y+rz*tmpAxis.z;
      if(along<-alongPad||along>pathLength+alongPad)continue;
      const closest=Math.max(0,Math.min(pathLength,along));
      const px=rx-tmpAxis.x*closest,py=ry-tmpAxis.y*closest,
        pz=rz-tmpAxis.z*closest;
      const radialSq=px*px+py*py+pz*pz;
      if(radialSq>radiusSq)continue;
      /* Prefer the bore centre, then the entry side. This keeps the capped
         result deterministic while still producing a visible penetration
         tunnel rather than choosing arbitrary cells from the bounding box. */
      const score=radialSq/radiusSq+Math.max(0,along)/pathLength*0.18;
      let insert=0;
      while(insert<candidateCount&&
        (pathDamageScores[insert]<score||
         (pathDamageScores[insert]===score&&pathDamageIndices[insert]<i)))insert++;
      if(insert>=limit)continue;
      const nextCount=Math.min(limit,candidateCount+1);
      for(let k=nextCount-1;k>insert;k--){
        pathDamageScores[k]=pathDamageScores[k-1];
        pathDamageIndices[k]=pathDamageIndices[k-1];
      }
      pathDamageScores[insert]=score;
      pathDamageIndices[insert]=i;
      candidateCount=nextCount;
    }
    let killed=0;
    for(let n=0;n<candidateCount;n++){
      const i=pathDamageIndices[n];if(!st.alive[i])continue;
      const brittle=st.type[i]===4?0.42:1;
      const attenuation=Math.max(0.7,1-pathDamageScores[n]*0.16);
      st.damage[i]+=power*attenuation/brittle;
      activateStructurePhysics(st);
      if(st.damage[i]<1)continue;
      /* Only the core produces the larger three-piece burst. Peripheral cells
         still leave debris, but sustained cannon fire stays inside the global
         particle/debris budget. */
      const debrisPower=n<2?Math.min(0.95,0.3+power*0.24):0.58;
      if(killCell(st,i,debrisPower,tmpAxis.x,Math.abs(tmpAxis.y)+0.15,
        tmpAxis.z,true))killed++;
    }
    if(killed){processTopology(st);flushDestroyed();}
    return killed;
  }
  function chunkDamageCandidates(chunk,point,dir,length,radius,maxCells){
    /* The standing lattice is no longer at the hit location. Select bricks
       in the moving body's local frame, including its current rotation. */
    tmpQuat.copy(chunk.mesh.quaternion).invert();
    tmpPos.copy(point).sub(chunk.mesh.position).applyQuaternion(tmpQuat);
    const x=tmpPos.x,y=tmpPos.y,z=tmpPos.z,st=chunk.st;
    const cellSize=Math.min(st.sx,st.sy,st.sz);
    if(length===undefined){
      let best=-1,bestDistance=cellSize*cellSize*0.01;
      for(let k=0;k<chunk.count;k++){
        const dx=Math.max(0,Math.abs(chunk.lx[k]-x)-st.sx*0.5);
        const dy=Math.max(0,Math.abs(chunk.ly[k]-y)-st.sy*0.5);
        const dz=Math.max(0,Math.abs(chunk.lz[k]-z)-st.sz*0.5);
        const distance=dx*dx+dy*dy+dz*dz;
        if(distance<bestDistance){best=k;bestDistance=distance;}
      }
      if(best<0)return 0;
      pathDamageIndices[0]=best;pathDamageScores[0]=0;return 1;
    }
    tmpAxis.copy(dir).applyQuaternion(tmpQuat);
    const pathLength=Math.max(0.05,length||0.05);
    const effectiveRadius=Math.max(0.01,radius||0.01)+cellSize*0.42;
    const radiusSq=effectiveRadius*effectiveRadius;
    const alongPad=(Math.abs(tmpAxis.x)*st.sx+Math.abs(tmpAxis.y)*st.sy+
      Math.abs(tmpAxis.z)*st.sz)*0.5;
    const limit=Math.max(1,Math.min(MAX_PATH_DAMAGE_CELLS,Math.floor(maxCells||1)));
    let count=0;
    for(let k=0;k<chunk.count;k++){
      const rx=chunk.lx[k]-x,ry=chunk.ly[k]-y,rz=chunk.lz[k]-z;
      const along=rx*tmpAxis.x+ry*tmpAxis.y+rz*tmpAxis.z;
      if(along<-alongPad||along>pathLength+alongPad)continue;
      const closest=Math.max(0,Math.min(pathLength,along));
      const px=rx-tmpAxis.x*closest,py=ry-tmpAxis.y*closest,pz=rz-tmpAxis.z*closest;
      const radialSq=px*px+py*py+pz*pz;if(radialSq>radiusSq)continue;
      const score=radialSq/radiusSq+Math.max(0,along)/pathLength*0.18;
      let insert=0;
      while(insert<count&&pathDamageScores[insert]<=score)insert++;
      if(insert>=limit)continue;
      const nextCount=Math.min(limit,count+1);
      for(let n=nextCount-1;n>insert;n--){
        pathDamageIndices[n]=pathDamageIndices[n-1];pathDamageScores[n]=pathDamageScores[n-1];
      }
      pathDamageIndices[insert]=k;pathDamageScores[insert]=score;count=nextCount;
    }
    return count;
  }
  function damageChunk(mesh,dir,impulse,point,length,radius,maxCells){
    const chunk=mesh&&mesh.userData&&mesh.userData.voxelChunk;
    if(!chunk||!chunk.count)return false;
    if(dir)tmpDir.copy(dir).normalize();else tmpDir.set(0,0,1);
    freePivotChunk(chunk);
    chunk.vel.addScaledVector(tmpDir,Math.max(0.05,impulse)/Math.max(1,Math.sqrt(chunk.count)));
    addChunkAngularImpulse(chunk,-tmpDir.z,0.2,tmpDir.x,0.15+impulse*0.02,3);
    chunk.restTime=0;
    if(!point)return true;
    /* Combat's existing chunk kick is three times its structural power.
       Preserve that motion and use the same damage thresholds as fixed cells. */
    const power=Math.max(0,impulse)/3;
    const count=chunkDamageCandidates(chunk,point,tmpDir,length,radius,maxCells),broken=[];
    for(let n=0;n<count;n++){
      const k=pathDamageIndices[n],brittle=chunk.type[k]===4?0.42:1;
      chunk.damage[k]+=power*Math.max(0.7,1-pathDamageScores[n]*0.16)/brittle;
      if(chunk.damage[k]>=1)broken.push({k,power:n<2?Math.min(0.95,0.3+power*0.24):0.58});
    }
    /* Remove from the end so instance compaction cannot retarget this round. */
    broken.sort((a,b)=>b.k-a.k);
    for(const hit of broken)
      killChunkCell(chunk,hit.k,hit.power,tmpDir.x,Math.abs(tmpDir.y)+0.15,tmpDir.z);
    if(broken.length){fractureChunk(chunk);flushDestroyed();}
    return broken.length>0;
  }

  function staticVoxelTopAt(point){
    if(!findStaticVoxelAt(point,null))return null;
    coords(contactStructure,contactIndex,coord);
    return contactStructure.origin.y+(coord.y+1)*contactStructure.sy;
  }
  function frozenDebrisSupported(k){
    const bottom=dpy[k]-dhy[k];
    if(bottom<=groundY+0.045)return true;
    /* A shard may have settled on a voxel that is destroyed by a later blast.
       Frozen used to mean "never integrate again", leaving that shard pinned
       to the old contact point in empty air. Revalidate the exact exposed top
       every fixed step and return unsupported pieces to gravity immediately. */
    tmpPos.set(dpx[k],bottom-0.03,dpz[k]);
    const top=staticVoxelTopAt(tmpPos);
    if(top===null)return false;
    coords(contactStructure,contactIndex,coord);
    const exposedTop=staticFaceExposed(contactStructure,contactIndex,0,1,0);
    return exposedTop&&Math.abs(bottom-top)<=Math.max(0.065,dsize[k]*0.22);
  }
  function debrisHasSupportPath(start,settledBodies){
    let k=start,count=0,supported=false;
    for(;;){
      if(supportCheckEpoch[k]===debrisSupportEpoch){supported=!!supportCheckResult[k];break;}
      supportTrail[count++]=k;supportCheckEpoch[k]=debrisSupportEpoch;
      supportCheckResult[k]=0;
      if(dsupportRevision[k]!==topologyRevision){
        dstaticSupport[k]=frozenDebrisSupported(k)?1:0;
        dsupportRevision[k]=topologyRevision;
      }
      if(dstaticSupport[k]){supported=true;break;}
      const parent=dsupportParent[k];
      if(parent>=0&&parent<debrisN&&dfrozen[parent]&&
         debrisGeneration[parent]===dsupportGeneration[k]&&dpy[parent]<dpy[k]-0.01&&
         Math.abs(dpy[k]-dpy[parent]-dsupportDY[k])<0.035&&
         Math.abs(dpx[k]-dpx[parent]-dsupportDX[k])<0.035&&
         Math.abs(dpz[k]-dpz[parent]-dsupportDZ[k])<0.035){k=parent;continue;}
      const mesh=dsupportBody[k],body=mesh&&mesh.userData;
      if(body&&body.sleeping&&settledBodies.includes(mesh)){
        setAxes(mesh.quaternion,dynamicAxes);
        orientedExtents(dynamicAxes,body.half.x,body.half.y,body.half.z,tmpHalf);
        supported=Math.abs(dpy[k]-dhy[k]-mesh.position.y-tmpHalf.y)<0.065&&
          Math.abs(dpx[k]-mesh.position.x)<dhx[k]+tmpHalf.x-0.01&&
          Math.abs(dpz[k]-mesh.position.z)<dhz[k]+tmpHalf.z-0.01;
      }
      break;
    }
    for(let i=0;i<count;i++)supportCheckResult[supportTrail[i]]=supported?1:0;
    return supported;
  }
  function debrisStep(dt){
    debrisSupportEpoch=(debrisSupportEpoch+1)>>>0;
    if(!debrisSupportEpoch){debrisSupportEpoch=1;supportCheckEpoch.fill(0);}
    const settledBodies=getExternalSettledBodies()||[];
    for(let k=0;k<debrisN;k++){
      dage[k]+=dt;
      dcontactError[k]=0;
      if(dfrozen[k]){
        /* Validate a cached support chain, not a permanent contact boolean.
           Removing the base of a sleeping pile wakes every dependent piece;
           per-step memoization visits each member at most once. */
        if(!debrisHasSupportPath(k,settledBodies)){
          dfrozen[k]=0;
          dsupportRevision[k]=0;ddynamicSupport[k]=0;
          dsupportParent[k]=-1;dsupportBody[k]=null;
          dvy[k]=Math.min(dvy[k],-0.2);
          continue;
        }
        /* Resting chips retain their size and identity. Snapping a tiny chip
           back into a full authored cell created mass and rebuilt broken walls. */
        continue;
      }
      rotateDebris(k,dt);
      dmatrixDirty[k]=1;
      dsupportRevision[k]=0;supportCheckEpoch[k]=0;
      const half=dhy[k],previousBottom=dpy[k]-half;
      /* Persistent reactions belong in the position integral too. Omitting
         them made stationary bricks sink each tick; depenetration then pushed
         them sideways down every tilted face in a pile. Impact impulses are
         excluded above, and topology changes invalidate this prediction. */
      const balanced=Math.hypot(dreactionX[k],dreactionY[k]-GRAVITY*dt,dreactionZ[k])<GRAVITY*dt*0.25;
      const reactionTime=reactionRevision===topologyRevision&&balanced&&
        dvx[k]*dvx[k]+dvy[k]*dvy[k]+dvz[k]*dvz[k]<0.0025?dt*0.5:0;
      const motionX=dvx[k]*dt+dreactionX[k]*reactionTime,
        motionY=dvy[k]*dt-0.5*GRAVITY*dt*dt+dreactionY[k]*reactionTime,
        motionZ=dvz[k]*dt+dreactionZ[k]*reactionTime;
      dvy[k]-=GRAVITY*dt;
      const travel=Math.hypot(motionX,motionY,motionZ);
      let staticHit=travel>Math.max(0.055,dsize[k]*0.4)&&
        sweepDebrisStatic(k,motionX,motionY,motionZ);
      if(!staticHit){
        dpx[k]+=motionX;dpy[k]+=motionY;dpz[k]+=motionZ;
        staticHit=resolveDebrisStaticVoxel(k);
      }
      if(dpy[k]-half<groundY){
        const speed=Math.hypot(dvx[k],dvy[k],dvz[k]);if(speed>13)splitDebris(k);
        dpy[k]=groundY+dhy[k];
        applyDebrisSurfaceImpulse(k,dgroundContacts[k],0.25);
      }else if(!staticHit&&dage[k]>0.12&&dvy[k]<=0){
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
          exposedTop=staticFaceExposed(contactStructure,contactIndex,0,1,0);
        }
        const crossedTop=top!==null&&exposedTop&&bottom<=top+0.02&&
          previousBottom>=top-Math.max(0.06,Math.abs(dvy[k])*dt*1.25);
        if(crossedTop){
          applyDebrisStaticContact(k,contactStructure,contactIndex,0,1,0,
            Math.max(0,top+half-dpy[k]));
        }
      }
    }
  }
  function refreshDebris(){
    debrisMesh.count=debrisN;
    let firstDirty=debrisN,lastDirty=-1;
    let minX=Infinity,minY=Infinity,minZ=Infinity;
    let maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
    for(let k=0;k<debrisN;k++){
      minX=Math.min(minX,dpx[k]-dhx[k]);maxX=Math.max(maxX,dpx[k]+dhx[k]);
      minY=Math.min(minY,dpy[k]-dhy[k]);maxY=Math.max(maxY,dpy[k]+dhy[k]);
      minZ=Math.min(minZ,dpz[k]-dhz[k]);maxZ=Math.max(maxZ,dpz[k]+dhz[k]);
      if(!dmatrixDirty[k])continue;
      dummy.position.set(dpx[k],dpy[k],dpz[k]);
      dummy.quaternion.set(dqx[k],dqy[k],dqz[k],dqw[k]);
      dummy.scale.setScalar(dsize[k]);dummy.updateMatrix();debrisMesh.setMatrixAt(k,dummy.matrix);
      dmatrixDirty[k]=0;firstDirty=Math.min(firstDirty,k);lastDirty=k;
    }
    if(lastDirty>=firstDirty){
      const attribute=debrisMesh.instanceMatrix;
      const offset=firstDirty*16,end=(lastDirty+1)*16;
      if(attribute.updateRange.count<0){
        attribute.updateRange.offset=offset;attribute.updateRange.count=end-offset;
      }else{
        const start=Math.min(attribute.updateRange.offset,offset);
        const mergedEnd=Math.max(attribute.updateRange.offset+attribute.updateRange.count,end);
        attribute.updateRange.offset=start;attribute.updateRange.count=mergedEnd-start;
      }
      attribute.needsUpdate=true;
    }
    if(debrisN){
      debrisFrustumBounds.min.set(minX,minY,minZ);
      debrisFrustumBounds.max.set(maxX,maxY,maxZ);
    }else debrisFrustumBounds.makeEmpty();
    if(debrisColorDirty&&debrisMesh.instanceColor){debrisMesh.instanceColor.needsUpdate=true;debrisColorDirty=false;}
  }
  function fixedStep(dt){
    dynamicContactEpoch++;
    chunkStep(dt);debrisStep(dt);solveDynamicVoxelContacts(dt);
    if(topologyPending.size){for(const st of Array.from(topologyPending))processTopology(st);}
  }
  function flushDestroyed(){if(destroyedPending){onDestroyed(destroyedPending);destroyedPending=0;}}
  function update(dt,deferVisuals=false){
    if(!Number.isFinite(dt)||dt<=0)return;
    const elapsed=Math.min(FIXED_STEP*MAX_STEPS,dt);
    accumulator+=elapsed;let steps=0;
    while(accumulator+1e-10>=FIXED_STEP&&steps<MAX_STEPS){fixedStep(FIXED_STEP);accumulator=Math.max(0,accumulator-FIXED_STEP);steps++;}
    structureAccumulator+=elapsed;
    while(structureAccumulator+1e-10>=0.05){
      const sdt=0.05;structureAccumulator=Math.max(0,structureAccumulator-sdt);
      for(const st of structures){
        if(!st.physicsActive)continue;
        const loadEvolving=solveLoads(st,sdt);
        const spallEvolving=spallPass(st,sdt);
        st.physicsActive=!!(loadEvolving||spallEvolving||
          topologyPending.has(st));
      }
    }
    if(!deferVisuals)syncVisuals();
    flushDestroyed();
  }
  function syncVisuals(){
    for(const st of structures)refreshStructure(st);
    for(const chunk of chunks)refreshChunkFrustumBounds(chunk);
    refreshDebris();
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
    registerBuilding,blast,blastStructure,blastChunks,blastDebris,damageAt,damagePath,damageChunk,update,syncVisuals,
    surfaceAlive,pushPlayer,stats,emitDebris,structures,chunks,debrisMesh
  };
};

})(window);
