/* Frame orchestration, profiling, and startup. Loaded in order from index.html. */
function update(dt){
  player.cool=Math.max(0,player.cool-dt);
  player.grace=Math.max(0,player.grace-dt);
  player.jumpGrace=Math.max(0,player.jumpGrace-dt);
  player.jumpBuffer=Math.max(0,player.jumpBuffer-dt);
  player.climbBuffer=Math.max(0,player.climbBuffer-dt);
  player.vaultRecovery=Math.max(0,player.vaultRecovery-dt);
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
  if(playerWpn.cooldown>0)playerWpn.cooldown-=dt;
  if(mouseHeld && playerWpn.cooldown<=0 && playerWpn.reloading<=0) shoot();
  moveFwd.set(-Math.sin(camYaw),0,-Math.cos(camYaw));
  moveRight.set(-moveFwd.z,0,moveFwd.x);
  const ix=(keys.KeyD?1:0)-(keys.KeyA?1:0);
  const iz=(keys.KeyW?1:0)-(keys.KeyS?1:0);
  moveDir.set(moveFwd.x*iz+moveRight.x*ix,0,moveFwd.z*iz+moveRight.z*ix);
  if(moveDir.lengthSq()>0)moveDir.normalize();
  else if(performance.now()<movementIntentUntil)moveDir.copy(movementIntentDir);

  if(player.mode==='ground')groundStep(dt,moveDir);
  else if(player.mode==='attach'||player.mode==='move')moveStep(dt);
  else if(player.mode==='hang')hangStep(dt);
  else if(player.mode==='vault')vaultStep(dt);
  if(player.mode!=='ground'){
    sprinting=false;
    camRollTarget=0;
    camBobAmt=Math.max(camBobAmt-dt*6,0);
  }

  updateHint(dt);
  updateCam(dt);
  updateGuy(dt);
  updateEnemies(dt);
  updateEnemyBullets(dt);
  updateRockets(dt);
  updateExplosions(dt);
  voxelPhysics.update(dt);
  updateChunks(dt);
  updateParticles(dt);
  updateBulletLines(dt);
  updateDummies(dt);
  updatePickups(dt);
  updateHitUI(dt);
  updateMarker(dt);
  flushDeferredGeometryDisposals();
  gameTime=performance.now()-tickStart;
}

const PROFILE=new URLSearchParams(location.search).has('profile');
let tickStart=0,gameTime=0,renderTime=0,profileNext=0;

let last=performance.now();
function tick(){
  requestAnimationFrame(tick);
  const now=performance.now();
  const dt=Math.min(0.05,(now-last)/1000);
  last=now;
  tickStart=now;
  if(started)update(dt);
  renderer.render(scene,camera);
  renderTime=performance.now()-tickStart-gameTime;
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
}
tick();

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
           started=true;
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
