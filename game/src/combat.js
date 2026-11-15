// EMBERLINE — combat: hitscan resolution, bot damage, explosions, line of sight.
// One shared Raycaster is reused for every shot and sight check; nothing here
// allocates in the hot path.

import * as THREE from 'three';
import { ECONOMY, GRENADES } from './config.js';
import { damagePlayer } from './player.js';
import { pushEvent, pushKillfeed } from './state.js';

const ray = new THREE.Raycaster();
const tmpV = new THREE.Vector3();

// Resolve one hitscan pellet. origin/dir are world space. Returns the hit or null.
export function shootRay(G, ctx, origin, dir, def, owner) {
  ray.set(origin, dir);
  ray.far = def.range;
  const wallHits = ray.intersectObjects(ctx.occluders, false);
  const wallDist = wallHits.length ? wallHits[0].distance : Infinity;
  const botHits = ray.intersectObjects(G.botHitMeshes, false);
  for (const h of botHits) {
    if (h.distance > wallDist) break; // a wall got there first
    const bot = h.object.userData.bot;
    if (!bot || bot.health <= 0) continue;
    const part = h.object.userData.part || 'body';
    const mult = part === 'head' ? def.headMult : 1;
    const falloff = Math.max(0.55, 1 - (h.distance / def.range) * 0.45);
    const dmg = def.damage * mult * falloff;
    damageBot(G, ctx, bot, dmg, part, owner);
    return { hit: true, point: h.point, bot, part, dist: h.distance, wall: false };
  }
  if (wallHits.length) {
    return { hit: true, point: wallHits[0].point, bot: null, part: null, dist: wallHits[0].distance, wall: true, normal: wallHits[0].face ? wallHits[0].face.normal : null };
  }
  return { hit: false, point: null, bot: null, part: null, dist: def.range, wall: false };
}

export function damageBot(G, ctx, bot, amount, part, owner) {
  if (bot.health <= 0) return;
  bot.health -= amount;
  bot.lastDamageAt = G.time;
  bot.lastDamageFrom = owner === 'player' ? 'player' : null;
  if (owner === 'player') {
    pushEvent(G, 'hit', { head: part === 'head' });
    if (ctx.audio) ctx.audio.hit(part === 'head');
  }
  if (bot.health <= 0) {
    bot.health = 0;
    bot.state = 'dead';
    bot.deathT = 0;
    if (owner === 'player') {
      G.kills += 1;
      G.money += ECONOMY.kill;
      pushKillfeed(G, `YOU ▸ ${bot.name}`);
      pushEvent(G, 'kill', { name: bot.name });
      if (ctx.audio) ctx.audio.kill();
    } else {
      pushKillfeed(G, `${bot.name} ▸ YOU`);
    }
    if (ctx.fx) ctx.fx.botDeath(bot);
  }
}

// A straight segment blocked by walls (raycast) or by an active smoke cloud.
export function losBlocked(G, ctx, from, to) {
  tmpV.copy(to).sub(from);
  const dist = tmpV.length();
  if (dist < 0.01) return false;
  tmpV.multiplyScalar(1 / dist);
  ray.set(from, tmpV);
  ray.far = dist;
  if (ray.intersectObjects(ctx.occluders, false).length) return true;
  // Smoke: segment vs sphere test, expanded a little so the cloud reads solid.
  for (const s of G.smokes) {
    if (segmentSphere(from, to, s.pos, s.radius * 0.9)) return true;
  }
  return false;
}

function segmentSphere(a, b, c, r) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const acx = c.x - a.x, acy = c.y - a.y, acz = c.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 0 ? (acx * abx + acy * aby + acz * abz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = a.x + abx * t - c.x, dy = a.y + aby * t - c.y, dz = a.z + abz * t - c.z;
  return dx * dx + dy * dy + dz * dz < r * r;
}

// Ray vs the player's capsule (vertical segment + radius). Returns the
// distance along the ray to the first hit, or null. The player has no mesh
// in the occluder lists, so bot fire needs this explicit test — without it a
// bot's bullet can never reach the player.
export function rayHitsPlayer(origin, dir, p, maxDist) {
  const px = p.pos.x, pz = p.pos.z;
  const y0 = p.pos.y + 0.15, y1 = p.pos.y + (p.crouch ? 1.15 : 1.6), r = 0.45;
  // Closest approach of the ray to the capsule axis (the vertical line x=px, z=pz).
  const ox = origin.x - px, oz = origin.z - pz;
  const denom = dir.x * dir.x + dir.z * dir.z;
  let t = 0;
  if (denom > 1e-9) {
    t = -(ox * dir.x + oz * dir.z) / denom;
    if (t < 0) t = 0;
  }
  const cx = origin.x + dir.x * t, cy = origin.y + dir.y * t, cz = origin.z + dir.z * t;
  const horiz = Math.hypot(cx - px, cz - pz);
  let dist;
  if (cy < y0) dist = Math.hypot(horiz, y0 - cy);
  else if (cy > y1) dist = Math.hypot(horiz, cy - y1);
  else dist = horiz;
  if (dist > r || t > maxDist) return null;
  return t;
}

// --- Grenades ---
export function throwGrenade(G, kind) {
  const p = G.player;
  if (G.player.grenades[kind] <= 0) return false;
  G.player.grenades[kind] -= 1;
  const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(p.pitch, p.yaw, 0, 'YXZ'));
  const pos = new THREE.Vector3(p.pos.x + dir.x * 0.6, p.pos.y + 1.45 + dir.y * 0.6, p.pos.z + dir.z * 0.6);
  G.projectiles.push({
    kind, pos, vel: dir.multiplyScalar(13).add(new THREE.Vector3(0, 3.2, 0)),
    fuse: kind === 'frag' ? GRENADES.frag.fuse : 0.9, bounces: 0,
  });
  return true;
}

export function stepProjectiles(G, ctx, dt) {
  for (let i = G.projectiles.length - 1; i >= 0; i--) {
    const pr = G.projectiles[i];
    pr.vel.y -= 12 * dt;
    pr.pos.addScaledVector(pr.vel, dt);
    if (pr.pos.y <= 0.12) {
      pr.pos.y = 0.12;
      if (Math.abs(pr.vel.y) > 2 && pr.bounces < 2) { pr.vel.y *= -0.45; pr.vel.x *= 0.7; pr.vel.z *= 0.7; pr.bounces++; }
      else { pr.vel.set(0, 0, 0); }
    }
    pr.fuse -= dt;
    if (pr.fuse <= 0) {
      if (pr.kind === 'frag') explodeFrag(G, ctx, pr.pos);
      else deploySmoke(G, ctx, pr.pos);
      G.projectiles.splice(i, 1);
    }
  }
}

function explodeFrag(G, ctx, pos) {
  if (ctx.fx) ctx.fx.explosion(pos);
  if (ctx.audio) ctx.audio.explosion(pos, G.player.pos);
  pushEvent(G, 'explosion', { pos: { x: pos.x, y: pos.y, z: pos.z } });
  const R = GRENADES.frag.radius;
  for (const bot of G.bots) {
    if (bot.health <= 0) continue;
    const d = Math.hypot(bot.pos.x - pos.x, bot.pos.z - pos.z);
    if (d < R) damageBot(G, ctx, bot, GRENADES.frag.damage * (1 - d / R * 0.7), 'body', 'player');
  }
  const pd = Math.hypot(G.player.pos.x - pos.x, G.player.pos.z - pos.z);
  if (pd < R && G.player.alive) {
    damagePlayer(G, GRENADES.frag.damage * 0.5 * (1 - pd / R * 0.7));
  }
}

function deploySmoke(G, ctx, pos) {
  G.smokes.push({ pos: { x: pos.x, y: 1.2, z: pos.z }, radius: 3.2, ttl: GRENADES.smoke.duration });
  if (ctx.fx) ctx.fx.smoke(pos);
}
