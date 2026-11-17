// Input handling: keyboard and mouse for player movement and camera control
export const keys = {};
export const mouse = { x: 0, y: 0, locked: false };

export function initInput() {
  window.addEventListener('keydown', (e) => { keys[e.code] = true; });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  window.addEventListener('mousemove', (e) => {
    if (mouse.locked) {
      mouse.x += e.movementX;
      mouse.y += e.movementY;
    }
  });
}

export function requestPointerLock() {
  const canvas = document.querySelector('canvas');
  if (canvas) canvas.requestPointerLock();
}

export function releasePointerLock() {
  document.exitPointerLock();
}

export function updateMouseLocked() {
  const canvas = document.querySelector('canvas');
  mouse.locked = !!canvas && document.pointerLockElement === canvas;
}
