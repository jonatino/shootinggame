/* Rendering replay loaded only by guarded browser tests. Physics assertions
   belong to scenarios/voxel-progressive-collapse.test.cjs. */
__browserGameTest.pause();
for(const id of ['start','load'])document.getElementById(id).style.display='none';
const replayStructure=voxelPhysics.structures.find(s=>s.mesh.name==='Northwest Spire tier 1');
let replayShot=0;
__browserGameTest.placePlayer({x:-59,y:0,z:-28});updateGuy(0);
camera.position.set(-51,7,-22);camera.lookAt(-61,17,-45);
camera.aspect=1000/800;camera.updateProjectionMatrix();
window.__collapseReplay={
  render(){
    voxelPhysics.syncVisuals();scene.updateMatrixWorld(true);renderer.render(scene,camera);
    return {drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,
      debris:voxelPhysics.debrisMesh.count,staticInstances:replayStructure.mesh.count};
  },
  second(second){
    for(let tick=0;tick<120;tick++){
      if(second<3&&tick%6===0){
        voxelPhysics.damagePath(replayStructure,V(replayStructure.origin.x+5+(replayShot%6)*1.5,
          12+Math.floor(replayShot/6)*0.9,replayStructure.origin.z+replayStructure.nz*replayStructure.sz+0.01),
          V(0,0,-1),2.65,3.2,0.66,8);replayShot++;
      }
      voxelPhysics.update(1/120,true);
    }
    return this.render();
  }
};
