// Keyboard, mouse and pointer-lock state for one frame at a time. Plain DOM, no Three.js.

const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'KeyE', 'KeyF', 'KeyR', 'KeyT', 'KeyQ',
  'ShiftLeft', 'ShiftRight',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'Tab',
]);

export function createInput(canvas) {
  const keys = new Set();
  const pressed = new Set();
  let dx = 0;
  let dy = 0;
  let wheel = 0;

  function onKeyDown(event) {
    if (GAME_KEYS.has(event.code)) event.preventDefault();
    if (event.repeat) return;
    keys.add(event.code);
    pressed.add(event.code);
  }

  function onKeyUp(event) {
    if (GAME_KEYS.has(event.code)) event.preventDefault();
    keys.delete(event.code);
  }

  function onMouseMove(event) {
    if (!I.locked) return;
    dx += event.movementX || 0;
    dy += event.movementY || 0;
  }

  function onWheel(event) {
    if (!I.locked) return;
    event.preventDefault();
    wheel += Math.sign(event.deltaY);
  }

  function onPointerLockChange() {
    I.locked = document.pointerLockElement === canvas;
    if (!I.locked) {
      keys.clear();
      pressed.clear();
    }
  }

  function onBlur() {
    keys.clear();
    pressed.clear();
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('blur', onBlur);
  document.addEventListener('pointerlockchange', onPointerLockChange);

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
      return { dx, dy, wheel };
    },

    lock() {
      if (I.locked) return;
      const request = canvas.requestPointerLock?.();
      if (request && typeof request.catch === 'function') request.catch(() => {});
    },

    unlock() {
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    },

    endFrame() {
      dx = 0;
      dy = 0;
      wheel = 0;
      pressed.clear();
    },
  };

  return I;
}
