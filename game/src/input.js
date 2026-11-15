// EMBERLINE — input: keyboard state, mouse look via pointer lock, and the
// action edges (pressed-this-frame) the fixed step consumes.

export function createInput(canvas) {
  const keys = new Set();
  const pressed = new Set(); // edges, cleared by endFrame()
  let lookDX = 0, lookDY = 0;
  let mouseDown = false;
  let locked = false;

  const onKeyDown = (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    pressed.add(e.code);
  };
  const onKeyUp = (e) => keys.delete(e.code);
  const onMouseMove = (e) => {
    if (!locked) return;
    lookDX += e.movementX;
    lookDY += e.movementY;
  };
  const onMouseDown = (e) => { if (e.button === 0) mouseDown = true; };
  const onMouseUp = (e) => { if (e.button === 0) mouseDown = false; };
  const onLockChange = () => { locked = document.pointerLockElement === canvas; };
  const onBlur = () => { keys.clear(); mouseDown = false; };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  document.addEventListener('pointerlockchange', onLockChange);
  window.addEventListener('blur', onBlur);

  return {
    get locked() { return locked; },
    get mouseDown() { return mouseDown; },
    lock() {
      // requestPointerLock returns a promise in Chrome; a synthetic click
      // (or a second quick click) can reject it — never let that surface
      // as an uncaught error. A real user gesture resolves it.
      const r = canvas.requestPointerLock();
      if (r && r.catch) r.catch(() => {});
    },
    unlock() { if (document.pointerLockElement) document.exitPointerLock(); },
    // Movement state read by the simulation.
    read() {
      return {
        forward: keys.has('KeyW') || keys.has('ArrowUp'),
        back: keys.has('KeyS') || keys.has('ArrowDown'),
        left: keys.has('KeyA') || keys.has('ArrowLeft'),
        right: keys.has('KeyD') || keys.has('ArrowRight'),
        sprint: keys.has('ShiftLeft') || keys.has('ShiftRight'),
        crouch: keys.has('ControlLeft') || keys.has('KeyC'),
        jump: pressed.has('Space'),
      };
    },
    // One-frame edges.
    wasPressed(code) { return pressed.has(code); },
    // Held keys (for actions like holding E to plant).
    isDown(code) { return keys.has(code); },
    // Accumulated mouse movement since the last consume.
    consumeLook() {
      const d = { dx: lookDX, dy: lookDY };
      lookDX = 0; lookDY = 0;
      return d;
    },
    endFrame() { pressed.clear(); },
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('pointerlockchange', onLockChange);
      window.removeEventListener('blur', onBlur);
    },
  };
}
