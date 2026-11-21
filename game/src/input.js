// Solara Bay — keyboard, mouse and pointer-lock input. Pure DOM, no Three.js.

const WATCHED = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyF', 'KeyT', 'KeyR',
  'ShiftLeft', 'ShiftRight', 'Space', 'Escape',
]);

export function createInput(canvas) {
  const keys = new Set();
  const pressed = new Set();
  let dx = 0;
  let dy = 0;
  let wheel = 0;

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
      if (typeof canvas.requestPointerLock === 'function') {
        const result = canvas.requestPointerLock();
        if (result && typeof result.catch === 'function') result.catch(() => {});
      }
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

  function onKeyDown(ev) {
    if (WATCHED.has(ev.code)) ev.preventDefault();
    if (ev.repeat) return;
    keys.add(ev.code);
    pressed.add(ev.code);
  }

  function onKeyUp(ev) {
    if (WATCHED.has(ev.code)) ev.preventDefault();
    keys.delete(ev.code);
  }

  function onMouseMove(ev) {
    if (!I.locked) return;
    dx += ev.movementX || 0;
    dy += ev.movementY || 0;
  }

  function onWheel(ev) {
    if (!I.locked) return;
    ev.preventDefault();
    wheel += Math.sign(ev.deltaY);
  }

  function onLockChange() {
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
  window.addEventListener('blur', onBlur);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('wheel', onWheel, { passive: false });
  document.addEventListener('pointerlockchange', onLockChange);

  return I;
}
