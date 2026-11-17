export const keys = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  KeyW: false,
  KeyS: false,
  KeyA: false,
  KeyD: false,
  ShiftLeft: false,
  ShiftRight: false,
  KeyE: false,
};

export function updateKeys(event) {
  if (event.type === 'keydown' || event.type === 'keyup') {
    const pressed = event.type === 'keydown';
    switch (event.code) {
      case 'KeyW': case 'ArrowUp': keys.forward = pressed; keys[event.code] = pressed; break;
      case 'KeyS': case 'ArrowDown': keys.backward = pressed; keys[event.code] = pressed; break;
      case 'KeyA': case 'ArrowLeft': keys.left = pressed; keys[event.code] = pressed; break;
      case 'KeyD': case 'ArrowRight': keys.right = pressed; keys[event.code] = pressed; break;
      case 'ShiftLeft': case 'ShiftRight': keys[event.code] = pressed; break;
      case 'KeyE': keys[event.code] = pressed; break;
    }
  }
}

export function requestPointerLock() {
  document.body.requestPointerLock();
}

export function releasePointerLock() {
  document.exitPointerLock();
}

export const mouse = { x: 0 };

export function updateMouseLocked() {
  if (!document.pointerLockElement) return;
}

export function initInput() {
  document.addEventListener('keydown', updateKeys);
  document.addEventListener('keyup', updateKeys);
  document.addEventListener('mousemove', (event) => {
    if (document.pointerLockElement) mouse.x += event.movementX;
  });
}
