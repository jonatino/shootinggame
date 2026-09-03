/* Structural cooking, fracture handoff, and voxel promotion. Loaded in order from index.html. */
function rockGeo(rad,hseg,r,h,seed){
  const g=new THREE.CylinderGeometry(r*0.7,r,h,rad,hseg,false);
  const p=g.attributes.position;
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
    const b=noise3(x*0.55+seed,y*0.5+seed*2.3,z*0.55);
    const s=1+(b-0.5)*0.6;
    p.setXYZ(i,x*s,y+(noise3(y*0.8+seed*5,x*0.8,z*0.8)-0.5)*0.55,z*s);
  }
  g.computeVertexNormals();
  return g;
}
function addRockFormation(cx,cz,segments,climbable){
  climbable=climbable!==false;
  const minY=Math.min(...segments.map(s=>s.yBase));
  const maxY=Math.max(...segments.map(s=>s.yBase+s.h));
  const maxR=Math.max(...segments.map(s=>s.r));
  const height=maxY-minY,width=maxR*2.32,centerY=(minY+maxY)*0.5;
  /* The temporary authored box is retired immediately by registerVoxelBuilding.
     The rock is therefore visibly voxelized before the first hit; destruction
     removes fixed cells and never swaps a smooth cylinder into cube debris. */
  const dObj=makeDestructible(width,height,width,cx,centerY,cz,M.rock,{
    hp:climbable?420:230,climb:false,cellClimb:false,cells:2,mass:1.8,cellShell:true
  });
  const occupancy=(lx,ly,lz)=>{
    const worldY=centerY+ly,radial=Math.hypot(lx,lz),angle=Math.atan2(lz,lx);
    for(const s of segments){
      if(worldY<s.yBase-0.02||worldY>s.yBase+s.h+0.02)continue;
      const t=Math.max(0,Math.min(1,(worldY-s.yBase)/s.h));
      const coarse=noise3(lx*0.42+s.seed,worldY*0.34+s.seed*1.7,lz*0.42-s.seed);
      const ridge=Math.sin(angle*5+s.seed*1.91+t*3.2)*0.035;
      const radius=s.r*(1-0.29*t)*(0.88+coarse*0.23+ridge);
      if(radial<=radius)return true;
    }
    return false;
  };
  const voxelSize=height>7?0.56:Math.max(0.24,Math.min(0.34,maxR/6.5));
  const structure=registerVoxelBuilding(dObj,cx,cz,width,width,height,M.rock,{
    y:centerY,shape:'mask',voxelSize,occupancy,materialKind:'masonry',
    cellType:1,strength:310,anchorBase:minY<=0.08,simulateLoads:false,climb:false
  });
  dObj.climbFamilyKey='rock:'+cx.toFixed(3)+':'+cz.toFixed(3);
  dObj.loRefs=[];
  if(climbable){
    /* Climb the same exposed voxel faces that render and collide. The former
       hidden cylinder proxy routinely placed a hold one or two block layers
       behind the visible rock; body clearance then moved the root outward and
       made both arms report out-of-reach. `detectObject` recognizes this flag
       and cooks the field without raycasting thousands of instances. */
    structure.mesh.userData.voxelClimbSource=true;
    proxies.push({mesh:structure.mesh,grip:1});
    dObj.loRefs.push(structure.mesh);
  }
  return dObj;
}
function addRock(cx,cz,yBase,r,h,seed,climbable){
  return addRockFormation(cx,cz,[{yBase,r,h,seed}],climbable);
}

function box3Of(m){return new THREE.Box3().setFromObject(m);}

function fracturedCellGeometry(size,seed,boundary){
  boundary=boundary||{};
  const shellOnly=!!boundary.shellOnly;
  const fractureKind=boundary.fractureKind||'masonry';
  const hx=size.x*0.5,hy=size.y*0.5,hz=size.z*0.5;
  const positions=[],indices=[];
  const pushTri=(a,b,c)=>{
    const base=positions.length/3;
    positions.push(a[0],a[1],a[2],b[0],b[1],b[2],c[0],c[1],c[2]);
    indices.push(base,base+2,base+1);
  };
  const pushQuad=(q)=>{
    pushTri(q[0],q[1],q[2]);
    pushTri(q[0],q[2],q[3]);
  };
  if(fractureKind==='glass'&&!shellOnly){
    /* Glass cells are rigid physics envelopes, but their released render
       should read as shards rather than transparent cuboids. Bake an
       irregular bipyramid once: no vertices are changed during flight, and
       the OBB still uses the authored cell size for conservative collision. */
    const cx=(h3(seed,101,1)-0.5)*hx*0.22;
    const cy=(h3(seed,103,1)-0.5)*hy*0.18;
    const cz=(h3(seed,107,1)-0.5)*hz*0.22;
    const ring=[],ringAngle=h3(seed,109,1)*Math.PI*2;
    for(let i=0;i<4;i++){
      const a=ringAngle+i*Math.PI*0.5;
      const rx=hx*(0.78+0.14*h3(seed,113+i,1));
      const rz=hz*(0.78+0.14*h3(seed,127+i,1));
      ring.push([
        cx+Math.cos(a)*rx,
        cy+(h3(seed,131+i,1)-0.5)*hy*0.3,
        cz+Math.sin(a)*rz
      ]);
    }
    const top=[cx+(h3(seed,137,1)-0.5)*hx*0.34,
      cy+hy*(0.78+0.12*h3(seed,139,1)),
      cz+(h3(seed,149,1)-0.5)*hz*0.34];
    const bottom=[cx+(h3(seed,151,1)-0.5)*hx*0.34,
      cy-hy*(0.78+0.12*h3(seed,157,1)),
      cz+(h3(seed,163,1)-0.5)*hz*0.34];
    for(let i=0;i<4;i++){
      const next=(i+1)%4;
      pushTri(top,ring[i],ring[next]);
      pushTri(bottom,ring[next],ring[i]);
    }
    const shardGeo=new THREE.BufferGeometry();
    shardGeo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    shardGeo.setIndex(indices);
    shardGeo.computeVertexNormals();
    shardGeo.computeBoundingBox();
    shardGeo.computeBoundingSphere();
    return shardGeo;
  }
  const cutFace=(q,n,faceId)=>{
    /* Build the break once during cooking: four slightly irregular triangles
       meet at an inset center, so the exposed interior reads as a crushed,
       faceted failure surface instead of a box whose vertices move at runtime. */
    const tangentJitter=Math.min(0.035,Math.min(size.x,size.y,size.z)*0.07);
    const depth=Math.min(0.075,Math.min(size.x,size.y,size.z)*0.13)*
      (0.82+h3(seed,faceId,17)*0.36);
    const cut=q.map((p,i)=>{
      const r=[p[0]-n[0]*depth,p[1]-n[1]*depth,p[2]-n[2]*depth];
      const j0=(h3(seed,faceId*11+i,23)-0.5)*tangentJitter;
      const j1=(h3(seed,faceId*13+i,29)-0.5)*tangentJitter;
      if(Math.abs(n[0])>0.5){r[1]+=j0;r[2]+=j1;}
      else if(Math.abs(n[1])>0.5){r[0]+=j0;r[2]+=j1;}
      else{r[0]+=j0;r[1]+=j1;}
      return r;
    });
    const center=[0,0,0];
    for(const p of q){center[0]+=p[0];center[1]+=p[1];center[2]+=p[2];}
    center[0]=center[0]*0.25-n[0]*depth*1.8;
    center[1]=center[1]*0.25-n[1]*depth*1.8;
    center[2]=center[2]*0.25-n[2]*depth*1.8;
    center[0]+=(h3(seed,faceId,37)-0.5)*tangentJitter*0.8;
    center[1]+=(h3(seed,faceId,41)-0.5)*tangentJitter*0.8;
    center[2]+=(h3(seed,faceId,43)-0.5)*tangentJitter*0.8;
    pushTri(cut[0],cut[1],center);
    pushTri(cut[1],cut[2],center);
    pushTri(cut[2],cut[3],center);
    pushTri(cut[3],cut[0],center);
  };
  const facetedOuterFace=(q,n,faceId)=>{
    /* Glass can use a shallow chipped perimeter because its fractured shard is
       intentionally a different authored silhouette. Masonry and wood keep
       their exact planar outside faces below; changing a flat facade into a
       dented triangle fan at release looked like geometry morphing even though
       the vertices were technically pre-baked. */
    const minSize=Math.min(size.x,size.y,size.z);
    const isGlass=fractureKind==='glass';
    const depth=(isGlass?Math.min(0.085,minSize*0.12):Math.min(0.12,minSize*0.16))*
      (0.82+h3(seed,faceId,67)*0.36);
    const tangentJitter=isGlass?Math.min(0.018,minSize*0.025):Math.min(0.075,minSize*0.1);
    const center=[0,0,0];
    for(const p of q){center[0]+=p[0];center[1]+=p[1];center[2]+=p[2];}
    center[0]=center[0]*0.25-n[0]*depth*1.8;
    center[1]=center[1]*0.25-n[1]*depth*1.8;
    center[2]=center[2]*0.25-n[2]*depth*1.8;
    center[0]+=(h3(seed,faceId,71)-0.5)*tangentJitter;
    center[1]+=(h3(seed,faceId,73)-0.5)*tangentJitter;
    center[2]+=(h3(seed,faceId,79)-0.5)*tangentJitter;
    /* Pull the four corners toward the face center only for glass. The small
       chamfer leaves a chipped perimeter between neighboring cells, so a
       released piece reads as a shard with broken edges instead of a perfect
       rectangular tile. The intact shell still uses shellOnly quads. */
    const perimeter=isGlass?q.map((p,i)=>{
      const pull=0.16+0.08*h3(seed,faceId*7+i,83);
      const r=[
        p[0]+(center[0]-p[0])*pull,
        p[1]+(center[1]-p[1])*pull,
        p[2]+(center[2]-p[2])*pull
      ];
      const j0=(h3(seed,faceId*17+i,89)-0.5)*tangentJitter*0.65;
      const j1=(h3(seed,faceId*19+i,97)-0.5)*tangentJitter*0.65;
      if(Math.abs(n[0])>0.5){r[1]+=j0;r[2]+=j1;}
      else if(Math.abs(n[1])>0.5){r[0]+=j0;r[2]+=j1;}
      else{r[0]+=j0;r[1]+=j1;}
      return r;
    }):q;
    pushTri(perimeter[0],perimeter[1],center);pushTri(perimeter[1],perimeter[2],center);
    pushTri(perimeter[2],perimeter[3],center);pushTri(perimeter[3],perimeter[0],center);
  };
  const face=(q,n,outer,id)=>{
    /* The intact structural shell uses the same authored cell boundaries but
       omits all internal faces. It is a continuous render surface until a
       rigid cell is released, so the building never swaps into a visible
       lattice on the first hit. */
    if(shellOnly){if(outer)pushQuad(q);}
    else if(outer&&fractureKind==='glass'){
      /* Leave a small pre-baked gap between released glass cells. The physics
         body still owns the full cell envelope, but the visible rigid shard
         has chipped edges and never forms a second translucent brick wall. */
      const insetX=Math.min(0.06,hx*0.16),insetY=Math.min(0.06,hy*0.16),insetZ=Math.min(0.06,hz*0.16);
      const chippedQ=q.map(p=>[
        p[0]+(p[0]>=0?-insetX:insetX),
        p[1]+(p[1]>=0?-insetY:insetY),
        p[2]+(p[2]>=0?-insetZ:insetZ)
      ]);
      facetedOuterFace(chippedQ,n,id);
    }
    else if(outer)pushQuad(q);
    else cutFace(q,n,id);
  };
  /* Keep the winding consistent with the original box: outer surfaces remain
     perfectly planar while only internal faces receive the fracture treatment. */
  face([[ hx,-hy,-hz],[ hx,-hy, hz],[ hx, hy, hz],[ hx, hy,-hz]],[ 1,0,0],boundary.x1,0);
  face([[-hx,-hy, hz],[-hx,-hy,-hz],[-hx, hy,-hz],[-hx, hy, hz]],[-1,0,0],boundary.x0,1);
  face([[-hx, hy,-hz],[ hx, hy,-hz],[ hx, hy, hz],[-hx, hy, hz]],[0, 1,0],boundary.y1,2);
  face([[-hx,-hy, hz],[ hx,-hy, hz],[ hx,-hy,-hz],[-hx,-hy,-hz]],[0,-1,0],boundary.y0,3);
  face([[-hx,-hy, hz],[-hx, hy, hz],[ hx, hy, hz],[ hx,-hy, hz]],[0,0, 1],boundary.z1,4);
  face([[ hx,-hy,-hz],[ hx, hy,-hz],[-hx, hy,-hz],[-hx,-hy,-hz]],[0,0,-1],boundary.z0,5);
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/* Irregular authored surfaces keep one continuous shell until their fracture
   field takes over. Box facades use individually removable, pre-baked cell
   panels so a breach removes an actual static piece instead of changing a
   fragment's vertices or carving a runtime hole through one giant mesh. */
const STRUCTURAL_SHELL_MAX_HOLES=128;
function makeStructuralShellMaterial(base,state){
  const material=base.clone();
  material.onBeforeCompile=shader=>{
    shader.uniforms.uShellHoleCount={value:state.holeCount};
    shader.uniforms.uShellHoleCenters={value:state.holeCenters};
    shader.uniforms.uShellHoleHalves={value:state.holeHalves};
    shader.vertexShader='varying vec3 vShellLocal;\n'+
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vShellLocal=position;'
      );
    shader.fragmentShader='varying vec3 vShellLocal;\n'+
      'uniform int uShellHoleCount;\n'+
      'uniform vec3 uShellHoleCenters['+STRUCTURAL_SHELL_MAX_HOLES+'];\n'+
      'uniform vec3 uShellHoleHalves['+STRUCTURAL_SHELL_MAX_HOLES+'];\n'+
      shader.fragmentShader.replace(
        'void main() {',
        'void main() {\n'+
        '  for(int i=0;i<'+STRUCTURAL_SHELL_MAX_HOLES+';i++){\n'+
        '    if(i>=uShellHoleCount)break;\n'+
        '    vec3 holeDelta=abs(vShellLocal-uShellHoleCenters[i])-uShellHoleHalves[i]-vec3(0.025);\n'+
        '    if(holeDelta.x<=0.0&&holeDelta.y<=0.0&&holeDelta.z<=0.0)discard;\n'+
        '  }'
      );
    state.shaderUniforms=shader.uniforms;
  };
  material.customProgramCacheKey=()=> 'structural-shell-v1';
  return material;
}

function removeStructuralShellPiece(cell,state,piece){
  if(!piece)return false;
  piece.visible=false;
  /* Shell panels are removed frequently during a collapse. Keep their list
     slots so this is a constant-time swap instead of repeatedly shifting a
     several-hundred-mesh raycast array on the impact frame. */
  const removeFrom=(list,key)=>{
    let index=piece.userData&&piece.userData[key];
    if(!Number.isInteger(index)||list[index]!==piece)index=list.indexOf(piece);
    if(index<0)return;
    const last=list.pop();
    if(last!==piece){
      list[index]=last;
      if(last&&last.userData)last.userData[key]=index;
    }
    if(piece.userData)piece.userData[key]=-1;
  };
  removeFrom(occluders,'occluderIndex');
  removeFrom(standables,'standableIndex');
  if(piece.parent)piece.parent.remove(piece);
  if(piece.geometry){
    deferGeometryDispose(piece.geometry);
    /* Keep the geometry reference until the retired mesh is no longer visible
       to any raycaster/render traversal. Nulling it here made a stale list
       entry fail inside Three.js while reading `boundingSphere`; deferred
       disposal already releases the GPU resource without invalidating that
       one-frame-safe object reference. */
  }
  if(state&&state.cellShellPieces)state.cellShellPieces.delete(cell);
  return true;
}

/* Compound props such as sandbag walls are already authored as separate
   meshes. Keep those exact meshes as the intact shell and promote them to
   individual rigid bodies when their structural cell fails; replacing the
   whole group with a generated bounding box was the last visible shape-shift
   path. */
function activateGroupShellCell(dObj,cell,epicenter,blastForce,directHit,failureDir){
  if(!dObj||!dObj.groupShell||!dObj.groupShellPieces)return null;
  let bodyCount=0;
  for(const record of dObj.groupShellPieces){
    if(record.retired||record.cell!==cell)continue;
    record.retired=true;
    removePhysicsBox(record.box);
    const mesh=record.mesh;
    if(!mesh)continue;
    mesh.updateMatrixWorld(true);
    /* Detach while preserving the authored world transform. The mesh itself
       becomes the rigid body, so its bag/beam geometry never changes shape at
       the release boundary. */
    scene.attach(mesh);
    const geometry=mesh.geometry;
    if(!geometry.boundingBox)geometry.computeBoundingBox();
    const size=geometry.boundingBox.getSize(V());
    const ud=mesh.userData;
    ud.kind='groupChunk';
    ud.size=size;
    ud.relPos=cell.userData.relPos.clone();
    ud.mass=Math.max(0.15,(cell.userData.mass||0.5)/
      Math.max(1,record.cellPieceCount||1));
    ud.released=true;
    ud.fractureQueued=false;
    ud.fracturedVisual=true;
    ud.fractureKind=dObj.fractureKind;
    wakeSettledDependents(mesh,epicenter,Math.max(0.6,blastForce*0.35));
    activateChunk(mesh,epicenter,blastForce,directHit,failureDir);
    chunks.push(mesh);
    bodyCount++;
  }
  return bodyCount;
}

function registerStructuralShellHole(cell){
  const ud=cell&&cell.userData,shell=ud&&ud.shellMesh,state=shell&&shell.userData&&shell.userData.shellState;
  if(!shell||!state||state.retired||state.holeCells.indexOf(cell)>=0)return;
  /* Box structures do not use a shader carve. Their exact static facade piece
     is removed from the render/collision lists at the same instant the rigid
     cell is activated, leaving the released body to own that space. */
  const piece=state.cellShellPieces&&state.cellShellPieces.get(cell);
  if(piece){
    state.holeCells.push(cell);
    state.holeCount++;
    removeStructuralShellPiece(cell,state,piece);
    if(state.cellShellPieces.size===0){
      state.retired=true;
      shell.visible=false;
      if(shell.parent)shell.parent.remove(shell);
    }
    return;
  }
  if(state.usesCellPieces){
    /* This cell may already be showing its full pre-baked interior because a
       neighboring break exposed it. There is no static panel left to retire,
       and there must never be a fallback to shader-carving for piece-backed
       buildings. */
    state.holeCells.push(cell);
    state.holeCount++;
    if(state.cellShellPieces.size===0){
      state.retired=true;
      shell.visible=false;
      if(shell.parent)shell.parent.remove(shell);
    }
    return;
  }
  if(state.holeCount>=STRUCTURAL_SHELL_MAX_HOLES){
    /* The authored irregular surfaces stay below this budget. If a future
       asset exceeds it, retire the shell rather than leaving a stale solid
       facade over real debris. */
    state.overflow=true;
    shell.visible=false;
    return;
  }
  const slot=state.holeCount++;
  state.holeCells.push(cell);
  state.holeCenters[slot].copy(ud.relPos);
  state.holeHalves[slot].copy(ud.size).multiplyScalar(0.5);
  if(state.shaderUniforms&&state.shaderUniforms.uShellHoleCount)
    state.shaderUniforms.uShellHoleCount.value=state.holeCount;
  if(state.holeCount>=state.totalCells){
    state.retired=true;
    shell.visible=false;
    removeOccluder(shell);
    const si=standables.indexOf(shell);if(si>=0)standables.splice(si,1);
    if(shell.parent)shell.parent.remove(shell);
    if(shell.geometry)shell.geometry.dispose();
    if(shell.material)shell.material.dispose();
  }
}

function retireCellShell(cell){
  registerStructuralShellHole(cell);
}

function localBoundsOf(root){
  root.updateMatrixWorld(true);
  const inverse=root.matrixWorld.clone().invert();
  const bounds=new THREE.Box3();
  const point=V();
  root.traverse(node=>{
    if(!node.isMesh||!node.geometry)return;
    if(!node.geometry.boundingBox)node.geometry.computeBoundingBox();
    const b=node.geometry.boundingBox;
    for(let ix=0;ix<2;ix++)for(let iy=0;iy<2;iy++)for(let iz=0;iz<2;iz++){
      point.set(ix?b.max.x:b.min.x,iy?b.max.y:b.min.y,iz?b.max.z:b.min.z)
        .applyMatrix4(node.matrixWorld).applyMatrix4(inverse);
      bounds.expandByPoint(point);
    }
  });
  return bounds;
}

let destructibles=[];
const boxByRoot=new Map();

/* Surface-backed rocks need the same no-morph handoff as box buildings. Split
   the authored triangle stream into pre-baked cell patches during cooking, so
   a later break can remove whole existing surface pieces without a shader
   discard or a runtime vertex edit. Triangle boundaries remain exact; only the
   patch that owns a cell is retired when that cell actually releases. */
function buildSurfacePatchShell(dObj,root,rootMatrix,state){
  const geometry=root&&root.geometry;
  const position=geometry&&geometry.getAttribute('position');
  if(!position||position.count<3)return null;
  const normal=geometry.getAttribute('normal');
  const uv=geometry.getAttribute('uv');
  const patchData=dObj.cells.map(()=>({
    positions:[],normals:normal?[]:null,uvs:uv?[]:null
  }));
  const index=geometry.index;
  const triangleCount=index?Math.floor(index.count/3):Math.floor(position.count/3);
  const grid=dObj.grid;
  const cellAt=(x,y,z)=>{
    const ix=Math.max(0,Math.min(grid.nx-1,Math.floor(
      (x-(grid.ox-dObj.size.x*0.5))/grid.cellW)));
    const iy=Math.max(0,Math.min(grid.ny-1,Math.floor(
      (y-(grid.oy-dObj.size.y*0.5))/grid.cellH)));
    const iz=Math.max(0,Math.min(grid.nz-1,Math.floor(
      (z-(grid.oz-dObj.size.z*0.5))/grid.cellD)));
    return patchData[(ix*grid.ny+iy)*grid.nz+iz];
  };
  const copyVertex=(data,vertex)=>{
    data.positions.push(position.getX(vertex),position.getY(vertex),position.getZ(vertex));
    if(data.normals)data.normals.push(normal.getX(vertex),normal.getY(vertex),normal.getZ(vertex));
    if(data.uvs)data.uvs.push(uv.getX(vertex),uv.getY(vertex));
  };
  const buildRigidSurfaceVisual=(data,cell)=>{
    /* The intact patch and the released body use the same authored triangles.
       Re-centre a copy around the cell so it can follow the cell's rigid OBB
       without ever rebuilding the rock into a box at release time. The OBB
       remains on the parent mesh for conservative collision and support. */
    const rel=cell.userData.relPos;
    const localPositions=new Array(data.positions.length);
    for(let i=0;i<data.positions.length;i+=3){
      localPositions[i]=data.positions[i]-rel.x;
      localPositions[i+1]=data.positions[i+1]-rel.y;
      localPositions[i+2]=data.positions[i+2]-rel.z;
    }
    const visualGeo=new THREE.BufferGeometry();
    visualGeo.setAttribute('position',new THREE.Float32BufferAttribute(localPositions,3));
    if(data.normals)
      visualGeo.setAttribute('normal',new THREE.Float32BufferAttribute(data.normals.slice(),3));
    else visualGeo.computeVertexNormals();
    if(data.uvs)
      visualGeo.setAttribute('uv',new THREE.Float32BufferAttribute(data.uvs.slice(),2));
    visualGeo.computeBoundingBox();visualGeo.computeBoundingSphere();
    const visual=new THREE.Mesh(visualGeo,dObj.mat);
    visual.name='rigid-authored-surface';
    visual.visible=false;
    visual.castShadow=true;visual.receiveShadow=true;
    cell.add(visual);
    cell.userData.surfaceVisual=visual;
    cell.userData.surfaceVisualBaseMaterial=dObj.mat;
    /* Keep the parent mesh as a hidden physics envelope. Its conservative box
       is still used by the broadphase/OBB solver, while only the authored patch
       is rendered after release. */
    cell.material=new THREE.MeshBasicMaterial({visible:false});
  };
  for(let tri=0;tri<triangleCount;tri++){
    const ia=index?index.getX(tri*3):tri*3,
      ib=index?index.getX(tri*3+1):tri*3+1,
      ic=index?index.getX(tri*3+2):tri*3+2;
    const cx=(position.getX(ia)+position.getX(ib)+position.getX(ic))/3;
    const cy=(position.getY(ia)+position.getY(ib)+position.getY(ic))/3;
    const cz=(position.getZ(ia)+position.getZ(ib)+position.getZ(ic))/3;
    const data=cellAt(cx,cy,cz);
    if(!data)continue;
    copyVertex(data,ia);copyVertex(data,ib);copyVertex(data,ic);
  }
  const shellGroup=new THREE.Group();
  state.usesCellPieces=true;
  state.surfacePatchShell=true;
  shellGroup.name='surface-cell-shell';
  shellGroup.matrix.copy(rootMatrix);
  shellGroup.matrixAutoUpdate=false;
  shellGroup.matrixWorldNeedsUpdate=true;
  shellGroup.userData={parent:dObj,kind:'cellShell',size:dObj.size.clone(),shellState:state};
  for(let i=0;i<dObj.cells.length;i++){
    const data=patchData[i];
    if(data.positions.length<9)continue;
    const cell=dObj.cells[i];
    const patchGeo=new THREE.BufferGeometry();
    patchGeo.setAttribute('position',new THREE.Float32BufferAttribute(data.positions,3));
    if(data.normals)patchGeo.setAttribute('normal',new THREE.Float32BufferAttribute(data.normals,3));
    else patchGeo.computeVertexNormals();
    if(data.uvs)patchGeo.setAttribute('uv',new THREE.Float32BufferAttribute(data.uvs,2));
    patchGeo.computeBoundingBox();patchGeo.computeBoundingSphere();
    const piece=new THREE.Mesh(patchGeo,dObj.mat);
    piece.castShadow=true;piece.receiveShadow=true;piece.visible=true;
    piece.userData={parent:dObj,kind:'cellShell',cell,
      size:cell.userData.size.clone(),surfacePatch:true};
    shellGroup.add(piece);
    state.cellShellPieces.set(cell,piece);
    addOccluder(piece);
    standables.push(piece);
    buildRigidSurfaceVisual(data,cell);
  }
  if(!state.cellShellPieces.size){
    shellGroup.traverse(node=>{if(node.isMesh&&node.geometry)node.geometry.dispose();});
    return null;
  }
  scene.add(shellGroup);
  shellGroup.updateMatrixWorld(true);
  return shellGroup;
}

function buildStructuralCellShell(dObj){
  if(!dObj||!dObj.root||!dObj.root.isMesh||!dObj.cells||!dObj.cells.length)return false;
  const root=dObj.root;
  root.updateMatrixWorld(true);
  const rootMatrix=root.matrixWorld.clone();
  dObj.rootMatrix=rootMatrix;
  const rootWorldPos=V(),rootWorldQuat=new THREE.Quaternion(),rootWorldScale=V();
  rootMatrix.decompose(rootWorldPos,rootWorldQuat,rootWorldScale);
  const state={
    totalCells:dObj.cells.length,holeCount:0,holeCells:[],
    holeCenters:Array.from({length:STRUCTURAL_SHELL_MAX_HOLES},()=>V()),
    holeHalves:Array.from({length:STRUCTURAL_SHELL_MAX_HOLES},()=>V()),
    shaderUniforms:null,cellShellPieces:new Map(),usesCellPieces:false,
    retired:false,overflow:false
  };
  let shell=root;
  if(dObj.surfaceShell){
    const patchShell=buildSurfacePatchShell(dObj,root,rootMatrix,state);
    if(patchShell){
      /* The authored root remains the coarse collision volume until its first
         real support failure, but the visible/raycast surface is already the
         exact pre-baked triangle patch field. */
      shell=patchShell;
      dObj.surfacePatchShell=true;
      const si=standables.indexOf(root);if(si>=0)standables.splice(si,1);
      const pi=proxies.findIndex(pr=>pr.mesh===root);if(pi>=0)proxies.splice(pi,1);
      removeOccluderMeshes(root);
      /* The visible low-resolution proxy is the graph surface, while the
         authored high-resolution rock remains the authoritative contact frame
         until a real fracture detaches it. It is intentionally hidden from
         rendering, but must stay raycast-live for hold anchors and vault
         validation during that intact phase. */
      root.userData=Object.assign({},root.userData,{raycastOnly:true});
      root.visible=false;
    }else{
      /* Fallback for an asset without a usable triangle stream. Irregular rocks
         normally take the patch path above; this keeps older custom meshes
         functional without changing their existing behavior. */
      root.material=makeStructuralShellMaterial(dObj.mat,state);
      root.userData=Object.assign({},root.userData,{
        parent:dObj,surfaceShellRoot:true,size:dObj.size.clone(),shellState:state
      });
      root.castShadow=true;root.receiveShadow=true;
    }
  }else{
    /* Use the exact pre-baked facade panels from the first frame. Keeping the
       removable pieces visible at rest avoids the old first-impact visual swap
       from one continuous shell to a panel field. A break now removes the
       actual panel that occupied the space while its matching rigid cell takes
       over, with no vertex mutation or shader-carved hole. */
    const shellGroup=new THREE.Group();
    state.usesCellPieces=true;
    shellGroup.name='structural-cell-shell';
    shellGroup.matrix.copy(rootMatrix);
    shellGroup.matrixAutoUpdate=false;
    shellGroup.matrixWorldNeedsUpdate=true;
    shellGroup.userData={parent:dObj,kind:'cellShell',size:dObj.size.clone(),shellState:state};
    for(const c of dObj.cells){
      const u=c.userData;
      const shellGeo=fracturedCellGeometry(u.size,
        (u.gridX+1)*17+(u.gridY+1)*41+(u.gridZ+1)*73,{
          x0:u.gridX===0,x1:u.gridX===dObj.grid.nx-1,
          y0:u.gridY===0,y1:u.gridY===dObj.grid.ny-1,
          z0:u.gridZ===0,z1:u.gridZ===dObj.grid.nz-1,
          shellOnly:true
        });
      const attr=shellGeo.attributes.position;
      if(attr.count){
        const piece=new THREE.Mesh(shellGeo,dObj.mat);
        piece.position.copy(u.relPos);
        piece.castShadow=true;piece.receiveShadow=true;
        piece.visible=true;
        piece.userData={parent:dObj,kind:'cellShell',cell:c,size:u.size.clone()};
        shellGroup.add(piece);
        state.cellShellPieces.set(c,piece);
        piece.userData.occluderIndex=occluders.length;
        addOccluder(piece);
        piece.userData.standableIndex=standables.length;
        standables.push(piece);
      }else shellGeo.dispose();
    }
    scene.add(shellGroup);
    shellGroup.updateMatrixWorld(true);
    state.intactShell=null;
    state.intactShellRetired=true;
    shell=shellGroup;
  }
  dObj.cellShell=shell;
  dObj.cellShellState=state;

  /* Box assets use the visible pre-baked panels for intact raycasts and retain
     their original AABB as the cheap coarse collision volume. The authored root
     is hidden from rendering, but stays alive until the first fracture so the
     handoff can remove that one coarse collider cleanly. */
  if(!dObj.surfaceShell){
    root.userData=Object.assign({},root.userData,{parent:dObj,surfaceDetached:true});
    removeOccluder(root);
    const si=standables.indexOf(root);if(si>=0)standables.splice(si,1);
    const pi=proxies.findIndex(pr=>pr.mesh===root);if(pi>=0)proxies.splice(pi,1);
    root.visible=false;
    dObj.fragmented=false;
    dObj.rootHidden=false;
  }else{
    /* Keep the authored mesh as the intact surface until a cell is actually
       released. The shell material is already installed, but the original
       collision, climb proxy, and cylinder remain authoritative for now. */
    dObj.fragmented=false;
    dObj.rootHidden=false;
  }
  dObj.fracturePrepared=true;

  /* Hidden fracture bodies are also the exact climb/raycast proxies. They are
     attached to the scene so raycasters can sample the authored surface, but
     remain invisible until their support path actually fails. */
  for(const c of dObj.cells){
    const u=c.userData;
    c.position.copy(u.relPos).applyMatrix4(rootMatrix);
    c.quaternion.copy(rootWorldQuat);
    c.visible=false;
    c.userData.raycastOnly=true;
    c.userData.climbProxy=!!dObj.cellClimbEnabled;
    c.userData.shellMesh=shell;
    scene.add(c);
    c.updateMatrixWorld(true);
    const cellBox=box3Of(c);
    cellBox.owner=c;
    c.userData.fractureBox=cellBox;
    c.userData.staticColliderAdded=false;
    /* Keep every pre-baked cell in the static broadphase index, but dormant
       until the intact shell hands that cell to the physics field. This makes
       activation an O(1) state change instead of a first-impact registration
       spike. */
    addDormantPhysicsBox(cellBox);
    /* The continuous shell/root collider owns intact shots, ground probes, and
       mantle landing checks. Hidden authored cells are only climb samples until
       the first support failure, so they cannot create duplicate raycasts or
       invisible collision walls around an unbroken building. */
    if(!dObj.surfaceShell){
      if(dObj.cellClimbEnabled)
        proxies.push({mesh:c,grip:dObj.cellGripEnabled?1:0});
    }else if(dObj.surfacePatchShell&&dObj.cellClimbEnabled){
      const patch=state.cellShellPieces.get(c);
      if(patch)proxies.push({mesh:patch,grip:dObj.cellGripEnabled?1:0});
    }
  }
  return true;
}

function addOccluderMeshes(root){
  if(!root)return;
  if(root.isMesh){
    addOccluder(root);
    return;
  }
  if(root.traverse)root.traverse(node=>{
    if(node.isMesh)addOccluder(node);
  });
}
function removeOccluderMeshes(root){
  if(!root)return;
  const remove=(node)=>{
    removeOccluder(node);
  };
  if(root.isMesh)remove(root);
  else if(root.traverse)root.traverse(node=>{if(node.isMesh)remove(node);});
}

function makeDestructible(w,h,d,x,y,z,mat,opts){
  opts=opts||{};
  let root=opts.root||null;
  if(root){
    root.castShadow=true;root.receiveShadow=true;
    addOccluderMeshes(root);
    if(!root.isMesh&&root.traverse)root.traverse(node=>{
      if(node.isMesh)node.userData=Object.assign({},node.userData,{structuralRoot:root});
    });
  }else{
    const seg=(s)=>Math.max(1,Math.round(s/1.4));
    root=new THREE.Mesh(new THREE.BoxGeometry(w,h,d,seg(w),seg(h),seg(d)),mat);
    root.position.set(x,y,z);
    root.castShadow=true;root.receiveShadow=true;
    scene.add(root);
    addOccluder(root);
  }
  const rootBox=box3Of(root);
  rootBox.owner=root;
  addPhysicsBox(rootBox);
  boxByRoot.set(root,rootBox);
  if(opts.climb!==false){
    proxies.push({mesh:root,grip:opts.grip===false?0:1});
    standables.push(root);
  }
  const dObj={
    root,mesh:root,rootBox,
    worldBox:rootBox.clone(),
    pos:V(x,y,z),size:V(w,h,d),mat,
    surfaceShell:!!opts.surfaceShell,
    fractureKind:opts.fractureKind||
      (mat===M.glass?'glass':(mat===M.wood||mat===M.woodDark?'wood':'masonry')),
    /* The authored root and its released cells can have different traversal
       affordances. Rocks use a separate low-resolution climb proxy while
       broken cells may become climbable; polished surfaces can remain visible
       to the graph without ever becoming grippable. */
    cellClimbEnabled:opts.cellClimb!==undefined?opts.cellClimb!==false:opts.climb!==false,
    cellGripEnabled:opts.cellGrip!==undefined?opts.cellGrip!==false:opts.grip!==false,
    hp:opts.hp||120,
    alive:true,
    fragmented:false,
    fracturePrepared:false,
    rootHidden:false,
    fieldRevealed:false,
    releasedCount:0,
    destroyed:false,
    cells:[],nCells:0,grid:null,decorations:[],structuralExtras:[],
    voxelField:null,voxelFieldRevision:0
  };
  /* Let coarse intact-root contacts participate in the same support graph as
     fracture cells, roofs, and trims. A settled shard resting on a building
     must be wakeable when that building loses its load path. */
  root.userData=Object.assign({},root.userData,{parent:dObj});
  /* Most structures use a balanced grid, but thin panels benefit from finer
     horizontal cuts without multiplying their vertical courses. Allow an
     asset to request that deliberately; the global active-body cap still
     protects the solver during a large collapse. */
  const px=opts.cellsX!==undefined?opts.cellsX:
    ((opts.cells!==undefined)?opts.cells:Math.max(1,Math.round(w/1.8)));
  const pz=opts.cellsZ!==undefined?opts.cellsZ:
    ((opts.cells!==undefined)?opts.cells:Math.max(1,Math.round(d/1.8)));
  const py=opts.cellsY!==undefined?opts.cellsY:
    Math.max(1,Math.round(h/Math.max(1.0,(opts.sliceH||1.4))));
  const maxAxis=opts.maxCellsPerAxis===undefined?8:Math.max(1,opts.maxCellsPerAxis);
  const nx=Math.min(px,maxAxis), ny=Math.min(py,maxAxis), nz=Math.min(pz,maxAxis);
  const cellW=w/nx, cellH=h/ny, cellD=d/nz;
  const origin=opts.localCenter;
  const ox=origin?origin.x:0,oy=origin?origin.y:0,oz=origin?origin.z:0;
  dObj.grid={nx,ny,nz,cellW,cellH,cellD,ox,oy,oz};
  const cellGrid=Array.from({length:nx},()=>Array.from({length:ny},()=>Array(nz).fill(null)));
  for(let ix=0;ix<nx;ix++)for(let iy=0;iy<ny;iy++)for(let iz=0;iz<nz;iz++){
    /* Each fragment is authored once during setup. Its fractured cut face stays
       fixed for the rest of its life; activation only reveals this rigid body and
       gives it velocity. The intact shell still owns the visible silhouette until
       a support path actually fails. */
    const offX=0,offY=0,offZ=0;
    const cw=cellW, ch=cellH, cd=cellD;
    const lx=ox-w/2+cellW*ix+cellW/2+offX;
    const ly=oy-h/2+cellH*iy+cellH/2+offY;
    const lz=oz-d/2+cellD*iz+cellD/2+offZ;
    const fragmentSeed=(ix+1)*17+(iy+1)*41+(iz+1)*73;
    const cellGeo=fracturedCellGeometry(V(cw,ch,cd),fragmentSeed,{
      x0:ix===0,x1:ix===nx-1,
      y0:iy===0,y1:iy===ny-1,
      z0:iz===0,z1:iz===nz-1,
      fractureKind:dObj.fractureKind
    });
    const cellMesh=new THREE.Mesh(cellGeo,mat);
    cellMesh.castShadow=false;cellMesh.receiveShadow=true;
    cellMesh.visible=false;
    cellMesh.userData={
      parent:dObj,kind:'cell',
      relPos:V(lx,ly,lz),
      size:V(cw,ch,cd),
      mass:Math.max(0.15,(opts.mass||1.2)*(cw*ch*cd)/(cellW*cellH*cellD)),
      gridX:ix,gridY:iy,gridZ:iz,
      supportCell:null,supportCells:[],braceCells:[],grounded:iy===0,released:false,fracturedVisual:true,
      impactDamage:0,climbProxy:false,fractureKind:dObj.fractureKind,
      voxelLoad:0,voxelSupportDistance:VOXEL_SUPPORT_MAX_DISTANCE,voxelUnstable:false
    };
    dObj.cells.push(cellMesh);
    cellGrid[ix][iy][iz]=cellMesh;
  }
  /* Build the load path from actual horizontal face overlap. Diagonal cells
     below only touch at a corner and cannot carry vertical load; counting them
     as supports made upper blocks hang in the air until an unrelated blast
     removed most of a floor. The rigid solver handles genuine side contacts
     after the vertical support is gone. */
  for(const c of dObj.cells){
    const u=c.userData;
    const supports=[];
    if(u.gridY>0){
      const support=cellGrid[u.gridX][u.gridY-1][u.gridZ];
      if(support)supports.push(support);
    }
    u.supportCells=supports;
    u.supportCell=supports[0]||null;
    /* Adjacent cells in the same course can carry a local breach by sharing
       load across their intact side faces. These are bracing members, not
       substitutes for the primary vertical support; full-collapse events can
       deliberately ignore them and propagate down the load path. */
    const braces=[];
    if(u.gridX>0)braces.push(cellGrid[u.gridX-1][u.gridY][u.gridZ]);
    if(u.gridX<dObj.grid.nx-1)braces.push(cellGrid[u.gridX+1][u.gridY][u.gridZ]);
    if(u.gridZ>0)braces.push(cellGrid[u.gridX][u.gridY][u.gridZ-1]);
    if(u.gridZ<dObj.grid.nz-1)braces.push(cellGrid[u.gridX][u.gridY][u.gridZ+1]);
    u.braceCells=braces.filter(Boolean);
  }
  dObj.cellGrid=cellGrid;
  dObj.nCells=dObj.cells.length;
  if(opts.cellShell)buildStructuralCellShell(dObj);
  destructibles.push(dObj);
  return dObj;
}

function makeDestructibleMesh(mesh, opts){
  opts=opts||{};
  const local=localBoundsOf(mesh);
  const size=local.getSize(V()),center=local.getCenter(V());
  const worldCenter=center.clone().applyMatrix4(mesh.matrixWorld);
  const w=size.x,h=size.y,d=size.z;
  const cx=worldCenter.x,cy=worldCenter.y,cz=worldCenter.z;
  removeOccluder(mesh);
  const pi=proxies.findIndex(p=>p.mesh===mesh); if(pi>=0)proxies.splice(pi,1);
  const si=standables.indexOf(mesh); if(si>=0)standables.splice(si,1);
  const bx=boxByRoot.get(mesh);
  if(bx){removePhysicsBox(bx);boxByRoot.delete(mesh);}
  return makeDestructible(w,h,d,cx,cy,cz, mesh.material, Object.assign({},opts,{root:mesh,localCenter:center}));
}

function removeStructuralRoot(dObj){
  if(dObj.fragmented)return dObj.rootMatrix;
  const root=dObj.root;
  root.updateMatrixWorld(true);
  const rootMatrix=root.matrixWorld.clone();
  /* Detach the root from physics first, then retire its render shell in favor
     of the already-authored cell field. Every unreleased cell stays at its
     exact original transform, so the visible handoff exposes local holes as
     pieces leave without changing a fragment's geometry on the impact frame. */
  root.userData=Object.assign({},root.userData,{surfaceDetached:true});
  if(dObj.groupShell){
    /* A compound prop owns its own authored child meshes. Retain that group in
       the scene and promote the child colliders to the static field; each
       child is retired only when its corresponding rigid fracture cell is
       released, so untouched sandbags never become a coarse replacement box. */
    const rootBox=boxByRoot.get(root);
    if(rootBox){
      removePhysicsBox(rootBox);
      boxByRoot.delete(root);
    }
    for(const record of dObj.groupShellPieces||[])
      if(!record.retired)addPhysicsBox(record.box);
    dObj.rootMatrix=rootMatrix;
    dObj.fragmented=true;
    dObj.rootHidden=false;
    return rootMatrix;
  }
  const pi=proxies.findIndex(p=>p.mesh===root);
  if(pi>=0)proxies.splice(pi,1);
  const si=standables.indexOf(root);
  if(si>=0)standables.splice(si,1);
  const bx=boxByRoot.get(root);
  if(bx){
    removePhysicsBox(bx);
    boxByRoot.delete(root);
  }
  removeOccluderMeshes(root);
  if(dObj.cylRef){
    const ci=cyls.indexOf(dObj.cylRef);
    if(ci>=0)cyls.splice(ci,1);
  }
  if(dObj.loRef){
    const li=proxies.findIndex(p=>p.mesh===dObj.loRef);
    if(li>=0)proxies.splice(li,1);
    const lsi=standables.indexOf(dObj.loRef);
    if(lsi>=0)standables.splice(lsi,1);
    scene.remove(dObj.loRef);
    if(dObj.loRef.geometry)dObj.loRef.geometry.dispose();
  }
  rebuildProxyLists();
  dObj.rootMatrix=rootMatrix;
  dObj.fragmented=true;
  if(dObj.surfaceShell){
    if(dObj.surfacePatchShell){
      /* The exact triangle patches are already the visible shell. Retire the
         coarse authored root now so the released rigid cells can own collision
         and raycasts without a hidden box or duplicate surface behind them. */
      hideDetachedStructuralRoot(dObj);
      return rootMatrix;
    }
    /* Keep the authored irregular surface visible as the masked render shell,
       but remove it from raycasts and physics so released cells become the
       authoritative collision field. */
    root.userData=Object.assign({},root.userData,{
      kind:'cellShell',surfaceDetached:true,shellState:dObj.cellShellState
    });
    root.visible=true;
    dObj.rootHidden=false;
    return rootMatrix;
  }
  /* The cell meshes were prepared before the impact. Removing the original
     shell here is a one-time render-source handoff, not a geometry mutation;
     revealFractureField keeps the intact cells in place and releases only the
     support-failed bodies. */
  hideDetachedStructuralRoot(dObj);
  return rootMatrix;
}

function hideDetachedStructuralRoot(dObj){
  if(!dObj||dObj.rootHidden)return;
  const root=dObj.root;
  removeOccluderMeshes(root);
  scene.remove(root);
  if(root.isMesh&&root.geometry)root.geometry.dispose();
  else if(root.traverse)root.traverse(n=>{if(n.isMesh&&n.geometry)n.geometry.dispose();});
  dObj.rootHidden=true;
  /* The structural shell remains the intact visual surface. Do not expose the
     entire pre-cooked cell field during the one-time render handoff; released
     cells and their local interior ring are revealed by the fracture pass. */
  for(const c of dObj.cells)c.visible=!!c.userData.released;
}

function maybeHideDetachedStructuralRoot(dObj){
  if(!dObj||dObj.groupShell||!dObj.fragmented||dObj.rootHidden||!dObj.nCells)return;
  /* Irregular authored surfaces should not turn into a coarse cell silhouette
     halfway through a collapse. Keep the original rock shell masked around the
     rigid pieces until its final cell releases; box buildings already use the
     continuous cell shell as their stable render source. */
  const ratio=dObj.surfaceShell?1:(dObj.destroyed?0.36:0.78);
  const threshold=Math.min(dObj.nCells,Math.max(1,Math.ceil(dObj.nCells*ratio)));
  if((dObj.releasedCount||0)>=threshold)hideDetachedStructuralRoot(dObj);
}

function retireStructuralDecoration(decoration){
  if(!decoration||decoration.retired)return;
  const mesh=decoration.mesh;
  if(mesh){
    mesh.visible=false;
    scene.remove(mesh);
    if(mesh.geometry)mesh.geometry.dispose();
  }
  decoration.retired=true;
}
function retireStructuralDecorationsForCell(dObj,cell){
  if(!dObj||!cell||!dObj.decorations)return;
  for(const decoration of dObj.decorations){
    if(!decoration.cell&&decoration.mesh)
      decoration.cell=structuralCellForPoint(dObj,decoration.mesh.position);
    if(decoration.cell===cell)retireStructuralDecoration(decoration);
  }
}
function registerStructuralExtra(dObj,mesh,kind,size,mass){
  if(!dObj||!mesh)return mesh;
  mesh.userData=Object.assign({},mesh.userData,{
    parent:dObj,kind,relPos:mesh.position.clone(),size:size.clone(),mass:mass||0.35,
    released:false,fractureQueued:false,
    fractureKind:kind==='roof'?'roof':dObj.fractureKind
  });
  const extraBox=boxes.find(box=>box.owner===mesh);
  if(extraBox)mesh.userData.fractureBox=extraBox;
  /* Attach the extra lazily. House construction runs before the shared
     structural projection vectors are initialized; resolving on the first
     real fracture keeps startup order independent of the physics helpers. */
  dObj.structuralExtras.push({mesh,cell:null,supportCells:null,requiredSupports:1,kind});
  /* The trim is still a walkable static ledge, but it should not remain a
     climb graph proxy once the supporting cell is released. The graph already
     has the wall surface, so keeping a second proxy here only creates stale
     holds during the fracture handoff. */
  const pi=proxies.findIndex(pr=>pr.mesh===mesh);
  if(pi>=0)proxies.splice(pi,1);
  return mesh;
}
function queueStructuralExtras(dObj,epicenter,blastForce,collapse){
  if(!dObj||!dObj.structuralExtras)return;
  for(const extra of dObj.structuralExtras){
    const mesh=extra.mesh;
    if(!mesh||mesh.userData.released||fractureQueueByMesh.has(mesh))continue;
    if(dObj.fracturePrepared&&!extra.supportCells)
      resolveStructuralExtraSupports(dObj,extra);
    const supports=extra.supportCells||(extra.cell?[extra.cell]:[]);
    if(!supports.length)continue;
    const live=supports.reduce((count,support)=>
      count+(support&&!support.userData.released?1:0),0);
    const required=Math.max(1,extra.requiredSupports||1);
    /* Only arm a roof/trim when its actual support margin has been crossed.
       This keeps decorative slabs out of the fracture queue during ordinary
       local damage while still allowing the next failed support to release a
       genuinely unstable piece. */
    if(live>=required)continue;
    mesh.userData.fractureQueued=true;
    const event={
      mesh,delay:0.06+Math.min(0.24,Math.max(0,mesh.position.distanceTo(epicenter))*0.018)+rand(0,0.035),
      epicenter,blastForce:Math.max(0.6,blastForce*0.42),directHit:false,
      forceCollapse:!!collapse,support:supports[0],supportCells:supports,
      requiredSupports:required
    };
    fractureQueue.push(event);fractureQueueByMesh.set(mesh,event);
  }
}

function queueFractureDependents(released,event){
  const parent=released&&released.userData&&released.userData.parent;
  if(!parent||!parent.cells)return;
  const voxelField=solveVoxelSupportField(parent);
  const forceCollapse=!!(event&&event.forceCollapse);
  const blastForce=Math.max(0.6,(event&&event.blastForce)||0.6);
  /* Passive cells are armed only when one of their actual load paths leaves.
     This keeps a supported building out of the per-frame fracture queue, while
     still letting a broken base or brace propagate a causal collapse on the
     next release wave. */
  for(const candidate of parent.cells){
    if(!candidate||candidate===released||candidate.userData.released)continue;
    const ud=candidate.userData;
    const depends=(ud.supportCells&&ud.supportCells.indexOf(released)>=0)||
      (ud.braceCells&&ud.braceCells.indexOf(released)>=0);
    const voxelIndex=voxelIndexForCell(parent,candidate);
    const voxelUnstable=!!(voxelField&&voxelIndex>=0&&voxelField.unstable[voxelIndex]);
    if(depends||voxelUnstable)
      queueFractureCell(parent,candidate,event.epicenter,blastForce*0.32,false,
        forceCollapse||voxelUnstable);
  }
  /* Roofs and trims use the same cell support graph, but live outside the cell
     array. Re-arm them through the existing helper so their real support is
     checked by the same release pass. */
  if(parent.structuralExtras)
    queueStructuralExtras(parent,event.epicenter,blastForce,forceCollapse);
}

function materializeFracture(dObj){
  if(dObj.fracturePrepared)return;
  const root=dObj.root;
  root.updateMatrixWorld(true);
  const rootMatrix=root.matrixWorld.clone();
  dObj.rootMatrix=rootMatrix;
  dObj.fracturePrepared=true;
  const rootWorldPos=V(),rootWorldQuat=new THREE.Quaternion(),rootWorldScale=V();
  rootMatrix.decompose(rootWorldPos,rootWorldQuat,rootWorldScale);
  for(const decoration of dObj.decorations||[]){
    if(decoration.cell||!decoration.mesh)continue;
    decoration.cell=structuralCellForPoint(dObj,decoration.mesh.position);
  }
  for(const extra of dObj.structuralExtras||[])
    if(!extra.cell)extra.cell=structuralCellForPoint(dObj,extra.mesh.position);
  for(const c of dObj.cells){
     /* Keep the original root rendered until cells are physically released.
        These hidden bodies already contain their final fractured geometry, so
        revealing one never mutates its shape on the impact frame. */
    c.visible=false;
    /* Keep load-bearing cells on the original material until they are released.
       Tinting/fading the whole field here made an intact remainder visibly
       dissolve before any support had failed. Released bodies receive their
       own material in activateChunk, at the same instant they gain velocity. */
    c.position.copy(c.userData.relPos).applyMatrix4(rootMatrix);
    /* relPos is in the intact root's local frame. Apply the root's complete
       world rotation to the cell as well, otherwise rotated ramps and grouped
       structures render one way but collide and settle as if they were flat. */
    c.quaternion.copy(rootWorldQuat);
    c.castShadow=true;
    scene.add(c);
    c.updateMatrixWorld(true);
    /* The intact cells are real static pieces immediately. A later blast can
       hit them, and the rigid solver receives each piece at the instant its
       structural support fails. Compound groups are the exception: their
       authored child colliders remain the intact static pieces until the
       matching cell releases, so an empty/generated bounding box never
       replaces the original prop. */
    c.userData.fractureBox=box3Of(c);
    c.userData.fractureBox.owner=c;
    if(dObj.groupShell){
      c.userData.staticColliderAdded=false;
    }else{
      addPhysicsBox(c.userData.fractureBox);
      c.userData.staticColliderAdded=true;
    }
    /* Hidden fracture cells stay out of raycast lists until the structural root
       is detached. Otherwise a prepared-but-unreleased cell can block a shot
       or ground probe while the intact shell is still the visible building. */
    c.userData.released=false;
    c.userData.fractureQueued=false;
  }
}

function revealFractureField(dObj,epicenter,blastForce){
  if(!dObj||dObj.fieldRevealed)return;
  /* The handoff happens once, at the first real release. Box assets already
     render their removable facade panels; irregular assets keep their authored
     surface until this same moment. */
  if(!dObj.rootHidden)removeStructuralRoot(dObj);
  /* Any rubble that was resting on the intact root has lost its support at
     this exact handoff. Wake it with the same impact context so gravity and
     contact resolution decide the next motion instead of leaving a floating
     static shard behind. */
  if(dObj.root)wakeSettledDependents(dObj.root,epicenter||dObj.root.position,
    Math.max(0.6,blastForce||0.6));
  if(!dObj.surfaceShell&&dObj.cellShell){
    /* Box panels are visible from startup. Keep this idempotent pass for the
       fracture handoff so panels exposed after a structural break are restored
       to the render and standable lists without creating a new facade. */
    const state=dObj.cellShellState,intact=state&&state.intactShell;
    if(intact&&!state.intactShellRetired){
      state.intactShellRetired=true;
      intact.visible=false;
      removeOccluder(intact);
      const si=standables.indexOf(intact);if(si>=0)standables.splice(si,1);
      if(intact.parent)intact.parent.remove(intact);
      if(intact.geometry)intact.geometry.dispose();
      if(intact.material)intact.material.dispose();
    }
    /* Box shell panels are already visible and already present in both lists
       from construction. Do not scan those lists again during the first
       fracture; local panel removal keeps the membership exact. */
    if(state&&state.cellShellPieces)
      for(const piece of state.cellShellPieces.values())piece.visible=true;
  }
  dObj.fieldRevealed=true;
  /* Shell-backed structures keep the authored surface as the intact visual
     surface. Box structures keep their exact visible panels. Unreleased cells
     still provide exact raycasts and collision support, while released cells
     become one-to-one rigid bodies instead of a facade-wide geometry swap. */
  const shellBacked=!!dObj.cellShell||!!dObj.groupShell;
  for(const c of dObj.cells){
    /* Unreleased cells are the static remainder. Shell-backed surfaces show
       them only after a neighboring break exposes the local interior. */
    c.visible=shellBacked?!!c.userData.released:true;
    if(!dObj.groupShell&&!c.userData.staticColliderAdded){
      addPhysicsBox(c.userData.fractureBox);
      c.userData.staticColliderAdded=true;
    }
    /* The visible shell panels already own the intact render/raycast surface.
       Keep unreleased cells out of these lists until a local breach exposes
       them; released cells are added by activateChunk, and an exposed interior
       cell is added by exposeCellClimbNeighbors. */
    if(c.userData.released){
      if(standables.indexOf(c)<0)standables.push(c);
      addOccluder(c);
    }
    setFractureClimbProxy(c,!c.userData.released&&dObj.cellClimbEnabled);
  }
}

function fractureDelay(c,dObj,epicenter){
  const localPos=c.userData.relPos;
  const dist=c.position.distanceTo(epicenter);
  const heightT=Math.max(0,Math.min(1,(localPos.y+dObj.size.y*0.5)/Math.max(0.01,dObj.size.y)));
  /* A blast has a brief propagation wave, not a one-second scripted queue.
     Once the wave reaches a cell, support loss and gravity determine its
     motion; the timing here stays below a perceptible settle pause. */
  return 0.012+Math.min(0.09,dist*0.008)+heightT*0.025+rand(0,0.018);
}
function supportFailureDelay(c,dObj,epicenter,collapse){
  const localPos=c.userData.relPos;
  const dist=c.position.distanceTo(epicenter);
  const heightT=Math.max(0,Math.min(1,(localPos.y+dObj.size.y*0.5)/Math.max(0.01,dObj.size.y)));
  /* A released support transmits failure as a short structural wave. Keep the
     delay below a tenth of a second so the handoff remains responsive, while
     allowing adjacent load paths to fail in visible sequence instead of the
     whole facade changing on one render frame. */
  return (collapse?0.018:0.028)+Math.min(0.06,dist*0.004)+heightT*0.014+rand(0,0.012);
}

function queueFractureCell(dObj,c,epicenter,blastForce,directHit,collapse){
  const ud=c.userData;
  if(ud.released)return false;
  const delay=directHit?fractureDelay(c,dObj,epicenter):
    supportFailureDelay(c,dObj,epicenter,collapse);
  const existing=fractureQueueByMesh.get(c);
  if(existing){
    if(collapse)existing.forceCollapse=true;
    if(directHit){
      existing.directHit=true;
      existing.forceCollapse=existing.forceCollapse||!!collapse;
      existing.delay=Math.min(existing.delay,delay);
      existing.epicenter=epicenter;
      existing.blastForce=Math.max(existing.blastForce,blastForce);
    }
    return false;
  }
  /* Foundation cells have an implicit infinite ground support. Do not leave a
     never-ending passive event in the queue for them; a direct hit or an
     explicit full-collapse event still creates a real release event. */
  if(!directHit&&!collapse&&(ud.grounded||!ud.supportCells||ud.supportCells.length===0))return false;
  ud.fractureQueued=true;
  const event={
    mesh:c,delay,epicenter,blastForce,directHit:!!directHit,
    forceCollapse:!!collapse,
    support:ud.supportCell,
    supportCells:ud.supportCells||[],
    braceCells:ud.braceCells||[],
    grounded:!!ud.grounded,
    requiredSupports:collapse?1:((ud.braceCells&&ud.braceCells.length)?2:1)
  };
  fractureQueue.push(event);
  fractureQueueByMesh.set(c,event);
  return true;
}

function fractureBuildingAt(dObj,epicenter,blastForce,fullCollapse){
  if(dObj&&dObj.voxelManaged){
    voxelPhysics.blastStructure(dObj.voxelStructure,epicenter,
      Math.max(fullCollapse?8:1,blastForce||1));
    return;
  }
  materializeFracture(dObj);
  solveVoxelSupportField(dObj);
  /* A normal hit should create a local breach; only a catastrophic structural
     failure gets the wider initial release wave. The remaining cells still
     follow their real support graph, so a damaged wall can collapse farther
     when its load path actually disappears. */
  const directRadius=fullCollapse
    ?Math.max(1.2,Math.min(5.2,2.1+blastForce*0.2))
    :Math.max(0.85,Math.min(1.55,0.95+blastForce*0.05));
  let nearest=null,nearestDist=Infinity,directCount=0;
  for(const c of dObj.cells){
    const ud=c.userData;
    if(ud.released)continue;
    const dist=ud.fractureBox?distanceToBox(epicenter,ud.fractureBox):c.position.distanceTo(epicenter);
    if(dist<nearestDist){nearestDist=dist;nearest=c;}
    if(dist<=directRadius){
      if(queueFractureCell(dObj,c,epicenter,blastForce,true,fullCollapse))directCount++;
    }
  }
  if(!directCount&&nearest)queueFractureCell(dObj,nearest,epicenter,blastForce,true);
  /* Partial damage never polls untouched cells. The released cell wakes only
     its actual dependents through queueFractureDependents, so an ordinary hit
     cannot create a hidden per-frame settle queue. A catastrophic collapse
     seeds only the nearby foundation load path; the same dependency wave then
     carries failure through the actual columns and braces instead of launching
     the whole building as a bag of independent projectiles. */
  if(fullCollapse){
    const seedRadius=Math.max(1.5,Math.min(3.6,directRadius*0.62+blastForce*0.05));
    let seedCount=0,nearestGround=null,nearestGroundDist=Infinity;
    for(const c of dObj.cells){
      if(!c.userData.grounded)continue;
      const dist=c.userData.fractureBox?distanceToBox(epicenter,c.userData.fractureBox):
        c.position.distanceTo(epicenter);
      if(dist<nearestGroundDist){nearestGroundDist=dist;nearestGround=c;}
      if(dist<=seedRadius){
        queueFractureCell(dObj,c,epicenter,Math.min(3,blastForce*0.32),false,true);
        seedCount++;
      }
    }
    if(seedCount===0&&nearestGround)
      queueFractureCell(dObj,nearestGround,epicenter,Math.min(3,blastForce*0.32),false,true);
  }
}

function shatterBuilding(dObj,epicenter,blastForce){
  if(dObj&&dObj.voxelManaged){
    if(dObj.destroyed)return;
    dObj.alive=false;dObj.destroyed=true;
    voxelPhysics.blastStructure(dObj.voxelStructure,epicenter,Math.max(8,blastForce||8));
    return;
  }
  if(dObj.destroyed)return;
  dObj.alive=false;
  dObj.destroyed=true;
  fractureBuildingAt(dObj,epicenter,blastForce,true);
}

const voxelProxyMaterial=new THREE.MeshBasicMaterial({
  transparent:true,opacity:0,colorWrite:false,depthWrite:false,side:THREE.DoubleSide
});
function registerVoxelBuilding(dObj,x,z,w,d,h,mat,options){
  options=options||{};
  if(!dObj||dObj.voxelManaged)return dObj&&dObj.voxelStructure;
  const root=dObj.root;
  /* makeDestructible pre-cooks a legacy removable-panel shell before this
     object is promoted to the voxel solver. That shell used to remain visible
     on top of the voxel field, so cells were physically removed (and debris
     spawned) behind an apparently indestructible wall. Retire the duplicate
     render/raycast surface now; the InstancedMesh below becomes the only
     authoritative facade. */
  const legacyShell=dObj.cellShell;
  if(legacyShell&&legacyShell!==root){
    const legacyMeshes=[];
    legacyShell.traverse(node=>{if(node.isMesh)legacyMeshes.push(node);});
    for(const mesh of legacyMeshes){
      removeOccluder(mesh);
      const standIndex=standables.indexOf(mesh);
      if(standIndex>=0)standables.splice(standIndex,1);
      const proxyIndex=proxies.findIndex(proxy=>proxy.mesh===mesh);
      if(proxyIndex>=0)proxies.splice(proxyIndex,1);
      if(mesh.geometry)mesh.geometry.dispose();
    }
    if(legacyShell.parent)legacyShell.parent.remove(legacyShell);
    const shellState=dObj.cellShellState;
    if(shellState){
      shellState.retired=true;
      if(shellState.cellShellPieces)shellState.cellShellPieces.clear();
      shellState.holeCells.length=0;
    }
    dObj.cellShell=null;
  }
  /* Compound props put their authored child meshes in the occluder list. Once
     their voxel mask takes over, remove every child as well as the root so an
     invisible scaffold plank or sandbag can never keep blocking a shot. */
  removeOccluderMeshes(root);
  const rootStandable=standables.indexOf(root);
  if(rootStandable>=0)standables.splice(rootStandable,1);
  for(let i=proxies.length-1;i>=0;i--){
    const mesh=proxies[i].mesh;
    if(mesh===root||(root&&!root.isMesh&&mesh&&mesh.parent===root))proxies.splice(i,1);
  }
  const rootBox=boxByRoot.get(root)||dObj.rootBox;
  if(rootBox)removePhysicsBox(rootBox);
  boxByRoot.delete(root);
  if(root.isMesh)root.material=voxelProxyMaterial;
  root.castShadow=false;root.receiveShadow=false;root.visible=false;
  for(const extra of dObj.structuralExtras||[]){
    const mesh=extra.mesh;if(!mesh)continue;
    const box=mesh.userData&&mesh.userData.fractureBox;
    if(box)removePhysicsBox(box);
    removeOccluder(mesh);
    const standIndex=standables.indexOf(mesh);if(standIndex>=0)standables.splice(standIndex,1);
    mesh.visible=false;scene.remove(mesh);
  }
  const structure=voxelPhysics.registerBuilding({
    dObj,x,y:options.y,z,width:w,depth:d,height:h,color:mat&&mat.color?mat.color.getHex():0x999999,
    voxelSize:options.voxelSize||0.68,
    materialKind:options.materialKind||dObj.fractureKind||'masonry',
    shape:options.shape||'shell',occupancy:options.occupancy,colorAt:options.colorAt,
    strength:options.strength,cellType:options.cellType,anchorBase:options.anchorBase,
    simulateLoads:options.simulateLoads
  });
  dObj.voxelManaged=true;dObj.voxelStructure=structure;
  structure.mesh.userData.parent=dObj;
  root.userData=Object.assign({},root.userData,{voxelStructure:structure});
  if(options.climb!==false&&dObj.cellClimbEnabled!==false){
    proxies.push({mesh:structure.mesh,grip:options.grip===false?0:1});
  }
  return structure;
}

const compoundVoxelPoint=V(),compoundVoxelLocal=V();
/* Convert authored compound geometry to a voxel mask while it is still intact.
   Sampling each child's local bounds preserves rotations and gaps, and a small
   overlap pad guarantees that thin poles/planks receive at least one voxel. */
function promoteCompoundToVoxels(dObj,root,options){
  options=options||{};
  root.updateMatrixWorld(true);
  const bounds=box3Of(root),size=bounds.getSize(V()),center=bounds.getCenter(V());
  const parts=[];
  root.traverse(mesh=>{
    if(!mesh.isMesh||!mesh.geometry)return;
    if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();
    const color=mesh.material&&mesh.material.color?mesh.material.color.clone():
      new THREE.Color(options.color||0x999999);
    parts.push({
      box:mesh.geometry.boundingBox.clone(),inverse:mesh.matrixWorld.clone().invert(),color
    });
  });
  const pad=options.samplePadding===undefined?(options.voxelSize||0.2)*0.34:
    options.samplePadding;
  const samplePart=(lx,ly,lz)=>{
    compoundVoxelPoint.set(center.x+lx,center.y+ly,center.z+lz);
    for(const part of parts){
      compoundVoxelLocal.copy(compoundVoxelPoint).applyMatrix4(part.inverse);
      if(compoundVoxelLocal.x>=part.box.min.x-pad&&compoundVoxelLocal.x<=part.box.max.x+pad&&
         compoundVoxelLocal.y>=part.box.min.y-pad&&compoundVoxelLocal.y<=part.box.max.y+pad&&
         compoundVoxelLocal.z>=part.box.min.z-pad&&compoundVoxelLocal.z<=part.box.max.z+pad)return part;
    }
    return null;
  };
  dObj.worldBox=bounds.clone();dObj.rootBox=bounds.clone();
  dObj.pos.copy(center);dObj.size.copy(size);
  const fallback=parts[0]&&parts[0].color||new THREE.Color(options.color||0x999999);
  return registerVoxelBuilding(dObj,center.x,center.z,size.x,size.z,size.y,
    options.material||root.material||M.stone,{
      y:center.y,shape:'mask',voxelSize:options.voxelSize||0.2,
      materialKind:options.materialKind,cellType:options.cellType,
      strength:options.strength,anchorBase:options.anchorBase,
      simulateLoads:options.simulateLoads,
      climb:options.climb,grip:options.grip,
      occupancy:(lx,ly,lz)=>!!samplePart(lx,ly,lz),
      colorAt:(lx,ly,lz)=>{const part=samplePart(lx,ly,lz);return part?part.color:fallback;}
    });
}
