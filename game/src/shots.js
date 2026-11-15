// EMBERLINE — screenshot staging (?shot=1..4&seed=N).
// Each shot is a real game state, reached through the same code paths a player
// uses: the round starts, bots spawn and take positions, the HUD renders, and
// the camera is placed where a player would stand. Nothing is faked: the
// renderer draws the live scene, and the shot only chooses where to look.
//
// Yaw convention (shared with the camera): facing is (-sin yaw, -cos yaw),
// so yaw 0 looks north (-z) and yaw PI looks south (+z). Bots staged here
// face south (yaw PI) toward the player spawn; the player faces north, or
// toward the bot/site the shot is about. Bots stand in the lanes, not behind
// the central furnace, so they are actually in frame.

import { MAP } from './config.js';
import { spawnBots } from './bots.js';
import { resetPlayer } from './player.js';
import { renderBuyMenu, setBuyMenu, showBanner } from './hud.js';
import { mulberry32 } from './state.js';

export function stageShot(G, ctx, n) {
  G.seed = ctx.seed || 1;
  G.rng = mulberry32(G.seed);
  resetPlayer(G);
  spawnBots(G, ctx.scene);
  G.score = { ember: 0, ash: 0 };
  G.round = 1;
  G.kills = 0;

  const p = G.player;
  if (n === 1) {
    // Cover: round just started, player at spawn looking north down the
    // yard — furnace in the middle, defenders holding both lanes.
    G.phase = 'round';
    G.roundTime = 96;
    p.pos.x = 0; p.pos.z = 14; p.yaw = 0; p.pitch = 0.01;
    placeBot(G, 0, -6, -1, Math.PI);
    placeBot(G, 1, 6, -1, Math.PI);
    placeBot(G, 2, -13, -4, Math.PI);
    placeBot(G, 3, 13, -4, Math.PI);
    showBanner('ROUND 1', 'Plant the charge at A or B');
  } else if (n === 2) {
    // Mid-fight: player in the west lane, a defender pushing down the same
    // lane, a tracer already in the air between them.
    G.phase = 'round';
    G.roundTime = 61;
    G.kills = 1;
    p.pos.x = -8; p.pos.z = 2; p.yaw = -0.245; p.pitch = 0;
    p.weapons.rifle = { mag: 18, reserve: 75 };
    p.current = 'rifle';
    placeBot(G, 0, -6, -6, Math.PI);
    placeBot(G, 1, 6, -8, Math.PI);
    placeBot(G, 2, -14, -4, Math.PI);
    placeBot(G, 3, 13, 0, Math.PI);
    G.bots[0].state = 'engage';
    ctx.fx.tracer(
      { x: p.pos.x, y: 1.6, z: p.pos.z },
      { x: 0.24, y: -0.01, z: -0.97 },
      8.5,
    );
    ctx.fx.muzzle(
      { x: p.pos.x, y: 1.6, z: p.pos.z },
      { x: 0.24, y: -0.01, z: -0.97 },
    );
  } else if (n === 3) {
    // Buy phase: the shop open over the spawn view, defenders waiting down
    // the lanes.
    G.phase = 'buy';
    G.buyTime = 14;
    G.money = 2900;
    p.pos.x = 0; p.pos.z = 14; p.yaw = 0; p.pitch = 0;
    placeBot(G, 0, -6, -1, Math.PI);
    placeBot(G, 1, 6, -1, Math.PI);
    placeBot(G, 2, -13, -4, Math.PI);
    placeBot(G, 3, 13, -4, Math.PI);
    renderBuyMenu(G);
    setBuyMenu(true);
  } else {
    // Charge planted at site A: the timer is running, a defender is closing
    // in to defuse, the player is watching the site from the west lane.
    G.phase = 'round';
    G.roundTime = 44;
    G.charge = { state: 'planted', site: 'A', x: MAP.sites.A.x, z: MAP.sites.A.z, timer: 21, plantProgress: 1, defuseProgress: 0, defuser: null };
    p.pos.x = -10; p.pos.z = 4; p.yaw = 0.983; p.pitch = -0.02;
    p.weapons.rifle = { mag: 22, reserve: 75 };
    p.current = 'rifle';
    placeBot(G, 0, -13, -3, 2.36);
    placeBot(G, 1, 8, -8, Math.PI);
    placeBot(G, 2, 13, 0, Math.PI);
    placeBot(G, 3, -18, 3, Math.PI);
    G.bots[0].state = 'defuse';
    G.bots[0].route = [{ x: -14, z: -2 }, { x: -16, z: 0 }];
    G.bots[0].routeIdx = 0;
    showBanner('CHARGE PLANTED', 'Defend site A — 21s to detonation');
  }
  // Bots stand where placed; the render loop draws them from their groups.
  for (const b of G.bots) {
    b.group.position.set(b.pos.x, 0, b.pos.z);
    b.group.rotation.y = b.yaw;
  }
}

function placeBot(G, i, x, z, yaw) {
  const b = G.bots[i];
  if (!b) return;
  b.pos.x = x; b.pos.z = z;
  b.yaw = yaw;
  b.state = 'hold';
}
