// Input plumbing. Holds keyboard state with once-pressed edges, accumulates
// mouse motion while pointer lock is held, and resets per-frame deltas at the
// end of each frame. Nothing here knows about Three.js.

const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyF', 'KeyT', 'KeyR',
  'ShiftLeft', 'ShiftRight', 'Space', 'Escape', 'ArrowUp', 'ArrowDown',
  'ArrowLeft', 'ArrowRight',
]);

export function createInput(canvas) {
  const keys = new Set();
  const pressed = new Set();
  const mouseState = { dx: 0, dy: 0, wheel: 0 };

  const I = {
    keys,
    locked: false,
    down(code) {
      return keys.has(code);
    },
    wasPressed(code) {
      if (!pressed.has(code)) return false;
      pressed.delete(code);
      return true;
    },
    mouse() {
      return mouseState;
    },
    lock() {
      if (canvas && canvas.requestPointerLock) {
        try {
          canvas.requestPointerLock();
        } catch {
          /* pointer lock can be refused right after exit; harmless */
        }
      }
    },
    endFrame() {
      mouseState.dx = 0;
      mouseState.dy = 0;
      mouseState.wheel = 0;
      pressed.clear();
    },
    silence(code) {
      pressed.delete(code);
    },
  };

  window.addEventListener('keydown', (e) => {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    if (!keys.has(e.code)) pressed.add(e.code);
    keys.add(e.code);
  });

  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
  });

  window.addEventListener('blur', () => {
    keys.clear();
  });

  window.addEventListener('mousemove', (e) => {
    if (!I.locked) return;
    mouseState.dx += e.movementX || 0;
    mouseState.dy += e.movementY || 0;
  });

  window.addEventListener(
    'wheel',
    (e) => {
      if (!I.locked) return;
      e.preventDefault();
      mouseState.wheel += Math.sign(e.deltaY);
    },
    { passive: false },
  );

  document.addEventListener('pointerlockchange', () => {
    I.locked = document.pointerLockElement === canvas;
  });

  window.addEventListener('mousedown', (e) => {
    if (!I.locked) return;
    if (e.button === 0) pressed.add('Fire');
    if (e.button === 2) pressed.add('Aim');
  });

  window.addEventListener('contextmenu', (e) => {
    if (I.locked) e.preventDefault();
  });

  return I;
}
