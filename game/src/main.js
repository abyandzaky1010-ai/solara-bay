import { CONFIG, STEP } from './config.js';
import { makeRng } from './random.js';
import { createInput } from './input.js';
import { initWorld, updateCamera, renderFrame } from './world.js';
import { buildCity } from './city.js';
import { createPlayer, updatePlayerFoot, fireWeapon, damagePlayer, respawnPlayer, givePickup } from './player.js';
import { makeCar, seatPoints, updateCarDrive } from './car.js';
import { spawnTraffic, updateTraffic } from './traffic.js';
import { spawnPeds, makeFarePed, damagePed, updatePeds } from './peds.js';
import { initPolice, addStars, updatePolice } from './police.js';
import { initMissions, updateMissions, retryMission } from './missions.js';
import { SHOP, initEconomy, addMoney, buyItem, setFares, updateFares, saveGame, loadGame } from './economy.js';
import { createHUD, updateHUD, drawMinimap, fillShop, showPanel, hidePanels, toast } from './hud.js';
import { initSfx, S, engineOn, engineUpdate, engineOff, sirenTick } from './sfx.js';
import { initEffects, spawnTracer, spawnMuzzle, spawnExplosion, updateEffects } from './render.js';
import { applyShot } from './shots.js';

const ECO=CONFIG.economy,WANT=CONFIG.wanted,$=id=>document.getElementById(id),
QS=new URLSearchParams(location.search),set=(o,d)=>Object.assign(o,d);

function fail(e){
  const m=String((e&&(e.stack||e.message))||e).slice(0,100);
  document.title='SB-error-'+m;
  const b=document.createElement('pre');
  b.id='sb-error';b.textContent=m;document.body.append(b);
}

function boot(){
  const shot=QS.get('shot'),rng=makeRng(Number(QS.get('seed'))||1337),
  W=initWorld(document.querySelector('#app canvas')||document.querySelector('canvas')),
  city=buildCity(W,rng),P=createPlayer(W,city),
  cars=city.spawns.carParks.map(p=>{
    const c=makeCar(p.kind,p.x,p.z,p.heading||0,p.color);
    c.tag=c.label=p.tag;W.scene.add(c.mesh);return c;
  }),
  saved=loadGame(),m1Car=cars.find(c=>c.tag==='m1car')||null,
  G={W,city,P,cars,m1Car,m1:m1Car,rng,saved,
    traffic:spawnTraffic(W,rng,11),peds:spawnPeds(W,city,rng,15),
    PO:initPolice(W,city,rng),M:initMissions(),E:initEconomy(shot?null:saved),
    H:createHUD(),I:createInput(W.renderer.domElement),screen:'play',
    inCar:null,alarm:0,alarmX:0,alarmZ:0,time:0,saveT:0,shot,
    fareMarker:null,bustedP:null};
  const PO=G.PO,M=G.M,E=G.E,H=G.H,I=G.I,say=t=>toast(H,t);
  initSfx();initEffects(W);

  const unlock=()=>document.exitPointerLock&&document.exitPointerLock(),
  playing=()=>G.screen==='play',
  back=()=>{G.screen='play';hidePanels(H);I.lock();},
  panel=(id,fx)=>{G.screen=id;showPanel(H,id);engineOff();unlock();if(fx)fx();},
  save=()=>{$('pause-save').textContent=saveGame(G)?'Saved.':'Storage blocked.';},
  revive=where=>{respawnPlayer(P,G,where);G.bustedP=null;back();},
  knock=(id,fee)=>{
    if(!playing())return;
    E.money=Math.max(0,E.money-fee);
    set(P,{hp:0,dead:true});
    PO.stars=PO.noSeeT=0;
    panel(id);S.jingle(false);
    $(id+'-text').textContent='That cost you $'+fee+'.';
    G.bustedP=id;
  },
  start=slot=>{
    if(slot){
      E.money=slot.money;
      const i=slot.missionIndex|0;
      set(P,{rifle:slot.rifle,ammo:slot.ammo,armor:slot.armor,weapon:slot.rifle?'rifle':'pistol'});
      set(M,{index:i,done:i,fail:null});
    }
    say(slot?'Welcome back to Solara Bay':'Solara Bay: see Vesper');
    back();
  },
  shop=()=>{
    const vm=city.markers.vineMart;
    if(G.inCar)say('Step out to shop');
    else if(Math.hypot(P.pos.x-vm.x,P.pos.z-vm.z)>3)say('Vine Mart is east');
    else panel('shop');
  },
  pause=()=>panel('pause',save),
  fire=()=>{if(!G.inCar)fireWeapon(P,G);},
  steal=()=>{
    const at=G.inCar||P.pos;
    let car=null,gap=3.2;
    for(const c of cars){
      const d=Math.hypot(c.x-at.x,c.z-at.z);
      if(!c.wrecked&&d<gap){gap=d;car=c;}
    }
    if(!car)return say('No car in reach');
    if(car.occupant==='npc'||car.traffic){
      G.peds.push(set(makeFarePed(W,city,rng,car.x+2.5,car.z+2.5),{fare:false,state:'flee',fleeX:car.x,fleeZ:car.z,fleeT:4}));
      addStars(PO,WANT.theftOccupied,G);
    }
    if(car.kind==='police')addStars(PO,WANT.policeCar,G);
    set(car,{player:true,occupant:'player',traffic:false});
    G.inCar=car;engineOn();S.door();
  },
  leave=()=>{
    const o=seatPoints(G.inCar);
    set(G.inCar,{player:false,occupant:null});
    G.inCar=null;engineOff();
    P.pos.set(o.x,0,o.z);P.yaw=o.heading;
  },
  stars=n=>()=>addStars(PO,n,G),
  effects={spawnTracer,spawnMuzzle,spawnExplosion,tracer:spawnTracer};
  set(G,{
    sound:S,engine:{on:engineOn,off:engineOff,set:engineUpdate},effects,
    spawnExplosion,damagePlayer,damagePed,addStars:n=>addStars(PO,n,G),economyBonus:n=>addMoney(E,n,H),
    damageTrafficCar:(c,a)=>{c.hp-=a;},toast:say,
    spawnFare:(x,z)=>G.peds.push(makeFarePed(W,city,rng,x,z)),
    onPedKilled:stars(3),damageCop:stars(1),onCopDown:stars(3),explodeCar:stars(1),
    setFareMarker:(x,z)=>{G.fareMarker=x==null?null:{x,z};},
    onPedHit:()=>{addStars(PO,2,G);say('Witness!');},
    onCarExplode:c=>spawnExplosion({x:c?c.x:P.pos.x,y:1,z:c?c.z:P.pos.z}),
    missionStart:d=>say(d.title),
    missionFail:(t,w)=>say(t+': '+w+' Press R to retry.'),
    missionComplete:o=>{
      saveGame(G);
      $('complete-story').textContent=o.story;
      $('complete-reward').textContent='Reward $'+o.reward+', $'+Math.round(E.money)+' banked.';
      panel('complete');
    },
    bust:()=>knock('busted',ECO.bustedFee),
    wasted:()=>knock('wasted',ECO.hospitalFee),
  });
  effects.flashDamage=()=>{const h=$('hud');h.classList.add('hurt');setTimeout(()=>h.classList.remove('hurt'),200);};

  const wipe=()=>{try{localStorage.removeItem(ECO.saveKey);}catch(e){}start(null);},
  acts={'btn-continue':()=>start(saved),'btn-new':wipe,'btn-save':save,
    'btn-resume':back,'btn-shop-close':back,'btn-next':back,
    'btn-busted-ok':()=>revive(city.markers.station),
    'btn-wasted-ok':()=>revive(city.markers.hospital)};
  for(const id in acts)$(id).onclick=acts[id];
  if(saved)$('btn-continue').style.display='inline-block';
  fillShop(H,SHOP,item=>buyItem(E,P,item,G));
  W.renderer.domElement.addEventListener('mousedown',ev=>{if(ev.button===0&&playing()){I.lock();fire();}});

  const keys={
    KeyEscape:pause,KeyP:pause,KeyB:shop,KeyF:fire,Mouse0:fire,
    KeyE:()=>(G.inCar?leave():steal()),
    KeyR:()=>M.fail&&retryMission(M,G),
    KeyT:()=>(G.inCar&&G.inCar.kind==='taxi'?setFares(E,!E.fares,G):say('Fares need a cab')),
    KeyQ:()=>P.rifle&&(P.weapon=P.weapon==='rifle'?'pistol':'rifle'),
  },
  controls=()=>{
    const s=G.screen,hit=k=>I.wasPressed(k);
    if(s==='play'){for(const k in keys)if(hit(k))return keys[k]();return;}
    if(s==='title')return(hit('Enter')||hit('Space'))&&start(saved);
    if(s==='busted'||s==='wasted')return(hit('KeyE')||hit('Enter'))&&acts['btn-'+s+'-ok']();
    for(const k of ['Escape','KeyE','KeyB','Enter'])if(hit(k))return back();
  },
  step=dt=>{
    G.time+=dt;
    G.alarm=Math.max(0,G.alarm-dt);
    sirenTick(dt);
    controls();
    if(!playing())return updateEffects(W,dt);
    const car=G.inCar,on=(a,b)=>(I.down(a)||I.down(b)?1:0),pk=city.pickup;
    if(car){
      updateCarDrive(car,on('KeyW','ArrowUp')-on('KeyS','ArrowDown'),on('KeyD','ArrowRight')-on('KeyA','ArrowLeft'),I.down('Space'),dt,W,G);
      P.pos.set(car.x,0,car.z);
      engineUpdate(Math.min(1,Math.abs(car.speed)/28));
      if(car.wrecked)G.wasted();
    }else if(!P.dead){
      updatePlayerFoot(P,G,I,dt);
      if(pk&&!P.rifle&&Math.hypot(P.pos.x-pk.x,P.pos.z-pk.z)<2){givePickup(P,G,'rifle');P.ammo+=60;}
    }
    updateTraffic(G.traffic,W,G,dt);
    updatePeds(G.peds,W,G,dt);
    updatePolice(PO,G,I,dt);
    updateMissions(M,G,dt);
    updateFares(E,G,dt);
    updateEffects(W,dt);
    G.saveT+=dt;
    if(G.saveT>=10){G.saveT=0;saveGame(G);}
  };

  let last=0,acc=0,n=0;
  const frame=now=>{
    try{
      acc=Math.min(0.3,acc+(last?(now-last)/1000:STEP));
      last=now;
      for(let k=0;acc>=STEP&&k<5;k+=1){acc-=STEP;step(STEP);}
      n+=1;
      updateCamera(W,I,G.inCar||P,STEP);
      renderFrame(W);
      if(G.screen!=='title'){updateHUD(H,G,STEP);if(n%2===0)drawMinimap(H,G);}
      if(G.shot&&n>=2&&!window.__shotReady){applyShot(G.shot,G);document.title=window.__shotReady='SB-'+G.shot+'-ok';}
      I.endFrame();
    }catch(e){fail(e);return;}
    requestAnimationFrame(frame);
  };
  if(shot){hidePanels(H);applyShot(shot,G);}else showPanel(H,'title');
  requestAnimationFrame(frame);
}

try{boot();}catch(e){fail(e);}
