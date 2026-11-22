// Keyboard, mouse and pointer lock, collected once per frame and consumed by
// the simulation. Held keys live in `keys`; `wasPressed` reports a key once.

export function createInput(canvas) {
  const keys = new Set();
  const pressed = new Set();
  let dx = 0;
  let dy = 0;
  let wheel = 0;
  let locked = false;
  let wheelTotal = 0;
  let onUnlock = null;

  const GAME_KEYS = new Set([
    'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyF', 'KeyR', 'KeyT', 'KeyQ',
    'ShiftLeft', 'ShiftRight', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  ]);

  const onKeyDown = (event) => {
    if (event.code === 'Escape') return; // the browser uses it to leave pointer lock; main reads it
    if (GAME_KEYS.has(event.code) || event.code === 'Tab') event.preventDefault();
    if (event.repeat) return;
    if (!keys.has(event.code)) pressed.add(event.code);
    keys.add(event.code);
  };

  const onKeyUp = (event) => {
    keys.delete(event.code);
  };

  const onMouseMove = (event) => {
    if (!locked) return;
    dx += event.movementX || 0;
    dy += event.movementY || 0;
  };

  const onWheel = (event) => {
    wheel += Math.sign(event.deltaY);
    wheelTotal += event.deltaY;
  };

  const onLockChange = () => {
    locked = document.pointerLockElement === canvas;
    if (!locked) {
      keys.clear();
      if (onUnlock !== null) onUnlock();
    }
  };

  const onBlur = () => keys.clear();

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('wheel', onWheel, { passive: true });
  window.addEventListener('blur', onBlur);
  document.addEventListener('pointerlockchange', onLockChange);

  return {
    keys,
    get locked() {
      return locked;
    },
    get wheelTotal() {
      return wheelTotal;
    },
    down: (code) => keys.has(code),
    wasPressed(code) {
      if (!pressed.has(code)) return false;
      pressed.delete(code);
      return true;
    },
    /** Mouse deltas accumulated since the last endFrame, plus wheel notches. */
    mouse() {
      return { dx, dy, wheel };
    },
    lock() {
      if (locked || document.pointerLockElement === canvas) return;
      const maybe = canvas.requestPointerLock?.();
      if (maybe && typeof maybe.catch === 'function') maybe.catch(() => {});
    },
    unlock() {
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    },
    onUnlock(fn) {
      onUnlock = fn;
    },
    endFrame() {
      pressed.clear();
      dx = 0;
      dy = 0;
      wheel = 0;
    },
  };
}
