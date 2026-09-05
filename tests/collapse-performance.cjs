'use strict';

// Browser CPU/render profiling only. Deterministic physics regressions stay in
// the CPU harness. openGamePage always installs the native input guard first.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {openGamePage}=require('./support/browser-runtime.cjs');

(async()=>{
  const label=process.argv[2]||'current',source=process.argv[3],scenario=process.argv[4]||'chain';
  const realtime=process.argv[5]==='realtime';
  assert.match(label,/^[a-zA-Z0-9_-]+$/,'use a filename-safe benchmark label');
  assert.ok(['house','chain'].includes(scenario),'scenario must be house or chain');
  fs.mkdirSync('test-results',{recursive:true});
  const instrumented=fs.readFileSync(source&&source!=='-'?source:'voxel_physics.js','utf8')
    .replace('const MAX_DEBRIS=3600;','const MAX_DEBRIS=3600;let perfPairs=0,perfAxes=0,perfCandidates=0;')
    .replace('function queueDynamicVoxelPair(a,b,dt,allowLoosePair){',
      'function queueDynamicVoxelPair(a,b,dt,allowLoosePair){perfPairs++;')
    .replace('function findOrientedContact(a,b){','function findOrientedContact(a,b){perfAxes++;')
    .replace('const b=debrisSweepEntries[j];','const b=debrisSweepEntries[j];perfCandidates++;')
    .replace('registerBuilding,blast,blastStructure,',`performanceState:()=>{
      const state={sleeping:dfrozen.slice(0,debrisN).reduce((a,b)=>a+b,0),
        contacts:dynamicContactCount,pairs:perfPairs,sat:perfAxes,candidates:perfCandidates};
      perfPairs=perfAxes=perfCandidates=0;return state;
    },registerBuilding,blast,blastStructure,`);
  const instrumentedPath=path.resolve('test-results',`collapse-${label}-source.js`);
  fs.writeFileSync(instrumentedPath,instrumented);
  const loopPath=path.resolve('test-results',`collapse-${label}-loop.js`);
  let loopSource=fs.readFileSync(process.argv[6]||'js/game-loop.js','utf8');
  // Fixed-rate CPU profiling measures identical simulated work per sample;
  // real-time mode exercises the production wall-clock catch-up budget too.
  if(!realtime)loopSource=loopSource.replace('performance.now()+SIMULATION_CPU_BUDGET_MS','Infinity');
  fs.writeFileSync(loopPath,loopSource);
  const runtime=await openGamePage({seed:950,voxelSourcePath:instrumentedPath,gameLoopSourcePath:loopPath});
  try{
    const page=runtime.page;
    await page.setViewportSize({width:1280,height:720});
    await page.evaluate(scenario=>{
      __browserGameTest.pause();
      __browserGameTest.placePlayer({x:-13,y:0,z:13});
      updateGuy(0);camera.position.set(-8,5,16);camera.lookAt(-13,3,-6);
      for(const id of ['start','load'])document.getElementById(id).style.display='none';
      const st=houseA.voxelStructure,footings=[];
      for(let a=0;a<st.activeN;a++){
        const i=st.activeIdx[a],y=Math.floor(i/(st.nx*st.nz));
        if(y!==1)continue;
        const x=i%st.nx,z=Math.floor(i/st.nx)%st.nz;
        footings.push(V(st.origin.x+(x+0.5)*st.sx,st.origin.y+(y+0.5)*st.sy,
          st.origin.z+(z+0.5)*st.sz));
      }
      window.__collapsePerf={tick:0,footings,frames:[],structures:voxelPhysics.stats().voxels,
        step(dt=1/60){
          const start=performance.now();
          __browserGameTest.step(1,dt);
          const simulated=performance.now();
          camera.position.set(-8,5,16);camera.lookAt(-13,3,-6);
          scene.updateMatrixWorld(true);renderer.render(scene,camera);
          const end=performance.now();
          this.frames.push({tick:this.tick,elapsed:dt*1000,cpu:simulated-start,render:end-simulated,
            debris:voxelPhysics.stats().debris,chunks:voxelPhysics.chunks.length,
            ...voxelPhysics.performanceState()});
        }};
      // Schedule damage on fixed ticks in both modes. The real-time run feeds
      // actual animation-frame intervals into the game's normal catch-up loop.
      const originalSimulate=simulate;
      simulate=function(dt){
        const probe=__collapsePerf;
        if(probe.tick%2===0)for(let n=0;n<3&&probe.footings.length;n++)
          voxelPhysics.damageAt(st,probe.footings.pop(),WEAPONS.cannon.structuralPower,V(0,0,-1));
        if(probe.tick<(scenario==='house'?1:240)&&probe.tick%40===0)explode(V(-15,1.8,-4));
        originalSimulate(dt);probe.tick++;
      };
    },scenario);
    const cdp=await runtime.context.newCDPSession(page);
    await cdp.send('Profiler.enable');await cdp.send('Profiler.start');
    if(realtime)await page.evaluate(()=>new Promise(resolve=>{
      let previous;
      function frame(now){
        const dt=previous===undefined?1/60:(now-previous)/1000;previous=now;
        __collapsePerf.step(dt);
        if(__collapsePerf.tick>=960)resolve();else requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }));
    else for(let batch=0;batch<16;batch++)await page.evaluate(()=>{
      for(let frame=0;frame<30;frame++)__collapsePerf.step();
    });
    const {profile}=await cdp.send('Profiler.stop');
    const result=await page.evaluate(()=>({frames:__collapsePerf.frames,stats:voxelPhysics.stats(),
      removed:__collapsePerf.structures-voxelPhysics.stats().voxels,
      safety:__browserInputSafety.state()}));
    const summary=(frames,key)=>{const values=frames.map(f=>f[key]).sort((a,b)=>a-b);
      return {median:values[Math.floor(values.length/2)],p95:values[Math.floor(values.length*0.95)],max:values.at(-1)};};
    const collapse=result.frames.filter(f=>f.tick>=240&&f.tick<600);
    result.summary={all:summary(result.frames,'cpu'),collapse:summary(collapse,'cpu'),
      settled:summary(result.frames.filter(f=>f.tick>=720),'cpu'),render:summary(result.frames,'render')};
    if(realtime)result.summary.animationFrameMs=summary(collapse,'elapsed');
    result.scenario=scenario;result.realtime=realtime;
    result.errors=runtime.errors;
    fs.mkdirSync('test-results',{recursive:true});
    fs.writeFileSync(`test-results/collapse-${label}.json`,JSON.stringify(result,null,2));
    fs.writeFileSync(`test-results/collapse-${label}.cpuprofile`,JSON.stringify(profile));
    await page.screenshot({path:path.resolve(`test-results/collapse-${label}.png`)});
    assert.equal(result.safety.nativeLocked,false);
    assert.equal(result.safety.requests,0);
    assert.deepEqual(result.errors,[]);
    assert.ok(result.stats.debris>900,'the replay must produce a substantial collapse');
    console.log(JSON.stringify({label,...result.summary,stats:result.stats,removed:result.removed,errors:result.errors}));
  }finally{await runtime.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
