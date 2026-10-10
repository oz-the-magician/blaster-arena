// Lighting presets, sky gradient, fog and a sun whose shadow frustum follows the view.
// The shadow map covers only what the camera sees, so 2048 texels give sharp shadows.
import * as T from '../vendor/three.module.js';

// sun/hemi: direct light and flat ambient (kept low so models keep their form);
// envTop/envBottom + env: sky-to-ground image light that fills shadows with direction;
// bounce: warm sun light reflected back from the ground, opposite the sun, no shadows.
export const LIGHT_PRESETS = [
  { id: 'noon', name: 'Полдень',
    sun: 0xfff0d2, sunIntensity: 3.6, sunDir: [-0.42, 1, 0.3],
    sky: 0x8fb0d6, ground: 0x5b4532, hemi: 0.3,
    envTop: '#9cc0ea', envBottom: '#c89a66', env: 0.35, bounce: 0xffd9a8, bounceIntensity: 0.55,
    top: '#7fb6ec', horizon: '#c4def5', fog: 0xcfdeea, exposure: 0.92, shadow: 1, clouds: 0.38 }, // pastel blue day sky
  { id: 'sunset', name: 'Закат',
    sun: 0xffc49a, sunIntensity: 3.2, sunDir: [-1, 0.8, 0.42],
    sky: 0xa69cc4, ground: 0x7a5544, hemi: 0.35,
    envTop: '#b8a6c4', envBottom: '#d8946a', env: 0.6, bounce: 0xffb38a, bounceIntensity: 0.5,
    top: '#34416f', horizon: '#f3a368', fog: 0xc98f73, exposure: 1.05, shadow: 1 },
  { id: 'dusk', name: 'Сумерки',
    sun: 0xd4dcff, sunIntensity: 2.2, sunDir: [0.6, 0.85, -0.45],
    sky: 0x8a9ccc, ground: 0x5a4d63, hemi: 0.6,
    envTop: '#6f80c0', envBottom: '#5a4a66', env: 0.5, bounce: 0xb0a0d0, bounceIntensity: 0.5,
    top: '#151d36', horizon: '#56466e', fog: 0x3e3657, exposure: 1.25, shadow: 0.84 },
  // night (amphitheatre only): a cool moon that still lets you read the arena; torches add warm light
  { id: 'night', name: 'Ночь',
    sun: 0xa9bcff, sunIntensity: 1.5, sunDir: [0.35, 1, -0.5],
    sky: 0x4a5c92, ground: 0x2c2632, hemi: 1.0,
    envTop: '#34467e', envBottom: '#3a2e3a', env: 0.75, bounce: 0x8a6a8a, bounceIntensity: 0.35,
    top: '#070a18', horizon: '#1f1b38', fog: 0x16142a, exposure: 1.3, shadow: 0.6 },
  { id: 'overcast', name: 'Пасмурно',
    sun: 0xf3efe6, sunIntensity: 1.6, sunDir: [-0.2, 1, 0.15],
    sky: 0xc8d1db, ground: 0x6d665a, hemi: 0.6,
    envTop: '#d6dde6', envBottom: '#a39a8a', env: 0.55, bounce: 0xe8e2d6, bounceIntensity: 0.4,
    top: '#b3d0ea', horizon: '#e2ebf3', fog: 0xd7dee4, exposure: 0.95, shadow: 0.6, clouds: 0.14 }
];

// Dusk stays available via ?light=dusk but is not picked at random.
// Overcast is switched off for now (?light=overcast still works).
const RANDOM_PRESETS = LIGHT_PRESETS.filter(p => p.id !== 'dusk' && p.id !== 'night' && p.id !== 'overcast');

// Sky as an equirectangular panorama (top row = zenith, middle = horizon), so it turns with the camera.
// Day presets get a barely visible haze of clouds: soft white blobs (radial gradients, no canvas filter,
// which iPhone Safari lacks) a little above the horizon.
function skyTexture(top, horizon, clouds = 0, random = Math.random) {
  if (typeof document === 'undefined' || !document.createElement) return new T.Color(horizon);
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 512;
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return new T.Color(horizon);
  const gradient = ctx.createLinearGradient(0, 0, 0, 512);
  gradient.addColorStop(0, top);
  gradient.addColorStop(0.5, horizon);
  gradient.addColorStop(1, horizon);
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1024, 512);
  if (clouds > 0) {
    for (let i = 0; i < 46; i++) {
      const x = random() * 1024, y = 150 + random() * 92, w = 70 + random() * 170, h = 9 + random() * 20, // 4°–37° above the horizon
        a = clouds * (0.4 + random() * 0.6);
      for (const dx of [-1024, 0, 1024]) { // wrap around the seam
        ctx.save();
        ctx.translate(x + dx, y); ctx.scale(w, h);
        const blob = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        blob.addColorStop(0, `rgba(255,255,255,${a})`);
        blob.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = blob; ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }
  }
  const texture = new T.CanvasTexture(canvas);
  texture.mapping = T.EquirectangularReflectionMapping;
  texture.colorSpace = T.SRGBColorSpace;
  return texture;
}

// Prefiltered sky/ground gradient used as image-based light. Skipped without a real WebGL renderer.
function environmentMap(renderer, top, bottom) {
  if (!renderer?.getContext) return null;
  try {
    const envScene = new T.Scene(), geometry = new T.SphereGeometry(10, 32, 16);
    const a = new T.Color(top), b = new T.Color(bottom), colors = [], p = geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = T.MathUtils.smoothstep(p.getY(i) / 10, -0.35, 0.45);
      const c = b.clone().lerp(a, t); colors.push(c.r, c.g, c.b);
    }
    geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    envScene.add(new T.Mesh(geometry, new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide })));
    const pmrem = new T.PMREMGenerator(renderer), target = pmrem.fromScene(envScene, 0.04);
    pmrem.dispose(); geometry.dispose();
    return target.texture;
  } catch (e) { console.warn('environment light unavailable', e); return null; }
}

export function createLighting(scene, renderer, random = Math.random, presetId = null) {
  const preset = LIGHT_PRESETS.find(p => p.id === presetId) ||
    RANDOM_PRESETS[Math.floor(random() * RANDOM_PRESETS.length)];

  const hemi = new T.HemisphereLight(preset.sky, preset.ground, preset.hemi);
  scene.add(hemi);

  const sun = new T.DirectionalLight(preset.sun, preset.sunIntensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = preset.shadow < 0.65 ? 4 : 2;
  sun.shadow.intensity = preset.shadow;
  scene.add(sun, sun.target);

  const sunOffset = new T.Vector3(...preset.sunDir).normalize().multiplyScalar(120);

  const bounce = new T.DirectionalLight(preset.bounce, preset.bounceIntensity);
  bounce.position.set(-sunOffset.x, sunOffset.y * 0.25, -sunOffset.z);
  scene.add(bounce);
  scene.environment = environmentMap(renderer, preset.envTop, preset.envBottom);
  scene.environmentIntensity = preset.env;
  scene.background = skyTexture(preset.top, preset.horizon, preset.clouds || 0, random);
  scene.fog = new T.Fog(preset.fog, 140, 320);
  renderer.toneMappingExposure = preset.exposure;

  let extent = 0;
  const focus = new T.Vector3();
  function setExtent(value) {
    if (value === extent) return;
    extent = value;
    Object.assign(sun.shadow.camera, { left: -value, right: value, top: value, bottom: -value, near: 1, far: 300 });
    sun.shadow.camera.updateProjectionMatrix();
  }

  // Follow the view; snap to whole shadow texels so edges do not shimmer while moving.
  // Rear view sees the sides of stairs and walls, which the sun rarely lights: add fill there.
  const baseEnv = preset.env, baseHemi = preset.hemi, baseSun = preset.sunIntensity, baseBounce = preset.bounceIntensity,
    baseFog = scene.fog.color.clone(), black = new T.Color(0x020306);
  let dark = 0; // «Тьма» event: 0 = normal, 1 = pitch dark
  function setDarkness(v) {
    dark = Math.max(0, Math.min(1, v));
    const k = 1 - 0.88 * dark;
    sun.intensity = baseSun * k;
    bounce.intensity = baseBounce * k;
    scene.fog.color.copy(baseFog).lerp(black, dark);
    if ('backgroundIntensity' in scene) scene.backgroundIntensity = 1 - 0.872 * dark;
  }
  function follow(target, mode) {
    const rear = mode !== 'iso', k = 1 - 0.864 * dark;
    scene.environmentIntensity = baseEnv * (rear ? 1.6 : 1) * k;
    hemi.intensity = baseHemi * (rear ? 1.6 : 1) * k;
    setExtent(mode === 'iso' ? 34 : 60);
    const texel = (extent * 2) / sun.shadow.mapSize.x;
    focus.set(Math.round(target.x / texel) * texel, 0, Math.round(target.z / texel) * texel);
    sun.target.position.copy(focus);
    sun.position.copy(focus).add(sunOffset);
    sun.target.updateMatrixWorld();
  }
  setExtent(34);

  // Night sky: a dome of stars and a glowing moon in the moonlight's direction. The group follows the camera
  // (updateSky), sits inside the far plane, ignores fog, and bright stars/the moon go over 1 so the bloom catches them.
  let sky = null;
  if (preset.id === 'night') {
    sky = new T.Group();
    const count = 1800, positions = new Float32Array(count * 3), colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // uniform on the upper hemisphere, a bit denser towards the horizon band like a faint milky way
      const u = random(), v = random(), theta = u * Math.PI * 2, y = Math.pow(v, 1.6) * 0.98 + 0.02, r = Math.sqrt(1 - y * y);
      positions.set([Math.cos(theta) * r * 140, y * 140, Math.sin(theta) * r * 140], i * 3);
      const bright = random() < 0.08 ? 2.6 : 0.55 + random() * 0.8, tint = random();
      colors.set([bright * (tint < 0.2 ? 1 : 0.85), bright * 0.9, bright * (tint > 0.75 ? 1.15 : 1)], i * 3);
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
    const stars = new T.Points(geometry, new T.PointsMaterial({ size: 1.8, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false, toneMapped: true }));
    stars.frustumCulled = false;
    const moonDir = new T.Vector3(...preset.sunDir).normalize(),
      moon = new T.Mesh(new T.SphereGeometry(5, 24, 16), new T.MeshBasicMaterial({ color: new T.Color(0xdfe7ff).multiplyScalar(3), fog: false }));
    moon.position.copy(moonDir).multiplyScalar(130);
    const halo = new T.Mesh(new T.SphereGeometry(9, 24, 16), new T.MeshBasicMaterial({ color: 0x8fa6ff, transparent: true, opacity: 0.12, fog: false, depthWrite: false }));
    halo.position.copy(moon.position);
    sky.add(stars, moon, halo);
    sky.renderOrder = -1;
    scene.add(sky);
  }
  const updateSky = (camera) => sky && sky.position.copy(camera.position);
  return { preset, sun, hemi, bounce, follow, updateSky, setDarkness };
}
