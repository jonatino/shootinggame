'use strict';

const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {openGamePage}=require('./support/browser-runtime.cjs');

(async()=>{
  const label=process.argv[2]||'current',source=process.argv[3],mode=process.argv[4]||'fire';
  const fixed=process.argv[5]==='fixed';
  assert.match(label,/^[a-zA-Z0-9_-]+$/);
  assert.ok(['fire','look'].includes(mode));
  const scriptSourceRoot=source&&source!=='-'?source:undefined;
  let gameLoopSourcePath;
  fs.mkdirSync('test-results',{recursive:true});
  if(fixed){
    // Compare identical simulated work as well as real-time responsiveness.
    // This override exists only in the guarded profiler page.
    const loop=fs.readFileSync(path.join(scriptSourceRoot||'.','js/game-loop.js'),'utf8');
    gameLoopSourcePath=path.resolve(`test-results/rapid-${label}-loop.js`);
    fs.writeFileSync(gameLoopSourcePath,loop.replace('performance.now()+SIMULATION_CPU_BUDGET_MS','Infinity'));
  }
  const runtime=await openGamePage({seed:1120,scriptSourceRoot,gameLoopSourcePath});
  try{
    const {page}=runtime;
    await page.setViewportSize({width:1600,height:1000});
    await page.evaluate(mode=>{
      __browserGameTest.pause();__browserGameTest.placePlayer({x:-8,y:0,z:16});
      for(const id of ['start','load'])document.getElementById(id).style.display='none';
      const st=voxelPhysics.structures.find(s=>s.mesh.name==='Northwest Spire tier 1');
      const footings=[];
      for(let a=0;a<st.activeN;a++){
        const i=st.activeIdx[a],y=Math.floor(i/(st.nx*st.nz));if(y!==4)continue;
        footings.push(V(st.origin.x+(i%st.nx+0.5)*st.sx,st.origin.y+(y+0.5)*st.sy,
          st.origin.z+(Math.floor(i/st.nx)%st.nz+0.5)*st.sz));
      }
      // Cook a damaged scene before timing input/rendering. No native mouse APIs.
      for(let tick=0;tick<240;tick++){
        if(tick%2===0)for(let n=0;n<3&&footings.length;n++)
          voxelPhysics.damageAt(st,footings.pop(),2.65,V(0,0,-1));
        if(tick%40===0)explode(V(-15,1.8,-4));
        voxelPhysics.update(1/120,true);updateChunks(1/120,true);
      }
      voxelPhysics.syncVisuals();resetSimulationClock();
      player.respawnShield=1000;updateCam(0);updateGuy(0);scene.updateMatrixWorld(true);
      const initial=voxelPhysics.stats();mouseHeld=mode==='fire';
      window.__rapidPerf={frames:[],initial,shots:playerWpn.shotSerial,ticks:simulationTicks,
        step(dt,time){
          const start=performance.now();
          const yaw=0.6+0.95*Math.sin(time*2.4),pitch=-0.27+0.22*Math.sin(time*3.1);
          const sensitivity=MOUSE_SENSITIVITY*gameSettings.sensitivity;
          applyMouseLookDelta(-(yaw-targetYaw)/sensitivity,(pitch-targetPitch)/sensitivity);
          __browserGameTest.step(1,dt);
          const simulated=performance.now();renderer.render(scene,camera);
          const end=performance.now();
          this.frames.push({time,frameMs:dt*1000,cpu:simulated-start,render:end-simulated,
            ticks:simulationTicks,shots:playerWpn.shotSerial,...voxelPhysics.stats()});
        }};
    },mode);
    const cdp=await runtime.context.newCDPSession(page);
    await cdp.send('Profiler.enable');await cdp.send('Profiler.start');
    if(fixed)for(let batch=0;batch<20;batch++)await page.evaluate(()=>{
      for(let i=0;i<30;i++)__rapidPerf.step(1/60,__rapidPerf.frames.length/60);
    });
    else await page.evaluate(()=>new Promise(resolve=>{
      let first,last;
      function frame(now){
        if(first===undefined){first=now;last=now-1000/120;}
        __rapidPerf.step((now-last)/1000,(now-first)/1000);last=now;
        if(now-first>=10000){mouseHeld=false;resolve();}else requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }));
    const {profile}=await cdp.send('Profiler.stop');
    const result=await page.evaluate(()=>({initial:__rapidPerf.initial,frames:__rapidPerf.frames,
      simulationSeconds:(simulationTicks-__rapidPerf.ticks)/120,
      shots:playerWpn.shotSerial-__rapidPerf.shots,safety:__browserInputSafety.state()}));
    const measured=result.frames.filter(f=>f.time>=0.5);
    const summarize=key=>{const samples=measured.map(f=>f[key]).sort((a,b)=>a-b);
      return {median:samples[Math.floor(samples.length/2)],p95:samples[Math.floor(samples.length*0.95)],max:samples.at(-1)};};
    result.summary={frameMs:summarize('frameMs'),cpu:summarize('cpu'),render:summarize('render')};
    result.mode=mode;result.fixed=fixed;result.errors=runtime.errors;
    if(fixed)delete result.summary.frameMs; // Supplied dt is not a measured frame interval.
    fs.mkdirSync('test-results',{recursive:true});
    fs.writeFileSync(`test-results/rapid-${label}.json`,JSON.stringify(result,null,2));
    fs.writeFileSync(`test-results/rapid-${label}.cpuprofile`,JSON.stringify(profile));
    await page.screenshot({path:path.resolve(`test-results/rapid-${label}.png`)});
    assert.deepEqual(runtime.errors,[]);assert.equal(result.safety.nativeLocked,false);
    assert.equal(result.safety.requests,0);assert.ok(result.initial.chunks>=5);
    if(fixed)assert.equal(result.simulationSeconds,10);
    if(mode==='fire')assert.ok(result.shots>50);
    console.log(JSON.stringify({label,...result.summary,initial:result.initial,
      simulationSeconds:result.simulationSeconds,shots:result.shots,errors:runtime.errors}));
  }finally{await runtime.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
