// EMBERLINE — the ASH defenders: route, hold, engage, investigate, defuse.
// Bots follow waypoints to their assigned site, hold positions and scan, react
// to what they see (line of sight + field of view) and hear (gunshots), and
// converge on a planted charge to defuse it. All in the fixed 60 Hz step.

import * as THREE from 'three';
import { BOT, MAP, ROUND } from './config.js';
import { losBlocked, rayHitsPlayer, shootRay } from './combat.js';
import { collideCircle, HOLD_POINTS, WAYPOINTS } from './world.js';
import { damagePlayer } from './player.js';
import { pushEvent } from './state.js';

const BOT_DEF = { damage: BOT.damage, headMult: BOT.headMult, range: 60 };
const eyeV = new THREE.Vector3();
const toV = new THREE.Vector3();
const dirV = new THREE.Vector3();

export function spawnBots(G, scene) {
  // Clear any old bots from the scene.
  for (const b of G.bots) scene.remove(b.group);
  G.bots = [];
  G.botHitMeshes = [];
  const roundIdx = G.round - 1;
  const assignments = [
    { site: 'A', hold: HOLD_POINTS.A[roundIdx % 3] },
    { site: 'A', hold: HOLD_POINTS.A[(roundIdx + 1) % 3] },
    { site: 'B', hold: HOLD_POINTS.B[roundIdx % 3] },
    { site: 'MID', hold: HOLD_POINTS.MID[roundIdx % 3] },
  ];
  MAP.botSpawns.forEach((s, i) => {
    const bot = {
      id: i,
      name: BOT.names[i % BOT.names.length],
      pos: { x: s.x, y: 0, z: s.z },
      yaw: Math.PI, // facing +z (south, toward the player spawn)
      health: BOT.health,
      state: 'route',
      route: [],
      routeIdx: 0,
      hold: assignments[i].hold,
      site: assignments[i].site,
      reactionT: 0,
      burstLeft: 0,
      burstPauseT: 0,
      shootT: 0,
      scanT: i * 0.04,
      loseSightT: 0,
      lastSeen: null,
      hearPos: null,
      strafeDir: 1,
      strafeT: 0,
      defuseT: 0,
      walkPhase: G.rng() * 6,
      deathT: 0,
      group: null,
    };
    bot.route = planRoute(bot.pos, bot.hold);
    bot.group = buildBotMesh(scene, bot);
    G.bots.push(bot);
    G.botHitMeshes.push(bot.bodyMesh, bot.headMesh);
  });
}

// Greedy route: hop through the nearest waypoint that gets closer to the goal.
function planRoute(from, goal) {
  const route = [];
  let cur = { x: from.x, z: from.z };
  for (let hops = 0; hops < 6; hops++) {
    const dGoal = Math.hypot(goal.x - cur.x, goal.z - cur.z);
    if (dGoal < 3) break;
    let best = null, bestD = Infinity;
    for (const w of WAYPOINTS) {
      const d = Math.hypot(w.x - goal.x, w.z - goal.z);
      const dc = Math.hypot(w.x - cur.x, w.z - cur.z);
      if (dc < 1.5) continue;
      if (d < bestD) { bestD = d; best = w; }
    }
    if (!best) break;
    route.push(best);
    cur = best;
  }
  route.push(goal);
  return route;
}

function buildBotMesh(scene, bot) {
  const group = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: 0x3d434d, roughness: 0.8 });
  const vest = new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.85 });
  const visor = new THREE.MeshStandardMaterial({
    color: 0xc23b2e, roughness: 0.3, emissive: 0x7a1f16, emissiveIntensity: 0.8,
  });
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.4, metalness: 0.6 });

  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.75, 0.18), suit);
  legL.position.set(-0.11, 0.375, 0);
  const legR = legL.clone();
  legR.position.x = 0.11;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), vest);
  torso.position.y = 1.06;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), suit);
  head.position.y = 1.55;
  const visorM = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.08, 0.05), visor);
  visorM.position.set(0, 1.56, 0.16);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.7), gunMat);
  gun.position.set(0.2, 1.15, -0.3);
  group.add(legL, legR, torso, head, visorM, gun);
  group.position.set(bot.pos.x, 0, bot.pos.z);
  group.rotation.y = bot.yaw;
  scene.add(group);

  bot.legL = legL; bot.legR = legR;
  bot.bodyMesh = torso; bot.headMesh = head;
  torso.userData = { bot, part: 'body' };
  head.userData = { bot, part: 'head' };
  return group;
}

export function stepBots(G, ctx, dt) {
  const roundIdx = G.round - 1;
  for (const bot of G.bots) {
    if (bot.health <= 0) {
      bot.deathT += dt;
      // Fall flat, then sink away.
      bot.group.rotation.x = Math.max(-Math.PI / 2, bot.group.rotation.x - dt * 4);
      if (bot.deathT > 2.5) bot.group.position.y = Math.max(-1.2, bot.group.position.y - dt * 0.8);
      continue;
    }
    bot.scanT -= dt;
    if (bot.scanT <= 0) {
      bot.scanT = 0.12;
      perceive(G, ctx, bot, roundIdx);
    }
    switch (bot.state) {
      case 'route': stepRoute(G, bot, dt); break;
      case 'hold': stepHold(G, bot, dt); break;
      case 'engage': stepEngage(G, ctx, bot, dt, roundIdx); break;
      case 'investigate': stepInvestigate(G, bot, dt); break;
      case 'defuse': stepDefuse(G, ctx, bot, dt); break;
      default: break;
    }
    // Keep bots from stacking on each other.
    for (const other of G.bots) {
      if (other === bot || other.health <= 0) continue;
      const dx = bot.pos.x - other.pos.x, dz = bot.pos.z - other.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.01 && d < 0.9) {
        bot.pos.x += (dx / d) * 0.5 * dt;
        bot.pos.z += (dz / d) * 0.5 * dt;
      }
    }
    bot.group.position.set(bot.pos.x, bot.group.position.y, bot.pos.z);
    bot.group.rotation.y = bot.yaw;
  }
}

function perceive(G, ctx, bot, roundIdx) {
  const p = G.player;
  if (!p.alive) return;
  const dx = p.pos.x - bot.pos.x, dz = p.pos.z - bot.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist > BOT.viewDist) return;
  // Field of view: bot must be roughly facing the player. A bot's facing
  // direction is (-sin yaw, -cos yaw) — the same as the camera's.
  const fx = -Math.sin(bot.yaw), fz = -Math.cos(bot.yaw);
  const dot = (dx * fx + dz * fz) / (dist || 1);
  const seen = dot > BOT.fovCos || dist < 4;
  if (!seen) return;
  eyeV.set(bot.pos.x, 1.5, bot.pos.z);
  toV.set(p.pos.x, p.pos.y + 1.3, p.pos.z);
  if (losBlocked(G, ctx, eyeV, toV)) return;
  bot.lastSeen = { x: p.pos.x, z: p.pos.z, t: G.time };
  if (bot.state !== 'engage') {
    bot.state = 'engage';
    bot.reactionT = Math.max(0.25, BOT.reactionBase + roundIdx * BOT.reactionPerRound);
    bot.burstLeft = 0;
    bot.burstPauseT = 0.4;
  }
  bot.loseSightT = 0;
}

// A gunshot nearby pulls a bot to investigate the noise.
export function hearShot(G, pos) {
  for (const bot of G.bots) {
    if (bot.health <= 0 || bot.state === 'engage' || bot.state === 'defuse') continue;
    const d = Math.hypot(bot.pos.x - pos.x, bot.pos.z - pos.z);
    if (d < BOT.hearDist) {
      bot.hearPos = { x: pos.x, z: pos.z };
      bot.state = 'investigate';
      bot.route = planRoute(bot.pos, bot.hearPos);
      bot.routeIdx = 0;
    }
  }
}

function moveToward(G, bot, tx, tz, speed, dt) {
  const dx = tx - bot.pos.x, dz = tz - bot.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.05) return true;
  const step = Math.min(d, speed * dt);
  const nx = bot.pos.x + (dx / d) * step;
  const nz = bot.pos.z + (dz / d) * step;
  const feet = { x: nx, z: bot.pos.z };
  collideCircle(G.colliders, feet, BOT.radius, BOT.height);
  bot.pos.x = feet.x;
  const feet2 = { x: bot.pos.x, z: nz };
  collideCircle(G.colliders, feet2, BOT.radius, BOT.height);
  bot.pos.z = feet2.z;
  // Face the direction of travel: facing is (-sin yaw, -cos yaw), so the
  // yaw that points at (dx, dz) is atan2(-dx, -dz).
  const targetYaw = Math.atan2(-dx, -dz);
  bot.yaw = turnToward(bot.yaw, targetYaw, dt * 6);
  bot.walkPhase += dt * 8;
  bot.legL.rotation.x = Math.sin(bot.walkPhase) * 0.5;
  bot.legR.rotation.x = -Math.sin(bot.walkPhase) * 0.5;
  return d < 0.4;
}

function turnToward(yaw, target, maxStep) {
  let diff = target - yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return yaw + Math.max(-maxStep, Math.min(maxStep, diff));
}

function stepRoute(G, bot, dt) {
  const wp = bot.route[bot.routeIdx];
  if (!wp) { bot.state = 'hold'; return; }
  if (moveToward(G, bot, wp.x, wp.z, BOT.walkSpeed, dt)) {
    bot.routeIdx += 1;
    if (bot.routeIdx >= bot.route.length) bot.state = 'hold';
  }
}

function stepHold(G, bot, dt) {
  // Scan: slow sweep of the yaw across the site.
  bot.yaw += Math.sin(G.time * 0.5 + bot.id * 2) * dt * 0.5;
  bot.legL.rotation.x *= 0.9;
  bot.legR.rotation.x *= 0.9;
}

function stepEngage(G, ctx, bot, dt, roundIdx) {
  const p = G.player;
  if (!p.alive) { bot.state = 'route'; bot.route = planRoute(bot.pos, bot.hold); bot.routeIdx = 0; return; }
  const dx = p.pos.x - bot.pos.x, dz = p.pos.z - bot.pos.z;
  const dist = Math.hypot(dx, dz);
  // Face the player.
  bot.yaw = turnToward(bot.yaw, Math.atan2(-dx, -dz), dt * 8);
  // Strafe sideways and keep a fighting distance.
  bot.strafeT -= dt;
  if (bot.strafeT <= 0) { bot.strafeDir *= -1; bot.strafeT = 0.9 + G.rng() * 1.2; }
  const px = -dz / (dist || 1) * bot.strafeDir;
  const pz = dx / (dist || 1) * bot.strafeDir;
  let mx = px * BOT.engageSpeed * 0.7, mz = pz * BOT.engageSpeed * 0.7;
  if (dist > 22) { mx += (dx / dist) * BOT.engageSpeed; mz += (dz / dist) * BOT.engageSpeed; }
  if (dist < 7) { mx -= (dx / dist) * BOT.engageSpeed; mz -= (dz / dist) * BOT.engageSpeed; }
  const feet = { x: bot.pos.x + mx * dt, z: bot.pos.z };
  collideCircle(G.colliders, feet, BOT.radius, BOT.height);
  bot.pos.x = feet.x;
  const feet2 = { x: bot.pos.x, z: bot.pos.z + mz * dt };
  collideCircle(G.colliders, feet2, BOT.radius, BOT.height);
  bot.pos.z = feet2.z;
  bot.walkPhase += dt * 7;
  bot.legL.rotation.x = Math.sin(bot.walkPhase) * 0.45;
  bot.legR.rotation.x = -Math.sin(bot.walkPhase) * 0.45;

  // Check sight again; lose it for 1.5 s and the bot falls back to investigating.
  eyeV.set(bot.pos.x, 1.5, bot.pos.z);
  toV.set(p.pos.x, p.pos.y + 1.3, p.pos.z);
  const blocked = losBlocked(G, ctx, eyeV, toV);
  if (blocked || dist > BOT.viewDist) {
    bot.loseSightT += dt;
    if (bot.loseSightT > 1.5) {
      bot.state = 'investigate';
      bot.route = planRoute(bot.pos, bot.lastSeen || bot.hold);
      bot.routeIdx = 0;
      return;
    }
  } else {
    bot.loseSightT = 0;
    bot.lastSeen = { x: p.pos.x, z: p.pos.z, t: G.time };
  }

  if (bot.reactionT > 0) { bot.reactionT -= dt; return; }
  if (blocked) return;
  // Burst fire with an error cone that grows with distance and target speed.
  bot.burstPauseT -= dt;
  if (bot.burstLeft <= 0) {
    if (bot.burstPauseT <= 0) {
      bot.burstLeft = BOT.burstMin + Math.floor(G.rng() * (BOT.burstMax - BOT.burstMin + 1));
      bot.burstPauseT = BOT.burstPause;
      bot.shootT = 0;
    }
    return;
  }
  bot.shootT -= dt;
  if (bot.shootT > 0) return;
  bot.shootT = 0.12;
  bot.burstLeft -= 1;
  const speedFactor = Math.min(1, Math.hypot(p.vel.x, p.vel.z) / 4.6) * 0.02;
  const spread = Math.max(0.008,
    BOT.baseSpread + BOT.farSpread * (dist / 40) + speedFactor
    - roundIdx * BOT.accuracyPerRound - (p.crouch ? 0.008 : 0));
  dirV.set(dx / dist, (p.pos.y + 1.25 - 1.5) / dist, dz / dist);
  dirV.x += (G.rng() * 2 - 1) * spread;
  dirV.y += (G.rng() * 2 - 1) * spread;
  dirV.z += (G.rng() * 2 - 1) * spread * 0.4;
  dirV.normalize();
  eyeV.set(bot.pos.x, 1.5, bot.pos.z);
  const hit = shootRay(G, ctx, eyeV, dirV, BOT_DEF, 'bot');
  // The player's body is not a mesh in the occluder lists, so test the ray
  // against the player capsule explicitly; a wall or a teammate in front
  // blocks the shot (whichever the ray reaches first).
  const pd = rayHitsPlayer(eyeV, dirV, p, BOT_DEF.range);
  const blocker = hit && hit.hit ? hit.dist : Infinity;
  const endDist = Math.min(blocker, pd === null ? Infinity : pd, BOT_DEF.range);
  if (ctx.fx) ctx.fx.tracer(eyeV, dirV, endDist);
  if (ctx.audio) ctx.audio.enemyShot(bot.pos, G.player.pos);
  if (pd !== null && pd < blocker) {
    // A bot bullet that reaches the player: damage with falloff.
    const falloff = Math.max(0.6, 1 - (pd / BOT_DEF.range) * 0.4);
    const killed = damagePlayer(G, BOT_DEF.damage * falloff);
    pushEvent(G, 'playerHit', { by: bot.name });
    if (killed) {
      pushEvent(G, 'playerKilled', { by: bot.name });
      if (ctx.audio) ctx.audio.playerDown();
    }
  }
}

function stepInvestigate(G, bot, dt) {
  const wp = bot.route[bot.routeIdx];
  if (!wp) {
    // Look around, then return to the hold point.
    bot.yaw += dt * 1.5;
    bot.route = planRoute(bot.pos, bot.hold);
    bot.routeIdx = 0;
    bot.state = 'route';
    return;
  }
  if (moveToward(G, bot, wp.x, wp.z, BOT.walkSpeed, dt)) {
    bot.routeIdx += 1;
    if (bot.routeIdx >= bot.route.length) {
      bot.yaw += dt * 1.5;
      bot.route = planRoute(bot.pos, bot.hold);
      bot.routeIdx = 0;
      bot.state = 'route';
    }
  }
}

// A planted charge pulls the nearest living bots to defuse it.
export function sendDefusers(G) {
  const site = G.charge.site === 'A' ? MAP.sites.A : MAP.sites.B;
  let sent = 0;
  for (const bot of G.bots) {
    if (bot.health <= 0) continue;
    if (sent >= 2) break;
    bot.state = 'defuse';
    bot.route = planRoute(bot.pos, { x: site.x, z: site.z });
    bot.routeIdx = 0;
    bot.defuseT = 0;
    sent += 1;
  }
}

function stepDefuse(G, ctx, bot, dt) {
  const site = G.charge.site === 'A' ? MAP.sites.A : MAP.sites.B;
  const d = Math.hypot(site.x - bot.pos.x, site.z - bot.pos.z);
  if (d > 2.2) {
    const wp = bot.route[bot.routeIdx];
    if (wp && moveToward(G, bot, wp.x, wp.z, BOT.walkSpeed * 1.15, dt)) {
      bot.routeIdx += 1;
    }
    return;
  }
  // On the site: channel the defuse. Damage interrupts it.
  if (bot.lastDamageAt && G.time - bot.lastDamageAt < 0.5) {
    bot.defuseT = Math.max(0, bot.defuseT - dt * 2);
    return;
  }
  bot.defuseT += dt;
  G.charge.defuseProgress = Math.max(G.charge.defuseProgress, bot.defuseT / 5);
  G.charge.defuser = bot.name;
  bot.yaw = turnToward(bot.yaw, Math.atan2(-(site.x - bot.pos.x), -(site.z - bot.pos.z)), dt * 6);
  if (bot.defuseT >= 5) {
    G.charge.state = 'defused';
    pushEvent(G, 'defused', { by: bot.name });
  }
}
