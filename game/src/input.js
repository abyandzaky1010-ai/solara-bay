export const keys = {
  forward: false,
  backward: false,
  left: false,
  right: false,
};

export function updateKeys(event) {
  if (event.type === 'keydown' || event.type === 'keyup') {
    const pressed = event.type === 'keydown';
    switch (event.key) {
      case 'w': case 'ArrowUp': keys.forward = pressed; break;
      case 's': case 'ArrowDown': keys.backward = pressed; break;
      case 'a': case 'ArrowLeft': keys.left = pressed; break;
      case 'd': case 'ArrowRight': keys.right = pressed; break;
    }
  }
}

export const mouse = { x: 0 };

export function updateMouseLocked() {
  mouse.x += 0.005;
}

export function initInput() {
  document.addEventListener('keydown', updateKeys);
  document.addEventListener('keyup', updateKeys);
}
