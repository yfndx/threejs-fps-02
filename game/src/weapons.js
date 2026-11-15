// EMBERLINE — weapons: the player's arsenal, its state machine and its viewmodel.
// Fire, reload, switch and buy all live here. Spread and recoil are the gunplay:
// stopping to aim pays, firing on the move punishes.

import * as THREE from 'three';
import { ECONOMY, GRENADES, WEAPONS } from './config.js';
import { shootRay, throwGrenade } from './combat.js';
import { pushEvent } from './state.js';

export function currentWeapon(G) {
  const id = G.player.current;
  return { def: WEAPONS[id], ammo: G.player.weapons[id] };
}

export function ownedWeapons(G) {
  return Object.keys(G.player.weapons);
}

export function buyWeapon(G, id) {
  const def = WEAPONS[id];
  if (!def || G.player.weapons[id]) return false;
  if (G.money < def.price) return false;
  G.money -= def.price;
  G.player.weapons[id] = { mag: def.mag, reserve: def.reserve };
  G.player.current = id;
  G.player.reloadT = 0;
  pushEvent(G, 'buy', { what: def.name });
  return true;
}

export function buyArmor(G) {
  if (G.player.armor >= ECONOMY.armorValue || G.money < ECONOMY.armorPrice) return false;
  G.money -= ECONOMY.armorPrice;
  G.player.armor = ECONOMY.armorValue;
  pushEvent(G, 'buy', { what: 'KEVLAR VEST' });
  return true;
}

export function buyGrenade(G, kind) {
  const g = GRENADES[kind];
  if (!g || G.money < g.price) return false;
  G.money -= g.price;
  G.player.grenades[kind] += 1;
  pushEvent(G, 'buy', { what: g.name });
  return true;
}

export function switchWeapon(G, id) {
  if (!G.player.weapons[id] || G.player.current === id) return;
  G.player.current = id;
  G.player.reloadT = 0;
  G.player.fireT = 0.25; // draw time
  pushEvent(G, 'switch', { what: id });
}

// One trigger pull (or auto-fire tick). Returns true if a shot left the barrel.
export function tryFire(G, ctx) {
  const p = G.player;
  if (!p.alive || p.reloadT > 0 || p.fireT > 0 || p.throwing) return false;
  const { def, ammo } = currentWeapon(G);
  if (ammo.mag <= 0) {
    p.fireT = 0.25;
    pushEvent(G, 'dryfire', {});
    if (ctx.audio) ctx.audio.dryFire();
    return false;
  }
  ammo.mag -= 1;
  p.fireT = 1 / def.rate;
  // Spread: base + movement + bloom, all in radians. Crouching steadies the aim.
  const moving = Math.hypot(p.vel.x, p.vel.z);
  const moveFactor = Math.min(1, moving / 4.6);
  let spread = def.spread + def.moveSpread * moveFactor + p.spread * 0.6;
  if (p.crouch) spread *= 0.7;
  p.spread = Math.min(0.09, p.spread + def.recoil * 0.55);
  p.recoil = Math.min(0.09, p.recoil + def.recoil);

  const origin = new THREE.Vector3(p.pos.x, p.pos.y + (p.crouch ? 1.05 : 1.62), p.pos.z);
  const baseDir = new THREE.Vector3(0, 0, -1)
    .applyEuler(new THREE.Euler(p.pitch + p.recoil * 0.4, p.yaw, 0, 'YXZ'));
  let firstHit = null;
  for (let i = 0; i < def.pellets; i++) {
    const dir = baseDir.clone();
    dir.x += (G.rng() * 2 - 1) * spread;
    dir.y += (G.rng() * 2 - 1) * spread;
    dir.z += (G.rng() * 2 - 1) * spread * 0.4;
    dir.normalize();
    const hit = shootRay(G, ctx, origin, dir, def, 'player');
    if (i === 0) firstHit = hit;
    if (ctx.fx) ctx.fx.tracer(origin, dir, hit && hit.hit ? hit.dist : def.range);
  }
  if (ctx.fx) ctx.fx.muzzle(origin, baseDir);
  if (ctx.audio) ctx.audio.shot(def.sound, p.pos);
  pushEvent(G, 'shot', { weapon: def.id, pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z } });
  if (ammo.mag === 0) startReload(G);
  return true;
}

export function startReload(G) {
  const p = G.player;
  const { def, ammo } = currentWeapon(G);
  if (p.reloadT > 0 || ammo.mag >= def.mag || ammo.reserve <= 0) return false;
  p.reloadT = def.shellReload ? def.reload : def.reload; // shell reload ticks per shell below
  p.reloadShell = def.shellReload;
  return true;
}

// Reload progresses in the fixed step. Shotguns load one shell per tick.
export function stepReload(G, dt) {
  const p = G.player;
  if (p.reloadT <= 0) return;
  const { def, ammo } = currentWeapon(G);
  p.reloadT -= dt;
  if (p.reloadT > 0) return;
  if (def.shellReload) {
    if (ammo.mag < def.mag && ammo.reserve > 0) {
      ammo.mag += 1;
      ammo.reserve -= 1;
      p.reloadT = def.reload; // next shell
      pushEvent(G, 'reloadShell', {});
    } else {
      p.reloadT = 0;
    }
  } else {
    const need = def.mag - ammo.mag;
    const take = Math.min(need, ammo.reserve);
    ammo.mag += take;
    ammo.reserve -= take;
    p.reloadT = 0;
  }
}

export function cancelReload(G) {
  G.player.reloadT = 0;
}

// --- Viewmodel: the gun the player sees, built from boxes. ---
export function buildViewmodel(camera) {
  const group = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.45, metalness: 0.6 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xf0a830, roughness: 0.4, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.55), dark);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.3, 8), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.38);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.09), dark);
  grip.position.set(0, -0.12, 0.18);
  grip.rotation.x = 0.35;
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.02), accent);
  sight.position.set(0, 0.09, -0.1);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.14, 0.1), dark);
  mag.position.set(0, -0.1, -0.05);
  group.add(body, barrel, grip, sight, mag);
  group.position.set(0.28, -0.26, -0.5);
  camera.add(group);
  return group;
}

// Sway, bob and recoil kick for the viewmodel; called every rendered frame.
export function updateViewmodel(G, vm, dt, time) {
  const p = G.player;
  const moving = Math.hypot(p.vel.x, p.vel.z);
  const bob = Math.min(1, moving / 4.6) * (p.crouch ? 0.4 : 1);
  const t = time * 9;
  vm.position.x = 0.28 + Math.sin(t) * 0.006 * bob;
  vm.position.y = -0.26 + Math.abs(Math.cos(t)) * 0.008 * bob - (p.reloadT > 0 ? 0.09 : 0);
  vm.position.z = -0.5 + p.recoil * 1.6;
  vm.rotation.x = p.recoil * 1.2 + (p.reloadT > 0 ? 0.5 : 0);
}

// Throw the selected grenade (G = frag, F = smoke from input).
export function tryThrow(G, kind) {
  if (!G.player.alive || G.player.reloadT > 0) return false;
  if (throwGrenade(G, kind)) {
    G.player.throwing = kind;
    G.player.fireT = 0.6;
    pushEvent(G, 'throw', { kind });
    return true;
  }
  return false;
}
