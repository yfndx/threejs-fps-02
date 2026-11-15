// EMBERLINE — the one place game state lives.
// Every module reads and writes this object; nothing else holds round truth.
// Simulation runs at a fixed 60 Hz step (see main.js); rendering only reads.

import { ECONOMY, PLAYER, ROUND, WEAPONS } from './config.js';

export function createState() {
  return {
    // Match flow: 'menu' | 'buy' | 'round' | 'roundEnd' | 'matchEnd'
    phase: 'menu',
    round: 1,
    score: { ember: 0, ash: 0 },
    roundTime: ROUND.timeSec,
    buyTime: ROUND.buyTimeSec,
    roundWinner: null, // 'ember' | 'ash' | null
    roundReason: '',
    matchWinner: null,
    // Economy
    money: ECONOMY.startMoney,
    kills: 0,
    // The charge (objective). site: 'A' | 'B' | null
    charge: { state: 'idle', site: null, x: 0, z: 0, timer: 0, plantProgress: 0, defuseProgress: 0, defuser: null },
    // Player
    player: {
      pos: { x: 0, y: 0, z: 15 },
      vel: { x: 0, y: 0, z: 0 },
      yaw: 0,
      pitch: 0,
      onGround: true,
      crouch: false,
      sprint: false,
      health: PLAYER.health,
      armor: 0,
      alive: true,
      // weapons: map id -> { mag, reserve } owned; slots in buy order
      weapons: { sidearm: { mag: WEAPONS.sidearm.mag, reserve: WEAPONS.sidearm.reserve } },
      current: 'sidearm',
      grenades: { frag: 0, smoke: 0 },
      spread: 0, // current bloom, radians
      recoil: 0, // accumulated pitch kick waiting to settle
      reloadT: 0, // >0 while reloading
      fireT: 0, // cooldown until next shot
      triggerHeld: false,
      planting: false,
      throwing: null, // 'frag' | 'smoke' | null while the throw anim runs
    },
    // Bots: filled by bots.js spawnBots()
    bots: [],
    // Grenades in flight / smoke clouds in the world
    projectiles: [], // { kind, pos, vel, fuse, owner }
    smokes: [], // { pos, radius, ttl }
    // Events the world raises for audio/HUD (consumed each frame, then cleared)
    events: [], // { type, ... } e.g. {type:'shot', pos}, {type:'kill', name}, {type:'hit', head}
    killfeed: [], // { text, t } newest first, HUD trims by age
    // Fixed-step bookkeeping
    time: 0,
    tick: 0,
    // Deterministic RNG (mulberry32); seeded from URL ?seed= or match time
    rng: null,
    seed: 1,
  };
}

// Small deterministic RNG so staged scenes and bot behaviour are reproducible.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pushEvent(G, type, data) {
  G.events.push({ type, ...(data || {}) });
  if (G.events.length > 64) G.events.splice(0, G.events.length - 64);
}

export function pushKillfeed(G, text) {
  G.killfeed.unshift({ text, t: G.time });
  if (G.killfeed.length > 5) G.killfeed.length = 5;
}
