'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createRuntime,projectRoot}=require('./support/game-runtime.cjs');

test('repeated destruction remains finite and bounded in the authored world',t=>{
  const runtime=createRuntime({fullWorld:true,seed:804});
  runtime.evaluate(fs.readFileSync(path.join(projectRoot,'js/game-loop.js'),'utf8'));
  runtime.evaluate(`
    player.pos.set(48,0,48);player.vel.set(0,0,0);
    resetSimulationClock();scene.updateMatrixWorld(true);
    const stressStructure=voxelPhysics.structures.filter(st=>st.ny*st.sy>30)
      .sort((a,b)=>b.activeN-a.activeN)[0];
    const stressBefore=voxelPhysics.stats().voxels;
    const stressSupportPoints=[];
    for(let a=0;a<stressStructure.activeN;a++){
      const i=stressStructure.activeIdx[a];
      const y=Math.floor(i/(stressStructure.nx*stressStructure.nz));
      if(y!==1)continue;
      const x=i%stressStructure.nx,z=Math.floor(i/stressStructure.nx)%stressStructure.nz;
      stressSupportPoints.push(V(stressStructure.origin.x+(x+0.5)*stressStructure.sx,
        stressStructure.origin.y+(y+0.5)*stressStructure.sy,
        stressStructure.origin.z+(z+0.5)*stressStructure.sz));
    }
    function stressFrame(frame){
      __testClock.advance(1000/60);
      /* Cut a support course with the real cannon damage API, then exercise
         secondary explosions during the resulting slab/debris simulation. */
      for(let n=0;n<3&&stressSupportPoints.length;n++)
        voxelPhysics.damageAt(stressStructure,stressSupportPoints.pop(),
          WEAPONS.cannon.structuralPower,V(0,0,-1));
      if(frame<120&&frame%20===0){
        const x=stressStructure.origin.x+stressStructure.nx*stressStructure.sx*
          (0.15+0.7*(frame/20)/5);
        explode(V(x,stressStructure.origin.y+1.1,
          stressStructure.origin.z+stressStructure.nz*stressStructure.sz));
      }
      update(1/60);scene.updateMatrixWorld(true);
    }
  `);
  const timings=[];
  for(let frame=0;frame<240;frame++){
    const start=performance.now();runtime.evaluate(`stressFrame(${frame})`);
    timings.push(performance.now()-start);
  }
  const state=runtime.json(`({
    removed:stressBefore-voxelPhysics.stats().voxels,
    world:voxelPhysics.stats(),legacyBodies:chunks.length,particles:particles.length,
    rockets:rockets.length,ticks:simulationTicks,
    finite:player.pos.toArray().every(Number.isFinite)&&
      chunks.every(c=>c.position.toArray().every(Number.isFinite)&&
        c.userData.vel.toArray().every(Number.isFinite))&&
      Array.from(voxelPhysics.debrisMesh.instanceMatrix.array).every(Number.isFinite)
  })`);
  assert.ok(state.removed>100);
  assert.equal(state.finite,true);
  assert.equal(state.ticks,480);
  assert.ok(state.legacyBodies<=300);
  assert.ok(state.world.debris<=3600);
  assert.ok(state.particles<=260);
  assert.ok(state.rockets<=48);
  assert.deepEqual(runtime.errors,[]);
  timings.sort((a,b)=>a-b);
  const report={seed:804,frames:240,simulationSeconds:4,
    cpuFrameMs:{median:timings[120],p95:timings[228],max:timings[239]},state};
  fs.mkdirSync(path.join(projectRoot,'test-results'),{recursive:true});
  fs.writeFileSync(path.join(projectRoot,'test-results','astra-stress.json'),JSON.stringify(report,null,2));
  t.diagnostic(`CPU only: median ${report.cpuFrameMs.median.toFixed(2)} ms, `+
    `p95 ${report.cpuFrameMs.p95.toFixed(2)} ms, max ${report.cpuFrameMs.max.toFixed(2)} ms; `+
    `${state.removed} removed voxels, ${state.world.debris} rubble pieces. GPU time is excluded.`);
});
