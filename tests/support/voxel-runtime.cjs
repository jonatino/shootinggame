'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {createRuntime,projectRoot}=require('./game-runtime.cjs');

function createVoxelRuntime({seed,allowSleep=true}={}){
  const runtime=createRuntime({seed});
  let source=fs.readFileSync(path.join(projectRoot,'voxel_physics.js'),'utf8');
  source=source.replace('const MAX_DEBRIS=3600;',
    'const MAX_DEBRIS=3600;let contactAuditCounts=null,auditIncludeBuried=false;');
  source=source.replace('if(!chunk.exposedFaces[k])continue;',
    'if(!chunk.exposedFaces[k]&&!auditIncludeBuried)continue;');
  source=source.replace('function queueDynamicVoxelPair(a,b,dt,allowLoosePair){',
    'function queueDynamicVoxelPair(a,b,dt,allowLoosePair){if(contactAuditCounts)contactAuditCounts.pairs++;');
  // Expose snapshots in this CPU sandbox only; production has no test hooks.
  source=source.replace('registerBuilding,blast,blastStructure,',`
    orientedContact:(a,b)=>findOrientedContact(a,b)?{...orientedContact}:null,
    exposedFace:(chunk,k,n)=>{
      setChunkContactAxes(chunk);return chunkFaceExposed(chunk,k,n.x,n.y,n.z);
    },
    sleepDebris,
    collisionAudit:()=>{
      const snapshot=()=>Array.from(dynamicBodyContacts,([key,c])=>({key,depth:c.penetration}))
        .sort((a,b)=>a.key-b.key);
      const reset=()=>{dynamicBodyContacts.clear();dynamicContactCount=0;};
      reset();prepareDebrisCollisionEntries();
      buildDynamicVoxelGrid(getExternalDynamicBodies()||[],getExternalSettledBodies()||[]);
      contactAuditCounts={pairs:0};
      solveLooseDebrisPairs(1/120);gatherChunkVoxelContacts(1/120);gatherExternalVoxelContacts(1/120);
      const actual=snapshot(),work=contactAuditCounts;
      const searchedCount=dynamicEntries.length+dynamicExternalEntries.length;
      contactAuditCounts=null;
      // The reference includes every cell, including those omitted by the
      // optimized surface-only search. Contact geometry still decides validity.
      reset();auditIncludeBuried=true;
      buildDynamicVoxelGrid(getExternalDynamicBodies()||[],getExternalSettledBodies()||[]);
      auditIncludeBuried=false;
      const entries=[...dynamicEntries,...dynamicExternalEntries];
      for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++){
        const a=entries[i],b=entries[j];if(a.sleeping&&b.sleeping)continue;
        queueDynamicVoxelPair(a,b,1/120,true);
      }
      return {actual,expected:snapshot(),work,searchedCount,count:entries.length};
    },
    debrisState:()=>Array.from({length:debrisN},(_,k)=>({
      position:[dpx[k],dpy[k],dpz[k]],velocity:[dvx[k],dvy[k],dvz[k]],
      quaternion:[dqx[k],dqy[k],dqz[k],dqw[k]],
      spin:[dwx[k],dwy[k],dwz[k]],size:dsize[k],sleeping:!!dfrozen[k]
    })),setDebrisPose:(k,q,w=[0,0,0])=>{
      [dqx[k],dqy[k],dqz[k],dqw[k]]=q;[dwx[k],dwy[k],dwz[k]]=w;
      updateDebrisExtents(k);dmatrixDirty[k]=1;
    },registerBuilding,blast,blastStructure,`);
  if(!allowSleep){
    if(!source.includes('function debrisQuiet(k){'))
      throw new Error('The no-sleep probe must intercept the shared physical sleep gate.');
    source=source.replace('function debrisQuiet(k){','function debrisQuiet(k){return false;');
  }
  runtime.evaluate(source);
  runtime.evaluate(`const subject=createVoxelDestructionEngine({THREE,scene:new THREE.Scene(),
    getDynamicBodies:()=>chunks,getSettledBodies:()=>settledFragments});`);
  return runtime;
}

module.exports={createVoxelRuntime};
