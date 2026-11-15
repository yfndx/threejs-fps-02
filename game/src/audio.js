// EMBERLINE — sound, all synthesized with WebAudio. No audio files, no network.
// A shared noise buffer and a master gain; every effect is a few nodes that
// are created, played and garbage-collected outside the simulation step.

export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
      const len = ctx.sampleRate * 0.5;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    } catch {
      ctx = null;
    }
    return !!ctx;
  }

  function noise(dur, filterFreq, gain, type = 'lowpass', when = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur + 0.05);
  }

  function tone(freq, dur, gain, type = 'sine', slideTo = null, when = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // Distance-attenuated gain: 1 up close, ~0.15 at 40 m.
  function att(playerPos, pos) {
    if (!pos || !playerPos) return 1;
    const d = Math.hypot(pos.x - playerPos.x, pos.z - playerPos.z);
    return Math.max(0.12, 1 - d / 48);
  }

  return {
    unlock() { ensure(); },
    shot(kind, pos) {
      const a = att(pos, pos); // own shots are full volume; position is the player's
      void a;
      if (kind === 'shotgun') { noise(0.22, 900, 0.9); tone(90, 0.18, 0.5, 'sine', 45); }
      else if (kind === 'dmr') { noise(0.3, 1400, 0.9); tone(70, 0.25, 0.6, 'sine', 40); }
      else if (kind === 'pistol') { noise(0.12, 1800, 0.7); tone(160, 0.08, 0.4, 'square', 90); }
      else if (kind === 'smg') { noise(0.09, 2200, 0.6); tone(200, 0.06, 0.35, 'square', 120); }
      else { noise(0.14, 1600, 0.75); tone(120, 0.1, 0.45, 'square', 70); }
    },
    enemyShot(from, playerPos) {
      const v = att(playerPos, from);
      noise(0.14, 1100, 0.5 * v);
      tone(110, 0.09, 0.3 * v, 'square', 70);
    },
    dryFire() { tone(1200, 0.04, 0.25, 'square'); },
    reload() { tone(900, 0.05, 0.3, 'square'); tone(700, 0.05, 0.3, 'square', null, 0.18); },
    hit(head) {
      tone(head ? 2400 : 1800, 0.05, 0.35, 'sine');
    },
    kill() { tone(880, 0.07, 0.4, 'sine'); tone(1320, 0.1, 0.4, 'sine', null, 0.07); },
    step() { noise(0.05, 500, 0.12); },
    explosion(pos, playerPos) {
      const v = att(playerPos, pos);
      noise(0.9, 300, 1.0 * v);
      tone(55, 0.8, 0.8 * v, 'sine', 28);
    },
    plantBeep() { tone(1500, 0.09, 0.4, 'sine'); },
    defuseBeep() { tone(1100, 0.09, 0.35, 'sine'); },
    roundWin() {
      tone(523, 0.12, 0.4); tone(659, 0.12, 0.4, 'sine', null, 0.12); tone(784, 0.22, 0.45, 'sine', null, 0.24);
    },
    roundLose() {
      tone(392, 0.16, 0.4); tone(311, 0.16, 0.4, 'sine', null, 0.16); tone(233, 0.3, 0.45, 'sine', null, 0.32);
    },
    buy() { tone(1200, 0.05, 0.3, 'sine'); tone(1600, 0.06, 0.3, 'sine', null, 0.05); },
    click() { tone(1000, 0.03, 0.25, 'square'); },
    playerDown() { tone(220, 0.5, 0.5, 'sawtooth', 55); },
  };
}
