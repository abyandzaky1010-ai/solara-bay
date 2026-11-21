import {makeRng} from './random.js';
import {CONFIG} from './config.js';
import {C} from './palette.js';
import {makeCar,syncCarMesh} from './car.js';
import {addStars} from './police.js';
import {startMission} from './missions.js';
import {makeFarePed} from './peds.js';
import {showPanel,hidePanels} from './hud.js';
import {spawnTracer,spawnMuzzle} from './render.js';

const rng=makeRng(1);
const PI=Math.PI;

function pose(G){
  Object.assign(G,{freezePolice:true,freezeMissions:true,freezeFares:true,screen:'play',inCar:null});
  hidePanels(G.H);
  G.P.dead=false;
}

/** Clear the street: only what a scene adds stays on screen. */
function hollow(G){
  for(const t of G.traffic)t.mesh.visible=false;
  for(const c of G.cars)c.mesh.visible=false;
  for(const p of G.peds)p.parts.root.visible=false;
}

function seat(G,c){
  Object.assign(c,{occupant:'player',player:true,speed:0,wrecked:false,hp:CONFIG.car.hp});
  G.inCar=c;
  G.P.pos.x=c.x;
  G.P.pos.z=c.z;
  G.P.yaw=c.heading;
  G.P.group.visible=false;
  syncCarMesh(c);
}

function stand(G,x,z,yaw){
  const P=G.P;
  P.pos.x=x;
  P.pos.z=z;
  P.yaw=yaw;
  P.aim=true;
  P.dead=false;
  P.group.visible=true;
  P.group.position.set(x,0,z);
  P.group.rotation.set(0,yaw,0);
}

function car(G,x,z,h,color,taxi){
  const c=makeCar(taxi?'taxi':'sedan',x,z,h,color,G.W);
  G.traffic.push(c);
  syncCarMesh(c);
  return c;
}

function copAt(x,z,yaw,down){
  const pos={x,z,set(){return this;}};
  return {x,z,yaw,pos,mesh:null,state:down?'down':'run',cool:9,down:!!down,dead:!!down,downT:1,hp:down?0:60};
}

/** Marked cruiser facing a target; its officer on foot is returned. */
function cop(G,x,z,tx,tz,foot){
  const c=makeCar('police',x,z,Math.atan2(x-tx,z-tz),C.copbody,G.W);
  Object.assign(c,{occupant:'npc',sirenOn:true,flashT:0.05});
  G.PO.cars.push(c);
  syncCarMesh(c);
  const o=copAt(x,z,c.heading,false);
  if(foot)G.PO.foot.push(o);
  return o;
}

function person(G,x,z,yaw,waiting){
  const p=makeFarePed(G.W,G.city,rng,x,z);
  Object.assign(p,{fare:!!waiting,state:waiting?'wait':'walk',edge:{from:0,to:0},t:0});
  p.pos.x=x;
  p.pos.z=z;
  p.parts.root.position.set(x,0,z);
  p.parts.root.rotation.set(0,yaw,0);
  p.parts.root.visible=true;
  G.peds.push(p);
}

function chase(G){
  pose(G);
  hollow(G);
  const c=G.m1Car;
  Object.assign(c,{x:26,z:88,heading:0});
  c.mesh.visible=true;
  seat(G,c);
  addStars(G.PO,3,G);
  cop(G,24,100,26,70);
  cop(G,-40,128,26,60);
  car(G,76.8,44,0,C.sedan);
  car(G,76.8,-4,0,C.taxi,true);
  car(G,83.2,66,PI,0xd7d0c2);
  for(let i=0;i<5;i++)person(G,8.4,52-i*6,PI,false);
  G.W.yaw=0.06;
  G.W.pitch=0.26;
  G.H.setBanner('Three stars on Meridian. Lose them.',4000);
}

function city(G){
  pose(G);
  hollow(G);
  stand(G,30,6,-PI/2);
  car(G,30,76.8,-PI/2,C.sedan);
  car(G,70,83.2,PI/2,C.taxi,true);
  const cab=G.cars.find((x)=>x.kind==='taxi');
  if(cab){
    cab.mesh.visible=true;
    cab.x=36;
    cab.z=-6;
    cab.heading=0.9;
    syncCarMesh(cab);
  }
  for(let i=0;i<4;i++)person(G,26+i*2.4,6+(i%2?2.7:-2.7),i%2?PI:0,i>2);
  G.m1Car.mesh.visible=true;
  if(!G.M.active){
    G.freezeMissions=false;
    startMission(G.M,G);
    G.freezeMissions=true;
  }
  G.M.stage=0;
  G.M.marker={x:G.m1Car.x,z:G.m1Car.z};
  G.M.target=G.M.marker;
  G.W.yaw=PI/2-0.3;
  G.W.pitch=0.2;
}

function mission(G){
  pose(G);
  hollow(G);
  const up=G.city.pickup;
  Object.assign(G.P,{rifle:true,weapon:'rifle',ammo:60});
  stand(G,up.x+3.5,up.z+1.5,PI*0.75);
  addStars(G.PO,2,G);
  const px=G.P.pos.x,pz=G.P.pos.z;
  const o=cop(G,px-7,pz-7,px,pz,true);
  G.PO.foot.push(copAt(px-5,pz-3.5,1.2,true));
  spawnMuzzle({x:o.x,y:1.3,z:o.z});
  spawnTracer({x:o.x,y:1.35,z:o.z},{x:px,y:1.15,z:pz});
  for(let i=0;i<3;i++)person(G,up.x-6+i*4,up.z+7,i*0.5,false);
  G.W.yaw=-PI*0.3;
  G.W.pitch=0.3;
  G.H.setBanner('Two stars in Verde Park. Rifle up.',4000);
}

function start(G){
  pose(G);
  hollow(G);
  stand(G,-30,-28,0.6);
  Object.assign(G.m1Car,{x:-22,z:-18,heading:0.7});
  G.m1Car.mesh.visible=true;
  syncCarMesh(G.m1Car);
  car(G,30,76.8,-PI/2,C.taxi,true);
  car(G,83.2,20,PI/2,C.sedan);
  for(let i=0;i<4;i++)person(G,-34+i*4,-8,PI,false);
  G.screen='title';
  showPanel(G.H,'title');
  G.orbit={x:-20,y:30,z:-10,yaw:-0.7,spin:0.1,dist:46};
}

const SCENES={chase,city,mission,start};

/** Pose one scene; the title flips after two real rendered frames. */
export function applyShot(name,G){
  try{
    if(!SCENES[name])throw new Error('unknown shot '+name);
    SCENES[name](G);
    G.shot=name;
    let done=0;
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      if(done++)return;
      window.__shotReady=true;
      document.title='SB-'+name+'-ok';
    }));
    return true;
  }catch(err){
    document.title=String((err&&err.stack)||err).slice(0,320);
    return false;
  }
}
