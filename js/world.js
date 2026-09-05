/* World construction, voxel props, actors, and pickups. Loaded in order from index.html. */
function makeDestructibleHouse(x,z,w,d,h,mat,sillYs){
  /* Four columns/depth slices keep a collapsed room readable as structural
     slabs and wall sections instead of a handful of oversized dice, while
     the fixed solver still has a bounded body count per building. */
  const dObj=makeDestructible(w,h,d,x,h/2,z,mat,{
    hp:150,climb:true,cells:4,sliceH:2.2,cellShell:true
  });
  for(let i=0;i<sillYs.length;i++){
    const sill=addBox(w+0.36,0.14,d+0.36,x,sillYs[i],z,M.trim,{collide:true});
    registerStructuralExtra(dObj,sill,'trim',V(w+0.36,0.14,d+0.36),0.38);
  }
  const trimTop=new THREE.Mesh(new THREE.BoxGeometry(w+0.7,0.38,d+0.7),M.trim);
  trimTop.position.set(x,h-0.19,z);trimTop.castShadow=true;trimTop.receiveShadow=true;
  scene.add(trimTop);addOccluder(trimTop);
  dObj.trimBox=box3Of(trimTop);dObj.trimBox.owner=trimTop;addPhysicsBox(dObj.trimBox);
  const roofMesh=new THREE.Mesh(new THREE.BoxGeometry(w+0.9,0.34,d+0.9),M.roof);
  roofMesh.position.set(x,h+0.17,z);roofMesh.castShadow=true;roofMesh.receiveShadow=true;
  scene.add(roofMesh);addOccluder(roofMesh);
  dObj.roofBox=box3Of(roofMesh);dObj.roofBox.owner=roofMesh;addPhysicsBox(dObj.roofBox);
  dObj.roof=roofMesh;
  dObj.trimTop=trimTop;
  registerStructuralExtra(dObj,trimTop,'trim',V(w+0.7,0.38,d+0.7),0.8);
  registerStructuralExtra(dObj,roofMesh,'roof',V(w+0.9,0.34,d+0.9),1.5);
  registerVoxelBuilding(dObj,x,z,w,d,h,mat);
  return dObj;
}

function addWindowStrip(cx,cz,w,d,y,count,alongX,owner){
  if(owner&&owner.voxelManaged)return;
  for(let i=0;i<count;i++){
    const t=count===1?0:(i/(count-1)-0.5);
    const m=new THREE.Mesh(new THREE.PlaneGeometry(0.9,1.2),M.dark);
    if(alongX)m.position.set(cx+t*(w-2),y,cz+d/2+0.02);
    else{m.position.set(cx+w/2+0.02,y,cz+t*(d-2));m.rotation.y=Math.PI/2;}
    scene.add(m);
    if(owner&&owner.decorations)owner.decorations.push({mesh:m,cell:null,retired:false});
  }
}

const ground=new THREE.Mesh(new THREE.PlaneGeometry(260,260),new THREE.MeshLambertMaterial({color:0x6f8f4f}));
ground.rotation.x=-Math.PI/2;
ground.receiveShadow=true;
scene.add(ground);
standables.push(ground);addOccluder(ground);

addRockFormation(0,-2,[
  {yBase:0,r:4.4,h:5.2,seed:3.1},{yBase:4.7,r:3.5,h:4.6,seed:7.7},
  {yBase:8.9,r:2.7,h:4.0,seed:11.4},{yBase:12.5,r:1.9,h:3.0,seed:15.9}
]);

const summitMarker=new THREE.Group();summitMarker.position.set(0,0,-2);
const poleSocket=new THREE.Mesh(new THREE.BoxGeometry(0.5,0.45,0.5),M.rock);
poleSocket.position.set(0,15.22,0);summitMarker.add(poleSocket);
const pole=new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.05,2.6,6),M.woodDark);
pole.position.set(0,16.4,0);summitMarker.add(pole);
const flagMaterial=new THREE.MeshLambertMaterial({color:0xc23b2e});
const flag=new THREE.Mesh(new THREE.BoxGeometry(1.1,0.7,0.06),flagMaterial);
flag.position.set(0.6,17.3,0);summitMarker.add(flag);
scene.add(summitMarker);summitMarker.updateMatrixWorld(true);
const summitMarkerDestructible=makeDestructibleGroup(summitMarker,{hp:35,cells:3,mass:0.2});
promoteCompoundToVoxels(summitMarkerDestructible,summitMarker,{
  voxelSize:0.11,material:M.woodDark,materialKind:'wood',cellType:3,
  strength:80,anchorBase:false,simulateLoads:false,climb:false,samplePadding:0.055
});

addRockFormation(38,32,[
  {yBase:0,r:3.5,h:4.5,seed:5.1},{yBase:4.1,r:2.6,h:3.6,seed:9.3},
  {yBase:7.3,r:1.8,h:2.8,seed:13.7}
]);
addRockFormation(-32,28,[
  {yBase:0,r:3.0,h:4.0,seed:17.5},{yBase:3.6,r:2.0,h:3.0,seed:21.1}
]);
addRockFormation(28,-38,[
  {yBase:0,r:2.8,h:3.8,seed:25.9},{yBase:3.4,r:1.9,h:2.9,seed:29.4}
]);
addRockFormation(-42,-32,[
  {yBase:0,r:3.4,h:4.4,seed:33.8},{yBase:4.0,r:2.4,h:3.4,seed:37.2}
]);

const houseA=makeDestructibleHouse(-13,-6,8,6,7,M.brick,[1.4,2.9,4.4,5.9]);
addWindowStrip(-13,-6,8,6,2.2,3,true,houseA);
addWindowStrip(-13,-6,8,6,5.2,3,true,houseA);
const houseB=makeDestructibleHouse(11,-9,10,8,9,M.stone,[1.5,3.0,4.5,6.0,7.5]);
addWindowStrip(11,-9,10,8,3.7,4,true,houseB);
const houseC=makeDestructibleHouse(35,5,9,7,8,M.brickDark,[]);
const houseD=makeDestructibleHouse(-30,-8,10,7,9,M.stone,[]);
const houseE=makeDestructibleHouse(0,38,8,8,7,M.brick,[]);
const houseF=makeDestructibleHouse(18,-30,11,7,10,M.stone,[]);

function addBox(w,h,d,x,y,z,mat,opt){
  opt=opt||{};
  if(opt.destructible){
    const dObj=makeDestructible(w,h,d,x,y,z,mat,{
      hp:opt.hp,climb:opt.climb,grip:opt.grip,cells:opt.cells,sliceH:opt.sliceH,mass:opt.mass,
      cellsX:opt.cellsX,cellsY:opt.cellsY,cellsZ:opt.cellsZ,maxCellsPerAxis:opt.maxCellsPerAxis,
      fractureKind:opt.fractureKind,
      voxelOnly:opt.voxelOnly,
      collide:opt.collide,cellClimb:opt.cellClimb,cellGrip:opt.cellGrip,
      cellShell:opt.cellShell!==false
    });
    /* Every destructible is visibly voxel-authored from startup. Large rooms
       retain hollow walls/floors; compact props use a denser solid lattice so
       crates and trim break into proportionally smaller pieces. */
    const roomScale=w>=4&&h>=4&&d>=4;
    const structuralPlate=w>=4&&d>=4&&h>=0.25;
    const maxDim=Math.max(w,h,d),minDim=Math.min(w,h,d);
    const voxelSize=opt.voxelSize||(
      roomScale?(mat===M.glass?0.52:0.68):
      structuralPlate?0.38:
      maxDim<=1.5?Math.max(0.16,Math.min(0.23,minDim/5)):0.28
    );
    const bottom=y-h*0.5;
    const materialKind=mat===M.glass?'glass':
      (mat===M.wood||mat===M.woodDark?'wood':'masonry');
    registerVoxelBuilding(dObj,x,z,w,d,h,mat,{
      y,shape:roomScale?'shell':'solid',voxelSize,materialKind,
      cellType:materialKind==='glass'?4:(materialKind==='wood'?3:1),
      strength:opt.voxelStrength,
      anchorBase:opt.anchorBase===undefined?bottom<=0.1:opt.anchorBase,
      simulateLoads:roomScale,
      climb:opt.climb===undefined?roomScale||maxDim>=2:opt.climb,
      grip:opt.grip
    });
    return dObj;
  }
  const seg=(s)=>Math.max(1,Math.round(s/1.4));
  const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d,seg(w),seg(h),seg(d)),mat);
  m.position.set(x,y,z);
  m.castShadow=true;m.receiveShadow=true;
  scene.add(m);addOccluder(m);
  if(opt.climb!==false){
    proxies.push({mesh:m,grip:opt.grip===false?0:1});
    if(opt.stand!==false)standables.push(m);
  }
  if(opt.collide){const box=box3Of(m);box.owner=m;addPhysicsBox(box);}
  return m;
}

/* Glass needs smaller fracture cells than masonry so a blast produces broken
   panels and shards instead of a few translucent room-sized blocks. */
addBox(12,10,9,12,5,9,M.glass,{
  grip:false,climb:false,cellClimb:false,collide:true,destructible:true,hp:30,cells:6,
  /* Keep the same sub-300 rigid-body budget, but bias it vertically. Smaller
     height cells break into believable window-sized shards instead of tall
     translucent panels while the horizontal footprint remains stable. */
  cellsX:6,cellsY:8,cellsZ:6,sliceH:1.25,mass:0.30,cellShell:true
});
addBox(12.8,0.5,9.8,12,0.25,9,M.marble,{grip:false,collide:true,destructible:true,hp:80});
addBox(11.2,0.5,9.8,12,0.78,9,M.marble,{grip:false,destructible:true,hp:80});

/* A ring of genuinely load-bearing towers turns the open test range into a
   city-scale playground without burying the central combat space. Each setback
   is its own supported voxel structure: upper tiers rest on the tier below and
   can come down with it when the foundation is cut away. A coarse 1.6 m grid
   keeps these huge silhouettes affordable while remaining close enough for the
   traversal graph's vertical reach. The voxel engine authors contrasting glass
   window bands, internal floor slabs, and a reinforced core automatically. */
const skyscrapers=[];
function skyscraper(name,x,z,material,profile){
  const tower={name,x,z,height:0,tiers:[]};
  let baseY=0;
  for(let i=0;i<profile.length;i++){
    const tier=profile[i];
    const tierMaterial=tier.material||material;
    const dObj=addBox(tier.w,tier.h,tier.d,x,baseY+tier.h*0.5,z,tierMaterial,{
      destructible:true,voxelOnly:true,collide:true,climb:true,
      hp:Math.max(320,Math.round(tier.h*18)),
      voxelSize:tier.voxelSize||1.58,
      voxelStrength:tier.strength||520,
      anchorBase:i===0,
      fractureKind:'masonry'
    });
    dObj.skyscraper=tower;
    dObj.skyscraperTier=i;
    dObj.voxelStructure.mesh.name=name+' tier '+(i+1);
    tower.tiers.push(dObj);
    baseY+=tier.h;
  }
  tower.height=baseY;
  skyscrapers.push(tower);
  return tower;
}

skyscraper('Northwest Spire',-58,-55,M.towerBlue,[
  {w:24,d:22,h:30},{w:20,d:18,h:26,material:M.towerSteel},
  {w:15,d:14,h:20},{w:7,d:7,h:11,voxelSize:1.38}
]);
skyscraper('East Exchange',62,-56,M.towerSteel,[
  {w:26,d:18,h:34},{w:21,d:15,h:24,material:M.towerBlue},
  {w:11,d:9,h:12,voxelSize:1.45}
]);
skyscraper('Emerald Needle',70,56,M.towerTeal,[
  {w:22,d:22,h:38},{w:17,d:17,h:30,material:M.towerSteel},
  {w:11,d:11,h:20},{w:5,d:5,h:10,voxelSize:1.32}
]);
skyscraper('Westgate Tower',-66,61,M.towerWarm,[
  {w:28,d:16,h:42},{w:20,d:12,h:23,material:M.towerSteel},
  {w:8,d:8,h:10,voxelSize:1.42}
]);

(function scaffold(){
  const sites=[{x:-6,z:5},{x:22,z:18},{x:-25,z:-22}];
  for(const s of sites){
    const g=new THREE.Group();g.position.set(s.x,0,s.z);
    const beam=(w,h,d,x,y,z,mat)=>{
      const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
      mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;g.add(mesh);
      return mesh;
    };
    for(const sx of[-1.2,1.2])for(const sz of[-0.9,0.9])
      beam(0.14,6.4,0.14,sx,3.2,sz,M.woodDark);
    for(let i=0;i<3;i++){
      beam(3.0,0.09,0.7,0,1.3+i*1.25,0,M.wood);
      beam(0.7,0.09,2.4,1.15,1.3+i*1.25,0,M.wood);
    }
    scene.add(g);g.updateMatrixWorld(true);
    const dObj=makeDestructibleGroup(g,{hp:90,cells:4,mass:0.45});
    promoteCompoundToVoxels(dObj,g,{
      voxelSize:0.15,material:M.wood,materialKind:'wood',cellType:3,
      strength:90,anchorBase:true,simulateLoads:false,climb:true,samplePadding:0.085
    });
  }
})();

function crate(x,y,z,s){return addBox(s,s,s,x,y+s/2,z,M.wood,{collide:true,destructible:true,hp:40,cells:2});}
crate(5,0,2,1.15);crate(6.3,0,2.4,1.15);crate(5.6,1.15,2.2,1.15);
crate(-4,0,-10,1.2);crate(-2.7,0,-10.4,1.2);crate(-3.4,1.2,-10.2,1.2);
crate(-9,0,10,1.1);
crate(20,0,30,1.2);crate(21.4,0,30.3,1.2);crate(20.7,1.2,30.15,1.2);
crate(-22,0,12,1.2);crate(-20.6,0,12.4,1.2);
crate(8,0,-25,1.3);crate(8.65,1.3,-25,1.3);

function ramp(x,z,yaw){
  const m=new THREE.Mesh(new THREE.BoxGeometry(4,0.3,2.5,4,1,3),M.wood);
  m.position.set(x,0.6,z);
  m.rotation.z=0.5;
  m.rotation.y=yaw;
  m.castShadow=true;m.receiveShadow=true;
  scene.add(m);addOccluder(m);
  const dObj=makeDestructibleMesh(m,{
    hp:70,cells:3,mass:0.8,cellShell:true,climb:false,cellClimb:false
  });
  promoteCompoundToVoxels(dObj,m,{
    voxelSize:0.18,material:M.wood,materialKind:'wood',cellType:3,
    strength:90,anchorBase:true,simulateLoads:false,climb:true,samplePadding:0.1
  });
}
ramp(-15,15,0);
ramp(25,-10,Math.PI);

function sandbagWall(x,z,yaw,len){
  const g=new THREE.Group();
  for(let i=0;i<len;i++){
    const sb=new THREE.Mesh(new THREE.BoxGeometry(0.7,0.35,0.35),M.sandbag);
    sb.position.set(i*0.7-((len-1)*0.35),0.4,0);
    sb.castShadow=true;sb.receiveShadow=true;
    g.add(sb);
  }
  for(let i=0;i<Math.max(0,len-1);i++){
    const sb=new THREE.Mesh(new THREE.BoxGeometry(0.7,0.35,0.35),M.sandbag);
    sb.position.set(i*0.7-((len-1)*0.35)+0.3,0.75,0);
    sb.castShadow=true;sb.receiveShadow=true;
    g.add(sb);
  }
  g.position.set(x,0,z);
  g.rotation.y=yaw;
  scene.add(g);
  g.traverse(c=>{if(c.isMesh)addOccluder(c);});
  const dObj=makeDestructibleGroup(g,{hp:60,cells:3,mass:0.5});
  promoteCompoundToVoxels(dObj,g,{
    voxelSize:0.14,material:M.sandbag,materialKind:'masonry',cellType:1,
    strength:62,anchorBase:true,simulateLoads:false,climb:false,samplePadding:0.035
  });
}

function makeDestructibleGroup(group, opts){
  opts=opts||{};
  const local=localBoundsOf(group);
  const size=local.getSize(V()),center=local.getCenter(V());
  const worldCenter=center.clone().applyMatrix4(group.matrixWorld);
  const w=size.x,h=size.y,d=size.z;
  const cx=worldCenter.x,cy=worldCenter.y,cz=worldCenter.z;
  group.traverse(c=>{
    if(!c.isMesh)return;
    removeOccluder(c);
    c.castShadow=true;c.receiveShadow=true;
  });
  const dObj=makeDestructible(w,h,d,cx,cy,cz, group.children[0].material,
    Object.assign({},opts,{climb:false,root:group,localCenter:center}));
  dObj.groupRef=group;
  dObj.groupShell=true;
  dObj.groupShellPieces=[];
  group.updateMatrixWorld(true);
  const groupInverse=group.matrixWorld.clone().invert();
  const grid=dObj.grid;
  const groupPieceCounts=new Map();
  /* Preserve the compound asset’s actual children as dormant static colliders.
     They become active when the coarse group box is detached, then leave the
     scene one child/cell at a time as the matching rigid body is released. */
  group.traverse(child=>{
    if(!child.isMesh)return;
    const childBox=box3Of(child);
    const childCenter=childBox.getCenter(V());
    if(!child.geometry.boundingBox)child.geometry.computeBoundingBox();
    const childSize=child.geometry.boundingBox.getSize(V());
    /* This runs during scene construction, before the later general-purpose
       structuralCellForPoint helper is initialized. Keep the small grid lookup
       local so compound props cannot stall startup on a temporal-dead-zone
       error. */
    const localCenter=childCenter.applyMatrix4(groupInverse);
    const ix=Math.max(0,Math.min(grid.nx-1,Math.floor(
      (localCenter.x-(grid.ox-dObj.size.x*0.5))/grid.cellW)));
    const iy=Math.max(0,Math.min(grid.ny-1,Math.floor(
      (localCenter.y-(grid.oy-dObj.size.y*0.5))/grid.cellH)));
    const iz=Math.max(0,Math.min(grid.nz-1,Math.floor(
      (localCenter.z-(grid.oz-dObj.size.z*0.5))/grid.cellD)));
    const cell=dObj.cellGrid&&dObj.cellGrid[ix]&&dObj.cellGrid[ix][iy]&&
      dObj.cellGrid[ix][iy][iz];
    if(!cell)return;
    childBox.owner=child;
    child.userData=Object.assign({},child.userData,{
      parent:dObj,kind:'groupShell',cellRef:cell,size:childSize.clone(),
      fractureKind:dObj.fractureKind
    });
    const record={mesh:child,cell,box:childBox,retired:false,cellPieceCount:1};
    dObj.groupShellPieces.push(record);
    groupPieceCounts.set(cell,(groupPieceCounts.get(cell)||0)+1);
    addDormantPhysicsBox(childBox);
  });
  for(const record of dObj.groupShellPieces)
    record.cellPieceCount=groupPieceCounts.get(record.cell)||1;
  return dObj;
}
sandbagWall(0,12,0,5);
sandbagWall(15,5,Math.PI/2,4);
sandbagWall(-12,18,0,5);
sandbagWall(20,20,Math.PI/4,3);
sandbagWall(-25,0,Math.PI/2,4);

addRock(-17,9,0,1.8,1.6,21.2,false);
addRock(18,-1,0,2.2,2.0,33.7,false);
addRock(-3,17,0,1.5,1.3,40.1,false);
addRock(45,12,0,1.6,1.5,44.2,false);
addRock(-50,15,0,1.9,1.7,48.3,false);
addRock(12,45,0,2.0,1.8,52.1,false);

function stall(x,z){
  const g=new THREE.Group();g.position.set(x,0,z);
  for(const sx of[-1,1])for(const sz of[-0.8,0.8]){
    const post=new THREE.Mesh(new THREE.BoxGeometry(0.1,2.2,0.1),M.woodDark);
    post.position.set(sx,1.1,sz);post.castShadow=true;g.add(post);
  }
  const canopy=new THREE.Mesh(new THREE.BoxGeometry(2.6,0.1,2.2),M.fabric);
  canopy.position.y=2.45;canopy.rotation.x=0.25;canopy.castShadow=true;g.add(canopy);
  scene.add(g);g.updateMatrixWorld(true);
  const dObj=makeDestructibleGroup(g,{hp:65,cells:4,mass:0.35});
  promoteCompoundToVoxels(dObj,g,{
    voxelSize:0.13,material:M.woodDark,materialKind:'wood',cellType:3,
    strength:85,anchorBase:true,simulateLoads:false,climb:false,samplePadding:0.075
  });
}
stall(-3,13);stall(3,16);stall(-20,5);stall(25,25);

const enemies=[];
const actorVoxelGeometry=new THREE.BoxGeometry(1,1,1);
const actorVoxelMaterial=new THREE.MeshLambertMaterial({color:0xffffff});
const actorVoxelDummy=new THREE.Object3D();
function addActorVoxelPart(actor,name,parent,pivot,center,size,color,cell,shape){
  const holder=new THREE.Group();holder.position.fromArray(pivot);parent.add(holder);
  const nx=Math.max(1,Math.round(size[0]/cell));
  const ny=Math.max(1,Math.round(size[1]/cell));
  const nz=Math.max(1,Math.round(size[2]/cell));
  const cells=[];
  for(let y=0;y<ny;y++)for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
    const px=center[0]+(x-(nx-1)*0.5)*cell;
    const py=center[1]+(y-(ny-1)*0.5)*cell;
    const pz=center[2]+(z-(nz-1)*0.5)*cell;
    if(shape==='sphere'){
      const dx=(px-center[0])/(size[0]*0.5),dy=(py-center[1])/(size[1]*0.5);
      const dz=(pz-center[2])/(size[2]*0.5);
      if(dx*dx+dy*dy+dz*dz>1.08)continue;
    }
    cells.push(V(px,py,pz));
  }
  const mesh=new THREE.InstancedMesh(actorVoxelGeometry,actorVoxelMaterial,cells.length);
  mesh.castShadow=true;mesh.receiveShadow=false;mesh.frustumCulled=false;
  const base=new THREE.Color(color),colors=[];
  for(let i=0;i<cells.length;i++){
    actorVoxelDummy.position.copy(cells[i]);actorVoxelDummy.quaternion.identity();
    actorVoxelDummy.scale.setScalar(cell*0.92);actorVoxelDummy.updateMatrix();
    mesh.setMatrixAt(i,actorVoxelDummy.matrix);
    const tint=base.clone().multiplyScalar(0.9+h3(i,name.length,actor.voxelMeshes.length)*0.16);
    colors.push(tint);mesh.setColorAt(i,tint);
  }
  mesh.instanceMatrix.needsUpdate=true;
  if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
  const partState={
    name,holder,mesh,center:V().fromArray(center),size:V().fromArray(size),
    detached:false,rigidRoot:null,hp:0,maxHp:0,
    restPosition:null,restQuaternion:null,restScale:null
  };
  mesh.userData={
    voxelActor:actor,actorPart:name,actorPartState:partState,
    voxelCells:cells,voxelColors:colors,voxelCellSize:cell
  };
  holder.userData={voxelActor:actor,actorPart:name,actorPartState:partState};
  holder.add(mesh);actor.voxelMeshes.push(mesh);actor.parts[name]=holder;
  actor.partStates[name]=partState;
  return holder;
}
function buildVoxelHumanoid(group,palette,dummy){
  const actor={group,voxelMeshes:[],parts:{},partStates:{},rigidBody:null};
  const cell=dummy?0.105:0.11;
  addActorVoxelPart(actor,'torso',group,[0,1.18,0],[0,0,0],
    dummy?[0.44,0.78,0.3]:[0.56,0.78,0.36],palette.torso,cell,'box');
  addActorVoxelPart(actor,'head',group,[0,1.78,0],[0,0,0],
    dummy?[0.4,0.4,0.4]:[0.44,0.44,0.44],palette.head,cell,'sphere');
  addActorVoxelPart(actor,'leftArm',group,[-0.36,1.48,0],[0,-0.31,0],
    [0.16,0.68,0.16],palette.arm,cell,'box');
  addActorVoxelPart(actor,'rightArm',group,[0.36,1.48,0],[0,-0.31,0],
    [0.16,0.68,0.16],palette.arm,cell,'box');
  addActorVoxelPart(actor,'leftLeg',group,[-0.15,0.78,0],[0,-0.35,0],
    [0.2,0.7,0.22],palette.leg,cell,'box');
  addActorVoxelPart(actor,'rightLeg',group,[0.15,0.78,0],[0,-0.35,0],
    [0.2,0.7,0.22],palette.leg,cell,'box');
  if(!dummy){
    addActorVoxelPart(actor,'gun',group,[0.29,1.22,0.18],[0,0,0.25],
      [0.13,0.13,0.68],palette.gun,0.095,'box');
    actor.parts.leftArm.rotation.x=-0.72;actor.parts.leftArm.rotation.z=-0.16;
    actor.parts.rightArm.rotation.x=-0.88;actor.parts.rightArm.rotation.z=0.12;
  }else{
    actor.parts.leftArm.rotation.z=-0.42;actor.parts.rightArm.rotation.z=0.42;
  }
  for(const state of Object.values(actor.partStates)){
    state.restPosition=state.holder.position.clone();
    state.restQuaternion=state.holder.quaternion.clone();
    state.restScale=state.holder.scale.clone();
  }
  return actor;
}
function actorTargetMeshes(actor){
  if(!actor||!actor.voxelMeshes)return [];
  return actor.voxelMeshes.filter(mesh=>{
    const state=mesh.userData&&mesh.userData.actorPartState;
    return !state||!state.detached;
  });
}
function actorContainsMesh(actor,mesh){
  if(!actor||!actor.voxelMeshes||actor.voxelMeshes.indexOf(mesh)<0)return false;
  const state=mesh&&mesh.userData&&mesh.userData.actorPartState;
  return !state||!state.detached;
}
function makeEnemy(x,z){
  const g=new THREE.Group();
  g.position.set(x,0,z);
  const actor=buildVoxelHumanoid(g,{
    torso:0xb83232,head:0xeebb88,arm:0xa92f2f,leg:0x303943,gun:0x444a52
  },false);
  scene.add(g);
  const e=Object.assign(actor,{
    actorKind:'enemy',pos:V(x,0,z),spawnPos:V(x,0,z),vel:V(),
    hp:50,maxHp:50,alive:true,disarmed:false,
    state:'patrol',target:0,
    cooldown:0,
    path:[V(x+8,0,z),V(x-8,0,z+6),V(x+4,0,z-4)],
    recoil:0,walkPhase:Math.random()*Math.PI*2
  });
  for(const mesh of e.voxelMeshes)mesh.userData.voxelActor=e;
  return e;
}
for(const s of[[25,0],[-30,15],[0,-40],[-45,-10]])enemies.push(makeEnemy(s[0],s[1]));

const dummies=[];
function makeDummy(x,z){
  const g=new THREE.Group();
  g.position.set(x,0,z);
  const actor=buildVoxelHumanoid(g,{
    torso:0x9b6b3e,head:0x5b3b24,arm:0x8d5d34,leg:0x654326,gun:0x444a52
  },true);
  scene.add(g);
  const d=Object.assign(actor,{
    actorKind:'dummy',pos:V(x,0,z),spawnPos:V(x,0,z),
    hp:20,maxHp:20,alive:true,disarmed:false,respawn:0,tilt:0
  });
  for(const mesh of d.voxelMeshes)mesh.userData.voxelActor=d;
  dummies.push(d);
}
for(const s of[[10,5],[-15,5],[20,-15],[-20,25],[5,-30],[30,30],[-35,-25],[0,25]])makeDummy(s[0],s[1]);

const pickups=[];
function makePickup(kind,x,z,y=0){
  const colors={health:M.green,pistol:M.wood,rifle:M.metal,shotgun:M.woodDark};
  const sizes={health:[0.6,0.6,0.6],pistol:[0.18,0.4,0.18],rifle:[0.18,0.4,0.18],shotgun:[0.2,0.4,0.2]};
  const g=new THREE.Group();
  g.position.set(x,y+0.5,z);
  const b=new THREE.Mesh(new THREE.BoxGeometry(...sizes[kind]),colors[kind]);
  b.castShadow=true;g.add(b);
  if(kind==='health'){
    const c=new THREE.Mesh(new THREE.BoxGeometry(0.4,0.1,0.1),new THREE.MeshLambertMaterial({color:0xffffff}));
    c.position.y=0;g.add(c);
  }else if(kind==='pistol'||kind==='rifle'||kind==='shotgun'){
    const tag=new THREE.Mesh(new THREE.BoxGeometry(0.25,0.05,0.18),new THREE.MeshLambertMaterial({color:0xffd479}));
    tag.position.y=0.18;g.add(tag);
  }
  scene.add(g);
  pickups.push({group:g,box:b,kind,pos:V(x,y,z),alive:true,respawn:0});
}
const pickupSpots=[
  ['health',5,0],['health',-15,8],['health',20,30],['health',-25,-20],
  ['health',8,8],['health',-10,20],['health',25,-15],['health',-5,-35],
  ['pistol',-5,-2],['rifle',18,12],['shotgun',-30,30]
];
for(const p of pickupSpots)makePickup(p[0],p[1],p[2]);

scene.updateMatrixWorld(true);
for(const pr of proxies)pr.mesh.updateMatrixWorld(true);
function setFractureClimbProxy(mesh,enabled){
  if(!mesh||!mesh.userData||mesh.userData.kind!=='cell')return;
  const parent=mesh.userData.parent;
  if(parent&&parent.cellClimbEnabled===false){
    mesh.userData.climbProxy=false;
    return;
  }
  mesh.userData.climbProxy=!!enabled;
  const pi=proxies.findIndex(pr=>pr.mesh===mesh);
  if(enabled&&pi<0){
    proxies.push({mesh,grip:parent&&parent.cellGripEnabled===false?0:1});
    climbGraphAddedMeshes.add(mesh);
    climbGraphRemovedMeshes.delete(mesh);
    climbGraphDirty=true;
  }else if(!enabled&&pi>=0){
    proxies.splice(pi,1);
    climbGraphRemovedMeshes.add(mesh);
    climbGraphAddedMeshes.delete(mesh);
    climbGraphDirty=true;
  }
}
function refreshCellClimbProxy(mesh){
  if(!mesh||!mesh.userData||mesh.userData.kind!=='cell')return;
  const parent=mesh.userData.parent;
  if(parent&&parent.cellClimbEnabled===false){setFractureClimbProxy(mesh,false);return;}
  if(mesh.userData.climbProxy===false)return;
  const pi=proxies.findIndex(pr=>pr.mesh===mesh);
  if(pi<0)return;
  /* Keep both change sets populated: the incremental rebuild drops the old
     holds first, then detects the same mesh with its newly exposed faces. */
  proxies.splice(pi,1);
  proxies.push({mesh,grip:parent&&parent.cellGripEnabled===false?0:1});
  climbGraphRemovedMeshes.add(mesh);
  climbGraphAddedMeshes.add(mesh);
  climbGraphDirty=true;
}
function exposeCellClimbNeighbors(cell){
  const u=cell&&cell.userData,dObj=u&&u.parent;
  if(!dObj||!dObj.cells)return;
  for(const other of dObj.cells){
    const v=other.userData;
    if(other===cell||v.released||v.climbInterior)continue;
    const adjacent=Math.abs(v.gridX-u.gridX)+Math.abs(v.gridY-u.gridY)+Math.abs(v.gridZ-u.gridZ)===1;
    if(!adjacent)continue;
    /* A shell-backed structure keeps its continuous facade intact. Expose one
       adjacent interior cell for breach depth, but never reveal the whole
       static fracture field at the first break. Brittle glass stays shell-only
       until its own cell becomes a moving shard. */
    if(dObj.cellShell&&dObj.fractureKind!=='glass'){
      const shell=other.userData.shellMesh;
      const state=shell&&shell.userData&&shell.userData.shellState;
      const piece=state&&state.cellShellPieces&&state.cellShellPieces.get(other);
      if(piece)removeStructuralShellPiece(other,state,piece);
      other.visible=true;
    }
    v.climbInterior=true;
    if(standables.indexOf(other)<0)standables.push(other);
    addOccluder(other);
    refreshCellClimbProxy(other);
  }
}
function rebuildProxyLists(){
  allProxyMeshes=proxies.map(p=>p.mesh);
  gripMeshes=proxies.filter(p=>p.grip).map(p=>p.mesh);
  proxyByMesh.clear();
  for(const pr of proxies)proxyByMesh.set(pr.mesh,pr);
}
