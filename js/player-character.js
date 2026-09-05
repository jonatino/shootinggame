/* Player model, weapon rig, IK, animation, and camera. Loaded in order from index.html. */
const guy=new THREE.Group();
const tilt=new THREE.Group();
guy.add(tilt);
const skinM=new THREE.MeshLambertMaterial({color:0xd9a066});
const skinDarkM=new THREE.MeshLambertMaterial({color:0xa96d46});
const clothM=new THREE.MeshLambertMaterial({color:0x3b4a54});
const clothDarkM=new THREE.MeshLambertMaterial({color:0x27343c});
const armClothM=new THREE.MeshLambertMaterial({color:0x627b85});
const armLightM=new THREE.MeshLambertMaterial({color:0x89a3aa});
const armDarkM=new THREE.MeshLambertMaterial({color:0x34474e});
const gloveM=new THREE.MeshLambertMaterial({color:0x3b5159});
const pantsM=new THREE.MeshLambertMaterial({color:0x64503a});
const bootM=new THREE.MeshLambertMaterial({color:0x252321});
const gearM=new THREE.MeshLambertMaterial({color:0x4e5b5d});
const strapM=new THREE.MeshLambertMaterial({color:0x202727});
const helmetM=new THREE.MeshLambertMaterial({color:0x596663});

function bodyBox(w,h,d,mat){
  const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
  m.castShadow=true;m.receiveShadow=true;
  return m;
}
function limb(len,thick,mat){
  const g=new THREE.Group();
  /* A tapered low-poly limb keeps a readable silhouette while allowing the
     joints to rotate naturally instead of looking like hinged cuboids. */
  const m=new THREE.Mesh(new THREE.CylinderGeometry(thick*0.55,thick*0.7,len,8,1),mat);
  m.castShadow=true;m.receiveShadow=true;
  m.position.y=-len/2;
  g.add(m);
  return g;
}

const pelvis=new THREE.Group();
pelvis.position.y=0.92;tilt.add(pelvis);
const pelvisShell=bodyBox(0.4,0.22,0.28,pantsM);
pelvisShell.position.y=-0.02;pelvis.add(pelvisShell);
const belt=bodyBox(0.46,0.08,0.3,strapM);
belt.position.y=0.1;pelvis.add(belt);

const torso=new THREE.Group();
torso.position.y=1.18;tilt.add(torso);
const torsoShell=bodyBox(0.46,0.58,0.3,clothM);
torsoShell.position.y=0.1;torso.add(torsoShell);
const chestPlate=bodyBox(0.34,0.28,0.035,gearM);
chestPlate.position.set(0,0.18,0.165);torso.add(chestPlate);
const chestStrapL=bodyBox(0.045,0.5,0.035,strapM);
chestStrapL.position.set(0.15,0.13,0.18);chestStrapL.rotation.z=-0.08;torso.add(chestStrapL);
const chestStrapR=chestStrapL.clone();
chestStrapR.position.x=-0.15;chestStrapR.rotation.z=0.08;torso.add(chestStrapR);
const pouchL=bodyBox(0.11,0.12,0.08,gearM);
pouchL.position.set(0.19,0.03,0.17);torso.add(pouchL);
const pouchR=pouchL.clone();
pouchR.position.x=-0.19;torso.add(pouchR);
const neck=new THREE.Mesh(new THREE.CylinderGeometry(0.09,0.1,0.13,8),skinDarkM);
neck.position.y=0.46;neck.castShadow=true;torso.add(neck);

const head=new THREE.Group();
head.position.y=1.78;tilt.add(head);
const face=new THREE.Mesh(new THREE.SphereGeometry(0.17,12,10),skinM);
face.scale.set(0.92,1.08,0.9);face.castShadow=true;head.add(face);
const hair=new THREE.Mesh(new THREE.SphereGeometry(0.175,10,8,0,Math.PI*2,0,Math.PI*0.5),clothDarkM);
hair.position.y=0.035;hair.castShadow=true;head.add(hair);
const helmet=new THREE.Mesh(new THREE.SphereGeometry(0.205,12,8,0,Math.PI*2,0,Math.PI*0.55),helmetM);
helmet.position.y=0.08;helmet.castShadow=true;head.add(helmet);
const visor=bodyBox(0.22,0.045,0.035,strapM);
visor.position.set(0,0.045,0.16);head.add(visor);
const earL=new THREE.Mesh(new THREE.SphereGeometry(0.045,8,6),skinM);
earL.position.set(0.17,0,0);earL.castShadow=true;head.add(earL);
const earR=earL.clone();earR.position.x=-0.17;head.add(earR);

const pack=bodyBox(0.32,0.42,0.15,gearM);
pack.position.set(0,1.28,-0.2);tilt.add(pack);
const packTop=bodyBox(0.23,0.12,0.17,clothDarkM);
packTop.position.set(0,1.51,-0.2);tilt.add(packTop);

function makeArm(sx){
  /* The chase camera sits behind the character while climbing. The rear of the
     vest is local -Z, so the shoulder joint must sit just behind the pack; the
     old near-center depth left only two shoulder pads visible when the elbows
     bent toward a wall. */
  const sh=new THREE.Group();sh.position.set(sx,1.51,-0.24);tilt.add(sh);
  const shoulder=new THREE.Mesh(new THREE.SphereGeometry(0.15,12,8),armClothM);
  shoulder.scale.set(1,0.74,1);shoulder.position.y=-0.015;shoulder.castShadow=true;shoulder.receiveShadow=true;sh.add(shoulder);
  const shoulderPad=bodyBox(0.23,0.13,0.2,gearM);
  shoulderPad.position.set(sx>0?0.04:-0.04,-0.035,0.045);sh.add(shoulderPad);
  const shoulderCap=bodyBox(0.14,0.075,0.055,armLightM);
  shoulderCap.position.set(sx>0?0.015:-0.015,-0.035,0.15);sh.add(shoulderCap);
  const upperSleeve=limb(0.42,0.21,armClothM);sh.add(upperSleeve);
  const upperPanel=bodyBox(0.13,0.2,0.055,armLightM);
  upperPanel.position.set(sx>0?0.025:-0.025,-0.19,0.1);upperSleeve.add(upperPanel);
  const sleeveBand=new THREE.Mesh(new THREE.CylinderGeometry(0.115,0.115,0.06,8),strapM);
  sleeveBand.position.y=-0.39;sleeveBand.castShadow=true;upperSleeve.add(sleeveBand);
  const up=upperSleeve;
  const el=new THREE.Group();el.position.y=-0.42;up.add(el);
  const elbowPad=new THREE.Mesh(new THREE.SphereGeometry(0.085,9,7),gearM);
  elbowPad.scale.set(1,0.8,0.9);elbowPad.position.y=-0.02;elbowPad.castShadow=true;el.add(elbowPad);
  const forearmGuard=bodyBox(0.19,0.13,0.19,gearM);
  forearmGuard.position.set(sx>0?0.018:-0.018,-0.17,0.045);el.add(forearmGuard);
  const lo=limb(0.33,0.175,armClothM);el.add(lo);
  const forearmPanel=bodyBox(0.12,0.19,0.055,armLightM);
  forearmPanel.position.set(sx>0?0.02:-0.02,-0.19,0.095);lo.add(forearmPanel);
  const cuff=new THREE.Mesh(new THREE.CylinderGeometry(0.097,0.108,0.07,8),strapM);
  cuff.position.y=-0.305;cuff.castShadow=true;el.add(cuff);
  /* A separate hand group is the visual end-effector. It stays attached to
     the IK chain, but can also rotate its palm into a wall or weapon grip. */
  const hand=new THREE.Group();hand.position.y=-0.34;el.add(hand);
  const palm=bodyBox(0.2,0.15,0.22,gloveM);
  palm.position.set(0,-0.045,0.015);hand.add(palm);
  const knuckle=bodyBox(0.18,0.05,0.18,strapM);
  knuckle.position.set(0,-0.115,0.02);hand.add(knuckle);
  const wrist=bodyBox(0.13,0.075,0.14,gloveM);
  wrist.position.y=0.02;hand.add(wrist);
  const thumb=bodyBox(0.075,0.13,0.105,gloveM);
  thumb.position.set(sx>0?0.075:-0.075,-0.045,0.025);
  thumb.rotation.z=sx>0?-0.42:0.42;hand.add(thumb);
  const fingers=[];
  for(const fx of[-0.05,0,0.05]){
    const finger=bodyBox(0.042,0.085,0.1,gloveM);
    finger.position.set(fx,-0.115,-0.035);finger.rotation.x=sx>0?0.12:-0.12;hand.add(finger);
    fingers.push(finger);
  }
  sh.traverse(o=>{if(o.isMesh)o.frustumCulled=false;});
  return {root:sh,joint:el,hand,sh,el,thumb,fingers,side:sx>0?1:-1,upperLength:0.42,lowerLength:0.33};
}
function makeLeg(sx){
  const hip=new THREE.Group();hip.position.set(sx,0.92,0);tilt.add(hip);
  const th=limb(0.5,0.15,pantsM);hip.add(th);
  const kn=new THREE.Group();kn.position.y=-0.5;th.add(kn);
  const kneePad=new THREE.Mesh(new THREE.SphereGeometry(0.09,8,6),gearM);
  kneePad.scale.set(1,0.65,0.8);kneePad.position.set(0,-0.02,0.02);kneePad.castShadow=true;kn.add(kneePad);
  const sn=limb(0.48,0.13,pantsM);kn.add(sn);
  /* The lower leg solver stops at the ankle. Keeping the boot in its own
     group lets the sole follow a real ground or wall normal without bending
     the shin or fighting the two-bone IK. */
  const foot=new THREE.Group();foot.position.y=-0.48;kn.add(foot);
  const boot=bodyBox(0.17,0.14,0.3,bootM);
  boot.position.set(0,-0.02,0.075);foot.add(boot);
  const sole=bodyBox(0.18,0.035,0.31,strapM);
  sole.position.set(0,-0.095,0.075);foot.add(sole);
  return {root:hip,joint:kn,hip,kn,foot,upperLength:0.5,lowerLength:0.48};
}
const armL=makeArm(0.4),armR=makeArm(-0.4);
const legL=makeLeg(0.13),legR=makeLeg(-0.13);
scene.add(guy);

const gunBaseZ=0.34;
const gunGroup=new THREE.Group();
gunGroup.position.set(0.24,1.23,gunBaseZ);
tilt.add(gunGroup);

const gunPistol=new THREE.Group();
const pistolBody=bodyBox(0.07,0.09,0.22,M.metal);gunPistol.add(pistolBody);
const pistolSlide=bodyBox(0.075,0.04,0.18,M.dark);
pistolSlide.position.set(0,0.055,0.015);gunPistol.add(pistolSlide);
const pistolGrip=bodyBox(0.08,0.14,0.07,M.dark);
pistolGrip.position.set(0,-0.1,-0.05);gunPistol.add(pistolGrip);
const pistolGuard=new THREE.Mesh(new THREE.TorusGeometry(0.045,0.012,5,8,Math.PI),M.metal);
pistolGuard.rotation.x=Math.PI/2;pistolGuard.position.set(0,-0.035,0.02);pistolGuard.castShadow=true;gunPistol.add(pistolGuard);
/* The sidearm used to have no readable barrel, so from the chase camera it
   collapsed into the trigger hand and looked like a missing weapon/forearm.
   Give it a short muzzle and front block that share the same local -Z axis as
   the other weapons. */
const pistolBarrel=new THREE.Mesh(new THREE.CylinderGeometry(0.024,0.024,0.11,8),M.metal);
pistolBarrel.rotation.x=Math.PI/2;pistolBarrel.position.set(0,0.02,-0.145);
pistolBarrel.castShadow=true;gunPistol.add(pistolBarrel);
const pistolMuzzle=new THREE.Mesh(new THREE.TorusGeometry(0.027,0.008,5,8),M.dark);
pistolMuzzle.rotation.x=Math.PI/2;pistolMuzzle.position.set(0,0.02,-0.205);
pistolMuzzle.castShadow=true;gunPistol.add(pistolMuzzle);
gunPistol.scale.setScalar(1.28);
gunGroup.add(gunPistol);

const gunRifle=new THREE.Group();
const rifleBody=bodyBox(0.08,0.1,0.62,M.metal);gunRifle.add(rifleBody);
const rifleStock=bodyBox(0.09,0.16,0.18,M.woodDark);
rifleStock.position.set(0,-0.02,0.22);gunRifle.add(rifleStock);
const rifleMag=bodyBox(0.06,0.1,0.1,M.dark);
rifleMag.position.set(0,-0.13,0.05);gunRifle.add(rifleMag);
const rifleSight=bodyBox(0.025,0.06,0.07,M.dark);
rifleSight.position.set(0,0.08,-0.12);gunRifle.add(rifleSight);
const rifleBarrel=new THREE.Mesh(new THREE.CylinderGeometry(0.025,0.025,0.26,8),M.metal);
rifleBarrel.rotation.x=Math.PI/2;rifleBarrel.position.set(0,0,-0.43);rifleBarrel.castShadow=true;gunRifle.add(rifleBarrel);
gunGroup.add(gunRifle);

const gunShotgun=new THREE.Group();
const shotBody=bodyBox(0.09,0.11,0.74,M.woodDark);gunShotgun.add(shotBody);
const shotBarrel=new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.04,0.5,10),M.metal);
shotBarrel.rotation.x=Math.PI/2;shotBarrel.position.set(0,0.01,-0.32);shotBarrel.castShadow=true;gunShotgun.add(shotBarrel);
const shotStock=bodyBox(0.09,0.14,0.16,M.wood);
shotStock.position.set(0,-0.02,0.28);gunShotgun.add(shotStock);
const shotFront=bodyBox(0.11,0.12,0.12,M.metal);
shotFront.position.set(0,0,-0.56);gunShotgun.add(shotFront);
gunGroup.add(gunShotgun);

const gunRpg=new THREE.Group();
const rpgTubeMesh=new THREE.Mesh(new THREE.CylinderGeometry(0.08,0.08,0.9,12),M.rpg);
rpgTubeMesh.rotation.x=Math.PI/2;rpgTubeMesh.position.set(0,0.02,-0.2);rpgTubeMesh.castShadow=true;gunRpg.add(rpgTubeMesh);
const rpgHead=new THREE.Mesh(new THREE.ConeGeometry(0.09,0.28,10),M.metal);
rpgHead.rotation.x=-Math.PI/2;rpgHead.position.set(0,0.02,-0.62);rpgHead.castShadow=true;gunRpg.add(rpgHead);
const rpgGrip=bodyBox(0.08,0.16,0.08,M.woodDark);
rpgGrip.position.set(0,-0.1,0.05);gunRpg.add(rpgGrip);
const rpgSight=bodyBox(0.02,0.05,0.02,M.dark);
rpgSight.position.set(0,0.13,-0.4);gunRpg.add(rpgSight);
const rpgRear=bodyBox(0.12,0.12,0.08,M.dark);
rpgRear.position.set(0,0.02,0.32);gunRpg.add(rpgRear);
/* A drum and exposed feed rack make the rapid-fire launcher readable from the
   chase camera instead of looking like the original single-shot tube. */
const rpgDrum=new THREE.Mesh(new THREE.CylinderGeometry(0.13,0.13,0.11,12),M.dark);
rpgDrum.rotation.z=Math.PI/2;rpgDrum.position.set(0,-0.12,-0.03);
rpgDrum.castShadow=true;gunRpg.add(rpgDrum);
const rpgFeed=bodyBox(0.05,0.08,0.34,M.metal);
rpgFeed.position.set(-0.1,-0.055,-0.12);rpgFeed.rotation.z=-0.16;gunRpg.add(rpgFeed);
for(let i=0;i<4;i++){
  const round=new THREE.Mesh(new THREE.CylinderGeometry(0.025,0.025,0.075,7),M.rpg);
  round.rotation.x=Math.PI/2;
  round.position.set(-0.105,-0.02-i*0.035,-0.23+i*0.075);
  round.castShadow=true;gunRpg.add(round);
}
gunGroup.add(gunRpg);

const gunCannon=new THREE.Group();
const cannonReceiver=bodyBox(0.2,0.18,0.44,M.dark);
cannonReceiver.position.set(0,0,0.13);gunCannon.add(cannonReceiver);
const cannonStock=bodyBox(0.16,0.2,0.22,M.metal);
cannonStock.position.set(0,0,0.39);gunCannon.add(cannonStock);
const cannonGrip=bodyBox(0.09,0.18,0.09,M.woodDark);
cannonGrip.position.set(0,-0.15,0.18);gunCannon.add(cannonGrip);
const cannonDrum=new THREE.Mesh(new THREE.CylinderGeometry(0.16,0.16,0.16,14),M.metal);
cannonDrum.rotation.z=Math.PI/2;cannonDrum.position.set(0.15,-0.08,0.14);
cannonDrum.castShadow=true;gunCannon.add(cannonDrum);
/* Six long barrels rotate as one assembly around the weapon's local -Z axis. */
const cannonRotor=new THREE.Group();
for(let i=0;i<6;i++){
  const angle=i*Math.PI/3;
  const barrel=new THREE.Mesh(new THREE.CylinderGeometry(0.018,0.018,0.76,7),M.metal);
  barrel.rotation.x=Math.PI/2;
  barrel.position.set(Math.cos(angle)*0.057,Math.sin(angle)*0.057,-0.46);
  barrel.castShadow=true;barrel.userData.cannonBarrel=true;
  cannonRotor.add(barrel);
}
const cannonMuzzleRing=new THREE.Mesh(new THREE.TorusGeometry(0.075,0.016,6,12),M.dark);
cannonMuzzleRing.rotation.x=Math.PI/2;cannonMuzzleRing.position.z=-0.8;
cannonMuzzleRing.castShadow=true;cannonRotor.add(cannonMuzzleRing);
const cannonRearRing=new THREE.Mesh(new THREE.TorusGeometry(0.075,0.02,6,12),M.dark);
cannonRearRing.rotation.x=Math.PI/2;cannonRearRing.position.z=-0.12;
cannonRearRing.castShadow=true;cannonRotor.add(cannonRearRing);
gunCannon.add(cannonRotor);
let cannonRotorSpeed=0;
gunGroup.add(gunCannon);

function updateGunVisual(){
  gunPistol.visible=playerWpn.cur==='pistol';
  gunRifle.visible=playerWpn.cur==='rifle';
  gunShotgun.visible=playerWpn.cur==='shotgun';
  gunRpg.visible=playerWpn.cur==='rpg';
  gunCannon.visible=playerWpn.cur==='cannon';
}
updateGunVisual();

/* A weapon's barrel frame is not a hand frame. Keep the wrist palms turned
   toward the grip sides while preserving the weapon's up axis, so fingers
   still curl down around vertical pistol/rifle grips instead of pointing
   toward the muzzle. */
const gripPrimaryQ=new THREE.Quaternion().setFromAxisAngle(UP,Math.PI*0.5);
const gripSupportQ=new THREE.Quaternion().setFromAxisAngle(UP,-Math.PI*0.5);
const weaponHoldProfiles={
  /* Keep the weapon on the camera-side shoulder and just ahead of the chest.
     The old mounts lived too close to the spine, so the torso hid short guns
     from the chase camera even though the IK hand technically reached them. */
  /* The primary hand approaches from the character's right side; the support
     hand approaches from the opposite side of the foregrip. These frames are
     deliberately separate from the barrel frame so the palms wrap the weapon
     instead of facing forward like a neutral pose. */
  pistol:{mount:[-0.62,1.34,0.12],primary:[0,-0.05,-0.03],support:null,offHand:[0.35,0.82,0.02],primaryGrip:gripPrimaryQ},
  rifle:{mount:[-0.44,1.34,0.19],primary:[0,-0.07,0.14],support:[-0.05,-0.03,-0.18],primaryGrip:gripPrimaryQ,supportGrip:gripSupportQ},
  shotgun:{mount:[-0.43,1.34,0.18],primary:[0,-0.07,0.22],support:[-0.05,-0.025,-0.25],primaryGrip:gripPrimaryQ,supportGrip:gripSupportQ},
  rpg:{mount:[-0.4,1.37,0.17],primary:[0,-0.07,0.05],support:[-0.04,-0.015,-0.28],primaryGrip:gripPrimaryQ,supportGrip:gripSupportQ},
  cannon:{mount:[-0.42,1.35,0.19],primary:[0,-0.09,0.18],support:[-0.06,-0.02,-0.24],primaryGrip:gripPrimaryQ,supportGrip:gripSupportQ}
};
const weaponMuzzlePoints={
  pistol:[0,0.02,-0.21],
  rifle:[0,0,-0.58],
  shotgun:[0,0.01,-0.62],
  rpg:[0,0.02,-0.82],
  cannon:[0,0,-0.86]
};
const ikShoulder=V(),ikReach=V(),ikDirection=V(),ikEffectiveTarget=V(),ikBend=V();
const ikElbow=V(),ikUpperDir=V(),ikLowerDir=V();
const ikFrameX=V(),ikFrameY=V(),ikFrameZ=V(),ikLocalBend=V();
const ikUpperQ=new THREE.Quaternion(),ikLowerQ=new THREE.Quaternion(),ikInverseQ=new THREE.Quaternion();
const ikFrameMatrix=new THREE.Matrix4();
const handPalmNormal=V(),handBasisX=V(),handBasisY=V(),handBasisZ=V();
const handWorldQ=new THREE.Quaternion(),handParentQ=new THREE.Quaternion(),handLocalQ=new THREE.Quaternion();
const handBasis=new THREE.Matrix4(),handNeutralQ=new THREE.Quaternion();
const bendClimbL=V(),bendClimbR=V();
const bendVaultL=V(1,-0.08,-0.55),bendVaultR=V(-1,-0.08,-0.55);
const bendGroundL=V(1,-0.32,-0.72),bendGroundR=V(-1,-0.32,-0.72);
const bendFootClimbL=V(),bendFootClimbR=V();
const bendFootVaultL=V(0.12,0,1),bendFootVaultR=V(-0.12,0,1);
const bendFootGroundL=V(0.12,0,1),bendFootGroundR=V(-0.12,0,1);
const aimWorld=V(),bodyForward=V(),bodyRight=V();
const handWorldL=V(),handWorldR=V(),handTargetL=V(),handTargetR=V();
const climbHandWorldL=V(),climbHandWorldR=V();
const climbFootWorldL=V(),climbFootWorldR=V();
const climbFootFromL=V(),climbFootToL=V(),climbFootFromR=V(),climbFootToR=V();
const climbHandNormalL=V(0,0,1),climbHandNormalR=V(0,0,1);
const climbHandPathFrom=V(),climbHandPathTo=V(),climbSideFrom=V(),climbSideTo=V();
const vaultHandWorldL=V(),vaultHandWorldR=V(),vaultBraceL=V(),vaultBraceR=V();
const vaultHandNormal=V();
const groundFootWorldL=V(),groundFootWorldR=V();
const climbHoldNormal=V(),climbSideAxis=V();
const footTargetL=V(),footTargetR=V();
const wallNormal=V();
const hangFromPos=V(),hangToPos=V();
const climbFootSearchDelta=V(),climbFootProbe=V(),climbFootRay=V(),climbFootActual=V();
const climbFootBestPoint=V(),climbFootBestNormal=V(0,0,1);
const climbFootNormalL=V(0,0,1),climbFootNormalR=V(0,0,1);
const climbRenderClearFrom=V(),climbRenderClearDelta=V();
const groundFootNormalL=V(0,1,0),groundFootNormalR=V(0,1,0);
const vaultFootAuthoredL=V(),vaultFootAuthoredR=V();
const vaultPlantLocalL=V(),vaultPlantLocalR=V();
const footWorldUp=V(),footAdjustQ=new THREE.Quaternion(),footWorldQ=new THREE.Quaternion();
const footParentQ=new THREE.Quaternion(),footTargetQ=new THREE.Quaternion();
const footPoseQ=new THREE.Quaternion(),footPoseEuler=new THREE.Euler();
const weaponWorldQ=new THREE.Quaternion();
const climbRigInverseQ=new THREE.Quaternion();
const climbPoleWorld=V(),climbPoleSide=V(),climbPoleNormal=V();
const PLAYER_BODY_LIFT=0.15;
const CLIMB_FOOT_DROP=1.68,CLIMB_FOOT_MIN_HEIGHT=0.12,CLIMB_FOOT_MAX_HEIGHT=0.42;
const CLIMB_FOOT_SPREAD=0.2;

function angDiff(a,b){let d=(a-b)%(Math.PI*2);if(d>Math.PI)d-=Math.PI*2;if(d<-Math.PI)d+=Math.PI*2;return d;}
function dampValue(a,b,rate,dt){return a+(b-a)*(1-Math.exp(-rate*dt));}
function dampAngle(a,b,rate,dt){return a+angDiff(b,a)*(1-Math.exp(-rate*dt));}

function setStableLimbQuaternion(direction,pole,out){
  /* A shortest-arc quaternion is undefined when DOWN and the limb direction
     are almost opposite. That is exactly the normal overhead climbing pose,
     so tiny surface changes could flip an arm's twist by 180 degrees. Build a
     complete frame from the limb direction and its elbow pole instead. */
  ikFrameY.copy(direction).negate().normalize();
  ikFrameX.copy(pole).addScaledVector(ikFrameY,-pole.dot(ikFrameY));
  if(ikFrameX.lengthSq()<0.0001){
    if(Math.abs(ikFrameY.x)<0.75)ikFrameX.set(1,0,0);
    else ikFrameX.set(0,0,1);
    ikFrameX.addScaledVector(ikFrameY,-ikFrameX.dot(ikFrameY));
  }
  ikFrameX.normalize();
  ikFrameZ.crossVectors(ikFrameX,ikFrameY).normalize();
  ikFrameX.crossVectors(ikFrameY,ikFrameZ).normalize();
  ikFrameMatrix.makeBasis(ikFrameX,ikFrameY,ikFrameZ);
  out.setFromRotationMatrix(ikFrameMatrix).normalize();
  return out;
}

function applyLimbIK(chain,target,bendDir,blend){
  if(!Number.isFinite(target.x)||!Number.isFinite(target.y)||!Number.isFinite(target.z))return;
  blend=Math.max(0,Math.min(1,blend));
  /* Smooth the end-effector, then solve one complete two-bone pose. Slerping
     the upper arm and forearm independently made each segment represent a
     different point in time; during a climbing transfer that could fold the
     forearm behind the head even though both endpoint poses were valid. */
  if(!chain.ikTarget)chain.ikTarget=target.clone();
  else chain.ikTarget.lerp(target,blend);
  ikShoulder.copy(chain.root.position);
  ikReach.copy(chain.ikTarget).sub(ikShoulder);
  const rawDistance=ikReach.length();
  if(!Number.isFinite(rawDistance)||rawDistance<0.001)return;
  const distance=Math.max(Math.abs(chain.upperLength-chain.lowerLength)+0.01,
    Math.min(chain.upperLength+chain.lowerLength-0.01,rawDistance));
  ikDirection.copy(ikReach).multiplyScalar(1/rawDistance);
  ikEffectiveTarget.copy(ikShoulder).addScaledVector(ikDirection,distance);
  /* Keep the visible end-effector on the point the two-bone chain actually
     solved. Previously only the elbow math was clamped; an unreachable hand
     target stayed in space, leaving a forearm/hand gap that looked like a
     missing arm during a wide weapon aim or a corner climb. */
  target.copy(ikEffectiveTarget);
  chain.ikTarget.copy(ikEffectiveTarget);
  ikBend.copy(bendDir).addScaledVector(ikDirection,-bendDir.dot(ikDirection));
  if(ikBend.lengthSq()<0.001){
    ikBend.set(1,0,0).addScaledVector(ikDirection,-ikDirection.x);
    if(ikBend.lengthSq()<0.001)ikBend.set(0,0,1).addScaledVector(ikDirection,-ikDirection.z);
  }
  ikBend.normalize();
  const cosA=Math.max(-1,Math.min(1,(chain.upperLength*chain.upperLength+distance*distance-chain.lowerLength*chain.lowerLength)/(2*chain.upperLength*distance)));
  const sinA=Math.sqrt(Math.max(0,1-cosA*cosA));
  ikElbow.copy(ikShoulder)
    .addScaledVector(ikDirection,cosA*chain.upperLength)
    .addScaledVector(ikBend,sinA*chain.upperLength);
  ikUpperDir.copy(ikElbow).sub(ikShoulder).normalize();
  setStableLimbQuaternion(ikUpperDir,ikBend,ikUpperQ);
  ikLowerDir.copy(ikEffectiveTarget).sub(ikElbow).normalize();
  ikInverseQ.copy(ikUpperQ).invert();
  ikLowerDir.applyQuaternion(ikInverseQ);
  ikLocalBend.copy(ikBend).applyQuaternion(ikInverseQ);
  setStableLimbQuaternion(ikLowerDir,ikLocalBend,ikLowerQ);
  chain.root.quaternion.copy(ikUpperQ);
  chain.joint.quaternion.copy(ikLowerQ);
}

/* Climbing joint poles are authored in the wall's world-space frame and then
   converted into the tilted character frame used by the two-bone solver. This
   keeps left/right anatomical meaning stable around corners and while the body
   leans; local XYZ constants made an elbow's "out" direction turn into "in"
   as soon as the root rotated onto a different face. */
function setClimbPole(normal,side,sideWeight,wallWeight,upWeight,out){
  climbPoleNormal.copy(normal);
  if(climbPoleNormal.lengthSq()<0.04)climbPoleNormal.copy(bodyForward).negate();
  climbPoleNormal.setY(0);
  if(climbPoleNormal.lengthSq()<0.04)climbPoleNormal.set(0,0,1);
  else climbPoleNormal.normalize();
  climbPoleSide.crossVectors(UP,climbPoleNormal);
  if(climbPoleSide.lengthSq()<0.04)climbPoleSide.set(1,0,0);
  else climbPoleSide.normalize();
  climbPoleWorld.copy(climbPoleSide).multiplyScalar(side*sideWeight)
    .addScaledVector(climbPoleNormal,wallWeight)
    .addScaledVector(UP,upWeight);
  out.copy(climbPoleWorld).applyQuaternion(climbRigInverseQ).normalize();
  return out;
}

function poseHandToSurface(chain,normal,blend){
  if(!chain.hand)return;
  /* Local +Z is the palm face. Turn it into the wall instead of leaving the
     glove as a ball with no contact direction; keeping local Y projected from
     world up also makes fingers point upward on a vertical climb. */
  handPalmNormal.copy(normal||UP).normalize().negate();
  handBasisY.copy(UP).addScaledVector(handPalmNormal,-UP.dot(handPalmNormal));
  if(handBasisY.lengthSq()<0.04)handBasisY.set(0,0,1);
  handBasisY.normalize();
  handBasisX.crossVectors(handBasisY,handPalmNormal).normalize();
  handBasisZ.copy(handPalmNormal);
  handBasis.makeBasis(handBasisX,handBasisY,handBasisZ);
  handWorldQ.setFromRotationMatrix(handBasis);
  chain.hand.parent.getWorldQuaternion(handParentQ).invert();
  handLocalQ.copy(handParentQ).multiply(handWorldQ);
  chain.hand.quaternion.slerp(handLocalQ,blend);
}

function relaxHand(chain,blend){
  if(chain.hand)chain.hand.quaternion.slerp(handNeutralQ,blend);
}

function updateHandDetail(chain,state,dt){
  /* The end-effector is part of the arm rig, so give it a small, stateful grip
     pose as well. Open fingers in a wall hold make the hands look detached;
     fully frozen fingers make a weapon look glued to the palm. */
  if(!chain||!chain.fingers)return;
  const curl=state==='climb'?0.62:(state==='vault'?0.5:(state==='weapon'?0.38:0.08));
  const spread=state==='climb'?0.02:(state==='weapon'?0.01:0.04);
  for(let i=0;i<chain.fingers.length;i++){
    const finger=chain.fingers[i];
    const target=(chain.side>0?1:-1)*(0.1+curl+i*0.035);
    finger.rotation.x=dampValue(finger.rotation.x,target,20,dt);
    finger.position.x=dampValue(finger.position.x,(-0.05+i*0.05)*(1-spread),20,dt);
  }
  if(chain.thumb){
    const target=(chain.side>0?-1:1)*(0.28+curl*0.2);
    chain.thumb.rotation.z=dampValue(chain.thumb.rotation.z,target,18,dt);
  }
}

function poseHandToWeapon(chain,blend,gripFrame){
  if(!chain.hand)return;
  /* Match the palm's local axes to the weapon's grip frame. The offset is
     applied in weapon space, so aim, recoil, and the traversal sling all keep
     working without rebuilding or allocating a hand rig. */
  gunGroup.getWorldQuaternion(weaponWorldQ);
  handWorldQ.copy(weaponWorldQ);
  if(gripFrame)handWorldQ.multiply(gripFrame);
  chain.hand.parent.getWorldQuaternion(handParentQ).invert();
  handLocalQ.copy(handParentQ).multiply(handWorldQ);
  chain.hand.quaternion.slerp(handLocalQ,blend);
}

function holdWorldPoint(h,side,out){
  /* Keep the palm just outside the wall plane; the elbow pole bends away from it. */
  holdSurfaceAnchor(h,climbSurfacePoint,climbSurfaceNormal);
  climbSideAxis.crossVectors(UP,climbSurfaceNormal);
  if(climbSideAxis.lengthSq()<0.04)climbSideAxis.set(1,0,0);
  else climbSideAxis.normalize();
  out.copy(climbSurfacePoint).addScaledVector(UP,0.05)
    .addScaledVector(climbSurfaceNormal,CLIMB_HAND_OFFSET).addScaledVector(climbSideAxis,side);
  return out;
}

function lerpHoldWorld(a,b,t,side,out,normalOut){
  t=Math.max(0,Math.min(1,t));
  holdSurfaceAnchor(a,climbSurfacePoint,climbNormalFrom);
  holdSurfaceAnchor(b,climbSurfacePointB,climbNormalTo);
  /* Interpolate the complete hand-contact frames, not only the surface
     centroids. On a corner the old code lerped the point first and then
     applied one averaged tangent, which could swing a wrist through the rock
     or pull both arms toward the same screen-space point. */
  climbSideFrom.crossVectors(UP,climbNormalFrom);
  if(climbSideFrom.lengthSq()<0.04)climbSideFrom.set(1,0,0);
  else climbSideFrom.normalize();
  climbSideTo.crossVectors(UP,climbNormalTo);
  if(climbSideTo.lengthSq()<0.04)climbSideTo.set(1,0,0);
  else climbSideTo.normalize();
  climbHandPathFrom.copy(climbSurfacePoint).addScaledVector(UP,0.05)
    .addScaledVector(climbNormalFrom,CLIMB_HAND_OFFSET)
    .addScaledVector(climbSideFrom,side);
  climbHandPathTo.copy(climbSurfacePointB).addScaledVector(UP,0.05)
    .addScaledVector(climbNormalTo,CLIMB_HAND_OFFSET)
    .addScaledVector(climbSideTo,side);
  out.lerpVectors(climbHandPathFrom,climbHandPathTo,t);
  climbHoldNormal.copy(climbNormalFrom).lerp(climbNormalTo,t);
  if(climbHoldNormal.lengthSq()<0.001)climbHoldNormal.copy(t<0.5?climbNormalFrom:climbNormalTo);
  climbHoldNormal.normalize();
  if(normalOut)normalOut.copy(climbHoldNormal);
  return out;
}

function climbFootPoint(h,side,out,normalOut){
  if(!h)return out;
  holdSurfaceAnchor(h,climbSurfacePoint,climbSurfaceNormal);
  climbSideAxis.crossVectors(UP,climbSurfaceNormal);
  if(climbSideAxis.lengthSq()<0.04)climbSideAxis.set(1,0,0);
  else climbSideAxis.normalize();
  /* The player root is the planted-foot datum. Put both ankles below the hips
     and within the actual 0.98-unit leg chain, rather than borrowing the first
     adjacent graph node (which is normally another handhold above the pelvis). */
  const footY=Math.max(player.pos.y+CLIMB_FOOT_MIN_HEIGHT,
    Math.min(player.pos.y+CLIMB_FOOT_MAX_HEIGHT,climbSurfacePoint.y-CLIMB_FOOT_DROP));
  out.copy(climbSurfacePoint).addScaledVector(climbSurfaceNormal,CLIMB_FOOT_OFFSET)
    .addScaledVector(climbSideAxis,side);
  out.y=footY;
  if(normalOut)normalOut.copy(climbSurfaceNormal);
  /* Re-project that anatomical target onto the real face. The ray sample
     already contains the requested lateral spread, so the returned hit must
     not add the spread a second time (the old double offset crossed the legs). */
  climbFootSearchDelta.copy(out);
  climbFootRay.copy(climbSurfaceNormal).negate();
  const targets=climbBodySurfaceMeshes(h);
  const footRoot=holdSurfaceRoot(h);
  let bestScore=Infinity;
  for(let vi=0;vi<3;vi++){
    const vertical=vi===0?0:(vi===1?0.18:-0.18);
    for(let li=0;li<3;li++){
      const lateral=li===0?0:(li===1?-0.1:0.1);
      climbFootProbe.copy(climbFootSearchDelta)
        .addScaledVector(UP,vertical)
        .addScaledVector(climbSideAxis,lateral)
        .addScaledVector(climbSurfaceNormal,1.2);
      rc.set(climbFootProbe,climbFootRay);rc.far=2.5;rc.near=0.001;
      const hits=rc.intersectObjects(targets,false);
      for(const hit of hits){
        climbFootActual.copy(wn(hit,hit.object,worldNormalScratch)).setY(0);
        const normalDot=climbFootActual.dot(climbSurfaceNormal);
        if(climbFootActual.lengthSq()<0.04||normalDot<0.04||
           !colliderMatchesSurface(hit.object,footRoot,null))continue;
        climbFootActual.normalize();
        const score=hit.point.distanceToSquared(climbFootSearchDelta)+
          Math.abs(vertical)*0.05+Math.abs(lateral)*0.04+(1-normalDot)*0.12;
        if(score<bestScore){
          bestScore=score;
          climbFootBestPoint.copy(hit.point);
          climbFootBestNormal.copy(climbFootActual);
        }
        break;
      }
    }
  }
  if(bestScore<Infinity){
    out.copy(climbFootBestPoint).addScaledVector(climbFootBestNormal,CLIMB_FOOT_OFFSET);
    if(normalOut)normalOut.copy(climbFootBestNormal);
  }
  return out;
}

function toTiltLocal(world,out){
  out.copy(world);
  tilt.worldToLocal(out);
  return out;
}

function plantGroundFoot(localTarget,worldOut,normalOut,clearance=0){
  normalOut.copy(UP);
  worldOut.copy(localTarget);
  tilt.localToWorld(worldOut);
  groundProbeOrigin.set(worldOut.x,Math.max(worldOut.y+1.35,player.pos.y+1.25),worldOut.z);
  rc.set(groundProbeOrigin,DOWN);rc.far=3.1;rc.near=0.001;
  const hits=rc.intersectObjects(standables,false);
  for(const hit of hits){
    normalOut.copy(wn(hit,hit.object,worldNormalScratch));
    if(normalOut.y<0.55)continue;
    if(hit.point.y<worldOut.y-1.25||hit.point.y>groundProbeOrigin.y)continue;
    normalOut.normalize();
    /* The IK endpoint is the ankle, while the boot sole extends below it.
       Put that endpoint above the contact plane so the visible boot, not the
       hidden leg chain, is what actually plants on the ground. */
    worldOut.y=hit.point.y+0.16;
    /* A swinging boot still needs the surface normal, but it must not be
       snapped onto that surface. The old projection discarded the authored
       lift on every frame, so both feet visibly skimmed the floor. Raise the
       ankle along the sampled normal after establishing its contact height. */
    if(clearance>0)worldOut.addScaledVector(normalOut,clearance);
    toTiltLocal(worldOut,localTarget);
    return true;
  }
  return false;
}

function updateGroundGaitFoot(phase,side,stride,lift,bodyBounce,swingWindow,runBlend,
  target,worldOut,normalOut){
  let z=0,clearance=0;
  if(phase<swingWindow){
    const t=phase/swingWindow;
    /* Recover the boot from behind the body, fold it under the hip, then reach
       decisively for the next plant. The old almost-flat fore/aft sweep was
       mostly hidden by the chase camera and read as two rigid legs. */
    z=lerp(-stride*0.82,stride,smooth5(t));
    clearance=Math.sin(Math.PI*t)*lift;
  }else{
    /* At arcade movement speeds a literal world-space foot lock exceeds the
       complete leg reach in only a few frames. Let the stance boot travel
       backward under the body for the visual plant, while keeping the target
       bounded to a human-sized stride. This preserves the contact read
       without stretching both legs into immobile rods. */
    const t=(phase-swingWindow)/(1-swingWindow);
    z=lerp(stride,-stride,t);
  }
  const swingArc=lift>0.001?clearance/lift:0;
  /* Open the airborne knee toward the camera-side silhouette. A real runner
     does not move both knees on one perfectly overlapping rail, and this
     lateral recovery is what makes the stride readable from directly behind. */
  const lateral=0.13+runBlend*0.025+swingArc*(0.035+runBlend*0.045);
  target.set(side*lateral,0.1-bodyBounce+clearance,z);
  plantGroundFoot(target,worldOut,normalOut,clearance);
  return clearance;
}

function groundGaitFootPitch(phase,swingWindow,runBlend){
  if(phase<swingWindow){
    const t=phase/swingWindow;
    return lerp(-0.24,0.16,smooth5(t))-Math.sin(Math.PI*t)*(0.12+runBlend*0.2);
  }
  const t=(phase-swingWindow)/(1-swingWindow);
  return lerp(0.12,-0.08,t)*(0.55+runBlend*0.45);
}

function alignFootSurface(chain,normalWorld,blend,pitch=0,roll=0){
  if(!chain.foot)return;
  const n=normalWorld&&normalWorld.lengthSq()>0.25?normalWorld:UP;
  chain.foot.getWorldQuaternion(footWorldQ);
  footWorldUp.set(0,1,0).applyQuaternion(footWorldQ);
  footAdjustQ.setFromUnitVectors(footWorldUp,n);
  footWorldQ.premultiply(footAdjustQ);
  chain.foot.parent.getWorldQuaternion(footParentQ).invert();
  footTargetQ.copy(footParentQ).multiply(footWorldQ);
  if(Math.abs(pitch)>0.0001||Math.abs(roll)>0.0001){
    footPoseEuler.set(pitch,0,roll,'XYZ');
    footPoseQ.setFromEuler(footPoseEuler);
    footTargetQ.multiply(footPoseQ);
  }
  chain.foot.quaternion.slerp(footTargetQ,Math.max(0,Math.min(1,blend)));
}

function updateGuy(dt){
  const now=performance.now()/1000;
  const mode=player.mode;
  if(mode!=='ground'){
    movementAccel=dampValue(movementAccel,0,12,dt);
    const inertiaFade=Math.exp(-12*dt);
    movementAccelWorld.x*=inertiaFade;movementAccelWorld.z*=inertiaFade;
  }
  /* Traversal and camera recovery can change the view volume abruptly. The arm
     chains are tiny but important silhouette elements, so never let their
     child meshes disappear while the body is being reposed. */
  armL.root.visible=true;armR.root.visible=true;
  const climbing=mode==='attach'||mode==='move'||mode==='hang';
  const moving=mode==='attach'||mode==='move';
  const vaultRecover=mode==='ground'&&player.vaultRecovery>0;
  const vaulting=mode==='vault'||vaultRecover;
  const lowVault=vaulting&&player.vaultKind==='low';
  const quickClimb=vaulting&&player.vaultKind==='quick';
  const vaultK=vaulting?(mode==='vault'?Math.max(0,Math.min(1,player.vaultT)):1):0;
  const vaultArc=4*vaultK*(1-vaultK);
  const quickMotionT=quickClimb?Math.max(0,Math.min(1,
    (vaultK-QUICK_CLIMB_PLANT_PHASE)/(1-QUICK_CLIMB_PLANT_PHASE))):0;
  const quickMotionRemaining=1-quickMotionT;
  const quickPullArc=quickClimb?
    16*quickMotionT*quickMotionT*quickMotionRemaining*quickMotionRemaining:0;
  const quickPlant=quickClimb?smooth5(Math.max(0,Math.min(1,
    vaultK/QUICK_CLIMB_APPROACH_END))):0;
  const vaultHeightBlend=lowVault?Math.max(0,Math.min(1,
    (player.vaultObstacleHeight-LOW_VAULT_MIN_HEIGHT)/
    (LOW_VAULT_MAX_HEIGHT-LOW_VAULT_MIN_HEIGHT))):0;
  const vaultSpeedBlend=lowVault?Math.max(0,Math.min(1,
    (player.vaultEntrySpeed-PLAYER_WALK_SPEED)/
    Math.max(0.01,PLAYER_SPRINT_SPEED-PLAYER_WALK_SPEED))):0;
  const lowVaultPlantLeft=!player.vaultLeadLeft;
  const lowVaultSide=lowVaultPlantLeft?1:-1;
  /* The first ground frame after a mantle carries the landing load. Keep that
     load separate from the airborne arc so the pelvis/knees compress and
     recover smoothly instead of snapping from vault pose to idle pose. */
  const vaultRecoveryDuration=Math.max(0.01,player.vaultRecoveryDuration||0.28);
  const vaultLandingElapsed=vaultRecover?Math.max(0,
    vaultRecoveryDuration-player.vaultRecovery):0;
  const vaultLandingLoad=vaultRecover?
    Math.exp(-vaultLandingElapsed*(lowVault?16:11)):0;
  const walking=mode==='ground'&&player.onGround&&walkAmt>0.01;
  const inAir=mode==='ground'&&!player.onGround;
  weaponSprint=dampValue(weaponSprint,sprinting?1:0,10,dt);
  /* World movement is intentionally arcade-fast, so driving the legs from
     literal distance travelled would demand an impossible twenty-plus steps
     per second. Keep a readable human cadence, then distinguish sprinting
     through stride, lift, and body load rather than merely speeding up a tiny
     walk cycle. */
  const groundSpeedBlend=walking?Math.min(1,walkAmt/PLAYER_WALK_SPEED):0;
  const runGait=walking?weaponSprint:0;
  if(walking){
    const cadence=lerp(10.2,14.2,groundSpeedBlend)+runGait*7.2;
    walkPhase=(walkPhase+dt*cadence)%(Math.PI*2);
  }
  const gait=Math.sin(walkPhase);
  const gaitCos=Math.cos(walkPhase);
  const stepPulse=Math.cos(walkPhase*2);
  const gaitRoll=walking?gait*(0.08+runGait*0.055):0;
  const gaitYaw=walking?gait*(0.105+runGait*0.08):0;
  const gaitPitch=walking?gaitCos*(0.026+runGait*0.024):0;
  const bodyBounce=walking?stepPulse*(0.058+runGait*0.045):0;
  const gaitWeightShift=walking?-gait*(0.024+runGait*0.032):0;
  /* Drive the weight shift from the same progress value that moves the root
     and hand targets. A free-running oscillator could put the hips on the
     wrong side of the transfer when a long corner link took more time. */
  const climbTransferDuration=mode==='attach'?0.24:
    Math.max(0.26,player.moveDuration||0.36);
  const climbTransferRaw=moving?Math.max(0,Math.min(1,
    player.attachT/climbTransferDuration)):0;
  /* The root path uses a cubic ease. Feed that exact phase to the body load,
     pelvis, knees, and shoulders so the character does not reach the middle
     of a transfer, pause, and then catch up with its hands. */
  const climbTransferProgress=climbTransferRaw*climbTransferRaw*
    (3-2*climbTransferRaw);
  const climbTransferSign=(climbStepParity&1)===0?1:-1;
  const climbCycle=climbing&&moving
    ?Math.sin(Math.PI*climbTransferProgress)*climbTransferSign
    :Math.sin(climbPhase);
  /* Idle hangs breathe through the shoulders and hands rather than freezing
     at a perfectly mirrored pose. It is deliberately smaller than the
     transfer load so both palms remain weight-bearing. */
  const climbHangSway=climbing?Math.sin(climbPhase*0.85):0;
  const climbCompression=moving?Math.sin(Math.PI*climbTransferProgress):0;
  const climbLiftL=Math.max(0,climbCycle);
  const climbLiftR=Math.max(0,-climbCycle);
  /* Let the clavicles follow the loaded side instead of leaving the shoulder
     joints as two fixed pins. The positional shift is deliberately small; it
     gives the IK chain room to pull through the shoulder without making the
     arms detach from the vest. */
  const quickShoulderLoad=quickPlant*0.018+quickPullArc*0.04;
  const shoulderLoadL=climbing?climbLiftL*0.035:(vaulting?
    (lowVault?(lowVaultPlantLeft?0.065:0.022):
      (quickClimb?quickShoulderLoad*(player.vaultLeadLeft?1:0.72):
        (player.vaultLeadLeft?0.045:0.018))):0);
  const shoulderLoadR=climbing?climbLiftR*0.035:(vaulting?
    (lowVault?(lowVaultPlantLeft?0.022:0.065):
      (quickClimb?quickShoulderLoad*(player.vaultLeadLeft?0.72:1):
        (player.vaultLeadLeft?0.018:0.045))):0);
  const groundShoulderLift=walking?gait*(0.035+runGait*0.04):0;
  const groundShoulderTravel=walking?gaitCos*(0.03+runGait*0.05):0;
  /* A mantle owns both hands until its landing recovery is finished. Treating
     that frame as a weapon-ready pose let the shoulder rig fight the vault
     brace and was a common source of a one-frame arm pop. */
  const weaponReady=mode==='ground'&&player.onGround&&!vaulting?1:0;
  const cannonTrigger=weaponReady&&playerWpn.cur==='cannon'&&mouseHeld;
  cannonRotorSpeed=dampValue(cannonRotorSpeed,cannonTrigger?46:0,
    cannonTrigger?18:8,dt);
  cannonRotor.rotation.z=(cannonRotor.rotation.z+cannonRotorSpeed*dt)%(Math.PI*2);
  const recoilLoad=weaponReady?Math.min(1.35,weaponRecoilKick):0;
  const recoilPitch=weaponReady?weaponRecoilPitch:0;
  const recoilRoll=weaponReady?weaponRecoilRoll:0;
  const weaponShoulderLift=weaponReady*(playerWpn.cur==='pistol'?0.018:0.032)+recoilLoad*0.018;
  const twoHandedWeapon=weaponReady&&playerWpn.cur!=='pistol';
  /* The support arm has to come around the vest to reach a forward foregrip.
     Keeping its shoulder at the old rear, full-width rest position put the
     hand target beyond the 0.75-unit two-bone reach and silently folded the
     arm into the chest. Move only that shoulder inward/forward for a believable
     cross-body support pose; the trigger shoulder remains planted. */
  const supportShoulderX=climbing?0.31:(twoHandedWeapon?0.28:0.4);
  const primaryShoulderX=climbing?-0.31:-0.4;
  armL.sh.position.y=dampValue(armL.sh.position.y,1.51+shoulderLoadL+weaponShoulderLift+groundShoulderLift,18,dt);
  armR.sh.position.y=dampValue(armR.sh.position.y,1.51+shoulderLoadR+weaponShoulderLift-groundShoulderLift,18,dt);
  armL.sh.position.x=dampValue(armL.sh.position.x,supportShoulderX,18,dt);
  armR.sh.position.x=dampValue(armR.sh.position.x,primaryShoulderX,18,dt);
  /* Keep the shoulder joints just inside the vest's safe exterior plane while
     the hips/backpack stay on the clearance-safe root. The old 0.34-unit reach
     drove both clavicles through a thin wall so the palms could reach it; the
     elbow bend is the correct place to absorb that distance. A small shoulder
     lead still lets the chest turn into a steep face without shoulder clipping. */
  const climbShoulderReach=climbing?0.08:0;
  const weaponShoulderReach=weaponReady*0.035;
  const supportShoulderDepth=twoHandedWeapon?0.24:0;
  armL.sh.position.z=dampValue(armL.sh.position.z,-0.24+shoulderLoadL*0.7+climbShoulderReach+weaponShoulderReach+supportShoulderDepth-recoilLoad*0.03-groundShoulderTravel,18,dt);
  armR.sh.position.z=dampValue(armR.sh.position.z,-0.24+shoulderLoadR*0.7+climbShoulderReach+weaponShoulderReach-recoilLoad*0.03+groundShoulderTravel,18,dt);
  let contactHold=null,fromHold=null,toHold=null,climbTransfer=0;

  if(climbing){
    if(mode==='move'){
      fromHold=HOLDS[player.moveFrom];toHold=HOLDS[player.moveTo];
      if(fromHold&&toHold){
        const from=hangPos(player.moveFrom,hangFromPos),to=hangPos(player.moveTo,hangToPos);
        const dur=Math.max(0.26,from.distanceTo(to)/2.2);
        const k=Math.min(1,player.attachT/dur),s=k*k*(3-2*k);
        climbTransfer=s;
        holdSurfaceAnchor(fromHold,climbSurfacePoint,climbNormalFrom);
        holdSurfaceAnchor(toHold,climbSurfacePointB,climbNormalTo);
        wallNormal.copy(climbNormalFrom).lerp(climbNormalTo,s);
        if(wallNormal.lengthSq()<0.001)wallNormal.copy(s<0.5?climbNormalFrom:climbNormalTo);
        wallNormal.normalize();
        contactHold=s<0.5?fromHold:toHold;
      }
    }else{
      contactHold=HOLDS[player.hold]||HOLDS[player.moveTo];
      if(contactHold)holdSurfaceAnchor(contactHold,climbSurfacePoint,wallNormal);
    }
  }

  let targetHeading=player.heading;
  if(climbing&&wallNormal.lengthSq()>0.001)targetHeading=Math.atan2(-wallNormal.x,-wallNormal.z);
  else if(vaulting&&player.vaultNormal.lengthSq()>0.001){
    /* Keep moving through the ledge in the same direction the character
       approached it. The chase camera orbits to the exterior side during a
       mantle; reversing the body as well made the player finish by staring
       directly into that camera. */
    targetHeading=Math.atan2(-player.vaultNormal.x,-player.vaultNormal.z);
  }
  /* Ground aim needs to follow a mouse turn more tightly than the heavier
     wall/vault pose. It is still damped, so a fast camera sweep produces a
     readable Fortnite-style turn instead of snapping the entire rig. */
  const headingRate=mode==='ground'&&!vaulting?22:14;
  heading=dampAngle(heading,targetHeading,headingRate,dt);
  guy.rotation.y=heading;

  camera.getWorldDirection(aimWorld);
  aimWorld.normalize();
  bodyForward.set(Math.sin(heading),0,Math.cos(heading));
  bodyRight.set(Math.cos(heading),0,-Math.sin(heading));
  const localForwardSpeed=player.vel.x*bodyForward.x+player.vel.z*bodyForward.z;
  const localSideSpeed=player.vel.x*bodyRight.x+player.vel.z*bodyRight.z;
  const accelForward=movementAccelWorld.x*bodyForward.x+movementAccelWorld.z*bodyForward.z;
  const accelSide=movementAccelWorld.x*bodyRight.x+movementAccelWorld.z*bodyRight.z;
  const forwardLoad=Math.max(-1,Math.min(1,localForwardSpeed/PLAYER_WALK_SPEED));
  const sideLoad=Math.max(-1,Math.min(1,localSideSpeed/PLAYER_WALK_SPEED));
  const turnLoad=Math.max(-1,Math.min(1,angDiff(player.heading,heading)*0.8));
  const groundSideLean=walking?-sideLoad*0.035+accelSide*0.028:accelSide*0.018;
  const aimX=aimWorld.dot(bodyRight),aimY=aimWorld.y,aimZ=aimWorld.dot(bodyForward);
  const aimYaw=Math.atan2(aimX,Math.max(0.001,aimZ));
  const aimPitch=Math.atan2(-aimY,Math.max(0.001,Math.hypot(aimX,aimZ)));

  guy.position.copy(player.pos);
  guy.position.y+=PLAYER_BODY_LIFT;
  if(climbing&&contactHold){
    /* Keep the torso and backpack clear of the wall while the hands stay on it. */
    /* Use the re-projected surface frame for every traversal state, including
       a static hang. Falling back to the sampled hold normal at a missing
       surface keeps old proxy holds usable, but avoids letting a coarse
       corner normal pull the torso or backpack back through the real wall. */
    const bodyWallNormal=wallNormal.lengthSq()>0.001?wallNormal:contactHold.out;
     /* Leave room for the vest depth and the backpack. Hands stay close to the
        sampled wall plane, while the chest and hips stay on the safe side of it. */
     guy.position.addScaledVector(bodyWallNormal,CLIMB_BODY_OFFSET);
    climbSideAxis.crossVectors(UP,bodyWallNormal).normalize();
    /* Shift the hips under the loaded hand instead of sliding the whole body
       straight up like a rigid mannequin. */
    guy.position.addScaledVector(climbSideAxis,climbCycle*0.035);
    if(moving&&fromHold&&toHold){
      /* A loaded pull moves the chest slightly away from the wall before the
         hips arrive. This small weight shift makes the hand transfer read as
         a body climbing around a corner instead of a rigid translation. */
      const load=Math.sin(Math.PI*climbTransfer);
      guy.position.addScaledVector(bodyWallNormal,load*0.065);
      guy.position.y+=load*0.035;
    }
    /* The physics root is swept clear during hangStep/moveStep, but the
       rendered rig has its own chest, hip, and weight-shift offsets. Re-run
       the same surface/OBB clearance on that final visual root before solving
       IK; otherwise a shoulder or backpack can still enter a corner even
       though the capsule is technically safe. This only runs during
       traversal, so ordinary movement keeps its cheap per-frame path. */
    climbRenderClearFrom.copy(guy.position);
    keepClimbBodyClear(guy.position,contactHold);
    climbRenderClearDelta.subVectors(guy.position,climbRenderClearFrom);
    const renderCorrection=climbRenderClearDelta.length();
    if(renderCorrection>0.3){
      /* Keep the visual correction bounded so an invalidated moving surface
         cannot detach the rig from the physical player for a single frame. */
      guy.position.copy(climbRenderClearFrom)
        .addScaledVector(climbRenderClearDelta,0.3/renderCorrection);
    }
  }
  if(climbing&&!moving)guy.position.y+=climbCycle*0.025;
  guy.position.y+=bodyBounce-climbCompression*0.028;

  let targetTiltX=0,targetTiltZ=0,climbLoad=0;
  if(climbing){
    /* Entry has no from/to hold pair yet, but it still carries the same
       weight-bearing pull as a transfer. Use the synchronized attach phase so
       the chest and pelvis load while the hands reach, instead of catching up
       only after the root has already arrived at the wall. */
    const loadPhase=mode==='attach'?climbTransferProgress:climbTransfer;
    climbLoad=moving?Math.sin(Math.PI*loadPhase)*climbTransferSign:0;
    const attachK=mode==='attach'?smooth5(Math.max(0,Math.min(1,player.attachT/0.24))):1;
    /* Enter the wall with the shoulders first, then let the hips catch up.
       A constant lean made the old hang look like a frozen diagonal pose and
       made the first hand transfer snap the whole torso into place. */
    /* Let the chest lead the hips toward the wall. The stronger lean keeps the
       shoulders within the two-bone arm reach even when the clearance solver
       has to hold the pelvis/backpack farther out around a convex rock. */
    /* Keep the chest close enough to load the hands, but do not fold the whole
       mannequin into a diagonal plank. The old 0.44-radian lean was readable
       as a sideways fall on a narrow pole; the physical root and swept IK still
       enforce the real wall clearance, so this is only a visual chest pitch. */
    targetTiltX=lerp(0.035,0.115,attachK)+Math.sin(now*1.8)*0.012+
      (moving?0.025+climbLoad*0.04:0);
    targetTiltZ=climbCycle*0.055+climbHangSway*0.018+Math.sin(now*1.4)*0.018+
      (moving?(0.08-0.16*climbTransfer)*climbLoad:0);
  }else if(vaulting){
    targetTiltX=lowVault?
      0.2+vaultArc*(0.17+vaultSpeedBlend*0.08)-vaultLandingLoad*0.075:
      (quickClimb?0.055+quickPlant*0.075+quickPullArc*0.16-
        vaultLandingLoad*0.065:
        0.16+vaultArc*0.14-vaultLandingLoad*0.05);
    targetTiltZ=lowVault?
      lowVaultSide*Math.sin(vaultK*Math.PI)*(0.075+vaultHeightBlend*0.045):
      (quickClimb?(player.vaultLeadLeft?1:-1)*
        Math.sin(quickMotionT*Math.PI)*0.045:
        0.035+Math.sin(vaultK*Math.PI)*0.025);
  }else{
    targetTiltX=Math.max(-0.08,Math.min(0.2,
      forwardLoad*0.08+movementAccel*0.025+accelForward*0.045+(sprinting?0.07:(walking?0.025:0))+
      (inAir?-0.08:0)-landingKick*0.1-recoilLoad*0.045));
    targetTiltZ=Math.max(-0.14,Math.min(0.14,
      -sideLoad*0.035+turnLoad*0.045+recoilRoll*0.25));
  }
  tilt.rotation.x=dampValue(tilt.rotation.x,targetTiltX,10,dt);
  tilt.rotation.z=dampValue(tilt.rotation.z,targetTiltZ,10,dt);

  /* A restrained breathing cycle keeps the idle body alive and also gives the
     traversal poses a visible rib-cage response without adding an animation
     asset or per-frame allocations. */
  const breath=Math.sin(now*1.55)*0.008;
  torsoShell.scale.y=1+breath;
  chestPlate.scale.y=1+breath*0.45;
  pack.position.y=1.28+breath*0.5;

  const pelvisBob=climbing?Math.sin(now*1.8)*0.012-climbCompression*0.04:
    (vaulting?(quickClimb?quickPullArc*0.052:
      vaultArc*(lowVault?0.075:0.03))-vaultLandingLoad*(lowVault?0.085:0.06):
      bodyBounce*0.45-landingKick*0.055);
  pelvis.position.y=dampValue(pelvis.position.y,0.92+pelvisBob,14,dt);
  pelvis.position.x=dampValue(pelvis.position.x,gaitWeightShift,16,dt);
  pelvis.rotation.x=dampValue(pelvis.rotation.x,
    climbing?0.04-climbLoad*0.08:(vaulting?(lowVault?0.08+vaultArc*0.07:
      (quickClimb?0.025+quickPullArc*0.085:0.025)):
      gaitPitch-recoilLoad*0.018),10,dt);
  pelvis.rotation.y=dampAngle(pelvis.rotation.y,
    climbing?(0.08-0.16*climbTransfer)*climbLoad:
      (lowVault?lowVaultSide*vaultArc*(0.12+vaultSpeedBlend*0.08):-gaitYaw),10,dt);
  pelvis.rotation.z=dampValue(pelvis.rotation.z,climbing?climbCycle*0.07+climbHangSway*0.02:
    (lowVault?-lowVaultSide*vaultArc*(0.08+vaultHeightBlend*0.04):
      (walking?-gaitRoll+groundSideLean:Math.sin(now*1.5)*0.012))+recoilRoll*0.16,10,dt);
  torso.position.y=dampValue(torso.position.y,1.18+bodyBounce*0.35-landingKick*0.04-
    vaultLandingLoad*0.045-climbCompression*0.035-recoilLoad*0.018,14,dt);
  torso.position.x=dampValue(torso.position.x,-gaitWeightShift*0.42,14,dt);
  torso.rotation.x=dampValue(torso.rotation.x,climbing?-0.07:
    (vaulting?(lowVault?-0.18-vaultArc*0.09-vaultLandingLoad*0.1:
      (quickClimb?-0.08-quickPlant*0.055-quickPullArc*0.13-
        vaultLandingLoad*0.08:-0.12-vaultLandingLoad*0.08)):
      (inAir?0.06:-gaitPitch*0.55-landingKick*0.14-recoilLoad*0.07)+weaponReady*aimPitch*0.08),10,dt);
  torso.rotation.y=dampAngle(torso.rotation.y,
      climbing?aimYaw*0.12+climbCycle*0.1-climbLoad*0.12:
        (lowVault?-lowVaultSide*vaultArc*(0.14+vaultSpeedBlend*0.1):
          aimYaw*0.16-accelSide*0.08+gaitYaw*0.82),9,dt);
  torso.rotation.z=dampValue(torso.rotation.z,
    climbing?climbCycle*0.03-climbLoad*0.11:
      (lowVault?lowVaultSide*vaultArc*(0.065+vaultHeightBlend*0.04):
        (walking?gaitRoll*0.82+groundSideLean*0.55:groundSideLean*0.35))+recoilRoll*0.55,9,dt);
  head.position.y=dampValue(head.position.y,1.78+bodyBounce*0.18-landingKick*0.03-
    climbCompression*0.016-recoilLoad*0.012,14,dt);
  head.position.x=dampValue(head.position.x,-gaitWeightShift*0.26,13,dt);
  head.rotation.y=dampAngle(head.rotation.y,Math.max(-0.75,Math.min(0.75,aimYaw*(climbing?0.7:0.45))),11,dt);
  head.rotation.x=dampValue(head.rotation.x,Math.max(-0.45,Math.min(0.55,
    aimPitch*0.42+(climbing?-0.08:0)-recoilPitch*0.3-recoilLoad*0.02)),11,dt);
  head.rotation.z=dampValue(head.rotation.z,
    (lowVault?-lowVaultSide*vaultArc*0.045:
      (walking?-gaitRoll*0.38:Math.sin(now*1.1)*0.01))+recoilRoll*0.35,10,dt);
  const hipY=0.92-landingKick*0.055-climbCompression*0.025;
  const hipLift=walking?gaitCos*(0.014+runGait*0.012):0;
  const hipTravel=walking?gait*(0.04+runGait*0.05):0;
  const leftHipOut=walking?Math.max(0,gait)*(0.02+runGait*0.025):0;
  const rightHipOut=walking?Math.max(0,-gait)*(0.02+runGait*0.025):0;
  legL.hip.position.x=dampValue(legL.hip.position.x,0.13+leftHipOut,18,dt);
  legR.hip.position.x=dampValue(legR.hip.position.x,-0.13-rightHipOut,18,dt);
  legL.hip.position.y=dampValue(legL.hip.position.y,hipY+hipLift,14,dt);
  legR.hip.position.y=dampValue(legR.hip.position.y,hipY-hipLift,14,dt);
  legL.hip.position.z=dampValue(legL.hip.position.z,hipTravel,18,dt);
  legR.hip.position.z=dampValue(legR.hip.position.z,-hipTravel,18,dt);

  const profile=weaponHoldProfiles[playerWpn.cur]||weaponHoldProfiles.rpg;
  const weapon=wpnStats();
  const kickRatio=Math.max(0,Math.min(1,playerWpn.cooldown/(weapon.rof||1)));
  if(climbing||vaulting){
    gunGroup.visible=true;
    /* During traversal the weapon is slung behind the shoulder. Keeping the
       muzzle pointed toward the back prevents it from cutting through the
       chest and being mistaken for an arm while both hands are occupied. */
    /* Keep the sling behind the shoulder line. The earlier centered, nearly
       horizontal pose crossed the chest from the chase camera and was easily
       mistaken for a missing forearm during a mantle. */
    const slingShift=climbing?(climbLoad*0.045+climbCycle*0.018):
      (vaulting?Math.sin(vaultK*Math.PI)*0.035:0);
    /* Put the slung weapon behind the shoulder line, with the muzzle angled
       down. The character faces local -Z, so local +Z is the back; the old
       negative offset put the launcher across the chest and hid the reaching
       forearm in the chase view. Keep it on the camera-side shoulder while
       moving it behind the pack so both hands remain readable. */
    const stowX=(vaulting?-0.48:-0.5)+slingShift,stowY=vaulting?1.42:1.46,
      stowZ=(vaulting?0.5:0.62)+slingShift*0.6;
    gunGroup.position.x=dampValue(gunGroup.position.x,stowX,14,dt);
    gunGroup.position.y=dampValue(gunGroup.position.y,stowY,14,dt);
    gunGroup.position.z=dampValue(gunGroup.position.z,stowZ,14,dt);
    gunGroup.rotation.x=dampValue(gunGroup.rotation.x,vaulting?-0.78:-0.96,14,dt);
    gunGroup.rotation.y=dampAngle(gunGroup.rotation.y,vaulting?-0.08:-0.1,14,dt);
    gunGroup.rotation.z=dampValue(gunGroup.rotation.z,(vaulting?-0.12:-0.16)-slingShift*0.7,14,dt);
    const stowScale=vaulting?0.8:0.74;
    gunGroup.scale.setScalar(dampValue(gunGroup.scale.x,stowScale,14,dt));
  }else{
    gunGroup.visible=true;
    /* Both weapon hands sample this same transform below. A stronger shared
       gait therefore articulates shoulders and elbows while the palms remain
       physically attached to their grips. */
    const swayX=walking?gait*(0.026+runGait*0.045):Math.cos(now*0.8)*0.0025;
    const swayY=walking?-stepPulse*(0.03+runGait*0.045):Math.sin(now*1.2)*0.003;
    const swayZ=walking?gaitCos*(0.02+runGait*0.035):0;
    const swayPitch=walking?stepPulse*(0.02+runGait*0.035):0;
    const swayRoll=walking?gait*(0.05+runGait*0.065):0;
    /* The cooldown kick is the fast muzzle impulse. The independent recoil
       state supplies the slower stock push that the hands and shoulders track. */
    const recoilZ=-kickRatio*0.07-recoilLoad*0.045;
    /* A runner drops the muzzle and lets the stock settle against the shoulder.
       This is one shared transform: the IK hand targets below are sampled from
       the same group, so the hands, elbows, and weapon remain one physical
       pose instead of three independently animated parts. */
    const sprintX=weaponSprint*0.055;
    const sprintY=-weaponSprint*0.19;
    const sprintZ=weaponSprint*0.18;
     const movementWeaponSway=(walking?sideLoad*0.018:0)+accelSide*0.022;
     const movementWeaponDip=(walking?movementAccel*0.02:0)+accelForward*0.022;
     const movementWeaponPush=(walking?forwardLoad*0.018:0)-accelForward*0.018;
    gunGroup.position.x=dampValue(gunGroup.position.x,profile.mount[0]+swayX+sprintX+movementWeaponSway,16,dt);
    gunGroup.position.y=dampValue(gunGroup.position.y,profile.mount[1]+swayY+sprintY-movementWeaponDip+
      landingKick*0.025+recoilLoad*0.014,16,dt);
    gunGroup.position.z=dampValue(gunGroup.position.z,profile.mount[2]+recoilZ+sprintZ+swayZ-movementWeaponPush,16,dt);
    const weaponAimYaw=Math.max(-1.35,Math.min(1.35,aimYaw));
    /* Weapon meshes point along local -Z and are yawed 180° onto the
       character's +Z axis below. That yaw also reverses the effective pitch
       axis: the camera aim angle keeps its sign, while an upward recoil impulse
       subtracts from it. The previous double-negation made looking down tilt
       the visible barrel up even though the projectile still hit the reticle. */
    const weaponAimPitch=aimPitch-kickRatio*(playerWpn.cur==='rpg'?0.08:0.045)+
      weaponSprint*0.33-recoilPitch*0.72+swayPitch;
    gunGroup.rotation.y=dampAngle(gunGroup.rotation.y,weaponAimYaw+Math.PI,18,dt);
    gunGroup.rotation.x=dampValue(gunGroup.rotation.x,weaponAimPitch,18,dt);
    gunGroup.rotation.z=dampValue(gunGroup.rotation.z,swayRoll-weaponSprint*0.18-
      sideLoad*0.035+turnLoad*0.04+recoilRoll*0.8,16,dt);
    gunGroup.scale.setScalar(dampValue(gunGroup.scale.x,1,16,dt));
  }

  guy.updateMatrixWorld(true);
  const limbBlend=1-Math.exp(-18*dt);
  if(climbing&&contactHold){
    if(moving&&fromHold&&toHold){
      /* Use the same hang-space duration as moveStep. Raw hold spacing can be
         much shorter than the body path around a corner, which made the hands
         arrive before the shoulders and produced a visible snap. */
      const moveT=Math.max(0,Math.min(1,player.attachT/Math.max(0.24,player.moveDuration||0.36)));
      /* Ease the palm trajectories as well as the root. Linear wrist motion
         made the reaching arm snap into the next hold while the torso was
         still accelerating, which read as a detached or missing arm. */
      const reachT=smooth5(Math.max(0,Math.min(1,(moveT-0.08)/0.48)));
      const settleT=smooth5(Math.max(0,Math.min(1,(moveT-0.52)/0.4)));
      const leadLeft=(climbStepParity&1)===0;
      if(leadLeft){
        lerpHoldWorld(fromHold,toHold,reachT,-CLIMB_TRANSFER_HAND_SPREAD,climbHandWorldL,climbHandNormalL);
        lerpHoldWorld(fromHold,toHold,settleT,CLIMB_TRANSFER_HAND_SPREAD,climbHandWorldR,climbHandNormalR);
      }else{
        lerpHoldWorld(fromHold,toHold,settleT,-CLIMB_TRANSFER_HAND_SPREAD,climbHandWorldL,climbHandNormalL);
        lerpHoldWorld(fromHold,toHold,reachT,CLIMB_TRANSFER_HAND_SPREAD,climbHandWorldR,climbHandNormalR);
      }
      /* The reaching palm briefly leaves the surface to clear the edge before
         settling onto the next hold. The trailing hand keeps a smaller arc so
         the transfer has a visible lead-and-follow rhythm. */
       const reachArc=Math.sin(Math.PI*reachT)*0.16;
       const settleArc=Math.sin(Math.PI*settleT)*0.07;
      if(leadLeft){
        climbHandWorldL.addScaledVector(wallNormal,reachArc);
        climbHandWorldR.addScaledVector(wallNormal,settleArc);
      }else{
        climbHandWorldL.addScaledVector(wallNormal,settleArc);
        climbHandWorldR.addScaledVector(wallNormal,reachArc);
      }
      /* Move each anatomical ankle target along the wall and re-project it onto
         the live face, keeping knees and boots clear during a lateral transfer. */
      climbFootPoint(fromHold,-CLIMB_FOOT_SPREAD,climbFootFromL);
      climbFootPoint(toHold,-CLIMB_FOOT_SPREAD,climbFootToL);
      climbFootPoint(fromHold,CLIMB_FOOT_SPREAD,climbFootFromR);
      climbFootPoint(toHold,CLIMB_FOOT_SPREAD,climbFootToR);
      const leadFootT=smooth5(Math.max(0,Math.min(1,(moveT-0.1)/0.5)));
      const trailFootT=smooth5(Math.max(0,Math.min(1,(moveT-0.56)/0.38)));
      const leadLiftPhase=smooth5(Math.max(0,Math.min(1,(moveT-0.12)/0.52)));
      const leadLift=Math.sin(Math.PI*leadLiftPhase)*0.15;
      if(leadLeft){
        climbFootWorldL.lerpVectors(climbFootFromL,climbFootToL,leadFootT);
        climbFootWorldR.lerpVectors(climbFootFromR,climbFootToR,trailFootT);
        climbFootWorldL.y+=leadLift;
      }else{
        climbFootWorldL.lerpVectors(climbFootFromL,climbFootToL,trailFootT);
        climbFootWorldR.lerpVectors(climbFootFromR,climbFootToR,leadFootT);
        climbFootWorldR.y+=leadLift;
      }
      /* Transfers blend between two already-projected foot contacts. The
         interpolated hand frame is the most stable normal for that short
         moving interval; static hangs below use each foot's measured face. */
      climbFootNormalL.copy(wallNormal);
      climbFootNormalR.copy(wallNormal);
    }else{
      /* Keep a supported hang shoulder-width and centered on the real surface.
         The graph contains many close samples on a faceted mesh; selecting a
         different sample for each hand made both palms collapse into one point
         or cross the chest. Transfers below still move each hand independently
         between actual holds, while an idle hang uses one stable two-hand grip. */
      holdWorldPoint(contactHold,-CLIMB_HAND_SPREAD,climbHandWorldL);
      holdWorldPoint(contactHold,CLIMB_HAND_SPREAD,climbHandWorldR);
      climbHandNormalL.copy(climbSurfaceNormal);
      climbHandNormalR.copy(climbSurfaceNormal);
      climbSideAxis.crossVectors(UP,climbSurfaceNormal);
      if(climbSideAxis.lengthSq()<0.04)climbSideAxis.set(1,0,0);
      else climbSideAxis.normalize();
      /* Keep the palms just proud of the sampled face while the hips shift
         underneath them. The far hand gets the same small lateral rhythm,
         which opens the silhouette without turning the hang into hand flapping. */
      climbHandWorldL.addScaledVector(climbSideAxis,climbHangSway*0.024)
        .addScaledVector(climbSurfaceNormal,0.018+climbLiftL*0.012);
      climbHandWorldR.addScaledVector(climbSideAxis,climbHangSway*0.024)
        .addScaledVector(climbSurfaceNormal,0.018+climbLiftR*0.012);
       /* Keep both palms planted during an idle hang. The weight shift belongs
          in the elbows, shoulders, and hips; lifting a hand off its hold every
          cycle made the character flap like a mannequin instead of supporting
          body weight through the wall. */
       climbHandWorldL.y+=climbLiftL*0.028-climbLiftR*0.008;
       climbHandWorldR.y+=climbLiftR*0.028-climbLiftL*0.008;
      climbFootPoint(contactHold,-CLIMB_FOOT_SPREAD,climbFootWorldL,climbFootNormalL);
      climbFootPoint(contactHold,CLIMB_FOOT_SPREAD,climbFootWorldR,climbFootNormalR);
       climbFootWorldL.y+=climbLiftL*0.07-climbLiftR*0.018;
       climbFootWorldR.y+=climbLiftR*0.07-climbLiftL*0.018;
    }
    if(mode==='attach'){
      /* During the initial grab the body is still travelling from the ground
         pose. Bring the hands out from their shoulders progressively; aiming
         at the hold on frame one was the source of the straight, disappearing
         arms seen at the start of a climb. */
      const attachK=smooth5(Math.max(0,Math.min(1,player.attachT/0.24)));
      armL.root.getWorldPosition(handWorldL);
      armR.root.getWorldPosition(handWorldR);
      handWorldL.addScaledVector(bodyRight,0.17).addScaledVector(bodyForward,0.18).addScaledVector(UP,-0.18);
      handWorldR.addScaledVector(bodyRight,-0.17).addScaledVector(bodyForward,0.18).addScaledVector(UP,-0.18);
      climbHandWorldL.lerpVectors(handWorldL,climbHandWorldL,attachK);
      climbHandWorldR.lerpVectors(handWorldR,climbHandWorldR,attachK);
    }
    toTiltLocal(climbHandWorldL,handTargetL);
    toTiltLocal(climbHandWorldR,handTargetR);
    tilt.getWorldQuaternion(climbRigInverseQ).invert();
    setClimbPole(climbHandNormalL,-1,1,0.7,-0.7,bendClimbL);
    setClimbPole(climbHandNormalR,1,1,0.7,-0.7,bendClimbR);
    applyLimbIK(armL,handTargetL,bendClimbL,limbBlend);
    applyLimbIK(armR,handTargetR,bendClimbR,limbBlend);
    guy.updateMatrixWorld(true);
    poseHandToSurface(armL,climbHandNormalL,limbBlend);
    poseHandToSurface(armR,climbHandNormalR,limbBlend);
    /* The body faces the wall while climbing, so local +Z is the wall-facing side. */
    toTiltLocal(climbFootWorldL,footTargetL);
    toTiltLocal(climbFootWorldR,footTargetR);
    setClimbPole(moving?wallNormal:climbFootNormalL,-1,0.24,1,0,bendFootClimbL);
    setClimbPole(moving?wallNormal:climbFootNormalR,1,0.24,1,0,bendFootClimbR);
    applyLimbIK(legL,footTargetL,bendFootClimbL,limbBlend);
    applyLimbIK(legR,footTargetR,bendFootClimbR,limbBlend);
    /* A climbing foot presses its sole into the same surface normal as the
       hands. This makes the boot read as planted instead of hanging through
       the wall while the knees continue to solve freely. */
    alignFootSurface(legL,moving?wallNormal:climbFootNormalL,limbBlend*0.8);
    alignFootSurface(legR,moving?wallNormal:climbFootNormalR,limbBlend*0.8);
  }else if(vaulting){
    /* A mantle plants both hands on its lip. A running low vault instead uses
       one early weight-bearing palm while the other arm counter-swings; which
       side plants alternates with the lead leg so chained vaults stay alive. */
    const vaultHold=(lowVault||quickClimb)?null:HOLDS[player.hold];
    /* The wrist follows the same lead/trail schedule as the hand target. If
       both palms rotate together, the lead hand leaves the lip while still
       facing the wall and the forearm twists through the chest on release. */
    const leadReleaseStart=quickClimb?0.26:0.18;
    const trailReleaseStart=quickClimb?0.34:0.28;
    const releaseLead=smooth5(Math.max(0,Math.min(1,
      (vaultK-leadReleaseStart)/(quickClimb?0.24:0.32))));
    const releaseTrail=smooth5(Math.max(0,Math.min(1,
      (vaultK-trailReleaseStart)/(quickClimb?0.25:0.34))));
    /* Pull-up palms stay fixed while they bear weight. Their old eight-centimetre
       vertical slide was especially visible now that the root pauses to plant. */
    const handPush=quickClimb?quickPullArc*0.018:vaultArc*0.08;
    if(lowVault){
      const plantEngage=smooth5(Math.max(0,Math.min(1,vaultK/0.13)));
      const plantRelease=smooth5(Math.max(0,Math.min(1,(vaultK-0.38)/0.25)));
      const freeSweep=Math.sin(vaultK*Math.PI);
      climbSideAxis.crossVectors(UP,player.vaultNormal);
      if(climbSideAxis.lengthSq()<0.04)climbSideAxis.set(1,0,0);
      else climbSideAxis.normalize();
      vaultHandWorldL.copy(player.vaultContactPoint)
        .addScaledVector(climbSideAxis,-0.16);
      vaultHandWorldR.copy(player.vaultContactPoint)
        .addScaledVector(climbSideAxis,0.16);
      if(lowVaultPlantLeft){
        toTiltLocal(vaultHandWorldL,handTargetL);
        vaultBraceL.set(0.3,1.18,0.38);
        handTargetL.lerp(vaultBraceL,1-plantEngage);
        vaultBraceL.set(0.34,1.4+vaultArc*0.04,0.2);
        handTargetL.lerp(vaultBraceL,plantRelease);
        handTargetR.set(-0.35,1.2+vaultArc*(0.22+vaultSpeedBlend*0.08),
          0.31+freeSweep*0.24);
      }else{
        toTiltLocal(vaultHandWorldR,handTargetR);
        vaultBraceR.set(-0.3,1.18,0.38);
        handTargetR.lerp(vaultBraceR,1-plantEngage);
        vaultBraceR.set(-0.34,1.4+vaultArc*0.04,0.2);
        handTargetR.lerp(vaultBraceR,plantRelease);
        handTargetL.set(0.35,1.2+vaultArc*(0.22+vaultSpeedBlend*0.08),
          0.31+freeSweep*0.24);
      }
      bendVaultL.set(1.02,-0.12,lowVaultPlantLeft?-0.7:-0.46);
      bendVaultR.set(-1.02,-0.12,lowVaultPlantLeft?-0.46:-0.7);
    }else if(quickClimb){
      /* A standing pull-up has no graph hold, but its probe records the exact
         lip contact. Both palms carry the first lift; the lead releases as its
         knee commits to the top and the trailing palm finishes the push. */
      bendVaultL.set(1,-0.08,-0.55);
      bendVaultR.set(-1,-0.08,-0.55);
      climbSideAxis.crossVectors(UP,player.vaultNormal);
      if(climbSideAxis.lengthSq()<0.04)climbSideAxis.set(1,0,0);
      else climbSideAxis.normalize();
      vaultHandWorldL.copy(player.vaultContactPoint)
        .addScaledVector(player.vaultNormal,0.1)
        .addScaledVector(climbSideAxis,-0.2)
        .addScaledVector(UP,handPush);
      vaultHandWorldR.copy(player.vaultContactPoint)
        .addScaledVector(player.vaultNormal,0.1)
        .addScaledVector(climbSideAxis,0.2)
        .addScaledVector(UP,handPush*0.7);
      toTiltLocal(vaultHandWorldL,handTargetL);
      toTiltLocal(vaultHandWorldR,handTargetR);
      vaultBraceL.set(0.28,1.22+handPush,0.34+handPush);
      vaultBraceR.set(-0.28,1.17+handPush*0.7,0.37+handPush);
      handTargetL.lerp(vaultBraceL,player.vaultLeadLeft?releaseLead:releaseTrail);
      handTargetR.lerp(vaultBraceR,player.vaultLeadLeft?releaseTrail:releaseLead);
    }else if(vaultHold){
      bendVaultL.set(1,-0.08,-0.55);
      bendVaultR.set(-1,-0.08,-0.55);
      holdSurfaceAnchor(vaultHold,climbSurfacePoint,climbSurfaceNormal);
      climbSideAxis.crossVectors(UP,player.vaultNormal).normalize();
      vaultHandWorldL.copy(climbSurfacePoint)
        .addScaledVector(player.vaultNormal,0.13)
        .addScaledVector(climbSideAxis,-0.2)
        .addScaledVector(UP,0.02+handPush);
      vaultHandWorldR.copy(climbSurfacePoint)
        .addScaledVector(player.vaultNormal,0.13)
        .addScaledVector(climbSideAxis,0.2)
        .addScaledVector(UP,0.02+handPush*0.7);
      toTiltLocal(vaultHandWorldL,handTargetL);
      toTiltLocal(vaultHandWorldR,handTargetR);
       /* Release the lead hand as the chest clears the lip, then let the
          trailing hand push off a fraction later. Keeping the old release
          window until 0.9 of the vault left both hands chasing the original
          wall point after the body had already risen out of arm reach. */
      vaultBraceL.set(0.28,1.22+handPush,0.34+handPush);
      vaultBraceR.set(-0.28,1.17+handPush*0.7,0.37+handPush);
      handTargetL.lerp(vaultBraceL,player.vaultLeadLeft?releaseLead:releaseTrail);
      handTargetR.lerp(vaultBraceR,player.vaultLeadLeft?releaseTrail:releaseLead);
    }else{
      handTargetL.set(0.28,1.22+handPush,0.34+handPush);
      handTargetR.set(-0.28,1.17+handPush*0.7,0.37+handPush);
      bendVaultL.set(1,-0.08,-0.55);
      bendVaultR.set(-1,-0.08,-0.55);
    }
    applyLimbIK(armL,handTargetL,bendVaultL,limbBlend);
    applyLimbIK(armR,handTargetR,bendVaultR,limbBlend);
    guy.updateMatrixWorld(true);
    if(lowVault){
      const lowRelease=smooth5(Math.max(0,Math.min(1,(vaultK-0.38)/0.25)));
      vaultHandNormal.copy(player.vaultContactNormal).lerp(UP,lowRelease).normalize();
      poseHandToSurface(lowVaultPlantLeft?armL:armR,vaultHandNormal,limbBlend);
      vaultHandNormal.copy(UP).lerp(player.vaultLandingNormal,vaultK).normalize();
      poseHandToSurface(lowVaultPlantLeft?armR:armL,vaultHandNormal,limbBlend*0.7);
    }else{
      vaultHandNormal.copy(quickClimb?player.vaultContactNormal:
        (vaultHold?climbSurfaceNormal:player.vaultNormal)).normalize();
      vaultHandNormal.lerp(player.vaultLandingNormal,
        player.vaultLeadLeft?releaseLead:releaseTrail);
      if(vaultHandNormal.lengthSq()<0.01)vaultHandNormal.copy(player.vaultLandingNormal);
      vaultHandNormal.normalize();
      poseHandToSurface(armL,vaultHandNormal,limbBlend);
      vaultHandNormal.copy(quickClimb?player.vaultContactNormal:
        (vaultHold?climbSurfaceNormal:player.vaultNormal)).normalize();
      vaultHandNormal.lerp(player.vaultLandingNormal,
        player.vaultLeadLeft?releaseTrail:releaseLead);
      if(vaultHandNormal.lengthSq()<0.01)vaultHandNormal.copy(player.vaultLandingNormal);
      vaultHandNormal.normalize();
      poseHandToSurface(armR,vaultHandNormal,limbBlend);
    }
    /* Step one knee over the lip first and let the trailing leg follow. The
       stagger prevents the symmetric tucked-leg pose that made the old vault
       read like a teleport, especially on short ledges. */
    const leadT=lowVault?smooth5(Math.max(0,Math.min(1,(vaultK-0.04)/0.72))):
      (quickClimb?smooth5(Math.max(0,Math.min(1,(vaultK-0.2)/0.62))):
        smooth5(Math.max(0,Math.min(1,(vaultK-0.14)/0.66))));
    const leadLiftPhase=smooth5(Math.max(0,Math.min(1,
      (vaultK-(lowVault?0.04:(quickClimb?0.18:0.12)))/
      (lowVault?0.62:(quickClimb?0.62:0.64)))));
    const trailLiftPhase=smooth5(Math.max(0,Math.min(1,
      (vaultK-(lowVault?0.16:(quickClimb?0.34:0.24)))/
      (lowVault?0.62:(quickClimb?0.56:0.6)))));
    const leadLift=Math.sin(Math.PI*leadLiftPhase)*(lowVault?
      0.18+vaultHeightBlend*0.07:(quickClimb?0.22:0.13));
    const trailLift=Math.sin(Math.PI*trailLiftPhase)*(lowVault?
      0.1+vaultHeightBlend*0.05:(quickClimb?0.12:0.06));
    const bodyArc=quickClimb?quickPullArc:vaultArc;
    const leadZ=lowVault?
      lerp(-0.13,0.48,leadT)+vaultArc*(0.22+vaultSpeedBlend*0.08):
      lerp(-0.1,quickClimb?0.38:0.3,leadT)+bodyArc*(quickClimb?0.16:0.2);
    const trailZ=lowVault?
      lerp(-0.2,0.2,leadT)+vaultArc*(0.12+vaultSpeedBlend*0.05):
      lerp(-0.16,quickClimb?0.18:0.12,leadT)+bodyArc*(quickClimb?0.11:0.14);
    const leadY=0.1+bodyArc*(lowVault?0.58+vaultHeightBlend*0.16:
      (quickClimb?0.48:0.43))+
      leadLift-vaultLandingLoad*(lowVault?0.09:0.06);
    const trailY=0.1+bodyArc*(lowVault?0.43+vaultHeightBlend*0.13:
      (quickClimb?0.37:0.34))+
      trailLift-vaultLandingLoad*(lowVault?0.075:0.05);
    const leadX=0.14+(lowVault?0.055+vaultSpeedBlend*0.035:0);
    const trailX=0.14-(lowVault?vaultArc*0.025:0);
    if(player.vaultLeadLeft){
      footTargetL.set(leadX,leadY,leadZ);
      footTargetR.set(-trailX,trailY,trailZ);
    }else{
      footTargetL.set(trailX,trailY,trailZ);
      footTargetR.set(-leadX,leadY,leadZ);
    }
    /* The airborne knee arc is deliberately authored in mantle space, but
       the first recovery frames are already weight-bearing. Re-project both
       ankles onto the actual landing mesh so an uneven or sloped top does not
       leave one boot floating while the other clips into the ledge. Blend from
       the authored end of the arc into those contacts instead of replacing
       the targets in one frame; that preserves momentum while the soles take
       the load. */
    if(vaultRecover&&player.onGround){
      vaultFootAuthoredL.copy(footTargetL);
      vaultFootAuthoredR.copy(footTargetR);
      plantGroundFoot(footTargetL,groundFootWorldL,groundFootNormalL);
      plantGroundFoot(footTargetR,groundFootWorldR,groundFootNormalR);
      vaultPlantLocalL.copy(footTargetL);
      vaultPlantLocalR.copy(footTargetR);
      const landingBlend=smooth5(Math.max(0,Math.min(1,
        vaultLandingElapsed/(lowVault?0.13:0.2))));
      footTargetL.lerpVectors(vaultFootAuthoredL,vaultPlantLocalL,landingBlend);
      footTargetR.lerpVectors(vaultFootAuthoredR,vaultPlantLocalR,landingBlend);
    }
    applyLimbIK(legL,footTargetL,bendFootVaultL,limbBlend);
    applyLimbIK(legR,footTargetR,bendFootVaultR,limbBlend);
    alignFootSurface(legL,vaultRecover?groundFootNormalL:player.vaultLandingNormal,limbBlend*0.75);
    alignFootSurface(legR,vaultRecover?groundFootNormalR:player.vaultLandingNormal,limbBlend*0.75);
  }else{
    /* The camera-side arm is the primary hand. Keeping the trigger hand on
       the shoulder-side grip prevents the old cross-body reach that hid the
       weapon and made the elbow look dislocated in third person. */
    handWorldR.fromArray(profile.primary);gunGroup.localToWorld(handWorldR);toTiltLocal(handWorldR,handTargetR);
    if(profile.support){
      handWorldL.fromArray(profile.support);gunGroup.localToWorld(handWorldL);toTiltLocal(handWorldL,handTargetL);
    }else{
      /* The pistol's free hand counter-swings with the gait instead of staying
         locked to the torso; supported weapons keep both hands on the grip. */
      const freeSwing=walking?gait:0;
      const freeArmTravel=0.16+runGait*0.12;
      handTargetL.set(
        profile.offHand[0]-freeSwing*(0.018+runGait*0.014),
        profile.offHand[1]+(walking?Math.max(0,-freeSwing)*(0.05+runGait*0.045):0),
        profile.offHand[2]-freeSwing*freeArmTravel
      );
    }
    /* The support arm opens toward the foregrip while the trigger arm stays
       tucked under the stock. Giving the two poles different load values
       prevents the old mirrored elbows from collapsing into a single block
       when viewed over the shoulder. */
    const supportLoad=profile.support?1:0.42;
    const sprintLoad=weaponSprint*0.18;
    bendGroundL.set(1.0+supportLoad*0.16-sprintLoad+accelSide*0.22,
      -0.27-weaponSprint*0.07-accelForward*0.04-recoilLoad*0.07,-0.7-supportLoad*0.05);
    bendGroundR.set(-1.0-supportLoad*0.08+sprintLoad+accelSide*0.16,
      -0.31-weaponSprint*0.04-accelForward*0.035-recoilLoad*0.07,-0.76);
    applyLimbIK(armL,handTargetL,bendGroundL,limbBlend);
    applyLimbIK(armR,handTargetR,bendGroundR,limbBlend);
    guy.updateMatrixWorld(true);
    /* The trigger hand is still a weapon hand for a pistol. Previously the
       one-handed branch relaxed both palms, leaving the primary forearm aimed
       at an invisible grip and making the sidearm pose read as a missing arm. */
    poseHandToWeapon(armR,limbBlend,profile.primaryGrip);
    if(profile.support)poseHandToWeapon(armL,limbBlend,profile.supportGrip);
    else relaxHand(armL,limbBlend);
    const stride=lerp(0.5,0.74,runGait);
    const lift=lerp(0.23,0.5,runGait);
    const swingWindow=lerp(0.45,0.53,runGait);
    const airLift=inAir?Math.min(0.38,0.1+Math.abs(player.vel.y)*0.035):0;
    if(walking){
      const cycle=fract(walkPhase/(Math.PI*2));
      const leftPhase=cycle,rightPhase=fract(cycle+0.5);
      const leftLift=updateGroundGaitFoot(leftPhase,1,stride,lift,bodyBounce,
        swingWindow,runGait,footTargetL,groundFootWorldL,groundFootNormalL);
      const rightLift=updateGroundGaitFoot(rightPhase,-1,stride,lift,bodyBounce,
        swingWindow,runGait,footTargetR,groundFootWorldR,groundFootNormalR);
      /* Separate knee poles let the airborne knee drive forward while the
         stance knee remains loaded. A shared pole left both legs rotating as
         one rigid pair even when their ankle targets differed. */
      bendFootGroundL.set(0.12+leftLift*0.32,-0.04,1+leftLift*1.35);
      bendFootGroundR.set(-0.12-rightLift*0.32,-0.04,1+rightLift*1.35);
    }else{
      footTargetL.set(0.13,0.1-bodyBounce+airLift,0);
      footTargetR.set(-0.13,0.1-bodyBounce+airLift,0);
      if(player.onGround){
        plantGroundFoot(footTargetL,groundFootWorldL,groundFootNormalL);
        plantGroundFoot(footTargetR,groundFootWorldR,groundFootNormalR);
      }else{
        groundFootNormalL.copy(UP);groundFootNormalR.copy(UP);
      }
      bendFootGroundL.set(0.12,-0.04,1);
      bendFootGroundR.set(-0.12,-0.04,1);
    }
    const gaitLimbBlend=walking?1-Math.exp(-34*dt):limbBlend;
    applyLimbIK(legL,footTargetL,bendFootGroundL,gaitLimbBlend);
    applyLimbIK(legR,footTargetR,bendFootGroundR,gaitLimbBlend);
    const leftFootPitch=walking?groundGaitFootPitch(fract(walkPhase/(Math.PI*2)),
      swingWindow,runGait):0;
    const rightFootPitch=walking?groundGaitFootPitch(
      fract(walkPhase/(Math.PI*2)+0.5),swingWindow,runGait):0;
    alignFootSurface(legL,groundFootNormalL,gaitLimbBlend*0.86,leftFootPitch,
      walking?-gaitRoll*0.18:0);
    alignFootSurface(legR,groundFootNormalR,gaitLimbBlend*0.86,rightFootPitch,
      walking?gaitRoll*0.18:0);
  }
  const handState=climbing?'climb':(vaulting?'vault':'weapon');
  updateHandDetail(armL,profile.support?handState:(climbing||vaulting?handState:'relaxed'),dt);
  updateHandDetail(armR,handState,dt);
}

let cameraShakePhase=0;
const cameraObstructionHits=[];
function updateCam(dt){
  const motion=gameSettings.cameraMotion;
  cameraShakePhase+=dt;
  const k=1-Math.exp(-14*dt);
  camYaw+=angDiff(targetYaw,camYaw)*k;
  camPitch+=(targetPitch-camPitch)*k;
  const directVaultCameraRecovery=player.mode==='ground'&&player.vaultRecovery>0&&
    (player.vaultKind==='low'||player.vaultKind==='quick');
  const traversalCamera=player.mode==='attach'||player.mode==='move'||player.mode==='hang'||player.mode==='vault'||
    (player.mode==='ground'&&player.grace>0&&player.hold>=0)||directVaultCameraRecovery;
  /* Bring the chase camera in slightly during traversal. The character is
     doing precise hand/foot work against a surface; keeping the normal combat
     distance made the arms sub-pixel at the exact moment their contact pose
     needed to be readable. */
  const sprintCameraBlend=sprinting?
    Math.max(0,Math.min(1,moveSpeed/PLAYER_SPRINT_SPEED)):0;
  /* Keep the normal chase framing stable. Sprint is communicated with a
     restrained FOV change; walking into a collider must never lift or pull the
     camera even if input remains held. */
  const dist=5.6*camZoom*(traversalCamera?0.84:1);
  camTmp1.set(player.pos.x,player.pos.y+1.55,player.pos.z); /* target height */
  camTmp2.set(Math.sin(camYaw)*Math.cos(camPitch),Math.sin(camPitch),Math.cos(camYaw)*Math.cos(camPitch)); /* offset dir */
  /* desired camera position with dynamic shoulder offset */
  camTmp3.copy(camTmp1)
    .addScaledVector(camTmp2,dist);
  camTmp3.x+=Math.cos(camYaw)*0.55;
  camTmp3.y+=0.25;
  camTmp3.z-=Math.sin(camYaw)*0.55;
  /* Traversal may shorten the chase distance, but it never owns azimuth or
     pitch. Derive the camera ray solely from camYaw/camPitch and the normal
     shoulder offset so climbing cannot silently orbit the user's view. */
  camTmp2.copy(camTmp3).sub(camTmp1);
  const L=camTmp2.length()||1;
  camTmp2.divideScalar(L);
  rc.set(camTmp1,camTmp2);rc.far=L;rc.near=0.05;
  cameraObstructionHits.length=0;
  const hits=rc.intersectObjects(getCameraOccluderCandidates(camTmp1,camTmp2,L),false,cameraObstructionHits);
  let d=L,hardHit=null,softHit=null;
  cameraFadeHits.length=0;
  for(const hit of hits){
    if(isVaultCameraSurface(hit.object)){
      if(cameraFadeHits.length<8&&cameraFadeHits.indexOf(hit.object)<0)cameraFadeHits.push(hit.object);
      continue;
    }
    if(isCameraFadeable(hit.object)){
      if(!softHit)softHit=hit;
      if(cameraFadeHits.length<8&&cameraFadeHits.indexOf(hit.object)<0)cameraFadeHits.push(hit.object);
      continue;
    }
    if(!isCameraFadeable(hit.object)){hardHit=hit;break;}
  }
  /* Obstructions may pull the camera closer along its requested ray, but may
     never choose another azimuth. Only mouse input is allowed to turn view. */
  if(hardHit)d=Math.max(0.08,hardHit.distance-0.35);
  /* Moving rubble is a soft obstruction, but it still occupies the line
     between the player and the chase camera. Stop before the first piece so
     the camera cannot drift into a settled pile while the material fades. */
  else if(softHit){
    /* Do not let a close rubble shard collapse the chase camera into the
       character. Fade the obstruction, but preserve enough distance to keep
       the full body, weapon, and landing pose readable. */
    d=Math.max(2.15,softHit.distance-0.42);
  }
  updateCameraFade(cameraFadeHits);
  /* A new wall must shorten the boom immediately. Smoothing inward left the
     camera on the far side of thin walls for several frames after a turn.
     Smooth only the return to open space, retaining the user's view angle. */
  if(d<heldDist)heldDist=d;
  else heldDist+=(d-heldDist)*(1-Math.exp(-10*dt));
  camera.position.copy(camTmp1).addScaledVector(camTmp2,heldDist);
  resolveCameraPosition(camera.position,cameraFadeMesh);
  if(camShake>0){
    /* Presentation must not consume the gameplay random stream: changing
       refresh rate or disabling shake must not change fracture impulses. */
    const shake=camShake*motion*0.5;
    camera.position.x+=Math.sin(cameraShakePhase*113)*shake;
    camera.position.y+=Math.sin(cameraShakePhase*127+1.7)*shake;
    camera.position.z+=Math.sin(cameraShakePhase*97+0.4)*shake;
    camShake=Math.max(0,camShake-dt*2.5);
  }
  /* look a little ahead of travel for a more dynamic feel */
  camTmp3.copy(camTmp1);
  camTmp3.x+=Math.cos(camYaw)*0.55;
  camTmp3.y+=0.25;
  camTmp3.z-=Math.sin(camYaw)*0.55;
  camera.lookAt(camTmp3);
  /* game-loop deliberately clears the sprint flag while a vault owns root
     motion. Preserve the FOV contribution from the entry velocity so a fast
     manual vault does not visibly zoom inward at takeoff and back out at the
     landing frame. */
  const lowVaultFovActive=player.vaultKind==='low'&&
    (player.mode==='vault'||directVaultCameraRecovery);
  const lowVaultFovBlend=lowVaultFovActive?Math.max(0,Math.min(1,
    (player.vaultEntrySpeed-PLAYER_WALK_SPEED)/
    Math.max(0.01,PLAYER_SPRINT_SPEED-PLAYER_WALK_SPEED))):0;
  const baseFov=75+Math.max(sprintCameraBlend,lowVaultFovBlend)*8*motion;
  curFov+=(baseFov-curFov)*(1-Math.exp(-8*dt));
  if(camera.fov!==curFov){
    camera.fov=curFov;
    camera.updateProjectionMatrix();
  }
}
