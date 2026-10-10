// Sound effects with space: every sound can come from a point in the world. The listener is the player
// (not the camera), left/right follows the screen, and loudness and brightness fall with distance.
// Voices are limited per group so a fire fight never turns into a wall of noise: when a group is full,
// a new far sound is dropped and a new near sound replaces the farthest one. Explosions duck the rest.
const SFX = [
  "rifle-impulse", "rifle-spark", "rifle-arrow", "rifle-storm",
  "smg-spectre-loop", "smg-vector-loop", "smg-wasp-loop", "smg-phantom-loop", "smg-single",
  "shotgun", "shotgun-double", "laser-storm", "laser-pulse", "rocket", "rocket-blast", "blade-loop",
  "reload-a", "reload-b", "reload-c", "reload-d", "reload-shotgun-8",
  "hit", "empty", "jump-pad", "steps-loop",
];
// background tracks: only the one an arena uses is decoded (a decoded 2-minute track takes ~40 MB)
export const MUSIC_TRACKS = ["music-drive", "music-funk"];
const LIMITS = { player: 8, enemy: 4, impact: 5, loop: 6 };
const NEAR = 6, FAR = 75; // metres: full volume within NEAR, silent beyond FAR

export function createAudio() {
  let ctx = null, master = null, duckGain = null, musicGain = null, musicOn = false, musicLevel = 0.85, musicTimer = null, musicTrack = "music-drive", fxGain = null, volumes = { music: 0.7, fx: 0.8 };
  let timeScale = 1;
  const buffers = new Map(), voices = [], listener = { x: 0, y: 0, z: 0, rx: 1, rz: 0 };

  async function bytes(path) {
    const embedded = typeof window !== "undefined" && window.__ASSETS?.[path];
    if (embedded) {
      const s = atob(embedded.slice(embedded.indexOf(",") + 1)), out = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
      return out.buffer;
    }
    return (await fetch("./" + path)).arrayBuffer();
  }
  // created on the first user gesture (browsers keep audio locked until then)
  function unlock() {
    if (ctx || typeof window === "undefined" || !(window.AudioContext || window.webkitAudioContext)) return ctx;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.62;
      duckGain = ctx.createGain();
      // a bus compressor evens out the mix: many shots at once get squeezed instead of piling up
      const glue = ctx.createDynamicsCompressor();
      glue.threshold.value = -20;
      glue.knee.value = 12;
      glue.ratio.value = 4;
      glue.attack.value = 0.004;
      glue.release.value = 0.18;
      // player volume for effects (menu slider) sits before the bus compressor
      fxGain = ctx.createGain();
      fxGain.gain.value = volumes.fx / 0.8;
      duckGain.connect(fxGain).connect(glue).connect(master);
      master.connect(ctx.destination);
      // music bypasses the effects compressor (gunfire must not pump it) but follows the master volume
      musicGain = ctx.createGain();
      musicGain.gain.value = 0;
      musicGain.connect(master);
      if (typeof ctx.decodeAudioData !== "function") throw new Error("no decoder");
      resume();
    } catch {
      ctx = null; // no usable Web Audio (tests, very old browsers): the game keeps its synth beeps
      return null;
    }
    for (const name of SFX)
      bytes("assets/sfx/" + name + ".mp3")
        .then((data) => ctx.decodeAudioData(data))
        .then((buffer) => buffers.set(name, buffer))
        .catch(() => {});
    return ctx;
  }
  const shape = (pos) => {
    if (!pos) return { gain: 1, pan: 0, cutoff: 20000, distance: 0 };
    const dx = pos.x - listener.x, dz = pos.z - listener.z, dy = (pos.y ?? 0) - listener.y,
      distance = Math.hypot(dx, dy, dz),
      t = Math.min(1, Math.max(0, (distance - NEAR) / (FAR - NEAR))),
      pan = distance > 0.5 ? Math.max(-0.85, Math.min(0.85, (dx * listener.rx + dz * listener.rz) / distance)) : 0;
    return { gain: (1 - t) * (1 - t), pan, cutoff: 20000 * Math.pow(0.07, t), distance };
  };

  function play(name, { position = null, volume = 1, rate = 1, jitter = 0.04, group = "player", loop = false } = {}) {
    if (!ctx || ctx.state === "closed") return null;
    const buffer = buffers.get(name);
    if (!buffer) return null;
    const s = shape(position);
    if (s.gain * volume < 0.02 && !loop) return null; // too far to matter
    const mine = voices.filter((v) => v.group === group);
    if (mine.length >= (LIMITS[group] || 6)) {
      const farthest = mine.reduce((a, b) => (a.distance > b.distance ? a : b));
      if (farthest.distance <= s.distance && !loop) return null;
      farthest.stop();
    }
    const source = ctx.createBufferSource(),
      gain = ctx.createGain(),
      filter = ctx.createBiquadFilter(),
      panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    source.buffer = buffer;
    source.loop = loop;
    source.playbackRate.value = rate * timeScale * (1 + (Math.random() * 2 - 1) * jitter);
    filter.type = "lowpass";
    filter.frequency.value = s.cutoff;
    gain.gain.value = volume * s.gain;
    source.connect(filter).connect(gain);
    if (panner) {
      panner.pan.value = s.pan;
      gain.connect(panner).connect(duckGain);
    } else gain.connect(duckGain);
    const voice = {
      group, distance: s.distance, position, volume, source, gain, filter, panner,
      stop(fade = 0.05) {
        const i = voices.indexOf(voice);
        if (i >= 0) voices.splice(i, 1);
        try {
          gain.gain.setTargetAtTime(0, ctx.currentTime, fade / 3);
          source.stop(ctx.currentTime + fade);
        } catch {}
      },
      setRate(r) { source.playbackRate.value = r; },
    };
    source.onended = () => {
      const i = voices.indexOf(voice);
      if (i >= 0) voices.splice(i, 1);
    };
    voices.push(voice);
    source.start();
    return voice;
  }
  // listener follows the player; `right` is the screen's right direction on the ground
  function setListener(pos, right) {
    listener.x = pos.x; listener.y = pos.y; listener.z = pos.z;
    listener.rx = right.x; listener.rz = right.z;
    for (const v of voices) {
      if (!v.position) continue;
      const s = shape(v.position);
      v.distance = s.distance;
      v.gain.gain.value = v.volume * s.gain;
      v.filter.frequency.value = s.cutoff;
      if (v.panner) v.panner.pan.value = s.pan;
    }
  }
  // briefly lower everything else (explosions)
  function duck(amount = 0.45, time = 0.35) {
    if (!ctx) return;
    const g = duckGain.gain, now = ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(1 - amount, now + 0.03);
    g.linearRampToValueAtTime(1, now + time);
  }
  // a looping sound that is switched on and off every frame (SMG bursts, the blade hum, footsteps)
  function loop(name, opts) {
    let voice = null, current = name;
    return {
      set(on, { rate, volume, sound } = {}) {
        if (sound && sound !== current) {
          voice?.stop(0.04);
          voice = null;
          current = sound;
        }
        if (on && !voice) voice = play(current, { ...opts, loop: true, jitter: 0, volume: volume ?? opts?.volume ?? 1 });
        if (!on && voice) {
          voice.stop(0.06);
          voice = null;
        }
        if (voice && rate) voice.setRate(rate);
      },
    };
  }
  // Background music: the track loops with a 1.5 s crossfade between repeats (scheduled a bit ahead).
  const XFADE = 1.5;
  function scheduleMusic(at, first) {
    const buffer = buffers.get(musicTrack);
    if (!musicOn || !buffer) return;
    const src = ctx.createBufferSource(), g = ctx.createGain(), end = at + buffer.duration;
    src.buffer = buffer;
    g.gain.setValueAtTime(first ? 1 : 0, at);
    if (!first) g.gain.linearRampToValueAtTime(1, at + XFADE);
    g.gain.setValueAtTime(1, end - XFADE);
    g.gain.linearRampToValueAtTime(0, end);
    src.connect(g).connect(musicGain);
    src.start(at);
    music.sources.push(src);
    const next = end - XFADE;
    musicTimer = setTimeout(() => scheduleMusic(next, false), Math.max(0, (next - ctx.currentTime - 2) * 1000));
  }
  const music = { sources: [] };
  function setMusic(on, level = musicLevel, track = musicTrack) {
    if (!ctx) return;
    musicLevel = level;
    if (track !== musicTrack) {
      if (musicOn) setMusic(false);
      musicTrack = track;
    }
    if (on && !buffers.has(musicTrack))
      bytes("assets/sfx/" + musicTrack + ".mp3")
        .then((data) => ctx.decodeAudioData(data))
        .then((buffer) => buffers.set(musicTrack, buffer))
        .catch(() => {});
    const now = ctx.currentTime, g = musicGain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(on ? level * (volumes.music / 0.7) : 0, now + (on ? 1.2 : 0.8));
    if (on && !musicOn) {
      musicOn = true;
      const start = () => (!musicOn ? null : buffers.get(musicTrack) ? scheduleMusic(ctx.currentTime + 0.05, true) : setTimeout(start, 300));
      start();
    }
    if (!on && musicOn) {
      musicOn = false;
      clearTimeout(musicTimer);
      const old = music.sources.splice(0);
      setTimeout(() => old.forEach((src) => { try { src.stop(); } catch {} }), 900);
    }
  }
  // menu sliders, 0..1 each; 0.7 music / 0.8 effects are the tuned defaults (= unchanged mix)
  // set a gain smoothly without leaving stacked automation behind (iOS Safari could get stuck on silence)
  function glide(param, value) {
    const now = ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(value, now + 0.06);
  }
  function setVolumes({ music = volumes.music, fx = volumes.fx } = {}) {
    volumes.music = music;
    volumes.fx = fx;
    if (!ctx) return;
    resume();
    glide(fxGain.gain, fx / 0.8);
    if (musicOn) glide(musicGain.gain, musicLevel * (music / 0.7));
  }
  // iOS suspends or "interrupts" the context (slider drags, calls, app switch, lock screen):
  // wake it up again on any user gesture
  function resume() {
    if (!ctx || ctx.state === "closed") return;
    if (ctx.state !== "running") ctx.resume?.().catch(() => {});
    // WebKit (all iPhone browsers) unlocks output only when a sound actually starts inside the gesture:
    // play one silent sample
    if (!resume.primed || ctx.state !== "running") {
      try {
        const src = ctx.createBufferSource();
        src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        src.connect(ctx.destination);
        src.start(0);
        resume.primed = ctx.state === "running";
      } catch {}
    }
  }
  // slow motion: every new sound plays slower and lower
  function setTimeScale(k) { timeScale = k; }
  return { unlock, resume, setTimeScale, play, setListener, duck, loop, setMusic, setVolumes, get ready() { return !!ctx && buffers.size > 0; }, get loaded() { return buffers.size; }, names: SFX };
}
