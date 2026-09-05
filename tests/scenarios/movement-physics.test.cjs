'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createRuntime}=require('../support/game-runtime.cjs');

test('a jump stops under a thin ceiling without sideways ejection',()=>{
  const runtime=createRuntime({seed:701});
  const result=runtime.json(`(()=>{
    __addBox({center:[0,2.225,0],size:[4,0.05,4]});
    player.jumpBuffer=0.14;
    let maxY=0;
    for(let i=0;i<180;i++){
      __stepGround(1,[0,0,0]);maxY=Math.max(maxY,player.pos.y);
    }
    return {maxY,state:__playerState()};
  })()`);
  assert.ok(result.maxY>0.4&&result.maxY<=0.501);
  assert.deepEqual(result.state.pos,[0,0,0]);
  assert.equal(result.state.onGround,true);
});

test('fast downward motion lands on a thin platform before side collision',()=>{
  const runtime=createRuntime({seed:702});
  const state=runtime.json(`(()=>{
    __addBox({center:[0,1.975,0],size:[2,0.05,2]});
    __setPlayer([0,3,0]);player.onGround=false;player.vel.y=-60;
    __stepGround(1,[0,0,0],{dt:0.05});return __playerState();
  })()`);
  assert.deepEqual(state.pos,[0,2,0]);
  assert.equal(state.onGround,true);
  assert.equal(state.vel[1],0);
});

test('airborne release retains momentum and counter-steering is weaker than grounded braking',()=>{
  const runtime=createRuntime({seed:703});
  const result=runtime.json(`(()=>{
    __setPlayer([0,10,0]);player.onGround=false;player.vel.x=6;
    __stepGround(24,[0,0,0]);const coasting=player.vel.x;
    __stepGround(6,[-1,0,0]);const steering=player.vel.x;
    __setPlayer([0,0,0]);player.vel.x=6;__stepGround(6,[0,0,0]);
    return {coasting,steering,groundBrake:player.vel.x};
  })()`);
  assert.ok(result.coasting>5.8&&result.coasting<6);
  assert.ok(result.steering>2&&result.steering<result.coasting);
  assert.ok(result.groundBrake<1);
});

test('disabling held jumps preserves a single buffered jump without auto-repeating',()=>{
  const runtime=createRuntime({seed:704});
  const result=runtime.json(`(()=>{
    gameSettings.autoJump=false;keys.Space=true;player.jumpBuffer=0.14;
    __stepGround(30,[0,0,0]);const jumping=player.pos.y;
    __stepGround(250,[0,0,0]);return {jumping,state:__playerState()};
  })()`);
  assert.ok(result.jumping>0.8);
  assert.deepEqual(result.state.pos,[0,0,0]);
  assert.equal(result.state.onGround,true);
});
