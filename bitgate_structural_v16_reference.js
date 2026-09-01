/* Verbatim inline JavaScript pulled from https://power-pastry-efk6g.shipped.page/
 * Captured 2026-09-01 as a local physics/voxel reference. This bundle is
 * intentionally not loaded by the game; compatible systems are adapted in
 * index.html so climbing, weapons, and the existing player stay intact.
 */



let W=64,H=56,D=64,WD=W*D,N=W*H*D;
let alive,doomed,str,load,inflight,dmg,baseC,lastU,epochM,overT;
let freeH,slMul,sd,grnd,gdist,matId;
let xOf,yOf,zOf,aliveIdx,posInAlive,stack,compBuf,compMark,basin,wScore,wHops;

// The grid itself scales with the resolution slider, so every per-voxel
// buffer has to be (re)allocated when the world rebuilds at a new size
function allocateGrid(){
  WD=W*D;N=W*H*D;
  alive=new Uint8Array(N);doomed=new Uint8Array(N);str=new Float32Array(N);
  load=new Float32Array(N);inflight=new Float32Array(N);dmg=new Float32Array(N);
  baseC=new Float32Array(N*3);lastU=new Float32Array(N);epochM=new Int32Array(N);
  overT=new Float32Array(N);
  freeH=new Uint8Array(N);slMul=new Float32Array(N);sd=new Uint8Array(N);
  grnd=new Uint8Array(N);gdist=new Uint8Array(N);matId=new Uint8Array(N);
  xOf=new Uint8Array(N);yOf=new Uint8Array(N);zOf=new Uint8Array(N);
  for(let y=0;y<H;y++)for(let z=0;z<D;z++)for(let x=0;x<W;x++){const i=(y*D+z)*W+x;xOf[i]=x;yOf[i]=y;zOf[i]=z;}
  aliveIdx=new Int32Array(N);posInAlive=new Int32Array(N);
  stack=new Int32Array(N);compBuf=new Int32Array(N);
  compMark=new Int32Array(N);basin=new Int32Array(N);
  wScore=new Float32Array(N);wHops=new Int32Array(N);
}
allocateGrid();
const I=(x,y,z)=>(y*D+z)*W+x;

const T={
  shearFrac:0.4,premBase:1.03,premHop:0.05,hopMax:8,
  soft:0.7,creepOn:0.8,creepK:1.4,failK:6.0,healU:0.5,healK:0.015,
  fuseU:1.02,fuseT:0.1,
  overhangK:1.6,shockK:1.1,slenderH:4,deathCap:220,passes:2,
  crushU:2.2,cascadeIters:6,
  softLand:9,rollMax:14,shatterRef:24,rubbleStr:55,solidAge:2.2,
  toppleMargin:0.45,toppleOutHard:2.5,toppleMinN:60,toppleMinH:6,toppleGain:2.6,toppleOmegaMax:2.2,
  airBreak:9,shedK:6,shedMin:24,
  spallOn:0.15,spallK:0.07,spallSpread:0.05,
};
const MAT={wall:360,glass:360,slab:40,core:380,bridge:120,vault:140,pent:30};

let aliveN=0,needSort=true,dirtyTopo=true,voxDirty=true,epoch=0,shake=0,tNow=0,mode=2;
let strScale=1;
const tmpC=new THREE.Color();

function hash01(i){
  let h=Math.imul(i^0x9e3779b9,2654435761)>>>0;
  h^=h>>>15;h=Math.imul(h,2246822519)>>>0;h^=h>>>13;
  return (h>>>0)/4294967296;
}

function addVox(x,y,z,s,r,g,b){
  const i=I(x,y,z);if(alive[i])return;
  alive[i]=1;str[i]=s>1e8?s:s*strScale*(0.8+0.4*hash01(i));slMul[i]=1;overT[i]=0;
  matId[i]=(s===MAT.wall||s===MAT.glass)?1:0;
  baseC[i*3]=r;baseC[i*3+1]=g;baseC[i*3+2]=b;
  posInAlive[i]=aliveN;aliveIdx[aliveN++]=i;
}

function tower(x0,z0,w,d,h,over){
  for(let y=1;y<=h;y++){
    const win=y%3===1,slab=y%6===0;
    const cx=x0+(w>>1),cz=z0+(d>>1);
    for(let x=x0;x<x0+w;x++)for(let z=z0;z<z0+d;z++){
      const wall=x===x0||x===x0+w-1||z===z0||z===z0+d-1;
      const core=(x===cx||x===cx-1)&&(z===cz||z===cz-1);
      if(core)addVox(x,y,z,MAT.core,0.55,0.6,0.72);
      else if(wall){if(win)addVox(x,y,z,MAT.glass,0.35,0.45,0.62);else addVox(x,y,z,MAT.wall,0.72,0.74,0.78);}
      else if(slab)addVox(x,y,z,MAT.slab,0.5,0.5,0.55);
    }
  }
  if(over)for(let y=h-2;y<=h;y++)for(let x=x0+w;x<x0+w+3;x++)for(let z=z0;z<z0+d;z++){
    if(x===x0+w+2||y===h-2)addVox(x,y,z,MAT.pent,0.72,0.6,0.4);
  }
}

// World regen: the slider is RESOLUTION — same city, same layout, but the
// grid and every building scale together, so 2x means finer voxels on the
// same towers, not more towers. Everything sim-related resets so no ghost
// state leaks between builds.
let initialStruct=1,curRes=1;
function buildWorld(res){
  curRes=res;
  // Load per load-bearing voxel scales ~res^2 (2x layers x 2x mass per wall
  // cell), so materials harden by the same factor or max-res cities crush
  // themselves under their own weight
  strScale=res*res;
  const nW=Math.round(64*res),nH=Math.round(56*res),nD=Math.round(64*res);
  if(nW!==W||nH!==H||nD!==D){W=nW;H=nH;D=nD;allocateGrid();makeVoxMesh();}
  alive.fill(0);doomed.fill(0);str.fill(0);load.fill(0);inflight.fill(0);dmg.fill(0);
  lastU.fill(0);epochM.fill(0);overT.fill(0);freeH.fill(0);slMul.fill(1);
  grnd.fill(0);gdist.fill(0);sd.fill(0);matId.fill(0);
  aliveN=0;activeN=0;stressKill.length=0;
  for(let c=0;c<MAXC;c++){cOn[c]=0;cN[c]=0;}
  needSort=true;dirtyTopo=true;voxDirty=true;anyDeath=false;tipKey='';shake=0;

  const S=(v)=>Math.max(1,Math.round(v*res));

  // Bedrock
  for(let x=0;x<W;x++)for(let z=0;z<D;z++){const c=((x+z)&1)?0.13:0.16;addVox(x,0,z,1e9,c,c+0.01,c+0.05);}

  tower(S(14),S(26),S(12),S(12),S(44),false);
  tower(S(40),S(26),S(10),S(10),S(34),true);
  // Skybridge between the towers
  for(let x=S(26);x<S(40);x++)for(let z=S(30);z<S(32);z++)for(let y=S(28);y<S(30);y++)addVox(x,y,z,MAT.bridge,0.85,0.55,0.25);

  // Freestanding vault
  for(let y=1;y<=S(10);y++)for(let z=S(13);z<S(15);z++)for(const lx of[S(26),S(27),S(36),S(37)])addVox(lx,y,z,MAT.vault,0.8,0.68,0.5);
  for(let k=0;k<=S(4);k++)for(let x=S(26)+k;x<=S(37)-k;x++)for(let z=S(13);z<S(15);z++)addVox(x,S(11)+k,z,MAT.vault,0.82,0.7,0.52);

  initialStruct=Math.max(1,aliveN-WD);
  voxcount.textContent=(aliveN-WD).toLocaleString()+' voxels · '+res.toFixed(1)+'x';

  // Reframe the view for the new world scale
  camera.position.set(95*res,72*res,95*res);
  controls.target.set(32*res,16*res,28*res);
  scene.fog.near=160*res;scene.fog.far=420*res;
  ground.position.set(W/2,-0.02,D/2);
  sun.position.set(90*res,130*res,50*res);
  const sh=95*res;
  sun.shadow.camera.left=-sh;sun.shadow.camera.right=sh;
  sun.shadow.camera.top=sh;sun.shadow.camera.bottom=-sh;
  sun.shadow.camera.far=420*res;
  sun.shadow.camera.updateProjectionMatrix();
  refreshStatic();
}

function forNb(i,fn){
  const x=xOf[i],y=yOf[i],z=zOf[i];
  if(x+1<W)fn(i+1);if(x>0)fn(i-1);
  if(z+1<D)fn(i+W);if(z>0)fn(i-W);
  if(y+1<H)fn(i+WD);if(y>0)fn(i-WD);
}

const effStr=(i)=>str[i]>1e8?str[i]:str[i]*(1-T.soft*Math.min(dmg[i],1))*slMul[i];

// Support-distance field: lateral hops to nearest vertically-supported voxel.
// Load only ever routes down this gradient, which makes routing acyclic.
function computeSD(){
  sd.fill(255);
  let qs=0,qe=0;
  for(let a=0;a<aliveN;a++){
    const i=aliveIdx[a];
    if(doomed[i]||yOf[i]===0)continue;
    const b=i-WD;
    if(alive[b]&&!doomed[b]){sd[i]=0;stack[qe++]=i;}
  }
  while(qs<qe){
    const i=stack[qs++],nd=sd[i]+1;
    if(nd>=254)continue;
    const x=xOf[i],z=zOf[i];
    if(x+1<W){const n=i+1;if(alive[n]&&!doomed[n]&&sd[n]===255){sd[n]=nd;stack[qe++]=n;}}
    if(x>0){const n=i-1;if(alive[n]&&!doomed[n]&&sd[n]===255){sd[n]=nd;stack[qe++]=n;}}
    if(z+1<D){const n=i+W;if(alive[n]&&!doomed[n]&&sd[n]===255){sd[n]=nd;stack[qe++]=n;}}
    if(z>0){const n=i-W;if(alive[n]&&!doomed[n]&&sd[n]===255){sd[n]=nd;stack[qe++]=n;}}
  }
  grnd.fill(0);gdist.fill(255);
  let ge=0;
  for(let z=0;z<D;z++)for(let x=0;x<W;x++){
    const i=I(x,0,z);
    if(alive[i]&&!doomed[i]){grnd[i]=1;gdist[i]=0;stack[ge++]=i;}
  }
  let gs=0;
  while(gs<ge){
    const i=stack[gs++],x=xOf[i],y=yOf[i],z=zOf[i];
    if(y+1<H){const n=i+WD;if(alive[n]&&!doomed[n]&&!grnd[n]){grnd[n]=1;gdist[n]=0;stack[ge++]=n;}}
    if(x+1<W){const n=i+1;if(alive[n]&&!doomed[n]&&!grnd[n]){grnd[n]=1;gdist[n]=0;stack[ge++]=n;}}
    if(x>0){const n=i-1;if(alive[n]&&!doomed[n]&&!grnd[n]){grnd[n]=1;gdist[n]=0;stack[ge++]=n;}}
    if(z+1<D){const n=i+W;if(alive[n]&&!doomed[n]&&!grnd[n]){grnd[n]=1;gdist[n]=0;stack[ge++]=n;}}
    if(z>0){const n=i-W;if(alive[n]&&!doomed[n]&&!grnd[n]){grnd[n]=1;gdist[n]=0;stack[ge++]=n;}}
  }
  for(let q=0;q<ge;q++){
    const i=stack[q],nd=gdist[i]+1;
    if(nd>=254)continue;
    forNb(i,n=>{if(alive[n]&&!doomed[n]&&gdist[n]===255){gdist[n]=nd;stack[ge++]=n;}});
  }
}

function solve(dt){
  if(dirtyTopo){computeSD();dirtyTopo=false;}
  if(needSort){
    aliveIdx.subarray(0,aliveN).sort((a,b)=>yOf[b]-yOf[a]);
    for(let a=0;a<aliveN;a++)posInAlive[aliveIdx[a]]=a;
    needSort=false;
  }
  for(let p=0;p<T.passes;p++){
    for(let a=0;a<aliveN;a++){
      const i=aliveIdx[a];
      if(doomed[i]){inflight[i]=0;load[i]=0;continue;}
      const L=1+inflight[i];inflight[i]=0;
      if(p===T.passes-1)load[i]=L;
      const y=yOf[i];if(y===0)continue;

      if(p===0){
        // Slenderness: laterally isolated vertical runs buckle (Euler-ish)
        const x=xOf[i],z=zOf[i];
        let lat=0;
        if(x+1<W&&alive[i+1]&&!doomed[i+1])lat++;
        if(x>0&&alive[i-1]&&!doomed[i-1])lat++;
        if(z+1<D&&alive[i+W]&&!doomed[i+W])lat++;
        if(z>0&&alive[i-W]&&!doomed[i-W])lat++;
        const above=i+WD,hasAbove=y+1<H&&alive[above]&&!doomed[above];
        freeH[i]=lat<=1?(hasAbove?freeH[above]+1:1):0;
        const fh=freeH[i]/T.slenderH;slMul[i]=1/(1+fh*fh);
      }

      const b=i-WD;
      if(alive[b]&&!doomed[b]&&grnd[b]&&grnd[i]){inflight[b]+=L;continue;}
      if(!grnd[i]){
        const gd=gdist[i];
        if(gd<255){
          let q0=-1,q1=-1,q2=-1,q3=-1,q4=-1,q5=-1,qn=0;
          const x2=xOf[i],z2=zOf[i];
          const tryQ=(m)=>{
            if(!alive[m]||doomed[m]||(!grnd[m]&&gdist[m]>=gd))return;
            qn++;
            if(q0<0)q0=m;else if(q1<0)q1=m;else if(q2<0)q2=m;
            else if(q3<0)q3=m;else if(q4<0)q4=m;else q5=m;
          };
          if(x2+1<W)tryQ(i+1);if(x2>0)tryQ(i-1);
          if(z2+1<D)tryQ(i+W);if(z2>0)tryQ(i-W);
          if(y+1<H)tryQ(i+WD);if(y>0)tryQ(i-WD);
          if(qn){
            const sh=L/qn;
            if(q0>=0)inflight[q0]+=sh;if(q1>=0)inflight[q1]+=sh;
            if(q2>=0)inflight[q2]+=sh;if(q3>=0)inflight[q3]+=sh;
            if(q4>=0)inflight[q4]+=sh;if(q5>=0)inflight[q5]+=sh;
            continue;
          }
        }
        dmg[i]+=(L/effStr(i))*T.overhangK*dt;continue;
      }
      const x=xOf[i],z=zOf[i],mySd=sd[i];
      const eff=effStr(i);
      // Load refuses to detour through much weaker material when a
      // comparable-strength path exists, so walls can't shed their
      // columns across paper floors
      let c0=-1,c1=-1,c2=-1,c3=-1,cn=0;
      for(let tier=0;tier<2&&cn===0;tier++){
        const strongOnly=tier===0,minE=eff*0.5;
        if(x+1<W){const n=i+1;if(alive[n]&&!doomed[n]&&sd[n]<mySd&&(!strongOnly||effStr(n)>=minE)){c0=n;cn++;}}
        if(x>0){const n=i-1;if(alive[n]&&!doomed[n]&&sd[n]<mySd&&(!strongOnly||effStr(n)>=minE)){c1=n;cn++;}}
        if(z+1<D){const n=i+W;if(alive[n]&&!doomed[n]&&sd[n]<mySd&&(!strongOnly||effStr(n)>=minE)){c2=n;cn++;}}
        if(z>0){const n=i-W;if(alive[n]&&!doomed[n]&&sd[n]<mySd&&(!strongOnly||effStr(n)>=minE)){c3=n;cn++;}}
      }
      if(!cn){dmg[i]+=(L/eff)*T.overhangK*dt;continue;}
      const cap=eff*T.shearFrac,tr=Math.min(L,cap);
      const prem=T.premBase+T.premHop*Math.min(mySd,T.hopMax);
      const sh=tr/cn+(prem-1);
      if(c0>=0)inflight[c0]+=sh;if(c1>=0)inflight[c1]+=sh;
      if(c2>=0)inflight[c2]+=sh;if(c3>=0)inflight[c3]+=sh;
      const excess=L-tr;
      if(excess>0)dmg[i]+=(excess/eff)*T.overhangK*dt;
    }
  }
}

function kill(i){
  alive[i]=0;load[i]=0;dmg[i]=0;inflight[i]=0;doomed[i]=0;overT[i]=0;
  const p=posInAlive[i],l=aliveIdx[--aliveN];
  aliveIdx[p]=l;posInAlive[l]=p;
  needSort=true;dirtyTopo=true;voxDirty=true;
}

// Debris pool — tiered scales: full block 1.0, chunk 0.5, shard 0.25
const MAXD=9000;
const px=new Float32Array(MAXD),py=new Float32Array(MAXD),pz=new Float32Array(MAXD),
vx=new Float32Array(MAXD),vy=new Float32Array(MAXD),vz=new Float32Array(MAXD),
rx=new Float32Array(MAXD),ry=new Float32Array(MAXD),rz=new Float32Array(MAXD),
wx=new Float32Array(MAXD),wy=new Float32Array(MAXD),wz=new Float32Array(MAXD),
sc=new Float32Array(MAXD),ms=new Float32Array(MAXD),age=new Float32Array(MAXD),
frozen=new Uint8Array(MAXD);
let activeN=0,steal=0,debrisColorDirty=false;

function slot(){
  if(activeN<MAXD)return activeN++;
  // Pool full: prefer recycling something already asleep
  for(let p=0;p<48;p++){steal=(steal+1)%MAXD;if(frozen[steal])return steal;}
  steal=(steal+1)%MAXD;return steal;
}

function spawnDebris(x,y,z,vx0,vy0,vz0,m,s,r,g,b){
  const k=slot();
  px[k]=x;py[k]=y;pz[k]=z;vx[k]=vx0;vy[k]=vy0;vz[k]=vz0;
  rx[k]=Math.random()*6;ry[k]=Math.random()*6;rz[k]=Math.random()*6;
  wx[k]=(Math.random()-0.5)*8;wy[k]=(Math.random()-0.5)*8;wz[k]=(Math.random()-0.5)*8;
  sc[k]=s;ms[k]=m;age[k]=0;frozen[k]=0;
  debrisMesh.setColorAt(k,tmpC.setRGB(r,g,b));debrisColorDirty=true;
  return k;
}

function removeDebris(k){
  const l=--activeN;
  if(k!==l){
    px[k]=px[l];py[k]=py[l];pz[k]=pz[l];vx[k]=vx[l];vy[k]=vy[l];vz[k]=vz[l];
    rx[k]=rx[l];ry[k]=ry[l];rz[k]=rz[l];wx[k]=wx[l];wy[k]=wy[l];wz[k]=wz[l];
    sc[k]=sc[l];ms[k]=ms[l];age[k]=age[l];frozen[k]=frozen[l];
    const col=debrisMesh.instanceColor;
    debrisMesh.setColorAt(k,tmpC.setRGB(col.getX(l),col.getY(l),col.getZ(l)));
    debrisColorDirty=true;
  }
}

// A destroyed voxel becomes debris sized by impact power:
// low = whole block, mid = 1/2 chunks, high = straight to 1/4 shards
function voxelDebris(i,power,dx,dy,dz){
  const cx=xOf[i]+0.5,cy=yOf[i]+0.5,cz=zOf[i]+0.5;
  const r=baseC[i*3],g=baseC[i*3+1],b=baseC[i*3+2];
  if(power>=0.62){
    for(let s=0;s<6;s++){
      spawnDebris(cx+(Math.random()-0.5)*0.6,cy+(Math.random()-0.5)*0.6,cz+(Math.random()-0.5)*0.6,
        dx*(6+16*power)+(Math.random()-0.5)*5,dy*(6+16*power)+2+Math.random()*3,dz*(6+16*power)+(Math.random()-0.5)*5,
        0.08,0.25,r,g,b);
    }
  }else if(power>=0.3){
    for(let s=0;s<4;s++){
      spawnDebris(cx+(Math.random()-0.5)*0.5,cy+(Math.random()-0.5)*0.5,cz+(Math.random()-0.5)*0.5,
        dx*(3+8*power)+(Math.random()-0.5)*3,dy*(3+8*power)+1+Math.random()*2,dz*(3+8*power)+(Math.random()-0.5)*3,
        0.3,0.5,r,g,b);
    }
  }else{
    spawnDebris(cx,cy,cz,dx*1.5+(Math.random()-0.5)*1.5,-0.5-Math.random(),dz*1.5+(Math.random()-0.5)*1.5,
      1,0.96,r,g,b);
  }
}

let anyDeath=false,tipKey='',tipSince=0;
const stressKill=[];

function killVoxel(i,power,dx,dy,dz){
  if(!alive[i]||doomed[i]||str[i]>1e8)return;
  const Li=load[i];
  // Crack shock: loaded neighbors of a loaded corpse take the hit, idle ones shrug it off
  forNb(i,n=>{
    if(alive[n]&&!doomed[n]&&str[n]<1e8){
      const un=load[n]/effStr(n);
      dmg[n]+=T.shockK*Math.max(0,un-0.4)*Math.min(Li/str[n],1.5);
    }
  });
  // The corpse's load lands on its supporters right now, not next frame
  if(Li>0&&yOf[i]>0){
    const b=i-WD;
    if(alive[b]&&!doomed[b])inflight[b]+=Li;
    else{
      const sup=[];
      forNb(i,n=>{if(alive[n]&&!doomed[n]&&str[n]<1e8&&sd[n]<sd[i])sup.push(n);});
      if(sup.length){const sh=Li/sup.length;for(const s of sup)inflight[s]+=sh;}
    }
  }
  voxelDebris(i,power,dx,dy,dz);
  kill(i);anyDeath=true;
}

// Hard impacts halve debris: 1/1 -> 1/2 -> 1/4 (terminal)
function shatterDebris(k,keepSpeed){
  if(sc[k]<=0.3||ms[k]>10)return;
  const ns=sc[k]*0.5,nm=ms[k]*0.3;
  const sp=Math.sqrt(vx[k]*vx[k]+vy[k]*vy[k]+vz[k]*vz[k])*keepSpeed;
  let cr=1,cg=1,cb=1;
  if(debrisMesh.instanceColor){const c=debrisMesh.instanceColor;cr=c.getX(k);cg=c.getY(k);cb=c.getZ(k);}
  for(let s=0;s<2;s++){
    spawnDebris(px[k]+(Math.random()-0.5)*sc[k],py[k]+(Math.random()-0.5)*sc[k],pz[k]+(Math.random()-0.5)*sc[k],
      vx[k]*keepSpeed+(Math.random()-0.5)*sp*0.6,vy[k]*keepSpeed+(Math.random()-0.5)*sp*0.6,vz[k]*keepSpeed+(Math.random()-0.5)*sp*0.6,
      nm,ns,cr,cg,cb);
  }
  sc[k]=ns;ms[k]=nm;
  vx[k]=vx[k]*keepSpeed+(Math.random()-0.5)*sp*0.6;
  vy[k]=vy[k]*keepSpeed+(Math.random()-0.5)*sp*0.6;
  vz[k]=vz[k]*keepSpeed+(Math.random()-0.5)*sp*0.6;
}

// Resting whole blocks cement themselves back into the world as load-bearing rubble
function trySolidify(k){
  const ix=Math.floor(px[k]),iy=Math.floor(py[k]),iz=Math.floor(pz[k]);
  if(ix<0||ix>=W||iy<1||iy>=H||iz<0||iz>=D)return false;
  const ci=I(ix,iy,iz),below=I(ix,iy-1,iz);
  if(alive[ci]||!alive[below])return false;
  const col=debrisMesh.instanceColor;
  addVox(ix,iy,iz,T.rubbleStr,col.getX(k),col.getY(k),col.getZ(k));
  dirtyTopo=true;needSort=true;voxDirty=true;
  removeDebris(k);
  return true;
}

function debrisStep(dt){
  const g=30;
  let solidified=0;
  for(let k=0;k<activeN;k++){
    age[k]+=dt;
    if(frozen[k]){
      // A pile only stands while whatever holds it up stands — rubble
      // resting on a block that later dies wakes up and falls again
      if(py[k]>2.2){
        const fx=Math.floor(px[k]),fy=Math.floor(py[k]-0.55*sc[k]),fz=Math.floor(pz[k]);
        if(fx>=0&&fx<W&&fy>=1&&fy<H&&fz>=0&&fz<D&&!alive[I(fx,fy,fz)]){frozen[k]=0;vy[k]=-0.5;continue;}
      }
      if(solidified<20&&sc[k]>=0.9&&ms[k]<=10&&age[k]>T.solidAge){
        if(trySolidify(k)){k--;solidified++;}
      }
      continue;
    }
    const heavy=ms[k]>10,sub=heavy?6:1,h=dt/sub;
    for(let s=0;s<sub;s++){
      vy[k]-=g*h;px[k]+=vx[k]*h;py[k]+=vy[k]*h;pz[k]+=vz[k]*h;
      const restY=1+0.5*sc[k];
      if(py[k]<restY){
        const sp2=Math.sqrt(vx[k]*vx[k]+vy[k]*vy[k]+vz[k]*vz[k]);
        if(sp2>13)shatterDebris(k,0.45);
        py[k]=restY;vy[k]=Math.abs(vy[k])*0.3;vx[k]*=0.65;vz[k]*=0.65;
        wx[k]*=0.6;wy[k]*=0.6;wz[k]*=0.6;
        if(Math.abs(vy[k])<1&&(vx[k]*vx[k]+vz[k]*vz[k])<1){frozen[k]=1;break;}
      }
      const ix=Math.floor(px[k]),iy=Math.floor(py[k]),iz=Math.floor(pz[k]);
      if(ix<0||ix>=W||iy<0||iy>=H||iz<0||iz>=D)continue;
      const ci=I(ix,iy,iz);
      if(!alive[ci]||str[ci]>1e8)continue;
      if(heavy){
        // Cannonball gibs straight through, flinging what it hits
        const sp=Math.sqrt(vx[k]*vx[k]+vy[k]*vy[k]+vz[k]*vz[k])+1e-6;
        killVoxel(ci,0.85,vx[k]/sp,vy[k]/sp,vz[k]/sp);
        forNb(ci,n=>{if(alive[n]&&str[n]<1e8)dmg[n]+=0.9;});
        vx[k]*=0.82;vy[k]*=0.82;vz[k]*=0.82;
      }else{
        const sp2=Math.sqrt(vx[k]*vx[k]+vy[k]*vy[k]+vz[k]*vz[k]);
        if(sp2>12)shatterDebris(k,0.5);
        // Pebbles bouncing off the facade shouldn't kill blocks, only real hits
        if(sp2>8)dmg[ci]+=(sp2-8)*0.004;
        if(dmg[ci]>=1){
          const dir=sp2>1e-3?1/sp2:0;
          killVoxel(ci,0.38,vx[k]*dir,Math.abs(vy[k]*dir)+0.3,vz[k]*dir);
        }
        if(sp2<4&&vy[k]<=0){
          // Slow landing on structure or rubble: rest ON TOP of the cell
          // and pile up instead of ghost-bouncing through it
          py[k]=iy+1+0.5*sc[k];vy[k]=0;vx[k]*=0.4;vz[k]*=0.4;
          wx[k]*=0.3;wy[k]*=0.3;wz[k]*=0.3;
          if(vx[k]*vx[k]+vz[k]*vz[k]<0.4){frozen[k]=1;break;}
        }else{
          vy[k]=Math.abs(vy[k])*0.35;vx[k]*=-0.4;vz[k]*=-0.4;
        }
      }
    }
    rx[k]+=wx[k]*dt;ry[k]+=wy[k]*dt;rz[k]+=wz[k]*dt;
  }
}

// Rigid slabs: disconnected structure falls as ONE body, not a rain of blocks
const MAXC=20,CMAXV=20480;
const cOn=new Uint8Array(MAXC),cN=new Int32Array(MAXC),
cOx=new Float32Array(MAXC*CMAXV),cOy=new Float32Array(MAXC*CMAXV),cOz=new Float32Array(MAXC*CMAXV),
cStr=new Uint16Array(MAXC*CMAXV),
cCr=new Float32Array(MAXC*CMAXV),cCg=new Float32Array(MAXC*CMAXV),cCb=new Float32Array(MAXC*CMAXV),
cPx=new Float32Array(MAXC),cPy=new Float32Array(MAXC),cPz=new Float32Array(MAXC),
cVx=new Float32Array(MAXC),cVy=new Float32Array(MAXC),cVz=new Float32Array(MAXC),
cMode=new Uint8Array(MAXC),cAx=new Float32Array(MAXC),cAy=new Float32Array(MAXC),cAz=new Float32Array(MAXC),
cPvx=new Float32Array(MAXC),cPvy=new Float32Array(MAXC),cPvz=new Float32Array(MAXC),
cR0x=new Float32Array(MAXC),cR0y=new Float32Array(MAXC),cR0z=new Float32Array(MAXC),
cTh=new Float32Array(MAXC),cOm=new Float32Array(MAXC),cAl=new Float32Array(MAXC),
cRad=new Float32Array(MAXC),cMinOY=new Float32Array(MAXC),cBnc=new Uint8Array(MAXC),
cShedAcc=new Float32Array(MAXC);
let slabsActive=0;

const _m=new Float32Array(9),_w=new Float32Array(3),_v2=new Float32Array(3);

function chunkRotM(c,m){
  const th=cTh[c];
  if(th===0){m[0]=1;m[1]=0;m[2]=0;m[3]=0;m[4]=1;m[5]=0;m[6]=0;m[7]=0;m[8]=1;return;}
  const ax=cAx[c],ay=cAy[c],az=cAz[c],cs=Math.cos(th),sn=Math.sin(th),C=1-cs;
  m[0]=cs+ax*ax*C;m[1]=ax*ay*C-az*sn;m[2]=ax*az*C+ay*sn;
  m[3]=ay*ax*C+az*sn;m[4]=cs+ay*ay*C;m[5]=ay*az*C-ax*sn;
  m[6]=az*ax*C-ay*sn;m[7]=az*ay*C+ax*sn;m[8]=cs+az*az*C;
}

// World position of slab voxel k: offsets rotate about the pivot while
// toppling, or about the center of mass once it's flying free
function chunkVoxWorld(c,k,m,out){
  const b=c*CMAXV,ox=cOx[b+k],oy=cOy[b+k],oz=cOz[b+k];
  const wx=m[0]*ox+m[1]*oy+m[2]*oz,wy=m[3]*ox+m[4]*oy+m[5]*oz,wz=m[6]*ox+m[7]*oy+m[8]*oz;
  if(cMode[c]===1){
    const rx=cR0x[c],ry=cR0y[c],rz=cR0z[c];
    out[0]=cPvx[c]+m[0]*rx+m[1]*ry+m[2]*rz+wx;
    out[1]=cPvy[c]+m[3]*rx+m[4]*ry+m[5]*rz+wy;
    out[2]=cPvz[c]+m[6]*rx+m[7]*ry+m[8]*rz+wz;
  }else{
    out[0]=cPx[c]+wx;out[1]=cPy[c]+wy;out[2]=cPz[c]+wz;
  }
}

function chunkVoxVel(c,wx,wy,wz,out){
  const om=cOm[c];
  if(cMode[c]===1){
    const rx=wx-cPvx[c],ry=wy-cPvy[c],rz=wz-cPvz[c];
    out[0]=om*(cAy[c]*rz-cAz[c]*ry);
    out[1]=om*(cAz[c]*rx-cAx[c]*rz);
    out[2]=om*(cAx[c]*ry-cAy[c]*rx);
    return;
  }
  out[0]=cVx[c];out[1]=cVy[c];out[2]=cVz[c];
  if(om!==0){
    const rx=wx-cPx[c],ry=wy-cPy[c],rz=wz-cPz[c];
    out[0]+=om*(cAy[c]*rz-cAz[c]*ry);
    out[1]+=om*(cAz[c]*rx-cAx[c]*rz);
    out[2]+=om*(cAx[c]*ry-cAy[c]*rx);
  }
}

function spawnChunk(list,len,tip){
  let c=-1;
  for(let s=0;s<MAXC;s++)if(!cOn[s]){c=s;break;}
  if(c<0||len>CMAXV){
    // No slab capacity: fall back to loose rubble rain
    for(let k=0;k<len;k++){
      const i=list[k];
      spawnDebris(xOf[i]+0.5,yOf[i]+0.5,zOf[i]+0.5,(Math.random()-0.5)*2,-0.5,(Math.random()-0.5)*2,
        1,0.96,baseC[i*3],baseC[i*3+1],baseC[i*3+2]);
      kill(i);
    }
    return;
  }
  // Bottom-up order so impacts resolve low layers first
  const sorted=Int32Array.from(list.subarray?list.subarray(0,len):list.slice(0,len));
  sorted.sort((a,b2)=>yOf[a]-yOf[b2]);
  let mx=0,my=0,mz=0;
  for(let k=0;k<len;k++){const i=sorted[k];mx+=xOf[i]+0.5;my+=yOf[i]+0.5;mz+=zOf[i]+0.5;}
  mx/=len;my/=len;mz/=len;
  const b=c*CMAXV;
  for(let k=0;k<len;k++){
    const i=sorted[k];
    cOx[b+k]=xOf[i]+0.5-mx;cOy[b+k]=yOf[i]+0.5-my;cOz[b+k]=zOf[i]+0.5-mz;
    cStr[b+k]=Math.min(60000,str[i]);
    cCr[b+k]=baseC[i*3];cCg[b+k]=baseC[i*3+1];cCb[b+k]=baseC[i*3+2];
  }
  cOn[c]=1;cN[c]=len;
  cPx[c]=mx;cPy[c]=my;cPz[c]=mz;
  cVx[c]=0;cVy[c]=0;cVz[c]=0;
  let rad=0,minOY=1e9;
  for(let k=0;k<len;k++){
    const d2=cOx[b+k]**2+cOy[b+k]**2+cOz[b+k]**2;
    if(d2>rad)rad=d2;
    if(cOy[b+k]<minOY)minOY=cOy[b+k];
  }
  cRad[c]=Math.sqrt(rad);cMinOY[c]=minOY;cBnc[c]=0;cShedAcc[c]=0;
  if(tip){
    cMode[c]=1;cAx[c]=tip.ax;cAy[c]=0;cAz[c]=tip.az;
    cPvx[c]=tip.px;cPvy[c]=tip.py;cPvz[c]=tip.pz;
    cR0x[c]=mx-tip.px;cR0y[c]=my-tip.py;cR0z[c]=mz-tip.pz;
    cTh[c]=0;cOm[c]=tip.om;cAl[c]=tip.al;
  }else{cMode[c]=0;cTh[c]=0;cOm[c]=0;cAl[c]=0;}
  for(let k=0;k<len;k++)kill(sorted[k]);
}

// A slab lands: soft drops cement back in whole, hard slams shatter bottom-up
function resolveChunkImpact(c,impact){
  const b=c*CMAXV,n=cN[c],soft=impact<T.softLand&&n<300;
  // Shedding unsorted the voxel list, so min/max has to be scanned, not assumed
  let minY=1e9,maxOY=-1e9;
  for(let k=0;k<n;k++){const oy=cOy[b+k];if(oy<minY)minY=oy;if(oy>maxOY)maxOY=oy;}
  const span=Math.max(0.001,maxOY-minY);
  // Where does the slab actually bottom out — dirt, or someone's roof?
  chunkRotM(c,_m);
  let minWY=1e9;
  for(let k=0;k<n;k++){chunkVoxWorld(c,k,_m,_w);if(_w[1]<minWY)minWY=_w[1];}
  if(!soft&&minWY<4){
    const power=Math.min(1,impact/T.shatterRef);
    shake=Math.min(2,shake+0.12+power*Math.min(1.1,n/600));
    // Ground slam: the shock damages whatever still stands around the footprint
    const R=Math.min(4,1.5+n*impact/2600),R2=R*R,gx=Math.floor(cPx[c]),gz=Math.floor(cPz[c]),r=Math.ceil(R);
    for(let dz=-r;dz<=r;dz++)for(let dx=-r;dx<=r;dx++){
      const d2=dx*dx+dz*dz;if(d2>R2)continue;
      const x=gx+dx,z=gz+dz;if(x<0||x>=W||z<0||z>=D)continue;
      const fall=1-Math.sqrt(d2)/R;
      for(let y=1;y<=3;y++){
        const i=I(x,y,z);
        if(alive[i]&&str[i]<1e8)dmg[i]+=fall*Math.min(1.4,n*impact/3200);
      }
    }
  }
  if(!soft){
    // Footprint crush: the slab's weight comes down on whatever is ACTUALLY
    // under each column — a neighbor's roof, a wall, its own ground ring —
    // and crushes down from the contact point, not just the dirt layers
    const perV=Math.min(2,impact*Math.min(1,n/300)*0.8);
    if(perV>0.3){
      const seen=new Set();
      for(let k=0;k<n;k++){
        chunkVoxWorld(c,k,_m,_w);
        const fxp=Math.floor(_w[0]),fzp=Math.floor(_w[2]);
        if(fxp<0||fxp>=W||fzp<0||fzp>=D)continue;
        const key=fxp*D+fzp;
        if(seen.has(key))continue;
        seen.add(key);
        let topY=0;
        for(let y=H-1;y>=1;y--){if(alive[I(fxp,y,fzp)]){topY=y;break;}}
        if(!topY)continue;
        const depth=1+Math.min(3,Math.floor(perV));
        for(let y=topY;y>topY-depth&&y>=1;y--){
          const i=I(fxp,y,fzp);
          if(alive[i]&&str[i]<1e8)dmg[i]+=perV;
        }
      }
    }
  }
  for(let k=0;k<n;k++){
    chunkVoxWorld(c,k,_m,_w);
    const wxp=_w[0],wyp=_w[1],wzp=_w[2];
    chunkVoxVel(c,wxp,wyp,wzp,_v2);
    const spinSp=Math.sqrt(_v2[0]**2+_v2[1]**2+_v2[2]**2);
    const cx=Math.floor(wxp),cy=Math.min(H-1,Math.max(1,Math.floor(wyp))),cz=Math.floor(wzp);
    const hFrac=span>0.01?1-(cOy[b+k]-minY)/span:0.5;
    // The far end of a toppling slab moves fastest, so it shatters hardest
    const power=soft?0:Math.min(1,(impact/T.shatterRef)*(0.35+0.65*hFrac)*(0.7+0.6*Math.min(1,n/700))+spinSp/T.shatterRef*0.55);
    const inb=cx>=0&&cx<W&&cz>=0&&cz<D;
    const cell=inb?I(cx,cy,cz):-1;
    if(!soft&&cell>=0){
      // Direct hit: a slab voxel slamming into standing structure wounds
      // whatever it touches — the hit building feels the landing
      const hitD=Math.min(1.6,power*1.8+0.3);
      if(alive[cell]&&str[cell]<1e8)dmg[cell]+=hitD;
      else if(cy>1&&alive[cell-WD]&&str[cell-WD]<1e8)dmg[cell-WD]+=hitD;
    }
    if((soft||power<0.3)&&cell>=0&&!alive[cell]&&alive[cell-WD]){
      // Survivors cement back in as structure / rubble
      addVox(cx,cy,cz,soft?cStr[b+k]:T.rubbleStr,cCr[b+k],cCg[b+k],cCb[b+k]);
      // cStr already carries the res-scaled strength, so a soft re-add keeps
      // it exactly instead of letting addVox scale it a second time
      if(soft)str[cell]=cStr[b+k];
      if(!soft)dmg[cell]=0.4;
      continue;
    }
    if(power<0.3){
      spawnDebris(wxp,wyp+0.4,wzp,_v2[0]*0.4+(Math.random()-0.5)*2,Math.abs(_v2[1])*0.2+0.5,_v2[2]*0.4+(Math.random()-0.5)*2,1,0.96,cCr[b+k],cCg[b+k],cCb[b+k]);
      continue;
    }
    const dirx=(Math.random()-0.5),dirz=(Math.random()-0.5);
    if(power>=0.62){
      for(let s=0;s<4;s++)spawnDebris(wxp+(Math.random()-0.5)*0.6,wyp,wzp+(Math.random()-0.5)*0.6,
        _v2[0]*0.55+dirx*(4+10*power)+(Math.random()-0.5)*4,Math.abs(_v2[1])*0.3+1+Math.random()*3,_v2[2]*0.55+dirz*(4+10*power)+(Math.random()-0.5)*4,
        0.08,0.25,cCr[b+k],cCg[b+k],cCb[b+k]);
    }else{
      for(let s=0;s<2;s++)spawnDebris(wxp+(Math.random()-0.5)*0.5,wyp,wzp+(Math.random()-0.5)*0.5,
        _v2[0]*0.5+dirx*(2+6*power)+(Math.random()-0.5)*3,Math.abs(_v2[1])*0.25+1+Math.random()*2,_v2[2]*0.5+dirz*(2+6*power)+(Math.random()-0.5)*3,
        0.3,0.5,cCr[b+k],cCg[b+k],cCb[b+k]);
    }
  }
  cOn[c]=0;cN[c]=0;
  dirtyTopo=true;needSort=true;voxDirty=true;anyDeath=true;
}

// Progressive mid-air breakup: a falling slab isn't one frozen shape that
// pops on contact — the faster it falls or spins, the more the fringe tears
// off piece by piece on the way down, so it arrives already coming apart
function shedStep(c,dt){
  if(cN[c]<=T.shedMin)return;
  const spin=cOm[c]*cRad[c];
  const speed=Math.abs(cVy[c])+Math.hypot(cVx[c],cVz[c])+spin;
  const over=speed-T.airBreak;
  if(over<=0){cShedAcc[c]=0;return;}
  cShedAcc[c]+=over*T.shedK*dt*Math.min(1,cN[c]/250);
  let quota=Math.floor(cShedAcc[c]);
  cShedAcc[c]-=quota;
  if(quota<=0)return;
  const b=c*CMAXV;
  chunkRotM(c,_m);
  while(quota-->0&&cN[c]>T.shedMin){
    // Sample a few candidates and tear off the fastest one — the fringe
    // rips first, so the body sheds from the outside in
    let bk=-1,bs=-1;
    for(let s=0;s<8;s++){
      const k=(Math.random()*cN[c])|0;
      chunkVoxWorld(c,k,_m,_w);
      chunkVoxVel(c,_w[0],_w[1],_w[2],_v2);
      const sp2=_v2[0]*_v2[0]+_v2[1]*_v2[1]+_v2[2]*_v2[2];
      if(sp2>bs){bs=sp2;bk=k;}
    }
    if(bk<0)break;
    chunkVoxWorld(c,bk,_m,_w);
    chunkVoxVel(c,_w[0],_w[1],_w[2],_v2);
    spawnDebris(_w[0],_w[1],_w[2],_v2[0],_v2[1],_v2[2],1,0.96,cCr[b+bk],cCg[b+bk],cCb[b+bk]);
    const l=cN[c]-1;
    cOx[b+bk]=cOx[b+l];cOy[b+bk]=cOy[b+l];cOz[b+bk]=cOz[b+l];
    cStr[b+bk]=cStr[b+l];cCr[b+bk]=cCr[b+l];cCg[b+bk]=cCg[b+l];cCb[b+bk]=cCb[b+l];
    cN[c]=l;
  }
}

function chunkStep(dt){
  const g=30;
  for(let c=0;c<MAXC;c++){
    if(!cOn[c])continue;
    const mode=cMode[c];
    if(mode===1){
      // Pivot topple: the structure rotates about the edge it balanced on,
      // gravity winding the spin up harder the further it leans
      const steps=Math.max(1,Math.ceil(cOm[c]*dt/0.02)),h=dt/steps;
      for(let s=0;s<steps;s++){
        if(!cOn[c])break;
        cOm[c]=Math.min(T.toppleOmegaMax,cOm[c]+cAl[c]*(1+3*cTh[c])*h);
        cTh[c]+=cOm[c]*h;
        chunkRotM(c,_m);
        const rx=cR0x[c],ry=cR0y[c],rz=cR0z[c];
        cPx[c]=cPvx[c]+_m[0]*rx+_m[1]*ry+_m[2]*rz;
        cPy[c]=cPvy[c]+_m[3]*rx+_m[4]*ry+_m[5]*rz;
        cPz[c]=cPvz[c]+_m[6]*rx+_m[7]*ry+_m[8]*rz;
        let impact=0;
        for(let k=0;k<cN[c];k++){
          chunkVoxWorld(c,k,_m,_w);
          const pdx=_w[0]-cPvx[c],pdy=_w[1]-cPvy[c],pdz=_w[2]-cPvz[c];
          const pd=Math.sqrt(pdx*pdx+pdy*pdy+pdz*pdz);
          if(pd<2.5)continue;
          const sp=cOm[c]*pd;
          // The bottom layers pivot into the dirt and clip through it — only
          // the swinging body slamming down counts as a ground hit
          if(cOy[c*CMAXV+k]>=cMinOY[c]+1.5&&_w[1]<=1.5){
            if(sp>impact)impact=sp;
            continue;
          }
          const cx=Math.floor(_w[0]),cy=Math.floor(_w[1]),cz=Math.floor(_w[2]);
          if(cx<0||cx>=W||cy<1||cy>=H||cz<0||cz>=D)continue;
          const ci=I(cx,cy,cz);
          if(!alive[ci]||str[ci]>1e8)continue;
          if(sp>=5){if(sp>impact)impact=sp;}
          else{killVoxel(ci,0.5,0,-0.5,0);cOm[c]*=0.92;}
        }
        if(impact>0){resolveChunkImpact(c,Math.max(7,impact));break;}
      }
      if(cOn[c]&&cTh[c]>1.3){
        // Past the point of no return: let go of the pivot, keep the spin
        cMode[c]=2;
        cVx[c]=cOm[c]*(cAy[c]*(cPz[c]-cPvz[c])-cAz[c]*(cPy[c]-cPvy[c]));
        cVy[c]=cOm[c]*(cAz[c]*(cPx[c]-cPvx[c])-cAx[c]*(cPz[c]-cPvz[c]));
        cVz[c]=cOm[c]*(cAx[c]*(cPy[c]-cPvy[c])-cAy[c]*(cPx[c]-cPvx[c]));
      }
      if(cOn[c])shedStep(c,dt);
      continue;
    }
    cVy[c]-=g*dt;
    if(mode===2)cTh[c]+=cOm[c]*dt;
    chunkRotM(c,_m);
    const sp=Math.sqrt(cVx[c]*cVx[c]+cVy[c]*cVy[c]+cVz[c]*cVz[c])+cOm[c]*cRad[c];
    const sub=Math.max(1,Math.ceil(sp*dt/0.45)),h=dt/sub;
    for(let s=0;s<sub;s++){
      if(!cOn[c])break;
      cPx[c]+=cVx[c]*h;cPy[c]+=cVy[c]*h;cPz[c]+=cVz[c]*h;
      for(let k=0;k<cN[c];k++){
        chunkVoxWorld(c,k,_m,_w);
        const wyp=_w[1];
        if(wyp<=1.5){
          const imp=Math.abs(cVy[c])+cOm[c]*cRad[c]*0.5,hsp=Math.hypot(cVx[c],cVz[c]);
          // Moderate landing: the slab stays whole, bounces, and converts
          // horizontal speed into roll — it tumbles instead of freezing
          if(imp<T.rollMax&&cBnc[c]<(cN[c]>800?1:3)){
            cBnc[c]++;
            cPy[c]+=1.5-wyp;
            cVy[c]=Math.abs(cVy[c])*0.28+0.5;
            cVx[c]*=0.72;cVz[c]*=0.72;
            cMode[c]=2;
            if(hsp>0.6){cAx[c]=cVz[c]/hsp;cAy[c]=0;cAz[c]=-cVx[c]/hsp;cOm[c]=Math.min(2.4,cOm[c]*0.6+hsp*0.4);}
            else cOm[c]*=0.5;
            shake=Math.min(2,shake+0.06);
            break;
          }
          resolveChunkImpact(c,imp);break;
        }
        const cx=Math.floor(_w[0]),cy=Math.floor(wyp),cz=Math.floor(_w[2]);
        if(cx<0||cx>=W||cy<1||cy>=H||cz<0||cz>=D)continue;
        const ci=I(cx,cy,cz);
        if(!alive[ci])continue;
        if(str[ci]>1e8){resolveChunkImpact(c,Math.abs(cVy[c])+cOm[c]*cRad[c]*0.5);break;}
        const impact=Math.abs(cVy[c])+cOm[c]*cRad[c]*0.5;
        const massBoost=0.5+Math.min(1,cN[c]/400);
        if(impact*massBoost>=T.softLand){
          // A fast slab pancakes straight through whatever it lands on
          killVoxel(ci,0.7,0,-0.5,0);
          cVy[c]*=0.86;cOm[c]*=0.9;
        }else{resolveChunkImpact(c,impact);break;}
      }
    }
    if(cOn[c])shedStep(c,dt);
  }
}

// Stability: a component whose center of mass hangs outside its support
// polygon doesn't drop straight down — it tips over the nearest edge
const supX=new Float32Array(4096),supZ=new Float32Array(4096);
const hullTmp=new Int32Array(8192),hullP=new Int32Array(8192);
let compEpoch=0;
const tipJobs=[];

function crossO(xs,zs,oa,ob,oc){
  return (xs[ob]-xs[oa])*(zs[oc]-zs[oa])-(zs[ob]-zs[oa])*(xs[oc]-xs[oa]);
}

// Convex hull of support points + how far the CoM sits outside it
function hullScan(xs,zs,px,pz,n){
  if(n<=8){
    // Tiny footing: the axis-aligned bbox IS the convex hull on a grid
    let mnx=1e9,mxx=-1e9,mnz=1e9,mxz=-1e9;
    for(let k=0;k<n;k++){
      if(xs[k]<mnx)mnx=xs[k];if(xs[k]>mxx)mxx=xs[k];
      if(zs[k]<mnz)mnz=zs[k];if(zs[k]>mxz)mxz=zs[k];
    }
    const cx=Math.max(mnx,Math.min(mxx,px)),cz=Math.max(mnz,Math.min(mxz,pz));
    return{out:Math.hypot(px-cx,pz-cz),px:cx,pz:cz};
  }
  for(let k=0;k<n;k++)hullTmp[k]=k;
  hullTmp.subarray(0,n).sort((a,b)=>xs[a]-xs[b]||zs[a]-zs[b]);
  let hn=0;
  for(let k=0;k<n;k++){
    while(hn>=2&&crossO(xs,zs,hullP[hn-2],hullP[hn-1],hullTmp[k])<=0)hn--;
    hullP[hn++]=hullTmp[k];
  }
  const lowerEnd=hn;
  for(let k=n-1;k>=0;k--){
    while(hn>lowerEnd&&crossO(xs,zs,hullP[hn-2],hullP[hn-1],hullTmp[k])<=0)hn--;
    hullP[hn++]=hullTmp[k];
  }
  if(hn>1)hn--;
  if(hn===0)return null;
  if(hn<=2){
    // Degenerate base (single-file wall): hull is a segment
    const ax=xs[hullP[0]],az=zs[hullP[0]];
    const bx=xs[hullP[hn-1]],bz=zs[hullP[hn-1]];
    const ex=bx-ax,ez=bz-az,L2=ex*ex+ez*ez;
    let t=L2>0?((px-ax)*ex+(pz-az)*ez)/L2:0;t=Math.max(0,Math.min(1,t));
    const cx=ax+ex*t,cz=az+ez*t;
    return{out:Math.hypot(px-cx,pz-cz),px:cx,pz:cz};
  }
  let maxOut=0,bpx=0,bpz=0;
  for(let e=0;e<hn;e++){
    const a=hullP[e],b2=hullP[(e+1)%hn];
    const ex=xs[b2]-xs[a],ez=zs[b2]-zs[a];
    const cross=ex*(pz-zs[a])-ez*(px-xs[a]);
    const L=Math.hypot(ex,ez);
    if(cross<0){
      const d=-cross/L;
      if(d>maxOut){
        maxOut=d;
        const t=Math.max(0,Math.min(1,((px-xs[a])*ex+(pz-zs[a])*ez)/(L*L)));
        bpx=xs[a]+ex*t;bpz=zs[a]+ez*t;
      }
    }
  }
  if(maxOut===0)return{out:0,px,pz};
  return{out:maxOut,px:bpx,pz:bpz};
}

// Union-find + basin scratch for splitting multi-footing components
const uf=new Int32Array(4096),supV=new Int32Array(4096),supStr=new Float32Array(4096);
const clSX=new Float32Array(4096),clSZ=new Float32Array(4096);

function ufFind(x){let r=x;while(uf[r]!==r)r=uf[r];while(uf[x]!==r){const p=uf[x];uf[x]=r;x=p;}return r;}

function stabilityPass(){
  compEpoch++;
  for(let a=0;a<aliveN;a++){
    const i=aliveIdx[a];
    if(!alive[i]||yOf[i]===0||compMark[i]===compEpoch||str[i]>1e8||doomed[i])continue;
    let qs=0,qe=0,n=0;
    stack[qe++]=i;compMark[i]=compEpoch;
    let mx=0,my=0,mz=0,minY=H,maxY=0;
    while(qs<qe){
      const j=stack[qs++];compBuf[n++]=j;
      const x=xOf[j],y=yOf[j],z=zOf[j];
      mx+=x+0.5;my+=y+0.5;mz+=z+0.5;
      if(y<minY)minY=y;if(y>maxY)maxY=y;
      forNb(j,m=>{
        if(alive[m]&&yOf[m]>0&&compMark[m]!==compEpoch&&str[m]<1e8&&!doomed[m]){
          compMark[m]=compEpoch;stack[qe++]=m;
        }
      });
    }
    if(n<T.toppleMinN||maxY-minY<T.toppleMinH)continue;
    let supN=0,supMinY=H;
    for(let k=0;k<n;k++){
      const j=compBuf[k],bj=j-WD;
      if(alive[bj]&&compMark[bj]!==compEpoch){
        if(supN<supX.length){supX[supN]=xOf[j]+0.5;supZ[supN]=zOf[j]+0.5;supV[supN]=j;supStr[supN]=str[j];supN++;}
        if(yOf[j]<supMinY)supMinY=yOf[j];
      }
    }
    if(supN===0||supN>=supX.length)continue;
    const scan=hullScan(supX,supZ,mx/n,mz/n,supN);
    if(!scan)continue;
    if(tipJobs.length>=3)continue;
    const h=maxY-minY+1;
    const pushTip=(list,len,out,px,pz,py)=>{
      let dx=0,dz=0;
      for(let k=0;k<len;k++){dx+=xOf[list[k]]+0.5;dz+=zOf[list[k]]+0.5;}
      dx=dx/len-px;dz=dz/len-pz;
      const dl=Math.hypot(dx,dz)||1;dx/=dl;dz/=dl;
      tipJobs.push({list,n:len,tip:{ax:dz,az:-dx,px,py,pz,
        om:0.06,al:T.toppleGain*30*Math.min(out,6)/(h*h)}});
    };
    // Split the blob by base cluster (a tower's own footing, one side of a
    // vault, ...) and attribute every voxel to its nearest support cell.
    // Only basins that can't balance themselves tip — a healthy neighbor
    // holding a skybridge keeps standing
    for(let s=0;s<supN;s++)uf[s]=s;
    // Footing cells only fuse into one cluster when they're comparable
    // strength — a solidified rubble mat (55) touching a wall (360) doesn't
    // merge the two buildings into one structure
    for(let s=0;s<supN;s++)for(let s2=s+1;s2<supN;s2++){
      if(Math.abs(supX[s]-supX[s2])>1||Math.abs(supZ[s]-supZ[s2])>1)continue;
      const st=Math.min(supStr[s],supStr[s2])/Math.max(supStr[s],supStr[s2]);
      if(st<0.5)continue;
      const ra=ufFind(s),rb=ufFind(s2);
      if(ra!==rb)uf[ra]=rb;
    }
    let oneCluster=true;
    for(let s=1;s<supN;s++)if(ufFind(s)!==ufFind(0)){oneCluster=false;break;}
    for(let k=0;k<n;k++)basin[compBuf[k]]=-1;
    const supSet=new Set();for(let s=0;s<supN;s++)supSet.add(supV[s]);
    // Widest-path attribution: a voxel belongs to the footing reachable
    // through the STRONGEST route (bottleneck strength, then fewest hops),
    // so a flimsy skybridge can't drag a healthy tower into a topple —
    // the tear happens at the weak link instead
    // Strengths within 25% count as ties (per-cell hash noise otherwise
    // hijacks attribution); ties break toward the nearer footing
    const better=(a,b)=>{
      const sa=wScore[a],sb=wScore[b];
      if(sa>sb*1.25)return true;
      if(sb>sa*1.25)return false;
      return wHops[a]<wHops[b];
    };
    let hn2=0;
    const hPush=(v)=>{
      stack[hn2++]=v;let c=hn2-1;
      while(c>0){const p=(c-1)>>1;
        if(better(stack[c],stack[p])){const t=stack[c];stack[c]=stack[p];stack[p]=t;c=p;}else break;}
    };
    const hPop=()=>{
      const top=stack[0];stack[0]=stack[--hn2];let c=0;
      for(;;){
        const l=c*2+1,r=l+1;let b=c;
        if(l<hn2&&better(stack[l],stack[b]))b=l;
        if(r<hn2&&better(stack[r],stack[b]))b=r;
        if(b===c)break;
        const t=stack[c];stack[c]=stack[b];stack[b]=t;c=b;
      }
      return top;
    };
    for(let s=0;s<supN;s++){
      const v=supV[s];
      basin[v]=s;wScore[v]=Math.min(str[v],400);wHops[v]=0;hPush(v);
    }
    while(hn2>0){
      const j=hPop();
      const sj=wScore[j],hj=wHops[j];
      forNb(j,m=>{
        if(!alive[m]||compMark[m]!==compEpoch)return;
        if(overT[m]>T.fuseT&&!supSet.has(m))return;
        const ns=Math.min(sj,Math.min(str[m],400)),nh=hj+1;
        if(basin[m]<0||ns>wScore[m]*1.25||(ns*1.25>=wScore[m]&&nh<wHops[m])){
          basin[m]=basin[j];wScore[m]=ns;wHops[m]=nh;hPush(m);
        }
      });
    }
    const clIdx=new Map(),clMass=[],clCx=[],clCz=[];
    for(let k=0;k<n;k++){
      const v=compBuf[k];if(basin[v]<0)continue;
      const r=ufFind(basin[v]);
      let ci=clIdx.get(r);
      if(ci===undefined){ci=clMass.length;clIdx.set(r,ci);clMass.push(0);clCx.push(0);clCz.push(0);}
      clMass[ci]++;clCx[ci]+=xOf[v]+0.5;clCz[ci]+=zOf[v]+0.5;
    }
    const unstable=new Set();
    let anyExtreme=false;
    for(const [root,ci] of clIdx){
      let cn=0;
      for(let s=0;s<supN;s++){
        if(ufFind(s)!==root)continue;
        clSX[cn]=supX[s];clSZ[cn]=supZ[s];cn++;
      }
      const cs=hullScan(clSX,clSZ,clCx[ci]/clMass[ci],clCz[ci]/clMass[ci],cn);
      if(!cs)continue;
      if(cs.out>T.toppleOutHard)anyExtreme=true;
      if(cs.out>T.toppleMargin)unstable.add(root);
    }
    if(!unstable.size)continue;
    // A balanced blob only yields for a grossly off-center footing —
    // arches and split footings legitimately hold each other up
    if(scan.out<=T.toppleMargin&&!anyExtreme)continue;
    let footingFailing=false;
    for(let s=0;s<supN;s++){
      if(unstable.has(ufFind(s))&&(dmg[supV[s]]>0.4||overT[supV[s]]>0||load[supV[s]]/effStr(supV[s])>1.2))footingFailing=true;
    }
    const key=(n>>4)+':'+supN+':'+supMinY;
    if(key!==tipKey){tipKey=key;tipSince=tNow;}
    if(!footingFailing&&tNow-tipSince<0.15)continue;
    if(oneCluster){
      const body=[];
      for(let k=0;k<n;k++){const v=compBuf[k];if(basin[v]>=0)body.push(v);}
      if(body.length>=T.toppleMinN)
        pushTip(Int32Array.from(body),body.length,scan.out,scan.px,scan.pz,supMinY+0.2);
      continue;
    }
    for(const root of unstable){
      const body=[];
      for(let k=0;k<n;k++){
        const v=compBuf[k];
        if(basin[v]>=0&&unstable.has(ufFind(basin[v])))body.push(v);
      }
      if(body.length<T.toppleMinN)continue;
      let bx=0,bz=0;
      for(const v of body){bx+=xOf[v]+0.5;bz+=zOf[v]+0.5;}
      bx/=body.length;bz/=body.length;
      let cn=0;
      for(let s=0;s<supN;s++){
        if(ufFind(s)!==root)continue;
        clSX[cn]=supX[s];clSZ[cn]=supZ[s];cn++;
      }
      const cs=hullScan(clSX,clSZ,bx,bz,cn);
      if(!cs)continue;
      pushTip(Int32Array.from(body),body.length,cs.out,cs.px,cs.pz,supMinY+0.2);
    }
  }
  for(const j of tipJobs.splice(0))spawnChunk(j.list,j.n,j.tip);
}

// Support flood: bedrock carries whatever stacks on it, but doomed blocks
// (already failing, queued for removal) no longer prop anything up. Whatever
// loses its path to bedrock leaves the world as a rigid slab that same frame.
// overT must NEVER gate this flood — v14 let sag time block it, which stranded
// whole buildings floating in mid-air with zero support, immortal
function supportPass(){
  epoch++;let sp=0;
  for(let z=0;z<D;z++)for(let x=0;x<W;x++){
    const i=I(x,0,z);if(alive[i]&&!doomed[i]&&epochM[i]!==epoch){epochM[i]=epoch;stack[sp++]=i;}
  }
  while(sp>0){
    const i=stack[--sp];
    const x=xOf[i],y=yOf[i],z=zOf[i];
    if(y+1<H){const n=i+WD;if(alive[n]&&!doomed[n]&&epochM[n]!==epoch){epochM[n]=epoch;stack[sp++]=n;}}
    {
      if(x+1<W){const n=i+1;if(alive[n]&&!doomed[n]&&epochM[n]!==epoch){epochM[n]=epoch;stack[sp++]=n;}}
      if(x>0){const n=i-1;if(alive[n]&&!doomed[n]&&epochM[n]!==epoch){epochM[n]=epoch;stack[sp++]=n;}}
      if(z+1<D){const n=i+W;if(alive[n]&&!doomed[n]&&epochM[n]!==epoch){epochM[n]=epoch;stack[sp++]=n;}}
      if(z>0){const n=i-W;if(alive[n]&&!doomed[n]&&epochM[n]!==epoch){epochM[n]=epoch;stack[sp++]=n;}}
    }
  }
  const comps=[];let cTotal=0;
  for(let a=0;a<aliveN;a++){
    const i=aliveIdx[a];
    if(!alive[i]||doomed[i]||epochM[i]===epoch)continue;
    const start=cTotal;
    compBuf[cTotal++]=i;epochM[i]=epoch;
    for(let q=start;q<cTotal;q++){
      const j=compBuf[q];
      forNb(j,n=>{if(alive[n]&&!doomed[n]&&epochM[n]!==epoch){epochM[n]=epoch;compBuf[cTotal++]=n;}});
    }
    comps.push([start,cTotal-start]);
  }
  for(const [s,l] of comps)spawnChunk(compBuf.subarray(s,s+l),l);
}

// Scene
const scene=new THREE.Scene();
scene.background=new THREE.Color(0x0b0e14);
scene.fog=new THREE.Fog(0x0b0e14,160,420);
const camera=new THREE.PerspectiveCamera(55,innerWidth/innerHeight,0.1,1000);
camera.position.set(95,72,95);
const renderer=new THREE.WebGLRenderer({antialias:true});
renderer.setSize(innerWidth,innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const controls=new THREE.OrbitControls(camera,renderer.domElement);
controls.target.set(32,16,28);
controls.enableDamping=true;
controls.maxPolarAngle=Math.PI*0.49;
controls.maxDistance=400;

scene.add(new THREE.HemisphereLight(0x8fa3cc,0x1a2233,0.85));
const sun=new THREE.DirectionalLight(0xffe8c0,1.15);
sun.position.set(90,130,50);
sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048);
sun.shadow.camera.left=-90;sun.shadow.camera.right=90;
sun.shadow.camera.top=90;sun.shadow.camera.bottom=-90;
sun.shadow.camera.far=400;
scene.add(sun);

// Reusable muzzle/blast flash
const flash=new THREE.PointLight(0xffc880,0,60,2);
scene.add(flash);
let flashT=0;
function flashAt(x,y,z,power){
  flash.position.set(x,y,z);flash.intensity=4*power;flashT=0.25;
}

const ground=new THREE.Mesh(new THREE.PlaneGeometry(1200,1200),new THREE.MeshLambertMaterial({color:0x0d1119}));
ground.rotation.x=-Math.PI/2;ground.position.set(32,-0.02,32);ground.receiveShadow=true;
scene.add(ground);

// The static-world mesh is recreated whenever the grid resizes, since an
// InstancedMesh can't change capacity after construction. Capacity is
// capped well past the biggest city the slider can produce.
const VCAP=150000;
let voxMesh=null;
function makeVoxMesh(){
  if(voxMesh){scene.remove(voxMesh);voxMesh.geometry.dispose();voxMesh.material.dispose();voxMesh.dispose();}
  voxMesh=new THREE.InstancedMesh(new THREE.BoxGeometry(0.98,0.98,0.98),new THREE.MeshLambertMaterial({color:0xffffff}),VCAP);
  voxMesh.castShadow=true;voxMesh.receiveShadow=true;voxMesh.frustumCulled=false;
  voxMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(voxMesh);
}
makeVoxMesh();

const debrisMesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshLambertMaterial({color:0xffffff}),MAXD);
debrisMesh.castShadow=true;debrisMesh.frustumCulled=false;
debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
debrisMesh.raycast=()=>{};
debrisMesh.setColorAt(0,tmpC.setRGB(1,1,1));
debrisMesh.count=0;
scene.add(debrisMesh);

const chunkMesh=new THREE.InstancedMesh(new THREE.BoxGeometry(0.98,0.98,0.98),new THREE.MeshLambertMaterial({color:0xffffff}),MAXC*CMAXV);
chunkMesh.castShadow=true;chunkMesh.frustumCulled=false;
chunkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
chunkMesh.raycast=()=>{};
chunkMesh.setColorAt(0,tmpC.setRGB(1,1,1));
chunkMesh.count=0;
scene.add(chunkMesh);

const m4=new THREE.Matrix4(),dummy=new THREE.Object3D();
const _axis=new THREE.Vector3();

// Static world instances, rebuilt whenever voxels change (voxDirty).
// Bedrock rides along in aliveIdx so it renders for free.
function refreshStatic(){
  voxMesh.count=aliveN;
  dummy.quaternion.set(0,0,0,1);dummy.scale.set(1,1,1);
  for(let a=0;a<aliveN;a++){
    const i=aliveIdx[a];
    dummy.position.set(xOf[i]+0.5,yOf[i]+0.5,zOf[i]+0.5);
    dummy.updateMatrix();
    voxMesh.setMatrixAt(a,dummy.matrix);
    voxMesh.setColorAt(a,tmpC.setRGB(baseC[i*3],baseC[i*3+1],baseC[i*3+2]));
  }
  voxMesh.instanceMatrix.needsUpdate=true;
  if(voxMesh.instanceColor)voxMesh.instanceColor.needsUpdate=true;
  voxDirty=false;
}

function refreshDebris(){
  debrisMesh.count=activeN;
  for(let k=0;k<activeN;k++){
    dummy.position.set(px[k],py[k],pz[k]);
    dummy.rotation.set(rx[k],ry[k],rz[k]);
    dummy.scale.set(sc[k],sc[k],sc[k]);
    dummy.updateMatrix();
    debrisMesh.setMatrixAt(k,dummy.matrix);
  }
  debrisMesh.instanceMatrix.needsUpdate=true;
  if(debrisColorDirty&&debrisMesh.instanceColor){debrisMesh.instanceColor.needsUpdate=true;debrisColorDirty=false;}
}

// Slab instances rebuild from ZERO every frame and only for slabs that are
// actually alive — a dead slab leaves no ghost behind (v15)
function refreshChunks(){
  let n=0;
  for(let c=0;c<MAXC;c++){
    if(!cOn[c])continue;
    chunkRotM(c,_m);
    const b=c*CMAXV,th=cTh[c];
    if(th!==0){_axis.set(cAx[c],cAy[c],cAz[c]);dummy.quaternion.setFromAxisAngle(_axis,th);}
    else dummy.quaternion.set(0,0,0,1);
    dummy.scale.set(1,1,1);
    for(let k=0;k<cN[c];k++){
      chunkVoxWorld(c,k,_m,_w);
      dummy.position.set(_w[0],_w[1],_w[2]);
      dummy.updateMatrix();
      chunkMesh.setMatrixAt(n,dummy.matrix);
      chunkMesh.setColorAt(n,tmpC.setRGB(cCr[b+k],cCg[b+k],cCb[b+k]));
      n++;
    }
  }
  chunkMesh.count=n;
  chunkMesh.instanceMatrix.needsUpdate=true;
  if(chunkMesh.instanceColor)chunkMesh.instanceColor.needsUpdate=true;
}

// Progressive buckling: past crushU is instant, the fuse band yields over
// time (overload builds, strength rots, then it lets go), the creep band
// just sags. No more pop-or-immortal.
function failurePass(dt){
  stressKill.length=0;
  for(let a=0;a<aliveN;a++){
    const i=aliveIdx[a];
    if(!alive[i]||yOf[i]===0||str[i]>1e8)continue;
    // Past the per-frame kill cap: stay doomed, go first next frame
    if(doomed[i]){stressKill.push(i);continue;}
    const u=load[i]/effStr(i);
    lastU[i]=u;
    if(u>=T.crushU){doomed[i]=1;stressKill.push(i);continue;}
    if(u>=T.fuseU){
      overT[i]+=dt*(u-1)*T.failK;
      dmg[i]+=dt*(u-1)*0.08;
      if(overT[i]>0.6||dmg[i]>=1){doomed[i]=1;stressKill.push(i);}
      continue;
    }
    overT[i]=Math.max(0,overT[i]-dt*0.5);
    if(u>=T.creepOn)dmg[i]+=dt*(u-T.creepOn)*T.creepK*0.02;
    else if(u<T.healU)dmg[i]=Math.max(0,dmg[i]-T.healK*dt);
    if(dmg[i]>=1){doomed[i]=1;stressKill.push(i);}
  }
  for(let k=0;k<stressKill.length;k++){
    if(k>=T.deathCap)break;
    const i=stressKill[k];
    doomed[i]=0;
    killVoxel(i,0.25+0.25*hash01(i),0,-0.4,0);
  }
}

// Facade spalling: a wounded skin keeps flaking on its own and the wound
// creeps along the face — leave it and only core columns + floor plates
// remain. Rubble and skeleton never spall (matId 1 = wall/glass only)
function spallPass(dt){
  stressKill.length=0;
  for(let a=0;a<aliveN;a++){
    const i=aliveIdx[a];
    if(!alive[i]||doomed[i]||yOf[i]===0||matId[i]!==1)continue;
    if(dmg[i]<T.spallOn)continue;
    dmg[i]+=T.spallK*dt;
    forNb(i,n=>{
      if(alive[n]&&!doomed[n]&&matId[n]===1&&dmg[n]<0.9)dmg[n]+=T.spallSpread*dt;
    });
    if(dmg[i]>=1)stressKill.push(i);
  }
  for(const i of stressKill)killVoxel(i,0.15,0,-0.3,0);
}

// Input: click acts with the current mode (1 carve, 2 blast, 3 cannon).
// A drag is orbiting, not clicking, so only near-stationary presses fire.
const ray=new THREE.Raycaster(),ndc=new THREE.Vector2();
let downX=0,downY=0;
renderer.domElement.addEventListener('pointerdown',e=>{downX=e.clientX;downY=e.clientY;});
renderer.domElement.addEventListener('pointerup',e=>{
  if(Math.hypot(e.clientX-downX,e.clientY-downY)>6)return;
  ndc.set(e.clientX/innerWidth*2-1,-(e.clientY/innerHeight)*2+1);
  ray.setFromCamera(ndc,camera);
  if(mode===3){cannon();return;}
  const hit=ray.intersectObject(voxMesh)[0];
  if(!hit||hit.instanceId===undefined)return;
  const i=aliveIdx[hit.instanceId];
  if(str[i]>1e8)return;
  if(mode===1)carveAt(xOf[i]+0.5,yOf[i]+0.5,zOf[i]+0.5);
  else blastAt(xOf[i]+0.5,yOf[i]+0.5,zOf[i]+0.5);
});

function carveAt(cx,cy,cz){
  const R=2*curRes+1,R2=R*R;
  const x0=Math.max(0,Math.floor(cx-R)),x1=Math.min(W-1,Math.ceil(cx+R));
  const y0=Math.max(1,Math.floor(cy-R)),y1=Math.min(H-1,Math.ceil(cy+R));
  const z0=Math.max(0,Math.floor(cz-R)),z1=Math.min(D-1,Math.ceil(cz+R));
  for(let y=y0;y<=y1;y++)for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){
    const dx=x+0.5-cx,dy=y+0.5-cy,dz=z+0.5-cz;
    if(dx*dx+dy*dy+dz*dz>R2)continue;
    const i=I(x,y,z);
    if(alive[i]&&!doomed[i]&&str[i]<1e8)killVoxel(i,0.3,0,-0.3,0);
  }
}

function blastAt(cx,cy,cz){
  const R=3.5*curRes+1,R2=R*R;
  const x0=Math.max(0,Math.floor(cx-R)),x1=Math.min(W-1,Math.ceil(cx+R));
  const y0=Math.max(1,Math.floor(cy-R)),y1=Math.min(H-1,Math.ceil(cy+R));
  const z0=Math.max(0,Math.floor(cz-R)),z1=Math.min(D-1,Math.ceil(cz+R));
  for(let y=y0;y<=y1;y++)for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){
    const dx=x+0.5-cx,dy=y+0.5-cy,dz=z+0.5-cz,d2=dx*dx+dy*dy+dz*dz;
    if(d2>R2)continue;
    const i=I(x,y,z);
    if(!alive[i]||doomed[i]||str[i]>1e8)continue;
    const fall=1-Math.sqrt(d2)/R,dl=Math.sqrt(d2)||1;
    if(fall>0.5)killVoxel(i,0.5+0.4*fall,dx/dl,Math.abs(dy/dl)+0.3,dz/dl);
    else dmg[i]+=fall*1.2;
  }
  flashAt(cx,cy,cz,1.2);
}

function cannon(){
  const dir=new THREE.Vector3();
  camera.getWorldDirection(dir);
  const o=camera.position;
  spawnDebris(o.x+dir.x*4,o.y+dir.y*4,o.z+dir.z*4,dir.x*110,dir.y*110,dir.z*110,40,2.2,0.25,0.25,0.28);
  flashAt(o.x+dir.x*6,o.y+dir.y*6,o.z+dir.z*6,0.8);
}

addEventListener('keydown',e=>{
  if(e.key==='1')mode=1;
  else if(e.key==='2')mode=2;
  else if(e.key==='3')mode=3;
  else if(e.key==='l'||e.key==='L'){
    renderer.shadowMap.enabled=!renderer.shadowMap.enabled;
    sun.castShadow=renderer.shadowMap.enabled;
    scene.traverse(o=>{if(o.material)o.material.needsUpdate=true;});
  }
});

sendit.addEventListener('click',()=>{
  const S=(v)=>Math.max(1,Math.round(v*curRes));
  blastAt(S(20),2,S(32));
  setTimeout(()=>blastAt(S(45),2,S(31)),250);
});

voxslider.addEventListener('input',()=>{
  voxcount.textContent=parseFloat(voxslider.value).toFixed(1)+'x — release to rebuild';
});
voxslider.addEventListener('change',()=>buildWorld(parseFloat(voxslider.value)));

addEventListener('resize',()=>{
  camera.aspect=innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight);
});

let fpsA=60;
function updateHud(){
  let slabs=0;
  for(let c=0;c<MAXC;c++)if(cOn[c])slabs++;
  const gone=Math.max(0,initialStruct-(aliveN-WD));
  const frac=Math.min(1,gone/Math.max(1,initialStruct));
  fearfill.style.width=(100*(1-frac))+'%';
  fearlabel.textContent=frac<0.05?'dennis: smug':frac<0.25?'dennis: nervous':frac<0.6?'dennis: sweating':'dennis: TERRIFIED';
  hud.textContent='voxels '+(aliveN-WD).toLocaleString()+' · slabs '+slabs+' · debris '+activeN+' · '+fpsA.toFixed(0)+' fps'
    +'\nmode: '+(['','carve','blast','cannon'][mode])+' · res '+curRes.toFixed(1)+'x';
}

let lastT=performance.now();
function frame(now){
  requestAnimationFrame(frame);
  const dt=Math.min(0.05,Math.max(0.001,(now-lastT)/1000));
  lastT=now;tNow+=dt;
  fpsA=fpsA*0.95+(1/Math.max(dt,1e-4))*0.05;

  solve(dt);
  supportPass();
  stabilityPass();
  failurePass(dt);
  spallPass(dt);
  chunkStep(dt);
  debrisStep(dt);

  if(flashT>0){flashT-=dt;if(flashT<=0)flash.intensity=0;}

  if(voxDirty)refreshStatic();
  refreshDebris();
  refreshChunks();

  // The camera never shakes. Not on impacts, not on slams, not ever
  controls.update();
  updateHud();
  renderer.render(scene,camera);
}

buildWorld(1);
requestAnimationFrame(frame);


