'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createVoxelRuntime}=require('../support/voxel-runtime.cjs');

const piles=[
  {name:'deep',allowSleep:true,width:3,layers:12,base:4,spacing:0.5,size:0.4},
  {name:'deep',allowSleep:false,width:3,layers:12,base:4,spacing:0.5,size:0.4},
  {name:'foundation-supported',allowSleep:false,width:3,layers:12,base:4,spacing:0.5,size:0.4,foundation:true},
  {name:'mixed-size foundation-supported',allowSleep:false,width:3,layers:8,base:2,spacing:0.8,size:0.6,foundation:true,mixed:true},
  {name:'640-brick',allowSleep:false,width:8,layers:10,base:1,spacing:0.6,size:0.55}
];
for(const {name,allowSleep,width,layers,base,spacing,size,foundation,mixed} of piles)
test(`a ${name} rubble pile loses motion through contacts with sleep ${allowSleep?'enabled':'disabled'}`,()=>{
  const runtime=createVoxelRuntime({seed:980,allowSleep});
  const result=runtime.json(`(()=>{
    ${foundation?`subject.registerBuilding({x:0,z:0,width:5,height:0.8,depth:5,
      voxelSize:0.8,shape:'solid',simulateLoads:false});`:''}
    for(let y=0;y<${layers};y++)for(let x=0;x<${width};x++)for(let z=0;z<${width};z++)
      subject.emitDebris(V(x*${spacing},${base}+y*${spacing},z*${spacing}),V(),${mixed?'y%2===0?0.28:':''}${size});
    for(let tick=0;tick<1200;tick++)subject.update(1/120,true);
    const before=subject.debrisState();
    let maxSpeed=0,maxSurfaceSpin=0,maxDrift=0;
    for(let tick=0;tick<120;tick++){
      subject.update(1/120,true);
      for(const [k,body] of subject.debrisState().entries()){
        maxSpeed=Math.max(maxSpeed,Math.hypot(...body.velocity));
        maxSurfaceSpin=Math.max(maxSurfaceSpin,Math.hypot(...body.spin)*body.size*0.5);
        maxDrift=Math.max(maxDrift,V(...body.position).distanceTo(V(...before[k].position)));
      }
    }
    return {maxSpeed,maxSurfaceSpin,maxDrift,count:before.length,
      sleeping:subject.debrisState().filter(body=>body.sleeping).length};
  })()`);
  assert.equal(result.count,width*width*layers,'rest must not be achieved by deleting rubble');
  assert.ok(result.maxSpeed<0.05,`contact velocities failed to converge: ${JSON.stringify(result)}`);
  assert.ok(result.maxSurfaceSpin<0.05,`contact friction left bricks spinning: ${JSON.stringify(result)}`);
  assert.ok(result.maxDrift<0.015,`the rubble pile is still bobbing: ${JSON.stringify(result)}`);
  if(!allowSleep)assert.equal(result.sleeping,0,'the contact solve must work without freezing any body');
});

test('a rotating section gives up rotational energy when it knocks loose rubble away',()=>{
  const runtime=createVoxelRuntime({seed:982,allowSleep:false});
  const result=runtime.json(`(()=>{
    subject.registerBuilding({x:0,y:20,z:0,width:1,height:2,depth:1,
      voxelSize:0.5,shape:'solid',anchorBase:false,simulateLoads:false});
    subject.update(1/120);const c=subject.chunks[0];
    c.vel.set(0,0,0);c.axis.set(0,0,1);c.omega=3;
    subject.emitDebris(V(-0.6,c.mesh.position.y+0.75,0.25),V(),0.35);
    const energy=()=>{
      const mass=c.count*c.st.sx*c.st.sy*c.st.sz;
      const inertia=mass*(c.radius*c.radius*0.4+
        (c.st.sx*c.st.sx+c.st.sy*c.st.sy+c.st.sz*c.st.sz)/18);
      let total=mass*9.81*c.mesh.position.y+mass*c.vel.lengthSq()*0.5+inertia*c.omega*c.omega*0.5;
      for(const b of subject.debrisState()){
        const m=Math.max(0.012,b.size**3);
        total+=m*9.81*b.position[1]+m*Math.hypot(...b.velocity)**2*0.5+
          m*b.size*b.size/6*Math.hypot(...b.spin)**2*0.5;
      }
      return total;
    };
    const before=energy();subject.update(1/120);
    return {before,after:energy(),omega:c.omega,velocity:subject.debrisState()[0].velocity};
  })()`);
  assert.ok(result.velocity[0]<-0.1,'the loose brick must actually be struck by the rotating section');
  assert.ok(result.omega<3,'the section must receive the opposing contact torque');
  assert.ok(result.after<=result.before+0.001,
    `the collision generated energy: ${JSON.stringify(result)}`);
});

test('old unsupported rubble retains ballistic motion rather than expiring into a settled pose',()=>{
  const runtime=createVoxelRuntime({seed:981,allowSleep:false});
  const result=runtime.json(`(()=>{
    subject.emitDebris(V(0,3000,0),V(2,0,-1),0.4);
    const initial=subject.debrisState()[0];
    for(let tick=0;tick<2400;tick++)subject.update(1/120,true);
    return {initial,after:subject.debrisState()[0]};
  })()`);
  assert.ok(Math.abs(result.after.position[1]-(3000-9.81*20*20/2))<0.08);
  assert.ok(Math.abs(result.after.velocity[1]+9.81*20)<0.01);
  assert.ok(Math.abs(result.after.position[0]-40)<0.002);
  assert.deepEqual(result.after.spin,result.initial.spin,'contact resistance cannot act in open air');
  assert.equal(result.after.sleeping,false);
});
