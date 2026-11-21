import {CONFIG,STEP} from './config.js';
import {makeRng} from './random.js';
import {createInput} from './input.js';
import {initWorld,updateCamera,renderFrame} from './world.js';
import {buildCity} from './city.js';
import {createPlayer,updatePlayerFoot,fireWeapon,damagePlayer,respawnPlayer,givePickup} from './player.js';
import {makeCar,updateCarDrive} from './car.js';
import {spawnTraffic,updateTraffic} from './traffic.js';
import {spawnPeds,updatePeds,makeFarePed,damagePed} from './peds.js';
import {initPolice,addStars,updatePolice,hurtCop,clearWanted} from './police.js';
import {initMissions,updateMissions,startMission,retryMission,missionPanelText} from './missions.js';
import {initEconomy,addMoney,buyItem,setFares,updateFares,saveGame,loadGame,tickSave,SHOP} from './economy.js';
import {createHUD,updateHUD,drawMinimap,toast,hidePanels,showPanel} from './hud.js';
import {S,engineOn,engineOff,engineFromSpeed,initSfx} from './sfx.js';
import {initEffects,updateEffects,spawnTracer,spawnMuzzle,spawnExplosion,spawnSmokePuff,spawnSpark,flashDamage} from './render.js';
import {applyShot} from './shots.js';

const el=(id)=>document.getElementById(id)||{textContent:'',style:{},addEventListener(){}};
const CR=CONFIG.wanted.crime,EC=CONFIG.economy;
const Q=new URLSearchParams(location.search);

function fail(e){document.title='SB-error-'+String((e&&(e.stack||e.message))||e).slice(0,100);}

function boot(){
  const rng=makeRng(Number(Q.get('seed'))||1337);
  const W=initWorld(el('app')),city=buildCity(W,rng),P=createPlayer(W,city);
  const MK=city.markers,cars=city.spawns.carParks.map((s)=>Object.assign(makeCar(s.kind,s.x,s.z,s.heading,s.color,W),{label:s.label||'',missionCar:!!s.mission1}));
  const m1Car=cars.find((c)=>c.label==='m1car')||cars[0];
  const traffic=spawnTraffic(W,rng,11),peds=spawnPeds(W,city,rng,15),PO=initPolice(W,city,rng);
  const M=initMissions(),loaded=loadGame(),E=initEconomy(loaded);
  if(!document.getElementById('timer')){const tm=document.createElement('span');tm.id='timer';document.getElementById('objective').appendChild(tm);}
  const H=createHUD();
  H.toast=(t)=>toast(H,t);
  initSfx();
  Object.assign(initEffects(W),{tracer:spawnTracer,muzzle:spawnMuzzle,explosion:spawnExplosion,smoke:spawnSmokePuff,spark:spawnSpark});
  const I=createInput(W.renderer.domElement);
  const G={
    W,city,P,cars,traffic,peds,PO,M,E,H,I,rng,m1Car,hud:H,sound:S,effects:W.fx,
    screen:'title',inCar:null,alarm:0,alarmX:0,alarmZ:0,time:0,frame:0,fareMarker:null,
    engine:{on:engineOn,off:engineOff,update:engineFromSpeed},
    toast:(t)=>toast(H,t),addMoney:(n)=>addMoney(E,n,H),flashDamage,saveNow:()=>saveGame(G),
    damagePlayer:(a)=>damagePlayer(P,a,G),
    damagePed:(p,a)=>{const w=p.hp;damagePed(p,a,G);if(w>0)addStars(PO,CR.shootPed,G);},
    damageCop:(c,a)=>addStars(PO,hurtCop(c,a,G).killed?CR.killCop:1,G),
    damageTrafficCar:(c,a)=>{c.hp-=a;if(c.hp<=0)explodeCar(c);},
    onCarExplode:explodeCar,
    onPedHit:(p)=>addStars(PO,p.hp>0?CR.hitPed:CR.killPed,G),
    onCopDown:()=>addStars(PO,1,G),
    spawnFare:(x,z)=>{const p=makeFarePed(W,city,rng,x,z);peds.push(p);return p;},
    setFareMarker:(x,z)=>{G.fareMarker=x==null?null:{x,z};},
    missionText:()=>missionPanelText(M,G),
    explodeCar,spawnExplosion,bust:()=>bust(),wasted:()=>wasted(),
    missionComplete:(d)=>{
      el('complete-title').textContent=d.title.toUpperCase()+' COMPLETE';
      el('complete-story').textContent=d.story;
      el('complete-reward').textContent='Reward $'+d.reward;
      play();showPanel(H,'complete');
    },
  };
  function explodeCar(c){
    if(!c||c.wrecked)return;
    c.wrecked=true;c.speed=0;
    spawnExplosion({x:c.x,y:1,z:c.z});
    c.mesh.traverse((o)=>{if(o.isMesh)o.material.color.setHex(0x2f2924);});
    S.explode();
    if(G.inCar===c){leaveCar();damagePlayer(P,50,G);}
  }
  function leaveCar(){
    const c=G.inCar;
    if(!c)return;
    Object.assign(c,{player:false,occupant:null});
    G.inCar=null;
    P.pos.x=c.x+2.2;P.pos.z=c.z;P.group.visible=true;
    P.group.position.set(P.pos.x,0,P.pos.z);engineOff();
  }
  function takeCar(c){
    if(!c||c.wrecked)return;
    leaveCar();
    const npc=c.occupant==='npc';
    addStars(PO,c.kind==='police'?CR.policeCar:npc?CR.theftOccupied:0,G);
    if(npc)peds.push(Object.assign(makeFarePed(W,city,rng,c.x+2.4,c.z),{state:'flee',fare:false,fleeT:6,fleeX:P.pos.x,fleeZ:P.pos.z}));
    Object.assign(c,{occupant:'player',player:true});
    G.inCar=c;P.group.visible=false;engineOn(c.kind);
  }
  function nearestCar(){
    let best=null,near=3.2;
    for(const c of cars.concat(traffic)){
      const d=Math.hypot(c.x-P.pos.x,c.z-P.pos.z);
      if(!c.wrecked&&d<near){near=d;best=c;}
    }
    return best;
  }
  const end=(id,fee)=>{
    if(G.screen!=='play')return;
    G.screen=id;
    E.money=Math.max(0,E.money-fee);
    showPanel(H,id);S.jingle(false);
  };
  const bust=()=>end('busted',EC.bustedFee),wasted=()=>end('wasted',EC.hospitalFee);
  const play=()=>{hidePanels(H);G.orbit=null;G.screen='play';I.lock();};
  function leave(where){
    leaveCar();clearWanted(PO,G);respawnPlayer(P,G,where);G.alarm=0;play();
  }
  function reset(src){
    Object.assign(E,{money:src?src.money:EC.start});
    Object.assign(M,{index:src?src.missionIndex|0:0,active:null,done:src?src.missionIndex|0:0,fail:null,stage:0});
    Object.assign(P,src?{rifle:!!src.rifle,ammo:src.ammo|0,armor:Math.min(100,src.armor|0)}
      :{rifle:false,ammo:0,armor:0,hp:CONFIG.player.hp,weapon:'pistol'});
    play();
    toast(H,src?'Welcome back':'Meet Vesper');
  }
  function openShop(){
    if(G.inCar||P.dead)return;
    const v=MK.vineMart;
    if(Math.hypot(P.pos.x-v.x,P.pos.z-v.z)>9)return toast(H,'Vine Mart only');
    const list=el('shop-list');
    list.replaceChildren();
    for(const r of SHOP){
      const line=document.createElement('div');
      line.className='shopitem';
      line.innerHTML='<b>'+r.label+'</b><button>$'+r.price+'</button>';
      line.lastChild.onclick=()=>{buyItem(E,P,r.item,G);openShop();};
      list.appendChild(line);
    }
    G.screen='shop';showPanel(H,'shop');I.unlock();
  }
  const bind=(id,fn)=>el(id).addEventListener('click',(e)=>{e.preventDefault();fn();});
  if(loaded){el('btn-continue').style.display='';bind('btn-continue',()=>reset(loaded));}
  bind('btn-new',()=>reset(null));
  for(const id of['btn-resume','btn-shop-close','btn-next'])bind(id,play);
  bind('btn-busted-ok',()=>leave(MK.station));
  bind('btn-wasted-ok',()=>leave(MK.hospital));
  W.renderer.domElement.addEventListener('mousedown',()=>{
    if(G.screen!=='play')return;
    if(!I.locked)I.lock();
    else if(!G.inCar&&!P.dead)fireWeapon(P,G);
  });
  function step(dt){
    G.time+=dt;G.alarm=Math.max(0,G.alarm-dt*0.35);
    const up=city.pickup,c=G.inCar;
    if(!P.rifle&&Math.hypot(P.pos.x-up.x,P.pos.z-up.z)<2&&givePickup(P,G,'rifle')){P.ammo=P.ammo||60;toast(H,'Rifle');}
    if(c){
      const ax=I.axis();
      updateCarDrive(c,ax.y,-ax.x,I.down('Space')?1:0,dt,W,G);
      P.yaw=c.heading;P.pos.x=c.x;P.pos.z=c.z;
      if(c.wrecked)leaveCar();
      engineFromSpeed(c,dt);
    }else updatePlayerFoot(P,G,I,dt);
    updateTraffic(traffic,W,G,dt);updatePeds(peds,W,G,dt);
    updatePolice(PO,G,I,dt);updateMissions(M,G,dt);
    updateFares(E,G,dt);updateEffects(W,dt);tickSave(E,G,dt);
  }
  function keys(){
    if(I.wasPressed('Escape')){
      if(G.screen==='play'){G.screen='pause';showPanel(H,'pause');I.unlock();}else play();
      return;
    }
    if(G.screen!=='play'){if(M.fail&&I.wasPressed('KeyR'))retryMission(M,G);return;}
    if(I.wasPressed('KeyE'))G.inCar?leaveCar():takeCar(nearestCar());
    if(I.wasPressed('KeyF')&&!G.inCar&&!P.dead)fireWeapon(P,G);
    if(I.wasPressed('KeyT'))G.inCar&&G.inCar.kind==='taxi'?setFares(E,!E.fares,G):toast(H,'Taxi only');
    if(I.wasPressed('KeyB'))openShop();
    if(I.wasPressed('KeyR')&&!M.active&&!retryMission(M,G))startMission(M,G);
    if(I.wasPressed('KeyQ')&&P.rifle){P.rifle=P.weapon!=='rifle';P.weapon=P.rifle?'rifle':'pistol';}
  }
  let acc=0,last=performance.now();
  function loop(now){
    try{
      const raw=Math.min(0.25,Math.max(0,(now-last)/1000));
      last=now;
      if(G.screen==='play'){
        keys();acc=Math.min(acc+raw,STEP*5);
        while(acc>=STEP){step(STEP);acc-=STEP;}
      }else acc=0;
      const o=G.orbit,c=G.inCar;
      if(o){
        o.yaw+=o.spin*raw;
        W.camera.position.set(o.x+Math.sin(o.yaw)*o.dist,o.y,o.z+Math.cos(o.yaw)*o.dist);W.camera.lookAt(o.x+40,12,o.z-60);
      }else updateCamera(W,I,c?{x:c.x,z:c.z,inCar:true,y:1.4}:{x:P.pos.x,z:P.pos.z,inCar:false,y:CONFIG.player.camHeight},G.screen==='play'?STEP:raw);
      renderFrame(W);G.frame++;
      if(G.frame%2===0)drawMinimap(H,G);
      updateHUD(H,G,raw);I.endFrame();
    }catch(e){fail(e);}
    requestAnimationFrame(loop);
  }
  if(Q.get('shot'))applyShot(Q.get('shot'),G);
  else showPanel(H,'title');
  requestAnimationFrame(loop);
}

try{boot();}catch(e){fail(e);}
