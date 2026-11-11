// Input for the Nexthlon 3D engine: pointer/gyroscope parallax, drag-to-rotate with inertia,
// scroll progress for scroll-linked scenes, and what the device can handle.
import { clamp, damp } from "./math.js";

export const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export const finePointer = () => window.matchMedia("(hover: hover) and (pointer: fine)").matches;

// A rough guess at a low-power device: few cores, little memory, or a small touch screen.
// True when the visitor asked to save data (Data Saver / "reduce data") or is on a very slow
// connection. The 3D scenes are then skipped and their still versions shown instead.
export function wantsLessData() {
  const connection = navigator.connection || {};
  if (connection.saveData) return true;
  if (["slow-2g", "2g"].includes(connection.effectiveType)) return true;
  return Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-data: reduce)").matches);
}

export function deviceTier() {
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 4;
  const small = Math.min(window.innerWidth, window.innerHeight) < 600;
  if (cores <= 2 || memory <= 2) return "low";
  if (small || cores <= 4 || memory <= 4) return "medium";
  return "high";
}

// Pointer position from -1 to 1 on both axes, eased. On phones, the gyroscope tilts it instead
// (where the browser allows it without asking).
export function createParallax({ ease = 4 } = {}) {
  const state = { x: 0, y: 0, targetX: 0, targetY: 0 };
  const onPointer = event => {
    state.targetX = (event.clientX / window.innerWidth) * 2 - 1;
    state.targetY = (event.clientY / window.innerHeight) * 2 - 1;
  };
  const onTilt = event => {
    if (event.gamma === null || event.beta === null) return;
    state.targetX = clamp(event.gamma / 30, -1, 1);
    state.targetY = clamp((event.beta - 45) / 30, -1, 1);
  };
  window.addEventListener("pointermove", onPointer, { passive: true });
  if (!finePointer() && "DeviceOrientationEvent" in window && typeof DeviceOrientationEvent.requestPermission !== "function") {
    window.addEventListener("deviceorientation", onTilt, { passive: true });
  }
  return {
    state,
    update(dt) {
      state.x = damp(state.x, state.targetX, ease, dt);
      state.y = damp(state.y, state.targetY, ease, dt);
      return state;
    },
    dispose() {
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("deviceorientation", onTilt);
    }
  };
}

// Drag (mouse or touch) to rotate, with inertia after letting go. Arrow keys work too when the
// element has focus. A small move still counts as a click, so links inside keep working.
export function createDragRotate(element, { speed = 0.006, friction = 3.2, keyStep = 0.35, onChange = null } = {}) {
  const state = { angle: 0, velocity: 0, dragging: false, moved: 0 };
  let lastX = 0;
  let lastT = 0;
  const down = event => {
    if (event.button !== undefined && event.button !== 0) return;
    state.dragging = true;
    state.moved = 0;
    lastX = event.clientX;
    lastT = performance.now();
    state.velocity = 0;
  };
  const move = event => {
    if (!state.dragging) return;
    const dx = event.clientX - lastX;
    const now = performance.now();
    state.moved += Math.abs(dx);
    if (state.moved > 6 && !element.hasPointerCapture(event.pointerId)) element.setPointerCapture(event.pointerId);
    state.angle += dx * speed;
    state.velocity = (dx * speed) / Math.max(0.008, (now - lastT) / 1000);
    lastX = event.clientX;
    lastT = now;
    if (onChange) onChange(state);
  };
  const up = () => { state.dragging = false; };
  // A real drag must not also follow a link.
  const click = event => {
    if (state.moved > 6) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const key = event => {
    if (event.key === "ArrowLeft") state.velocity = -keyStep * 6;
    else if (event.key === "ArrowRight") state.velocity = keyStep * 6;
    else return;
    event.preventDefault();
  };
  element.addEventListener("pointerdown", down);
  element.addEventListener("pointermove", move);
  element.addEventListener("pointerup", up);
  element.addEventListener("pointercancel", up);
  element.addEventListener("click", click, true);
  element.addEventListener("keydown", key);
  return {
    state,
    update(dt) {
      if (!state.dragging) {
        state.angle += state.velocity * dt;
        state.velocity = damp(state.velocity, 0, friction, dt);
      }
      return state;
    }
  };
}

// How far the visitor has scrolled through an element, from 0 to 1.
// For a tall "pinned" section, 0 is its top at the top of the screen and 1 is its bottom at the bottom.
export function scrollProgress(element) {
  const box = element.getBoundingClientRect();
  const travel = box.height - window.innerHeight;
  if (travel <= 0) return clamp(1 - box.bottom / (window.innerHeight + box.height), 0, 1);
  return clamp(-box.top / travel, 0, 1);
}
