/* Enemy, dummy, pickup, and projectile updates. Loaded in order from index.html. */
function updateEnemies(dt){
  for(const e of enemies){
    if(!e.alive)continue;
    let moving=false;
    e.cooldown=Math.max(0,e.cooldown-dt);
    e.recoil=Math.max(0,e.recoil-dt*4);
    const toPlayer=enemyToPlayer.subVectors(player.pos,e.pos);
    toPlayer.y=0;
    const dist=toPlayer.length();
    if(dist>0.001)toPlayer.normalize();
    const seePlayer=dist<28;
    let blocked=false;
    if(seePlayer){
      enemyRayOrigin.set(e.pos.x,e.pos.y+1.5,e.pos.z);
      enemyRayDir.copy(toPlayer);
      rc.set(enemyRayOrigin,enemyRayDir);
      rc.far=dist;rc.near=0.1;
      const hits=rc.intersectObjects(occluders,false);
      if(hits.length&&hits[0].distance<dist-1)blocked=true;
    }
    if(seePlayer&&!blocked){
      e.state='attack';
      const desiredYaw=Math.atan2(toPlayer.x,toPlayer.z);
      e.group.rotation.y+=(desiredYaw-e.group.rotation.y)*(1-Math.exp(-6*dt));
      if(e.cooldown<=0){
        e.cooldown=1.6+Math.random()*0.6;
        e.recoil=0.15;
        enemyShoot(e,toPlayer);
      }
    }else{
      e.state='patrol';
      const wp=e.path[e.target];
      const to=enemyToPlayer.subVectors(wp,e.pos);to.y=0;
      if(to.length()<1.2){
        e.target=(e.target+1)%e.path.length;
      }else{
        to.normalize();
        e.pos.addScaledVector(to,2.2*dt);
        moving=true;
      }
      const desiredYaw=Math.atan2(to.x,to.z);
      e.group.rotation.y+=(desiredYaw-e.group.rotation.y)*(1-Math.exp(-6*dt));
    }
    e.group.position.copy(e.pos);
    e.walkPhase+=dt*(moving?10:2.2);
    const stride=moving?Math.sin(e.walkPhase)*0.62:Math.sin(e.walkPhase)*0.035;
    e.parts.leftLeg.rotation.x=stride;e.parts.rightLeg.rotation.x=-stride;
    e.parts.torso.rotation.z=moving?Math.sin(e.walkPhase*0.5)*0.035:0;
    if(e.state==='attack'){
      e.parts.leftArm.rotation.x=-0.98;e.parts.rightArm.rotation.x=-1.08-e.recoil*1.8;
    }else{
      e.parts.leftArm.rotation.x=-0.68-stride*0.16;
      e.parts.rightArm.rotation.x=-0.84+stride*0.12;
    }
    e.parts.gun.position.z=0.18-e.recoil*0.42;
  }
}
const enemyBullets=[];
const solidTargets=[];
const enemyToPlayer=V(),enemyRayOrigin=V(),enemyRayDir=V(),enemyBulletDelta=V(),enemyBulletRayDir=V();
const enemyBulletTravel=V(),enemyBulletClosest=V();
function enemyShoot(e,dir){
  const dmg=8;
  const origin=e.pos.clone().add(V(0,1.5,0));
  const spread=new THREE.Vector3((Math.random()-0.5)*0.05,(Math.random()-0.5)*0.05,(Math.random()-0.5)*0.05);
  const d=dir.clone().add(spread).normalize();
  const speed=22;
  enemyBullets.push({pos:origin.clone(),prev:origin.clone(),vel:d.multiplyScalar(speed),life:2.5,dmg,color:0xff8866});
}

function updateEnemyBullets(dt){
  if(enemyBullets.length===0)return;
  solidTargets.length=0;
  for(const mesh of occluders)solidTargets.push(mesh);
  for(let i=enemyBullets.length-1;i>=0;i--){
    const b=enemyBullets[i];
    b.prev.copy(b.pos);
    b.pos.addScaledVector(b.vel,dt);
    b.life-=dt;
    if(b.life<=0){enemyBullets.splice(i,1);continue;}
    enemyBulletTravel.subVectors(b.pos,b.prev);
    const travel=enemyBulletTravel.length();
    let wallDist=Infinity;
    if(travel>0.001){
      enemyBulletRayDir.copy(enemyBulletTravel).multiplyScalar(1/travel);
      rc.set(b.prev,enemyBulletRayDir);rc.far=travel+0.05;rc.near=0.001;
      const hits=rc.intersectObjects(solidTargets,false);
      if(hits.length)wallDist=hits[0].distance;
    }
    const travelSq=enemyBulletTravel.lengthSq();
    const hitT=travelSq>1e-6?Math.max(0,Math.min(1,enemyBulletDelta.subVectors(player.pos,b.prev).dot(enemyBulletTravel)/travelSq)):0;
    enemyBulletClosest.copy(b.prev).addScaledVector(enemyBulletTravel,hitT);
    const d=enemyBulletDelta.subVectors(enemyBulletClosest,player.pos);
    if(hitT*travel<=wallDist+0.02&&Math.abs(d.y)<1.2&&Math.hypot(d.x,d.z)<0.45){
      player.hp-=b.dmg;
      showHit();
      updateStatsUI();
      enemyBullets.splice(i,1);
      if(player.hp<=0){
        player.hp=100;
        player.pos.set(8,0,16);
        player.vel.set(0,0,0);
        player.mode='ground';
        player.landingSurface=null;
        updateStatsUI();
      }
      continue;
    }
    if(wallDist<Infinity)enemyBullets.splice(i,1);
  }
}

function updateDummies(dt){
  for(const d of dummies){
    if(d.alive){
      if(d.tilt>0){
        d.tilt=Math.max(0,d.tilt-dt*2);
        d.group.rotation.x=d.tilt*0.6;
        d.group.rotation.z=d.tilt*0.3;
      }
    }else{
      d.respawn-=dt;
      if(d.respawn<=0){
        d.alive=true;d.hp=20;d.tilt=0;
        d.group.visible=true;
        d.group.rotation.x=0;d.group.rotation.z=0;
      }
    }
  }
}
function updatePickups(dt){
  for(const p of pickups){
    if(p.alive){
      p.group.rotation.y+=dt*1.2;
    }else{
      p.respawn-=dt;
      if(p.respawn<=0){
        p.alive=true;p.group.visible=true;
      }
    }
  }
}
