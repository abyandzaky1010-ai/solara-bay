// Keyboard + mouse state. W.keys holds held keys, W.pressed holds fresh presses (cleared each frame),
// mouse deltas accumulate while the pointer is locked; click is a one-frame edge for shooting.
import { W } from './world.js';

export function initInput(canvas) {
  window.addEventListener('keydown', (e) => {
    if (!W.keys[e.code]) W.pressed[e.code] = true;
    W.keys[e.code] = true;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => { W.keys[e.code] = false; });
  canvas.addEventListener('mousedown', (e) => { if (e.button === 0) W.clicked = true; });
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === canvas) {
      W.mouseDX += e.movementX;
      W.mouseDY += e.movementY;
    }
  });
  canvas.addEventListener('click', () => {
    if (W.mode === 'play' && document.pointerLockElement !== canvas) canvas.requestPointerLock();
  });
}

export function consumeMouse() {
  const dx = W.mouseDX, dy = W.mouseDY;
  W.mouseDX = 0; W.mouseDY = 0;
  return [dx, dy];
}
