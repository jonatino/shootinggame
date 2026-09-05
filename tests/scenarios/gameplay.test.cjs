'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createRuntime}=require('../support/game-runtime.cjs');

test('movement and automatic cannon cadence agree at 30, 60, and 144 FPS',()=>{
  const samples=[30,60,144].map(fps=>{
    const runtime=createRuntime({gameplay:true,seed:610});
    return runtime.json(`(()=>{
      camYaw=0;targetYaw=0;camPitch=0;targetPitch=0;
      gameSettings.cameraMotion=0;keys.KeyD=true;mouseHeld=true;
      for(let frame=0;frame<${fps*2};frame++){
        __testClock.advance(1000/${fps});update(1/${fps});
      }
      return {ticks:simulationTicks,shots:playerWpn.shotSerial,pos:__playerState().pos};
    })()`);
  });
  for(const sample of samples){
    assert.equal(sample.ticks,240);
    assert.equal(sample.shots,72,'the cannon should retain its 0.028 second cadence');
    assert.deepEqual(sample,samples[0]);
  }
});

test('a long stall is bounded and pause discards pending simulation time',()=>{
  const runtime=createRuntime({gameplay:true,seed:611});
  const result=runtime.json(`(()=>{
    keys.KeyD=true;update(30);
    const afterStall={ticks:simulationTicks,x:player.pos.x};
    update(NaN);update(Infinity);update(-1);
    update(SIMULATION_STEP/2);suspendGameLoop();update(SIMULATION_STEP/2);
    return {afterStall,ticks:simulationTicks,finite:player.pos.toArray().every(Number.isFinite)};
  })()`);
  assert.equal(result.afterStall.ticks,12);
  assert.ok(result.afterStall.x<0.7);
  assert.equal(result.ticks,12);
  assert.equal(result.finite,true);
});

test('releasing the trigger never banks a burst for the next click',()=>{
  const runtime=createRuntime({gameplay:true,seed:612});
  const result=runtime.json(`(()=>{
    mouseHeld=false;updateWeaponFire(10);const idle=playerWpn.cooldown;
    shoot();const first=playerWpn.shotSerial;
    shoot();const repeated=playerWpn.shotSerial;
    return {idle,first,repeated};
  })()`);
  assert.deepEqual(result,{idle:0,first:1,repeated:1});
});

test('enemy bullets sweep the full player capsule and respect nearer cover',()=>{
  const runtime=createRuntime({gameplay:true,seed:613});
  const result=runtime.json(`(()=>{
    const fire=(y)=>{
      enemyBullets.push({pos:V(0,y,2),prev:V(0,y,2),vel:V(0,0,-100),life:0.04,dmg:8});
      updateEnemyBullets(0.05);
    };
    fire(1.5);const shoulder=player.hp;
    fire(1);const torso=player.hp;
    fire(2);const aboveHead=player.hp;
    __addBox({center:[0,1,0.7],size:[2,2,0.08]});
    fire(1);const covered=player.hp;
    return {shoulder,torso,aboveHead,covered,bullets:enemyBullets.length};
  })()`);
  assert.deepEqual(result,{shoulder:92,torso:84,aboveHead:84,covered:84,bullets:0});
});

test('enemies aim at elevated players and short sight rays exclude distant buildings',()=>{
  const runtime=createRuntime({gameplay:true,seed:614});
  const result=runtime.json(`(()=>{
    const part=()=>new THREE.Object3D();
    const enemy={alive:true,pos:V(0,0,6),vel:V(),cooldown:0,recoil:0,
      group:new THREE.Group(),path:[V(0,0,6)],target:0,walkPhase:0,
      parts:{torso:part()},partStates:{},disarmed:false};
    scene.add(enemy.group);enemies.push(enemy);player.pos.set(0,4,0);
    for(let i=0;i<100;i++)__addBox({center:[100+i*3,1,100],size:[1,2,1]});
    let distantRays=0;
    for(const mesh of __testMeshes){const raycast=mesh.raycast;
      mesh.raycast=function(...args){distantRays++;return raycast.apply(this,args);};}
    updateEnemies(1/120);
    return {upward:enemyBullets[0].vel.y>5,attacking:enemy.state==='attack',distantRays};
  })()`);
  assert.deepEqual(result,{upward:true,attacking:true,distantRays:0});
});

test('blast cover is sampled before destruction and shields actors as well as the player',()=>{
  const runtime=createRuntime({gameplay:true,seed:615});
  const result=runtime.json(`(()=>{
    player.pos.set(0,0,0);
    const epicenter=V(0,1,1.5),target=V(0,1,0);
    const exposed=blastExposureToPoint(epicenter,target);
    __addBox({center:[0,1,0.7],size:[2,2,0.08]});
    const covered=blastExposureToPoint(epicenter,target);
    explode(epicenter);
    return {exposed,covered,hp:player.hp};
  })()`);
  assert.equal(result.exposed,1);
  assert.equal(result.covered,0.22);
  assert.ok(result.hp>=98,'cover should greatly reduce self splash');
});

test('respawn clears traversal and held input, with brief protection from queued hits',()=>{
  const runtime=createRuntime({gameplay:true,seed:616});
  const result=runtime.json(`(()=>{
    player.hp=5;player.mode='vault';player.hold=2;player.vaultKind='quick';
    player.vaultRecovery=0.2;player.jumpBuffer=0.14;player.climbBuffer=0.1;
    keys.Space=true;keys.KeyW=true;mouseHeld=true;
    damagePlayer(8);damagePlayer(8);
    return {hp:player.hp,mode:player.mode,hold:player.hold,vault:player.vaultKind,
      recovery:player.vaultRecovery,jump:player.jumpBuffer,climb:player.climbBuffer,
      input:keys.Space||keys.KeyW||mouseHeld,shield:player.respawnShield};
  })()`);
  assert.deepEqual(result,{hp:100,mode:'ground',hold:-1,vault:'none',recovery:0,
    jump:0,climb:0,input:false,shield:1.5});
});

test('enemy blast momentum collides with thin walls instead of teleporting through them',()=>{
  const runtime=createRuntime({gameplay:true,seed:617});
  const result=runtime.json(`(()=>{
    __addBox({center:[0,1,-0.8],size:[3,2,0.06]});
    const enemy={pos:V(),vel:V(0,0,-30)};
    enemyWalkDirection.set(0,0,0);
    for(let i=0;i<30;i++)moveEnemyBody(enemy,1/120);
    return {z:enemy.pos.z,vz:enemy.vel.z};
  })()`);
  assert.ok(result.z>-0.5);
  assert.equal(result.vz,0);
});

test('rocket launch and integration use the shared ballistic acceleration',()=>{
  const runtime=createRuntime({gameplay:true,seed:618});
  const result=runtime.json(`(()=>{
    const start=V(0,5,0),target=V(0,5,-40),direct=V(0,0,-1),direction=V();
    solveRocketLaunch(start,target,direct,direction);fireRocket(start,direction);
    const time=40/(-direction.z*ROCKET_SPEED),steps=120,dt=time/steps;
    for(let i=0;i<steps;i++)updateRockets(dt);
    return {error:rockets[0].pos.distanceTo(target),gravity:ROCKET_GRAVITY,
      debrisGravity:DEBRIS_GRAVITY};
  })()`);
  assert.ok(result.error<1e-8);
  assert.equal(result.gravity,9.81);
  assert.equal(result.debrisGravity,result.gravity);
});

test('fast rigid fragments hit thin walls while nearby misses retain their trajectory',()=>{
  const runtime=createRuntime({gameplay:true,seed:619});
  const result=runtime.json(`(()=>{
    __addBox({center:[0,2,0],size:[0.06,4,4]});
    const fragment=(z)=>{
      const piece=new THREE.Mesh(new THREE.BoxGeometry(0.16,0.16,0.16),M.stone);
      piece.position.set(-1,2,z);
      piece.userData={size:V(0.16,0.16,0.16),mass:1,fractureKind:'stone'};
      scene.add(piece);prepareChunkBody(piece);piece.userData.vel.set(240,0,0);
      chunks.push(piece);return piece;
    };
    const hit=fragment(0),miss=fragment(2.1);
    updateChunks(1/120);
    return {hitX:hit.position.x,hitV:hit.userData.vel.x,
      missX:miss.position.x,missV:miss.userData.vel.x};
  })()`);
  assert.ok(result.hitX<-0.10,'a fragment must stop on the near side of the wall');
  assert.ok(result.hitV<=0,'contact should apply a rebound impulse');
  assert.ok(result.missX>0.9&&result.missV>230,'near misses must not hit an inflated sphere');
});

test('a protruding weapon muzzle cannot fire from the far side of cover',()=>{
  const runtime=createRuntime({gameplay:true,seed:620});
  const result=runtime.json(`(()=>{
    __addBox({center:[0,1,-0.5],size:[2,2,0.06]});
    const muzzle=resolveMuzzleObstruction(V(0,1.3,-0.9));
    rc.set(muzzle,V(0,0,-1));rc.near=0;rc.far=2;
    const hits=rc.intersectObjects(collectShotTargets(muzzle,V(0,0,-1),2),false);
    return {z:muzzle.z,hit:hits[0]&&hits[0].object===__testMeshes[0]};
  })()`);
  assert.ok(result.z>-0.47);
  assert.equal(result.hit,true);
});
