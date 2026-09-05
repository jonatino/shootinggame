/* Frame orchestration, profiling, and startup. Loaded in order from index.html. */
function simulate(dt){
  player.cool=Math.max(0,player.cool-dt);
  player.grace=Math.max(0,player.grace-dt);
  player.jumpGrace=Math.max(0,player.jumpGrace-dt);
  player.jumpBuffer=Math.max(0,player.jumpBuffer-dt);
  player.climbBuffer=Math.max(0,player.climbBuffer-dt);
  player.vaultRecovery=Math.max(0,player.vaultRecovery-dt);
  player.respawnShield=Math.max(0,player.respawnShield-dt);
  if(!(keys.ShiftLeft||keys.ShiftRight))player.climbBuffer=0;
  if(player.mode==='ground'&&player.grace<=0&&player.hold>=0){
    player.hold=-1;
    player.moveFrom=-1;
    player.moveTo=-1;
  }
  landingKick*=Math.exp(-dt*7.5);
  /* Recoil has its own damped tail so the trigger cadence never dictates the
     pose. The heavier impulse settles more slowly, while roll is allowed to
     self-correct quickly so aim does not wander after a burst. */
  weaponRecoilKick*=Math.exp(-dt*8.5);
  weaponRecoilPitch*=Math.exp(-dt*9.5);
  weaponRecoilRoll*=Math.exp(-dt*11);
  updateWeaponFire(dt);
  moveFwd.set(-Math.sin(camYaw),0,-Math.cos(camYaw));
  moveRight.set(-moveFwd.z,0,moveFwd.x);
  const ix=(keys.KeyD?1:0)-(keys.KeyA?1:0);
  const iz=(keys.KeyW?1:0)-(keys.KeyS?1:0);
  moveDir.set(moveFwd.x*iz+moveRight.x*ix,0,moveFwd.z*iz+moveRight.z*ix);
  if(moveDir.lengthSq()>0){moveDir.normalize();movementInputSampled=true;}
  else if(performance.now()<movementIntentUntil)moveDir.copy(movementIntentDir);

  if(player.mode==='ground')groundStep(dt,moveDir);
  else if(player.mode==='attach'||player.mode==='move')moveStep(dt);
  else if(player.mode==='hang')hangStep(dt);
  else if(player.mode==='vault')vaultStep(dt);
  if(player.mode!=='ground'){
    sprinting=false;
  }

  updateEnemies(dt);
  updateEnemyBullets(dt);
  updateRockets(dt);
  voxelPhysics.update(dt,true);
  updateChunks(dt,true);
  updateDummies(dt);
  updatePickups(dt);
}

let simulationAccumulator=0,simulationTicks=0;
const previousPlayerPosition=player.pos.clone(),presentedPlayerPosition=V();
let previousPlayerMode=player.mode;
function resetSimulationClock(){
  simulationAccumulator=0;
  previousPlayerPosition.copy(player.pos);
  previousPlayerMode=player.mode;
}
function update(dt){
  if(!Number.isFinite(dt)||dt<=0)return;
  const elapsed=Math.min(dt,SIMULATION_STEP*SIMULATION_MAX_STEPS);
  simulationAccumulator+=elapsed;
  const simulationDeadline=performance.now()+SIMULATION_CPU_BUDGET_MS;
  let steps=0;
  while(simulationAccumulator+1e-10>=SIMULATION_STEP&&steps<SIMULATION_MAX_STEPS){
    previousPlayerPosition.copy(player.pos);
    previousPlayerMode=player.mode;
    simulate(SIMULATION_STEP);
    simulationAccumulator=Math.max(0,simulationAccumulator-SIMULATION_STEP);
    steps++;simulationTicks++;
    /* A collapse must not turn one expensive tick into twelve before showing
       the next frame. Always finish each fixed tick, then yield presentation
       after the CPU budget. Discard overdue whole ticks so overload cannot
       bank a burst of movement/fire or keep stalling after the rubble rests. */
    if(simulationAccumulator+1e-10>=SIMULATION_STEP&&performance.now()>=simulationDeadline){
      const overdue=Math.floor((simulationAccumulator+1e-10)/SIMULATION_STEP);
      simulationAccumulator=Math.max(0,simulationAccumulator-overdue*SIMULATION_STEP);
      break;
    }
  }
  voxelPhysics.syncVisuals();
  updateHint(elapsed);
  /* Interpolate only presentation. Collision always reads the current fixed
     state, and a respawn or traversal transition never interpolates through a
     wall. Keeping camera and rig together also preserves muzzle alignment. */
  presentedPlayerPosition.copy(player.pos);
  if(previousPlayerMode===player.mode&&previousPlayerPosition.distanceToSquared(player.pos)<4)
    player.pos.lerpVectors(previousPlayerPosition,presentedPlayerPosition,
      Math.min(1,simulationAccumulator/SIMULATION_STEP));
  updateCam(elapsed);
  updateGuy(elapsed);
  player.pos.copy(presentedPlayerPosition);
  if(chunks.length||settledFragments.length)updateDebrisVisualBudget();
  updateExplosions(elapsed);
  updateParticles(elapsed);
  updateBulletLines(elapsed);
  syncEnemyBulletVisuals(Math.min(1,simulationAccumulator/SIMULATION_STEP));
  updateHitUI(elapsed);
  updateMarker(elapsed);
  flushDeferredGeometryDisposals();
  gameTime=performance.now()-tickStart;
}

const PROFILE=new URLSearchParams(location.search).has('profile');
let tickStart=0,gameTime=0,renderTime=0,profileNext=0;

const performanceHud=document.getElementById('perf');
const fpsValue=document.getElementById('fps-value');
const frameTimeValue=document.getElementById('frametime-value');
const frameTimeGraph=document.getElementById('frametime-graph');
const FRAME_TIME_SAMPLE_COUNT=120;
const FRAME_TIME_GRAPH_MAX_MS=50;
const frameTimeSamples=new Float32Array(FRAME_TIME_SAMPLE_COUNT);
frameTimeSamples.fill(1000/60);
let frameTimeCursor=0,performanceWindowMs=0,performanceWindowFrames=0;
let performanceGraphNext=0;

function drawFrameTimeGraph(){
  if(!frameTimeGraph||typeof frameTimeGraph.setAttribute!=='function')return;
  const points=new Array(FRAME_TIME_SAMPLE_COUNT);
  for(let i=0;i<FRAME_TIME_SAMPLE_COUNT;i++){
    const sample=frameTimeSamples[(frameTimeCursor+i)%FRAME_TIME_SAMPLE_COUNT];
    const x=i*184/(FRAME_TIME_SAMPLE_COUNT-1);
    const y=46-Math.min(FRAME_TIME_GRAPH_MAX_MS,Math.max(0,sample))*44/
      FRAME_TIME_GRAPH_MAX_MS;
    points[i]=x.toFixed(1)+','+y.toFixed(1);
  }
  frameTimeGraph.setAttribute('points',points.join(' '));
}

function resetPerformanceHud(now){
  performanceWindowMs=0;
  performanceWindowFrames=0;
  performanceGraphNext=now;
  frameTimeCursor=0;
  frameTimeSamples.fill(1000/60);
  if(performanceHud)performanceHud.className='good';
  if(fpsValue)fpsValue.textContent='… FPS';
  if(frameTimeValue)frameTimeValue.textContent='… ms';
  drawFrameTimeGraph();
}

function pausePerformanceHud(){
  if(performanceHud)performanceHud.className='paused';
  if(fpsValue)fpsValue.textContent='PAUSED';
  if(frameTimeValue)frameTimeValue.textContent='— ms';
}

function updatePerformanceHud(frameMs,now){
  /* Keep the real requestAnimationFrame interval rather than the simulation's
     50 ms safety cap, so stalls remain visible instead of being flattened. */
  const sample=Math.max(0.01,frameMs);
  frameTimeSamples[frameTimeCursor]=sample;
  frameTimeCursor=(frameTimeCursor+1)%FRAME_TIME_SAMPLE_COUNT;
  performanceWindowMs+=sample;
  performanceWindowFrames++;
  if(now>=performanceGraphNext){
    drawFrameTimeGraph();
    performanceGraphNext=now+1000/30;
  }
  if(performanceWindowMs<250)return;
  const averageMs=performanceWindowMs/performanceWindowFrames;
  const fps=1000/averageMs;
  if(fpsValue)fpsValue.textContent=Math.round(fps)+' FPS';
  if(frameTimeValue)frameTimeValue.textContent=averageMs.toFixed(1)+' ms';
  if(performanceHud)
    performanceHud.className=averageMs<=18.5?'good':(averageMs<=34?'warn':'bad');
  performanceWindowMs=0;
  performanceWindowFrames=0;
}

let last=performance.now();
let gameFrameRequest=null;
refreshPausedFrame=()=>{
  if(!started)renderer.render(scene,camera);
};
resumeGameLoop=()=>{
  if(gameFrameRequest!==null||!started)return;
  last=performance.now();
  resetSimulationClock();
  resetPerformanceHud(last);
  gameFrameRequest=requestAnimationFrame(tick);
};
suspendGameLoop=()=>{
  resetSimulationClock();
  pausePerformanceHud();
  if(gameFrameRequest===null)return;
  cancelAnimationFrame(gameFrameRequest);
  gameFrameRequest=null;
};
function tick(){
  gameFrameRequest=null;
  if(!started)return;
  const now=performance.now();
  const frameMs=Math.max(0.01,now-last);
  const dt=frameMs/1000;
  last=now;
  tickStart=now;
  update(dt);
  renderer.render(scene,camera);
  renderTime=performance.now()-tickStart-gameTime;
  updatePerformanceHud(frameMs,performance.now());
  if(PROFILE&&now>=profileNext){
    const el=document.getElementById('prof');
    if(el){
      el.style.display='block';
       const voxelStats=voxelPhysics.stats();
       el.textContent='game:'+gameTime.toFixed(1)+'ms render:'+renderTime.toFixed(1)+
         'ms speed:'+Math.hypot(player.vel.x,player.vel.z).toFixed(1)+
         ' pos:'+player.pos.x.toFixed(1)+','+player.pos.z.toFixed(1)+
         ' vox:'+voxelStats.voxels+' slabs:'+voxelStats.chunks;
    }
    profileNext=now+100;
  }
  if(started)gameFrameRequest=requestAnimationFrame(tick);
}

/* Render one prepared chase-camera frame behind the play gate, then leave the
   GPU idle until resumeGameLoop is called by an explicit play action. */
updateCam(1/60);
updateGuy(1/60);
renderer.render(scene,camera);

setTimeout(()=>{
  try{
    document.getElementById('loadmsg').textContent='fracturing building geometry…';
    setTimeout(()=>{
      try{
        const stats=buildGraph();
        document.getElementById('loadmsg').textContent=
          stats.holds+' holds · '+stats.links+' links · '+voxelPhysics.stats().structures+' voxel buildings ready';
        setTimeout(()=>{
           document.getElementById('load').style.display='none';
           updateStatsUI();
         },700);
      }catch(e){
        errBox.style.display='block';
        errBox.textContent='⚠ cook failed: '+e.message;
      }
    },60);
  }catch(e){
    errBox.style.display='block';
    errBox.textContent='⚠ '+e.message;
  }
},80);
