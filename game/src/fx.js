// EMBERLINE — effects: tracers, muzzle flash, impacts, explosions, smoke.
// Pooled objects only: no allocation in the hot loops. Every effect is a
// pre-made mesh whose transform and visibility are recycled.

import * as THREE from 'three';

const TRACER_N = 10;
const SPARK_N = 6;

export function createFx(scene, camera) {
  // Tracers: thin additive boxes from muzzle to hit point, fading fast.
  // A 1px line is invisible at screenshot resolution; a 3cm box reads.
  const tracers = [];
  const tracerGeo = new THREE.BoxGeometry(0.03, 0.03, 1);
  for (let i = 0; i < TRACER_N; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffd27a, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(tracerGeo, mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    tracers.push({ mesh, ttl: 0 });
  }
  // Impact sparks: one Points cloud per burst slot, positions rewritten in place.
  const sparks = [];
  for (let i = 0; i < SPARK_N; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 3), 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xffc46b, size: 0.09, transparent: true, opacity: 0, depthWrite: false,
    }));
    pts.visible = false;
    pts.frustumCulled = false;
    scene.add(pts);
    sparks.push({ pts, ttl: 0, vel: new Float32Array(8 * 3) });
  }
  // Muzzle flash: a small additive plane at the gun tip, parented to the
  // camera so it sits by the viewmodel — never on the aim ray, where it
  // would cover whatever the player is aiming at.
  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xffd27a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), flashMat);
  flash.position.set(0.28, -0.2, -0.9);
  flash.visible = false;
  if (camera) camera.add(flash); else scene.add(flash);
  // Smoke: sprite puffs, pooled.
  const smokeTex = makeSmokeTexture();
  const smokes = [];
  for (let i = 0; i < 14; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: smokeTex, color: 0x9aa0a6, transparent: true, opacity: 0, depthWrite: false,
    }));
    s.visible = false;
    scene.add(s);
    smokes.push({ s, ttl: 0, max: 1 });
  }
  // Explosion flash: one expanding sphere, reused.
  const boom = new THREE.Mesh(
    new THREE.SphereGeometry(1, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0, depthWrite: false }),
  );
  boom.visible = false;
  scene.add(boom);

  let ti = 0, si = 0, smi = 0;
  return {
    tracer(origin, dir, dist) {
      // Start the tracer ahead of the muzzle, not at the eye: a box that
      // begins at the camera flares across the whole frame at the near plane.
      // 2.5 m out keeps the near face to a few pixels; 3 cm reads as a streak.
      const start = 2.5;
      const len = Math.max(0.1, dist - start);
      const t = tracers[ti]; ti = (ti + 1) % TRACER_N;
      t.mesh.position.set(
        origin.x + dir.x * (start + len / 2),
        origin.y + dir.y * (start + len / 2),
        origin.z + dir.z * (start + len / 2),
      );
      t.mesh.scale.set(1, 1, len);
      t.mesh.lookAt(origin.x + dir.x * dist, origin.y + dir.y * dist, origin.z + dir.z * dist);
      t.mesh.material.opacity = 0.9;
      t.mesh.visible = true;
      t.ttl = 0.07;
    },
    muzzle() {
      // The flash is parented to the camera at the gun tip; firing only
      // lights it for a frame. Origin/dir are kept for callers that pass them.
      flash.material.opacity = 0.95;
      flash.visible = true;
      flash.userData.ttl = 0.045;
    },
    impact(point) {
      const s = sparks[si]; si = (si + 1) % SPARK_N;
      const pos = s.pts.geometry.attributes.position.array;
      for (let i = 0; i < 8; i++) {
        pos[i * 3] = point.x; pos[i * 3 + 1] = point.y; pos[i * 3 + 2] = point.z;
        s.vel[i * 3] = (Math.random() - 0.5) * 3;
        s.vel[i * 3 + 1] = Math.random() * 2.5;
        s.vel[i * 3 + 2] = (Math.random() - 0.5) * 3;
      }
      s.pts.geometry.attributes.position.needsUpdate = true;
      s.pts.material.opacity = 1;
      s.pts.visible = true;
      s.ttl = 0.35;
    },
    explosion(pos) {
      boom.position.set(pos.x, 1.2, pos.z);
      boom.scale.setScalar(0.5);
      boom.material.opacity = 0.9;
      boom.visible = true;
      boom.userData.ttl = 0.5;
      this.impact(pos);
    },
    smoke(pos) {
      for (let i = 0; i < 6; i++) {
        const s = smokes[smi]; smi = (smi + 1) % smokes.length;
        s.s.position.set(pos.x + (Math.random() - 0.5) * 3, 1 + Math.random() * 1.6, pos.z + (Math.random() - 0.5) * 3);
        s.s.scale.setScalar(2 + Math.random() * 1.5);
        s.s.material.opacity = 0.55;
        s.s.visible = true;
        s.ttl = 11; s.max = 11;
      }
    },
    botDeath(bot) {
      this.impact(new THREE.Vector3(bot.pos.x, 1.2, bot.pos.z));
    },
    step(dt) {
      for (const t of tracers) {
        if (t.ttl > 0) {
          t.ttl -= dt;
          t.mesh.material.opacity = Math.max(0, t.ttl / 0.07) * 0.9;
          if (t.ttl <= 0) t.mesh.visible = false;
        }
      }
      for (const s of sparks) {
        if (s.ttl > 0) {
          s.ttl -= dt;
          const pos = s.pts.geometry.attributes.position.array;
          for (let i = 0; i < 8; i++) {
            pos[i * 3] += s.vel[i * 3] * dt;
            pos[i * 3 + 1] += s.vel[i * 3 + 1] * dt;
            pos[i * 3 + 2] += s.vel[i * 3 + 2] * dt;
            s.vel[i * 3 + 1] -= 6 * dt;
          }
          s.pts.geometry.attributes.position.needsUpdate = true;
          s.pts.material.opacity = Math.max(0, s.ttl / 0.35);
          if (s.ttl <= 0) s.pts.visible = false;
        }
      }
      if (flash.visible) {
        flash.userData.ttl -= dt;
        flash.material.opacity = Math.max(0, flash.userData.ttl / 0.045) * 0.95;
        if (flash.userData.ttl <= 0) flash.visible = false;
      }
      if (boom.visible) {
        boom.userData.ttl -= dt;
        const k = 1 - boom.userData.ttl / 0.5;
        boom.scale.setScalar(0.5 + k * 5);
        boom.material.opacity = Math.max(0, boom.userData.ttl / 0.5) * 0.9;
        if (boom.userData.ttl <= 0) boom.visible = false;
      }
      for (const s of smokes) {
        if (s.ttl > 0) {
          s.ttl -= dt;
          s.s.material.opacity = Math.max(0, Math.min(0.55, s.ttl / 2)) * (s.ttl > s.max - 1 ? (s.max - s.ttl) : 1);
          s.s.scale.x += dt * 0.25;
          s.s.scale.y += dt * 0.25;
          if (s.ttl <= 0) s.s.visible = false;
        }
      }
    },
  };
}

function makeSmokeTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
