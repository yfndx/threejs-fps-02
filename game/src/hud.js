// EMBERLINE — the HUD: DOM readouts driven by the single game state.
// Writes are cached: a value is only pushed to the DOM when it changes, so
// the HUD costs nothing on frames where nothing moved.

import { GRENADES, WEAPONS } from './config.js';

let el = null;
let cache = {};
let bannerT = 0;
let hitT = 0;

export function bindHud() {
  const $ = (id) => document.getElementById(id);
  el = {
    crosshair: $('crosshair'), hitmarker: $('hitmarker'),
    hpFill: $('hp-fill'), hpNum: $('hp-num'), armorFill: $('armor-fill'),
    ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'), weaponName: $('weapon-name'),
    grenades: $('grenades'),
    timer: $('timer'), roundScore: $('round-score'),
    money: $('money'), kills: $('kills'),
    killfeed: $('killfeed'), banner: $('banner'), bannerSub: $('banner-sub'),
    plantWrap: $('plant-wrap'), plantFill: $('plant-fill'), plantLabel: $('plant-label'),
    hint: $('hint'), buyMenu: $('buy-menu'), buyRows: $('buy-rows'),
    overlay: $('overlay'), overlayTitle: $('overlay-title'), overlayCopy: $('overlay-copy'),
    matchOverlay: $('match-overlay'), matchTitle: $('match-title'), matchCopy: $('match-copy'),
  };
  cache = {};
}

function setText(node, key, value) {
  if (!node || cache[key] === value) return;
  cache[key] = value;
  node.textContent = value;
}

function setWidth(node, key, pct) {
  const v = `${Math.max(0, Math.min(100, Math.round(pct)))}%`;
  if (cache[key] === v) return;
  cache[key] = v;
  node.style.width = v;
}

export function showBanner(text, sub = '') {
  if (!el) return;
  el.banner.textContent = text;
  el.bannerSub.textContent = sub;
  el.banner.classList.add('show');
  el.bannerSub.classList.add('show');
  bannerT = 2.2;
}

export function flashHitmarker(head) {
  if (!el) return;
  el.hitmarker.classList.add('on');
  el.hitmarker.classList.toggle('head', !!head);
  hitT = 0.12;
}

export function updateHud(G, dt) {
  if (!el) return;
  const p = G.player;

  if (bannerT > 0) {
    bannerT -= dt;
    if (bannerT <= 0) {
      el.banner.classList.remove('show');
      el.bannerSub.classList.remove('show');
    }
  }
  if (hitT > 0) {
    hitT -= dt;
    if (hitT <= 0) el.hitmarker.classList.remove('on');
  }

  // Crosshair spread follows the bloom.
  const gap = 6 + p.spread * 260 + (p.sprint ? 4 : 0);
  el.crosshair.style.setProperty('--gap', `${gap.toFixed(1)}px`);

  setWidth(el.hpFill, 'hp', p.health);
  setText(el.hpNum, 'hpnum', `${Math.ceil(p.health)}`);
  setWidth(el.armorFill, 'armor', p.armor);
  el.armorFill.parentElement.style.opacity = p.armor > 0 ? '1' : '0.25';

  const w = WEAPONS[p.current];
  const ammo = p.weapons[p.current];
  setText(el.weaponName, 'wname', w.name);
  setText(el.ammoMag, 'mag', ammo ? String(ammo.mag) : '—');
  setText(el.ammoReserve, 'res', ammo ? `/ ${ammo.reserve}` : '');
  el.ammoMag.parentElement.classList.toggle('empty', !!ammo && ammo.mag === 0);
  setText(el.grenades, 'nades',
    `G FRAG ×${p.grenades.frag}   F SMOKE ×${p.grenades.smoke}`);

  const t = Math.max(0, Math.ceil(G.roundTime));
  setText(el.timer, 'timer', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
  setText(el.roundScore, 'score', `EMBER ${G.score.ember} — ${G.score.ash} ASH · ROUND ${G.round}/5`);
  setText(el.money, 'money', `$${G.money}`);
  setText(el.kills, 'kills', `${G.kills} ELIMS`);

  // Killfeed: newest first, fade entries older than 4 s.
  let feed = '';
  const now = G.time;
  for (const k of G.killfeed) {
    if (now - k.t < 4) feed += `<div>${k.text}</div>`;
  }
  if (cache.feed !== feed) { cache.feed = feed; el.killfeed.innerHTML = feed; }

  // Plant / defuse progress.
  const c = G.charge;
  if (c.state === 'planting' || c.state === 'planted' || c.state === 'defusing') {
    el.plantWrap.classList.remove('hidden');
    if (c.state === 'planting') {
      setText(el.plantLabel, 'plabel', 'PLANTING CHARGE…');
      setWidth(el.plantFill, 'pfill', c.plantProgress * 100);
    } else if (c.state === 'planted') {
      setText(el.plantLabel, 'plabel', `CHARGE LIVE · ${Math.ceil(c.timer)}s — DEFEND IT`);
      setWidth(el.plantFill, 'pfill', (c.timer / 35) * 100);
    } else {
      setText(el.plantLabel, 'plabel', `${c.defuser || 'ASH'} IS DEFUSING…`);
      setWidth(el.plantFill, 'pfill', c.defuseProgress * 100);
    }
  } else {
    el.plantWrap.classList.add('hidden');
  }

  // Contextual hint line.
  let hint = '';
  if (G.phase === 'buy') hint = 'BUY PHASE — press B for the shop, or ENTER to start the round';
  else if (G.phase === 'round' && c.state === 'idle') {
    const near = nearestSite(G);
    if (near) hint = `Press E to plant the charge at site ${near}`;
    else hint = 'Reach site A or B and press E to plant';
  }
  setText(el.hint, 'hint', hint);
}

function nearestSite(G) {
  const p = G.player;
  for (const [id, s] of Object.entries({ A: { x: -16, z: 0 }, B: { x: 16, z: 0 } })) {
    if (Math.hypot(p.pos.x - s.x, p.pos.z - s.z) < 3.4) return id;
  }
  return null;
}

// --- Buy menu ---
export function renderBuyMenu(G) {
  if (!el) return;
  let html = '';
  for (const def of Object.values(WEAPONS)) {
    const owned = !!G.player.weapons[def.id];
    const afford = G.money >= def.price;
    const cls = owned ? 'owned' : afford ? '' : 'cant';
    const tag = owned ? 'OWNED' : `$${def.price}`;
    html += `<div class="buy-row ${cls}" data-buy="${def.id}">
      <span class="buy-name">${def.name}</span>
      <span class="buy-stat">${def.damage} DMG · ${def.mag} MAG</span>
      <span class="buy-price">${tag}</span></div>`;
  }
  html += `<div class="buy-row ${G.player.armor >= 50 ? 'owned' : G.money >= 600 ? '' : 'cant'}" data-buy="armor">
    <span class="buy-name">KEVLAR VEST</span><span class="buy-stat">+50 ARMOR</span>
    <span class="buy-price">${G.player.armor >= 50 ? 'OWNED' : '$600'}</span></div>`;
  for (const g of Object.values(GRENADES)) {
    const n = G.player.grenades[g.id];
    html += `<div class="buy-row ${G.money >= g.price ? '' : 'cant'}" data-buy="nade:${g.id}">
      <span class="buy-name">${g.name}</span><span class="buy-stat">OWNED ×${n}</span>
      <span class="buy-price">$${g.price}</span></div>`;
  }
  el.buyRows.innerHTML = html;
  el.buyRows.querySelectorAll('[data-buy]').forEach((row) => {
    row.addEventListener('click', () => {
      const id = row.getAttribute('data-buy');
      window.dispatchEvent(new CustomEvent('ember-buy', { detail: id }));
    });
  });
}

export function setBuyMenu(open) {
  if (!el) return;
  el.buyMenu.classList.toggle('hidden', !open);
}

export function setOverlay(show, title, copy) {
  if (!el) return;
  el.overlay.classList.toggle('hidden', !show);
  if (title) el.overlayTitle.textContent = title;
  if (copy) el.overlayCopy.textContent = copy;
}

export function setMatchOverlay(show, title, copy) {
  if (!el) return;
  el.matchOverlay.classList.toggle('hidden', !show);
  if (title) el.matchTitle.textContent = title;
  if (copy) el.matchCopy.textContent = copy;
}
