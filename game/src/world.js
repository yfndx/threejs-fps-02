// EMBERLINE — the map: "Foundry Yard".
// An original industrial yard: two plant sites (A Foundry west, B Yard east),
// a central furnace block, container rows and crate cover forming three lanes.
// All collision is axis-aligned boxes; the same list drives movement, bullets
// and bot line-of-sight, so what you see is what blocks you.

import * as THREE from 'three';
import { MAP, PALETTE } from './config.js';

// A collision box: { minX, maxX, minZ, maxZ, top } — top is its height.
export function buildWorld(scene) {
  const colliders = [];
  const occluders = []; // meshes bullets and sight rays test against
  const mats = {
    ground: new THREE.MeshStandardMaterial({ color: PALETTE.ground, roughness: 0.95 }),
    wall: new THREE.MeshStandardMaterial({ color: PALETTE.wall, roughness: 0.85 }),
    wallDark: new THREE.MeshStandardMaterial({ color: PALETTE.wallDark, roughness: 0.9 }),
    metal: new THREE.MeshStandardMaterial({ color: PALETTE.metal, roughness: 0.55, metalness: 0.45 }),
    rust: new THREE.MeshStandardMaterial({ color: PALETTE.metalRust, roughness: 0.7, metalness: 0.25 }),
    accent: new THREE.MeshStandardMaterial({ color: PALETTE.accent, roughness: 0.5, emissive: PALETTE.accentDim, emissiveIntensity: 0.35 }),
    teal: new THREE.MeshStandardMaterial({ color: PALETTE.siteB, roughness: 0.5, emissive: 0x1d4f4b, emissiveIntensity: 0.4 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.9 }),
  };

  const group = new THREE.Group();
  group.name = 'world';

  function box(x, z, w, d, h, mat, y = 0, collide = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y + h / 2, z);
    m.castShadow = h > 1.2;
    m.receiveShadow = true;
    group.add(m);
    if (collide) {
      colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: y + h });
      occluders.push(m);
    }
    return m;
  }

  // Ground
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 48), mats.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // Perimeter walls
  const W = MAP.wallHeight;
  box(0, MAP.minZ - 0.3, 46, 0.6, W, mats.wall); // north
  box(0, MAP.maxZ + 0.3, 46, 0.6, W, mats.wall); // south
  box(MAP.minX - 0.3, 0, 0.6, 38, W, mats.wall); // west
  box(MAP.maxX + 0.3, 0, 0.6, 38, W, mats.wall); // east

  // --- Site A: the Foundry (west). A U of walls with a gap facing mid. ---
  box(-19.5, -5.5, 0.6, 11, W, mats.wallDark); // west wall of foundry
  box(-19.5, 5.5, 0.6, 11, W, mats.wallDark);
  box(-16, -9.5, 8, 0.6, W, mats.wallDark);
  box(-13.5, -9.5, 0.6, 6, 2.2, mats.wallDark); // low wall, shootable over? no — 2.2 blocks sight standing
  // Foundry props: two furnace tanks and a pipe stack
  const tankGeo = new THREE.CylinderGeometry(1.5, 1.5, 3.4, 12);
  for (const [x, z] of [[-18.5, -2], [-18.5, 3]]) {
    const t = new THREE.Mesh(tankGeo, mats.rust);
    t.position.set(x, 1.7, z);
    t.castShadow = true;
    group.add(t);
    colliders.push({ minX: x - 1.5, maxX: x + 1.5, minZ: z - 1.5, maxZ: z + 1.5, top: 3.4 });
    occluders.push(t);
  }
  box(-14.5, 0, 2.2, 0.8, 2.6, mats.metal); // pipe stack
  // Site A marker: amber floor ring + floating label post
  ring(group, MAP.sites.A.x, MAP.sites.A.z, MAP.sites.A.r, mats.accent);
  post(group, MAP.sites.A.x, MAP.sites.A.z, 'A', mats.accent);

  // --- Site B: the Yard (east). Container rows forming lanes. ---
  box(19.5, -5.5, 0.6, 11, W, mats.wallDark);
  box(19.5, 5.5, 0.6, 11, W, mats.wallDark);
  box(16, 9.5, 8, 0.6, W, mats.wallDark);
  box(13.5, 9.5, 0.6, 6, 2.2, mats.wallDark);
  // Containers: long steel boxes, stacked two high on one side
  box(15, -6, 6, 2.4, 2.6, mats.metal);
  box(15, -6, 6, 2.4, 2.6, mats.rust, 2.6); // stacked
  box(18.5, 2.5, 2.4, 5, 2.6, mats.teal);
  box(13.8, 5.5, 4, 2.2, 2.6, mats.metal);
  ring(group, MAP.sites.B.x, MAP.sites.B.z, MAP.sites.B.r, mats.teal);
  post(group, MAP.sites.B.x, MAP.sites.B.z, 'B', mats.teal);

  // --- Mid: the furnace block and lane cover ---
  box(0, -3, 6, 3.6, 2.6, mats.dark); // central furnace
  box(0, -3, 6.4, 4, 0.5, mats.rust, 2.6); // furnace cap
  // Crates: the cover that makes the lanes
  const crates = [
    [-8, -8, 1.2], [-8, 8, 1.2], [8, -8, 1.2], [8, 8, 1.2],
    [-4, 4, 1.8], [4, -4, 1.8], [-11, 0, 1.2], [11, 0, 1.2],
    [-2, -11, 1.2], [2, 11, 1.2], [-6, -1, 1.2], [6, 1, 1.2],
  ];
  for (const [x, z, s] of crates) box(x, z, s, s, s, (x + z) % 4 === 0 ? mats.rust : mats.wallDark);
  // Low walls for crouch cover on the lanes
  box(-8, 0, 3, 0.5, 1.1, mats.wall);
  box(8, 0, 3, 0.5, 1.1, mats.wall);
  box(0, 8, 0.5, 4, 1.1, mats.wall);
  box(0, -11, 0.5, 4, 1.1, mats.wall);

  // Distant skyline silhouettes (no collision, outside the walls)
  for (let i = 0; i < 10; i++) {
    const h = 6 + ((i * 37) % 9);
    const m = new THREE.Mesh(new THREE.BoxGeometry(4, h, 4), mats.dark);
    const a = (i / 10) * Math.PI * 2;
    m.position.set(Math.cos(a) * 34, h / 2, Math.sin(a) * 30);
    group.add(m);
  }

  scene.add(group);
  return { colliders, occluders, group };
}

function ring(group, x, z, r, mat) {
  const geo = new THREE.RingGeometry(r - 0.25, r, 40);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: mat.color, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.03, z);
  group.add(m);
}

function post(group, x, z, label, mat) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.4, 8), mat);
  pole.position.set(x, 1.7, z);
  group.add(pole);
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 0.1),
    new THREE.MeshBasicMaterial({ color: mat.color }));
  top.position.set(x, 3.5, z);
  group.add(top);
  // The letter is drawn on a tiny canvas — the only text texture in the map.
  const c = document.createElement('canvas');
  c.width = 64; c.height = 48;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#14161a'; ctx.fillRect(0, 0, 64, 48);
  ctx.fillStyle = '#f0a830'; ctx.font = 'bold 36px monospace'; ctx.textAlign = 'center';
  ctx.fillText(label, 32, 38);
  const tex = new THREE.CanvasTexture(c);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.75),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  sign.position.set(x, 3.5, z + 0.06);
  group.add(sign);
}

// --- Collision: circle (player/bot) vs AABB list, axis separated. ---
export function collideCircle(colliders, p, r, height) {
  // p: {x, z} moved in place; y is the feet height, height the body height.
  for (const c of colliders) {
    if (c.top <= 0.05) continue;
    const nx = Math.max(c.minX, Math.min(p.x, c.maxX));
    const nz = Math.max(c.minZ, Math.min(p.z, c.maxZ));
    const dx = p.x - nx, dz = p.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r && d2 > 1e-9) {
      const d = Math.sqrt(d2);
      p.x = nx + (dx / d) * r;
      p.z = nz + (dz / d) * r;
    } else if (d2 <= 1e-9) {
      // Centre inside the box: push out along the smallest penetration axis.
      const pl = p.x - c.minX, pr = c.maxX - p.x, pt = p.z - c.minZ, pb = c.maxZ - p.z;
      const m = Math.min(pl, pr, pt, pb);
      if (m === pl) p.x = c.minX - r;
      else if (m === pr) p.x = c.maxX + r;
      else if (m === pt) p.z = c.minZ - r;
      else p.z = c.maxZ + r;
    }
  }
  p.x = Math.max(MAP.minX + r, Math.min(MAP.maxX - r, p.x));
  p.z = Math.max(MAP.minZ + r, Math.min(MAP.maxZ - r, p.z));
}

// Waypoints bots route through: lanes, site approaches and hold points.
export const WAYPOINTS = [
  { x: 0, z: 12 }, { x: -8, z: 8 }, { x: 8, z: 8 }, { x: 0, z: 4 },
  { x: -8, z: 0 }, { x: 8, z: 0 }, { x: 0, z: -7 }, { x: -8, z: -8 },
  { x: 8, z: -8 }, { x: -14, z: -4 }, { x: 14, z: -4 }, { x: -16, z: 0 },
  { x: 16, z: 0 }, { x: -4, z: -12 }, { x: 4, z: -12 }, { x: 0, z: -15 },
  { x: -12, z: 12 }, { x: 12, z: 12 }, { x: -14, z: 4 }, { x: 14, z: 4 },
];

export const HOLD_POINTS = {
  A: [{ x: -13, z: -6 }, { x: -13, z: 6 }, { x: -18, z: 0 }],
  B: [{ x: 13, z: -6 }, { x: 13, z: 6 }, { x: 18, z: 0 }],
  MID: [{ x: -3, z: -6 }, { x: 3, z: -6 }, { x: 0, z: -10 }],
};
