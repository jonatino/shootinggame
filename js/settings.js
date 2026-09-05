/* Saved preferences. This file loads before the renderer and input modules. */
const SETTINGS_KEY='proxy-climb.settings.v1';
const DEFAULT_SETTINGS=Object.freeze({
  sensitivity:1,invertY:false,cameraMotion:1,autoJump:true,quality:'high'
});
function normalizeGameSettings(value){
  const source=value&&typeof value==='object'?value:{};
  const number=(key,min,max)=>Number.isFinite(source[key])?
    Math.max(min,Math.min(max,source[key])):DEFAULT_SETTINGS[key];
  return {
    sensitivity:number('sensitivity',0.25,2.5),
    invertY:typeof source.invertY==='boolean'?source.invertY:DEFAULT_SETTINGS.invertY,
    cameraMotion:number('cameraMotion',0,1),
    autoJump:typeof source.autoJump==='boolean'?source.autoJump:DEFAULT_SETTINGS.autoJump,
    quality:['high','balanced','performance'].includes(source.quality)?source.quality:DEFAULT_SETTINGS.quality
  };
}
const gameSettings=(()=>{
  try{return normalizeGameSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY)));}
  catch(_){return {...DEFAULT_SETTINGS};}
})();
function saveGameSettings(){
  try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(gameSettings));}catch(_){}
}
function syncSettingsControls(){
  const sensitivity=document.getElementById('sensitivity');
  if(!sensitivity)return;
  sensitivity.value=gameSettings.sensitivity;
  document.getElementById('sensitivity-value').textContent=gameSettings.sensitivity.toFixed(2)+'×';
  document.getElementById('invert-y').checked=gameSettings.invertY;
  document.getElementById('auto-jump').checked=gameSettings.autoJump;
  document.getElementById('camera-motion').value=gameSettings.cameraMotion;
  document.getElementById('quality').value=gameSettings.quality;
}
function setGameSetting(key,value){
  Object.assign(gameSettings,normalizeGameSettings({...gameSettings,[key]:value}));
  saveGameSettings();
  syncSettingsControls();
  if(key==='quality')applyRenderSettings();
}
for(const [id,key,kind] of [
  ['sensitivity','sensitivity','number'],['invert-y','invertY','boolean'],
  ['auto-jump','autoJump','boolean'],['camera-motion','cameraMotion','number'],
  ['quality','quality','string']
]){
  const control=document.getElementById(id);
  if(control)control.addEventListener('input',()=>setGameSetting(key,
    kind==='boolean'?control.checked:(kind==='number'?Number(control.value):control.value)));
}
syncSettingsControls();
