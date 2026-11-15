// EMBERLINE — the player: acceleration movement, crouch, jump, collision.
// Movement is axis-separated: integrate X, resolve, integrate Z, resolve, so
// sliding along walls feels right. All in the fixed 60 Hz step.

import { MAP, PLAYER } from './config.js';
import { collideCircle } from './world.js';

export function resetPlayer(G) {
  const p = G.player;
  p.pos.x = MAP.playerSpawn.x;
  p.pos.y = 0;
  p.pos.z = MAP.playerSpawn.z;
  p.vel.x = 0; p.vel.y = 0; p.vel.z = 0;
  p.yaw = MAP.playerSpawn.yaw;
  p.pitch = 0;
  p.onGround = true;
  p.crouch = false;
  p.sprint = false;
  p.health = PLAYER.health;
  p.armor = 0;
  p.alive = true;
  p.spread = 0;
  p.recoil = 0;
  p.reloadT = 0;
  p.fireT = 0;
  p.triggerHeld = false;
  p.planting = false;
  p.throwing = null;
}

export function stepPlayer(G, input, dt, colliders) {
  const p = G.player;
  if (!p.alive) return;

  // Crouch is a toggle on Ctrl/C; sprint needs forward motion and no crouch.
  p.crouch = input.crouch;
  const speed = p.crouch ? PLAYER.crouchSpeed
    : (input.sprint && input.forward && !input.back) ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
  p.sprint = speed === PLAYER.sprintSpeed;

  // Wish direction in world space from the camera yaw.
  const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
  let wx = 0, wz = 0;
  if (input.forward) { wx -= sin; wz -= cos; }
  if (input.back) { wx += sin; wz += cos; }
  if (input.left) { wx -= cos; wz += sin; }
  if (input.right) { wx += cos; wz -= sin; }
  const wl = Math.hypot(wx, wz);
  if (wl > 0) { wx /= wl; wz /= wl; }

  // Accelerate toward the wish velocity; friction when no input.
  const ax = wx * speed - p.vel.x;
  const az = wz * speed - p.vel.z;
  const accel = wl > 0 ? PLAYER.accel : PLAYER.friction * 2.2;
  const step = Math.min(1, accel * dt);
  p.vel.x += ax * step;
  p.vel.z += az * step;

  if (input.jump && p.onGround) {
    p.vel.y = PLAYER.jumpSpeed;
    p.onGround = false;
  }
  p.vel.y -= PLAYER.gravity * dt;

  // Integrate and collide, one axis at a time.
  const r = PLAYER.radius;
  const feet = { x: p.pos.x + p.vel.x * dt, z: p.pos.z };
  collideCircle(colliders, feet, r, PLAYER.height);
  p.pos.x = feet.x;
  const feet2 = { x: p.pos.x, z: p.pos.z + p.vel.z * dt };
  collideCircle(colliders, feet2, r, PLAYER.height);
  p.pos.z = feet2.z;

  p.pos.y += p.vel.y * dt;
  if (p.pos.y <= 0) { p.pos.y = 0; p.vel.y = 0; p.onGround = true; }

  // Spread bloom: moving, sprinting and firing open it; still + crouch closes it.
  const moving = Math.hypot(p.vel.x, p.vel.z) > 0.6;
  const target = (moving ? 0.012 : 0.002) + (p.sprint ? 0.010 : 0) + (p.crouch ? -0.0015 : 0);
  p.spread += (Math.max(0, target) - p.spread) * Math.min(1, 6 * dt);
  // Recoil settles back toward zero.
  p.recoil = Math.max(0, p.recoil - 0.05 * dt);
  p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch));
}

// Damage the player; armor absorbs half until it is gone. Returns true if killed.
export function damagePlayer(G, amount) {
  const p = G.player;
  if (!p.alive) return false;
  let rest = amount;
  if (p.armor > 0) {
    const absorbed = Math.min(p.armor, rest * 0.5);
    p.armor -= absorbed;
    rest -= absorbed;
  }
  p.health -= rest;
  if (p.health <= 0) {
    p.health = 0;
    p.alive = false;
    return true;
  }
  return false;
}

export function eyeHeight(G) {
  return G.player.pos.y + (G.player.crouch ? PLAYER.crouchEye : PLAYER.eye);
}
