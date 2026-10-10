// Pool of point lights for muzzle flashes and explosions.
// The pool size is fixed so the number of lights in the scene never changes
// (changing it forces three.js to recompile every material). Idle lights sit at intensity 0.
import * as T from '../vendor/three.module.js';

export function createFlashes(scene, count = 4) {
  const pool = Array.from({ length: count }, () => {
    const light = new T.PointLight(0xffffff, 0, 10, 2);
    light.castShadow = false;
    scene.add(light);
    return { light, peak: 0, time: 0, duration: 1 };
  });
  return {
    // Reuse an idle light, otherwise the one with the least remaining brightness.
    flash(position, color, intensity, distance, duration) {
      let slot = pool[0], best = Infinity;
      for (const s of pool) {
        const left = s.time > 0 ? s.peak * (s.time / s.duration) : 0;
        if (left < best) { best = left; slot = s; }
      }
      if (best > intensity) return; // every light is busy with something brighter
      slot.light.position.copy(position);
      slot.light.color.set(color);
      slot.light.distance = distance;
      slot.peak = intensity; slot.duration = duration; slot.time = duration;
      slot.light.intensity = intensity;
    },
    update(dt) {
      for (const s of pool) {
        if (s.time <= 0) continue;
        s.time = Math.max(0, s.time - dt);
        const t = s.time / s.duration;
        s.light.intensity = s.peak * t * t;
      }
    }
  };
}
