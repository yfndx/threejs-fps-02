// EMBERLINE — configuration: palette, weapons, economy, rounds, bot tuning.
// Every number the game balances on lives here, so tuning never hunts through logic.

export const PALETTE = {
  sky: 0x2a2f3a, // dusk slate
  fog: 0x2a2f3a,
  ground: 0x4a4238, // packed dirt
  groundLine: 0x3a332b,
  wall: 0x6b5d4a, // sandstone
  wallDark: 0x54483a,
  metal: 0x3d444c, // container steel
  metalRust: 0x8a4a28, // rust orange
  accent: 0xf0a830, // ember amber
  accentDim: 0xb97d1e,
  siteA: 0xf0a830,
  siteB: 0x3fa7a0, // teal
  enemy: 0xc23b2e, // ash red
  ally: 0x3fa7a0,
  muzzle: 0xffd27a,
  smoke: 0x9aa0a6,
  hudInk: '#e9e6df',
  hudMuted: '#98a0a8',
  hudAccent: '#f0a830',
};

// Weapons the player can buy. damage is per bullet; pellets counts for shotguns.
export const WEAPONS = {
  sidearm: {
    id: 'sidearm', name: 'P9 SIDEARM', price: 0, mag: 12, reserve: 48,
    damage: 22, headMult: 2.0, pellets: 1, rate: 6, auto: false,
    spread: 0.011, moveSpread: 0.030, recoil: 0.011, reload: 1.1, range: 60,
    sound: 'pistol',
  },
  smg: {
    id: 'smg', name: 'VEX-9 SMG', price: 950, mag: 28, reserve: 112,
    damage: 16, headMult: 1.8, pellets: 1, rate: 11, auto: true,
    spread: 0.020, moveSpread: 0.045, recoil: 0.009, reload: 1.6, range: 55,
    sound: 'smg',
  },
  rifle: {
    id: 'rifle', name: 'LONGBOW-7', price: 2100, mag: 25, reserve: 100,
    damage: 30, headMult: 2.0, pellets: 1, rate: 8.5, auto: true,
    spread: 0.008, moveSpread: 0.034, recoil: 0.016, reload: 2.0, range: 90,
    sound: 'rifle',
  },
  shotgun: {
    id: 'shotgun', name: 'MAULER-12', price: 1100, mag: 6, reserve: 24,
    damage: 9, headMult: 1.5, pellets: 8, rate: 1.2, auto: false,
    spread: 0.052, moveSpread: 0.070, recoil: 0.055, reload: 0.55, range: 22,
    sound: 'shotgun', shellReload: true,
  },
  dmr: {
    id: 'dmr', name: 'HERON DMR', price: 3400, mag: 10, reserve: 40,
    damage: 55, headMult: 2.5, pellets: 1, rate: 1.6, auto: false,
    spread: 0.002, moveSpread: 0.020, recoil: 0.038, reload: 2.6, range: 120,
    sound: 'dmr',
  },
};

export const GRENADES = {
  frag: { id: 'frag', name: 'SPARK FRAG', price: 300, fuse: 1.6, radius: 6.5, damage: 95 },
  smoke: { id: 'smoke', name: 'VEIL SMOKE', price: 200, duration: 12 },
};

export const ECONOMY = {
  startMoney: 800,
  winRound: 800,
  loseRound: 400,
  kill: 300,
  plant: 300,
  armorPrice: 600,
  armorValue: 50,
};

export const ROUND = {
  maxRounds: 5,
  winRounds: 3,
  timeSec: 100,
  plantTimeSec: 2.5,
  defuseTimeSec: 5,
  chargeTimeSec: 35,
  buyTimeSec: 20,
  botCount: 4,
};

export const PLAYER = {
  radius: 0.42,
  height: 1.7,
  crouchHeight: 1.15,
  eye: 1.62,
  crouchEye: 1.05,
  walkSpeed: 4.6,
  crouchSpeed: 2.2,
  sprintSpeed: 6.3,
  accel: 42,
  friction: 10,
  jumpSpeed: 5.2,
  gravity: 13.5,
  health: 100,
};

// Bot tuning. Reaction and accuracy scale with round number (round 1 = index 0).
export const BOT = {
  health: 100,
  radius: 0.42,
  height: 1.75,
  walkSpeed: 3.4,
  engageSpeed: 2.2,
  damage: 11, // per hit, before falloff
  headMult: 1.6,
  burstMin: 3,
  burstMax: 6,
  burstPause: 0.9,
  baseSpread: 0.020,
  farSpread: 0.045,
  reactionBase: 0.55, // seconds to first shot after spotting
  reactionPerRound: -0.05,
  accuracyPerRound: 0.012, // spread reduction per round
  viewDist: 46,
  fovCos: 0.42, // cos(65 deg) half-angle
  hearDist: 30,
  names: ['ROOK', 'VANE', 'KESTREL', 'MARLOWE'],
};

export const MAP = {
  minX: -22, maxX: 22,
  minZ: -18, maxZ: 18,
  wallHeight: 3.2,
  sites: {
    A: { x: -16, z: 0, r: 3.4, label: 'A · FOUNDRY' },
    B: { x: 16, z: 0, r: 3.4, label: 'B · YARD' },
  },
  playerSpawn: { x: 0, z: 15, yaw: 0 }, // facing -z (north, toward the sites)
  botSpawns: [
    { x: -14, z: -15 }, { x: -4, z: -15 }, { x: 6, z: -15 }, { x: 14, z: -15 },
  ],
};
