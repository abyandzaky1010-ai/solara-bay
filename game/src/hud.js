// HUD: minimap, wanted stars, money, start screen
import * as THREE from 'three';
import { PALETTE } from './palette.js';

let scene, canvas, ctx, car;
let wantedStars = 0;
let money = 200;

export function initHUD(sceneArg, canvasArg, carArg) {
  scene = sceneArg;
  canvas = canvasArg;
  ctx = canvas.getContext('2d');
  car = carArg;
  
  const savedMoney = localStorage.getItem('gta6_money');
  if (savedMoney) money = parseInt(savedMoney, 10);
  
  canvas.width = 300;
  canvas.height = 300;
  createStartScreen();
}

function createStartScreen() {
  const startDiv = document.createElement('div');
  startDiv.id = 'startScreen';
  startDiv.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.7); display: flex; flex-direction: column; justify-content: center; align-items: center; color: white; font-family: Arial, sans-serif; z-index: 100;';
  startDiv.innerHTML = '<h1 style="font-size: 48px; margin-bottom: 20px;">CLICK TO PLAY</h1><p style="font-size: 18px; margin-bottom: 10px;">WASD to move, Mouse to look</p><p style="font-size: 18px; margin-bottom: 10px;">E to enter/exit car</p><p style="font-size: 18px; margin-bottom: 30px;">Click to start</p>';
  document.body.appendChild(startDiv);
  
  startDiv.addEventListener('click', () => {
    startDiv.remove();
  });
}

export function updateHUD() {
  if (!canvas || !ctx) return;
  ctx.fillStyle = PALETTE.sky;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const roadWidth = canvas.width * 0.06;
  const roadSpacing = canvas.width * 0.1;
  ctx.fillStyle = '#4a4f57';
  for (let i = 0; i <= 2; i++) {
    const x = i * roadSpacing + roadSpacing / 2;
    ctx.fillRect(x - roadWidth / 2, 0, roadWidth, canvas.height);
  }
  for (let i = 0; i <= 2; i++) {
    const y = i * roadSpacing + roadSpacing / 2;
    ctx.fillRect(0, y - roadWidth / 2, canvas.width, roadWidth);
  }
  const waterY = canvas.height * 0.75;
  ctx.fillStyle = '#3f86c4';
  ctx.fillRect(0, waterY, canvas.width, canvas.height - waterY);
  const parkX = canvas.width * 0.6;
  const parkY = canvas.height * 0.35;
  ctx.fillStyle = '#6f9e4f';
  ctx.fillRect(parkX, parkY, roadSpacing * 1.5, roadSpacing * 1.5);
  ctx.fillStyle = '#cfd6d8';
  const buildings = [{ x: 0.2, y: 0.2, w: 0.15, h: 0.25 }, { x: 0.7, y: 0.2, w: 0.12, h: 0.2 }, { x: 0.2, y: 0.6, w: 0.1, h: 0.15 }, { x: 0.75, y: 0.6, w: 0.18, h: 0.3 }, { x: 0.55, y: 0.85, w: 0.12, h: 0.1 }];
  buildings.forEach(b => {
    ctx.fillRect(b.x * canvas.width, b.y * canvas.height, b.w * canvas.width, b.h * canvas.height);
  });
  const playerPos = car?.position || { x: 0, z: 0 };
  const px = (playerPos.x / 200 + 1) * canvas.width / 2;
  const py = (playerPos.z / 200 + 1) * canvas.height / 2;
  ctx.fillStyle = '#3a4a5f';
  ctx.beginPath();
  ctx.arc(px, py, 6, 0, Math.PI * 2);
  ctx.fill();
  if (car) {
    const carX = (car.position.x / 200 + 1) * canvas.width / 2;
    const carY = (car.position.z / 200 + 1) * canvas.height / 2;
    ctx.fillStyle = '#d84f3f';
    ctx.fillRect(carX - 4, carY - 4, 8, 8);
  }
  drawWantedStars();
  drawMoney();
}

function drawWantedStars() {
  let starX = canvas.width - 60;
  let starY = 30;
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i < wantedStars ? '#ffd700' : '#444';
    drawStar(starX, starY, 10);
    starX -= 25;
  }
}

function drawStar(cx, cy, size) {
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const angle = (i * 4 * Math.PI / 5) - Math.PI / 2;
    const x = cx + Math.cos(angle) * size;
    const y = cy + Math.sin(angle) * size;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function drawMoney() {
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px Arial';
  ctx.textAlign = 'left';
  ctx.fillText(`$${money}`, 20, 35);
}

export function addWantedStars(count) {
  wantedStars = Math.min(5, wantedStars + count);
}

export function removeWantedStars(count) {
  wantedStars = Math.max(0, wantedStars - count);
}

export function addMoney(amount) {
  money += amount;
  localStorage.setItem('gta6_money', money.toString());
}

export function getMoney() {
  return money;
}
