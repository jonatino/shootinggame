/* Installed in every test document before any game script. Even headless
   Chromium can capture/recenter the Windows pointer through pointer lock. */
(() => {
  'use strict';
  let element=null,allowLock=false,requests=0,releases=0;
  const nativeGetter=Object.getOwnPropertyDescriptor(Document.prototype,'pointerLockElement')?.get;
  const notify=()=>queueMicrotask(()=>document.dispatchEvent(new Event('pointerlockchange')));
  function requestPointerLock(){
    requests++;
    if(!allowLock)return Promise.reject(new DOMException(
      'Native pointer capture is disabled in automated tests','NotAllowedError'));
    element=this;
    notify();
    return Promise.resolve();
  }
  function exitPointerLock(){
    releases++;
    if(element){element=null;notify();}
  }
  for(const name of ['requestPointerLock','webkitRequestPointerLock','mozRequestPointerLock']){
    Object.defineProperty(Element.prototype,name,{
      value:requestPointerLock,configurable:false,writable:false
    });
  }
  for(const name of ['exitPointerLock','webkitExitPointerLock','mozExitPointerLock']){
    Object.defineProperty(Document.prototype,name,{
      value:exitPointerLock,configurable:false,writable:false
    });
  }
  for(const name of ['pointerLockElement','webkitPointerLockElement','mozPointerLockElement']){
    Object.defineProperty(document,name,{get:()=>element,configurable:false});
  }
  Object.defineProperty(window,'__browserInputSafety',{
    value:Object.freeze({
      allowSimulatedLock(value){allowLock=!!value;},
      releaseSimulatedLock:exitPointerLock,
      state(){return {
        requests,releases,simulatedLocked:element!==null,
        nativeLocked:nativeGetter?nativeGetter.call(document)!==null:false
      };}
    }),configurable:false,writable:false
  });
})();
