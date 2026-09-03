/* Loaded only by browser tests. It accesses the classic-script bindings
   without adding test hooks or branches to production game files. */
window.__browserGameTest=Object.freeze({
  pause(){
    started=false;
    suspendGameLoop();
  },
  placePlayer(position){
    player.pos.set(position.x,position.y,position.z);
    player.vel.set(0,0,0);
    player.mode='ground';
    player.onGround=true;
    player.jumpClimbActive=false;
    player.jumpLaunchY=player.pos.y;
    player.hold=-1;
    player.moveFrom=-1;
    player.moveTo=-1;
    return this.state();
  },
  setCamera(yaw,pitch){
    camYaw=yaw;targetYaw=yaw;
    camPitch=pitch;targetPitch=pitch;
  },
  step(ticks,dt=1/120){
    for(let tick=0;tick<ticks;tick++)update(dt);
    return this.state();
  },
  state(){
    return {
      position:player.pos.toArray(),
      velocity:player.vel.toArray(),
      mode:player.mode,
      started,
      camera:[camYaw,camPitch],
      cameraPosition:camera.position.toArray(),
      zoom:camZoom,
      pressedKeys:Object.keys(keys).filter(code=>keys[code]).sort(),
      renderFrames:renderer.info.render.frame,
      world:voxelPhysics.stats()
    };
  }
});
