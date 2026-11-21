// Keyboard, mouse and pointer lock. Nothing here knows about the 3D world.

const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyF', 'KeyT', 'KeyR',
  'ShiftLeft', 'ShiftRight', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);

export function createInput(canvas) {
  const keys = new Set();
  const pressed = new Set();
  let dx = 0;
  let dy = 0;
  let wheel = 0;
  let locked = false;

  const onKeyDown = (ev) => {
    if (ev.repeat) return;
    keys.add(ev.code);
    pressed.add(ev.code);
    if (GAME_KEYS.has(ev.code)) ev.preventDefault();
  };

  const onKeyUp = (ev) => {
    keys.delete(ev.code);
    if (GAME_KEYS.has(ev.code)) ev.preventDefault();
  };

  const onMouseMove = (ev) => {
    if (!locked) return;
    dx += ev.movementX || 0;
    dy += ev.movementY || 0;
  };

  const onWheel = (ev) => {
    wheel += ev.deltaY;
  };

  const onLockChange = () => {
    locked = document.pointerLockElement === canvas;
    if (!locked) {
      keys.clear();
      dx = 0;
      dy = 0;
    }
  };

  const onBlur = () => {
    keys.clear();
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('wheel', onWheel, { passive: true });
  document.addEventListener('pointerlockchange', onLockChange);
  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

  const I = {
    keys,

    down: (code) => keys.has(code),

    /** True once per physical press; reading it consumes the press. */
    wasPressed(code) {
      if (!pressed.has(code)) return false;
      pressed.delete(code);
      return true;
    },

    mouse: () => ({ dx, dy, wheel }),

    lock() {
      if (!locked && canvas.requestPointerLock) canvas.requestPointerLock();
    },

    unlock() {
      if (document.exitPointerLock) document.exitPointerLock();
    },

    get locked() {
      return locked;
    },

    /** Drop per-frame deltas and any presses nobody consumed. */
    endFrame() {
      dx = 0;
      dy = 0;
      wheel = 0;
      pressed.clear();
    },

    /** Movement axes already normalised for diagonal walking. */
    axis() {
      let x = 0;
      let y = 0;
      if (I.down('KeyW') || I.down('ArrowUp')) y += 1;
      if (I.down('KeyS') || I.down('ArrowDown')) y -= 1;
      if (I.down('KeyD') || I.down('ArrowRight')) x += 1;
      if (I.down('KeyA') || I.down('ArrowLeft')) x -= 1;
      const len = Math.hypot(x, y);
      if (len > 1) { x /= len; y /= len; }
      return { x, y };
    },

    sprinting: () => keys.has('ShiftLeft') || keys.has('ShiftRight'),
  };

  return I;
}
