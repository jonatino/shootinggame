/* Climb-surface sampling and traversal graph construction. Loaded in order from index.html. */
const MIN_GRIP=0.06,STAND_DEPTH=0.32,LIP_MAX=2.3;
const rc=new THREE.Raycaster();
const tmpDir=new THREE.Vector3();
const groundProbeOrigin=V();
const rocketPrev=V(),rocketTravel=V(),rocketAxis=V();
const worldNormalScratch=V();

/* Mantle targets are physical footprints, not mathematical points. Voxel
   instances are intentionally rendered at 94% of their grid size, so a hold
   centroid can line up exactly with a narrow bevel between two otherwise
   continuous roof cells. Probe a small area around both the lip and landing;
   the radius stays inside the player's body footprint, requires real support,
   and still rejects a missing landing footprint. These samples are shared by
   graph cooking, live mantle fallback, and cached-target revalidation. */
const MANTLE_DEPTH_OFFSETS=[-0.4,-0.2,0.1,0.35,0.6,0.85];
const MANTLE_LIP_FOOTPRINT=[
  [0,0],[0,-0.08],[0,0.08],[0,-0.18],[0,0.18]
];
const MANTLE_LANDING_FOOTPRINT=[
  [0,0],[-0.08,0],[0,-0.08],[0,0.08],
  [-0.08,-0.08],[-0.08,0.08],[0.08,0],
  [0.08,-0.08],[0.08,0.08],[-0.16,0],
  [0,-0.18],[0,0.18],[0.16,0]
];
const mantleRayOrigin=V(),mantleSurfacePoint=V(),mantleSurfaceNormal=V();
const mantleProbeFlat=V(),mantleProbeSide=V(),mantleProbeBase=V(),mantleLandingBase=V();
const mantleStandableCandidates=[];

/* Runtime climb queries only ever need holds within arm's reach. Keep the
   cooked graph in a small 3D hash instead of scanning every hold in the world
   when the player stands beside a densely sampled rock. Moving fracture-cell
   holds are kept out of the static hash and checked separately. */
const CLIMB_HOLD_GRID_CELL=2;
const climbHoldGrid=new Map(),climbHoldQueryIndices=[],climbHoldDynamicIndices=[];
let climbHoldGridCount=0;
function climbHoldGridKey(x,y,z){return x+'_'+y+'_'+z;}
function rebuildClimbHoldGrid(){
  climbHoldGrid.clear();
  climbHoldDynamicIndices.length=0;
  for(let i=0;i<HOLDS.length;i++){
    const h=HOLDS[i],root=h&&h.mesh&&h.mesh.userData&&h.mesh.userData.surfaceRoot||h&&h.mesh;
    const ud=root&&root.userData;
    if(ud&&ud.kind==='cell'&&ud.released&&!ud.sleeping){
      climbHoldDynamicIndices.push(i);
      continue;
    }
    const p=h.pos;
    const key=climbHoldGridKey(Math.floor(p.x/CLIMB_HOLD_GRID_CELL),
      Math.floor(p.y/CLIMB_HOLD_GRID_CELL),Math.floor(p.z/CLIMB_HOLD_GRID_CELL));
    let bucket=climbHoldGrid.get(key);
    if(!bucket){bucket=[];climbHoldGrid.set(key,bucket);}
    bucket.push(i);
  }
  climbHoldGridCount=HOLDS.length;
}
function nearbyClimbHoldIndices(point,radius,mesh){
  if(climbHoldGridCount!==HOLDS.length)rebuildClimbHoldGrid();
  climbHoldQueryIndices.length=0;
  const minX=Math.floor((point.x-radius)/CLIMB_HOLD_GRID_CELL);
  const maxX=Math.floor((point.x+radius)/CLIMB_HOLD_GRID_CELL);
  const minY=Math.floor((point.y-radius)/CLIMB_HOLD_GRID_CELL);
  const maxY=Math.floor((point.y+radius)/CLIMB_HOLD_GRID_CELL);
  const minZ=Math.floor((point.z-radius)/CLIMB_HOLD_GRID_CELL);
  const maxZ=Math.floor((point.z+radius)/CLIMB_HOLD_GRID_CELL);
  const append=i=>{
    const h=HOLDS[i];
    if(h&&(!mesh||h.mesh===mesh))climbHoldQueryIndices.push(i);
  };
  for(let gx=minX;gx<=maxX;gx++)for(let gy=minY;gy<=maxY;gy++)for(let gz=minZ;gz<=maxZ;gz++){
    const bucket=climbHoldGrid.get(climbHoldGridKey(gx,gy,gz));
    if(bucket)for(const i of bucket)append(i);
  }
  for(const i of climbHoldDynamicIndices)append(i);
  return climbHoldQueryIndices;
}

function wn(hit,mesh,out){
  return (out||new THREE.Vector3()).copy(hit.face.normal).transformDirection(mesh.matrixWorld);
}

function mantleProbeAxes(out,flat,side){
  flat.copy(out).setY(0);
  if(flat.lengthSq()<1e-4)flat.set(0,0,1);
  else flat.normalize();
  side.crossVectors(UP,flat);
  if(side.lengthSq()<1e-4)side.set(1,0,0);
  else side.normalize();
}

function nearbyStandables(origin,dir,far){
  /* Reuse the world XZ broadphase rather than raycasting every voxel building
     for every footprint sample. All walkable meshes are registered as camera
     occluders too; the membership check preserves the stricter standables-only
     mantle contract. */
  const nearby=getCameraOccluderCandidates(origin,dir,far);
  mantleStandableCandidates.length=0;
  for(const mesh of nearby){
    if(standables.indexOf(mesh)<0)continue;
    const ud=mesh.userData,parent=ud&&ud.parent;
    /* Static voxel fields participate in camera fading, so the camera
       broadphase conservatively lists every field as dynamic. Their authored
       structure bounds are stable and let mantle rays discard distant
       buildings before Three.js walks hundreds of instances in each mesh. */
    if(ud&&ud.kind==='voxelField'&&parent&&parent.worldBox){
      const bounds=parent.worldBox,margin=0.7;
      if(origin.x<bounds.min.x-margin||origin.x>bounds.max.x+margin||
         origin.z<bounds.min.z-margin||origin.z>bounds.max.z+margin)continue;
    }
    mantleStandableCandidates.push(mesh);
  }
  return mantleStandableCandidates;
}

function mantleHitHasOpenColumn(hit){
  const mesh=hit&&hit.object,ud=mesh&&mesh.userData;
  let st=ud&&ud.voxelStructure,cell=-1;
  if(st){
    if(hit.instanceId===undefined||hit.instanceId<0)return false;
    cell=st.instanceToCell[hit.instanceId];
  }else{
    const root=ud&&ud.surfaceRoot||mesh,rootData=root&&root.userData;
    /* An attached fracture-cell proxy still describes its original grid
       column. Once released it is an independent physical object, so there is
       no parent column above it to invalidate its top face. */
    if(!rootData||rootData.kind!=='cell'||rootData.released)return true;
    const parent=rootData.parent;
    st=parent&&parent.voxelStructure;
    if(!st||rootData.gridX===undefined||rootData.gridY===undefined||
       rootData.gridZ===undefined)return true;
    cell=(rootData.gridY*st.nz+rootData.gridZ)*st.nx+rootData.gridX;
  }
  if(cell<0||cell>=st.count||!st.alive[cell])return false;
  /* A ray that begins inside a tall voxel wall can see the beveled top of an
     internal cell. Only the highest surviving cell in that XZ column is a
     genuine ledge with room for the body above it. */
  const layer=st.nx*st.nz;
  for(let above=cell+layer;above<st.count;above+=layer)
    if(st.alive[above])return false;
  return true;
}

function mantleDownHit(center,flat,side,footprint,fromY,far,accept){
  for(const offset of footprint){
    mantleRayOrigin.copy(center)
      .addScaledVector(flat,offset[0]).addScaledVector(side,offset[1]);
    mantleRayOrigin.y=fromY;
    rc.set(mantleRayOrigin,DOWN);rc.far=far;rc.near=0.001;
    const hits=rc.intersectObjects(nearbyStandables(mantleRayOrigin,DOWN,far),false);
    for(const hit of hits){
      if(!hit.face)continue;
      const normal=wn(hit,hit.object,worldNormalScratch);
      if(normal.y<=0.55)continue;
      if(!mantleHitHasOpenColumn(hit))continue;
      if(accept&&!accept(hit,normal))continue;
      return {hit,normal:normal.clone()};
    }
  }
  return null;
}

function findMantleLanding(h,minimumLandingY){
  if(!h)return null;
  if(!h.vault)h.vault=V();
  h.vaultLipY=NaN;
  holdSurfaceAnchor(h,mantleSurfacePoint,mantleSurfaceNormal);
  mantleProbeAxes(mantleSurfaceNormal,mantleProbeFlat,mantleProbeSide);
  const lipProbeY=mantleSurfacePoint.y+2.2;
  for(const depth of MANTLE_DEPTH_OFFSETS){
    mantleProbeBase.copy(mantleSurfacePoint).addScaledVector(mantleProbeFlat,depth);
    let approvedLanding=null;
    const lipLanding=mantleDownHit(mantleProbeBase,mantleProbeFlat,mantleProbeSide,
      MANTLE_LIP_FOOTPRINT,lipProbeY,4.6,(hit)=>{
        const rise=hit.point.y-mantleSurfacePoint.y;
        if(rise<=0.3||rise>=2.2)return false;
        /* The desired root is deliberately behind the lip. Verify the actual
           top under that point with the same seam-tolerant footprint instead
           of trusting the first edge hit. */
        mantleLandingBase.copy(hit.point).addScaledVector(mantleProbeFlat,-0.38);
        approvedLanding=mantleDownHit(mantleLandingBase,mantleProbeFlat,mantleProbeSide,
          MANTLE_LANDING_FOOTPRINT,mantleLandingBase.y+1.2,2.4,(landing)=>{
            if(landing.point.y<minimumLandingY||
               Math.abs(landing.point.y-mantleLandingBase.y)>=0.5)return false;
            const holdDx=landing.point.x-h.pos.x,holdDz=landing.point.z-h.pos.z;
            if(holdDx*holdDx+holdDz*holdDz>2.2*2.2)return false;
            const lipDx=landing.point.x-mantleLandingBase.x,
              lipDz=landing.point.z-mantleLandingBase.z;
            if(lipDx*lipDx+lipDz*lipDz>0.72*0.72)return false;
            return surfaceObjectIsLive(landing.object);
          });
        return !!approvedLanding;
      });
    if(!approvedLanding||!lipLanding)continue;
    h.vault.copy(approvedLanding.hit.point).addScaledVector(UP,0.02);
    h.vaultMesh=approvedLanding.hit.object;
    h.vaultNormal.copy(approvedLanding.normal).normalize();
    h.vaultLipY=lipLanding.hit.point.y;
    return h.vault;
  }
  return null;
}

function downHit(p,out,off,lipY,mesh){
  const o=V(p.x,lipY+0.1,p.z).addScaledVector(out,off);
  rc.set(o,DOWN);rc.far=0.6;rc.near=0.001;
  const hits=rc.intersectObject(mesh,false);
  for(let i=0;i<hits.length;i++)
    if(wn(hits[i],mesh,worldNormalScratch).y>0.55)return true;
  return false;
}

function probeLip(p,out,mesh,raw){
  const o=V(p.x,p.y,p.z).addScaledVector(out,0.15);
  o.y+=0.02;
  rc.set(o,UP);rc.far=LIP_MAX;rc.near=0.001;
  const hits=rc.intersectObject(mesh,false);
  let lipY=-1;
  for(let i=0;i<hits.length;i++){
    if(wn(hits[i],mesh,worldNormalScratch).y>0.55){lipY=hits[i].point.y;break;}
  }
  if(lipY<0)return;
  if(lipY-p.y<0.15)return;
  if(!downHit(p,out,MIN_GRIP,lipY,mesh))return;
  const standable=downHit(p,out,STAND_DEPTH,lipY,mesh);
  raw.push({pos:V(p.x,lipY,p.z).addScaledVector(out,0.05),out:out.clone(),standable,mesh});
}

function addVerticalFaceSamples(a,b,c,out,mesh,raw){
  /* Low-poly rails and poles often have one tall rectangular face made from
     only two triangles. A centroid per triangle leaves a multi-metre gap in
     the climb graph. Add a few exact horizontal slices only when the triangle
     itself is tall and nearly vertical; the slice is reconstructed inside the
     triangle, so it never invents a surface or changes physics. */
  if(Math.abs(out.y)>0.08)return;
  const minY=Math.min(a.y,b.y,c.y),maxY=Math.max(a.y,b.y,c.y);
  const span=maxY-minY;
  if(span<1.15)return;
  const steps=Math.min(8,Math.max(2,Math.ceil(span/0.82)));
  const edges=[[a,b],[b,c],[c,a]];
  const intersections=[];
  for(let i=1;i<steps;i++){
    const y=lerp(minY,maxY,i/steps);
    intersections.length=0;
    for(const edge of edges){
      const p=edge[0],q=edge[1],dy=q.y-p.y;
      if(Math.abs(dy)<1e-5)continue;
      const t=(y-p.y)/dy;
      if(t>=-1e-5&&t<=1.00001)
        intersections.push({x:lerp(p.x,q.x,t),z:lerp(p.z,q.z,t)});
    }
    if(intersections.length<2)continue;
    let sx=0,sz=0;
    for(const point of intersections){sx+=point.x;sz+=point.z;}
    sx/=intersections.length;sz/=intersections.length;
    raw.push({pos:V(sx,y,sz).addScaledVector(out,0.06),out:out.clone(),standable:false,mesh});
  }
}

const cellSurfaceAxes=[V(),V(),V()];
function cellSurfaceBoundaryExposed(mesh,normal){
  const ud=mesh&&mesh.userData;
  if(!ud||ud.kind!=='cell')return true;
  setAxesFromQuaternion(mesh.quaternion,cellSurfaceAxes);
  const x=normal.dot(cellSurfaceAxes[0]);
  const y=normal.dot(cellSurfaceAxes[1]);
  const z=normal.dot(cellSurfaceAxes[2]);
  return (ud.gridX===0&&x<-0.72)||(ud.gridX===ud.parent.grid.nx-1&&x>0.72)||
    (ud.gridY===0&&y<-0.72)||(ud.gridY===ud.parent.grid.ny-1&&y>0.72)||
    (ud.gridZ===0&&z<-0.72)||(ud.gridZ===ud.parent.grid.nz-1&&z>0.72);
}
function cellSurfaceTriangleExposed(mesh,normal){
  const ud=mesh&&mesh.userData;
  return !ud||ud.kind!=='cell'||ud.climbInterior||cellSurfaceBoundaryExposed(mesh,normal);
}
function collectCellClimbSamples(mesh){
  const geo=mesh.geometry,pos=geo.attributes.position,idx=geo.index?geo.index.array:null;
  const triCount=Math.floor((idx?idx.length:pos.count)/3),samples=[];
  const a=V(),b=V(),c=V(),ab=V(),ac=V(),n=V(),o=V(),s0=V(),lip=[];
  for(let t=0;t<triCount;t++){
    const i0=idx?idx[t*3]:t*3,i1=idx?idx[t*3+1]:t*3+1,i2=idx?idx[t*3+2]:t*3+2;
    a.fromBufferAttribute(pos,i0).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(pos,i1).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(pos,i2).applyMatrix4(mesh.matrixWorld);
    ab.subVectors(b,a);ac.subVectors(c,a);n.crossVectors(ab,ac).normalize();
    if(Math.abs(n.y)>0.5)continue;
    o.set(n.x,0,n.z);
    if(o.lengthSq()<1e-4)continue;
    o.normalize();
    const boundary=cellSurfaceBoundaryExposed(mesh,n);
    s0.copy(a).add(b).add(c).multiplyScalar(1/3);
    lip.length=0;probeLip(s0,o,mesh,lip);
    for(const sample of lip){sample.interior=!boundary;samples.push(sample);}
    samples.push({pos:s0.clone().addScaledVector(o,0.06),out:o.clone(),standable:false,mesh,interior:!boundary});
  }
  return samples;
}

function collectVoxelFieldClimbSamples(mesh,raw){
  const ud=mesh&&mesh.userData,st=ud&&ud.voxelStructure;
  if(!st||!st.activeN)return;
  const layer=st.nx*st.nz;
  const alive=(x,y,z)=>x>=0&&x<st.nx&&y>=0&&y<st.ny&&z>=0&&z<st.nz&&
    !!st.alive[(y*st.nz+z)*st.nx+x];
  const pushFace=(x,y,z,axis,sign)=>{
    const out=axis===0?V(sign,0,0):V(0,0,sign);
    const surface=V(
      st.origin.x+(x+0.5)*st.sx,
      st.origin.y+(y+0.5)*st.sy,
      st.origin.z+(z+0.5)*st.sz
    );
    if(axis===0)surface.x+=sign*st.sx*0.5;
    else surface.z+=sign*st.sz*0.5;
    /* Keep graph points just outside the physical face while retaining the
       exact face separately for hands, body clearance, and reach tests. */
    raw.push({
      pos:surface.clone().addScaledVector(out,0.06),
      surfacePos:surface,out,surfaceOut:out.clone(),standable:false,mesh,
      exactSurface:true,clusterFace:(axis===0?'x':'z')+(sign>0?'+':'-')
    });
  };
  for(let y=0;y<st.ny;y++)for(let z=0;z<st.nz;z++)for(let x=0;x<st.nx;x++){
    const i=y*layer+z*st.nx+x;
    if(!st.alive[i])continue;
    if(!alive(x-1,y,z))pushFace(x,y,z,0,-1);
    if(!alive(x+1,y,z))pushFace(x,y,z,0,1);
    if(!alive(x,y,z-1))pushFace(x,y,z,2,-1);
    if(!alive(x,y,z+1))pushFace(x,y,z,2,1);
  }
}

function detectObject(mesh,raw){
  const ud=mesh&&mesh.userData;
  if(ud&&ud.voxelClimbSource){
    collectVoxelFieldClimbSamples(mesh,raw);
    return;
  }
  if(ud&&ud.kind==='cell'){
    if(!ud.climbSamples)ud.climbSamples=collectCellClimbSamples(mesh);
    for(const sample of ud.climbSamples)
      if(ud.climbInterior||!sample.interior)raw.push(sample);
    return;
  }
  const geo=mesh.geometry;
  const pos=geo.attributes.position;
  const idx=geo.index?geo.index.array:null;
  const triCount=Math.floor((idx?idx.length:pos.count)/3);
  const a=V(),b=V(),c=V(),ab=V(),ac=V(),n=V(),o=V();
  for(let t=0;t<triCount;t++){
    const i0=idx?idx[t*3]:t*3,i1=idx?idx[t*3+1]:t*3+1,i2=idx?idx[t*3+2]:t*3+2;
    a.fromBufferAttribute(pos,i0).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(pos,i1).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(pos,i2).applyMatrix4(mesh.matrixWorld);
    ab.subVectors(b,a);ac.subVectors(c,a);
    n.crossVectors(ab,ac).normalize();
    if(!cellSurfaceTriangleExposed(mesh,n))continue;
    if(Math.abs(n.y)>0.5)continue;
    o.set(n.x,0,n.z);
    if(o.lengthSq()<1e-4)continue;
    o.normalize();
    /* One centroid per vertical triangle is enough once the cluster pass merges
       nearby samples. The old centroid-plus-three-edge scheme generated tens of
       thousands of duplicate hand nodes and made startup raycast-heavy without
       adding reachable holds on the actual facade. */
    const s0=a.clone().add(b).add(c).multiplyScalar(1/3);
    probeLip(s0,o,mesh,raw);
    raw.push({pos:s0.clone().addScaledVector(o,0.06),out:o.clone(),standable:false,mesh});
    addVerticalFaceSamples(a,b,c,o,mesh,raw);
  }
}

function cluster(raw){
  const map=new Map();
  /* A hand-sized node is enough for IK and traversal links. Merging at 0.62
     keeps the climb path readable while avoiding a separate hold for every
     tessellation triangle on rocks and subdivided facades. */
  const cellSize=0.62;
  for(const r of raw){
    const k=Math.round(r.pos.x/cellSize)+'_'+Math.round(r.pos.y/cellSize)+'_'+
      Math.round(r.pos.z/cellSize)+'_'+(r.clusterFace||'');
    let e=map.get(k);
    if(!e){
      e={pos:V(),out:V(),surfacePos:V(),surfaceOut:V(),exactN:0,
        standable:false,mesh:null,n:0};
      map.set(k,e);
    }
    e.pos.add(r.pos);e.out.add(r.out);
    if(r.exactSurface){
      e.surfacePos.add(r.surfacePos);e.surfaceOut.add(r.surfaceOut);e.exactN++;
    }
    e.standable=e.standable||r.standable;
    if(!e.mesh)e.mesh=r.mesh;
    e.n++;
  }
  const out=[];
  map.forEach(e=>{
    e.pos.multiplyScalar(1/e.n);e.out.normalize();
    const exact=e.exactN===e.n&&e.exactN>0;
    if(exact){
      e.surfacePos.multiplyScalar(1/e.exactN);
      e.surfaceOut.normalize();
    }
    out.push({
      pos:e.pos,out:e.out,standable:e.standable,mesh:e.mesh,
      surfacePos:exact?e.surfacePos:V(),surfaceOut:exact?e.surfaceOut:V(),
      surfaceReady:exact,voxelSurface:exact,
      surfaceLocalPos:V(),surfaceLocalReady:false,
      surfaceTransformPos:V(),surfaceTransformQuat:new THREE.Quaternion(),surfaceTransformReady:false,
      up:[],down:[],side:[],vault:null,vaultMesh:null,vaultLipY:NaN,vaultNormal:V(0,1,0)
    });
  });
  return out;
}

function climbNormalsCompatible(a,b){
  const dot=a.out.dot(b.out);
  if(dot>=0.25)return true;
  /* A faceted rock or a fractured wall can turn through a right angle while
     remaining one continuous climb surface. Let that turn reach the physical
     clearance sweep instead of deleting the graph edge up front. Opposing
     faces are still rejected so the player cannot link through a backface or
     an interior fold merely because it shares one structural owner. */
  if(dot<=-0.15)return false;
  const ar=holdSurfaceRoot(a),br=holdSurfaceRoot(b);
  const as=structuralColliderParent(ar),bs=structuralColliderParent(br);
  return ar===br||(!!as&&as===bs);
}

function linkHolds(H,computeVault){
  computeVault=computeVault!==false;
  let links=0;
  /* Holds only connect inside a small physical neighborhood. The old all-pairs
     pass made loading O(n²) and produced hundreds of thousands of redundant
     links on detailed geometry. */
  const cellSize=1.2,grid=new Map();
  const cellKey=(x,y,z)=>x+'_'+y+'_'+z;
  for(let i=0;i<H.length;i++){
    const p=H[i].pos;
    const key=cellKey(Math.floor(p.x/cellSize),Math.floor(p.y/cellSize),Math.floor(p.z/cellSize));
    let bucket=grid.get(key);
    if(!bucket){bucket=[];grid.set(key,bucket);}
    bucket.push(i);
  }
  for(let i=0;i<H.length;i++){
    const A=H[i],p=A.pos;
    const bx=Math.floor(p.x/cellSize),by=Math.floor(p.y/cellSize),bz=Math.floor(p.z/cellSize);
    for(let gx=bx-1;gx<=bx+1;gx++)for(let gy=by-2;gy<=by+2;gy++)for(let gz=bz-1;gz<=bz+1;gz++){
      const bucket=grid.get(cellKey(gx,gy,gz));
      if(!bucket)continue;
      for(const j of bucket){
        if(j<=i)continue;
        const B=H[j];
        if(!climbNormalsCompatible(A,B))continue;
        const dx=B.pos.x-p.x,dy=B.pos.y-p.y,dz=B.pos.z-p.z;
        const hd=Math.hypot(dx,dz);
        if(Math.abs(dy)<0.3&&hd>0.05&&hd<1.0&&A.side.length<6&&B.side.length<6){A.side.push(j);B.side.push(i);links++;}
        else if(dy>0.25&&dy<1.8&&hd<1.15&&A.up.length<5&&B.down.length<5){A.up.push(j);B.down.push(i);links++;}
        else if(dy<-0.25&&dy>-1.8&&hd<1.15&&B.up.length<5&&A.down.length<5){B.up.push(i);A.down.push(j);links++;}
      }
    }
  }
  if(!computeVault)return links;
  /* Only terminal graph nodes need an eager mantle hint. Holds with an upward
     route continue climbing normally and perform the same live probe if that
     route later disappears or becomes blocked. This avoids cooking thousands
     of irrelevant roof rays through tall voxel walls. */
  for(const h of H)if(!h.up.length)computeHoldVault(h);
  return links;
}

function findRemappedHold(ref,H){
  if(!ref)return -1;
  let best=-1,bd=0.82*0.82;
  for(let i=0;i<H.length;i++){
    const h=H[i];
    if(h.mesh!==ref.mesh)continue;
    const d=h.pos.distanceToSquared(ref.pos);
    if(d<bd){bd=d;best=i;}
  }
  return best;
}

function remapHoldLinks(list,indexMap){
  const next=[];
  for(const oldIndex of list){
    const mapped=indexMap.get(oldIndex);
    if(mapped!==undefined)next.push(mapped);
  }
  return next;
}

function addIncrementalHoldLinks(H,start){
  let links=0;
  const cellSize=1.2,grid=new Map();
  const cellKey=(x,y,z)=>x+'_'+y+'_'+z;
  for(let i=0;i<H.length;i++){
    const p=H[i].pos;
    const key=cellKey(Math.floor(p.x/cellSize),Math.floor(p.y/cellSize),Math.floor(p.z/cellSize));
    let bucket=grid.get(key);
    if(!bucket){bucket=[];grid.set(key,bucket);}
    bucket.push(i);
  }
  for(let i=start;i<H.length;i++){
    const A=H[i],p=A.pos;
    const bx=Math.floor(p.x/cellSize),by=Math.floor(p.y/cellSize),bz=Math.floor(p.z/cellSize);
    for(let gx=bx-1;gx<=bx+1;gx++)for(let gy=by-2;gy<=by+2;gy++)for(let gz=bz-1;gz<=bz+1;gz++){
      const bucket=grid.get(cellKey(gx,gy,gz));
      if(!bucket)continue;
      for(const j of bucket){
        if(j===i||(j>=start&&j<=i))continue;
        const B=H[j];
        if(!climbNormalsCompatible(A,B))continue;
        const dx=B.pos.x-p.x,dy=B.pos.y-p.y,dz=B.pos.z-p.z;
        const hd=Math.hypot(dx,dz);
        if(Math.abs(dy)<0.3&&hd>0.05&&hd<1.0&&A.side.length<6&&B.side.length<6){
          A.side.push(j);B.side.push(i);links++;
        }else if(dy>0.25&&dy<1.8&&hd<1.15&&A.up.length<5&&B.down.length<5){
          A.up.push(j);B.down.push(i);links++;
        }else if(dy<-0.25&&dy>-1.8&&hd<1.15&&B.up.length<5&&A.down.length<5){
          B.up.push(i);A.down.push(j);links++;
        }
      }
    }
  }
  return links;
}

function computeHoldVault(h){
  h.vault=null;h.vaultMesh=null;h.vaultLipY=NaN;h.vaultNormal.set(0,1,0);
  if(findMantleLanding(h,h.pos.y+0.3))return;
  /* findMantleLanding keeps a reusable vector while probing. Failed graph
     cooks must not expose that placeholder as a real traversal target. */
  h.vault=null;h.vaultMesh=null;h.vaultLipY=NaN;h.vaultNormal.set(0,1,0);
}

function refreshClimbGraphIncremental(){
  rebuildProxyLists();
  const old=HOLDS;
  const oldHold=player&&player.hold>=0?old[player.hold]:null;
  const oldMoveFrom=player&&player.moveFrom>=0?old[player.moveFrom]:null;
  const oldMoveTo=player&&player.moveTo>=0?old[player.moveTo]:null;
  const indexMap=new Map(),next=[];
  for(let i=0;i<old.length;i++){
    const h=old[i];
    if(climbGraphRemovedMeshes.has(h.mesh)||!holdSurfaceIsLive(h))continue;
    indexMap.set(i,next.length);
    next.push(h);
  }
  /* Rebuild the adjacency arrays after the keep pass so every old index has a
     complete mapping, including links to a kept hold that appeared later. */
  for(let i=0;i<old.length;i++){
    const mapped=indexMap.get(i);
    if(mapped===undefined)continue;
    const h=old[i],kept=next[mapped];
    kept.side=remapHoldLinks(h.side,indexMap);
    kept.up=remapHoldLinks(h.up,indexMap);
    kept.down=remapHoldLinks(h.down,indexMap);
  }
  const newStart=next.length,raw=[];
  for(const mesh of climbGraphAddedMeshes){
    const ud=mesh&&mesh.userData;
    if(mesh&&mesh.parent&&(mesh.visible!==false||ud&&ud.raycastOnly))detectObject(mesh,raw);
  }
  const added=cluster(raw);
  for(const h of added)next.push(h);
  const links=addIncrementalHoldLinks(next,newStart);
  /* Link first so eager vault cooking remains limited to new terminal nodes,
     matching a full graph rebuild. */
  for(let i=newStart;i<next.length;i++)if(!next[i].up.length)computeHoldVault(next[i]);
  HOLDS=next;
  rebuildClimbHoldGrid();
  if(old.length&&player){
    player.hold=findRemappedHold(oldHold,HOLDS);
    player.moveFrom=findRemappedHold(oldMoveFrom,HOLDS);
    player.moveTo=findRemappedHold(oldMoveTo,HOLDS);
    const invalid=player.mode==='attach'?player.moveTo<0:
      player.mode==='move'?(player.moveFrom<0||player.moveTo<0):
      player.mode==='hang'||player.mode==='vault'?player.hold<0:false;
    if(invalid)releaseTraversal(oldHold||oldMoveFrom||oldMoveTo);
  }
  climbGraphAddedMeshes.clear();
  climbGraphRemovedMeshes.clear();
  return {holds:HOLDS.length,links};
}

function rebuildClimbGraph(computeVault){
  rebuildProxyLists();
  const old=HOLDS;
  const oldHold=player&&player.hold>=0?old[player.hold]:null;
  const oldMoveFrom=player&&player.moveFrom>=0?old[player.moveFrom]:null;
  const oldMoveTo=player&&player.moveTo>=0?old[player.moveTo]:null;
  const raw=[];
  for(const pr of proxies)if(pr.grip)detectObject(pr.mesh,raw);
  const next=cluster(raw);
  const links=linkHolds(next,computeVault);
  HOLDS=next;
  rebuildClimbHoldGrid();
  if(old.length&&player){
    player.hold=findRemappedHold(oldHold,HOLDS);
    player.moveFrom=findRemappedHold(oldMoveFrom,HOLDS);
    player.moveTo=findRemappedHold(oldMoveTo,HOLDS);
    const invalid=player.mode==='attach'?player.moveTo<0:
      player.mode==='move'?(player.moveFrom<0||player.moveTo<0):
      player.mode==='hang'||player.mode==='vault'?player.hold<0:false;
    if(invalid)releaseTraversal(oldHold||oldMoveFrom||oldMoveTo);
  }
  climbGraphAddedMeshes.clear();
  climbGraphRemovedMeshes.clear();
  return {holds:HOLDS.length,links};
}
function buildGraph(){return rebuildClimbGraph(true);}
