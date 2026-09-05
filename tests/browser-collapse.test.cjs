'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {openGamePage}=require('./support/browser-runtime.cjs');
const {projectRoot}=require('./support/game-runtime.cjs');

test('an authored cannon breach renders its opening and surviving rubble throughout the collapse',async()=>{
  const runtime=await openGamePage();
  try{
    const page=runtime.page;
    await page.setViewportSize({width:1000,height:800});
    await page.addScriptTag({path:path.join(__dirname,'browser','collapse-replay.js')});
    const out=path.join(projectRoot,'test-results');fs.mkdirSync(out,{recursive:true});
    const before=await page.evaluate(()=>__collapseReplay.render());
    await page.screenshot({path:path.join(out,'collapse-before.png')});
    let after;
    for(let second=0;second<12;second++){
      after=await page.evaluate(second=>__collapseReplay.second(second),second);
      if(second===2||second===11)
        await page.screenshot({path:path.join(out,`collapse-${second+1}s.png`)});
    }
    assert.ok(after.staticInstances<before.staticInstances);
    assert.ok(after.debris>0&&after.triangles>0&&after.drawCalls>0);
    assert.deepEqual(runtime.errors,[]);
    const safety=await page.evaluate(()=>__browserInputSafety.state());
    assert.equal(safety.nativeLocked,false);
    assert.equal(safety.requests,0);
  }finally{await runtime.close();}
});
