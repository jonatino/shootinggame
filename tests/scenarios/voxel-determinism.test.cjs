'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {createRuntime} = require('../support/game-runtime.cjs');

function runBlast(seed) {
  const runtime = createRuntime({seed});
  return runtime.json(String.raw`(()=>{
    __gameTest.registerVoxel({
      x:0,y:1,z:0,width:2,height:2,depth:2,
      voxelSize:0.5,shape:'solid',color:0x999999
    });
    const killed=__gameTest.blastVoxel([0,1,0],8);
    __gameTest.stepVoxels(120);
    return {killed,snapshot:__gameTest.voxelSnapshot()};
  })()`);
}

test('seeded voxel destruction produces an exact replayable state', () => {
  const first = runBlast(12345);
  const replay = runBlast(12345);

  assert.equal(first.killed, 64);
  assert.equal(first.snapshot.stats.voxels, 0);
  assert.equal(first.snapshot.stats.debris, 192);
  assert.deepEqual(replay, first);
});

test('random seed is part of the scenario instead of hidden global state', () => {
  const first = runBlast(111);
  const second = runBlast(222);

  assert.deepEqual(second.snapshot.stats, first.snapshot.stats);
  assert.notDeepEqual(second.snapshot.matrices, first.snapshot.matrices);
});
