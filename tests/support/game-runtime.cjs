'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createFakeBrowser} = require('./fake-browser.cjs');

const projectRoot = path.resolve(__dirname, '..', '..');
const minimalScripts = [
  'voxel_physics.js',
  'js/core.js',
  'js/destruction.js',
  'js/climbing.js',
  'js/player-controller.js',
  'js/rigid-body.js'
];
const fullScripts = [
  'voxel_physics.js',
  'js/core.js',
  'js/destruction.js',
  'js/world.js',
  'js/combat.js',
  'js/climbing.js',
  'js/player-controller.js',
  'js/player-character.js',
  'js/ui-effects.js',
  'js/rigid-body.js',
  'js/actors.js'
];

const tinyWorldPrelude = String.raw`
const ground=new THREE.Mesh(
  new THREE.PlaneGeometry(200,200),
  new THREE.MeshBasicMaterial({color:0x557755,side:THREE.DoubleSide})
);
ground.rotation.x=-Math.PI*0.5;
ground.updateMatrixWorld(true);
scene.add(ground);
standables.push(ground);
addOccluder(ground);
const enemies=[];
const dummies=[];
const pickups=[];
function dampValue(a,b,rate,dt){return a+(b-a)*(1-Math.exp(-rate*dt));}
function updateStatsUI(){}
function flashHint(){}
function rebuildProxyLists(){
  allProxyMeshes=proxies.map(proxy=>proxy.mesh);
  gripMeshes=proxies.filter(proxy=>proxy.grip).map(proxy=>proxy.mesh);
  proxyByMesh.clear();
  for(const proxy of proxies)proxyByMesh.set(proxy.mesh,proxy);
}
const hangFromPos=V(),hangToPos=V(),climbHoldNormal=V();
`;

const tinyWorldApi = String.raw`
const __testMeshes=[];
function __round(value,places){
  const scale=10**(places===undefined?6:places);
  return Math.round(value*scale)/scale;
}
function __resetPlayer(){
  player.pos.set(0,0,0);
  player.vel.set(0,0,0);
  player.mode='ground';
  player.hold=-1;player.moveFrom=-1;player.moveTo=-1;
  player.attachT=0;player.vaultT=0;player.vaultKind='none';
  player.vaultObstacle=null;player.vaultLandingMesh=null;
  player.vaultRecovery=0;player.cool=0;player.grace=0;
  player.jumpGrace=0;player.jumpBuffer=0;player.climbBuffer=0;
  player.jumpClimbActive=false;player.jumpLaunchY=0;
  player.onGround=true;player.landingSurface=null;player.hp=100;
  camYaw=0;targetYaw=0;camPitch=0;targetPitch=0;
  moveFwd.set(0,0,-1);moveRight.set(1,0,0);moveDir.set(0,0,0);
  walkAmt=0;moveSpeed=0;movementAccel=0;movementAccelWorld.set(0,0,0);
  movementInputSampled=false;movementIntentUntil=0;climbIntentUntil=0;
  climbDownIntentUntil=0;climbGrabRetryAt=0;
  climbIntentDir.set(0,0,0);movementIntentDir.set(0,0,0);
  for(const key in keys)delete keys[key];
}
function __clearTinyWorld(){
  for(const mesh of __testMeshes){
    scene.remove(mesh);
    removeOccluder(mesh);
    const standableIndex=standables.indexOf(mesh);
    if(standableIndex>=0)standables.splice(standableIndex,1);
  }
  __testMeshes.length=0;
  boxes.length=0;cyls.length=0;chunks.length=0;settledFragments.length=0;
  proxies.length=0;allProxyMeshes.length=0;HOLDS=[];
  settledBoxSet.clear();
  staticBoxGridDirty=true;cameraOccluderGridDirty=true;
  __resetPlayer();
}
function __addBox(options){
  const size=options.size||[1,1,1];
  const center=options.center||[0,size[1]*0.5,0];
  const mesh=new THREE.Mesh(
    new THREE.BoxGeometry(size[0],size[1],size[2]),
    new THREE.MeshBasicMaterial({color:options.color||0x999999})
  );
  mesh.position.fromArray(center);
  mesh.userData=Object.assign({},options.userData||{});
  mesh.updateMatrixWorld(true);
  scene.add(mesh);addOccluder(mesh);
  if(options.standable!==false)standables.push(mesh);
  if(options.climbable)proxies.push({mesh,grip:options.grip===false?0:1});
  const box=new THREE.Box3().setFromObject(mesh);
  box.owner=mesh;
  addPhysicsBox(box);
  __testMeshes.push(mesh);
  return mesh;
}
function __setPlayer(position){
  player.pos.fromArray(position);
  player.vel.set(0,0,0);
  player.mode='ground';player.onGround=true;
  player.jumpClimbActive=false;player.jumpLaunchY=player.pos.y;
  player.cool=0;player.grace=0;player.jumpBuffer=0;
}
function __stepGround(ticks,direction,options){
  options=options||{};
  const dt=options.dt||1/120;
  const dir=new THREE.Vector3().fromArray(direction||[0,0,0]);
  if(dir.lengthSq()>0)dir.normalize();
  keys.ShiftLeft=!!options.sprint;
  keys.KeyW=!!options.forward;
  for(let i=0;i<ticks;i++){
    __testClock.advance(dt*1000);
    groundStep(dt,dir);
    player.cool=Math.max(0,player.cool-dt);
    player.grace=Math.max(0,player.grace-dt);
    player.jumpGrace=Math.max(0,player.jumpGrace-dt);
    player.jumpBuffer=Math.max(0,player.jumpBuffer-dt);
    player.climbBuffer=Math.max(0,player.climbBuffer-dt);
    player.vaultRecovery=Math.max(0,player.vaultRecovery-dt);
  }
  keys.ShiftLeft=false;keys.KeyW=false;
}
function __stepVault(ticks,dt){
  dt=dt||1/120;
  for(let i=0;i<ticks&&player.mode==='vault';i++){
    __testClock.advance(dt*1000);
    vaultStep(dt);
  }
}
function __stepAttach(ticks,dt){
  dt=dt||1/120;
  for(let i=0;i<ticks&&player.mode==='attach';i++){
    __testClock.advance(dt*1000);
    moveStep(dt);
  }
}
function __playerState(){
  return {
    pos:player.pos.toArray().map(value=>__round(value)),
    vel:player.vel.toArray().map(value=>__round(value)),
    mode:player.mode,onGround:player.onGround,
    vaultKind:player.vaultKind,
    obstacleHeight:__round(player.vaultObstacleHeight||0),
    obstacleDepth:__round(player.vaultObstacleDepth||0)
  };
}
function __voxelSnapshot(limit){
  const stats=voxelPhysics.stats();
  const array=voxelPhysics.debrisMesh.instanceMatrix.array;
  const count=Math.min(array.length,limit||96);
  const matrices=[];
  for(let i=0;i<count;i++)matrices.push(__round(array[i],5));
  return {stats,matrices};
}
window.__gameTest={
  clear:__clearTinyWorld,
  resetPlayer:__resetPlayer,
  addBox:__addBox,
  setPlayer:__setPlayer,
  setCameraYaw:yaw=>{camYaw=yaw;targetYaw=yaw;},
  stepGround:__stepGround,
  stepVault:__stepVault,
  stepAttach:__stepAttach,
  playerState:__playerState,
  rendererFrames:()=>renderer.renderCount,
  lowVaultPrompt:direction=>canPromptLowVault(new THREE.Vector3().fromArray(direction)),
  startLowVault:(direction,speed,targetSpeed)=>
    tryLowVault(new THREE.Vector3().fromArray(direction),speed,targetSpeed),
  buildClimbGraph:()=>buildGraph(),
  startGrab:air=>{tryGrab(!!air);return __playerState();},
  registerVoxel:options=>voxelPhysics.registerBuilding(options),
  blastVoxel:(position,force)=>voxelPhysics.blast(new THREE.Vector3().fromArray(position),force),
  stepVoxels:(ticks,dt)=>{
    dt=dt||1/120;
    for(let i=0;i<ticks;i++)voxelPhysics.update(dt);
  },
  voxelSnapshot:__voxelSnapshot,
  staticCounts:()=>({boxes:boxes.length,standables:standables.length,occluders:occluders.length})
};
__clearTinyWorld();
`;

function runScript(context, relativePath) {
  const absolutePath = path.join(projectRoot, relativePath);
  const source = fs.readFileSync(absolutePath, 'utf8');
  return vm.runInContext(source, context, {filename: absolutePath});
}

function createRuntime(options = {}) {
  const fake = createFakeBrowser(options);
  const context = vm.createContext(fake.sandbox, {name: 'shooting-game-test'});
  const scripts = options.fullWorld ? fullScripts : minimalScripts;

  runScript(context, scripts[0]);
  runScript(context, scripts[1]);
  if (!options.fullWorld) vm.runInContext(tinyWorldPrelude, context, {filename: 'tiny-world-prelude.js'});
  for (let index = 2; index < scripts.length; index++) runScript(context, scripts[index]);
  if (!options.fullWorld) vm.runInContext(tinyWorldApi, context, {filename: 'tiny-world-api.js'});

  function evaluate(source, filename = 'scenario.js') {
    return vm.runInContext(source, context, {filename});
  }

  function json(source, filename) {
    return JSON.parse(JSON.stringify(evaluate(source, filename)));
  }

  return {
    context,
    clock: fake.clock,
    errors: fake.errors,
    logs: fake.logs,
    evaluate,
    json,
    close() {
      if (!options.fullWorld) evaluate('renderer.dispose();');
    }
  };
}

module.exports = {createRuntime, projectRoot};
