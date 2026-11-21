// Solara Bay — keyboard, mouse and pointer-lock plumbing. No three.js here;
// this module only knows about DOM events and produces per-frame deltas.

const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'KeyE', 'KeyF', 'KeyT', 'KeyR',
  'ShiftLeft', 'ShiftRight',
  'Space', 'Escape',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);

export function createInput(canvas) {
  const keys = new Set();
  const pressed = new Set();
  let dx = 0;
  let dy = 0;
  let wheel = 0;

  const input = {
    keys,
    locked: false,
    aimed: false,

    down(code) {
      return keys.has(code);
    },

    /** True once per physical press; consuming clears it. */
    wasPressed(code) {
      if (!pressed.has(code)) return false;
      pressed.delete(code);
      return true;
    },

    /** Accumulated this-frame mouse motion plus wheel steps. */
    mouse() {
      return { dx, dy, wheel };
    },

    /** End-of-frame reset of the per-frame accumulators. */
    endFrame() {
      dx = 0;
      dy = 0;
      wheel = 0;
    },

    lock() {
      if (typeof canvas.requestPointerLock !== 'function') return;
      try {
        const p = canvas.requestPointerLock();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch {
        /* pointer lock may be refused; keyboard still works */
      }
    },

    unlock() {
      if (document.pointerLockElement === canvas && document.exitPointerLock) {
        document.exitPointerLock();
      }
    },
  };

  window.addEventListener('keydown', (e) => {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    pressed.add(e.code);
  });

  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
  });

  window.addEventListener('blur', () => {
    keys.clear();
    pressed.clear();
  });

  canvas.addEventListener('mousedown', () => {
    if (!input.locked) input.lock();
    input.aimed = true;
  });

  window.addEventListener('mouseup', () => {
    input.aimed = false;
  });

  window.addEventListener('mousemove', (e) => {
    if (!input.locked) return;
    dx += e.movementX || 0;
    dy += e.movementY || 0;
  });

  window.addEventListener(
    'wheel',
    (e) => {
      wheel += Math.sign(e.deltaY);
      if (input.locked) e.preventDefault();
    },
    { passive: false },
  );

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === canvas;
    if (!input.locked) {
      keys.clear();
      pressed.clear();
    }
  });

  return input;
}
