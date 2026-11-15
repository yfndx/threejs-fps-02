// EMBERLINE — bootstrap and the game loop.
// Rendering and simulation are separate: the simulation steps at a fixed 60 Hz
// and owns the state; rendering only reads it. Rounds flow menu -> buy ->
// round -> roundEnd -> (buy | matchEnd). The charge is the objective: plant
// it at A or B, defend it till it blows, or lose the round.

import * as THREE from 'three';
import { ECONOMY, MAP, PALETTE, ROUND, WEAPONS } from './config.js';
import { createState, mulberry32, pushEvent, pushKillfeed } from './state.js';
import { buildWorld } from './world.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createFx } from './fx.js';
import {
  bindHud, updateHud, showBanner, flashHitmarker, renderBuyMenu, setBuyMenu,
  setOverlay, setMatchOverlay,
} from './hud.js';
import { resetPlayer, stepPlayer, eyeHeight } from './player.js';
import { spawnBots, stepBots, hearShot, sendDefusers } from './bots.js';
import { shootRay, stepProjectiles } from './combat.js';
import {
  currentWeapon, tryFire, startReload, stepReload, switchWeapon, buyWeapon,
  buyArmor, buyGrenade, buildViewmodel, updateViewmodel, tryThrow, cancelReload,
} from './weapons.js';
import { stageShot } from './shots.js';

const FIXED_DT = 1 / 60;
const params = new URLSearchParams(location.search);
const shotNum = Number(params.get('shot') || 0);
const seed = Number(params.get('seed') || 1);
const SHOT_MODE = shotNum >= 1 && shotNum <= 4;

const G = createState();
G.seed = seed;
G.rng = mulberry32(seed);

// --- Renderer, scene, lights ---
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(PALETTE.fog, 30, 85);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 220);
camera.rotation.order = 'YXZ';
scene.add(camera);

const hemi = new THREE.HemisphereLight(0x8a94a8, 0x3a2f24, 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffc27a, 2.1);
sun.position.set(18, 26, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -30; sun.shadow.camera.right = 30;
sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
sun.shadow.camera.far = 80;
scene.add(sun);
const siteLightA = new THREE.PointLight(0xf0a830, 12, 14, 1.8);
siteLightA.position.set(MAP.sites.A.x, 3, MAP.sites.A.z);
scene.add(siteLightA);
const siteLightB = new THREE.PointLight(0x3fa7a0, 12, 14, 1.8);
siteLightB.position.set(MAP.sites.B.x, 3, MAP.sites.B.z);
scene.add(siteLightB);

// --- World, effects, audio, input, HUD ---
const { colliders, occluders } = buildWorld(scene);
G.colliders = colliders;
const fx = createFx(scene, camera);
const audio = createAudio();
const input = createInput(renderer.domElement);
bindHud();
const viewmodel = buildViewmodel(camera);
const ctx = { scene, occluders, fx, audio };

// The planted charge: a small box with a blinking beacon, shown when live.
const chargeMesh = new THREE.Group();
const chargeBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.5, 0.32, 0.36),
  new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.4, metalness: 0.5 }),
);
const chargeLamp = new THREE.Mesh(
  new THREE.SphereGeometry(0.07, 8, 8),
  new THREE.MeshBasicMaterial({ color: 0xff2a1a }),
);
chargeLamp.position.y = 0.22;
chargeMesh.add(chargeBody, chargeLamp);
chargeMesh.visible = false;
scene.add(chargeMesh);

// Debug handle: the live state and the real game functions, for automated
// playtests (and for anyone poking at the game in the console). Nothing here
// bypasses the simulation — fire() is the same tryFire the mouse calls.
window.__ember = {
  G, input, stepGame, startBuyPhase, startRound, restartMatch,
  fire: () => tryFire(G, ctx),
  buy: (id) => buyWeapon(G, id),
  // Recompute world matrices from the logical state (the renderer does this
  // every frame in real play; a test that steps the sim without rendering
  // needs it before raycasting against the bot meshes).
  sync: () => scene.updateMatrixWorld(true),
  // Raycast probe: aim at a point with zero spread and report exactly what
  // the ray meets, plus where the bot meshes actually are in world space.
  probeShot: (tx, ty, tz) => {
    const p = G.player;
    const dx = tx - p.pos.x, dy = ty - (p.pos.y + 1.62), dz = tz - p.pos.z;
    const len = Math.hypot(dx, dy, dz);
    const dir = new THREE.Vector3(dx / len, dy / len, dz / len);
    const origin = new THREE.Vector3(p.pos.x, p.pos.y + 1.62, p.pos.z);
    const hit = shootRay(G, ctx, origin, dir, WEAPONS.rifle, 'player');
    const v = new THREE.Vector3();
    return {
      hit: hit.hit, wall: hit.wall, dist: hit.dist,
      bot: hit.bot ? hit.bot.name : null, part: hit.part,
      point: hit.point ? [hit.point.x, hit.point.y, hit.point.z] : null,
      botHitMeshes: G.botHitMeshes.length,
      torsoWorld: G.bots[0] ? G.bots[0].bodyMesh.getWorldPosition(v).toArray() : null,
      botPos: G.bots[0] ? [G.bots[0].pos.x, G.bots[0].pos.z] : null,
      dir: [dir.x, dir.y, dir.z],
    };
  },
};
window.__emberReady = false;
window.__emberError = null;
window.addEventListener('error', (e) => { window.__emberError = String(e.message); });

// --- Round flow ---
function startBuyPhase() {
  G.phase = 'buy';
  G.buyTime = ROUND.buyTimeSec;
  G.charge = { state: 'idle', site: null, x: 0, z: 0, timer: 0, plantProgress: 0, defuseProgress: 0, defuser: null };
  chargeMesh.visible = false;
  resetPlayerKeepLoadout();
  renderBuyMenu(G);
  setBuyMenu(true);
  showBanner(`ROUND ${G.round} — BUY PHASE`, 'Spend your money, then press ENTER');
  setOverlay(false);
  setMatchOverlay(false);
}

function resetPlayerKeepLoadout() {
  const keep = {
    weapons: G.player.weapons, current: G.player.current,
    grenades: G.player.grenades, armor: G.player.armor,
  };
  resetPlayer(G);
  G.player.weapons = keep.weapons;
  G.player.current = keep.current;
  G.player.grenades = keep.grenades;
  G.player.armor = keep.armor;
  // Sidearm reserve is topped up between rounds; bought ammo is not.
  if (G.player.weapons.sidearm) G.player.weapons.sidearm.reserve = WEAPONS.sidearm.reserve;
}

function startRound() {
  setBuyMenu(false);
  G.phase = 'round';
  G.roundTime = ROUND.timeSec;
  resetPlayerKeepLoadout();
  spawnBots(G, scene);
  showBanner(`ROUND ${G.round}`, 'Plant the charge at A or B — or eliminate ASH');
  audio.unlock();
}

function endRound(winner, reason) {
  if (G.phase !== 'round') return;
  G.phase = 'roundEnd';
  G.roundWinner = winner;
  G.roundReason = reason;
  G.roundEndT = 3;
  if (winner === 'ember') {
    G.score.ember += 1;
    G.money += ECONOMY.winRound;
    audio.roundWin();
    showBanner('ROUND WON', reason);
  } else {
    G.score.ash += 1;
    G.money += ECONOMY.loseRound;
    audio.roundLose();
    showBanner('ROUND LOST', reason);
  }
  pushKillfeed(G, `— ${reason} —`);
}

function nextAfterRound() {
  if (G.score.ember >= ROUND.winRounds || G.score.ash >= ROUND.winRounds || G.round >= ROUND.maxRounds) {
    G.phase = 'matchEnd';
    G.matchWinner = G.score.ember > G.score.ash ? 'ember' : 'ash';
    input.unlock();
    if (G.matchWinner === 'ember') {
      setMatchOverlay(true, 'EMBERLINE — VICTORY',
        `EMBER takes the match ${G.score.ember}–${G.score.ash}. ${G.kills} eliminations. Click to play again.`);
      audio.roundWin();
    } else {
      setMatchOverlay(true, 'EMBERLINE — DEFEAT',
        `ASH takes the match ${G.score.ash}–${G.score.ember}. Click to run it back.`);
      audio.roundLose();
    }
    return;
  }
  G.round += 1;
  startBuyPhase();
}

function restartMatch() {
  G.round = 1;
  G.score = { ember: 0, ash: 0 };
  G.money = ECONOMY.startMoney;
  G.kills = 0;
  G.player.weapons = { sidearm: { mag: WEAPONS.sidearm.mag, reserve: WEAPONS.sidearm.reserve } };
  G.player.current = 'sidearm';
  G.player.grenades = { frag: 0, smoke: 0 };
  startBuyPhase();
}

// --- Planting ---
function nearestSite() {
  const p = G.player;
  for (const [id, s] of Object.entries(MAP.sites)) {
    if (Math.hypot(p.pos.x - s.x, p.pos.z - s.z) < s.r) return id;
  }
  return null;
}

function stepPlant(G, dt) {
  const c = G.charge;
  if (c.state === 'planted') {
    c.timer -= dt;
    if (c.timer <= 10 && Math.floor(c.timer) !== Math.floor(c.timer + dt)) audio.plantBeep();
    if (c.timer <= 0) {
      c.state = 'detonated';
      fx.explosion(new THREE.Vector3(c.x, 0.5, c.z));
      audio.explosion({ x: c.x, z: c.z }, G.player.pos);
      endRound('ember', 'CHARGE DETONATED');
    }
    return;
  }
  if (c.state === 'planting') {
    // Keep holding E on the same site or the plant aborts.
    const site = nearestSite();
    if (!site || site !== c.site || !input.isDown('KeyE') || !G.player.alive) {
      c.state = 'idle';
      c.plantProgress = 0;
      return;
    }
    c.plantProgress += dt / ROUND.plantTimeSec;
    if (c.plantProgress >= 1) {
      c.state = 'planted';
      c.timer = ROUND.chargeTimeSec;
      c.defuseProgress = 0;
      G.money += ECONOMY.plant;
      chargeMesh.position.set(c.x, 0.16, c.z);
      chargeMesh.visible = true;
      pushKillfeed(G, 'YOU planted the charge');
      pushEvent(G, 'planted', { site: c.site });
      audio.plantBeep();
      sendDefusers(G);
    }
    return;
  }
  if (c.state !== 'idle') return; // detonated / defused: the round is over
  const site = nearestSite();
  if (site && input.isDown('KeyE') && G.player.alive) {
    c.state = 'planting';
    c.site = site;
    c.x = MAP.sites[site].x;
    c.z = MAP.sites[site].z;
    c.plantProgress = 0;
  }
}

// --- One fixed simulation step ---
let prevMouseDown = false;

function stepGame(dt) {
  G.time += dt;
  G.tick += 1;

  if (G.phase === 'matchEnd') return;
  if (G.phase === 'roundEnd') {
    G.roundEndT -= dt;
    stepBots(G, ctx, dt);
    fx.step(dt);
    if (G.roundEndT <= 0) nextAfterRound();
    return;
  }

  // Mouse look.
  const look = input.consumeLook();
  const p = G.player;
  p.yaw -= look.dx * 0.0022;
  p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch - look.dy * 0.0022));

  const mv = input.read();

  if (G.phase === 'buy') {
    G.buyTime -= dt;
    stepPlayer(G, { ...mv, jump: false }, dt, colliders);
    if (G.buyTime <= 0 || input.wasPressed('Enter')) startRound();
  } else if (G.phase === 'round') {
    G.roundTime -= dt;
    stepPlayer(G, mv, dt, colliders);

    // Fire cooldown ticks down here; the grenade-throw lock clears with it.
    // (Without this the first shot jams the gun for the rest of the round.)
    if (p.fireT > 0) {
      p.fireT -= dt;
      if (p.fireT <= 0) { p.fireT = 0; p.throwing = null; }
    }

    // Fire: auto weapons hold, semi-auto needs a fresh click.
    const { def } = currentWeapon(G);
    const firing = input.mouseDown && (def.auto || !prevMouseDown);
    if (firing && input.locked) tryFire(G, ctx);
    if (input.wasPressed('KeyR')) { startReload(G); audio.reload(); }
    if (input.wasPressed('KeyG')) tryThrow(G, 'frag');
    if (input.wasPressed('KeyF')) tryThrow(G, 'smoke');
    // Weapon slots 1-3 in buy order.
    const owned = Object.keys(G.player.weapons);
    for (let i = 0; i < 3; i++) {
      if (input.wasPressed(`Digit${i + 1}`) && owned[i]) switchWeapon(G, owned[i]);
    }
    // Buy keys during the round do nothing; buying is for the buy phase.
    stepReload(G, dt);
    stepPlant(G, dt);
    stepBots(G, ctx, dt);
    stepProjectiles(G, ctx, dt);
    for (const s of G.smokes) s.ttl -= dt;
    G.smokes = G.smokes.filter((s) => s.ttl > 0);

    // Round end conditions.
    if (!p.alive) endRound('ash', 'YOU WERE ELIMINATED');
    else if (G.bots.length && G.bots.every((b) => b.health <= 0)) endRound('ember', 'SQUAD ELIMINATED');
    else if (G.roundTime <= 0 && G.charge.state === 'idle') endRound('ash', 'TIME EXPIRED');
    else if (G.charge.state === 'defused') endRound('ash', 'CHARGE DEFUSED');
  }

  // Consume this step's events: gunfire is heard, hits flash the marker.
  for (const ev of G.events) {
    if (ev.type === 'shot') hearShot(G, ev.pos);
    if (ev.type === 'hit') flashHitmarker(ev.head);
  }
  G.events.length = 0;
  fx.step(dt);
  prevMouseDown = input.mouseDown;
}

function isKey(code) {
  return input.isDown(code);
}

// Buy phase input: number keys buy, B toggles the shop.
window.addEventListener('keydown', (e) => {
  if (G.phase !== 'buy' || SHOT_MODE) return;
  const order = ['smg', 'rifle', 'shotgun', 'dmr'];
  const idx = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
  if (idx >= 0 && buyWeapon(G, order[idx])) { audio.buy(); renderBuyMenu(G); }
  if (e.code === 'Digit5' && buyArmor(G)) { audio.buy(); renderBuyMenu(G); }
  if (e.code === 'Digit6' && buyGrenade(G, 'frag')) { audio.buy(); renderBuyMenu(G); }
  if (e.code === 'Digit7' && buyGrenade(G, 'smoke')) { audio.buy(); renderBuyMenu(G); }
  if (e.code === 'KeyB') {
    const menu = document.getElementById('buy-menu');
    const willOpen = menu.classList.contains('hidden');
    setBuyMenu(willOpen);
    if (willOpen) renderBuyMenu(G);
  }
});
window.addEventListener('ember-buy', (e) => {
  if (G.phase !== 'buy') return;
  const id = e.detail;
  let ok = false;
  if (id === 'armor') ok = buyArmor(G);
  else if (id.startsWith('nade:')) ok = buyGrenade(G, id.slice(5));
  else ok = buyWeapon(G, id);
  if (ok) { audio.buy(); renderBuyMenu(G); }
});

// --- Menu / pause / restart wiring ---
const playBtn = document.getElementById('play');
playBtn.addEventListener('click', () => {
  audio.unlock();
  input.lock();
  if (G.phase === 'menu') startBuyPhase();
  else if (paused) { paused = false; setOverlay(false); }
});
document.getElementById('restart').addEventListener('click', () => {
  audio.unlock();
  input.lock();
  restartMatch();
});
let paused = false;
document.addEventListener('pointerlockchange', () => {
  if (!input.locked && (G.phase === 'round' || G.phase === 'buy') && !SHOT_MODE) {
    paused = true;
    setOverlay(true, 'PAUSED', 'Click to resume — the round is waiting.');
  }
});

// --- Main loop: fixed-step simulation, decoupled rendering ---
let last = performance.now();
let acc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dtMs = Math.min(100, now - last);
  last = now;
  if (!SHOT_MODE && !paused && G.phase !== 'menu') {
    acc += dtMs / 1000;
    let n = 0;
    while (acc >= FIXED_DT && n < 5) {
      stepGame(FIXED_DT);
      acc -= FIXED_DT;
      n += 1;
    }
    if (n === 5) acc = 0;
    // Edges are consumed by the fixed steps, not by the render: clearing
    // them on a frame that ran no steps would eat the keypress.
    if (n > 0) input.endFrame();
  } else {
    input.endFrame(); // menu / paused / shot mode: drop edges so they don't leak into play
  }
  // Camera follows the player (recoil rides on top of the aim pitch).
  const p = G.player;
  camera.position.set(p.pos.x, eyeHeight(G), p.pos.z);
  camera.rotation.y = p.yaw;
  camera.rotation.x = p.pitch + p.recoil;
  camera.rotation.z = p.alive ? 0 : 0.6;
  if (!p.alive) camera.position.y = Math.max(0.6, camera.position.y - 0.02);
  updateViewmodel(G, viewmodel, dtMs / 1000, now / 1000);
  // The charge mesh follows the charge state (also covers staged shots,
  // where the simulation never runs to show it).
  if (G.charge.state === 'planted' || G.charge.state === 'planting') {
    chargeMesh.position.set(G.charge.x, 0.16, G.charge.z);
    chargeMesh.visible = true;
  } else if (G.charge.state === 'idle') {
    chargeMesh.visible = false;
  }
  // The charge beacon blinks while the charge is live.
  if (G.charge.state === 'planted') {
    chargeLamp.material.color.setHex(Math.floor(now / 300) % 2 ? 0xff2a1a : 0x551008);
  }
  renderer.render(scene, camera);
  updateHud(G, dtMs / 1000);
  if (!window.__emberReady) window.__emberReady = true;
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// --- Start ---
if (SHOT_MODE) {
  stageShot(G, ctx, shotNum);
  setOverlay(false);
  setMatchOverlay(false);
} else {
  setOverlay(true, 'EMBERLINE',
    'A tactical round-based FPS. Plant the charge at A or B, or eliminate the ASH squad. Click to play.');
}
requestAnimationFrame(frame);
