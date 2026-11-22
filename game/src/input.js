// Solara Bay — keyboard, mouse and pointer-lock input, read once per frame.

const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyF', 'KeyR', 'KeyT',
  'ShiftLeft', 'ShiftRight', 'Space', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);

export function createInput(canvas) {
  const keys = new Set();
  const pressed = new Set();
  const mouseState = { dx: 0, dy: 0, wheel: 0 };

  const I = {
    keys,
    locked: false,
    down: (code) => keys.has(code),
    wasPressed(code) {
      if (!pressed.has(code)) return false;
      pressed.delete(code);
      return true;
    },
    mouse: () => ({ dx: mouseState.dx, dy: mouseState.dy, wheel: mouseState.wheel }),
    lock() {
      if (!canvas || !canvas.requestPointerLock) return;
      if (document.pointerLockElement !== canvas) {
        const attempt = canvas.requestPointerLock();
        if (attempt && typeof attempt.catch === 'function') attempt.catch(() => {});
      }
    },
    endFrame() {
      mouseState.dx = 0;
      mouseState.dy = 0;
      mouseState.wheel = 0;
      pressed.clear();
    },
  };

  window.addEventListener('keydown', (e) => {
    if (e.repeat) {
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      return;
    }
    keys.add(e.code);
    pressed.add(e.code);
    if (GAME_KEYS.has(e.code)) e.preventDefault();
  });

  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
    if (GAME_KEYS.has(e.code)) e.preventDefault();
  });

  window.addEventListener('blur', () => {
    keys.clear();
    pressed.clear();
  });

  document.addEventListener('mousemove', (e) => {
    if (!I.locked) return;
    mouseState.dx = (mouseState.dx || 0) + (e.movementX || 0);
    mouseState.dy = (mouseState.dy || 0) + (e.movementY || 0);
  });

  window.addEventListener(
    'wheel',
    (e) => {
      mouseState.wheel += Math.sign(e.deltaY);
      if (I.locked) e.preventDefault();
    },
    { passive: false },
  );

  document.addEventListener('pointerlockchange', () => {
    I.locked = document.pointerLockElement === canvas;
  });

  document.addEventListener('mousedown', () => {
    if (I.locked) pressed.add('Mouse0');
  });

  window.addEventListener('contextmenu', (e) => {
    if (I.locked) e.preventDefault();
  });

  return I;
}
