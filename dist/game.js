import { seededRandom } from "./generator/world.js";
import { makeRank, KIND_CLASS, CLASS_NAMES } from "./ranks.js";
import { generateArena, ARENA_TYPES } from "./generator/arenas.js";
import { BIOMES } from "./generator/biomes.js";
import { exportMap, planFromMap, validateMap } from "./generator/custom-map.js";
import { LayeredNavigation } from "./engine/navigation.js";
import { padImpulse, padContact, PAD_TIERS, applyPadTier } from "./engine/jump-pad.js";
import { CLUSTERS, clusterKeys } from "./generator/clusters.js";
import { decorate, fillKeys } from "./generator/decorate.js";
import { paintGround, groundUVs } from "./engine/ground-paint.js";
import { createRelief } from "./engine/relief.js";
import { zoneInstances, zoneLayout } from "./zone-templates.js";
import { buildExpansion } from "./expansion.js";
import { expansionAssets } from "./expansion-assets.js";
import { groundOpenings, groundVertices, intersectsOpening } from "./engine/ground.js";
import { buildFortress } from "./fortress.js";
import {
  platforms,
  ramps,
  skyPlatforms,
  jumpPads,
  pit,
  ARENA_LIMIT,
  extraMedkits,
  coreRoutes,
  initializeGeneratedLevel,
  generatedPlan,
} from "./level.js";
import { SpatialIndex } from "./engine/spatial.js";
import { createLighting } from "./engine/lighting.js";
import { createPost, QUALITIES, QUALITY_NAMES } from "./engine/post.js";
import { createFlashes } from "./engine/flashes.js";
import { createAudio, MUSIC_TRACKS } from "./engine/audio.js";
import { isTouchDevice, createTouchControls, preferLandscape, uiImage } from "./engine/touch.js";
import { weapons, SPEED_SCALE } from "./weapons.js";
import * as T from "three";
import { GLTFLoader } from "./vendor/GLTFLoader.js";
import { clone } from "./vendor/SkeletonUtils.js";
const arenaParameters = typeof location !== "undefined" ? new URLSearchParams(location.search) : null;
// ?map=custom: the arena comes from a loaded map JSON (stored in localStorage by «Загрузить карту»)
let customMapError = null;
const customMap = (() => {
  if (arenaParameters?.get("map") !== "custom") return null;
  try {
    const json = JSON.parse(localStorage.getItem("blaster-map") || "null"),
      errors = validateMap(json);
    if (errors.length) throw new Error(errors.join("; "));
    return planFromMap(json);
  } catch (e) {
    customMapError = String(e.message || e);
    return null;
  }
})();
if (arenaParameters && arenaParameters.get("arena") !== "classic")
  initializeGeneratedLevel(
    customMap ||
      generateArena(
        arenaParameters.get("seed") || Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
        arenaParameters.get("type"),
        arenaParameters.get("biome"),
      ),
  );
const domCache = new Map();
const $ = (id) => {
    if (!domCache.has(id)) domCache.set(id, document.getElementById(id));
    return domCache.get(id);
  },
  canvas = $("game");

const renderer = new T.WebGLRenderer({ canvas, antialias: true });
// phones: fewer pixels (dpr up to 3 on phones), the biggest single saving on mobile GPUs
const MOBILE = isTouchDevice();
// Phones use an adaptive render resolution: start sharp (up to 2× or the screen's own density) and step
// down by 0.25 when frames get slow, back up when there is headroom (see adaptResolution); desktop 1.6.
const MOBILE_MAX_RATIO = Math.min(devicePixelRatio, 2),
  MOBILE_MIN_RATIO = Math.min(devicePixelRatio, 1.25);
renderer.setPixelRatio(MOBILE ? MOBILE_MAX_RATIO : Math.min(devicePixelRatio, 1.6));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFShadowMap;
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
const scene = new T.Scene();
let savedQuality = MOBILE ? "medium" : "high"; // phones default to bloom without ambient occlusion
try {
  savedQuality = localStorage.getItem("blaster-quality") || savedQuality;
} catch {}
const post = createPost(renderer, innerWidth, innerHeight, scene, savedQuality);
if (MOBILE) post?.setSharpen?.(Math.min(0.6, Math.max(0.15, (devicePixelRatio - renderer.getPixelRatio()) * 0.35)));
post?.setSize(innerWidth, innerHeight);
const flashes = createFlashes(scene, 4),
  HDR = (c, k) => new T.Color(c).multiplyScalar(k); // HDR colours above 1 feed the bloom
scene.background = new T.Color("#d1a56d");
// ?overview shows the whole arena from above (for checking layouts); normal play uses 20.
const OVERVIEW = arenaParameters?.has("overview") ?? false;
// phones: the camera is 50 % closer in both views (small screen); desktop keeps 20
const CAMERA_ZOOM = MOBILE && !OVERVIEW ? 1.5 : 1,
  VIEW_HEIGHT = OVERVIEW ? 230 : 20 / CAMERA_ZOOM,
  aspect = innerWidth / innerHeight,
  isoCamera = new T.OrthographicCamera(
    (-VIEW_HEIGHT * aspect) / 2,
    (VIEW_HEIGHT * aspect) / 2,
    VIEW_HEIGHT / 2,
    -VIEW_HEIGHT / 2,
    0.1,
    OVERVIEW ? 600 : 180,
  );
const rearCamera = new T.PerspectiveCamera(65, aspect, 0.1, 180);
let camera = isoCamera,
  viewMode = "iso",
  viewYaw = 0,
  viewPitch = -0.18,
  lastMouse = null,
  hadMouseLock = false;
const terrainMeshes = [];
let jumpFlight = null,
  padCooldown = 0;
const padVisuals = [];
const shotDirection = new T.Vector3();
const clock = new T.Clock(),
  loader = new GLTFLoader(),
  ray = new T.Raycaster(),
  aimRay = new T.Raycaster(),
  aimPlane = new T.Plane(new T.Vector3(0, 1, 0), -1.05);
const lighting = createLighting(
    scene,
    renderer,
    generatedPlan ? seededRandom(generatedPlan.seed + "-light") : () => 0,
    arenaParameters?.get("light") ||
      (generatedPlan?.theme?.lights
        ? generatedPlan.theme.lights[
            Math.floor(seededRandom(generatedPlan.seed + "-theme-light")() * generatedPlan.theme.lights.length)
          ]
        : null),
  ),
  sun = lighting.sun;
if (OVERVIEW) scene.fog = null; // the overview camera sits far beyond the fog range
const collisionIndex = new SpatialIndex(8),
  worldIndex = new SpatialIndex(8),
  terrainIndex = new SpatialIndex(8),
  placementIndex = new SpatialIndex(8);
if (MOBILE) lighting.sun.shadow.mapSize.set(1024, 1024); // phones: a quarter of the shadow texels
let navigationDirty = false; // full rebuild (rare: layout changes)
const navigationQueue = []; // boxes that stopped blocking: refreshed locally next frame
const assets = {},
  obstacles = [],
  solidMeshes = [],
  bots = [],
  drops = [],
  effects = [],
  keys = {},
  faded = [],
  explosives = [],
  medkits = [],
  projectiles = [];
const spawnPoints = generatedPlan
  ? generatedPlan.graph.nodes.map((n) => [n.world.x, n.world.z])
  : [
      [-26, -26],
      [26, -26],
      [-26, 26],
      [26, 26],
      [-68, -30],
      [65, 4],
      [0, 66],
      [-64, 20],
      [70, 25],
      [0, -29],
      [-29, 0],
      [29, 0],
      [0, 29],
      [-20, -4],
      [20, 4],
      [-4, 20],
      [4, -20],
    ];
const people = ["male", "female"].flatMap((g) => "abcdef".split("").map((l) => "character-" + g + "-" + l));
const WORLD_LIMIT = ARENA_LIMIT - 1.3,
  navStep = 2,
  navMin = -ARENA_LIMIT + 2,
  navSize = ARENA_LIMIT - 1;
let navGrid = [];
const screenUp = new T.Vector3(-1, 0, -1).normalize(),
  screenRight = new T.Vector3(1, 0, -1).normalize(),
  cameraOffset = OVERVIEW ? new T.Vector3(220, 220, 220) : new T.Vector3(44, 44, 44),
  cameraFocus = new T.Vector3(0, 0, 18),
  pointer = new T.Vector2(0.1, 0.1),
  aimPoint = new T.Vector3(0, 1.05, -3);
let player,
  active = false,
  started = false,
  ended = false,
  wave = 0,
  kills = 0,
  hits = 0,
  hp = 100,
  gunIndex = 0,
  ammo = 16,
  reloading = 0,
  cooldown = 0,
  mouseDown = false,
  yaw = 0,
  vy = 0,
  grounded = true,
  noticeTime = 0,
  hitTime = 0,
  damageTime = 0,
  waveDelay = 0,
  audio,
  nearestDrop = null,
  time = 0,
  pointerKnown = false,
  dashTime = 0,
  dashCharges = 0,
  dashPower = false,
  dashCooldown = 0,
  shake = 0,
  immortal = false;
const dashDirection = new T.Vector3(),
  lastMove = screenUp.clone();
// ---------- Sampled sound effects (engine/audio.js) ----------
const sfx = createAudio(),
  smgLoop = sfx.loop("smg-spectre-loop", { group: "loop", volume: 0.5 }),
  bladeLoop = sfx.loop("blade-loop", { group: "loop", volume: 0.5 }),
  stepsLoop = sfx.loop("steps-loop", { group: "loop", volume: 0.3 });
if (typeof window !== "undefined") window.__sfx = sfx; // for checking in the browser console
// which sample each weapon fires (SMGs loop while the trigger is held; bots fire single shots)
function shotSound(w) {
  // the files are levelled offline (tools/process-sfx.py), so in-game volumes stay close together
  if (w.kind === 3) return { name: "rocket", volume: 0.7 };
  if (w.kind === 5) return null;
  if (w.beam === "pulse") return { name: "laser-pulse", volume: 0.65 };
  if (w.kind === 4) return { name: "laser-storm", volume: 0.5 };
  if (w.split) return { name: "shotgun-double", volume: 0.65 };
  if (w.kind === 1)
    // one shotgun sample for five guns: heavier guns sound deeper
    return { name: "shotgun", volume: 0.62, rate: { ГРОМ: 1, РАЗЛОМ: 1.06, РАЗРЯД: 0.94, ТИТАН: 0.88, ДУЭЛЯНТ: 1.1 }[w.name] ?? 1 };
  if (w.kind === 2) return { name: "smg-single", volume: 0.5 };
  return { name: { ИМПУЛЬС: "rifle-impulse", ИСКРА: "rifle-spark", СТРЕЛА: "rifle-arrow", БУРЯ: "rifle-storm" }[w.name] ?? "rifle-impulse", volume: 0.6 };
}
// Volume sliders in the menu (music; shots and effects), remembered between visits.
{
  const read = (k, d) => {
    try {
      const v = parseFloat(localStorage.getItem(k));
      return Number.isFinite(v) ? v : d;
    } catch {
      return d;
    }
  };
  const vols = { music: read("blaster-vol-music", 0.7), fx: read("blaster-vol-fx", 0.8) };
  sfx.setVolumes(vols);
  for (const [key, id] of [["music", "vol-music"], ["fx", "vol-fx"]]) {
    const input = typeof document !== "undefined" && $(id);
    if (!input) continue;
    input.value = Math.round(vols[key] * 100);
    $(id + "-out").textContent = input.value;
    input.addEventListener("input", () => {
      vols[key] = input.value / 100;
      $(id + "-out").textContent = input.value;
      sfx.setVolumes(vols);
      // turning the music volume up means "I want music": switch it back on if it was off
      if (key === "music" && vols.music > 0 && !musicEnabled && typeof toggleMusic === "function") toggleMusic();
      try {
        localStorage.setItem("blaster-vol-" + key, String(vols[key]));
      } catch {}
    });
  }
}
// Background music on/off (M or the HUD button), remembered between visits.
let musicEnabled = true;
// each arena gets one of the background tracks, chosen by its seed (?music=drive|funk forces one)
const arenaTrack = (() => {
  const forced = arenaParameters?.get("music");
  if (forced && MUSIC_TRACKS.includes("music-" + forced)) return "music-" + forced;
  const r = generatedPlan ? seededRandom(generatedPlan.seed + "-music")() : Math.random();
  return MUSIC_TRACKS[Math.floor(r * MUSIC_TRACKS.length)];
})();
try {
  musicEnabled = localStorage.getItem("blaster-music") !== "off";
} catch {}
function toggleMusic() {
  musicEnabled = !musicEnabled;
  try {
    localStorage.setItem("blaster-music", musicEnabled ? "on" : "off");
  } catch {}
  sfx.setMusic(musicEnabled, active ? 0.85 : 0.3, arenaTrack);
  showMusic();
}
function showMusic() {
  const m = typeof document !== "undefined" && $("musicmenu");
  if (m) {
    m.textContent = "МУЗЫКА · " + (musicEnabled ? "ВКЛ" : "ВЫКЛ");
    m.classList.toggle("off", !musicEnabled);
  }
  const b = typeof document !== "undefined" && $("musictoggle");
  if (!b) return;
  b.textContent = "M · МУЗЫКА: " + (musicEnabled ? "ВКЛ" : "ВЫКЛ");
  b.classList.toggle("off", !musicEnabled);
}
const SMG_LOOPS = { СПЕКТР: "smg-spectre-loop", ВЕКТОР: "smg-vector-loop", ОСА: "smg-wasp-loop", ФАНТОМ: "smg-phantom-loop" };
function reloadSound(w) {
  if (w.name === "ДУЭЛЯНТ") return "reload-shotgun-8";
  return ["reload-a", "reload-b", "reload-c", "reload-d"][(w.kind + w.name.length) % 4];
}
let lastHitSound = 0;
function hitSound(position, player = false) {
  const now = performance.now();
  if (!player && now - lastHitSound < 45) return; // shotgun pellets: one hit sound, not nine
  lastHitSound = now;
  sfx.play("hit", { position, group: "impact", volume: player ? 1 : 0.7, rate: player ? 0.82 : 1.05 });
}
function sound(f = 200, d = 0.07, type = "square", volume = 0.025) {
  if (!audio) return;
  const o = audio.createOscillator(),
    g = audio.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, audio.currentTime);
  o.frequency.exponentialRampToValueAtTime(Math.max(25, f * 0.3), audio.currentTime + d);
  g.gain.setValueAtTime(volume, audio.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + d);
  o.connect(g).connect(audio.destination);
  o.start();
  o.stop(audio.currentTime + d);
}
function message(t, d = 2.5) {
  $("notice").textContent = t;
  noticeTime = d;
}
function bounds(obj) {
  return new T.Box3().setFromObject(obj);
}
function model(key, size) {
  const obj = clone(assets[key].scene);
  obj.updateMatrixWorld(true);
  const box = bounds(obj),
    s = box.getSize(new T.Vector3()),
    scale = size / Math.max(s.x, s.y, s.z);
  obj.scale.setScalar(scale);
  obj.position.sub(box.getCenter(new T.Vector3()).multiplyScalar(scale));
  obj.position.y = -box.min.y * scale;
  obj.traverse((n) => {
    if (n.isMesh) {
      n.castShadow = true;
      n.receiveShadow = true;
    }
  });
  const group = new T.Group();
  group.userData.assetKey = key;
  group.add(obj);
  return group;
}
const surfaceObjects = [],
  placementObjects = [],
  reservedPadBoxes = [],
  padKeepout = []; // targeted pads (islands) keep their spot free before anything else is placed
function avoidsPads(obj) {
  const box = bounds(obj);
  return !reservedPadBoxes.some((zone) => zone.intersectsBox(box)) && (obj.userData?.jumpPad || !padKeepout.some((zone) => zone.intersectsBox(box)));
}
function geometrySupports(box, surface) {
  if (!surface.model?.startsWith("platformer/block-grass")) return true;
  const probe = new T.Raycaster();
  for (const x of [box.min.x, (box.min.x + box.max.x) / 2, box.max.x])
    for (const z of [box.min.z, (box.min.z + box.max.z) / 2, box.max.z]) {
      probe.set(new T.Vector3(x, surface.h + 0.12, z), new T.Vector3(0, -1, 0));
      probe.near = 0;
      probe.far = 0.16;
      const hit = probe.intersectObjects(terrainMeshes, false)[0];
      if (!hit || Math.abs(hit.point.y - surface.h) > 0.035 || hit.face.normal.y < 0.9) return false;
    }
  return true;
}
function fitsPlatform(obj, surface, margin = 0.35) {
  obj.updateMatrixWorld(true);
  const b = placementBox(obj);
  return (
    Number.isFinite(b.min.x) &&
    b.min.x >= surface.x - surface.w / 2 + margin - 0.0001 &&
    b.max.x <= surface.x + surface.w / 2 - margin + 0.0001 &&
    b.min.z >= surface.z - surface.d / 2 + margin - 0.0001 &&
    b.max.z <= surface.z + surface.d / 2 - margin + 0.0001 &&
    Math.abs(obj.position.y - surface.h) < 0.001 &&
    geometrySupports(b, surface)
  );
}
function placementBox(obj) {
  if (obj.userData.placementBounds) return obj.userData.placementBounds.clone();
  obj.updateMatrixWorld(true);
  const box = bounds(obj);
  if (obj.userData.rotatingPickup) {
    const size = box.getSize(new T.Vector3()),
      radius = Math.hypot(size.x, size.z) / 2;
    box.min.x = obj.position.x - radius;
    box.max.x = obj.position.x + radius;
    box.min.z = obj.position.z - radius;
    box.max.z = obj.position.z + radius;
    box.max.y += 0.3;
  }
  return box;
}
let routeVolumeIndex = null;
function clearCoreRoutes(obj) {
  if (!routeVolumeIndex) {
    routeVolumeIndex = new SpatialIndex(8);
    for (const route of coreRoutes)
      for (let i = 1; i < route.points.length; i++) {
        const a = route.points[i - 1],
          b = route.points[i],
          length = Math.hypot(b[0] - a[0], b[2] - a[2]),
          count = Math.ceil(length);
        for (let j = 0; j <= count; j++) {
          const t = j / count,
            x = a[0] + (b[0] - a[0]) * t,
            y = a[1] + (b[1] - a[1]) * t,
            z = a[2] + (b[2] - a[2]) * t,
            box = new T.Box3(new T.Vector3(x - 1, y + 0.03, z - 1), new T.Vector3(x + 1, y + 1.85, z + 1));
          routeVolumeIndex.insert(box, box);
        }
      }
  }
  const box = placementBox(obj);
  return !routeVolumeIndex.queryBox(box).some((r) => r.intersectsBox(box));
}
function freePlacement(obj) {
  if (!obj.userData.pickup && !obj.userData.jumpPad && !clearCoreRoutes(obj)) return false;
  if (!obj.userData.pickup) {
    const b = placementBox(obj);
    for (const instance of zoneInstances)
      for (const [x, z] of zoneLayout(instance).routes) {
        const y = terrainHeight(x, z);
        if (
          b.intersectsBox(
            new T.Box3(new T.Vector3(x - 1, y + 0.03, z - 1), new T.Vector3(x + 1, y + 1.85, z + 1)),
          )
        )
          return false;
      }
  }
  if (!avoidsPads(obj) || !stairClearance(obj)) return false;
  const box = placementBox(obj),
    gap = obj.userData.pickup ? 0.2 : 0;
  box.min.x -= gap;
  box.max.x += gap;
  box.min.z -= gap;
  box.max.z += gap;
  box.min.y += 0.01;
  box.max.y -= 0.01;
  return (
    !placementIndex
      .queryBox(box)
      .some(
        (other) =>
          other !== obj &&
          (other.parent || other.userData.reservePersistent) &&
          box.intersectsBox(placementBox(other)),
      ) && !obstacles.some((other) => !other.oneWay && box.intersectsBox(other))
  );
}
function unregisterPlacement(obj) {
  placementIndex.remove(obj);
  delete obj.userData.placementBounds;
}
function registerPlacement(obj, persistent = false) {
  obj.userData.reservePersistent = persistent;
  for (let i = placementObjects.length - 1; i >= 0; i--)
    if (!placementObjects[i].parent && !placementObjects[i].userData.reservePersistent) {
      placementIndex.remove(placementObjects[i]);
      placementObjects.splice(i, 1);
    }
  placementObjects.push(obj);
  obj.userData.placementBounds = placementBox(obj);
  placementIndex.insert(obj, obj.userData.placementBounds);
}
function placeOnSurface(obj, x, z, ceiling = Infinity) {
  const surface = [...skyPlatforms, ...platforms]
      .filter((p) => p.h <= ceiling && Math.abs(x - p.x) <= p.w / 2 && Math.abs(z - p.z) <= p.d / 2)
      .sort((a, b) => b.h - a.h)[0],
    height = surface ? surface.h : terrainHeight(x, z, ceiling);
  obj.position.set(x, height, z);
  obj.updateMatrixWorld(true);
  const size = placementBox(obj).getSize(new T.Vector3());
  if (surface && (size.x > surface.w - 0.7 || size.z > surface.d - 0.7)) return false;
  const supported = () => {
    if (surface) return fitsPlatform(obj, surface);
    const box = placementBox(obj);
    return [
      [box.min.x, box.min.z],
      [box.max.x, box.min.z],
      [box.min.x, box.max.z],
      [box.max.x, box.max.z],
      [obj.position.x, obj.position.z],
    ].every(
      ([px, pz]) =>
        Math.abs(px) <= 109 &&
        Math.abs(pz) <= 109 &&
        Math.abs(terrainHeight(px, pz, height + 0.001) - height) < 0.001,
    );
  };
  if (!supported() || !freePlacement(obj)) {
    const candidates = [],
      minX = surface ? surface.x - surface.w / 2 : x - 6,
      maxX = surface ? surface.x + surface.w / 2 : x + 6,
      minZ = surface ? surface.z - surface.d / 2 : z - 6,
      maxZ = surface ? surface.z + surface.d / 2 : z + 6;
    for (let px = minX; px <= maxX; px += 0.5)
      for (let pz = minZ; pz <= maxZ; pz += 0.5)
        candidates.push({ x: px, z: pz, d: (px - x) ** 2 + (pz - z) ** 2 });
    candidates.sort((a, b) => a.d - b.d);
    let valid = false;
    for (const c of candidates) {
      obj.position.set(c.x, height, c.z);
      if (supported() && freePlacement(obj)) {
        valid = true;
        break;
      }
    }
    if (!valid) return false;
  }
  if (surface) surfaceObjects.push({ obj, surface });
  return true;
}
function placeJumpPad(group, pad) {
  group.userData.jumpPad = true;
  let x = pad.x,
    z = pad.z;
  if (pad.y > 0) {
    const candidates = [...skyPlatforms, ...platforms]
      .filter((p) => Math.abs(p.h - pad.y) < 0.001)
      .map((p) => ({
        p,
        d: Math.max(0, Math.abs(x - p.x) - p.w / 2) ** 2 + Math.max(0, Math.abs(z - p.z) - p.d / 2) ** 2,
      }))
      .sort((a, b) => a.d - b.d);
    if (!candidates.length) return false;
    const p = candidates[0].p;
    x = T.MathUtils.clamp(x, p.x - p.w / 2 + 0.001, p.x + p.w / 2 - 0.001);
    z = T.MathUtils.clamp(z, p.z - p.d / 2 + 0.001, p.z + p.d / 2 - 0.001);
  }
  if (!placeOnSurface(group, x, z, pad.y + 0.001) || Math.abs(group.position.y - pad.y) > 0.001) return false;
  const clear = () => {
    group.updateMatrixWorld(true);
    const box = bounds(group).clone();
    box.min.x -= 0.55;
    box.max.x += 0.55;
    box.min.z -= 0.55;
    box.max.z += 0.55;
    box.min.y = pad.y + 0.03;
    box.max.y = pad.y + 2.2;
    return (
      !obstacles.some((b) => !b.oneWay && b.intersectsBox(box)) &&
      !placementObjects.some((obj) => bounds(obj).intersectsBox(box)) &&
      !reservedPadBoxes.some((b) => b.intersectsBox(box))
    );
  };
  if (!clear()) {
    const initial = group.position.clone(),
      surface = [...skyPlatforms, ...platforms].find(
        (p) => Math.abs(p.h - pad.y) < 0.001 && fitsPlatform(group, p),
      ),
      candidates = [];
    const minX = surface ? surface.x - surface.w / 2 : initial.x - 8,
      maxX = surface ? surface.x + surface.w / 2 : initial.x + 8,
      minZ = surface ? surface.z - surface.d / 2 : initial.z - 8,
      maxZ = surface ? surface.z + surface.d / 2 : initial.z + 8;
    for (let px = minX; px <= maxX; px += 0.5)
      for (let pz = minZ; pz <= maxZ; pz += 0.5)
        candidates.push({ x: px, z: pz, d: (px - initial.x) ** 2 + (pz - initial.z) ** 2 });
    candidates.sort((a, b) => a.d - b.d);
    let found = false;
    for (const c of candidates) {
      group.position.set(c.x, pad.y, c.z);
      if (surface ? !fitsPlatform(group, surface) : terrainHeight(c.x, c.z, pad.y + 0.001) !== pad.y)
        continue;
      if (clear()) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  pad.x = group.position.x;
  pad.z = group.position.z;
  pad.top = pad.y + (pad.model ? 0.28 : 0.2);
  return true;
}
// Separate walking surfaces from their darker vertical faces without changing collision geometry.
function tintTerrain(obj, color, amount = 1) {
  obj.traverse((n) => {
    if (!n.isMesh) return;
    const tint = (m) => {
      const copy = m.clone();
      if (copy.color) copy.color.lerp(new T.Color(color), amount);
      copy.roughness = 1;
      return copy;
    };
    n.material = Array.isArray(n.material) ? n.material.map(tint) : tint(n.material);
  });
  return obj;
}
function platformEdges(p) {
  if (p.model?.startsWith("platformer/block-grass")) return;
  const color = p.h >= 10 ? 0xffd78a : p.h >= 6 ? 0x9dd9dc : 0xdcc9a3,
    material = new T.MeshStandardMaterial({ color, roughness: 1 });
  for (const [axis, fixed, start, end] of [
    ["x", p.z - p.d / 2 + 0.1, p.x - p.w / 2, p.x + p.w / 2],
    ["x", p.z + p.d / 2 - 0.1, p.x - p.w / 2, p.x + p.w / 2],
    ["z", p.x - p.w / 2 + 0.1, p.z - p.d / 2 + 0.18, p.z + p.d / 2 - 0.18],
    ["z", p.x + p.w / 2 - 0.1, p.z - p.d / 2 + 0.18, p.z + p.d / 2 - 0.18],
  ]) {
    let intervals = [[start, end]];
    for (const r of ramps) {
      if (Math.abs(r.h - p.h) > 0.001) continue;
      const along = axis === "x" ? r.x1 : r.z1,
        cross = axis === "x" ? r.z1 : r.x1;
      if (Math.abs(cross - fixed) > 0.2) continue;
      const min = along - r.width / 2 - 0.25,
        max = along + r.width / 2 + 0.25;
      intervals = intervals.flatMap(([a, b]) =>
        max <= a || min >= b
          ? [[a, b]]
          : [
              [a, Math.max(a, min)],
              [Math.min(b, max), b],
            ].filter(([l, h]) => h - l > 0.01),
      );
    }
    // no trim on seams: where a platform of the same height continues past this edge (amphitheatre rows,
    // landings next to terraces) the trim would draw a double "kerb" line that reads as a step
    const outside = (t) => {
      const ox = axis === "x" ? t : fixed + (fixed > p.x ? 0.35 : -0.35),
        oz = axis === "x" ? fixed + (fixed > p.z ? 0.35 : -0.35) : t;
      return !skyPlatforms.some(
        (q) => q !== p && Math.abs(q.h - p.h) < 0.01 && Math.abs(ox - q.x) <= q.w / 2 && Math.abs(oz - q.z) <= q.d / 2,
      );
    };
    intervals = intervals.flatMap(([a, b]) => {
      const out = [];
      let from = null;
      for (let t = a; t <= b + 1e-6; t += 0.5) {
        const open = outside(Math.min(t, b));
        if (open && from === null) from = t;
        if ((!open || t + 0.5 > b + 1e-6) && from !== null) {
          const to = open ? b : t;
          if (to - from > 0.3) out.push([from, to]);
          from = null;
        }
      }
      return out;
    });
    for (const [a, b] of intervals) {
      const edge = new T.Mesh(
        new T.BoxGeometry(axis === "x" ? b - a : 0.18, 0.045, axis === "z" ? b - a : 0.18),
        material,
      );
      edge.userData.platformTrim = true;
      edge.position.set(axis === "x" ? (a + b) / 2 : fixed, p.h + 0.12, axis === "z" ? (a + b) / 2 : fixed);
      edge.receiveShadow = true;
      scene.add(edge);
    }
  }
}
function tileSurface(p) {
  const made = [];
  for (let x = p.x - p.w / 2; x < p.x + p.w / 2 - 0.001; x += 4)
    for (let z = p.z - p.d / 2; z < p.z + p.d / 2 - 0.001; z += 4) {
      const w = Math.min(4, p.x + p.w / 2 - x),
        d = Math.min(4, p.z + p.d / 2 - z);
      const tile = terrainAsset("arena/floor", x + w / 2, z + d / 2, w, d, 0.08, p.h + 0.015);
      // solid terraces get stone tiles, a shade lighter per level; floating platforms keep their old tints
      if (!p.solid && !p.landing && p.h <= 0.5) flatTint(tile, 0x9b6b40); // wooden bridge deck
      else if (p.solid || p.landing) flatTint(tile, new T.Color(0x9a9ca0).offsetHSL(0, 0, (p.h - 6) * 0.012).getHex());
      else tintTerrain(tile, p.h >= 10 ? 0xbfb29c : p.h >= 6 ? 0x849ba5 : 0xa79275, 0.65);
      made.push(tile);
    }
  platformEdges(p);
  return made;
}
function prop(key, x, z, size, rot = 0, collision = false, ceiling = Infinity) {
  const obj = model(key, size);
  obj.rotation.y = rot;
  if (!placeOnSurface(obj, x, z, ceiling)) return new T.Group();
  scene.add(obj);
  registerPlacement(obj, true);
  obj.updateMatrixWorld(true);
  if (collision) {
    const box = bounds(obj);
    box.standable =
      key.startsWith("guns/crate") ||
      key.startsWith("platformer/crate") ||
      key.startsWith("platformer/block-grass");
    obstacles.push(box);
    if (key.startsWith("survival/barrel")) {
      explosives.push({ group: obj, box, dead: false, hp: 20 }); // red barrel: blows up like a red crate
    } else if (/^(crate|barrel|chest|pot)/.test(key.split("/")[1] || "")) {
      const hp = key.includes("wide")
        ? 45
        : key.includes("chest")
          ? 40
          : key.includes("barrel")
            ? 30
            : key.includes("pot")
              ? 12
              : 25;
      explosives.push({ group: obj, box, dead: false, hp, maxHp: hp, inert: true, key });
    }
  }
  obj.traverse((n) => {
    if (n.isMesh && (key.includes("arena/wall") || key.includes("crypt") || key.includes("gravestone"))) {
      n.material = n.material.clone();
      n.material.transparent = true;
    }
    if (n.isMesh && collision) solidMeshes.push(n);
  });
  return obj;
}
function collider(x, z, w, d, h = 2) {
  obstacles.push(new T.Box3(new T.Vector3(x - w / 2, 0, z - d / 2), new T.Vector3(x + w / 2, h, z + d / 2)));
}
function character(key, x, z, isBot = false, weaponIndex = 0) {
  const gltf = assets["people/" + key],
    root = clone(gltf.scene),
    box = bounds(root);
  root.scale.setScalar(1.75 / (box.max.y - box.min.y));
  root.position.y = -box.min.y * root.scale.x;
  root.traverse((n) => {
    if (n.isMesh) {
      n.castShadow = true;
      n.receiveShadow = true;
      n.frustumCulled = false;
    }
  });
  const group = new T.Group();
  group.add(root);
  group.position.set(x, 0, z);
  scene.add(group);
  const mixer = new T.AnimationMixer(root),
    actions = {};
  for (const name of ["idle", "walk", "sprint", "jump"]) {
    const source = gltf.animations.find((a) => a.name === name);
    if (!source) continue;
    const clip = source.clone();
    if (name !== "jump" && gltf.animations.some((a) => a.name === "holding-both"))
      clip.tracks = clip.tracks.filter((t) => !["arm", "torso", "head"].some((s) => t.name.includes(s)));
    actions[name] = mixer.clipAction(clip);
  }
  const hold = gltf.animations.find((a) => a.name === "holding-both");
  if (hold) {
    const clip = hold.clone();
    clip.tracks = clip.tracks.filter((t) => ["arm", "torso", "head"].some((s) => t.name.includes(s)));
    mixer.clipAction(clip).play();
  }
  const c = {
    isBot,
    group,
    root,
    mixer,
    actions,
    anim: null,
    hp: 70,
    dead: false,
    weaponIndex,
    gun: null,
    shot: 1 + Math.random(),
    side: Math.random() < 0.5 ? -1 : 1,
    think: 1,
    path: [],
    pathTime: 0,
    stun: 0,
    flash: 0,
    elite: false,
  };
  attachGun(c, weaponIndex);
  animate(c, "idle");
  if (isBot) {
    c.bar = new T.Mesh(
      new T.PlaneGeometry(0.85, 0.1),
      new T.MeshBasicMaterial({ color: 0xff6862, side: T.DoubleSide }),
    );
    c.bar.position.y = 2.15;
    group.add(c.bar);
  }
  return c;
}
function heldWeapon(index) {
  const obj = clone(assets["guns/" + weapons[index].model].scene);
  obj.rotation.y = Math.PI;
  obj.updateMatrixWorld(true);
  const box = bounds(obj),
    size = box.getSize(new T.Vector3()),
    length = weapons[index].length,
    scale = length / size.z;
  obj.scale.set(scale * 1.65, scale * 1.5, scale);
  // Kenney barrels point along -Z; characters face +Z. Anchor the grip instead of the bounding-box centre.
  const gripZ = weapons[index].grip;
  obj.position.set(-(box.min.x + box.max.x) * 0.5 * scale * 1.65, 0.07, gripZ * scale);
  obj.traverse((n) => {
    if (n.isMesh) {
      n.castShadow = true;
      n.receiveShadow = true;
    }
  });
  const holder = new T.Group();
  holder.add(obj);
  holder.userData.restZ = Math.max(0.22, 0.44 - bounds(holder).min.z);
  // Locate the forward end of the transformed weapon geometry, once per equip.
  holder.updateMatrixWorld(true);
  const tip = bounds(holder).max.z,
    front = new T.Box3();
  obj.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const vertices = mesh.geometry.getAttribute("position");
    for (let i = 0; i < vertices.count; i++) {
      const point = new T.Vector3().fromBufferAttribute(vertices, i).applyMatrix4(mesh.matrixWorld);
      if (point.z >= tip - 0.015 * length) front.expandByPoint(point);
    }
  });
  holder.muzzle = new T.Object3D();
  front.getCenter(holder.muzzle.position);
  holder.muzzle.position.z = tip + 0.015;
  holder.add(holder.muzzle);
  // ОХОТНИК: a plasma blade as long as the weapon itself grows out of the muzzle
  if (weapons[index].kind === 5) {
    // blade cross-section = the whole front block of the barrel (front quarter of the gun), not just the bore
    const length = bounds(holder).getSize(new T.Vector3()).z,
      section = new T.Box3();
    obj.traverse((mesh) => {
      if (!mesh.isMesh) return;
      const v = mesh.geometry.getAttribute("position");
      for (let i = 0; i < v.count; i++) {
        const point = new T.Vector3().fromBufferAttribute(v, i).applyMatrix4(mesh.matrixWorld);
        if (point.z >= tip - length * 0.25) section.expandByPoint(point);
      }
    });
    const face = section.getSize(new T.Vector3()),
      bh = Math.max(0.06, face.y * 0.92),
      bw = Math.max(0.04, Math.min(face.x * 0.7, bh * 0.6)),
      blade = new T.Group(),
      // rounded plasma: capsules along the barrel axis, flattened sideways into an oval blade
      capsule = (height, width, depth) => {
        const r = height / 2,
          g = new T.CapsuleGeometry(r, Math.max(0.01, depth - height), 8, 16);
        g.rotateX(Math.PI / 2);
        g.scale(width / height, 1, 1);
        return g;
      },
      core = new T.Mesh(capsule(bh * 0.55, bw * 0.4, length * 0.96), new T.MeshBasicMaterial({ color: HDR(0xffd9b0, 4.5) })),
      glow = new T.Mesh(
        capsule(bh, bw, length),
        new T.MeshBasicMaterial({ color: HDR(weapons[index].color, 3.2), transparent: true, opacity: 0.6, blending: T.AdditiveBlending, depthWrite: false }),
      );
    core.position.z = glow.position.z = length / 2;
    blade.add(core, glow);
    section.getCenter(blade.position);
    blade.position.z = holder.muzzle.position.z;
    blade.userData.length = length;
    holder.add(blade);
    holder.blade = blade;
  }
  return holder;
}
function attachGun(c, index) {
  if (c.gun) c.group.remove(c.gun);
  c.weaponIndex = index;
  c.gun = heldWeapon(index);
  c.gun.position.set(-0.28, 0.8, c.gun.userData.restZ);
  c.group.add(c.gun);
}
function weaponMuzzle(c) {
  c.gun.updateWorldMatrix(true, true);
  return c.gun.muzzle.getWorldPosition(new T.Vector3());
}
function muzzleObstruction(c, muzzle) {
  const chest = c.group.localToWorld(new T.Vector3(0, 0.8, 0)),
    segment = muzzle.clone().sub(chest),
    length = segment.length();
  ray.set(chest, segment.normalize());
  ray.far = length;
  return intersectWorld(ray)[0];
}
function animate(c, name) {
  if (c.anim === name) return;
  const a = c.actions[name] || c.actions.idle;
  if (!a) return;
  c.actions[c.anim]?.fadeOut(0.15);
  a.reset().fadeIn(0.15).play();
  c.anim = name;
}
const architecture = [];
// ── Destructible walls: courtyard walls of the zones crumble under rockets and blasts; the giant walks through them.
const WALL_HP = 100,
  breakWalls = [];
// damage every breakable wall within radius of a blast (falloff by distance to the wall's surface)
function blastWalls(at, radius, damage) {
  for (const w of breakWalls) {
    if (w.down) continue;
    const d = w.box.distanceToPoint(at);
    if (d > radius) continue;
    hurtWall(w, damage * (1 - (0.6 * d) / radius));
  }
}
function hurtWall(w, dmg) {
  if (w.down) return;
  w.hp -= dmg;
  if (w.hp <= 0) return breakWall(w);
  // darker and cracked-looking as it weakens, with a little shudder
  const k = 0.45 + 0.55 * (w.hp / w.max);
  w.meshes.forEach((m, i) => m.material.color.copy(w.color[i]).multiplyScalar(k));
  w.home ||= w.obj.position.clone();
  w.shudder = 0.18;
}
function breakWall(w) {
  if (w.down) return;
  w.down = true;
  scene.remove(w.obj);
  const i = obstacles.indexOf(w.box);
  if (i >= 0) obstacles.splice(i, 1);
  collisionIndex.remove(w.box);
  for (const m of w.meshes) {
    const j = solidMeshes.indexOf(m);
    if (j >= 0) solidMeshes.splice(j, 1);
    worldIndex.remove(m);
  }
  navigationQueue.push(w.box.clone());
  // the neighbouring sections in the same run crack too (a wider breach, sometimes a short cascade)
  for (const o of breakWalls)
    if (!o.down && o !== w && o.box.distanceToPoint(w.box.getCenter(new T.Vector3())) < w.box.getSize(new T.Vector3()).length() / 2 + 0.3)
      setTimeout(() => hurtWall(o, 45), 90);
  // rubble: stone chunks thrown out and a dust puff
  const c = w.box.getCenter(new T.Vector3()),
    size = w.box.getSize(new T.Vector3()),
    stone = w.color[0] || new T.Color(0x9a948c);
  for (let k = 0; k < 16; k++) {
    const s = 0.2 + Math.random() * 0.45,
      piece = new T.Mesh(
        new T.BoxGeometry(s, s * (0.6 + Math.random() * 0.6), s),
        new T.MeshStandardMaterial({ color: stone.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.15), roughness: 0.95, transparent: true }),
      );
    piece.position.set(c.x + (Math.random() - 0.5) * size.x, w.box.min.y + Math.random() * size.y, c.z + (Math.random() - 0.5) * size.z);
    piece.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    piece.castShadow = true;
    addEffect(piece, 2 + Math.random(), {
      velocity: new T.Vector3((Math.random() - 0.5) * 8, 2 + Math.random() * 5, (Math.random() - 0.5) * 8),
      gravity: 16,
      spin: (Math.random() - 0.5) * 10,
      floor: terrainHeight(piece.position.x, piece.position.z) + 0.05,
    });
  }
  impact(c, 0xcfc6b8, 1.6);
  burst(c, 0xb8afa2);
  shake = Math.max(shake, 0.2);
  sound(70, 0.25, "square", 0.05);
  sound(140, 0.15, "triangle", 0.04);
}
function updateWalls(dt) {
  for (const w of breakWalls) {
    if (w.down || !(w.shudder > 0)) continue;
    w.shudder -= dt;
    const a = Math.max(0, w.shudder) * 0.6;
    w.obj.position.copy(w.home).add(new T.Vector3((Math.random() - 0.5) * a, 0, (Math.random() - 0.5) * a));
    if (w.shudder <= 0) w.obj.position.copy(w.home);
  }
}
function commitArchitecture(name, parts) {
  for (const obj of parts) {
    if (!stairClearance(obj)) throw new Error("Architecture blocks stairs: " + name);
    scene.add(obj);
    registerPlacement(obj, true);
    const box = bounds(obj);
    box.standable = !!obj.userData.walkableTop;
    if (obj.userData.opening) {
      const size = box.getSize(new T.Vector3()),
        axis = size.x > size.z ? "x" : "z",
        min = box.min[axis],
        max = box.max[axis];
      for (const end of [0, 1]) {
        const side = box.clone();
        if (end === 0) side.max[axis] = min + (max - min) * 0.22;
        else side.min[axis] = max - (max - min) * 0.22;
        obstacles.push(side);
      }
      const lintel = box.clone();
      lintel.min.y = box.max.y - size.y * 0.24;
      obstacles.push(lintel);
    } else obstacles.push(box);
    const meshes = [];
    obj.traverse((mesh) => {
      if (!mesh.isMesh) return;
      mesh.material = mesh.material.clone();
      mesh.material.transparent = true;
      solidMeshes.push(mesh);
      meshes.push(mesh);
    });
    if (obj.userData.breakable && !obj.userData.opening)
      breakWalls.push({ obj, box, meshes, hp: WALL_HP, max: WALL_HP, color: meshes.map((m) => m.material.color.clone()) });
  }
  architecture.push({ name, parts });
}
// Perimeter: Kenney arena wall tiles (1×1×0.6 model) stretched to 6 m long, 3 m tall, just outside the walkable limit.
function buildPerimeterWalls() {
  const edge = ARENA_LIMIT + 0.2,
    length = 6,
    height = 3;
  for (const [axis, side] of [
    ["x", -1],
    ["x", 1],
    ["z", -1],
    ["z", 1],
  ])
    for (let t = -ARENA_LIMIT + length / 2; t < ARENA_LIMIT + length / 2 - 0.01; t += length) {
      const obj = model("arena/wall", height);
      obj.scale.x *= length / height;
      const x = axis === "x" ? side * edge : t,
        z = axis === "x" ? t : side * edge;
      obj.rotation.y = axis === "x" ? Math.PI / 2 : 0;
      obj.position.x += x;
      obj.position.z += z;
      obj.position.y += terrainHeight(x, z);
      scene.add(obj);
      obj.updateMatrixWorld(true);
      const box = bounds(obj);
      obstacles.push(box);
      obj.traverse((n) => {
        if (!n.isMesh) return;
        n.material = n.material.clone();
        n.material.transparent = true;
        solidMeshes.push(n);
      });
    }
}
// Ravine-specific geometry: floor, walls along the cut. Only for plans with a pit.
function buildRavine(plan, addFace) {
  const bottom = new T.Mesh(
    new T.PlaneGeometry(pit.w, pit.d),
    new T.MeshStandardMaterial({ color: 0x786954, roughness: 1 }),
  );
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.set(pit.x, pit.h - 0.08, pit.z);
  bottom.receiveShadow = true;
  scene.add(bottom);
  terrainMeshes.push(bottom);
  solidMeshes.push(bottom);
  for (const f of plan.pitFaces || []) addFace(f.x, f.z, f.w, f.d, -pit.h, pit.h, 0xa27f55);
  // custom maps have no generated wall list: line all four sides, or the camera sees through the cut
  if (!plan.pitFaces)
    for (const [x, z, w, d] of [
      [pit.x, pit.z - pit.d / 2, pit.w, 0.3],
      [pit.x, pit.z + pit.d / 2, pit.w, 0.3],
      [pit.x - pit.w / 2, pit.z, 0.3, pit.d],
      [pit.x + pit.w / 2, pit.z, 0.3, pit.d],
    ])
      addFace(x, z, w, d, -pit.h, pit.h, 0xa27f55);
}
// ---------- Clusters from the catalogue (generator/clusters.js, spots from generator/decorate.js) ----------
const BREAKABLE_HP = { pot: 12, crate: 25, barrel: 30, chest: 40 };
function flatTint(obj, tint) {
  obj.traverse((n) => {
    if (!n.isMesh) return;
    n.material = [n.material].flat().map((m) => {
      const c = m.clone();
      if (c.map) {
        const l = (c.color?.r ?? 1) * 0.3 + 0.7;
        c.map = null;
        c.color.set(tint).multiplyScalar(l);
      } else c.color?.lerp(new T.Color(tint), 0.75);
      return c;
    });
    if (n.material.length === 1) n.material = n.material[0];
  });
}
let clusterCount = 0;
function placeClusters(plan) {
  const plan2 = (plan.decor ||= decorate(plan)),
    placed = [];
  for (const spot of plan2.clusters) if (placeCluster(spot)) placed.push(spot.id);
  // fill layer: single props into the remaining empty ground (skipped where the spot turns out taken)
  let filled = 0;
  for (const f of plan2.fill)
    if (placeLandmark({ key: f.key, x: f.x, z: f.z, size: f.size, rot: f.rot, collision: f.solid, scatter: true })?.parent)
      filled++;
  runtimeStats.clusters = placed;
  runtimeStats.fill = filled + " / " + plan2.fill.length;
  runtimeStats.deadQuarters = plan2.stats?.after.map((d) => Math.round(d * 100) + "%").join(" ");
}
// Build every model of a cluster, check each against the arena, then commit all or nothing.
function placeCluster({ id, x, z, rot, y: level, scale = 1 }) {
  const c = CLUSTERS[id],
    cos = Math.cos(rot),
    sin = Math.sin(rot),
    // scale (maps / editor): the whole composition grows or shrinks, positions and model sizes alike
    world = (lx, lz) => [x + (lx * cos + lz * sin) * scale, z + (-lx * sin + lz * cos) * scale],
    parts = [];
  for (const [key, lx, lz, size0, deg = 0, solid = true, y0 = 0] of c.items) {
    if (!assets[key]) return false;
    const size = size0 * scale,
      y = y0 * scale;
    const obj = model(key, size),
      [wx, wz] = world(lx, lz);
    if (c.tints?.[key] !== undefined) flatTint(obj, c.tints[key]);
    obj.rotation.y = rot + (deg * Math.PI) / 180;
    // model() centres the mesh with an offset; rotate that offset with the model
    const ox = obj.position.x,
      oz = obj.position.z,
      r = obj.rotation.y;
    obj.position.x = wx + ox * Math.cos(r) + oz * Math.sin(r);
    obj.position.z = wz - ox * Math.sin(r) + oz * Math.cos(r);
    // a map cluster with a height sits on the surface under its centre at that height (e.g. a platform top)
    obj.position.y += (level !== undefined ? surfaceAt(x, z, level) : terrainHeight(wx, wz)) + y;
    obj.updateMatrixWorld(true);
    if (!freePlacement(obj)) return false;
    parts.push({ obj, key, solid });
  }
  const assembly = "cluster-" + ++clusterCount;
  for (const { obj, key, solid } of parts) {
    scene.add(obj);
    obj.userData.assembly = assembly;
    registerPlacement(obj, true);
    if (!solid) continue;
    const box = bounds(obj),
      size = box.getSize(new T.Vector3());
    box.standable = size.x >= 1.4 && size.z >= 1.4;
    obstacles.push(box);
    obj.traverse((n) => n.isMesh && solidMeshes.push(n));
    if (c.explosive?.includes(key) || key.startsWith("survival/barrel")) {
      explosives.push({ group: obj, box, dead: false, hp: 20 }); // powder barrel: blows up like a red crate
      continue;
    }
    const kind = (key.split("/")[1] || "").match(/^(pot|crate|barrel|chest)/)?.[1];
    if (kind) explosives.push({ group: obj, box, dead: false, hp: BREAKABLE_HP[kind], maxHp: BREAKABLE_HP[kind], inert: true, key });
  }
  // pads that travel with the cluster join the arena pads before pads and navigation are built
  for (const pad of c.pads || []) {
    const [px, pz] = world(pad.x, pad.z);
    jumpPads.push(applyPadTier({ x: px, z: pz, y: terrainHeight(px, pz), role: pad.role, tier: pad.tier, speed: pad.speed, vertical: pad.vertical ?? 18 }));
  }
  return true;
}

// Plan landmark: optional rotation, team tint, decorative (no collision) and scatter (skip if the spot is taken).
function placeLandmark(m) {
  if (!assets[m.key]) return null;
  const collision = m.collision !== false;
  if (m.scatter) {
    const probe = model(m.key, m.size);
    probe.rotation.y = m.rot || 0;
    if (!placeOnSurface(probe, m.x, m.z, m.y ?? Infinity)) return null;
    probe.updateMatrixWorld(true);
    if (!freePlacement(probe)) return null;
  }
  const obj = prop(m.key, m.x, m.z, m.size, m.rot || 0, collision, m.y ?? Infinity);
  if (m.tint !== undefined && obj.parent) tintTerrain(obj, m.tint, 0.55);
  return obj;
}
// Continuous wall runs from the plan (fortress battlements and parapets): each run is split into
// equal tiles that touch end to end, so there are no gaps; tiles are obstacles and fade like other walls.
function buildWallRuns(runs) {
  runs.forEach((r, i) => {
    const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0),
      n = Math.max(1, Math.round(len / 3)),
      tile = len / n,
      angle = Math.atan2(-(r.z1 - r.z0), r.x1 - r.x0);
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n,
        obj = model(r.key || "arena/wall", r.height);
      obj.scale.x *= tile / r.height;
      const holder = new T.Group();
      holder.add(obj);
      obj.position.x = 0;
      obj.position.z = 0;
      holder.rotation.y = angle;
      const wx = r.x0 + (r.x1 - r.x0) * t,
        wz = r.z0 + (r.z1 - r.z0) * t;
      // custom maps: each tile rests on the surface under it at the run's height (generated runs are exact)
      holder.position.set(wx, generatedPlan?.custom ? surfaceAt(wx, wz, r.y) : r.y, wz);
      scene.add(holder);
      holder.updateMatrixWorld(true);
      holder.userData.assembly = "wallruns"; // runs meet at corners: one assembly so joints are not overlaps
      registerPlacement(holder, true);
      obstacles.push(bounds(holder));
      holder.traverse((n) => {
        if (!n.isMesh) return;
        n.material = n.material.clone();
        n.material.transparent = true;
        n.castShadow = n.receiveShadow = true;
        solidMeshes.push(n);
      });
    }
  });
}
// Moat («Царь горы»): a deep ditch full of sharpened stakes. You can fall in; down there you lose health fast
// and die (updateMoatHazard). Only the four bridges (connector platforms at h = 0) cross it.
function buildMoat(plan, addFace) {
  const depth = MOAT_DEPTH,
    floor = new T.MeshStandardMaterial({ color: 0x4a4436, roughness: 1 }),
    stakes = [],
    random = seededRandom(plan.seed + "-stakes");
  for (const m of plan.moat) {
    const bottom = new T.Mesh(new T.PlaneGeometry(m.w, m.d), floor);
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.set(m.x, -depth, m.z);
    bottom.receiveShadow = true;
    scene.add(bottom);
    terrainMeshes.push(bottom);
    // stakes on a jittered 1.4 m grid, slightly leaning
    for (let x = m.x - m.w / 2 + 0.8; x < m.x + m.w / 2 - 0.5; x += 1.4)
      for (let z = m.z - m.d / 2 + 0.8; z < m.z + m.d / 2 - 0.5; z += 1.4)
        if (random() < (plan.stakeDensity ?? 1)) stakes.push([x + (random() - 0.5) * 0.6, z + (random() - 0.5) * 0.6, 0.9 + random() * 0.7, (random() - 0.5) * 0.35, (random() - 0.5) * 0.35]);
  }
  const stake = new T.InstancedMesh(
      new T.ConeGeometry(0.11, 1, 5).translate(0, 0.5, 0),
      new T.MeshStandardMaterial({ color: 0x7a5432, roughness: 0.9 }),
      stakes.length,
    ),
    matrix = new T.Matrix4(),
    q = new T.Quaternion();
  stakes.forEach(([x, z, h, rx, rz], i) => {
    q.setFromEuler(new T.Euler(rx, 0, rz));
    matrix.compose(new T.Vector3(x, -depth, z), q, new T.Vector3(1, h, 1));
    stake.setMatrixAt(i, matrix);
  });
  stake.castShadow = true;
  scene.add(stake);
  // steep earth banks on the outer and inner edge of the ring
  const outer = Math.max(...plan.moat.map((m) => Math.max(Math.abs(m.x) + m.w / 2, Math.abs(m.z) + m.d / 2))),
    inner = Math.min(...plan.moat.map((m) => Math.max(Math.abs(m.x) - m.w / 2, Math.abs(m.z) - m.d / 2)));
  if (plan.moatBanks === "strips") {
    // strips that cross or touch each other (island channels, tower rings): an earth wall only where a strip's
    // side meets solid ground, found by sampling just outside every side
    const inMoat = (x, z) => plan.moat.some((m) => Math.abs(x - m.x) < m.w / 2 && Math.abs(z - m.z) < m.d / 2);
    for (const m of plan.moat)
      for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const len = nx ? m.d : m.w,
          ex = m.x + (nx * m.w) / 2,
          ez = m.z + (nz * m.d) / 2,
          steps = Math.max(1, Math.ceil(len / 0.5));
        let run = null;
        for (let k = 0; k <= steps; k++) {
          const t = -len / 2 + (k / steps) * len,
            px = nx ? ex + nx * 0.2 : m.x + t,
            pz = nx ? m.z + t : ez + nz * 0.2,
            solid = k < steps && !inMoat(px, pz) && Math.abs(px) < 110 && Math.abs(pz) < 110;
          if (solid && run === null) run = t;
          if (!solid && run !== null) {
            const a = run,
              b = t,
              mid = (a + b) / 2;
            if (b - a > 0.3) addFace(nx ? ex : m.x + mid, nx ? m.z + mid : ez, nx ? 0.3 : b - a, nx ? b - a : 0.3, depth, -depth, 0x6e6250);
            run = null;
          }
        }
      }
    return;
  }
  if (plan.custom) {
    // custom maps: every strip gets its own four earth walls (strips can be anywhere)
    for (const m of plan.moat)
      for (const [x, z, w, d] of [
        [m.x, m.z - m.d / 2, m.w, 0.3],
        [m.x, m.z + m.d / 2, m.w, 0.3],
        [m.x - m.w / 2, m.z, 0.3, m.d],
        [m.x + m.w / 2, m.z, 0.3, m.d],
      ])
        addFace(x, z, w, d, depth, -depth, 0x6e6250);
    return;
  }
  for (const a of [outer, inner])
    for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
      addFace(nx * a, nz * a, nx ? 0.3 : a * 2, nx ? a * 2 : 0.3, depth, -depth, 0x6e6250);
}
// Falling into the moat: 20 damage every 0.25 s for players and bots (dead within ~1.3 s).
// With immortality on, the player is put back on the last safe ground instead.
let moatTick = 0,
  moatTime = 0;
function updateMoatHazard(dt) {
  if (!generatedPlan?.moat || !player) return;
  const p = player.group.position;
  if (p.y > -0.5 && !jumpFlight) player.lastSafe = (player.lastSafe || new T.Vector3()).copy(p);
  // standing on a rescue block in the ditch is safe
  const onRescue = (q) => (generatedPlan.rescue || []).some((r) => Math.abs(q.x - r.x) < 2.4 && Math.abs(q.z - r.z) < 2.4 && q.y > -3.7);
  if (p.y < -1.5 && !onRescue(p)) {
    if (!moatTime) runStats.feats.moat++;
    moatTime += dt;
    moatTick -= dt;
    if (moatTick <= 0) {
      moatTick = 0.25;
      damagePlayer(generatedPlan.moatDamage ?? 20);
      impact(p.clone().add(new T.Vector3(0, 0.6, 0)), 0xb23a2a, 0.4);
    }
    if (immortal && moatTime > 1.2 && player.lastSafe) {
      p.copy(player.lastSafe);
      moatTime = 0;
    }
  } else moatTime = moatTick = 0;
  for (const b of bots)
    if (!b.dead && !b.giant && b.group.position.y < -1.5) {
      b.hp -= 80 * dt;
      b.flash = 0.1;
      if (b.hp <= 0) kill(b, "moat");
    }
}
// Torches and braziers (night arena): a dark post or stand, an iron bowl and a glowing flame (HDR colour,
// so the bloom catches it); some carry a warm flickering point light.
const torchLights = [];
function buildTorches(list) {
  const wood = new T.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 0.9 }),
    iron = new T.MeshStandardMaterial({ color: 0x2c2c30, roughness: 0.5, metalness: 0.6 }),
    fire = new T.MeshBasicMaterial({ color: HDR(0xff8a2a, 6) }),
    core = new T.MeshBasicMaterial({ color: HDR(0xffd27a, 8) });
  list.forEach((t, i) => {
    const brazier = t.kind === "brazier",
      g = new T.Group(),
      postH = brazier ? 1.1 : 2.4,
      post = new T.Mesh(new T.CylinderGeometry(brazier ? 0.35 : 0.11, brazier ? 0.45 : 0.14, postH, 8), brazier ? iron : wood),
      bowl = new T.Mesh(new T.CylinderGeometry(brazier ? 0.75 : 0.28, brazier ? 0.45 : 0.18, brazier ? 0.35 : 0.25, 10), iron),
      flame = new T.Mesh(new T.ConeGeometry(brazier ? 0.55 : 0.22, brazier ? 1.1 : 0.6, 8), fire),
      glow = new T.Mesh(new T.ConeGeometry(brazier ? 0.28 : 0.11, brazier ? 0.6 : 0.34, 6), core);
    post.position.y = postH / 2;
    bowl.position.y = postH + 0.1;
    flame.position.y = postH + 0.25 + (brazier ? 0.55 : 0.3);
    glow.position.y = postH + 0.25 + (brazier ? 0.35 : 0.18);
    post.castShadow = bowl.castShadow = true;
    g.add(post, bowl, flame, glow);
    g.position.set(t.x, t.y !== undefined ? surfaceAt(t.x, t.z, t.y) : terrainHeight(t.x, t.z), t.z);
    g.updateMatrixWorld(true);
    if (!freePlacement(g)) return;
    scene.add(g);
    g.userData.assembly = "torch-" + i;
    registerPlacement(g, true);
    const r = brazier ? 0.75 : 0.2;
    obstacles.push(new T.Box3(new T.Vector3(t.x - r, g.position.y, t.z - r), new T.Vector3(t.x + r, g.position.y + postH + 0.3, t.z + r)));
    g.userData.flame = flame;
    if (t.light && !(MOBILE && torchLights.filter((x) => x.light).length >= 4)) {
      const light = new T.PointLight(0xff9a4a, brazier ? 60 : 32, brazier ? 18 : 13, 2);
      light.position.set(t.x, g.position.y + postH + 0.8, t.z);
      scene.add(light);
      torchLights.push({ light, base: light.intensity, flame, phase: i * 1.7 });
    } else torchLights.push({ light: null, flame, phase: i * 1.7 });
  });
}
function updateTorches(time) {
  for (const t of torchLights) {
    const f = 0.85 + Math.sin(time * 9 + t.phase) * 0.08 + Math.sin(time * 23 + t.phase * 2) * 0.05;
    if (t.light) t.light.intensity = t.base * f;
    t.flame.scale.set(1, f, 1);
  }
}
// Per frame: the listener follows the player (screen-right for panning); loops follow the action.
function updateSfx() {
  sfx.setListener(player.group.position, screenRight);
  const w = weapons[gunIndex],
    firing = active && (mouseDown || touchFiring);
  if (w.kind !== 2 || !firing || ammo <= 0 || reloading > 0) smgLoop.set(false);
  bladeLoop.set(!!player.gun?.blade?.visible);
  const moving = active && grounded && !jumpFlight && lastStepMoving;
  stepsLoop.set(moving, { rate: lastStepSprint ? 1.3 : 1 });
}
let lastStepMoving = false,
  lastStepSprint = false;
function buildGeneratedArena() {
  const plan = generatedPlan,
    rng = seededRandom(plan.seed),
    openings = groundOpenings(pit, ramps, plan.moat || []),
    _keep = jumpPads
      .filter((p) => p.target)
      .forEach((p) => padKeepout.push(new T.Box3(new T.Vector3(p.x - 2.6, p.y - 0.5, p.z - 2.6), new T.Vector3(p.x + 2.6, p.y + 3.5, p.z + 2.6)))),
    groundGeometry = new T.BufferGeometry();
  // Ground layer: decor spots and paved courtyards first, they shape both the paint and the relief
  plan.decor ||= decorate(plan);
  // pave only real courtyards: zones whose template walls add up to at least 20 m, inside the walls' outline
  const courtyards = plan.zones.flatMap((z) => {
    const walls = zoneLayout(z).walls || [],
      total = walls.reduce((sum, [x0, z0, x1, z1]) => sum + Math.hypot(x1 - x0, z1 - z0), 0);
    if (total < 20) return [];
    const xs = walls.flatMap(([x0, , x1]) => [x0, x1]),
      zs = walls.flatMap(([, z0, , z1]) => [z0, z1]),
      minX = Math.min(...xs) - 1,
      maxX = Math.max(...xs) + 1,
      minZ = Math.min(...zs) - 1,
      maxZ = Math.max(...zs) + 1;
    return [{ x: z.x + (minX + maxX) / 2, z: z.z + (minZ + maxZ) / 2, w: maxX - minX, d: maxZ - minZ }];
  });
  // visual relief (engine/relief.js): physics keep the ground flat at y = 0
  const relief = createRelief(plan, {
      zones: plan.zones.map((z) => {
        const e = zoneLayout(z).extent || { w: 26, d: 26 };
        return { x: z.x, z: z.z, w: e.w, d: e.d };
      }),
      clusters: plan.decor.clusters,
    }),
    groundPositions = groundVertices(110, openings, 2);
  for (let i = 0; i < groundPositions.length; i += 3) groundPositions[i + 1] = relief.lift(groundPositions[i], groundPositions[i + 2]);
  groundGeometry.setAttribute("position", new T.Float32BufferAttribute(groundPositions, 3));
  groundGeometry.setAttribute("uv", new T.Float32BufferAttribute(groundUVs(groundPositions, 110), 2));
  groundGeometry.computeVertexNormals();
  const painted = paintGround(plan, {
      zones: courtyards,
      clusters: plan.decor.clusters,
      random: seededRandom(plan.seed + "-ground"),
    }),
    groundTexture = painted ? new T.CanvasTexture(painted) : null,
    normalTexture = relief.normalCanvas ? new T.CanvasTexture(relief.normalCanvas) : null;
  if (groundTexture) {
    groundTexture.colorSpace = T.SRGBColorSpace;
    groundTexture.anisotropy = renderer.capabilities?.getMaxAnisotropy?.() ?? 1;
  }
  const ground = new T.Mesh(
    groundGeometry,
    new T.MeshStandardMaterial({
      color: groundTexture ? 0xffffff : (plan.theme?.ground ?? 0xc5965e),
      map: groundTexture,
      normalMap: normalTexture,
      normalScale: new T.Vector2(1, 1),
      roughness: 1,
    }),
  );
  ground.position.y = -0.13;
  ground.receiveShadow = true;
  scene.add(ground);
  terrainMeshes.push(ground);
  solidMeshes.push(ground);
  const addFace = (x, z, w, d, h, y, color) => {
    const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), new T.MeshStandardMaterial({ color, roughness: 1 }));
    mesh.position.set(x, y + h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    terrainMeshes.push(mesh);
    solidMeshes.push(mesh);
    return mesh;
  };
  if (pit.w > 0) buildRavine(plan, addFace);
  if (plan.moat) buildMoat(plan, addFace);
  buildWallRuns(plan.wallRuns || []);
  buildSkyRoute();
  for (const r of ramps) {
    buildSolidStaircase(r);
    buildStairRetainingWalls(r);
  }
  // Connected template walls are admitted only outside reserved graph routes.
  for (const zone of plan.zones) {
    const layout = zoneLayout(zone),
      parts = [];
    for (const [x0, z0, x1, z1, oldHeight] of layout.walls) {
      const length = Math.hypot(x1 - x0, z1 - z0),
        count = Math.ceil(length / 4),
        height = oldHeight > 2 ? 4 + rng() * 1.2 : oldHeight;
      for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count,
          obj = model(oldHeight <= 1.5 ? "dungeon/wall-half" : "dungeon/wall", 1),
          size = bounds(obj).getSize(new T.Vector3());
        obj.scale.set(length / count / size.x, height / size.y, 0.9 / size.z);
        obj.rotation.y = x0 === x1 ? Math.PI / 2 : 0;
        obj.position.set(zone.x + x0 + (x1 - x0) * t, zone.y || 0, zone.z + z0 + (z1 - z0) * t);
        obj.userData.assembly = zone.id;
        obj.userData.walkableTop = height <= 1.5;
        obj.userData.breakable = true;
        if (freePlacement(obj)) parts.push(obj);
      }
    }
    if (parts.length) commitArchitecture(zone.id + " · " + layout.name, parts);
    for (const [key, x, z, size] of layout.props) prop(key, zone.x + x, zone.z + z, size, 0, true);
    for (const [dx, dz] of [
      [-12, -8],
      [12, 8],
      [-12, 8],
      [12, -8],
    ]) {
      const key = rng() < 0.5 ? "guns/crate-wide" : "arena/column-damaged";
      prop(key, zone.x + dx, zone.z + dz, 2 + rng() * 1.5, rng() * Math.PI, true);
    }
    if (zone.template === "ruins")
      for (const dx of [-7, 7]) prop("graveyard/gravestone-broken", zone.x + dx, zone.z + 10, 2, 0, true);
    makeExplosive(zone.x + 8, zone.z - 7);
  }
  // Plan-level destructible walls («Лабиринт»): split into ~5 m sections like the courtyard walls; each run is
  // pulled back 0.5 m at both ends so T-joints do not overlap (an overlapping section would be rejected)
  if (plan.breakWalls?.length) {
    const parts = [];
    for (const [ax, az, bx, bz, height] of plan.breakWalls) {
      const full = Math.hypot(bx - ax, bz - az);
      if (full < 1.6) continue;
      const ux = (bx - ax) / full,
        uz = (bz - az) / full,
        x0 = ax + ux * 0.5,
        z0 = az + uz * 0.5,
        length = full - 1,
        count = Math.max(1, Math.ceil(length / 5.5));
      for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count,
          obj = model(height <= 1.5 ? "dungeon/wall-half" : "dungeon/wall", 1),
          size = bounds(obj).getSize(new T.Vector3());
        obj.scale.set(length / count / size.x, height / size.y, 0.9 / size.z);
        obj.rotation.y = Math.abs(ux) < 0.5 ? Math.PI / 2 : 0;
        obj.position.set(x0 + ux * length * t, 0, z0 + uz * length * t);
        obj.userData.assembly = "maze";
        obj.userData.walkableTop = height <= 1.5;
        obj.userData.breakable = true;
        if (freePlacement(obj)) parts.push(obj);
      }
    }
    if (parts.length) commitArchitecture("maze walls", parts);
  }
  for (const [x, z] of plan.barrels || []) makeExplosive(x, z);
  // Catalogue clusters chosen by the decorator (before scattered decor, so scatter fills the gaps).
  placeClusters(plan);
  // Bank landmarks come from the oriented plan.
  for (const m of plan.landmarks || []) placeLandmark(m);
  buildPerimeterWalls();
  // torches last, each checked against everything already placed (they are dropped where they would collide)
  buildTorches(plan.torches || []);
  // Glowing lanterns at the ravine corners (emissive only; bloom makes them glow).
  if (pit.w > 0)
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const l = prop(
          "graveyard/lantern-glass",
          pit.x + sx * (pit.w / 2 + 2),
          pit.z + sz * (pit.d / 2 + 2),
          1.6,
          0,
          false,
        );
        if (!l.parent) continue;
        const b = bounds(l),
          glow = new T.Mesh(sharedSphere(0.22, 10, 8), new T.MeshBasicMaterial({ color: HDR(0xffc46a, 6) }));
        glow.position.set(
          (b.min.x + b.max.x) / 2,
          b.min.y + (b.max.y - b.min.y) * 0.55,
          (b.min.z + b.max.z) / 2,
        );
        scene.add(glow);
      }
  for (const n of plan.graph.nodes.filter((n) => n.id[0] === "u")) {
    // checked placement: never on a stair, landing or route of the upper level
    placeLandmark({ key: "guns/crate-wide", x: n.world.x - 5, z: n.world.z + 5, size: 2.2, scatter: true });
    placeLandmark({ key: "arena/column-damaged", x: n.world.x + 5, z: n.world.z - 5, size: 3, scatter: true });
  }
  buildMedkits();
  buildJumpPads();
  batchTerrain();
  buildNavigation();
  const destination = new T.Vector3(plan.zones[0].x, 0, plan.zones[0].z);
  for (const n of plan.graph.nodes) {
    const point = new T.Vector3(n.world.x, n.height, n.world.z);
    if (n.id !== plan.zones[0].id && !findPath(point, destination).length)
      if (plan.custom) (plan.warnings ||= []).push("недостижимая точка " + n.id + " (" + Math.round(n.world.x) + ", " + Math.round(n.world.z) + ")");
      else if (!globalThis.__allowDisconnected) throw new Error("Generated zone disconnected: " + n.id + " seed " + plan.seed);
  }
  spawnArenaWeapons();
}

function buildArena() {
  if (generatedPlan) return buildGeneratedArena();
  sun.shadow.camera.updateProjectionMatrix();
  const openings = groundOpenings(pit, ramps),
    geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(groundVertices(110, openings), 3));
  geometry.computeVertexNormals();
  const ground = new T.Mesh(geometry, new T.MeshStandardMaterial({ color: 0xc5965e, roughness: 1 }));
  ground.position.y = -0.13;
  ground.receiveShadow = true;
  scene.add(ground);
  terrainMeshes.push(ground);
  solidMeshes.push(ground);
  const floorTemplate = model("arena/floor", 4);
  const b = bounds(floorTemplate),
    sx = b.max.x - b.min.x,
    sz = b.max.z - b.min.z;
  floorTemplate.scale.set(4 / sx, 1, 4 / sz);
  floorTemplate.updateMatrixWorld(true);
  // Repeated floor tiles share instanced geometry to keep the larger arena light.
  const tileMeshes = [];
  floorTemplate.traverse((n) => {
    if (n.isMesh) tileMeshes.push(n);
  });
  for (const mesh of tileMeshes) {
    const inst = new T.InstancedMesh(mesh.geometry, mesh.material, 39 * 39);
    let i = 0;
    for (let x = -76; x <= 76; x += 4)
      for (let z = -76; z <= 76; z += 4) {
        if (intersectsOpening({ minX: x - 2, maxX: x + 2, minZ: z - 2, maxZ: z + 2 }, openings)) continue;
        const m = new T.Matrix4().makeTranslation(x, -0.08, z).multiply(mesh.matrixWorld);
        inst.setMatrixAt(i++, m);
      }
    inst.count = i;
    inst.receiveShadow = true;
    scene.add(inst);
  }
  buildTerrain();
  buildSkyRoute();
  buildFortress({ T, model, commit: commitArchitecture, skyPlatforms });
  buildExpansion({ T, model, commit: commitArchitecture, prop });
  for (const [x, z] of [
    [-8, -27],
    [8, 22],
    [-24, 8],
    [24, -8],
    [-5, 4],
    [5, -4],
    [-22, -22],
    [22, 22],
  ]) {
    prop("guns/crate-wide", x, z, 2.5, x < 0 ? 0 : Math.PI / 2, true);
    prop("guns/crate-small", x + 2, z + 2, 1.2, 0, true);
  }
  for (const [x, z] of [
    [-20, -16],
    [20, 16],
    [-20, 20],
    [20, -20],
    [0, 18],
    [0, -18],
  ])
    prop("arena/column-damaged", x, z, 3, 0, true);
  for (const [x, z] of [
    [-32, -32],
    [32, -32],
    [-32, 32],
    [32, 32],
  ]) {
    prop("arena/column", x, z, 5, 0, true);
    prop("arena/banner", x, z - 1, 2.7);
  }
  prop("arena/statue", -28, 28, 4, 0, true);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    prop(
      "arena/tree",
      Math.sin(a) * (47 + Math.sin(i * 7) * 2),
      Math.cos(a) * (47 + Math.sin(i * 7) * 2),
      4 + (i % 3),
    );
  }
  // The north-east court is an abandoned cemetery, with space between rows for combat.
  prop("graveyard/crypt-a", 23, -27, 5.5, Math.PI / 2, true);
  for (const x of [18, 24, 30])
    for (const z of [-19, -14]) {
      prop("graveyard/grave", x, z, 2.2);
      prop(
        "graveyard/" + (x === 24 ? "gravestone-cross" : z === -19 ? "gravestone-round" : "gravestone-broken"),
        x,
        z - 1,
        1.5,
        0,
        true,
      );
    }

  prop("graveyard/coffin-old", 28, -7, 2.6, 0.4, true);
  prop("graveyard/altar-stone", 20, -6, 2.7, 0, true);
  for (const [x, z] of [
    [-28, 18],
    [-25, 26],
    [29, 18],
    [28, 25],
    [-22, -28],
  ])
    prop("graveyard/rocks", x, z, 2.5, 0, true);
  prop("graveyard/rocks-tall", -28, 28, 3.5, 0, true);
  prop("graveyard/trunk", 28, 20, 3, 0.7);
  for (const [x, z] of [
    [-7, -18],
    [7, 18],
    [-20, 5],
    [20, -5],
    [3, -6],
  ])
    makeExplosive(x, z);
  buildSkySupplies();
  buildMedkits();
  buildJumpPads();
  batchTerrain();
  buildNavigation();
  spawnArenaWeapons();
}
function buildSkyRoute() {
  for (const p of skyPlatforms) {
    // solid terraces (hill): a full block from `base` to the top, walkable on top, nothing underneath
    if (p.solid) {
      const base = p.base || 0;
      // flat stone colour (the block's palette texture would stay orange under a tint)
      flatTint(terrainAsset("arena/block", p.x, p.z, p.w, p.d, p.h - base, base), generatedPlan?.theme?.platform ?? 0xb09372);
      tileSurface(p);
      const mass = new T.Box3(new T.Vector3(p.x - p.w / 2, base, p.z - p.d / 2), new T.Vector3(p.x + p.w / 2, p.h, p.z + p.d / 2));
      mass.standable = true;
      obstacles.push(mass);
      continue;
    }
    if (p.model) {
      terrainAsset(p.model, p.x, p.z, p.w, p.d, 0.65, p.h - 0.65);
      platformEdges(p);
    } else {
      const slab = terrainAsset("arena/block", p.x, p.z, p.w, p.d, 0.65, p.h - 0.65);
      // stair landings belong to the stone citadel; ground-level slabs are wooden bridges; others keep the theme tint
      const bridge = p.h <= 0.5;
      if (p.landing) flatTint(slab, generatedPlan?.theme?.platform ?? 0x8e9095);
      else if (bridge) flatTint(slab, 0x6e4a2c);
      else tintTerrain(slab, generatedPlan?.theme?.platform ?? 0xb09372, 0.7);
      const tiles = tileSurface(p);
      // a floor at ground level never hides the player, and must not fade with walls it gets batched with
      if (bridge) for (const o of [slab, ...(tiles || [])]) o?.traverse?.((n) => n.isMesh && [n.material].flat().forEach((m) => (m.transparent = false)));
    }
    const slab = new T.Box3(
      new T.Vector3(p.x - p.w / 2, p.h - 0.65, p.z - p.d / 2),
      new T.Vector3(p.x + p.w / 2, p.h, p.z + p.d / 2),
    );
    slab.oneWay = true;
    // bridges and crossings stop a pad jump from below instead of letting it pass through
    slab.solidFromBelow = !!p.connector;
    obstacles.push(slab);
  }
}
function buildSkySupplies() {
  for (const p of skyPlatforms.filter((p) => p.d > 6)) {
    prop("guns/crate-wide", p.x - 3, p.z - 2, 2.5, 0, true);
    prop("arena/column-damaged", p.x + 4, p.z + 3, 2.8, 0, true);
    if (p.h >= 9) makeExplosive(p.x - 4, p.z + 3);
  }
  // New outer courts have cover, ruins and branching approaches.
  for (const [x, z] of [
    [-44, -35],
    [-40, 40],
    [40, 37],
    [6, -43],
    [-18, -42],
    [45, -40],
  ]) {
    prop("arena/column-damaged", x, z, 4, 0, true);
    prop("graveyard/rocks", x + 4, z + 3, 3, 0, true);
    prop("guns/crate-wide", x - 3, z + 4, 2.5, 0, true);
  }
}
function buildJumpPads() {
  for (const pad of jumpPads) {
    const group = new T.Group(),
      base = new T.Mesh(
        new T.CylinderGeometry(1.3, 1.5, 0.2, 24),
        new T.MeshStandardMaterial({ color: 0x184e65, emissive: 0x0a2838 }),
      );
    base.position.y = 0.1;
    group.add(base);
    if (pad.model) {
      base.visible = false;
      const spring = model(pad.model, 2.3);
      spring.updateMatrixWorld(true);
      spring.scale.y = 0.28 / bounds(spring).getSize(new T.Vector3()).y;
      group.add(spring);
    }
    for (const radius of [0.6, 1.05]) {
      const ring = new T.Mesh(
        new T.TorusGeometry(radius, 0.07, 8, 32),
        new T.MeshBasicMaterial({
          color: HDR(PAD_TIERS[pad.tier]?.ring ?? (pad.role === "escape" ? 0x39edff : pad.role === "transfer" ? 0x66ee99 : 0xffbb44), 4.5),
        }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.23;
      group.add(ring);
    }
    const arrow = new T.Mesh(
      new T.ConeGeometry(0.28, 0.7, 3),
      new T.MeshBasicMaterial({ color: HDR(0x9bffff, 3.5) }),
    );
    arrow.position.y = 1;
    group.add(arrow);
    if (!placeJumpPad(group, pad)) {
      pad.disabled = true;
      continue;
    }
    scene.add(group);
    const zone = bounds(group).clone();
    zone.min.x -= 0.55;
    zone.max.x += 0.55;
    zone.min.z -= 0.55;
    zone.max.z += 0.55;
    zone.max.y = pad.y + 2.2;
    reservedPadBoxes.push(zone);
    padVisuals.push({ group, arrow, pad });
  }
}
function tryJumpPad() {
  if (padCooldown > 0 || !grounded) return;
  const pos = player.group.position;
  for (const pad of jumpPads)
    if (padContact(pad, pos)) {
      // a pad with a target always throws towards it (islands); others follow the way you run onto them
      const motion = pad.target ? new T.Vector3(pad.target.x - pad.x, 0, pad.target.z - pad.z).setLength(6) : player.padMotion || lastMove.clone().multiplyScalar(6),
        impulse = padImpulse(pad, { x: motion.x, z: motion.z, y: pad.target ? 0 : player.padImpact || 0 });
      jumpFlight = { velocity: new T.Vector3(impulse.x, 0, impulse.z), vertical: impulse.vertical };
      sfx.play("jump-pad", { volume: 0.7 });
      player.padImpact = 0;
      grounded = false;
      vy = 0;
      dashTime = 0;
      padCooldown = 1;
      sound(260, 0.3, "triangle");
      impact(new T.Vector3(pad.x, pad.top + 0.1, pad.z), 0x66eeff, 0.35);
      message(
        (PAD_TIERS[pad.tier] ? PAD_TIERS[pad.tier].name.toUpperCase() + " · " : "") +
          (pad.role === "escape" ? "ЭВАКУАЦИЯ" : pad.role === "transfer" ? "ПЕРЕЛЁТ" : "ВЕРТИКАЛЬНЫЙ ОБХОД"),
        1.2,
      );
      break;
    }
}
// Head (1.6 m above the feet) crossing the underside of a bridge slab while rising.
function hitsBridgeFromBelow(x, y, nextY, z, r = 0.43) {
  return collisionIndex
    .queryPoint(x, z, r)
    .some(
      (b) =>
        b.solidFromBelow &&
        y + 1.6 <= b.min.y + 0.02 &&
        nextY + 1.6 > b.min.y &&
        x > b.min.x - r &&
        x < b.max.x + r &&
        z > b.min.z - r &&
        z < b.max.z + r,
    );
}
function updateJumpFlight(dt) {
  const steps = Math.max(1, Math.ceil(dt / 0.025)),
    step = dt / steps;
  for (let i = 0; i < steps && jumpFlight; i++) {
    const f = jumpFlight,
      p = player.group.position,
      oldY = p.y;
    move(player, f.velocity.x * step, f.velocity.z * step);
    f.vertical -= 17 * step;
    const nextY = p.y + f.vertical * step;
    if (f.vertical > 0 && (occupied(p.x, nextY, p.z) || hitsBridgeFromBelow(p.x, p.y, nextY, p.z))) {
      f.vertical = 0;
    } else p.y = nextY;
    const floor = actorFloor(p.x, p.z, oldY + 0.001);
    if (f.vertical <= 0 && p.y <= floor) {
      p.y = floor;
      jumpFlight = null;
      grounded = true;
      player.padImpact = f.vertical;
      vy = 0;
      padCooldown = 0.8;
      recoverPosition(player);
    }
  }
}
function launchBot(b, direction) {
  for (const pad of jumpPads)
    if (padContact(pad, b.group.position, 0.6)) {
      if (pad.target) direction = new T.Vector3(pad.target.x - pad.x, 0, pad.target.z - pad.z).normalize();
      const impulse = padImpulse(
        pad,
        { x: direction.x, z: direction.z, y: pad.target ? 0 : b.padImpact || 0 },
        b.elite ? 1.2 : 1,
      );
      b.flight = { velocity: new T.Vector3(impulse.x, 0, impulse.z), vertical: impulse.vertical };
      sfx.play("jump-pad", { position: b.group.position, group: "enemy", volume: 0.5 });
      b.padImpact = 0;
      b.padCooldown = 2;
      break;
    }
}
function updateBotFlight(b, dt) {
  const f = b.flight,
    p = b.group.position,
    oldY = p.y;
  move(b, f.velocity.x * dt, f.velocity.z * dt);
  f.vertical -= 17 * dt;
  if (f.vertical > 0 && hitsBridgeFromBelow(p.x, p.y, p.y + f.vertical * dt, p.z)) f.vertical = 0;
  p.y += f.vertical * dt;
  const floor = actorFloor(p.x, p.z, oldY + 0.001);
  if (f.vertical <= 0 && p.y <= floor) {
    p.y = floor;
    b.flight = null;
    b.padImpact = f.vertical;
    b.padCooldown = 0.8;
    recoverPosition(b);
  }
}
function actorFloor(x, z, ceiling = Infinity) {
  let floor = terrainHeight(x, z, ceiling);
  for (const pad of jumpPads)
    if (!pad.disabled && pad.top <= ceiling + 0.001 && Math.hypot(x - pad.x, z - pad.z) < 1.3)
      floor = Math.max(floor, pad.top);
  for (const box of collisionIndex.queryPoint(x, z))
    if (
      box.standable &&
      box.max.y <= ceiling + 0.001 &&
      x >= box.min.x + 0.08 &&
      x <= box.max.x - 0.08 &&
      z >= box.min.z + 0.08 &&
      z <= box.max.z - 0.08
    )
      floor = Math.max(floor, box.max.y);
  return floor;
}
let stairVolumeIndex = null;
function stairClearance(obj) {
  if (!stairVolumeIndex) {
    stairVolumeIndex = new SpatialIndex(8);
    for (const r of ramps) {
      const dx = r.x1 - r.x0,
        dz = r.z1 - r.z0,
        len = Math.hypot(dx, dz);
      for (let i = 0; i <= stairSteps(r); i++) {
        const t = i / stairSteps(r),
          x = r.x0 + dx * t,
          z = r.z0 + dz * t,
          y = (r.baseHeight || 0) + t * (r.h - (r.baseHeight || 0)),
          w = Math.abs(dx) > Math.abs(dz) ? len / stairSteps(r) : r.width,
          d = Math.abs(dx) > Math.abs(dz) ? r.width : len / stairSteps(r),
          corridor = new T.Box3(
            new T.Vector3(x - w / 2 - 0.15, y + 0.03, z - d / 2 - 0.15),
            new T.Vector3(x + w / 2 + 0.15, y + 1.85, z + d / 2 + 0.15),
          );
        stairVolumeIndex.insert(corridor, corridor);
      }
    }
  }
  const box = placementBox(obj);
  return !stairVolumeIndex.queryBox(box).some((zone) => zone.intersectsBox(box));
}
const MOAT_DEPTH = 4;
function terrainFloors(x, z) {
  let floors = [Math.abs(x - pit.x) <= pit.w / 2 && Math.abs(z - pit.z) <= pit.d / 2 ? pit.h : 0];
  // the hill's moat is a deep ditch: its floor is MOAT_DEPTH below the ground (bridges add a floor at 0)
  if (generatedPlan?.moat?.some((m) => Math.abs(x - m.x) <= m.w / 2 && Math.abs(z - m.z) <= m.d / 2)) floors = [-MOAT_DEPTH];
  for (const p of platforms)
    if (Math.abs(x - p.x) <= p.w / 2 + 0.001 && Math.abs(z - p.z) <= p.d / 2 + 0.001) floors = [p.h];
  for (const r of ramps) {
    const dx = r.x1 - r.x0,
      dz = r.z1 - r.z0,
      len = Math.hypot(dx, dz),
      t = ((x - r.x0) * dx + (z - r.z0) * dz) / (len * len),
      side = Math.abs((x - r.x0) * dz - (z - r.z0) * dx) / len;
    if (t >= 0 && t <= 1 && side <= r.width / 2) {
      const base = r.baseHeight || 0;
      floors = [base + (Math.ceil(t * stairSteps(r) - 1e-6) * (r.h - base)) / stairSteps(r)];
    }
  }
  for (const p of skyPlatforms)
    if (Math.abs(x - p.x) <= p.w / 2 && Math.abs(z - p.z) <= p.d / 2) floors.push(p.h);
  return [...new Set(floors)].sort((a, b) => a - b);
}
// The surface an object set at height `y` rests on: the first floor at or below y (ground, pit floor, stair,
// platform top); inside a solid block it is that block's top. Used for objects with an explicit height in maps.
function surfaceAt(x, z, y = Infinity) {
  let h = terrainHeight(x, z, y);
  for (const p of skyPlatforms)
    if (p.solid && Math.abs(x - p.x) <= p.w / 2 && Math.abs(z - p.z) <= p.d / 2 && (p.base || 0) <= y + 0.001 && y < p.h - 0.001) h = Math.max(h, p.h);
  return h;
}
function terrainHeight(x, z, ceiling = Infinity) {
  const floors = terrainFloors(x, z).filter((h) => h <= ceiling + 0.001);
  return floors.length
    ? floors[floors.length - 1]
    : Math.abs(x - pit.x) <= pit.w / 2 && Math.abs(z - pit.z) <= pit.d / 2
      ? pit.h
      : 0;
}
function terrainAsset(key, x, z, w, d, h, y = 0, rotation = 0) {
  const obj = model(key, 1);
  const size = bounds(obj).getSize(new T.Vector3());
  obj.scale.set(w / Math.max(size.x, 0.001), size.y > 0.001 ? h / size.y : 1, d / Math.max(size.z, 0.001));
  obj.position.set(x, y, z);
  obj.rotation.y = rotation;
  scene.add(obj);
  obj.updateMatrixWorld(true);
  obj.traverse((n) => {
    if (n.isMesh) {
      n.userData.batchTerrain = true;
      terrainMeshes.push(n);
      solidMeshes.push(n);
    }
  });
  return obj;
}
// Generation rule: every stair tread has a continuous foundation down to the ground.
// Tread heights match terrainHeight and remain low enough to walk without jumping.
function stairSteps(r) {
  return Math.max(9, Math.ceil(Math.abs(r.h - (r.baseHeight || 0)) / 0.32));
}
function buildSolidStaircase(r) {
  const dx = r.x1 - r.x0,
    dz = r.z1 - r.z0,
    length = Math.hypot(dx, dz),
    alongX = Math.abs(dx) > Math.abs(dz),
    base = Math.min(0, r.h) - 0.13,
    steps = stairSteps(r);
  const side = new T.MeshStandardMaterial({ color: 0xa58a69, roughness: 1 }),
    top = new T.MeshStandardMaterial({ color: 0xcdb38e, roughness: 1 }),
    materials = [side, side, top, side, side, side];
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps,
      topY = (r.baseHeight || 0) + ((i + 1) * (r.h - (r.baseHeight || 0))) / steps,
      height = topY - base,
      step = new T.Mesh(
        new T.BoxGeometry(alongX ? length / steps : r.width, height, alongX ? r.width : length / steps),
        materials,
      );
    step.position.set(T.MathUtils.lerp(r.x0, r.x1, t), base + height / 2, T.MathUtils.lerp(r.z0, r.z1, t));
    step.userData.foundationStair = true;
    step.castShadow = true;
    /* Closely spaced stair faces cause shadow-map acne at arena scale. Keep direct lighting and outgoing shadows, omit shadow reception on these treads only. */ step.receiveShadow = false;
    scene.add(step);
    terrainMeshes.push(step);
    solidMeshes.push(step);
  }
}
// Descending stair cutouts need vertical retaining faces along both sides.
// Keep these outside the tread footprint so the entry and lower exit stay open.
function buildStairRetainingWalls(r) {
  if (r.h >= 0) return;
  const alongX = Math.abs(r.x1 - r.x0) > Math.abs(r.z1 - r.z0),
    length = Math.hypot(r.x1 - r.x0, r.z1 - r.z0),
    bottom = r.h - 0.13,
    thickness = 0.2;
  const material = new T.MeshStandardMaterial({ color: 0xa27f55, roughness: 1 });
  for (const side of [-1, 1]) {
    const wall = new T.Mesh(
      new T.BoxGeometry(alongX ? length : thickness, -bottom, alongX ? thickness : length),
      material,
    );
    wall.position.set(
      (r.x0 + r.x1) / 2 + (alongX ? 0 : side * (r.width / 2 + thickness / 2)),
      bottom / 2,
      (r.z0 + r.z1) / 2 + (alongX ? side * (r.width / 2 + thickness / 2) : 0),
    );
    wall.userData.stairRetainingWall = true;
    wall.castShadow = true;
    wall.receiveShadow = true;
    scene.add(wall);
    terrainMeshes.push(wall);
    solidMeshes.push(wall);
  }
}
function buildTerrain() {
  const bottom = new T.Mesh(
    new T.PlaneGeometry(pit.w, pit.d),
    new T.MeshStandardMaterial({ color: 0x877257, roughness: 1 }),
  );
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.set(pit.x, pit.h - 0.08, pit.z);
  bottom.receiveShadow = true;
  scene.add(bottom);
  terrainMeshes.push(bottom);
  solidMeshes.push(bottom);
  // Ravine faces stop at every stair mouth. No wall may seal an exit.
  for (const side of [-1, 1]) {
    const x = side * (pit.w / 2 + 0.1),
      mouth = side < 0 ? 14 : -5;
    for (const [a, b] of [
      [-25, mouth - 2.5],
      [mouth + 2.5, 25],
    ])
      tintTerrain(terrainAsset("arena/block", x, (a + b) / 2, 0.2, b - a, -pit.h, pit.h), 0x514b41, 0.8);
  }
  for (const z of [-25.1, 25.1])
    for (const x of [-5.3, 5.3])
      tintTerrain(terrainAsset("arena/block", x, z, 5.4, 0.2, -pit.h, pit.h), 0x514b41, 0.8);

  for (const p of platforms) {
    if (p.model) {
      if (p.model === "dungeon/floor-detail") {
        terrainAsset("arena/block", p.x, p.z, p.w, p.d, p.h);
        terrainAsset(p.model, p.x, p.z, p.w, p.d, 0.04, p.h + 0.01);
      } else terrainAsset(p.model, p.x, p.z, p.w, p.d, p.h);
      platformEdges(p);
    } else {
      tintTerrain(terrainAsset("arena/block", p.x, p.z, p.w, p.d, p.h), 0xa58a69, 0.7);
      tileSurface(p);
    }
  }
  for (const r of ramps) {
    buildSolidStaircase(r);
    buildStairRetainingWalls(r);
  }
}
const runtimeStats = { terrainBeforeBatch: 0, terrainAfterBatch: 0 };
function batchTerrain() {
  scene.updateMatrixWorld(true);
  runtimeStats.terrainBeforeBatch = terrainMeshes.length;
  const groups = new Map();
  for (const mesh of terrainMeshes) {
    if (!mesh.userData.batchTerrain || Array.isArray(mesh.material)) continue;
    const pos = mesh.getWorldPosition(new T.Vector3()),
      m = mesh.material,
      key = [
        mesh.geometry.uuid,
        m.color.getHex(),
        m.map?.uuid,
        m.transparent, // fading (walls) and never-fading (bridge decks) pieces are never batched together
        Math.floor(pos.x / 16),
        Math.floor(pos.z / 16),
      ].join(":");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(mesh);
  }
  for (const meshes of groups.values()) {
    if (meshes.length < 2) continue;
    const inst = new T.InstancedMesh(meshes[0].geometry, meshes[0].material, meshes.length);
    meshes.forEach((m, i) => inst.setMatrixAt(i, m.matrixWorld));
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.computeBoundingBox();
    inst.computeBoundingSphere();
    scene.add(inst);
    for (const mesh of meshes) {
      mesh.parent.remove(mesh);
      terrainMeshes.splice(terrainMeshes.indexOf(mesh), 1);
      solidMeshes.splice(solidMeshes.indexOf(mesh), 1);
    }
    terrainMeshes.push(inst);
    solidMeshes.push(inst);
  }
  runtimeStats.terrainAfterBatch = terrainMeshes.length;
}
function navCell(p) {
  return {
    x: T.MathUtils.clamp(Math.round((p.x - navMin) / navStep), 0, navSize - 1),
    z: T.MathUtils.clamp(Math.round((p.z - navMin) / navStep), 0, navSize - 1),
  };
}
function navIndex(x, z) {
  return z * navSize + x;
}
let navigation = null;
function buildNavigation() {
  scene.updateMatrixWorld(true);
  collisionIndex.clear();
  for (const box of obstacles) collisionIndex.insert(box, box);
  worldIndex.clear();
  for (const mesh of solidMeshes) worldIndex.insert(mesh, bounds(mesh));
  terrainIndex.clear();
  for (const mesh of terrainMeshes) terrainIndex.insert(mesh, bounds(mesh));
  navigation = new LayeredNavigation({
    min: navMin,
    size: navSize,
    step: navStep,
    floors: terrainFloors,
    clear: (x, y, z) =>
      // the stake ditch is not a place to walk: no nodes down there (bots never step in, nobody spawns there)
      !(y < -1.5 && generatedPlan?.moat?.some((m) => Math.abs(x - m.x) <= m.w / 2 && Math.abs(z - m.z) <= m.d / 2)) &&
      !occupied(x, y, z, 0.6) &&
      !skyPlatforms.some(
        (p) =>
          p.h > y + 0.01 &&
          p.h - 0.65 < y + 1.8 &&
          Math.abs(x - p.x) < p.w / 2 &&
          Math.abs(z - p.z) < p.d / 2,
      ),
  });
  navGrid = Array.from({ length: navSize * navSize }, (_, i) => navigation.cells[i].length > 0);
  // targeted pads are one-way links in the graph: bots walk onto the pad and get thrown to the target
  for (const pad of jumpPads) {
    if (!pad.target) continue;
    const from = navigation.nearest(new T.Vector3(pad.x, pad.y, pad.z)),
      to = navigation.nearest(new T.Vector3(pad.target.x, pad.target.y ?? terrainHeight(pad.target.x, pad.target.z), pad.target.z));
    if (from < 0 || to < 0 || from === to) continue;
    const n = navigation.nodes[from],
      t = navigation.nodes[to];
    if (Math.hypot(n.x - pad.x, n.z - pad.z) > 2.5 || Math.abs(n.y - pad.y) > 1.5) continue;
    // the path search runs backwards from the goal over node.edges, so a one-way link from → to is stored on `to`
    (t.extra ||= []).push(from);
    if (!t.edges.includes(from)) t.edges.push(from);
  }
}
function nearestOpen(cell) {
  if (navGrid[navIndex(cell.x, cell.z)]) return cell;
  for (let r = 1; r < 6; r++)
    for (let z = Math.max(0, cell.z - r); z <= Math.min(navSize - 1, cell.z + r); z++)
      for (let x = Math.max(0, cell.x - r); x <= Math.min(navSize - 1, cell.x + r); x++)
        if (navGrid[navIndex(x, z)]) return { x, z };
  return cell;
}
function findPath(from, to) {
  return navigation.path(from, to).map((p) => new T.Vector3(p.x, p.y, p.z));
}
function occupied(x, y, z, r = 0.43) {
  return (
    ramps.some((stair) => {
      const dx = stair.x1 - stair.x0,
        dz = stair.z1 - stair.z0,
        len = Math.hypot(dx, dz),
        t = ((x - stair.x0) * dx + (z - stair.z0) * dz) / (len * len),
        side = Math.abs((x - stair.x0) * dz - (z - stair.z0) * dx) / len;
      if (t < 0 || t > 1 || side > stair.width / 2) return false;
      const h =
        (stair.baseHeight || 0) +
        (Math.ceil(t * stairSteps(stair) - 1e-6) * (stair.h - (stair.baseHeight || 0))) / stairSteps(stair);
      return y + 0.4 < h;
    }) ||
    platforms.some(
      (p) =>
        y + 0.4 < p.h &&
        x > p.x - p.w / 2 - r &&
        x < p.x + p.w / 2 + r &&
        z > p.z - p.d / 2 - r &&
        z < p.z + p.d / 2 + r,
    ) ||
    collisionIndex
      .queryPoint(x, z, r)
      .some(
        (b) =>
          !b.oneWay &&
          y < b.max.y - 0.001 &&
          y + 1.6 > b.min.y + 0.001 &&
          x > b.min.x - r &&
          x < b.max.x + r &&
          z > b.min.z - r &&
          z < b.max.z + r,
      )
  );
}
function slideOffEdges(p, r) {
  for (let pass = 0; pass < 2; pass++) {
    let pushed = false;
    for (const b of collisionIndex.queryPoint(p.x, p.z, r)) {
      if (b.oneWay || p.y >= b.max.y - 0.001 || p.y + 1.6 <= b.min.y + 0.001) continue;
      const left = p.x - (b.min.x - r),
        right = b.max.x + r - p.x,
        back = p.z - (b.min.z - r),
        front = b.max.z + r - p.z;
      if (left <= 0 || right <= 0 || back <= 0 || front <= 0) continue;
      const m = Math.min(left, right, back, front);
      if (m > r + 0.05) continue; // deep inside (not an edge case): leave it to recoverPosition
      if (m === left) p.x -= left + 0.01;
      else if (m === right) p.x += right + 0.01;
      else if (m === back) p.z -= back + 0.01;
      else p.z += front + 0.01;
      pushed = true;
    }
    if (!pushed) break;
  }
}
function recoverPosition(c) {
  const p = c.group.position,
    r = c.isBot ? (c.elite ? 0.78 : 0.6) : 0.43;
  if (!occupied(p.x, p.y, p.z, r)) {
    c.safePosition = p.clone();
    return;
  }
  if (!c.isBot) runtimeStats.playerRecover = (runtimeStats.playerRecover || 0) + 1;
  // Find the nearest free patch on the current level, including after landing or spawning.
  for (let radius = 0.12; radius <= 4; radius += 0.12) {
    const count = Math.max(16, Math.ceil(radius * 48));
    for (let i = 0; i < count; i++) {
      const angle = (i * Math.PI * 2) / count,
        x = p.x + Math.cos(angle) * radius,
        z = p.z + Math.sin(angle) * radius,
        floor = actorFloor(x, z, p.y + 0.4),
        y = Math.max(p.y, floor);
      if (Math.abs(x) > WORLD_LIMIT || Math.abs(z) > WORLD_LIMIT || floor > p.y + 0.4 || occupied(x, y, z, r))
        continue;
      p.set(x, y, z);
      c.safePosition = p.clone();
      return;
    }
  }
  if (c.safePosition && !occupied(c.safePosition.x, c.safePosition.y, c.safePosition.z, r))
    p.copy(c.safePosition);
}
function move(c, dx, dz) {
  recoverPosition(c);
  const p = c.group.position,
    steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.12));
  dx /= steps;
  dz /= steps;
  const canStand = (x, z) => {
    const floor = actorFloor(x, z, p.y + 0.4);
    return (
      floor <= p.y + 0.4 && !occupied(x, Math.max(p.y, floor), z, c.isBot ? (c.elite ? 0.78 : 0.6) : 0.43)
    );
  };
  for (let i = 0; i < steps; i++) {
    const nx = T.MathUtils.clamp(p.x + dx, -WORLD_LIMIT, WORLD_LIMIT);
    if (canStand(nx, p.z)) {
      p.x = nx;
      const floor = actorFloor(p.x, p.z, p.y + 0.4);
      if (floor > p.y || (c.isBot && !c.flight)) p.y = floor;
    }
    const nz = T.MathUtils.clamp(p.z + dz, -WORLD_LIMIT, WORLD_LIMIT);
    if (canStand(p.x, nz)) {
      p.z = nz;
      const floor = actorFloor(p.x, p.z, p.y + 0.4);
      if (floor > p.y || (c.isBot && !c.flight)) p.y = floor;
    }
  }
  recoverPosition(c);
}
function intersectWorld(caster) {
  return caster.intersectObjects(
    worldIndex.querySegment(caster.ray.origin, caster.ray.direction, caster.far),
    false,
  );
}
function visible(a, b) {
  const d = b.clone().sub(a),
    len = d.length();
  ray.set(a, d.normalize());
  ray.far = len;
  return !intersectWorld(ray).some((h) => h.distance < len - 0.2);
}
const effectGeometries = new Map();
function sharedSphere(...args) {
  const key = "sphere:" + args.join(",");
  if (!effectGeometries.has(key)) {
    const g = new T.SphereGeometry(...args);
    g.userData.shared = true;
    effectGeometries.set(key, g);
  }
  return effectGeometries.get(key);
}
function sharedBolt(radius, length) {
  const key = "bolt:" + radius + ":" + length;
  if (!effectGeometries.has(key)) {
    const g = new T.CylinderGeometry(radius, radius, length, 6);
    g.userData.shared = true;
    effectGeometries.set(key, g);
  }
  return effectGeometries.get(key);
}
// effects can be single meshes or groups (dash after-images); groups that reuse a model's geometry
// (userData.keepGeometry) only free their own materials
function disposeEffect(obj) {
  obj.traverse((n) => {
    if (!n.isMesh) return;
    if (!obj.userData.keepGeometry && !n.geometry.userData.shared) n.geometry.dispose();
    n.material.dispose();
  });
}
function addEffect(obj, life, extra = {}) {
  if (effects.length >= 256) {
    const oldest = effects.shift();
    scene.remove(oldest.obj);
    disposeEffect(oldest.obj);
  }
  scene.add(obj);
  effects.push({ obj, life, max: life, ...extra });
}
function tracer(a, b, color, kind = 2, enemy = false, thick = 0) {
  const delta = b.clone().sub(a),
    length = delta.length();
  if (length < 0.01) return;
  const radius = thick || (enemy ? 0.026 : kind === 0 ? 0.07 : kind === 1 ? 0.035 : 0.045);
  const obj = new T.Mesh(
    new T.CylinderGeometry(radius, radius, length, 6),
    new T.MeshBasicMaterial({
      color: HDR(color, kind === 0 ? 7 : 3),
      transparent: true,
      opacity: enemy ? 0.65 : 1,
      depthWrite: false,
    }),
  );
  obj.position.copy(a).add(b).multiplyScalar(0.5);
  obj.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), delta.normalize());
  addEffect(obj, enemy ? 0.14 : kind === 0 ? 0.24 : 0.17);
  if (!enemy) {
    const glow = new T.Mesh(
      new T.CylinderGeometry(radius * 2.3, radius * 2.3, length, 6),
      new T.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.3,
        blending: T.AdditiveBlending,
        depthWrite: false,
      }),
    );
    glow.position.copy(obj.position);
    glow.quaternion.copy(obj.quaternion);
    addEffect(glow, kind === 0 ? 0.25 : 0.18, { initialOpacity: 0.3 });
  }
}
function impact(p, color = 0xffc25b, size = 0.4) {
  const ring = new T.Mesh(
    new T.RingGeometry(0.65, 1, 24),
    new T.MeshBasicMaterial({ color, transparent: true, side: T.DoubleSide, depthWrite: false }),
  );
  ring.quaternion.copy(camera.quaternion);
  ring.position.copy(p);
  ring.scale.setScalar(size);
  addEffect(ring, 0.26, { grow: 3 });
  burst(p, color);
}
function muzzleFlash(p, kind) {
  const w = weapons[kind],
    obj = new T.Mesh(
      sharedSphere(w.kind === 1 || w.kind === 3 ? 0.35 : 0.2, 8, 6),
      new T.MeshBasicMaterial({
        color: HDR(w.color, 5),
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending,
      }),
    );
  obj.position.copy(p);
  addEffect(obj, 0.08, { grow: 2 });
  flashes.flash(
    p,
    w.color,
    w.kind === 4 ? 60 : w.kind === 1 || w.kind === 3 ? 45 : 25,
    w.kind === 4 ? 9 : 7,
    0.09,
  );
}
function burst(p, color = 0xffbf50) {
  for (let i = 0; i < 8; i++) {
    const obj = new T.Mesh(sharedSphere(0.055, 6, 4), new T.MeshBasicMaterial({ color, transparent: true }));
    obj.position.copy(p);
    addEffect(obj, 0.3, {
      velocity: new T.Vector3((Math.random() - 0.5) * 5, Math.random() * 3, (Math.random() - 0.5) * 5),
    });
  }
}
function buildMedkits() {
  for (const [x, z] of generatedPlan
    ? extraMedkits
    : [
        [0, 12],
        [-18, 8],
        [12, -8],
        [-22, -20],
        [22, 22],
        [24, -20],
        [37, -27],
        [8, 43],
        [-39, 0],
        ...extraMedkits,
      ]) {
    const group = model("guns/crate-small", 0.75);
    group.traverse((n) => {
      if (n.isMesh) {
        n.material = n.material.clone();
        n.material.color.set(0xdffff0);
      }
    });
    const top = bounds(group).max.y;
    const cross = new T.Group(),
      mat = new T.MeshBasicMaterial({ color: 0x22e59a });
    for (const [w, d] of [
      [0.48, 0.14],
      [0.14, 0.48],
    ]) {
      const mark = new T.Mesh(new T.BoxGeometry(w, 0.025, d), mat);
      cross.add(mark);
    }
    cross.position.y = top + 0.02;
    group.add(cross);
    const ring = new T.Mesh(
      new T.RingGeometry(0.55, 0.68, 24),
      new T.MeshBasicMaterial({ color: 0x22e59a, side: T.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    group.add(ring);
    group.userData.pickup = true;
    if (!placeOnSurface(group, x, z)) continue;
    scene.add(group);
    registerPlacement(group, true);
    medkits.push({ group, used: false });
  }
}
let nearestKit = null;
function updateMedkits() {
  nearestKit = null;
  let best = 1.6;
  for (const kit of medkits) {
    if (kit.used) continue;
    const d = kit.group.position.distanceTo(player.group.position);
    if (d > best) continue;
    const a = player.group.position.clone().add(new T.Vector3(0, 0.4, 0)),
      b = kit.group.position.clone().add(new T.Vector3(0, 0.4, 0));
    if (!visible(a, b)) continue;
    best = d;
    nearestKit = kit;
  }
  if (!active || nearestDrop || !nearestKit) return;
  const tip = $("pickup");
  tip.hidden = false;
  tip.textContent =
    hp >= playerMaxHp ? "АПТЕЧКА · ЗДОРОВЬЕ ПОЛНОЕ" : "E · АПТЕЧКА +" + Math.ceil(Math.min(40, playerMaxHp - hp)) + " ЗДОРОВЬЯ";
  const p = nearestKit.group.position
    .clone()
    .add(new T.Vector3(0, 1.2, 0))
    .project(camera);
  tip.style.left = (p.x * 0.5 + 0.5) * innerWidth + "px";
  tip.style.top = (-p.y * 0.5 + 0.5) * innerHeight + "px";
}
function useMedkit() {
  if (!active || !nearestKit || nearestKit.used || hp >= playerMaxHp) return;
  const kit = nearestKit;
  kit.used = true;
  nearestKit = null;
  scene.remove(kit.group);
  const healed = Math.ceil(Math.min(40, playerMaxHp - hp));
  hp += healed;
  sound(880, 0.12, "triangle");
  message("АПТЕЧКА · +" + healed + " ЗДОРОВЬЯ", 1.8);
  updateHUD();
  $("pickup").hidden = true;
}
function makeExplosive(x, z) {
  const group = model("guns/crate-small", 1.4);
  group.traverse((n) => {
    if (n.isMesh) {
      n.material = n.material.clone();
      n.material.color.set(0xff4f39);
    }
  });
  const ring = new T.Mesh(
    new T.RingGeometry(0.85, 1, 24),
    new T.MeshBasicMaterial({ color: 0xff4f39, transparent: true, opacity: 0.9, side: T.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  group.add(ring);
  if (!placeOnSurface(group, x, z)) return null;
  scene.add(group);
  registerPlacement(group, true);
  group.updateMatrixWorld(true);
  const box = bounds(group.children[0]);
  obstacles.push(box);
  const entry = { group, box, dead: false, hp: 20 };
  explosives.push(entry);
  return entry;
}
// Breakable crates and barrels: hide from rays, throw debris, no blast.
function shatter(crate) {
  const p = crate.group.position.clone(),
    size = crate.box.getSize(new T.Vector3()),
    wood = crate.key.includes("pot")
      ? 0xb8683f
      : crate.key.includes("chest")
        ? 0x7a4a2a
        : crate.key.includes("barrel")
          ? 0x8a5a34
          : 0xa8733f,
    ceramic = crate.key.includes("pot");
  crate.group.traverse((n) => {
    if (n.isMesh) n.layers.disableAll();
  });
  if (ceramic) {
    sound(900, 0.06, "triangle", 0.04);
    sound(520, 0.12, "square", 0.03);
  } else {
    sound(140, 0.12, "square", 0.04);
    sound(90, 0.18, "triangle", 0.05);
  }
  impact(p.clone().add(new T.Vector3(0, 0.15, 0)), 0xd9a066, 0.8);
  shake = Math.max(shake, 0.08);
  const pieces = Math.min(14, 6 + Math.round(size.x * size.z * 2));
  for (let i = 0; i < pieces; i++) {
    const metal = crate.key.includes("chest") && i % 4 === 0,
      w = ceramic ? 0.08 + Math.random() * 0.16 : 0.12 + Math.random() * 0.28,
      piece = new T.Mesh(
        new T.BoxGeometry(
          w,
          ceramic ? 0.03 : 0.06 + Math.random() * 0.1,
          ceramic ? 0.06 + Math.random() * 0.14 : 0.1 + Math.random() * 0.3,
        ),
        new T.MeshStandardMaterial({
          color: metal ? 0xc9a14a : new T.Color(wood).offsetHSL(0, 0, (Math.random() - 0.5) * 0.12),
          roughness: metal ? 0.35 : ceramic ? 0.6 : 0.9,
          metalness: metal ? 0.6 : 0,
          transparent: true,
        }),
      );
    piece.position.set(
      p.x + (Math.random() - 0.5) * size.x,
      p.y + Math.random() * size.y,
      p.z + (Math.random() - 0.5) * size.z,
    );
    piece.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    piece.castShadow = true;
    addEffect(piece, 1.6 + Math.random() * 0.8, {
      velocity: new T.Vector3((Math.random() - 0.5) * 7, 3 + Math.random() * 4, (Math.random() - 0.5) * 7),
      gravity: 16,
      spin: (Math.random() - 0.5) * 14,
      floor: terrainHeight(piece.position.x, piece.position.z) + 0.04,
    });
  }
  updateHUD();
}
function explode(crate) {
  if (crate.dead) return;
  const tower = towers.find((t) => t.barrel === crate && !t.down);
  if (tower) setTimeout(() => collapseTower(tower), 120); // the blast first, then the tower goes
  crate.dead = true;
  scene.remove(crate.group);
  const index = obstacles.indexOf(crate.box);
  if (index >= 0) obstacles.splice(index, 1);
  collisionIndex.remove(crate.box);
  navigationQueue.push(crate.box.clone()); // local refresh of the navigation around it (not a full rebuild)
  if (crate.inert) {
    shatter(crate);
    return;
  }
  if (performance.now() - (rocketExplosion.lastSound || 0) > 120) {
    rocketExplosion.lastSound = performance.now();
    sfx.play("rocket-blast", { position: crate.group.position, group: "impact", volume: 0.8 });
    sfx.duck(0.3, 0.35);
  }
  const p = crate.group.position.clone();
  blastWalls(p, 4.5, 100);
  impact(p.clone().add(new T.Vector3(0, 0.1, 0)), 0xff6b28, 1.2);
  shake = Math.max(shake, 0.25);
  sound(65, 0.3, "sawtooth", 0.08);
  const flash = new T.Mesh(
    sharedSphere(1, 12, 8),
    new T.MeshBasicMaterial({ color: HDR(0xffb43e, 6), transparent: true, opacity: 0.8, depthWrite: false }),
  );
  flash.position.copy(p).y = p.y + 0.7;
  addEffect(flash, 0.32, { grow: 7, initialOpacity: 0.8 });
  flashes.flash(p.clone().add(new T.Vector3(0, 1.2, 0)), 0xff7a30, 520, 18, 0.5);
  const crateCenter = p.clone().add(new T.Vector3(0, 0.7, 0)),
    blastSees = (o) => visible(crateCenter, o.clone().add(new T.Vector3(0, 1.05, 0)));
  for (const b of bots)
    if (!b.dead && b.group.position.distanceTo(p) < 4.5 && blastSees(b.group.position)) {
      b.hp -= 95;
      b.stun = 0.4;
      if (b.hp <= 0) kill(b, "barrel");
    }
  if (player.group.position.distanceTo(p) < 4.5 && blastSees(player.group.position)) damagePlayer(20);
  for (const c of explosives) if (!c.dead && c !== crate && c.group.position.distanceTo(p) < 4.5) explode(c);
  updateHUD();
}
// Dash. Kills store power charges (up to 2): with a charge the dash becomes a power dash — about twice as far
// (0.28 s at 34 m/s ≈ 9.5 m), ignores the cooldown, and rams enemies on its way (damage + knock-back).
// Without charges it is the ordinary short dash on a 1.4 s cooldown.
const DASH_CHARGES_MAX = 2;
function dash() {
  if (!active) return;
  const power = dashCharges > 0;
  if (!power && dashCooldown > 0) return;
  dashDirection.copy(lastMove).normalize();
  dashPower = power;
  if (power) {
    dashCharges--;
    dashTime = 0.28;
    dashCooldown = Math.max(dashCooldown, 0.35);
    shake = Math.max(shake, 0.12);
    flashes.flash(player.group.position.clone().add(new T.Vector3(0, 1, 0)), 0x80e8ff, 80, 8, 0.2);
    for (const b of bots) b.dashHit = false;
    if (hasLegend("blastdash")) dropBlastMine(player.group.position.clone());
  } else {
    dashTime = 0.18;
    dashCooldown = 1.4;
  }
  sound(power ? 95 : 150, power ? 0.18 : 0.1, power ? "sawtooth" : "triangle", power ? 0.04 : 0.025);
  impact(player.group.position.clone().add(new T.Vector3(0, 0.08, 0)), 0x80e8ff, power ? 0.9 : 0.5);
  updateHUD();
}
// Speed effect of a dash: cyan after-images of the player left along the path, streaks behind,
// a radial speed blur on screen (post pass) and, in the rear view, a quick field-of-view kick.
let speedFx = 0,
  runFx = 0,
  ghostTimer = 0;
const ghostMaterial = new T.MeshBasicMaterial({ color: HDR(0x80e8ff, 1.6), transparent: true, opacity: 0.5, depthWrite: false, blending: T.AdditiveBlending });
function updateSpeedEffect(dt) {
  const dashing = dashTime > 0;
  speedFx = dashing ? Math.min(1, speedFx + dt * 14) : Math.max(0, speedFx - dt * 5);
  if (dashing) {
    ghostTimer -= dt;
    if (ghostTimer <= 0) {
      ghostTimer = dashPower ? 0.045 : 0.06;
      // after-image: a frozen copy of the body in additive cyan, fading out
      const ghost = clone(player.group.children[0]);
      ghost.traverse((n) => n.isMesh && ((n.material = ghostMaterial.clone()), (n.castShadow = false)));
      ghost.userData.keepGeometry = true; // shares the player's skinned geometry
      ghost.position.add(player.group.position);
      ghost.rotation.y = player.group.rotation.y;
      addEffect(ghost, 0.28, { initialOpacity: 0.5 });
      // streaks: thin glowing lines behind the body
      for (let k = 0; k < (dashPower ? 3 : 2); k++) {
        const len = 1.4 + Math.random() * 1.6,
          streak = new T.Mesh(
            new T.BoxGeometry(0.04, 0.04, len),
            new T.MeshBasicMaterial({ color: HDR(0xbff6ff, 3), transparent: true, opacity: 0.8, depthWrite: false, blending: T.AdditiveBlending }),
          );
        streak.position.copy(player.group.position).add(new T.Vector3((Math.random() - 0.5) * 0.9, 0.3 + Math.random() * 1.4, (Math.random() - 0.5) * 0.9)).addScaledVector(dashDirection, -len * 0.6);
        streak.lookAt(streak.position.clone().add(dashDirection));
        addEffect(streak, 0.18, { initialOpacity: 0.8 });
      }
    }
  }
  // running: a light version — the view widens a little and the edges blur faintly, no after-images
  const running = active && grounded && !jumpFlight && lastStepMoving && lastStepSprint;
  runFx = T.MathUtils.lerp(runFx, running ? 1 : 0, 1 - Math.exp(-(running ? 3 : 5) * dt));
  if (post?.setSpeedBlur) {
    const sp = player.group.position.clone().add(new T.Vector3(0, 1, 0)).project(camera);
    post.setSpeedBlur(Math.max(speedFx * (dashPower ? 0.07 : 0.045), runFx * 0.012), (sp.x + 1) / 2, (sp.y + 1) / 2);
  }
  if (viewMode === "rear") {
    rearCamera.fov = 65 + runFx * 6 + speedFx * (dashPower ? 12 : 7);
    rearCamera.updateProjectionMatrix();
  } else {
    // the isometric camera is orthographic: "wider view" = zooming out a few percent
    const zoom = 1 / (1 + runFx * 0.06 + speedFx * 0.05);
    if (Math.abs(isoCamera.zoom - zoom) > 0.0005) {
      isoCamera.zoom = zoom;
      isoCamera.updateProjectionMatrix();
    }
  }
}
// power dash contact: every enemy the dash passes through takes 35 damage once and is thrown aside
function updatePowerDash() {
  if (dashTime > 0)
    for (const b of bots) if (!b.dead && b.shield && b.group.position.distanceTo(player.group.position) < 1.8) breakShield(b);
  if (!(dashTime > 0 && dashPower)) return;
  const p = player.group.position;
  for (const b of bots) {
    if (b.dead || b.dashHit || b.group.position.distanceTo(p) > 1.6) continue;
    b.dashHit = true;
    b.hp -= 35;
    b.flash = 0.14;
    b.stun = Math.max(b.stun, 0.6);
    move(b, dashDirection.x * 2.5 - dashDirection.z * b.side * 1.5, dashDirection.z * 2.5 + dashDirection.x * b.side * 1.5);
    hitSound(b.group.position);
    impact(b.group.position.clone().add(new T.Vector3(0, 1, 0)), 0x80e8ff, 0.7);
    hits++;
    runStats.otherHits++;
    hitTime = 0.16;
    if (b.hp <= 0) kill(b, "dash");
  }
}
function spawnDrop(index, position, rounds = weapons[index].mag) {
  const group = new T.Group(),
    gun = model("guns/" + weapons[index].model, 1.4);
  gun.rotation.z = Math.PI / 2;
  const b = bounds(gun);
  gun.position.y = 0.18 - b.min.y;
  group.add(gun);
  const ring = new T.Mesh(
    new T.RingGeometry(0.7, 0.85, 32),
    new T.MeshBasicMaterial({
      color: weapons[index].color,
      transparent: true,
      opacity: 0.8,
      side: T.DoubleSide,
      depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  group.add(ring);
  group.userData.pickup = true;
  group.userData.rotatingPickup = true;
  if (!placeOnSurface(group, position.x, position.z, position.y + 0.4)) return null;
  scene.add(group);
  registerPlacement(group);
  const drop = { group, gun, ring, index, ammo: rounds, phase: Math.random() * 6, baseY: gun.position.y };
  drops.push(drop);
  return drop;
}
// Sky drop: a capsule falls onto an open, reachable spot 12–40 m from the player with a beacon beam visible
// from afar, and leaves a weapon of the current tier (sometimes of the previous one). The beam stays until
// the weapon is picked up.
const skyDrops = [],
  SKY_DROP_HEIGHT = 45,
  SKY_DROP_FALL = 1.6; // seconds
function skyDropWeapon() {
  const top = Math.min(wave, 3),
    tier = Math.random() < 0.25 && top > 1 ? top - 1 : top,
    list = weapons.map((w, i) => i).filter((i) => (weapons[i].tier || 1) === tier);
  return list[Math.floor(Math.random() * list.length)];
}
function skyDropSpot() {
  const me = player.group.position;
  for (let attempt = 0; attempt < 40; attempt++) {
    const angle = Math.random() * Math.PI * 2,
      r = 24 + Math.random() * 30, // far enough that grabbing it means a run
      cell = nearestOpen(navCell({ x: me.x + Math.cos(angle) * r, z: me.z + Math.sin(angle) * r }));
    if (!navGrid[navIndex(cell.x, cell.z)]) continue;
    const x = navMin + cell.x * navStep,
      z = navMin + cell.z * navStep,
      p = new T.Vector3(x, terrainHeight(x, z), z);
    if (occupied(p.x, p.y, p.z, 1) || Math.hypot(x - me.x, z - me.z) < 18 || p.y < -1.5) continue;
    if (!findPath(p, me).length) continue;
    return p;
  }
  return null;
}
function skyDrop() {
  if (!player || !navigation) return;
  const spot = skyDropSpot();
  if (!spot) return;
  const index = skyDropWeapon(),
    color = weapons[index].color ?? 0x7dd8ff,
    capsule = new T.Group(),
    shell = new T.MeshStandardMaterial({ color: 0xd9dde4, metalness: 0.6, roughness: 0.35 }),
    glow = new T.MeshBasicMaterial({ color });
  const body = new T.Mesh(new T.CylinderGeometry(0.55, 0.55, 1.5, 16), shell);
  body.position.y = 0.95;
  const nose = new T.Mesh(new T.ConeGeometry(0.55, 0.6, 16), shell);
  nose.position.y = 0.2;
  nose.rotation.x = Math.PI;
  const band = new T.Mesh(new T.CylinderGeometry(0.57, 0.57, 0.22, 16), glow);
  band.position.y = 1.1;
  const top = new T.Mesh(new T.CylinderGeometry(0.3, 0.55, 0.3, 16), shell);
  top.position.y = 1.85;
  capsule.add(body, nose, band, top);
  capsule.traverse((n) => n.isMesh && (n.castShadow = true));
  capsule.position.set(spot.x, spot.y + SKY_DROP_HEIGHT, spot.z);
  scene.add(capsule);
  const beam = new T.Mesh(
    new T.CylinderGeometry(0.35, 0.35, 60, 12, 1, true),
    new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide }),
  );
  beam.position.set(spot.x, spot.y + 30, spot.z);
  beam.userData.skyBeam = true;
  scene.add(beam);
  skyDrops.push({ capsule, beam, spot, index, wave, t: 0, landed: false, drop: null, fade: 0 });
}
function updateSkyDrops(dt) {
  for (let i = skyDrops.length - 1; i >= 0; i--) {
    const d = skyDrops[i];
    d.t += dt;
    d.beam.material.opacity = 0.25 + Math.sin(time * 4 + i) * 0.1;
    if (!d.landed) {
      const k = Math.min(1, d.t / SKY_DROP_FALL);
      d.capsule.position.y = d.spot.y + SKY_DROP_HEIGHT * (1 - k * k);
      d.capsule.rotation.y += dt * 3;
      if (k >= 1) {
        d.landed = true;
        impact(d.spot.clone().add(new T.Vector3(0, 0.6, 0)), weapons[d.index].color ?? 0x7dd8ff, 1.4);
        sfx.play("rocket-blast", { position: d.spot, group: "impact", volume: 0.45, rate: 1.3 });
        shake = Math.max(shake, 0.15 * Math.max(0, 1 - d.spot.distanceTo(player.group.position) / 30));
        d.drop = spawnDrop(d.index, d.spot);
        message("СБРОС: " + weapons[d.index].name, 2);
      }
    } else if (d.fade < 1) {
      // the capsule sinks into the ground and disappears after landing
      d.fade = Math.min(1, d.fade + dt / 1.5);
      d.capsule.position.y = d.spot.y - d.fade * 2.2;
      if (d.fade >= 1) scene.remove(d.capsule);
    }
    if (d.landed && (!d.drop || !drops.includes(d.drop))) {
      if (d.fade >= 1) {
        removeSkyDrop(i);
      } else d.beam.visible = false;
    }
  }
}
function removeSkyDrop(i) {
  const d = skyDrops[i];
  scene.remove(d.capsule, d.beam);
  d.capsule.traverse((n) => {
    if (n.isMesh) n.geometry.dispose();
  });
  d.beam.geometry.dispose();
  d.beam.material.dispose();
  skyDrops.splice(i, 1);
}
function clearSkyDrops() {
  for (let i = skyDrops.length - 1; i >= 0; i--) removeSkyDrop(i);
}
function spawnArenaWeapons() {
  const candidates = [
    ...skyPlatforms.filter((p) => p.w > 3 && p.d > 3).map((p) => new T.Vector3(p.x, p.h, p.z)),
    ...zoneInstances.flatMap((zone) =>
      zoneLayout(zone).spawns.map(([x, z]) => new T.Vector3(x, terrainHeight(x, z), z)),
    ),
  ];
  for (let x = -65; x <= 65; x += 10)
    for (let z = -65; z <= 65; z += 10) candidates.push(new T.Vector3(x, terrainHeight(x, z), z));
  for (let index = 0; index < weapons.length; index++) {
    if ((weapons[index].tier || 1) > 1) continue; // only tier 1 lies on the arena; the rest falls from the sky
    let placed = false;
    for (let offset = 0; offset < candidates.length; offset++) {
      const position = candidates[(index * 7 + offset) % candidates.length];
      if (
        !findPath(
          position,
          generatedPlan
            ? new T.Vector3(generatedPlan.zones[0].x, 0, generatedPlan.zones[0].z)
            : new T.Vector3(0, 0, 18),
        ).length
      )
        continue;
      const drop = spawnDrop(index, position);
      if (!drop) continue;
      if (
        findPath(
          drop.group.position,
          generatedPlan
            ? new T.Vector3(generatedPlan.zones[0].x, 0, generatedPlan.zones[0].z)
            : new T.Vector3(0, 0, 18),
        ).length
      ) {
        placed = true;
        break;
      }
      scene.remove(drop.group);
      unregisterPlacement(drop.group);
      drop.ring.geometry.dispose();
      drop.ring.material.dispose();
      drops.splice(drops.indexOf(drop), 1);
    }
    if (!placed) throw new Error("No reachable spawn for " + weapons[index].name);
  }
}
const ENEMY_ROCKET_DAMAGE = 20,
  SELF_ROCKET_DAMAGE = 25;
function rocketExplosion(position, p) {
  // blast sound where it lands (a salvo of four plays it once: the next ones within 120 ms are skipped)
  if (performance.now() - (rocketExplosion.lastSound || 0) > 120) {
    rocketExplosion.lastSound = performance.now();
    sfx.play("rocket-blast", { position, group: "impact", volume: 0.75 });
    sfx.duck(0.3, 0.35);
  }
  const w = weapons[p.index];
  blastWalls(position, 3.2, 60);
  impact(position, w.color, 1.3);
  burst(position, 0xffbd62);
  shake = Math.max(shake, 0.22);
  sound(60, 0.18, "sawtooth", 0.05);
  const flash = new T.Mesh(
    sharedSphere(0.45, 12, 8),
    new T.MeshBasicMaterial({
      color: HDR(0xffae42, 6),
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      blending: T.AdditiveBlending,
    }),
  );
  flash.position.copy(position);
  addEffect(flash, 0.35, { grow: 10, initialOpacity: 0.8 });
  flashes.flash(position.clone().add(new T.Vector3(0, 0.8, 0)), 0xffa040, 420, 16, 0.45);
  let landed = false;
  const blastCenter = p.dir ? position.clone().addScaledVector(p.dir, -0.25) : position.clone();
  for (const b of bots) {
    if (b.dead || p.enemy) continue;
    const body = b.group.position.clone().add(new T.Vector3(0, 1.05, 0)),
      distance = body.distanceTo(position);
    if (distance > w.blastRadius || !visible(blastCenter, body)) continue;
    if (b.shield) breakShield(b);
    const damage = Math.round(p.damage * (1 - (0.65 * distance) / w.blastRadius));
    b.hp -= damage;
    b.flash = 0.14;
    b.stun = Math.max(b.stun, 0.25);
    landed = true;
    if (b.hp <= 0) kill(b);
  }
  if (landed && !p.enemy) {
    hits++;
    hitTime = 0.16;
  }
  const playerBody = player.group.position.clone().add(new T.Vector3(0, 1.05, 0)),
    distance = playerBody.distanceTo(position);
  if (distance < w.blastRadius && visible(blastCenter, playerBody))
    damagePlayer(
      Math.round(
        (p.enemy ? ENEMY_ROCKET_DAMAGE : SELF_ROCKET_DAMAGE) * (1 - (0.65 * distance) / w.blastRadius),
      ),
    );
  for (const c of explosives)
    if (!c.dead && c.group.position.distanceTo(position) < w.blastRadius) {
      c.hp -= p.damage;
      if (c.hp <= 0) explode(c);
    }
  updateHUD();
}
function laserShot(origin, dir, index, enemy = false, opts = {}) {
  const w = weapons[index];
  // ШТОРМ ignores geometry and pierces everything; ПУЛЬС (wallStop, pierce 1) stops at a wall and the first target.
  let reach = opts.range ?? w.range;
  if (w.wallStop) {
    ray.set(origin, dir);
    ray.far = reach;
    const wall = intersectWorld(ray)[0];
    if (wall) reach = wall.distance;
  }
  const targets = [];
  if (enemy) {
    const d = sphereContact(origin, dir, reach, player.group.position.clone().add(new T.Vector3(0, 1.05, 0)), 0.6);
    if (d !== null) targets.push({ d, player: true });
  } else
    for (const b of bots) {
      if (b.dead) continue;
      const hit = botContact(origin, dir, reach, b);
      if (hit) targets.push({ d: hit.d, bot: b, part: hit.part });
    }
  for (const c of explosives) {
    if (c.dead) continue;
    const point = new T.Ray(origin, dir).intersectBox(c.box, new T.Vector3()),
      d = c.box.containsPoint(origin) ? 0 : point ? origin.distanceTo(point) : null;
    if (d !== null && d <= reach) targets.push({ d, crate: c });
  }
  targets.sort((a, b) => a.d - b.d);
  const limit = Number.isFinite(w.pierce) ? w.pierce : Infinity,
    enemyDamage = opts.damage ?? (w.beam === "pulse" ? 16 + wave * 2 : 5 + wave);
  let struck = 0,
    end = reach;
  for (const t of targets) {
    if (struck >= limit) break;
    if (t.player) {
      if (shooter) shooter.misses = 0;
      damagePlayer(enemyDamage);
    }
    else if (t.bot && t.part === "shield" && !enemy) {
      shieldBlock(t.bot, origin.clone().addScaledVector(dir, t.d));
      end = t.d;
      break;
    } else if (t.bot) {
      t.bot.hp -= enemy ? w.damage : playerDamage(w);
      if (t.bot.giant && !enemy) giantHit(t.bot, t.part, playerDamage(w));
      if (!enemy) legendHit(t.bot, playerDamage(w));
      if (!enemy) alertBot(t.bot);
      hitSound(t.bot.group.position);
      t.bot.flash = 0.14;
      hits++;
      hitTime = 0.16;
      impact(origin.clone().addScaledVector(dir, t.d), w.color, w.beam === "pulse" ? 0.6 : 0.25);
      if (t.bot.hp <= 0) kill(t.bot);
    } else {
      t.crate.hp -= enemy ? enemyDamage : playerDamage(w);
      if (t.crate.hp <= 0) explode(t.crate);
    }
    struck++;
    if (struck >= limit) end = t.d;
  }
  const tip = origin.clone().addScaledVector(dir, end);
  if (w.beam === "pulse") {
    tracer(origin, tip, w.color, 0, enemy, 0.14);
    impact(tip, w.color, 0.45);
    flashes.flash(tip, w.color, 120, 8, 0.15);
  } else tracer(origin, tip, w.color, 0);
}
// E picks up whatever is closest: a weapon on the ground (swap) or a medkit
function pickup() {
  if (!active) return;
  if (nearestKit && !nearestKit.used && hp < playerMaxHp) {
    const kd = nearestKit.group.position.distanceTo(player.group.position),
      wd = nearestDrop ? nearestDrop.group.position.distanceTo(player.group.position) : Infinity;
    if (kd <= wd) return useMedkit();
  }
  if (!nearestDrop) return;
  const picked = nearestDrop,
    oldIndex = gunIndex,
    oldAmmo = ammo,
    position = picked.group.position.clone();
  scene.remove(picked.group);
  unregisterPlacement(picked.group);
  picked.ring.geometry.dispose();
  picked.ring.material.dispose();
  drops.splice(drops.indexOf(picked), 1);
  gunIndex = picked.index;
  ammo = picked.ammo;
  reloading = 0;
  cooldown = 0.15;
  attachGun(player, gunIndex);
  spawnDrop(oldIndex, position, oldAmmo);
  nearestDrop = null;
  sound(700, 0.1, "triangle");
  message("ПОДОБРАНО: " + weapons[gunIndex].name, 1.5);
  updateHUD();
  updatePickup();
}
function updatePickup() {
  nearestDrop = null;
  let distance = 2.3;
  for (const drop of drops) {
    const d = drop.group.position.distanceTo(player.group.position);
    if (
      d < distance &&
      visible(
        player.group.position.clone().add(new T.Vector3(0, 1.05, 0)),
        drop.group.position.clone().add(new T.Vector3(0, 1.05, 0)),
      )
    ) {
      distance = d;
      nearestDrop = drop;
    }
  }
  $("pickup").hidden = !active || !nearestDrop;
  touch?.root.querySelector("button.pickup")?.classList.toggle("ready", !!(active && (nearestDrop || (nearestKit && hp < playerMaxHp)))); // light up E on touch
  if (nearestDrop) {
    $("pickup").textContent =
      "E · ВЗЯТЬ " +
      weapons[nearestDrop.index].name +
      " — ОСТАВИТЬ " +
      weapons[gunIndex].name +
      " · " +
      weapons[nearestDrop.index].description;
    const p = nearestDrop.group.position
      .clone()
      .add(new T.Vector3(0, 1.2, 0))
      .project(camera);
    $("pickup").style.left = (p.x * 0.5 + 0.5) * innerWidth + "px";
    $("pickup").style.top = (-p.y * 0.5 + 0.5) * innerHeight + "px";
  }
}
function damagePlayer(amount) {
  if (immortal || !active || spawnShield > 0) return;
  runStats.damage += Math.min(amount, hp);
  if (runStats.streak >= COMBO_MIN) comboBreak();
  runStats.streak = 0;
  hp = Math.max(0, hp - amount);
  damageTime = 0.3;
  if (sfx.ready) hitSound(player.group.position, true);
  else sound(75, 0.08, "sawtooth");
  if (hp <= 0 && hasLegend("secondwind") && !secondWindUsed) {
    secondWindUsed = true;
    hp = Math.ceil(playerMaxHp * 0.5);
    spawnShield = 2;
    flashes.flash(player.group.position.clone().add(new T.Vector3(0, 1, 0)), 0x6dffa8, 400, 12, 0.6);
    impact(player.group.position.clone().add(new T.Vector3(0, 1, 0)), 0x6dffa8, 1.4);
    message("ВТОРОЕ ДЫХАНИЕ!", 2);
  }
  updateHUD();
  if (hp <= 0) finish(false);
}
function toggleImmortality() {
  immortal = !immortal;
  if (immortal) hp = playerMaxHp;
  $("immortality").textContent = "P · БЕССМЕРТИЕ: " + (immortal ? "ВКЛ" : "ВЫКЛ");
  $("immortality").setAttribute("aria-pressed", String(immortal));
  $("immortality").classList.toggle("enabled", immortal);
  if (player) updateHUD();
}
function rocketVisual(color) {
  const rocket = new T.Group();
  const body = new T.Mesh(
    new T.CylinderGeometry(0.105, 0.105, 0.6, 8),
    new T.MeshStandardMaterial({ color: 0xe2e6e9, metalness: 0.35, roughness: 0.45 }),
  );
  rocket.add(body);
  const nose = new T.Mesh(new T.ConeGeometry(0.105, 0.25, 8), new T.MeshStandardMaterial({ color }));
  nose.position.y = 0.425;
  rocket.add(nose);
  for (const angle of [0, Math.PI / 2]) {
    const fins = new T.Mesh(
      new T.BoxGeometry(0.36, 0.23, 0.035),
      new T.MeshStandardMaterial({ color: 0x424959, metalness: 0.25 }),
    );
    fins.position.y = -0.22;
    fins.rotation.y = angle;
    rocket.add(fins);
  }
  const exhaust = new T.Mesh(
    sharedSphere(0.13, 8, 6),
    new T.MeshBasicMaterial({
      color: 0xffbd63,
      transparent: true,
      opacity: 0.85,
      blending: T.AdditiveBlending,
      depthWrite: false,
    }),
  );
  exhaust.position.y = -0.4;
  exhaust.scale.y = 2;
  rocket.add(exhaust);
  return rocket;
}
function steerRocket(p, step) {
  // Per-rocket random seeds, smooth bounded drift, and a shallow rising/falling arc.
  // No target seeking; only this weapon changes direction after leaving the muzzle.
  const r = p.rocket,
    d = weapons[p.index].range - p.remaining + step * 0.5,
    range = weapons[p.index].range,
    envelope = Math.sin((Math.PI * d) / range),
    slope = (Math.PI / range) * Math.cos((Math.PI * d) / range);
  const lateral =
    0.55 *
    (slope * Math.sin(d * r.frequency + r.phase) +
      envelope * r.frequency * Math.cos(d * r.frequency + r.phase));
  const arc =
    r.height * slope +
    0.08 * (slope * Math.sin(d * 0.9 + r.phase) + envelope * 0.9 * Math.cos(d * 0.9 + r.phase));
  p.dir.copy(r.forward).addScaledVector(r.side, lateral).addScaledVector(r.up, arc).normalize();
  r.visual.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), p.dir);
}
function spawnProjectile(origin, dir, index, enemy = false, mini = false) {
  const w = weapons[index];
  if (w.kind === 4) {
    laserShot(origin, dir, index, enemy);
    return null;
  }
  const group = new T.Group(),
    color = enemy ? 0xff4d43 : w.color,
    radius = mini
      ? 0.045
      : w.split
        ? 0.11
        : w.kind === 3
          ? 0.16
          : weapons[index].kind === 0
            ? 0.085
            : weapons[index].kind === 1
              ? 0.06
              : 0.07;
  const bolt = new T.Mesh(
    sharedBolt(radius, weapons[index].kind === 0 ? 1.5 : 0.8),
    new T.MeshBasicMaterial({ color: HDR(color, 4), depthWrite: false }),
  );
  bolt.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir);
  if (w.kind !== 3) group.add(bolt);
  else bolt.material.dispose();
  const glow = new T.Mesh(
    sharedSphere(radius * 2.5, 8, 6),
    new T.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.5,
      blending: T.AdditiveBlending,
      depthWrite: false,
    }),
  );
  if (w.kind !== 3) group.add(glow);
  else glow.material.dispose();
  group.position.copy(origin);
  scene.add(group);
  const p = {
    group,
    dir: dir.clone(),
    index,
    enemy,
    speed: enemy ? 20 : w.speed,
    remaining: w.range,
    pierce: enemy ? 1 : w.pierce,
    hit: new Set(),
    counted: false,
    damage: enemy ? (weapons[index].kind === 1 ? 3 : weapons[index].kind === 0 ? 12 : 5 + wave) : playerDamage(w),
    // slugs of a splitting weapon burst into pellets after a few metres; pellets themselves never split
    split: w.split && !mini ? w.split : null,
    flown: 0,
    owner: enemy ? shooter : null,
  };
  if (w.kind === 3) {
    const visual = rocketVisual(color);
    visual.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir);
    group.add(visual);
    const side = new T.Vector3().crossVectors(new T.Vector3(0, 1, 0), dir);
    if (side.lengthSq() < 0.001) side.set(1, 0, 0);
    side.normalize();
    const up = new T.Vector3().crossVectors(dir, side).normalize();
    p.rocket = {
      visual,
      forward: dir.clone(),
      side,
      up,
      phase: Math.random() * Math.PI * 2,
      frequency: 0.55 + Math.random() * 0.35,
      height: 0.9 + Math.random() * 0.4,
    };
  }
  projectiles.push(p);
  return p;
}
function removeProjectile(index) {
  const p = projectiles[index];
  scene.remove(p.group);
  p.group.traverse((n) => {
    if (n.isMesh) {
      if (!n.geometry.userData.shared) n.geometry.dispose();
      n.material.dispose();
    }
  });
  projectiles.splice(index, 1);
}
// Ray vs a bot. Ordinary bots are one sphere at the chest; the giant is a stack of body spheres plus two
// glowing weak points on its hands (part "left" / "right" — enough hits there in a row shoot the arm off).
function botContact(origin, dir, maxDistance, b) {
  if (!b.giant) {
    const d = sphereContact(origin, dir, maxDistance, b.group.position.clone().add(new T.Vector3(0, 1.05, 0)), b.shield ? 0.95 : b.elite ? 0.85 : 0.65);
    if (d === null) return null;
    return { d, part: b.shield && shieldFacing(b, dir) ? "shield" : "body" };
  }
  let best = null;
  for (const side of ["left", "right"]) {
    const arm = b.arms[side];
    if (arm.off) continue;
    const d = sphereContact(origin, dir, maxDistance, arm.marker.getWorldPosition(new T.Vector3()), GIANT.weakRadius);
    if (d !== null && (!best || d < best.d)) best = { d, part: side };
  }
  for (const [y, r] of GIANT.body) {
    const d = sphereContact(origin, dir, maxDistance, b.group.position.clone().add(new T.Vector3(0, y, 0)), r);
    if (d !== null && (!best || d < best.d - 0.3)) best = { d, part: "body" }; // a weak point wins near-ties
  }
  return best;
}
// ── Range balance ──────────────────────────────────────────────────────────────────────────────────────────
// Player shots lose damage with distance, by class: full up to `full` × range, then linearly down to `min`
// at max range. Rifles keep their damage (their job is range); SMGs and shotguns fall off hard.
const FALLOFF = {
    0: { full: 1, min: 1 }, // rifles
    1: { full: 0.3, min: 0.25 }, // shotguns
    2: { full: 0.35, min: 0.35 }, // SMGs
    3: { full: 1, min: 1 }, // rockets (blast handles it)
    4: { full: 1, min: 1 }, // lasers
    5: { full: 1, min: 1 }, // blade
  },
  SMG_BLOOM_MAX = 2.6;
let smgBloom = 1,
  lastShotAt = 0;
function falloff(w, distance) {
  const f = FALLOFF[w.kind] || FALLOFF[0],
    t = distance / Math.max(1, w.range);
  if (t <= f.full) return 1;
  return 1 - (1 - f.min) * Math.min(1, (t - f.full) / (1 - f.full));
}
// a bot shot from beyond its own reach doesn't stand there: it pushes in on you for a few seconds
function alertBot(b) {
  if (b.giant) return;
  b.alert = 5;
}
function sphereContact(origin, dir, maxDistance, center, radius) {
  const sphere = new T.Sphere(center, radius);
  if (sphere.containsPoint(origin)) return 0;
  const point = new T.Ray(origin, dir).intersectSphere(sphere, new T.Vector3());
  if (!point) return null;
  const d = origin.distanceTo(point);
  return d <= maxDistance ? d : null;
}
function updateProjectiles(dt) {
  updateLegends(dt);
  scene.updateMatrixWorld(true);
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i],
      origin = p.group.position.clone(),
      step = Math.min(p.speed * dt * (p.enemy ? worldScale() : 1), p.remaining);
    if (p.rocket) steerRocket(p, step);
    ray.set(origin, p.dir);
    ray.far = step;
    const wall = intersectWorld(ray)[0],
      limit = wall ? wall.distance : step,
      targets = [];
    for (const c of explosives) {
      if (c.dead) continue;
      const point = new T.Ray(origin, p.dir).intersectBox(c.box, new T.Vector3());
      const d = c.box.containsPoint(origin) ? 0 : point ? origin.distanceTo(point) : null;
      if (d !== null && d <= limit + 0.001) targets.push({ crate: c, d });
    }
    if (p.enemy) {
      const d = sphereContact(
        origin,
        p.dir,
        limit,
        player.group.position.clone().add(new T.Vector3(0, 1.05, 0)),
        0.6,
      );
      if (d !== null) targets.push({ player: true, d });
    } else
      for (const b of bots) {
        if (b.dead || p.hit.has(b)) continue;
        const hit = botContact(origin, p.dir, limit, b);
        if (hit) targets.push({ bot: b, d: hit.d, part: hit.part });
      }
    targets.sort((a, b) => a.d - b.d);
    let stopped = false,
      travel = limit;
    for (const t of targets) {
      const point = origin.clone().addScaledVector(p.dir, t.d);
      if (weapons[p.index].kind === 3) {
        if (t.bot?.giant) giantHit(t.bot, t.part, p.damage);
        stopped = true;
        travel = t.d;
        break;
      }
      if (t.crate) {
        t.crate.hp -= p.damage;
        impact(point, 0xffa42b, 0.45);
        if (t.crate.hp <= 0) explode(t.crate);
        stopped = true;
        travel = t.d;
        break;
      }
      if (t.player) {
        if (p.owner) p.owner.misses = 0;
        impact(point, 0xff5656, 0.3);
        damagePlayer(p.damage);
        stopped = true;
        travel = t.d;
        break;
      }
      const b = t.bot;
      if (b.dead) continue;
      if (t.part === "shield" && !p.enemy) {
        shieldBlock(b, point);
        stopped = true;
        travel = t.d;
        break;
      }
      p.hit.add(b);
      const dealt = p.enemy ? p.damage : p.damage * falloff(weapons[p.index], p.flown + t.d);
      b.hp -= dealt;
      if (!p.enemy) alertBot(b), legendHit(b, dealt);
      if (b.giant) giantHit(b, t.part, dealt);
      hitSound(b.group.position);
      b.flash = 0.14;
      hitTime = 0.16;
      if (!p.counted) {
        hits++;
        p.counted = true;
      }
      impact(point, weapons[p.index].color, weapons[p.index].kind === 1 ? 0.5 : 0.3);
      if (weapons[p.index].kind === 1 && !b.giant) move(b, p.dir.x * 0.5, p.dir.z * 0.5);
      if (weapons[p.index].kind === 2) b.stun = Math.max(b.stun, 0.1);
      if (b.hp <= 0) kill(b);
      updateHUD();
      p.pierce--;
      if (p.pierce <= 0) {
        stopped = true;
        travel = t.d;
        break;
      }
    }
    p.group.position.copy(origin).addScaledVector(p.dir, travel);
    p.remaining -= travel;
    p.flown += travel;
    if (!stopped && p.split && p.flown >= p.split.after && p.remaining > 0.5) {
      const at = p.group.position.clone(),
        side = new T.Vector3().crossVectors(p.dir, new T.Vector3(0, 1, 0)).normalize();
      for (let k = 0; k < p.split.count; k++) {
        const d = p.dir
          .clone()
          .applyAxisAngle(new T.Vector3(0, 1, 0), (Math.random() - 0.5) * p.split.spread)
          .applyAxisAngle(side, (Math.random() - 0.5) * p.split.spread * 0.35)
          .normalize();
        const child = spawnProjectile(at, d, p.index, p.enemy, true);
        if (child) {
          child.remaining = p.remaining;
          child.hit = new Set(p.hit);
          child.counted = p.counted;
          child.damage = p.damage;
        }
      }
      impact(at, weapons[p.index].color, 0.35);
      removeProjectile(i);
      continue;
    }
    if (wall && !stopped && !p.enemy && !p.bounced && weapons[p.index].kind !== 3 && hasLegend("ricochet") && wall.face) {
      // РИКОШЕТ: one bounce off the wall, flat in the horizontal plane
      const n = wall.face.normal.clone().transformDirection(wall.object.matrixWorld).setY(0);
      if (n.lengthSq() > 0.01) {
        n.normalize();
        p.dir.reflect(n).setY(p.dir.y * 0.3).normalize();
        p.bounced = true;
        p.group.position.addScaledVector(n, 0.05);
        for (const c of p.group.children) c.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), p.dir);
        impact(p.group.position, 0xffd27a, 0.3);
        continue;
      }
    }
    if (wall && !stopped) {
      impact(p.group.position, 0xffdb9b, 0.25);
      stopped = true;
    }
    if (stopped || p.remaining <= 0.001) {
      if (weapons[p.index].kind === 3) rocketExplosion(p.group.position.clone(), p);
      removeProjectile(i);
    }
  }
}
// ---------- ОХОТНИК: plasma blade (weapon kind 5) ----------
// Held fire = lit blade that drains charge over time and cuts whatever it touches; released = charge refills.
let lastBladeUse = -10,
  bladeClock = 0; // game time, so pauses and slow frames behave
const bladeDir = new T.Vector3();
function bladeDirection(chest) {
  if (viewMode === "rear") return bladeDir.set(Math.sin(viewYaw), 0, Math.cos(viewYaw));
  if (pointerKnown && aimPoint.distanceToSquared(chest) > 0.04) return bladeDir.copy(aimPoint).sub(chest).setY(0).normalize();
  return bladeDir.set(Math.sin(yaw), 0, Math.cos(yaw));
}
function updateBlade(dt) {
  const w = weapons[gunIndex],
    blade = player?.gun?.blade;
  if (w.kind !== 5) return;
  const now = (bladeClock += dt),
    held = active && (mouseDown || touchFiring) && ammo > 0;
  if (held) {
    ammo = Math.max(0, ammo - w.drain * dt);
    lastBladeUse = now;
    const chest = player.group.position.clone().add(new T.Vector3(0, 1.05, 0)),
      dir = bladeDirection(chest),
      touches = (p, radius) => {
        const to = p.clone().sub(chest).setY(0),
          d = to.length();
        return d <= w.range + radius && (d < 0.4 || to.normalize().angleTo(dir) <= w.arc / 2);
      };
    let struck = false;
    for (const b of bots) {
      if (b.dead || (b.bladeCooldown = Math.max(0, (b.bladeCooldown || 0) - dt)) > 0) continue;
      if (!touches(b.group.position, b.giant ? 1.9 : b.elite ? 0.85 : 0.65) || Math.abs(b.group.position.y - player.group.position.y) > (b.giant ? 5 : 2)) continue;
      b.bladeCooldown = w.tick;
      if (b.shield && shieldFacing(b, b.group.position.clone().sub(player.group.position).setY(0).normalize())) {
        shieldBlock(b, b.group.position.clone().add(new T.Vector3(0, 1.05, 0)));
        continue;
      }
      b.hp -= playerDamage(w);
      legendHit(b, playerDamage(w));
      hitSound(b.group.position);
      b.flash = 0.14;
      b.stun = Math.max(b.stun, 0.25);
      move(b, dir.x * 0.25, dir.z * 0.25); // light push, so the target stays on the blade
      hits++;
      runStats.otherHits++;
      hitTime = 0.16;
      struck = true;
      impact(b.group.position.clone().add(new T.Vector3(0, 1.05, 0)), w.color, 0.5);
      if (b.hp <= 0) kill(b);
    }
    for (const c of explosives) {
      if (c.dead || (c.bladeCooldown = Math.max(0, (c.bladeCooldown || 0) - dt)) > 0) continue;
      if (!touches(c.box.getCenter(new T.Vector3()), 0.8)) continue;
      c.bladeCooldown = w.tick;
      c.hp -= playerDamage(w);
      impact(c.box.getCenter(new T.Vector3()), w.color, 0.4);
      struck = true;
      if (c.hp <= 0) explode(c);
    }
    if (struck) {
      flashes.flash(chest.clone().addScaledVector(dir, 1.2), w.color, 90, 7, 0.12);
      sound(180, 0.08, "sawtooth", 0.04);
      shake = Math.max(shake, 0.08);
      updateHUD();
    }
  } else if (now - lastBladeUse > w.regenDelay && ammo < w.mag) ammo = Math.min(w.mag, ammo + w.regen * dt);
  if (Math.floor(ammo) !== updateBlade.shown) {
    updateBlade.shown = Math.floor(ammo);
    updateHUD();
  }
  if (!blade) return;
  blade.visible = held;
  const strength = 0.55 + 0.45 * (ammo / w.mag);
  blade.scale.set(1, 1, strength * (0.97 + Math.random() * 0.06));
}
function shoot() {
  if (!active || cooldown > 0 || reloading > 0) return;
  if (weapons[gunIndex].kind === 5) return; // the blade works in updateBlade while fire is held
  if (ammo <= 0) {
    if (sfx.ready && reloading <= 0) sfx.play("empty", { volume: 0.6 });
    reload();
    return;
  }
  const w = weapons[gunIndex];
  ammo--;
  runStats.shots += w.pellets || 1;
  cooldown = w.rate / upgradeMul(w.kind, "rate");
  // feel: camera shake, the gun kicking back and its muzzle flipping up, all scaled by the weapon's punch
  const punch = shotPunch(w);
  shake = Math.max(shake, punch.shake);
  player.gun.position.z = player.gun.userData.restZ - punch.kick;
  player.gun.rotation.x = -punch.flip;
  const shot = shotSound(w);
  if (w.kind === 2) {
    // SMG: the burst loop runs while the trigger is held (updateSfx stops it)
    smgLoop.set(true, { sound: SMG_LOOPS[w.name] ?? "smg-spectre-loop" });
  } else if (shot && sfx.ready) sfx.play(shot.name, { volume: shot.volume, rate: shot.rate ?? 1 });
  if (shot && w.kind === 3) sfx.duck(0.35, 0.4);
  if (!sfx.ready) sound(
    w.kind === 3
      ? 65
      : w.kind === 4
        ? 620
        : weapons[gunIndex].kind === 1
          ? 85
          : weapons[gunIndex].kind === 2
            ? 370
            : 210,
    weapons[gunIndex].kind === 1 || w.kind === 3 ? 0.18 : 0.09,
    w.kind === 4 ? "sine" : "sawtooth",
    weapons[gunIndex].kind === 1 ? 0.06 : 0.025,
  );
  const base = weaponMuzzle(player);
  if (viewMode === "rear") {
    camera.updateMatrixWorld(true);
    aimRay.setFromCamera(new T.Vector2(0, 0), camera);
    aimRay.far = 120;
    const wall = intersectWorld(aimRay)[0];
    let distance = wall ? wall.distance : 100;
    for (const b of bots)
      if (!b.dead) {
        const d = botContact(aimRay.ray.origin, aimRay.ray.direction, distance, b)?.d ?? null;
        if (d !== null) distance = d;
      }
    const target = aimRay.ray.origin.clone().addScaledVector(aimRay.ray.direction, distance);
    shotDirection.copy(target).sub(base).normalize();
  } else {
    shotDirection.set(Math.sin(yaw), 0, Math.cos(yaw));
    if (pointerKnown && aimPoint.distanceToSquared(base) > 0.04)
      shotDirection.copy(aimPoint).sub(base).normalize();
  }
  scene.updateMatrixWorld(true);
  const muzzle = base,
    blocked = w.kind === 4 ? null : muzzleObstruction(player, muzzle);
  muzzleFlash(muzzle, gunIndex);
  if (blocked) {
    impact(blocked.point, 0xffdb9b, 0.25);
    updateHUD();
    return;
  }
  // SMG bloom: every shot in a burst widens the spread, up to ×2.6; it settles 0.25 s after you let go
  if (w.kind === 2) smgBloom = Math.min(SMG_BLOOM_MAX, (performance.now() - lastShotAt < 250 ? smgBloom : 1) + 0.12);
  lastShotAt = performance.now();
  const bloom = w.kind === 2 ? smgBloom : 1;
  for (let i = 0; i < w.pellets; i++) {
    const dir = shotDirection.clone();
    dir.applyAxisAngle(
      new T.Vector3(0, 1, 0),
      (w.kind === 3
        ? (i - 1.5) / 3 + (Math.random() - 0.5) * 0.18
        : w.split
          ? (i - (w.pellets - 1) / 2) / Math.max(1, w.pellets - 1) + (Math.random() - 0.5) * 0.2
          : Math.random() - 0.5) * w.spread * bloom,
    );
    if (viewMode === "rear") dir.y += (Math.random() - 0.5) * w.spread * 0.4 * bloom;
    dir.normalize();
    spawnProjectile(muzzle, dir, gunIndex);
  }
  updateHUD();
}
// Weapon punch: how hard each shot shakes the camera, kicks the gun back (m) and flips the muzzle up (rad).
function shotPunch(w) {
  if (w.kind === 3) return { shake: 0.24, kick: 0.26, flip: 0.32 }; // rockets
  if (w.split) return { shake: 0.2, kick: 0.24, flip: 0.3 }; // КОБРА, both barrels
  if (w.kind === 1) return { shake: 0.15, kick: 0.2, flip: 0.24 }; // shotguns
  if (w.beam === "pulse") return { shake: 0.16, kick: 0.2, flip: 0.18 }; // ПУЛЬС
  if (w.kind === 0) return { shake: 0.06, kick: 0.12, flip: 0.1 }; // rifles
  if (w.kind === 4) return { shake: 0.02, kick: 0.04, flip: 0.02 }; // ШТОРМ laser
  return { shake: 0.035, kick: 0.07, flip: 0.05 }; // SMGs
}
// Death burst: the body vanishes in a flash, a shock ring, a puff of voxel chunks in the character's
// colours bouncing on the ground, a short light and a thump.
const DEATH_COLORS = [0x2b2b33, 0x7a4a2e, 0xd9a066, 0x3c6fd0, 0xc84a3a, 0xe9e4da, 0x4f8a4a];
// Compile the shaders of effect materials (debris, rings, shards) before the fight, so the first explosion
// does not stall on shader compilation — with many torch lights at night that compile is noticeable.
function prewarmEffects() {
  if (typeof renderer?.compile !== "function") return;
  const probes = [
    new T.Mesh(new T.BoxGeometry(0.2, 0.2, 0.2), new T.MeshStandardMaterial({ color: 0x888888, transparent: true })),
    new T.Mesh(new T.BoxGeometry(0.2, 0.2, 0.2), new T.MeshStandardMaterial({ color: 0x888888, roughness: 0.9, metalness: 0.6, transparent: true })),
    new T.Mesh(new T.RingGeometry(0.3, 0.5, 12), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, side: T.DoubleSide, depthWrite: false, blending: T.AdditiveBlending })),
    new T.Mesh(new T.SphereGeometry(0.2, 8, 6), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: T.AdditiveBlending })),
  ];
  for (const m of probes) {
    m.position.set(0, -50, 0);
    scene.add(m);
  }
  try {
    renderer.compile(scene, camera);
  } catch {}
  for (const m of probes) {
    scene.remove(m);
    m.geometry.dispose(); // materials are kept (not disposed) so their compiled programs stay cached
  }
}
// ---------- Spawn shield: invulnerable for the first seconds of a round ----------
const SPAWN_SHIELD = 5;
let spawnShield = 0,
  shieldBubble = null;
function updateSpawnShield(dt) {
  spawnShield = Math.max(0, spawnShield - dt);
  if (!shieldBubble) {
    shieldBubble = new T.Mesh(
      new T.SphereGeometry(1.15, 24, 16),
      new T.MeshBasicMaterial({ color: HDR(0x80e8ff, 1.4), transparent: true, opacity: 0.25, depthWrite: false, blending: T.AdditiveBlending }),
    );
    scene.add(shieldBubble);
  }
  shieldBubble.visible = spawnShield > 0;
  const label = document.querySelector?.(".health small");
  if (label) label.textContent = spawnShield > 0 ? "ЗАЩИТА · " + Math.ceil(spawnShield) : "";
  if (!shieldBubble.visible) return;
  shieldBubble.position.copy(player.group.position).setY(player.group.position.y + 0.95);
  // gentle pulse, blinking during the last second
  const t = performance.now() / 1000;
  shieldBubble.material.opacity = spawnShield < 1 ? (Math.sin(t * 22) > 0 ? 0.28 : 0.06) : 0.18 + Math.sin(t * 5) * 0.06;
  shieldBubble.scale.setScalar(1 + Math.sin(t * 5) * 0.03);
}

// ---------- Health orbs: a killed enemy sometimes leaves a glowing green orb that heals ----------
// 35 % of kills (elites always) drop one: +15 HP (elite +30). It bobs for 12 s (blinking in the last 3),
// drifts towards you within 4 m and is picked up at 1.2 m.
const orbs = [];
// ── Slow-motion orb ─────────────────────────────────────────────────────────────────────────────────────────
// Rare (5 % of kills, never from the elite): a blue orb; picking it up slows everything but you to 50 % for 5 s
// — bots, their shots, the giant, group timers, sky drops. Blue tint over the screen, sounds pitched down.
const SLOWMO = { chance: 0.05, scale: 0.25, time: 5 }; // world at 25 % speed (was 50 %)
let slowmo = 0;
const worldScale = () => (slowmo > 0 ? SLOWMO.scale : 1);
function updateSlowmo(dt) {
  if (slowmo <= 0) return;
  slowmo -= dt;
  const el = typeof document !== "undefined" && $("slowmo");
  const k = slowmo > 0 ? Math.min(1, slowmo / 0.4, (SLOWMO.time - slowmo) / 0.25 + 0.2) : 0;
  if (el?.style) el.style.opacity = String(k);
  // colourless world, everything that moves leaves a smeared trail
  post?.setSaturation?.(1 - 0.92 * k);
  post?.setTrail?.(0.78 * k);
  if (slowmo <= 0) {
    sfx.setTimeScale?.(1);
    message("ВРЕМЯ ИДЁТ", 0.9);
  }
}
function startSlowmo() {
  slowmo = SLOWMO.time;
  sfx.setTimeScale?.(0.7);
  sound(110, 0.5, "sine", 0.06);
  sound(70, 0.7, "sine", 0.05);
  message("ЗАМЕДЛЕНИЕ", 1.4);
}
function maybeDropOrb(bot) {
  if (!bot.elite && Math.random() < SLOWMO.chance) return dropOrb(bot, true);
  if (!bot.elite && Math.random() > orbChance) return;
  dropOrb(bot, false);
}
function dropOrb(bot, slow) {
  const p = bot.group.position,
    orb = new T.Group(),
    tint = slow ? 0x4aa8ff : 0x6bff9a,
    core = new T.Mesh(new T.SphereGeometry(slow ? 0.26 : 0.22, 16, 12), new T.MeshBasicMaterial({ color: HDR(tint, 3) })),
    halo = new T.Mesh(
      new T.SphereGeometry(slow ? 0.55 : 0.42, 16, 12),
      new T.MeshBasicMaterial({ color: HDR(tint, 1.2), transparent: true, opacity: 0.3, depthWrite: false, blending: T.AdditiveBlending }),
    );
  orb.add(core, halo);
  orb.position.set(p.x, terrainHeight(p.x, p.z) + 0.8, p.z);
  scene.add(orb);
  orbs.push({ group: orb, slow, heal: bot.elite ? 30 : 15, life: slow ? 15 : 12, floor: terrainHeight(p.x, p.z), phase: Math.random() * 6 });
}
function updateOrbs(dt) {
  const me = player.group.position;
  for (let i = orbs.length - 1; i >= 0; i--) {
    const o = orbs[i];
    o.life -= dt;
    const pos = o.group.position,
      d = Math.hypot(pos.x - me.x, pos.z - me.z),
      t = performance.now() / 1000 + o.phase;
    if (d < 4 && Math.abs(pos.y - me.y) < 3) {
      // drift towards the player, faster when close
      const k = Math.min(1, dt * (3 + (4 - d) * 2));
      pos.x += (me.x - pos.x) * k;
      pos.z += (me.z - pos.z) * k;
      o.floor = T.MathUtils.lerp(o.floor, me.y, k);
    }
    pos.y = o.floor + 0.8 + Math.sin(t * 3) * 0.12;
    o.group.visible = o.life > 3 || Math.sin(t * 18) > -0.3;
    if (d < 1.2 && Math.abs(pos.y - (me.y + 0.8)) < 1.5 && o.slow) {
      impact(pos.clone(), 0x4aa8ff, 0.9);
      startSlowmo();
    } else if (d < 1.2 && Math.abs(pos.y - (me.y + 0.8)) < 1.5) {
      const before = hp;
      hp = Math.min(playerMaxHp, hp + o.heal);
      impact(pos.clone(), 0x6bff9a, 0.6);
      sound(660, 0.1, "triangle", 0.03);
      sound(990, 0.12, "triangle", 0.025);
      if (hp > before) message("+" + (hp - before) + " ЗДОРОВЬЯ", 0.9);
      updateHUD();
    } else if (o.life > 0) continue;
    scene.remove(o.group);
    o.group.traverse((n) => n.isMesh && (n.geometry.dispose(), n.material.dispose()));
    orbs.splice(i, 1);
  }
}
function clearOrbs() {
  for (const o of orbs) scene.remove(o.group);
  orbs.length = 0;
}
function deathBurst(bot) {
  const p = bot.group.position.clone(),
    chest = p.clone().add(new T.Vector3(0, 1, 0)),
    tint = weapons[bot.weaponIndex].color,
    big = bot.elite ? 1.5 : 1;
  impact(chest, tint, 1.1 * big);
  const ring = new T.Mesh(
    new T.RingGeometry(0.3, 0.55, 28),
    new T.MeshBasicMaterial({ color: HDR(tint, 3), transparent: true, opacity: 0.9, side: T.DoubleSide, depthWrite: false, blending: T.AdditiveBlending }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.copy(p).setY(p.y + 0.08);
  addEffect(ring, 0.35, { grow: 6 * big, initialOpacity: 0.9 });
  const floor = terrainHeight(p.x, p.z) + 0.05;
  for (let i = 0; i < (MOBILE ? 8 : 16) * big; i++) {
    const size = (0.12 + Math.random() * 0.22) * big,
      chunk = new T.Mesh(
        new T.BoxGeometry(size, size, size),
        new T.MeshStandardMaterial({ color: i % 5 === 0 ? tint : DEATH_COLORS[(Math.random() * DEATH_COLORS.length) | 0], roughness: 0.8, transparent: true }),
      );
    chunk.position.set(p.x + (Math.random() - 0.5) * 0.6, p.y + 0.4 + Math.random() * 1.2, p.z + (Math.random() - 0.5) * 0.6);
    chunk.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    chunk.castShadow = true;
    const a = Math.random() * Math.PI * 2,
      out = 2.5 + Math.random() * 4.5;
    addEffect(chunk, 1.4 + Math.random() * 0.6, {
      velocity: new T.Vector3(Math.cos(a) * out, 3 + Math.random() * 5, Math.sin(a) * out),
      gravity: 16,
      spin: (Math.random() - 0.5) * 16,
      floor: floor + size / 2,
    });
  }
  flashes.flash(chest, tint, 160 * big, 10, 0.25);
  sound(120, 0.16, "square", 0.05);
  sound(60, 0.25, "sawtooth", 0.04);
  shake = Math.max(shake, 0.12 * big);
}
// ── Combo: kills in a row without taking damage. Shown from ×2 next to the crosshair area; the best one
// feeds the rank ("Неудержимый" from ×10). Any damage breaks it.
const COMBO_MIN = 2;
const COMBO_TIME = 5;
let comboTimer = 0;
function updateCombo(dt) {
  if (comboTimer <= 0) return;
  comboTimer -= dt;
  const el = typeof document !== "undefined" && $("combo");
  if (el?.classList?.toggle) el.classList.toggle("fading", comboTimer < 1.5);
  if (comboTimer <= 0) {
    runStats.streak = 0; // the combo ends; the best one is kept for the rank
    if (el?.classList?.add) el.classList.add("hidden");
  }
}
function showCombo() {
  comboTimer = COMBO_TIME;
  const el = typeof document !== "undefined" && $("combo");
  if (!el?.classList?.add || !el.querySelector) return;
  const n = runStats.streak;
  if (n < COMBO_MIN) return;
  el.querySelector("b").textContent = "×" + n;
  el.querySelector("small").textContent = n >= 10 ? "НЕУДЕРЖИМ" : n >= 6 ? "В УДАРЕ" : "КОМБО";
  el.classList.remove("hidden", "broken", "pop");
  void el.offsetWidth; // restart the pop animation
  el.classList.add("pop");
  el.classList.toggle("hot", n >= 6);
  if (n === 5 || n === 10 || n === 15) sound(880 + n * 20, 0.12, "triangle", 0.04);
}
function comboBreak() {
  const el = typeof document !== "undefined" && $("combo");
  if (!el?.classList?.add || !el.querySelector) return;
  el.querySelector("small").textContent = "СЕРИЯ ПРЕРВАНА";
  el.classList.add("broken");
  clearTimeout(comboBreak.t);
  comboBreak.t = setTimeout(() => el.classList.add("hidden"), 900);
}
function hideCombo() {
  const el = typeof document !== "undefined" && $("combo");
  if (el?.classList?.add) el.classList.add("hidden");
}
// Run statistics for the end screen (reset every round).
const runStats = {};
function resetRunStats() {
  Object.assign(runStats, {
    classKills: {},
    damage: 0,
    shots: 0,
    otherHits: 0, // dash and blade hits, kept out of accuracy
    streak: 0,
    bestStreak: 0,
    time: 0,
    feats: { dash: 0, barrel: 0, moat: 0, air: 0 },
  });
}
resetRunStats();
// cause: "gun" (the weapon in hand), "dash", "barrel", "moat"
function kill(bot, cause = "gun") {
  if (bot.dead) return;
  if (cause === "gun") {
    const cls = KIND_CLASS[weapons[gunIndex].kind];
    runStats.classKills[cls] = (runStats.classKills[cls] || 0) + 1;
    if (jumpFlight) runStats.feats.air++;
  } else if (cause !== "moat") runStats.feats[cause]++;
  if (cause !== "moat") runStats.bestStreak = Math.max(runStats.bestStreak, ++runStats.streak);
  showCombo();
  if (bot.laserAim) (scene.remove(bot.laserAim.line), (bot.laserAim = null));
  bot.dead = true;
  if (bot.giant) giantDeath(bot);
  if (bot.bomber) setTimeout(() => bomberBlast(bot), 0); // shot down: it still goes off where it fell
  scene.remove(bot.group);
  bot.mixer.stopAllAction();
  if (!bot.bomber) spawnDrop(bot.weaponIndex, bot.group.position);
  kills++;
  deathBurst(bot);
  maybeDropOrb(bot);
  // a kill stores a power-dash charge: kill, then ram straight into the next one
  if (dashCharges < DASH_CHARGES_MAX) {
    dashCharges++;
    impact(player.group.position.clone().add(new T.Vector3(0, 0.08, 0)), 0x80e8ff, 0.35);
  }
  sound(550, 0.1, "triangle");
  if (kills % 4 === 0) hp = Math.min(playerMaxHp, hp + 12);
  updateHUD();
}
function reload() {
  if (!active || reloading > 0 || ammo === weapons[gunIndex].mag || weapons[gunIndex].kind === 5) return;
  reloading = weapons[gunIndex].reload * upgradeMul(weapons[gunIndex].kind, "reload");
  smgLoop.set(false);
  if (sfx.ready) sfx.play(reloadSound(weapons[gunIndex]), { volume: 0.6, jitter: 0 });
  else sound(420, 0.07, "triangle");
  updateHUD();
}
// ── Upgrade cards between waves ──────────────────────────────────────────────────────────────────────────
// Weapon cards upgrade a CLASS (weapon kind) and light one of its 3 bolts; steps are per pick of that effect.
// ── Illustrated UI (test build): art files in assets/ui/art, embedded in the single-file build ──
const uiUrl = (rel) => (typeof window !== "undefined" && window.__ASSETS?.["assets/ui/" + rel]) || "./assets/ui/" + rel,
  WEAPON_ART = { ИМПУЛЬС: "impulse", ГРОМ: "thunder", СПЕКТР: "spectrum", ЗАЛП: "salvo", ШТОРМ: "storm", ДУЭЛЯНТ: "duelist", ИСКРА: "spark", ВЕКТОР: "vector", ПУЛЬС: "pulse", ОСА: "wasp", БУРЯ: "burya", РАЗРЯД: "discharge", ОХОТНИК: "hunter", КОБРА: "cobra", ТИТАН: "titan", СТРЕЛА: "arrow", РАЗЛОМ: "rift", ФАНТОМ: "phantom" };
const artUrl = (name) => (typeof window !== "undefined" && window.__ASSETS?.["assets/ui/art/" + name]) || "./assets/ui/art/" + name;
const CARD_ART = { damage: "card-damage.webp", reload: "card-reload.webp", rate: "card-fire-rate.webp", luck: "card-luck.webp", health: "card-health.webp", vamp: "card-vampirism.webp", ricochet: "card-ricochet.webp", chain: "card-chain.webp", blastdash: "card-blastdash.webp", secondwind: "card-secondwind.webp" };
if (typeof document !== "undefined" && document.documentElement?.style?.setProperty) {
  for (const n of ["start", "pause"]) document.documentElement.style.setProperty("--art-" + n, 'url("' + artUrl(n + ".jpg") + '")');
  // the arena was picked in the menu (Start reloads with ?autostart): say so on the loading screen
  if (arenaParameters?.get("autostart")) {
    const t = document.querySelector?.("#splash small");
    if (t) t.textContent = "ЗАГРУЗКА АРЕНЫ…";
  }
  // loading screen: the art of this arena type (random art for classic / custom maps)
  const loadingArt = { ravine: 1, fortresses: 1, hill: 1, amphitheatre: 1, snipers: 1 }[generatedPlan?.type] ? generatedPlan.type : "random";
  document.documentElement.style.setProperty("--art-splash", 'url("' + artUrl("loading-" + loadingArt + ".jpg") + '")');
  // new HUD pieces (frames and icons cut from the HUD sheets)
  for (const n of ["panel-wide", "panel-mid", "panel-small", "slot", "bar-red", "heart", "bullet", "clip", "reload", "dash", "bolt", "hourglass", "perk-vamp", "perk-ricochet", "perk-chain", "perk-blastdash", "perk-secondwind"])
    document.documentElement.style.setProperty("--hud-" + n, 'url("' + uiUrl("hud/" + n + ".webp") + '")');
  for (const img of document.querySelectorAll?.("img[data-art]") || []) img.src = artUrl(img.dataset.art);
}
const UPGRADE_EFFECTS = {
    damage: { word: "УРОН", icon: "guns/grenade-a", steps: [0.15, 0.15, 0.2], weapon: true },
    reload: { word: "ПЕРЕЗАРЯДКА", icon: "guns/clip-large", steps: [0.15, 0.15, 0.2], weapon: true },
    rate: { word: "СКОРОСТЬ", icon: "guns/bullet-foam-tip-thick", steps: [0.1, 0.1, 0.15], weapon: true },
    luck: { word: "УДАЧА", icon: "star", limit: 1, note: "ПОПРОБУЙ ВЫЖИТЬ" }, // orb chance 35 % → 55 %; icon: built star
    health: { word: "ЗДОРОВЬЕ", icon: "people/aid-defibrillator-red", limit: 2, note: "+20 ЗДОРОВЬЯ" },
    // legendary cards (gold): ~10 % chance that one of the three offered cards is one, each once per run
    vamp: { word: "ВАМПИРИЗМ", icon: "", limit: 1, legend: true, note: "5 % УРОНА В ЗДОРОВЬЕ" },
    ricochet: { word: "РИКОШЕТ", icon: "", limit: 1, legend: true, note: "ПУЛИ ОТСКАКИВАЮТ" },
    chain: { word: "ЦЕПНАЯ МОЛНИЯ", icon: "", limit: 1, legend: true, note: "КАЖДОЕ 5-Е ПОПАДАНИЕ" },
    blastdash: { word: "ВЗРЫВНОЙ РЫВОК", icon: "", limit: 1, legend: true, note: "РЫВОК ОСТАВЛЯЕТ МИНУ" },
    secondwind: { word: "ВТОРОЕ ДЫХАНИЕ", icon: "", limit: 1, legend: true, note: "ОДИН РАЗ ВСТАНЕШЬ" },
  },
  UPGRADE_CLASS_NAMES = ["ВИНТОВКИ", "ДРОБОВИКИ", "ПП", "РАКЕТЫ", "ЛАЗЕРЫ", "КЛИНОК"];
// Difficulty (menu): player health, bot speed and bot "smarts" (aim, reaction, flanking, when they rush you).
const DIFFICULTY = {
  mama: { name: "ХОЧУ К МАМОЧКЕ", hp: 120, speed: 1, smart: 1 },
  hard: { name: "ХАРДКОРИЩЕ", hp: 80, speed: 1.5, smart: 1.5 },
};
let difficulty = DIFFICULTY.mama;
try {
  difficulty = DIFFICULTY[localStorage.getItem("blaster-difficulty")] || DIFFICULTY.mama;
} catch {}
const botAim = () => 1.3 / difficulty.smart, // aim error (m) around you
  botReact = () => 1 / (1 + (difficulty.smart - 1) * 0.5); // pause between shots (×0.8 on hard)
let classEffects = {}, // kind → { damage: n, reload: n, rate: n }
  effectTaken = {}, // luck / health → times taken
  orbChance = 0.35,
  playerMaxHp = 120,
  cardsOpen = false;
function resetUpgrades() {
  classEffects = {};
  effectTaken = {};
  orbChance = 0.35;
  playerMaxHp = difficulty.hp;
  legendHits = 0;
  secondWindUsed = false;
  blastMines.length = 0;
}
// ── Legendary cards ──
let legendHits = 0,
  secondWindUsed = false;
const blastMines = [],
  LEGEND_CHANCE = Number(arenaParameters?.get("legend") ?? 0.1),
  hasLegend = (k) => (effectTaken[k] || 0) > 0;
// every player hit on a bot goes through here: vampirism and the chain lightning counter
function legendHit(bot, dealt) {
  if (!(dealt > 0)) return;
  if (hasLegend("vamp") && hp > 0) hp = Math.min(playerMaxHp, hp + dealt * 0.05);
  if (hasLegend("chain") && ++legendHits % 5 === 0) chainLightning(bot, dealt);
}
function chainLightning(from, dealt) {
  const start = from.group.position.clone().add(new T.Vector3(0, 1.1, 0)),
    near = bots
      .filter((b) => !b.dead && b !== from && b.group.position.distanceTo(from.group.position) < 9)
      .sort((a, b) => a.group.position.distanceTo(from.group.position) - b.group.position.distanceTo(from.group.position))
      .slice(0, 2);
  let a = start;
  for (const b of near) {
    const end = b.group.position.clone().add(new T.Vector3(0, 1.1, 0));
    // jagged bolt: a few offset segments
    let prev = a;
    for (let k = 1; k <= 4; k++) {
      const pt = k === 4 ? end : a.clone().lerp(end, k / 4).add(new T.Vector3((Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 0.7));
      tracer(prev, pt, 0x9fe4ff, 0, false, 0.06);
      prev = pt;
    }
    flashes.flash(end, 0x8fd8ff, 160, 7, 0.2);
    impact(end, 0x9fe4ff, 0.5);
    b.hp -= Math.max(12, dealt * 0.6);
    b.flash = 0.14;
    b.stun = Math.max(b.stun || 0, 0.25);
    alertBot(b);
    if (b.giant) giantHit(b, "body", Math.max(12, dealt * 0.6));
    if (b.hp <= 0) kill(b);
    a = end;
  }
  if (near.length) sound(900, 0.12, "sawtooth", 0.035);
}
function dropBlastMine(at) {
  const mesh = new T.Mesh(sharedSphere(0.28, 10, 8), new T.MeshBasicMaterial({ color: HDR(0xff7a2a, 3), transparent: true, opacity: 0.9, depthWrite: false, blending: T.AdditiveBlending }));
  mesh.position.copy(at).add(new T.Vector3(0, 0.3, 0));
  scene.add(mesh);
  blastMines.push({ mesh, t: 0.4 });
}
function updateLegends(dt) {
  for (let i = blastMines.length - 1; i >= 0; i--) {
    const m = blastMines[i];
    m.t -= dt;
    m.mesh.scale.setScalar(1 + Math.sin(performance.now() * 0.04) * 0.25);
    if (m.t > 0) continue;
    const at = m.mesh.position.clone();
    scene.remove(m.mesh);
    blastMines.splice(i, 1);
    burst(at, 0xffbd62);
    impact(at, 0xff8a3a, 1.2);
    flashes.flash(at.clone().add(new T.Vector3(0, 0.6, 0)), 0xffa040, 380, 12, 0.4);
    shake = Math.max(shake, 0.18);
    sound(70, 0.16, "sawtooth", 0.05);
    for (const b of bots) {
      if (b.dead) continue;
      const d = b.group.position.distanceTo(at);
      if (d > 3.6) continue;
      const dmg = Math.round(45 * (1 - (0.5 * d) / 3.6));
      b.hp -= dmg;
      b.flash = 0.14;
      alertBot(b);
      if (b.giant) giantHit(b, "body", dmg);
      if (b.hp <= 0) kill(b);
    }
    for (const c of explosives) if (!c.dead && c.group.position.distanceTo(at) < 3.6) explode(c);
    blastWalls(at, 3.6, 60);
    updateHUD();
  }
}
const stepSum = (effect, n) => UPGRADE_EFFECTS[effect].steps.slice(0, n).reduce((a, b) => a + b, 0);
function upgradeMul(kind, effect) {
  const n = classEffects[kind]?.[effect] || 0;
  return effect === "reload" ? 1 - stepSum("reload", n) : 1 + stepSum(effect, n);
}
const playerDamage = (w) => w.damage * upgradeMul(w.kind, "damage");
function cardOffer() {
  const used = new Set(Object.keys(runStats.classKills).map((c) => KIND_CLASS.indexOf(c)));
  used.add(weapons[gunIndex].kind);
  const pool = [];
  for (const kind of used) {
    if (kind < 0 || (classUpgrades[kind] || 0) >= 3) continue;
    for (const effect of ["damage", "reload", "rate"]) {
      if (effect === "reload" && kind === 5) continue; // the blade never reloads
      pool.push({ effect, kind });
    }
  }
  for (const effect of ["luck", "health"]) if ((effectTaken[effect] || 0) < UPGRADE_EFFECTS[effect].limit) pool.push({ effect });
  // three cards with different effect words where possible
  const shuffled = pool.sort(() => Math.random() - 0.5),
    picked = [];
  for (const c of shuffled) if (picked.length < 3 && !picked.some((p) => p.effect === c.effect)) picked.push(c);
  for (const c of shuffled) if (picked.length < 3 && !picked.includes(c)) picked.push(c);
  const legends = Object.keys(UPGRADE_EFFECTS)
    .filter((k) => UPGRADE_EFFECTS[k].legend && !hasLegend(k))
    .sort(() => Math.random() - 0.5);
  if (legends.length && picked.length && Math.random() < LEGEND_CHANCE) picked[Math.floor(Math.random() * picked.length)] = { effect: legends.pop() };
  return picked.filter(Boolean);
}
function cardValue(card) {
  const e = UPGRADE_EFFECTS[card.effect];
  if (!e.weapon) return e.note;
  const step = e.steps[classEffects[card.kind]?.[card.effect] || 0];
  return (card.effect === "reload" ? "−" : "+") + Math.round(step * 100) + " %";
}
function applyCard(card) {
  if (card.effect === "luck") orbChance = 0.55;
  else if (card.effect === "health") {
    playerMaxHp += 20;
    hp = playerMaxHp;
  }
  if (UPGRADE_EFFECTS[card.effect].weapon) {
    classEffects[card.kind] ??= {};
    classEffects[card.kind][card.effect] = (classEffects[card.kind][card.effect] || 0) + 1;
    classUpgrades[card.kind] = (classUpgrades[card.kind] || 0) + 1;
  } else effectTaken[card.effect] = (effectTaken[card.effect] || 0) + 1;
  updateHUD();
}
// Card icons: one small offscreen renderer draws each spinning model and copies it into the card's 2D canvas.
const cardView = { renderer: null, scene: null, camera: null, icons: [], frame: 0 };
let cardChoice = null,
  cardList = [];
if (typeof window !== "undefined" && arenaParameters?.get("uitest") === "cards") window.__uiTestCards = () => ((wave = 1), openCards());
function openCards() {
  cardList = cardOffer();
  if (!cardList.length) return nextWave();
  cardsOpen = true;
  active = false;
  mouseDown = touchFiring = false;
  for (const k in keys) keys[k] = false;
  document.exitPointerLock?.();
  touch?.releaseFire?.();
  sfx.setMusic(musicEnabled, 0.45, arenaTrack);
  cardChoice = null;
  const row = $("cards-row");
  row.innerHTML = cardList
    .map(
      (c, i) =>
        '<button type="button" class="upcard art' + (UPGRADE_EFFECTS[c.effect].legend ? " legend" : "") + '" data-i="' + i + '"><img src="' + artUrl(CARD_ART[c.effect]) + '" alt=""><span class="upcard-text"><b>' + UPGRADE_EFFECTS[c.effect].word + "</b>" +
        "<small>" + (c.kind !== undefined ? UPGRADE_CLASS_NAMES[c.kind] : UPGRADE_EFFECTS[c.effect].legend ? "ЛЕГЕНДАРНАЯ" : "&nbsp;") + "</small><em>" + cardValue(c) + "</em></span></button>",
    )
    .join("");
  for (const b of row.querySelectorAll?.(".upcard") || [])
    b.onclick = () => {
      cardChoice = Number(b.dataset.i);
      for (const o of row.querySelectorAll(".upcard")) o.classList.toggle("chosen", o === b);
      $("cards-pick").disabled = false;
    };
  $("cards-pick").disabled = true;
  $("cards-title").textContent = "ВОЛНА " + wave + " ПРОЙДЕНА · ВЫБЕРИ УЛУЧШЕНИЕ";
  $("cards").hidden = false;
  try {
    buildCardIcons();
  } catch (e) {
    console.warn("card icons", e);
  }
}
function pickCard() {
  if (cardChoice === null) return;
  applyCard(cardList[cardChoice]);
  $("cards").hidden = true;
  cardsOpen = false;
  if (cardView.frame) cancelAnimationFrame(cardView.frame);
  active = true;
  sfx.setMusic(musicEnabled, 0.85, arenaTrack);
  nextWave();
}
function buildCardIcons() {
  const canvases = [...($("cards-row").querySelectorAll?.("canvas") || [])];
  if (!canvases.length || !canvases[0].getContext) return;
  if (!cardView.renderer) {
    cardView.renderer = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); // copied into 2D canvases: keep the frame
    cardView.renderer.setSize(220, 220, false);
    cardView.renderer.outputColorSpace = renderer.outputColorSpace;
    cardView.renderer.toneMapping = T.ACESFilmicToneMapping;
    cardView.scene = new T.Scene();
    cardView.scene.add(new T.HemisphereLight(0xeef2ff, 0x3a1838, 2));
    const key = new T.DirectionalLight(0xffffff, 2.4);
    key.position.set(2, 4, 3);
    const rim = new T.DirectionalLight(0xff4fd8, 1.6);
    rim.position.set(-3, 1, -2);
    cardView.scene.add(key, rim);
    cardView.camera = new T.PerspectiveCamera(30, 1, 0.1, 20);
    cardView.camera.position.set(0, 0.55, 3.4);
    cardView.camera.lookAt(0, 0.15, 0);
  }
  for (const icon of cardView.icons) cardView.scene.remove(icon);
  cardView.icons = cardList.map((c) => {
    const holder = new T.Group(),
      key = UPGRADE_EFFECTS[c.effect].icon;
    if (key === "star") {
      // no star model in the packs: a bevelled five-point star, gold
      const shape = new T.Shape();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 0.27 : 0.62,
          a = (i / 10) * Math.PI * 2 + Math.PI / 2;
        shape[i ? "lineTo" : "moveTo"](Math.cos(a) * r, Math.sin(a) * r);
      }
      const geo = new T.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.05, bevelSegments: 2 });
      geo.center();
      const star = new T.Mesh(geo, new T.MeshStandardMaterial({ color: 0xffc83d, metalness: 0.55, roughness: 0.3, emissive: 0x6a3a00, emissiveIntensity: 0.6 }));
      star.position.y = 0.1;
      holder.add(star);
    } else if (assets[key]) {
      if (c.effect === "rate") {
        // three bullets in a fan = rate of fire
        for (let i = -1; i <= 1; i++) {
          const b = model(key, 0.9);
          b.position.set(i * 0.38, -0.45 + Math.abs(i) * 0.08, -Math.abs(i) * 0.15);
          b.rotation.z = -i * 0.18;
          holder.add(b);
        }
      } else {
        const m = model(key, 1.25);
        m.position.y = -0.55;
        holder.add(m);
      }
    }
    holder.rotation.x = 0.12;
    cardView.scene.add(holder);
    return holder;
  });
  const loop = (now) => {
    if ($("cards").hidden) return;
    cardView.icons.forEach((icon, i) => {
      for (const o of cardView.icons) o.visible = o === icon;
      icon.rotation.y = now / 1300 + i * 2.1;
      cardView.renderer.render(cardView.scene, cardView.camera);
      const g = canvases[i].getContext("2d");
      g.clearRect(0, 0, 220, 220);
      g.drawImage(cardView.renderer.domElement, 0, 0, 220, 220);
    });
    cardView.frame = requestAnimationFrame(loop);
  };
  cardView.frame = requestAnimationFrame(loop);
}
if ($("cards-pick")) $("cards-pick").onclick = pickCard;
// Class names for the weapon block; upgrades belong to the class (kind), 0–3 bolts (cards come in step 4).
const WEAPON_CLASS_NAMES = ["ВИНТОВКА", "ДРОБОВИК", "ПП", "РАКЕТНИЦА", "ЛАЗЕР", "КЛИНОК"],
  classUpgrades = {};
function updateHUD() {
  $("hp").textContent = Math.ceil(hp);
  $("hpbar").style.width = Math.max(0, Math.min(100, (hp / playerMaxHp) * 100)) + "%";
  document.body?.classList?.toggle?.("hp-low", hp > 0 && hp / playerMaxHp < 0.3);
  // weapon picture and taken legendary cards
  const wimg = $("weaponimg"),
    wart = WEAPON_ART[weapons[gunIndex].name];
  if (wimg && wart && wimg.dataset?.w !== wart) {
    wimg.src = uiUrl("weapons/" + wart + ".webp");
    if (wimg.dataset) wimg.dataset.w = wart;
  }
  const perks = $("perks"),
    owned = ["vamp", "ricochet", "chain", "blastdash", "secondwind"].filter((k) => hasLegend(k) && !(k === "secondwind" && secondWindUsed));
  if (perks && perks.dataset?.k !== owned.join()) {
    perks.innerHTML = owned.map((k) => '<span class="hud-slot perk perk-' + k + '" title="' + UPGRADE_EFFECTS[k].word + '"></span>').join("");
    if (perks.dataset) perks.dataset.k = owned.join();
  }
  const blade = weapons[gunIndex].kind === 5;
  $("ammo").textContent = blade ? Math.floor(ammo) : ammo;
  $("reserve").textContent = blade ? "% ЗАРЯДА" : weapons[gunIndex].kind === 3 ? " ЗАЛПА / ∞" : " / ∞";
  $("weaponname").textContent = weapons[gunIndex].name;
  $("weaponclass").textContent = "· " + WEAPON_CLASS_NAMES[weapons[gunIndex].kind];
  const level = classUpgrades[weapons[gunIndex].kind] || 0,
    boltColor = "#" + weapons[gunIndex].color.toString(16).padStart(6, "0");
  const bolts = $("bolts");
  bolts.style?.setProperty?.("--bolt", boltColor);
  [...(bolts.children || [])].forEach((b, i) => b.classList?.toggle("on", i < level));
  $("weaponname").style.color = "#" + weapons[gunIndex].color.toString(16).padStart(6, "0");
  $("reloadtext").textContent = blade ? (ammo < weapons[gunIndex].mag ? "ЗАРЯД…" : "ГОТОВ") : "R";
  document.body?.classList?.toggle?.("reloading", !blade && reloading > 0);
  document.body?.classList?.toggle?.("blade", blade);
  $("weaponrole").textContent = weapons[gunIndex].description;
  $("weaponuse").textContent = weapons[gunIndex].use;
  $("score").textContent = hits + " ПОПАДАНИЙ · " + kills + " ПОБЕД";
  $("wave").textContent = sniperMode() && wave
    ? "СНАЙПЕРЫ · ОСТАЛОСЬ " + bots.filter((b) => !b.dead).length + (lastEnemies() ? " · " + nearestEnemyHint() : "")
    : wave && task && !task.done
    ? "ВОЛНА " + wave + "/" + WAVE_COUNT + " · " + taskHint() + " · " + enemyWord(bots.filter((b) => !b.dead).length)
    : wave && lastEnemies()
    ? "ОСТАЛОСЬ " + bots.filter((b) => !b.dead).length + " · " + nearestEnemyHint()
    : wave
    ? "ВОЛНА " + wave + "/" + WAVE_COUNT + " · ГРУППА " + waveGroup + "/" + WAVE_GROUPS[wave - 1].length + " · " + enemyWord(bots.filter((b) => !b.dead).length)
    : "ПОДГОТОВКА";
}
let hintTimer = 0;
function updateDashWidget() {
  const box = $("dashbox");
  if (!box?.classList?.toggle) return;
  const cd = dashCooldown > 0 && dashCharges <= 0;
  box.classList.toggle("cooling", cd);
  box.classList.toggle("power", dashCharges > 0);
  const t = cd ? Math.ceil(dashCooldown) + " с" : "",
    c = dashCharges > 0 ? "×" + dashCharges : "";
  if ($("dashtime").textContent !== t) $("dashtime").textContent = t;
  if ($("dashcharges").textContent !== c) $("dashcharges").textContent = c;
}
// «3 ВРАГА», «5 ВРАГОВ», «1 ВРАГ»
function enemyWord(n) {
  const a = n % 10,
    b = n % 100;
  return n + (a === 1 && b !== 11 ? " ВРАГ" : a >= 2 && a <= 4 && (b < 12 || b > 14) ? " ВРАГА" : " ВРАГОВ");
}
function lastEnemies() {
  if (!wave || waveGroup < WAVE_GROUPS[wave - 1].length) return false;
  const alive = bots.filter((b) => !b.dead && !b.giant).length;
  return alive > 0 && alive <= 3;
}
// distance and a direction arrow (relative to where you look) to the nearest enemy
function nearestEnemyHint() {
  const me = player.group.position;
  let best = null,
    bd = Infinity;
  for (const b of bots) {
    if (b.dead) continue;
    const d = b.group.position.distanceTo(me);
    if (d < bd) (bd = d), (best = b);
  }
  if (!best) return "";
  const look = viewMode === "rear" ? viewYaw : yaw,
    rel = Math.atan2(best.group.position.x - me.x, best.group.position.z - me.z) - look,
    a = Math.atan2(Math.sin(rel), Math.cos(rel)),
    arrows = ["↑", "↖", "←", "↙", "↓", "↘", "→", "↗"];
  return Math.round(bd) + " м " + arrows[(Math.round(a / (Math.PI / 4)) + 8) % 8];
}
function generatedEnemySpawn(i) {
  // a custom map with enemy spawn points: enemies appear only there (the ones at least 18 m away, round robin)
  if (generatedPlan.enemySpawns?.length) {
    const me = player.group.position,
      ok = generatedPlan.enemySpawns.filter((s) => Math.hypot(s.x - me.x, s.z - me.z) > 18),
      list = ok.length ? ok : generatedPlan.enemySpawns,
      s = list[i % list.length];
    return [s.x + ((i * 1.7) % 3) - 1.5, s.z + ((i * 2.3) % 3) - 1.5];
  }
  const near = generatedPlan.graph.nodes.filter(
      (n) =>
        Math.hypot(n.world.x - player.group.position.x, n.world.z - player.group.position.z) > 18 &&
        Math.hypot(n.world.x - player.group.position.x, n.world.z - player.group.position.z) < 95,
    ),
    // big arenas: if no node is within 95 m, use the nearest ones that are still at least 18 m away
    far = generatedPlan.graph.nodes
      .map((n) => [n, Math.hypot(n.world.x - player.group.position.x, n.world.z - player.group.position.z)])
      .filter(([, d]) => d > 18)
      .sort((a, b) => a[1] - b[1])
      .map(([n]) => n),
    node = near[i % near.length] || far[i % Math.max(1, Math.min(3, far.length))] || generatedPlan.graph.nodes[(i + 1) % generatedPlan.graph.nodes.length];
  if (i % 3 === 0) {
    const angle = i * 2.4;
    return [player.group.position.x + Math.cos(angle) * 24, player.group.position.z + Math.sin(angle) * 24];
  }
  return [node.world.x, node.world.z];
}
// Bots carry ranged weapons only: the plasma blade (kind 5) is skipped in their rotation.
// Only weapons of the tiers opened so far (tier N opens with wave N).
function botWeapon(n) {
  for (let k = 0; k < weapons.length; k++) {
    const index = (n + k) % weapons.length;
    if (weapons[index].kind !== 5 && (weapons[index].tier || 1) <= Math.max(1, wave)) return index;
  }
  return 0;
}
// ?weapon=<name> starts every round with that weapon (for testing), e.g. ?weapon=ОХОТНИК
function startWeapon() {
  const wanted = arenaParameters?.get("weapon")?.toUpperCase(),
    index = weapons.findIndex((w) => w.name === wanted);
  return index >= 0 ? index : 0;
}
// Waves arrive in groups: the next group comes after GROUP_PAUSE seconds, or sooner when ≤ 1 enemy is left.
// ── «ТЬМА»: once per run, in a random wave 2–4, the arena goes dark for ~25 s. Only the player's flashlight,
// muzzle flashes, explosions and the enemies' health bars stay visible.
const DARK = {
  wave: arenaParameters?.get("dark") ? 1 : 2 + Math.floor(Math.random() * 3),
  delay: arenaParameters?.get("dark") ? [0.05, 0.05] : [8, 22], // seconds into that wave (?dark=1: test, at once)
  length: 25,
  fade: arenaParameters?.get("dark") ? 0.05 : 1.6,
  timer: -1, // countdown to the start
  time: 0, // seconds since it started (0 = not running)
  level: 0,
  done: false,
};
let flashlight = null;
// ── TEST HOTKEYS (temporary, remove before release) ──
const tripleTaps = {};
// ?hudtest: three legendaries and a combo for HUD screenshots (TEST, remove before release)
function hudTest() {
  if (!arenaParameters?.has("hudtest")) return;
  for (const k of ["vamp", "ricochet", "chain"]) effectTaken[k] = 1;
  runStats.streak = 2;
  showCombo();
  hp = Math.round(playerMaxHp * 0.6);
  dashCooldown = 3;
  updateHUD();
}
function testTriple(code) {
  const now = performance.now(),
    t = (tripleTaps[code] ||= []);
  while (t.length && now - t[t.length - 1] > 1000) t.length = 0;
  t.push(now);
  if (t.length < 3) return;
  t.length = 0;
  if (!active || !wave) return;
  if (code === "Digit0") {
    waveGroup = WAVE_GROUPS[wave - 1].length; // no more groups this wave
    for (const b of bots) if (!b.dead) (b.hp = 0), kill(b, "moat");
    if (task && !task.done) finishTask("ТЕСТ: ЗАДАЧА ВЫПОЛНЕНА");
    message("ТЕСТ: ВОЛНА ПРОЙДЕНА", 1.5);
  } else if (DARK.time <= 0) {
    DARK.timer = -1;
    DARK.time = 0.001;
    message("ТЬМА", 3);
    sound(55, 0.6, "sawtooth", 0.05);
  }
}
function updateDarkness(dt) {
  if (DARK.timer > 0 && active) {
    DARK.timer -= dt;
    if (DARK.timer <= 0) {
      DARK.time = 0.001;
      message("ТЬМА", 3);
      sound(55, 0.6, "sawtooth", 0.05);
    }
  }
  let target = 0;
  if (DARK.time > 0) {
    DARK.time += dt;
    target = DARK.time < DARK.length ? 1 : 0;
    if (DARK.time >= DARK.length && DARK.level <= 0.001) {
      DARK.time = 0;
      DARK.done = true;
      message("СВЕТ ВЕРНУЛСЯ", 2);
    }
  }
  // finish the event early if the run ends
  if (!active && ended) target = 0;
  const before = DARK.level;
  DARK.level += Math.sign(target - DARK.level) * Math.min(Math.abs(target - DARK.level), dt / DARK.fade);
  if (DARK.level !== before || (DARK.level > 0 && !flashlight)) lighting.setDarkness?.(DARK.level);
  if (DARK.level > 0 && !flashlight) {
    flashlight = new T.SpotLight(0xfff1d6, 0, 26, 0.5, 0.45, 1.2);
    flashlight.castShadow = false;
    scene.add(flashlight, flashlight.target);
  }
  document.body?.style?.setProperty?.("--dark", DARK.level.toFixed(3));
  // health bars would glow in the dark: fade them with the light
  for (const b of bots) {
    if (b.dead || !b.bar?.material) continue;
    b.bar.material.transparent = true;
    b.bar.material.opacity = 1 - 0.9 * DARK.level;
  }
  if (flashlight) {
    flashlight.intensity = 420 * DARK.level;
    flashlight.visible = DARK.level > 0;
    if (flashlight.visible) {
      const chest = player.group.position.clone().add(new T.Vector3(0, 1.4, 0)),
        dir = bladeDirection(chest);
      flashlight.position.copy(chest).addScaledVector(dir, 0.3);
      flashlight.target.position.copy(chest).addScaledVector(dir, 10).setY(player.group.position.y);
      flashlight.target.updateMatrixWorld();
    }
  }
}
const WAVE_GROUPS = [
    [3, 3, 4],
    [4, 4, 5],
    [5, 5, 6],
    [6, 6, 7],
    [7, 7, 8], // the elite comes in the last group of the last wave
  ];
let WAVE_COUNT = WAVE_GROUPS.length; // 1 on the sniper map
const GROUP_PAUSE = [15, 30];
let waveGroup = 0,
  waveSpawned = 0,
  groupTimer = 0;
function nextWave() {
  if (sniperMode() && wave === 0) return startSniperWave();
  wave++;
  if (wave === DARK.wave && !sniperMode()) DARK.timer = DARK.delay[0] + Math.random() * (DARK.delay[1] - DARK.delay[0]);
  waveDelay = 0;
  waveGroup = waveSpawned = 0;
  spawnGroup();
  startTask();
  hp = Math.min(playerMaxHp, hp + 20);
  ammo = weapons[gunIndex].mag;
  message("ВОЛНА " + wave, 2.5);
  updateHUD();
}
function spawnGroup() {
  const groups = WAVE_GROUPS[wave - 1],
    count = groups[waveGroup],
    elite = groups.slice(0, -1).reduce((a, b) => a + b, 0) + 2; // third enemy of the last group of the last wave
  for (let i = waveSpawned; i < waveSpawned + count; i++) {
    const s = generatedPlan ? generatedEnemySpawn(i) : spawnPoints[((wave - 1) * 3 + i) % spawnPoints.length],
      bot = character(
        people[((wave - 1) * 7 + i) % people.length],
        s[0],
        s[1],
        true,
        botWeapon((wave - 1) * 7 + i),
      );
    const safe = nearestOpen(navCell(bot.group.position));
    bot.group.position.set(navMin + safe.x * navStep, 0, navMin + safe.z * navStep);
    bot.group.position.y = terrainHeight(bot.group.position.x, bot.group.position.z);
    if (!generatedPlan && i % 4 === 3) {
      const heights = skyPlatforms.filter((p) => p.h >= 6);
      const high = heights[Math.floor(i / 4) % heights.length];
      bot.group.position.set(high.x + 2, high.h, high.z - 2);
    }
    bot.hp = 55 + wave * 12;
    bot.maxHp = bot.hp;
    // (shield bearers removed: they no longer spawn)
    if (wave >= BOMBER.fromWave && i % 6 === 4 && i !== elite && bots.filter((o) => !o.dead && o.bomber).length < BOMBER.maxAlive) makeBomber(bot);
    if (wave === WAVE_COUNT && i === elite) {
      bot.elite = true;
      bot.hp = bot.maxHp = 240;
      bot.group.scale.setScalar(1.3);
      bot.bar.material.color.set(0xffb548);
    }
    recoverPosition(bot);
    bots.push(bot);
  }
  waveSpawned += count;
  waveGroup++;
  groupTimer = waveGroup < groups.length ? GROUP_PAUSE[0] + Math.random() * (GROUP_PAUSE[1] - GROUP_PAUSE[0]) : 0;
  if (waveGroup > 1) message("ГРУППА " + waveGroup + "/" + groups.length, 2);
  skyDrop();
  updateHUD();
}
function finish(win) {
  active = false;
  sfx.setMusic(musicEnabled, 0.3, arenaTrack);
  ended = true;
  mouseDown = false;
  hadMouseLock = false;
  document.exitPointerLock?.();
  $("pickup").hidden = true;
  $("overlay").style.display = "flex";
  $("menutext").textContent = win ? "Арена очищена · все " + WAVE_COUNT + " волн пройдены" : "Бой окончен · волна " + wave + " из " + WAVE_COUNT;
  showResults();
  $("start").textContent = "СЫГРАТЬ ЕЩЁ";
  message(win ? "ПОБЕДА" : "ПОРАЖЕНИЕ", 10);
}
// End-of-run screen: rank, three numbers and the player in idle with the last weapon on a low round podium.
const results = { renderer: null, scene: null, camera: null, hero: null, frame: 0, last: 0 };
function runSummary() {
  const s = runStats;
  return {
    rank: makeRank({ ...s, feats: { ...s.feats, combo: s.bestStreak }, kills, hits }),
    stats: [
      ["ВРАГОВ УБИТО", kills],
      ["УРОНА ПОЛУЧЕНО", Math.round(s.damage)],
      ["ВРЕМЯ", Math.floor(s.time / 60) + ":" + String(Math.floor(s.time % 60)).padStart(2, "0")],
    ],
  };
}
function showResults() {
  const summary = runSummary(),
    screen = $("results");
  $("results-rank").textContent = summary.rank;
  $("results-stats").innerHTML = summary.stats.map(([k, v]) => "<span>" + k + "<b>" + v + "</b></span>").join("");
  screen.hidden = false;
  try {
    buildPodium();
  } catch (e) {
    console.warn("podium", e);
  }
}
function buildPodium() {
  const canvas = $("podium");
  if (!canvas?.getContext) return;
  if (!results.renderer) {
    results.renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
    results.renderer.shadowMap.enabled = true;
    results.renderer.shadowMap.type = T.PCFSoftShadowMap;
    results.renderer.outputColorSpace = renderer.outputColorSpace;
    results.renderer.toneMapping = T.ACESFilmicToneMapping;
    results.scene = new T.Scene();
    results.camera = new T.PerspectiveCamera(28, 1, 0.1, 50);
    const sc = results.scene;
    sc.add(new T.HemisphereLight(0xd9e4ff, 0x2a1030, 1.6));
    const key = new T.DirectionalLight(0xfff0d8, 2.6);
    key.position.set(2.5, 5, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0004; // no striping (shadow acne) on the turning figure
    key.shadow.normalBias = 0.03;
    Object.assign(key.shadow.camera, { left: -2, right: 2, top: 3, bottom: -1, near: 0.5, far: 15 });
    sc.add(key);
    const rim = new T.DirectionalLight(0xff4fd8, 2.2);
    rim.position.set(-3, 3, -3);
    sc.add(rim);
    // low round podium: dark metal drum, golden glowing rim, lighter top
    const drum = new T.Mesh(new T.CylinderGeometry(1.05, 1.15, 0.28, 48), new T.MeshStandardMaterial({ color: 0x1d2030, metalness: 0.7, roughness: 0.35 }));
    drum.position.y = 0.14;
    drum.receiveShadow = true;
    const top = new T.Mesh(new T.CylinderGeometry(0.98, 0.98, 0.02, 48), new T.MeshStandardMaterial({ color: 0x2c3044, metalness: 0.4, roughness: 0.5 }));
    top.position.y = 0.29;
    top.receiveShadow = true;
    const ring = new T.Mesh(new T.TorusGeometry(1.06, 0.025, 8, 64), new T.MeshBasicMaterial({ color: 0xf6b73d }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.285;
    sc.add(drum, top, ring);
    // glow: a soft halo behind the figure and a light pool under the podium (additive radial sprites)
    const radial = (inner, outer) => {
      const c = document.createElement("canvas");
      c.width = c.height = 256;
      const g = c.getContext("2d"),
        grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
      grad.addColorStop(0, inner);
      grad.addColorStop(0.45, outer);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 256, 256);
      const t = new T.CanvasTexture(c);
      t.colorSpace = T.SRGBColorSpace;
      return t;
    };
    const glowMat = (map, opacity) =>
      new T.MeshBasicMaterial({ map, transparent: true, opacity, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false });
    const halo = new T.Mesh(new T.PlaneGeometry(3.4, 3.4), glowMat(radial("rgba(255,120,220,0.9)", "rgba(150,40,170,0.35)"), 0.85));
    halo.position.set(0, 1.25, -1.1);
    const halo2 = new T.Mesh(new T.PlaneGeometry(2.4, 2.4), glowMat(radial("rgba(255,214,120,0.9)", "rgba(246,183,61,0.25)"), 0.5));
    halo2.position.set(0, 1.35, -1.05);
    const pool = new T.Mesh(new T.PlaneGeometry(3.6, 3.6), glowMat(radial("rgba(246,183,61,0.9)", "rgba(255,80,200,0.3)"), 0.7));
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.005;
    // thin light beams rising from the podium rim
    const beams = new T.Group();
    for (let i = 0; i < 10; i++) {
      const b = new T.Mesh(
        new T.PlaneGeometry(0.06, 2.6),
        new T.MeshBasicMaterial({ color: i % 2 ? 0xff6ad5 : 0xf6b73d, transparent: true, opacity: 0.18, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide }),
      );
      const a = (i / 10) * Math.PI * 2;
      b.position.set(Math.cos(a) * 1.05, 1.6, Math.sin(a) * 1.05);
      b.rotation.y = -a;
      beams.add(b);
    }
    results.glow = { halo, halo2, pool };
    sc.add(halo, halo2, pool);
  }
  if (results.hero) {
    results.scene.remove(results.hero.group);
    results.hero.mixer.stopAllAction();
  }
  const hero = character(people[0], 0, 0, false, gunIndex);
  scene.remove(hero.group);
  hero.group.position.set(0, 0.3, 0);
  hero.group.rotation.y = 0.45;
  animate(hero, "idle");
  results.scene.add(hero.group);
  results.hero = hero;
  results.last = performance.now();
  if (results.frame) cancelAnimationFrame(results.frame);
  const loop = (now) => {
    if ($("results").hidden) return;
    const dt = Math.min(0.05, (now - results.last) / 1000);
    results.last = now;
    hero.mixer.update(dt);
    hero.group.rotation.y = 0.45 + Math.sin(now / 2600) * 0.25;
    if (results.glow) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 900);
      results.glow.halo.material.opacity = 0.7 + pulse * 0.25;
      results.glow.halo.scale.setScalar(1 + pulse * 0.06);
      results.glow.halo2.rotation.z = now / 4000;
      results.glow.pool.material.opacity = 0.55 + pulse * 0.25;
    }
    const box = canvas.parentElement,
      w = box.clientWidth,
      h = box.clientHeight;
    if (w && h) {
      if (canvas.width !== Math.round(w * Math.min(2, devicePixelRatio)) || canvas.height !== Math.round(h * Math.min(2, devicePixelRatio))) {
        results.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
        results.renderer.setSize(w, h, false);
      }
      const cam = results.camera;
      cam.aspect = w / h;
      // fit podium + 1.75 m figure (≈2.4 m tall, ≈2.4 m wide) into the canvas
      // frame a 2.6 m tall × 2.8 m wide box (podium + figure + gun) with a margin, centred on the canvas
      const tanHalf = Math.tan(T.MathUtils.degToRad(cam.fov / 2)),
        d = Math.max(2.5 / (2 * tanHalf), 2.8 / (2 * tanHalf * cam.aspect)) * 1.12;
      cam.position.set(0, 1.15 + d * 0.16, d);
      cam.lookAt(0, 1.05, 0);
      cam.updateProjectionMatrix();
      results.renderer.render(results.scene, cam);
    }
    results.frame = requestAnimationFrame(loop);
  };
  results.frame = requestAnimationFrame(loop);
}
function closeResults() {
  $("results").hidden = true;
  if (results.frame) cancelAnimationFrame(results.frame);
}
function chooseZoneStart() {
  // a custom map's player start wins over the zone picker
  if (generatedPlan?.playerStart) {
    const s = generatedPlan.playerStart;
    player.group.position.set(s.x, surfaceAt(s.x, s.z, s.y ?? Infinity), s.z);
    recoverPosition(player);
    return;
  }
  if (generatedPlan) {
    const zone = generatedPlan.zones.find((z) => z.id === $("startzone").value) || generatedPlan.zones[0];
    for (const [dx, dz] of [
      [0, 0],
      [4, 0],
      [-4, 0],
      [0, 4],
    ]) {
      const pos = new T.Vector3(zone.x + dx, 0, zone.z + dz);
      pos.y = terrainHeight(pos.x, pos.z);
      if (!occupied(pos.x, pos.y, pos.z, 0.7)) {
        player.group.position.copy(pos);
        player.safePosition = pos.clone();
        return;
      }
    }
    throw new Error("Generated start blocked");
  }
  if ($("startzone").value === "fort") {
    for (const x of [0, -4, 4]) {
      const position = new T.Vector3(x, 6, 0);
      if (occupied(x, 6, 0, 0.7) || !findPath(position, new T.Vector3(0, 0, 20)).length) continue;
      player.group.position.copy(position);
      player.safePosition = position.clone();
      return;
    }
  }
  const instance =
    zoneInstances.find((i) => i.template === $("startzone").value) ||
    zoneInstances.find((i) => i.template === "quarter");
  for (const [x, z] of zoneLayout(instance).spawns) {
    const y = terrainHeight(x, z);
    if (occupied(x, y, z, 0.7) || jumpPads.some((p) => Math.hypot(x - p.x, z - p.z) < 3)) continue;
    const position = new T.Vector3(x, y, z);
    if (
      findPath(
        position,
        generatedPlan
          ? new T.Vector3(generatedPlan.zones[0].x, 0, generatedPlan.zones[0].z)
          : new T.Vector3(0, 0, 18),
      ).length
    ) {
      player.group.position.copy(position);
      player.safePosition = position.clone();
      return;
    }
  }
  player.group.position.set(0, 0, 18);
}
function start() {
  closeResults();
  if (ended && generatedPlan) {
    const url = new URL(location.href);
    url.searchParams.set("seed", Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7));
    url.searchParams.set("autostart", "1");
    location.assign(url.href);
    return;
  }
  if (!started || ended) {
    while (projectiles.length) removeProjectile(projectiles.length - 1);
    for (const b of bots) {
      scene.remove(b.group);
      b.mixer.stopAllAction();
      b.bar.geometry.dispose();
      b.bar.material.dispose();
    }
    bots.length = 0;
    for (const d of drops) {
      scene.remove(d.group);
      unregisterPlacement(d.group);
      d.ring.geometry.dispose();
      d.ring.material.dispose();
    }
    drops.length = 0;
    clearSkyDrops();
    for (const c of explosives) {
      c.dead = false;
      c.hp = c.maxHp ?? 20;
      c.group.traverse((n) => {
        if (n.isMesh) n.layers.enableAll();
      });
      scene.add(c.group);
      if (!obstacles.includes(c.box)) obstacles.push(c.box);
    }
    for (const e of effects) {
      scene.remove(e.obj);
      disposeEffect(e.obj);
    }
    effects.length = 0;
    for (const kit of medkits) {
      kit.used = false;
      scene.add(kit.group);
    }
    for (const k in classUpgrades) delete classUpgrades[k];
    slowmo = 0;
    post?.setSaturation?.(1);
    post?.setTrail?.(0);
    sfx.setTimeScale?.(1);
    if ($("slowmo")?.style) $("slowmo").style.opacity = "0";
    resetUpgrades();
    giantSpawned = false;
    giantKnock.set(0, 0, 0);
    resetRunStats();
    hideCombo();
    WAVE_COUNT = sniperMode() ? 1 : WAVE_GROUPS.length;
    buildTowers();
    buildNavigation();
    spawnArenaWeapons();
    prewarmEffects();
    chooseZoneStart();
    // ?at=x,z (testing): start at that spot on whatever floor is there, e.g. ?at=0,0 for the hill summit
    const at = arenaParameters?.get("at")?.split(",").map(Number);
    if (at?.length === 2 && at.every(Number.isFinite)) player.group.position.set(at[0], terrainHeight(at[0], at[1]), at[1]);
    cameraFocus.copy(player.group.position);
    gunIndex = startWeapon();
    ammo = weapons[gunIndex].mag;
    attachGun(player, gunIndex);
    hp = playerMaxHp;
    spawnShield = SPAWN_SHIELD; // a few safe seconds at the start of every round
    for (const o of scene.children.filter((c) => c.userData.laserSight)) scene.remove(o); // stale sight lines
    if (generatedPlan?.warnings?.length) message("Карта: " + generatedPlan.warnings.slice(0, 2).join(", "), 5);
    clearOrbs();
    kills = hits = wave = 0;
    reloading = cooldown = waveDelay = 0;
    vy = 0;
    grounded = true;
    jumpFlight = null;
    padCooldown = 0;
    player.padMotion = new T.Vector3();
    player.padImpact = 0;
    dashTime = dashCooldown = shake = dashCharges = 0;
    ended = false;
    started = true;
    placeTraps();
    nextWave();
    setTimeout(hudTest, 50);
  }
  active = true;
  mouseDown = false;
  $("overlay").style.display = "none";
  $("overlay").classList?.remove?.("paused");
  audio ??= new (window.AudioContext || window.webkitAudioContext)();
  audio.resume();
  sfx.unlock();
  sfx.setVolumes({});
  sfx.setMusic(musicEnabled, 0.85, arenaTrack);
  lastMouse = null;
  captureRearMouse();
  canvas.style.cursor = viewMode === "rear" ? "none" : "crosshair";
  updateHUD();
}
function pause() {
  if (!started || ended || cardsOpen) return;
  active = false;
  sfx.setMusic(musicEnabled, 0.3, arenaTrack); // quieter under the pause menu
  mouseDown = false;
  hadMouseLock = false;
  document.exitPointerLock?.();
  lastMouse = null;
  for (const k in keys) keys[k] = false;
  $("pickup").hidden = true;
  $("overlay").style.display = "flex";
  $("overlay").classList?.add?.("paused");
  $("menutext").innerHTML = "Пауза. Арена ждёт.<br>Продолжи бой, когда будешь готов.";
  $("start").textContent = "ПРОДОЛЖИТЬ БОЙ";
}
$("results-close").onclick = closeResults;
// iOS: an interrupted or suspended audio context is resumed by the next touch, click or key,
// and when the page becomes visible again
if (typeof window !== "undefined" && window.addEventListener) {
  const wake = () => {
    sfx.unlock(); // the first gesture creates the sound engine (WebKit wants it inside a touch)
    sfx.resume();
    if (audio && audio.state !== "running" && audio.state !== "closed") audio.resume?.().catch?.(() => {});
  };
  for (const type of ["touchstart", "touchend", "pointerup", "click", "keydown", "change"]) window.addEventListener(type, wake, { capture: true, passive: true });
  document.addEventListener?.("visibilitychange", () => document.visibilityState === "visible" && wake());
}
// v170: arena/biome pickers only queue the new arena; it is loaded when the player presses Start
let pendingArenaUrl = null;
function queueArena(url) {
  pendingArenaUrl = url;
  const z = $("startzone");
  if (z) {
    z.innerHTML = '<option value="">Выберется после загрузки</option>';
    z.disabled = true;
  }
}
$("start").onclick = () => {
  if (TOUCH) preferLandscape();
  if (pendingArenaUrl) {
    pendingArenaUrl.searchParams.set("autostart", "1");
    location.assign(pendingArenaUrl.href);
    return;
  }
  start();
};
// Touch controls (phones, tablets). Twin-stick in isometric view; in rear view the right stick turns the camera.
const TOUCH = isTouchDevice(),
  touch = TOUCH
    ? createTouchControls({
        dash: () => dash(),
        reload: () => reload(),
        pickup: () => pickup(),
      })
    : null;
let touchFiring = false;
if (TOUCH) {
  document.body.classList.add("touch");
  $("pause").innerHTML = `<img src="${uiImage("icon-pause")}" alt="Пауза" style="width:60%;height:60%;object-fit:contain">`;
  // after rotating to landscape the page is still under the address bar: offer a tap to go fullscreen
  // (browsers only allow fullscreen from a tap; iPhone Safari has no page fullscreen at all, so no hint there)
  const hint = $("fullscreen-hint"),
    can = document.fullscreenEnabled && document.documentElement.requestFullscreen;
  const check = () => {
    const landscape = innerWidth > innerHeight;
    hint.classList.toggle("on", !!(can && landscape && !document.fullscreenElement && started));
  };
  hint.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    preferLandscape().then(check);
    hint.classList.remove("on");
  });
  addEventListener("resize", check);
  addEventListener("orientationchange", () => setTimeout(check, 300));
  document.addEventListener("fullscreenchange", check);
  // the "swap weapon" notice is the pickup button on touch
  $("pickup").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    pickup();
  });
}
const touchChest = new T.Vector3();
// Touch aiming is automatic: the nearest enemy in sight (in front first) within reach of the gun;
// with nobody in sight the isometric aim follows the way you move. In the rear view the camera is steered
// by the joystick, and while firing it is nudged towards an enemy close to the crosshair (aim assist).
let touchTarget = null;
// touch aim sensitivity (1 = original); also shortens the fire stick's travel in engine/touch.js
const TOUCH_AIM_SENSITIVITY = 1.15;
// Swipe look (rear view), PUBG-style: at 100 % a swipe from the screen centre to its edge turns 180°.
// While firing the same swipe turns slower (ADS), so you can hold the sight on a running enemy.
const LOOK_ADS = 0.8,
  LOOK_PITCH = 0.55; // vertical is calmer than horizontal
let lookSensitivity = 1.2;
try {
  const v = parseFloat(localStorage.getItem("blaster-look"));
  if (Number.isFinite(v)) lookSensitivity = v;
} catch {}
function applySwipeLook() {
  const l = touch?.look;
  if (!l) return;
  if (viewMode === "rear") {
    const perPx = (Math.PI / (innerWidth / 2)) * lookSensitivity,
      dx = l.dx + l.adsDx * LOOK_ADS,
      dy = l.dy + l.adsDy * LOOK_ADS;
    viewYaw -= dx * perPx;
    viewPitch = T.MathUtils.clamp(viewPitch - dy * perPx * LOOK_PITCH, -0.45, 0.22);
  }
  l.dx = l.dy = l.adsDx = l.adsDy = 0;
}
// swipe-look sensitivity slider (menu), 50–200 %, remembered
if ($("look-sens")) {
  const input = $("look-sens");
  input.value = Math.round(lookSensitivity * 100);
  $("look-sens-out").textContent = input.value;
  input.addEventListener("input", () => {
    lookSensitivity = input.value / 100;
    $("look-sens-out").textContent = input.value;
    try {
      localStorage.setItem("blaster-look", String(lookSensitivity));
    } catch {}
  });
}
function applyTouchAim(dt = 1 / 60) {
  touchFiring = touch.firing;
  // manual aim: the fire button dragged away from its centre
  const a = touch.aim,
    tilt = Math.hypot(a.x, a.y);
  // rear view: the fire finger aims by swiping (applySwipeLook); the stick-direction aim is isometric only
  if (a.active && tilt > 0.2 && viewMode !== "rear") {
    // isometric: the crosshair goes in the stick's direction from the player, farther with more tilt
    touchChest.copy(player.group.position).setY(player.group.position.y + 1.05).project(camera);
    const reach = 0.25 + 0.35 * Math.min(1, tilt);
    pointer.set(touchChest.x + ((a.x / tilt) * reach * innerHeight) / innerWidth, touchChest.y - (a.y / tilt) * reach);
    pointerKnown = true;
    $("crosshair").style.left = ((pointer.x + 1) / 2) * innerWidth + "px";
    $("crosshair").style.top = ((1 - pointer.y) / 2) * innerHeight + "px";
    return;
  }
  const me = player.group.position,
    w = weapons[gunIndex],
    reach = Math.max(14, Math.min(45, (w.range || 30) + 4)),
    look = viewMode === "rear" ? new T.Vector3(-Math.sin(viewYaw), 0, -Math.cos(viewYaw)) : lastMove;
  let best = null,
    bestScore = Infinity;
  const eye = me.clone().setY(me.y + 1.05);
  for (const b of bots) {
    if (b.dead) continue;
    const to = b.group.position.clone().sub(me),
      d = to.length();
    if (d > reach) continue;
    const facing = to.setY(0).normalize().dot(look),
      score = d * (1.6 - facing * 0.6);
    if (score < bestScore && visible(eye, b.group.position.clone().setY(b.group.position.y + 1.05))) {
      best = b;
      bestScore = score;
    }
  }
  touchTarget = best;
  if (viewMode === "rear") {
    if (best && touchFiring) {
      const to = best.group.position.clone().sub(me),
        want = Math.atan2(-to.x, -to.z);
      let delta = ((want - viewYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      if (Math.abs(delta) < 0.45) viewYaw += Math.sign(delta) * Math.min(Math.abs(delta), 2.5 * dt); // gentle assist
    }
    return;
  }
  const aimAt = best
    ? best.group.position.clone().setY(best.group.position.y + 1.05)
    : me.clone().addScaledVector(lastMove, 6).setY(me.y + 1.05);
  touchChest.copy(aimAt).project(camera);
  pointer.set(touchChest.x, touchChest.y);
  pointerKnown = true;
  $("crosshair").style.left = ((pointer.x + 1) / 2) * innerWidth + "px";
  $("crosshair").style.top = ((1 - pointer.y) / 2) * innerHeight + "px";
}
// Map load / export (menu). Loading stores the JSON in localStorage and reloads with ?map=custom.
if ($("loadmap")) {
  const dialog = $("mapdialog"),
    showError = (t) => ($("maperror").textContent = t || "");
  $("loadmap").onclick = () => {
    showError("");
    dialog.querySelector("b").textContent = "ЗАГРУЗИТЬ КАРТУ";
    dialog.querySelector("p").textContent = "Вставь JSON карты из редактора или выбери файл .json";
    try {
      $("mapjson").value = localStorage.getItem("blaster-map") || "";
    } catch {}
    dialog.hidden = false;
  };
  $("mapcancel").onclick = () => (dialog.hidden = true);
  $("mapfile").onchange = async (e) => {
    const file = e.target.files?.[0];
    if (file) $("mapjson").value = await file.text();
  };
  $("mapload").onclick = () => {
    let json;
    try {
      json = JSON.parse($("mapjson").value);
    } catch (e) {
      return showError("Не получается прочитать JSON: " + e.message);
    }
    const errors = validateMap(json);
    if (errors.length) return showError(errors.join("; "));
    try {
      localStorage.setItem("blaster-map", JSON.stringify(json));
    } catch {
      return showError("Браузер не дал сохранить карту (хранилище недоступно).");
    }
    const url = new URL(location.href);
    url.searchParams.set("map", "custom");
    url.searchParams.delete("seed");
    location.assign(url.href);
  };
  $("exportmap").onclick = async () => {
    if (!generatedPlan) return message("Классическую арену экспортировать нельзя", 2);
    generatedPlan.decor ||= decorate(generatedPlan);
    const text = JSON.stringify(exportMap(generatedPlan), null, 1);
    // show it in the dialog too (selected), because a published page may block clipboard and downloads
    $("mapjson").value = text;
    showError("");
    dialog.querySelector("b").textContent = "ЭКСПОРТ АРЕНЫ";
    dialog.querySelector("p").textContent = "JSON текущей арены — скопируй его (он уже выделен) или сохрани файлом.";
    dialog.hidden = false;
    $("mapjson").focus();
    $("mapjson").select();
    try {
      await navigator.clipboard.writeText(text);
      $("exportmap").textContent = "СКОПИРОВАНО В БУФЕР ✓";
    } catch {}
    // also offer it as a file
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    a.download = (generatedPlan.mapName || generatedPlan.typeName || "arena").replace(/[^\wа-яё-]+/gi, "-") + ".json";
    a.click();
    setTimeout(() => ($("exportmap").textContent = "ЭКСПОРТ АРЕНЫ"), 2500);
  };
  if (customMapError) message("Карта не загрузилась: " + customMapError, 6);
  // the editor is the same page with ?editor; the dialog's JSON (exported arena or pasted map) can go straight in
  const toEditor = (json) => {
    if (json) {
      try {
        localStorage.setItem("blaster-editor-map", json);
      } catch {}
    }
    const url = new URL(location.href);
    url.searchParams.set("editor", "");
    url.searchParams.delete("map");
    location.assign(url.href);
  };
  $("openeditor").onclick = () => toEditor(null);
  $("maptoeditor").onclick = () => {
    try {
      JSON.parse($("mapjson").value);
      toEditor($("mapjson").value);
    } catch {
      showError("Сначала вставь корректный JSON карты");
    }
  };
}
// Biome picker: empty = by seed (home biome more often); changing it reloads with a fresh seed.
if ($("biome")) {
  const picker = $("biome"),
    forced = arenaParameters?.get("biome") || "";
  picker.innerHTML =
    '<option value="">Случайный' + (generatedPlan?.biomeName && !forced ? " · сейчас " + generatedPlan.biomeName : "") + "</option>" +
    Object.entries(BIOMES)
      .map(([id, b]) => '<option value="' + id + '">' + b.name + "</option>")
      .join("");
  picker.value = BIOMES[forced] ? forced : "";
  picker.disabled = !generatedPlan;
  picker.onchange = () => {
    const url = new URL(location.href);
    if (picker.value) url.searchParams.set("biome", picker.value);
    else url.searchParams.delete("biome");
    url.searchParams.set("seed", Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7));
    url.searchParams.delete("arena");
    queueArena(url);
  };
}
// Arena type picker (testing): empty = random by seed; changing it loads a fresh arena of that type.
if ($("difficulty")) {
  const picker = $("difficulty"),
    cards = [...(document.querySelectorAll?.(".diff-card") || [])],
    mark = () => cards.forEach((c) => c.classList.toggle("on", c.dataset.diff === picker.value));
  for (const c of cards)
    c.onclick = () => {
      picker.value = c.dataset.diff;
      picker.dispatchEvent(new Event("change"));
      mark();
    };
  setTimeout(mark, 0);
  // keep each card name on one line inside the frame: shrink only the ones that do not fit
  const fitDiffNames = () => {
    for (const b of document.querySelectorAll?.(".diff-card b") || []) {
      b.style.fontSize = "";
      const box = b.clientWidth,
        need = b.scrollWidth;
      if (box && need > box) b.style.fontSize = parseFloat(getComputedStyle(b).fontSize) * (box / need) * 0.98 + "px";
    }
  };
  // (auto-fit switched off: the names use a fixed size again)
  picker.value = Object.keys(DIFFICULTY).find((k) => DIFFICULTY[k] === difficulty) || "mama";
  picker.addEventListener("change", () => {
    difficulty = DIFFICULTY[picker.value] || DIFFICULTY.mama;
    try {
      localStorage.setItem("blaster-difficulty", picker.value);
    } catch {}
  });
}
if ($("arenatype")) {
  const picker = $("arenatype"),
    forced = arenaParameters?.get("type") || "";
  picker.innerHTML =
    '<option value="">Случайная' + (generatedPlan?.typeName && !forced ? " · сейчас " + generatedPlan.typeName : "") + "</option>" +
    Object.entries(ARENA_TYPES)
      .map(([id, t]) => '<option value="' + id + '">' + t.name + "</option>")
      .join("");
  picker.value = ARENA_TYPES[forced] ? forced : "";
  picker.disabled = !generatedPlan;
  picker.onchange = () => {
    const url = new URL(location.href);
    if (picker.value) url.searchParams.set("type", picker.value);
    else url.searchParams.delete("type");
    url.searchParams.set("seed", Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7));
    url.searchParams.delete("arena");
    queueArena(url);
  };
}
if ($("newarena"))
  $("newarena").onclick = () => {
    const url = new URL(location.href);
    url.searchParams.set("seed", Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7));
    location.assign(url.href);
  };
$("pause").onclick = pause;
$("immortality").onclick = toggleImmortality;
$("viewtoggle").onclick = toggleView;
if ($("viewkey")) $("viewkey").onclick = (e) => (toggleView(), e.currentTarget?.blur?.());
if ($("musicmenu")) {
  $("musicmenu").onclick = () => {
    sfx.unlock();
    sfx.resume();
    toggleMusic();
  };
  showMusic();
}
// iOS 17+: play through the silent switch like a game/video, not as muted "ambient" page sound
try {
  if (typeof navigator !== "undefined" && navigator.audioSession) navigator.audioSession.type = "playback";
} catch {}
if ($("musictoggle")) {
  $("musictoggle").onclick = () => {
    toggleMusic();
    $("musictoggle").blur();
  };
  showMusic();
}
const qualityButton = $("quality");
function showQuality() {
  qualityButton.hidden = !post;
  if (post) qualityButton.textContent = "КАЧЕСТВО: " + QUALITY_NAMES[post.quality];
}
qualityButton.onclick = () => {
  if (!post) return;
  post.quality = QUALITIES[(QUALITIES.indexOf(post.quality) + 1) % QUALITIES.length];
  try {
    localStorage.setItem("blaster-quality", post.quality);
  } catch {}
  showQuality();
  qualityButton.blur();
};
showQuality();
document.addEventListener("keydown", (e) => {
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
  keys[e.code] = true;
  if (e.repeat) return;
  if (e.code === "KeyE") pickup();
  if (e.code === "KeyR") reload();
  if (e.code === "KeyV") toggleView();
  if (e.code === "KeyP" && !e.repeat) toggleImmortality();
  // TEST HOTKEYS (temporary, remove before release): 0-0-0 clears the wave, 9-9-9 starts «Тьма»
  if ((e.code === "Digit0" || e.code === "Digit9") && !e.repeat) testTriple(e.code);
  if (e.code === "KeyM") toggleMusic();
  if (e.code === "Escape") pause();
});
document.addEventListener("keyup", (e) => (keys[e.code] = false));
function captureRearMouse() {
  if (viewMode !== "rear" || !active || TOUCH) return;
  try {
    const result = canvas.requestPointerLock?.();
    result?.catch(() => {});
  } catch {}
}
function toggleView() {
  viewMode = viewMode === "iso" ? "rear" : "iso";
  document.body?.classList?.toggle?.("rear-view", viewMode === "rear");
  camera = viewMode === "iso" ? isoCamera : rearCamera;
  lastMouse = null;
  canvas.style.cursor = viewMode === "rear" ? "none" : "crosshair";
  if (viewMode === "rear") {
    viewYaw = yaw;
    viewPitch = -0.18;
    captureRearMouse();
    $("crosshair").style.left = "50%";
    $("crosshair").style.top = "50%";
  } else {
    hadMouseLock = false;
    document.exitPointerLock?.();
    screenUp.set(-1, 0, -1).normalize();
    screenRight.set(1, 0, -1).normalize();
    pointerKnown = false;
  }
  $("viewtoggle").textContent = "V · ВИД: " + (viewMode === "iso" ? "ИЗОМЕТРИЯ" : "СЗАДИ");
  if (player) {
    updateCamera(1);
    updateAim();
  }
}
document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement === canvas) hadMouseLock = true;
  else if (hadMouseLock) {
    hadMouseLock = false;
    if (active && viewMode === "rear") pause();
  }
});
document.addEventListener("mousemove", (e) => {
  // phones send emulated mouse events after taps: they must not turn the camera or move the aim
  if (TOUCH) return;
  pointer.set((e.clientX / innerWidth) * 2 - 1, 1 - (e.clientY / innerHeight) * 2);
  pointerKnown = true;
  if (viewMode === "rear") {
    if (!active) return;
    if (document.pointerLockElement === canvas) {
      viewYaw -= e.movementX * 0.003;
      viewPitch = T.MathUtils.clamp(viewPitch - e.movementY * 0.002, -0.8, 0.55);
    } else if (e.target === canvas) {
      if (lastMouse) {
        viewYaw -= (e.clientX - lastMouse.x) * 0.003;
        viewPitch = T.MathUtils.clamp(viewPitch - (e.clientY - lastMouse.y) * 0.002, -0.8, 0.55);
      }
      lastMouse = { x: e.clientX, y: e.clientY };
    } else lastMouse = null;
  } else {
    $("crosshair").style.left = e.clientX + "px";
    $("crosshair").style.top = e.clientY + "px";
  }
});
canvas.addEventListener("mousedown", (e) => {
  if (TOUCH) return; // emulated mouse after a tap: firing on touch is the fire button only
  if (active && e.button === 0) mouseDown = true;
  if (e.button === 2) dash();
});
document.addEventListener("mouseup", (e) => {
  if (e.button === 0) mouseDown = false;
});
document.addEventListener("contextmenu", (e) => e.preventDefault());
window.addEventListener("blur", () => {
  if (active) pause();
});
window.addEventListener("resize", () => {
  const aspect = innerWidth / innerHeight;
  isoCamera.left = (-VIEW_HEIGHT * aspect) / 2;
  isoCamera.right = (VIEW_HEIGHT * aspect) / 2;
  isoCamera.updateProjectionMatrix();
  rearCamera.aspect = aspect;
  rearCamera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  post?.setSize(innerWidth, innerHeight);
  // phones: undo any pan the browser applied while bars or the orientation changed
  if (scrollX || scrollY) scrollTo(0, 0);
});
addEventListener("orientationchange", () => setTimeout(() => (scrollTo(0, 0), dispatchEvent(new Event("resize"))), 350));
window.visualViewport?.addEventListener("resize", () => {
  if (scrollX || scrollY || visualViewport.offsetLeft || visualViewport.offsetTop) scrollTo(0, 0);
});
function updateCamera(dt) {
  if (viewMode === "iso") {
    if (OVERVIEW) cameraFocus.set(0, 0, 0);
    else cameraFocus.lerp(player.group.position.clone(), 1 - Math.exp(-8 * dt));
    camera.position.copy(cameraFocus).add(cameraOffset);
    camera.lookAt(cameraFocus);
  } else {
    const target = player.group.position.clone().add(new T.Vector3(0, 1.4, 0)),
      horizontal = new T.Vector3(Math.sin(viewYaw), 0, Math.cos(viewYaw)),
      side = new T.Vector3(-Math.cos(viewYaw), 0, Math.sin(viewYaw));
    let desired = target
      .clone()
      .addScaledVector(horizontal, -7.5 / CAMERA_ZOOM)
      .addScaledVector(side, 1.3 / CAMERA_ZOOM)
      .add(new T.Vector3(0, 2.4 / CAMERA_ZOOM, 0));
    const delta = desired.clone().sub(target);
    ray.set(target, delta.clone().normalize());
    ray.far = delta.length();
    const wall = intersectWorld(ray)[0];
    if (wall)
      desired = target.clone().addScaledVector(delta.normalize(), Math.max(0.45, wall.distance - 0.25));
    camera.position.lerp(desired, 1 - Math.exp(-12 * dt));
    const dir = new T.Vector3(
      Math.sin(viewYaw) * Math.cos(viewPitch),
      Math.sin(viewPitch),
      Math.cos(viewYaw) * Math.cos(viewPitch),
    );
    camera.lookAt(camera.position.clone().addScaledVector(dir, 30));
  }
  player.root.visible = viewMode === "iso" || camera.position.distanceTo(player.group.position) > 2.7;
  player.gun.visible = player.root.visible;
  if (shake > 0 && viewMode === "iso") {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.z += (Math.random() - 0.5) * shake;
  }
  flashes.update(dt);
  if (player) updateBlade(dt);
  if (active) updateMoatHazard(dt);
  if (torchLights.length) updateTorches(performance.now() / 1000);
  if (player) updateSfx();
  lighting.updateSky?.(camera);
  lighting.follow(viewMode === "iso" ? cameraFocus : player.group.position, viewMode);
  camera.updateMatrixWorld(true);
}
function updateAim() {
  if (viewMode === "rear") {
    yaw = viewYaw;
    screenUp.set(Math.sin(viewYaw), 0, Math.cos(viewYaw));
    screenRight.set(-Math.cos(viewYaw), 0, Math.sin(viewYaw));
  } else {
    if (!pointerKnown) {
      aimPoint.copy(player.group.position).addScaledVector(screenUp, 10);
      aimPoint.y = 1.05;
    } else {
      aimRay.setFromCamera(pointer, camera);
      aimRay.far = 180;
      const ground = aimRay.intersectObjects(
        terrainIndex.querySegment(aimRay.ray.origin, aimRay.ray.direction, aimRay.far),
        false,
      )[0];
      if (ground) {
        aimPoint.copy(ground.point);
        aimPoint.y = terrainHeight(aimPoint.x, aimPoint.z) + 1.05;
      } else {
        aimPlane.constant = -(player.group.position.y + 1.05);
        aimRay.ray.intersectPlane(aimPlane, aimPoint);
      }
      let distance = ground ? ground.distance : 180;
      for (const c of explosives)
        if (!c.dead) {
          const point = aimRay.ray.intersectBox(c.box, new T.Vector3());
          if (point) {
            const d = aimRay.ray.origin.distanceTo(point);
            if (d < distance) {
              distance = d;
              aimPoint.copy(point);
            }
          }
        }
      for (const b of bots)
        if (!b.dead) {
          const d = botContact(aimRay.ray.origin, aimRay.ray.direction, distance, b)?.d ?? null;
          if (d !== null) {
            distance = d;
            aimPoint.copy(aimRay.ray.origin).addScaledVector(aimRay.ray.direction, d);
          }
        }
    }
    const d = aimPoint.clone().sub(player.group.position).setY(0);
    if (d.lengthSq() > 0.05) yaw = Math.atan2(d.x, d.z);
  }
  player.group.rotation.y = yaw;
}
function updateOcclusion() {
  for (const m of faded) m.material.opacity = 1;
  faded.length = 0;
  const point = player.group.position.clone().add(new T.Vector3(0, 1, 0)),
    d = point.clone().sub(camera.position);
  ray.set(camera.position, d.clone().normalize());
  ray.far = d.length();
  for (const hit of intersectWorld(ray)) {
    const m = hit.object;
    if (m.material.transparent) {
      m.material.opacity = 0.22;
      faded.push(m);
    }
  }
}
function updateBotLaserAim(b, dt) {
  const a = b.laserAim;
  a.time -= dt;
  a.line.position.copy(weaponMuzzle(b));
  a.line.material.opacity = 0.15 + (1 - a.time / 0.55) * 0.55; // the sight line brightens before the shot
  const cancel = b.dead || b.stun > 0;
  if (a.time > 0 && !cancel) return;
  scene.remove(a.line);
  a.line.geometry.dispose();
  a.line.material.dispose();
  b.laserAim = null;
  if (cancel) return;
  const muzzle = weaponMuzzle(b);
  muzzleFlash(muzzle, b.weaponIndex);
  const shot = shotSound(weapons[b.weaponIndex]);
  if (shot) sfx.play(shot.name, { position: muzzle, group: "enemy", volume: shot.volume * 0.75, rate: (shot.rate ?? 1) * 0.97 });
  shooter = b;
  spawnProjectile(muzzle, a.dir, b.weaponIndex, true);
  shooter = null;
}
// ── SNIPER MAP («Снайперы на вышках») ───────────────────────────────────────────────────────────────────
// A ravine arena packed with cover and ~10 wooden towers, a sniper on each. One wave: kill them all.
// Snipers stand still and fire a long laser after a 0.9 s red sight line (0.7 s on hard) — break line of
// sight or sidestep. A red powder crate sits at every tower's foot: blow it and the tower falls over and
// takes its sniper with it. Towers standing in the ravine drop their sniper into it.
const SNIPER = { hp: 150, range: 95, damage: 28, aim: [0.6, 0.45], pause: [1.5, 2.3], towerHeight: 8, spacing: 15, barrel: { moat: 0.5, ground: 0.25, ditch: 0.5 } };
const towers = [];
const sniperMode = () => generatedPlan?.type === "snipers";
function clearTowers() {
  for (const t of towers) {
    scene.remove(t.group);
    for (const box of t.boxes) {
      const i = obstacles.indexOf(box);
      if (i >= 0) obstacles.splice(i, 1);
    }
    if (t.barrel) {
      scene.remove(t.barrel.group);
      unregisterPlacement(t.barrel.group);
      const i = obstacles.indexOf(t.barrel.box);
      if (i >= 0) obstacles.splice(i, 1);
      explosives.splice(explosives.indexOf(t.barrel), 1);
    }
  }
  towers.length = 0;
}
function buildTowers() {
  clearTowers();
  if (!sniperMode()) return;
  const random = seededRandom(generatedPlan.seed + "-towers"),
    limit = (generatedPlan.limit || 100) - 12,
    start = generatedPlan.playerStart || generatedPlan.zones?.[0] || { x: 0, z: 0 },
    spots = (generatedPlan.towerSpots || []).map((p) => ({ x: p.x, y: terrainHeight(p.x, p.z), z: p.z, moat: true }));
  const inMoatArea = (x, z) => (generatedPlan.moat || []).some((m) => Math.abs(x - m.x) < m.w / 2 + 2.5 && Math.abs(z - m.z) < m.d / 2 + 2.5);
  for (let tries = 0; tries < 1600 && spots.length < (generatedPlan.snipers || 10); tries++) {
    const x = (random() * 2 - 1) * limit,
      z = (random() * 2 - 1) * limit,
      y = terrainHeight(x, z);
    // the first 600 tries look only in the ravine: up to 3 towers stand down there
    if (tries < 600 && (y > -1 || spots.filter((p) => p.ditch).length >= 3)) continue;
    if (Math.hypot(x - start.x, z - start.z) < 26 || inMoatArea(x, z)) continue;
    if (spots.some((p) => Math.hypot(p.x - x, p.z - z) < SNIPER.spacing)) continue;
    // a 3 × 3 m foot with nothing on it and flat enough
    let ok = true;
    for (const [dx, dz] of [[0, 0], [1.6, 1.6], [-1.6, 1.6], [1.6, -1.6], [-1.6, -1.6]])
      if (occupied(x + dx, y, z + dz, 0.5) || Math.abs(terrainHeight(x + dx, z + dz) - y) > 0.3) ok = false;
    if (ok) spots.push({ x, y, z, ditch: y < -1 });
  }
  const wood = new T.MeshStandardMaterial({ color: 0x7a5232, roughness: 0.85 }),
    plank = new T.MeshStandardMaterial({ color: 0x5c3d24, roughness: 0.9 }),
    rope = new T.MeshStandardMaterial({ color: 0xb59a6a, roughness: 0.9 });
  for (const s0 of spots) {
    const group = new T.Group(),
      H = SNIPER.towerHeight - Math.min(0, s0.y), // towers in the ravine are taller: the top is ~8 m above ground level
      boxes = [];
    for (const [lx, lz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) {
      const leg = new T.Mesh(new T.BoxGeometry(0.32, H, 0.32), wood);
      leg.position.set(lx, H / 2, lz);
      leg.castShadow = true;
      group.add(leg);
      boxes.push(new T.Box3(new T.Vector3(s0.x + lx - 0.16, s0.y, s0.z + lz - 0.16), new T.Vector3(s0.x + lx + 0.16, s0.y + H, s0.z + lz + 0.16)));
    }
    for (const h of [H * 0.35, H * 0.7]) // cross braces
      for (const [rx, rz, ry] of [[0, -1.3, 0], [0, 1.3, 0], [-1.3, 0, Math.PI / 2], [1.3, 0, Math.PI / 2]]) {
        const brace = new T.Mesh(new T.BoxGeometry(2.7, 0.14, 0.14), rope);
        brace.position.set(rx, h, rz);
        brace.rotation.y = ry;
        group.add(brace);
      }
    const top = new T.Mesh(new T.BoxGeometry(3.4, 0.3, 3.4), plank);
    top.position.y = H;
    top.castShadow = top.receiveShadow = true;
    group.add(top);
    for (const [px, pz, w, d] of [[0, -1.6, 3.4, 0.15], [0, 1.6, 3.4, 0.15], [-1.6, 0, 0.15, 3.4], [1.6, 0, 0.15, 3.4]]) {
      const rail = new T.Mesh(new T.BoxGeometry(w, 0.7, d), plank);
      rail.position.set(px, H + 0.5, pz);
      group.add(rail);
    }
    const slab = new T.Box3(new T.Vector3(s0.x - 1.7, s0.y + H - 0.15, s0.z - 1.7), new T.Vector3(s0.x + 1.7, s0.y + H + 0.15, s0.z + 1.7));
    slab.standable = true;
    boxes.push(slab);
    group.position.set(s0.x, s0.y, s0.z);
    scene.add(group);
    obstacles.push(...boxes);
    // the powder crate at its foot, on the side that faces the arena centre
    const a = Math.atan2(-s0.z, -s0.x) + (random() - 0.5) * 0.8;
    let barrel = null;
    // only some towers have a powder crate (most must be shot down the hard way)
    if (random() < SNIPER.barrel[s0.moat ? "moat" : s0.ditch ? "ditch" : "ground"])
      for (let k = 0; k < 8 && !barrel; k++) barrel = makeExplosive(s0.x + Math.cos(a + k * 0.8) * 2.6, s0.z + Math.sin(a + k * 0.8) * 2.6) || null;
    towers.push({ group, boxes, barrel, x: s0.x, y: s0.y, z: s0.z, top: s0.y + H + 0.15, ditch: s0.ditch, down: false });
  }
}
function startSniperWave() {
  wave = 1;
  WAVE_COUNT = 1;
  waveDelay = 0;
  waveGroup = WAVE_GROUPS[0].length; // no groups: everyone is already up there
  for (const t of towers) {
    const b = character(people[(towers.indexOf(t) * 5) % people.length], t.x, t.z, true, Math.max(0, weapons.findIndex((w) => w.name === "ПУЛЬС")));
    b.group.position.set(t.x, t.top, t.z);
    b.sniper = true;
    b.tower = t;
    t.sniper = b;
    b.hp = b.maxHp = SNIPER.hp;
    b.shot = 2 + Math.random() * 3;
    bots.push(b);
  }
  for (let i = 0; i < 3; i++) skyDrop(); // long guns from the sky to answer with
  message("СНИМИ ВСЕХ СНАЙПЕРОВ", 3);
  updateHUD();
}
function updateSniper(b, dt) {
  b.mixer.update(dt);
  b.flash = Math.max(0, b.flash - dt);
  b.bar.quaternion.copy(camera.quaternion);
  b.bar.scale.x = Math.max(0.01, b.hp / b.maxHp);
  b.bar.material.color.set(b.flash > 0 ? 0xffffff : 0xff3040);
  const me = player.group.position,
    eye = b.group.position.clone().add(new T.Vector3(0, 1.4, 0)),
    chest = me.clone().add(new T.Vector3(0, 1.05, 0)),
    distance = eye.distanceTo(chest);
  b.group.rotation.y = Math.atan2(me.x - b.group.position.x, me.z - b.group.position.z);
  animate(b, "idle");
  const hard = difficulty === DIFFICULTY.hard ? 1 : 0;
  if (b.laserAim) {
    const A = b.laserAim;
    A.time -= dt;
    A.line.position.copy(weaponMuzzle(b));
    A.line.material.opacity = 0.2 + (1 - A.time / SNIPER.aim[hard]) * 0.6;
    if (A.time > 0) return;
    scene.remove(A.line);
    A.line.geometry.dispose();
    A.line.material.dispose();
    b.laserAim = null;
    const muzzle = weaponMuzzle(b);
    muzzleFlash(muzzle, b.weaponIndex);
    sfx.play("laser-pulse", { position: muzzle, group: "enemy", volume: 0.9, rate: 0.85 });
    laserShot(muzzle, A.dir, b.weaponIndex, true, { range: SNIPER.range, damage: SNIPER.damage });
    return;
  }
  b.shot -= dt;
  if (b.shot > 0 || distance > SNIPER.range || !visible(eye, chest)) return;
  b.shot = SNIPER.pause[0] + Math.random() * (SNIPER.pause[1] - SNIPER.pause[0]);
  const muzzle = weaponMuzzle(b),
    // leads a running target: aims where you will be when the shot goes off
    dir = chest
      .clone()
      .addScaledVector(playerVel, SNIPER.aim[hard] * 0.85)
      .add(new T.Vector3((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6))
      .sub(muzzle)
      .normalize(),
    len = SNIPER.range,
    line = new T.Mesh(
      new T.CylinderGeometry(0.03, 0.03, len, 6).rotateX(Math.PI / 2).translate(0, 0, len / 2),
      new T.MeshBasicMaterial({ color: HDR(0xff2a3a, 2.5), transparent: true, opacity: 0.2, depthWrite: false }),
    );
  line.position.copy(muzzle);
  line.lookAt(muzzle.clone().add(dir));
  line.userData.laserSight = true;
  scene.add(line);
  b.laserAim = { time: SNIPER.aim[hard], dir, line };
}
function collapseTower(t) {
  if (t.down) return;
  t.down = true;
  for (const box of t.boxes) {
    const i = obstacles.indexOf(box);
    if (i >= 0) obstacles.splice(i, 1);
    collisionIndex.remove(box);
    navigationQueue.push(box.clone());
  }
  shake = Math.max(shake, 0.3 * Math.max(0.2, 1 - Math.hypot(player.group.position.x - t.x, player.group.position.z - t.z) / 40));
  sfx.play("rocket-blast", { position: new T.Vector3(t.x, t.y, t.z), group: "impact", volume: 0.8, rate: 0.6 });
  const s = t.sniper;
  if (s && !s.dead) {
    if (s.laserAim) (scene.remove(s.laserAim.line), (s.laserAim = null));
    s.group.position.set(t.x, terrainHeight(t.x, t.z), t.z); // it falls with the tower
    s.hp = 0;
    kill(s, "barrel");
    message(t.ditch ? "СНАЙПЕР СОРВАЛСЯ В РОВ" : "ВЫШКА РУХНУЛА", 1.6);
  }
  // fall over away from the crate, then sink into the ground
  const away = t.barrel ? Math.atan2(t.z - t.barrel.group.position.z, t.x - t.barrel.group.position.x) : Math.random() * 6.28;
  t.fall = { time: 0, axis: new T.Vector3(Math.sin(away), 0, -Math.cos(away)) };
}
function updateTowers(dt) {
  for (const t of towers) {
    if (!t.fall || t.gone) continue;
    t.fall.time += dt;
    const k = Math.min(1, t.fall.time / 1.1);
    t.group.quaternion.setFromAxisAngle(t.fall.axis, k * k * 1.45);
    if (t.fall.time > 1.1 && !t.fall.landed) {
      t.fall.landed = true;
      impact(new T.Vector3(t.x, t.y + 0.3, t.z), 0xc89060, 2.4);
      shake = Math.max(shake, 0.2);
    }
    if (t.fall.time > 2.5) t.group.position.y = t.y - (t.fall.time - 2.5) * 2;
    if (t.fall.time > 4.5) (scene.remove(t.group), (t.gone = true));
  }
}
// ── GIANT (boss) ─────────────────────────────────────────────────────────────────────────────────────────
// A bot model ×3 with a gun in each hand. Walks at you (wall-following when blocked), smashes crates and barrels
// under its feet, can't fit under bridges or through narrow gaps, climbs ledges up to 1.3 m (else walks around),
// hops out of the moat. Every few seconds it jumps: the landing sends a shockwave that hurts and throws you
// unless you are in the air. Each hand has a glowing weak point:
// each arm holds GIANT.armShare of the health: damage on its weak point drains it (and the total); a drained
// arm falls off with its gun; both arms off = dead.
const GIANT = {
    wave: WAVE_GROUPS.length, // the last wave, after the elite
    model: "character-male-d",
    scale: 3,
    hp: 2600,
    radius: 1.25, // collision radius
    height: 5.2,
    step: 1.3, // highest ledge it steps onto
    // speed, weapon, bursts and jump timing come from the type (GIANT_TYPES)
    weakRadius: 0.55,
    armShare: 0.4, // each arm holds 40 % of the giant's health; damage on its weak point drains it
    waveRadius: 13, // at full health; grows to +9 m as it gets hurt (giantWaveRadius)
    waveDamage: 28,
    body: [
      [0.9, 1.2],
      [2.4, 1.35],
      [3.9, 1.15],
      [4.9, 0.8],
    ],
  },
  // Giant types: weapon, how it fights and its tint. keep = [min, max] distance it holds from you.
  GIANT_TYPES = {
    smg: { name: "ГИГАНТ-ПУЛЕМЁТЧИК", weapon: "ВЕКТОР", burst: 6, fireGap: 0.2, burstPause: 1.6, speed: 2.3, jumpEvery: [7, 11], keep: [0, 6], tint: null },
    shotgun: { name: "ГИГАНТ-ДРОБОВИК", weapon: "ГРОМ", burst: 2, fireGap: 0.5, burstPause: 1.8, pellets: 5, speed: 3, jumpEvery: [5, 8], keep: [0, 4], tint: 0xff9a3c },
    // rocket launcher in the right hand, an SMG in the left
    rocket: { name: "ГИГАНТ-РАКЕТЧИК", weapon: "ЗАЛП", burst: 1, fireGap: 0.9, burstPause: 3.4, speed: 1.9, jumpEvery: [9, 13], keep: [14, 22], tint: 0xff4a4a, left: { weapon: "ВЕКТОР", burst: 6, fireGap: 0.2, burstPause: 1.8 } },
    laser: { name: "ГИГАНТ-ЛАЗЕРЩИК", weapon: "ПУЛЬС", burst: 1, fireGap: 0.4, burstPause: 2.2, speed: 2.1, jumpEvery: [8, 12], keep: [11, 18], tint: 0x6ae8ff },
  },
  giantKnock = new T.Vector3();
let giantSpawned = false;
// shockwave radius grows as the giant gets hurt: 13 m at full health → 22 m with 20 % left
function giantWaveRadius(g) {
  const hurt = 1 - Math.max(0, g.hp) / g.maxHp;
  return GIANT.waveRadius + 9 * Math.min(1, hurt / 0.8);
}
function giantOccupied(x, y, z) {
  const r = GIANT.radius,
    top = y + GIANT.height;
  if (Math.abs(x) > WORLD_LIMIT - r || Math.abs(z) > WORLD_LIMIT - r) return true;
  if (platforms.some((p) => y + GIANT.step < p.h && x > p.x - p.w / 2 - r && x < p.x + p.w / 2 + r && z > p.z - p.d / 2 - r && z < p.z + p.d / 2 + r))
    return true;
  return collisionIndex.queryPoint(x, z, r).some(
    (b) =>
      // anything between its knees and its head blocks it — bridges and arches included
      b.max.y > y + GIANT.step && b.min.y < top && x > b.min.x - r && x < b.max.x + r && z > b.min.z - r && z < b.max.z + r,
  );
}
function giantSmash(g) {
  const p = g.group.position;
  for (const w of breakWalls) {
    if (w.down) continue;
    const b = w.box,
      r = GIANT.radius + 0.6;
    if (p.x > b.min.x - r && p.x < b.max.x + r && p.z > b.min.z - r && p.z < b.max.z + r && b.max.y > p.y + GIANT.step) breakWall(w);
  }
  for (const c of explosives) {
    if (c.dead) continue;
    const center = c.box.getCenter(new T.Vector3());
    if (Math.hypot(center.x - p.x, center.z - p.z) < GIANT.radius + 1 && c.box.min.y < p.y + GIANT.step + 0.5) explode(c);
  }
}
// one step of walking: smash what is underfoot, then move if the spot fits; true = moved
function giantStep(g, dx, dz) {
  const p = g.group.position,
    nx = p.x + dx,
    nz = p.z + dz,
    floor = actorFloor(nx, nz, p.y + GIANT.step);
  if (floor > p.y + GIANT.step) return false;
  g.group.position.set(nx, p.y, nz);
  giantSmash(g);
  g.group.position.set(p.x - dx, p.y, p.z - dz);
  if (giantOccupied(nx, floor, nz)) return false;
  p.set(nx, floor, nz);
  return true;
}
function giantFreeSpot(near) {
  for (let r = 0; r <= 30; r += 1.5)
    for (let i = 0; i < Math.max(1, r * 4); i++) {
      const a = (i / Math.max(1, r * 4)) * Math.PI * 2,
        x = near.x + Math.cos(a) * r,
        z = near.z + Math.sin(a) * r,
        high = generatedPlan?.type === "islands" ? 20 : 1.5, // floating islands: any island top will do
        y = actorFloor(x, z, high);
      if (y > -0.5 && y < high && !giantOccupied(x, y, z)) return new T.Vector3(x, y, z);
    }
  return null;
}
function spawnGiant() {
  const me = player.group.position;
  let spot = null;
  for (let tries = 0; tries < 30 && !spot; tries++) {
    const a = Math.random() * Math.PI * 2,
      s = giantFreeSpot(new T.Vector3(me.x + Math.cos(a) * 24, 0, me.z + Math.sin(a) * 24));
    if (s && s.distanceTo(me) > 14) spot = s;
  }
  spot ??= giantFreeSpot(new T.Vector3(0, 0, 0)) || me.clone().add(new T.Vector3(20, 0, 0));
  const forced = arenaParameters?.get("giant"),
    keys = Object.keys(GIANT_TYPES),
    type = GIANT_TYPES[forced] || GIANT_TYPES[keys[Math.floor(Math.random() * keys.length)]],
    index = Math.max(0, weapons.findIndex((w) => w.name === type.weapon)),
    g = character(GIANT.model, spot.x, spot.z, true, index);
  g.giant = true;
  g.type = type;
  if (type.tint) {
    const tint = new T.Color(0xffffff).lerp(new T.Color(type.tint), 0.5);
    g.root.traverse((n) => {
      if (n.isMesh) (n.material = n.material.clone()), n.material.color.multiply(tint);
    });
  }
  g.hp = g.maxHp = GIANT.hp;
  g.group.scale.setScalar(GIANT.scale);
  g.bar.visible = false;
  g.mixer.timeScale = 0.6;
  // second gun in the left hand, mirrored; a glowing weak point on each hand
  const leftSpec = type.left || type,
    index2 = Math.max(0, weapons.findIndex((w) => w.name === leftSpec.weapon));
  g.gun2 = heldWeapon(index2);
  g.gun2.position.set(0.28, 0.8, g.gun2.userData.restZ);
  g.group.add(g.gun2);
  const weak = () => {
    const m = new T.Mesh(sharedSphere(0.11, 12, 8), new T.MeshBasicMaterial({ color: HDR(0xff3a5a, 4), transparent: true, opacity: 0.9 }));
    m.position.set(0, 0.06, -0.05);
    return m;
  };
  g.arms = {
    right: { gun: g.gun, wi: index, spec: type, shot: 2, burstLeft: type.burst, bone: g.root.getObjectByName("arm-right"), marker: weak(), hp: GIANT.hp * GIANT.armShare, off: false },
    left: { gun: g.gun2, wi: index2, spec: leftSpec, shot: 2 + (type.left ? 1 : type.fireGap / 2), burstLeft: leftSpec.burst, bone: g.root.getObjectByName("arm-left"), marker: weak(), hp: GIANT.hp * GIANT.armShare, off: false },
  };
  g.gun.add(g.arms.right.marker);
  g.gun2.add(g.arms.left.marker);
  g.fireSide = "right";
  g.burstLeft = type.burst;
  g.shot = 2;
  g.jumpTimer = 5;
  g.side = Math.random() < 0.5 ? -1 : 1;
  // entrance: drops from the sky
  g.group.position.y = spot.y + 26;
  g.flight = { vy: -4, vx: 0, vz: 0, entrance: true };
  bots.push(g);
  message(type.name + "!", 3);
  if ($("bossbar")?.querySelector) $("bossbar").querySelector("b").textContent = type.name;
  sfx.duck(0.4, 0.8);
  $("bossbar").hidden = false;
  updateHUD();
}
function giantLand(g) {
  const p = g.group.position;
  giantSmash(g);
  shake = Math.max(shake, 0.6 * Math.max(0.25, 1 - p.distanceTo(player.group.position) / 40));
  sfx.play("rocket-blast", { position: p, group: "impact", volume: 1, rate: 0.55 });
  // shockwave ring
  const ring = new T.Mesh(
    new T.RingGeometry(0.8, 1.3, 48),
    new T.MeshBasicMaterial({ color: HDR(0xffb15a, 3), transparent: true, opacity: 0.85, side: T.DoubleSide, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.copy(p).y += 0.15;
  scene.add(ring);
  const radius = giantWaveRadius(g);
  addEffect(ring, 0.55, { grow: radius * 1.6, initialOpacity: 0.85 });
  impact(p.clone().add(new T.Vector3(0, 0.3, 0)), 0xffc070, 2.2);
  const me = player.group.position,
    d = Math.hypot(me.x - p.x, me.z - p.z);
  if (d < radius && grounded && Math.abs(me.y - p.y) < 2.5) {
    damagePlayer(Math.round(10 + GIANT.waveDamage * (1 - d / radius)));
    const away = new T.Vector3(me.x - p.x, 0, me.z - p.z).normalize();
    giantKnock.copy(away).multiplyScalar(16 * (1 - (d / radius) * 0.5));
    vy = 6;
    grounded = false;
  }
}
function giantHit(g, part, damage = 0) {
  if (part !== "left" && part !== "right") return;
  const arm = g.arms[part];
  if (arm.off) return;
  arm.hp -= damage;
  const worn = 1 - Math.max(0, arm.hp) / (GIANT.hp * GIANT.armShare);
  arm.marker.scale.setScalar(1 + worn * 1.2);
  impact(arm.marker.getWorldPosition(new T.Vector3()), 0xff3a5a, 0.5);
  if (arm.hp <= 0) {
    arm.off = true;
    const at = arm.marker.getWorldPosition(new T.Vector3());
    arm.gun.visible = false;
    impact(at, 0xff5a3a, 2.4);
    sfx.play("rocket-blast", { position: at, group: "impact", volume: 0.9, rate: 0.8 });
    shake = Math.max(shake, 0.35);
    message(part === "left" ? "ЛЕВАЯ РУКА ОТСТРЕЛЕНА" : "ПРАВАЯ РУКА ОТСТРЕЛЕНА", 2);
    if (g.arms.left.off && g.arms.right.off) {
      g.hp = 0;
      kill(g);
    }
  }
}
function giantDeath(g) {
  $("bossbar").hidden = true;
  const p = g.group.position.clone().add(new T.Vector3(0, 2.5, 0));
  for (let i = 0; i < 6; i++) impact(p.clone().add(new T.Vector3((Math.random() - 0.5) * 3, Math.random() * 3 - 1, (Math.random() - 0.5) * 3)), 0xffa040, 2);
  shake = Math.max(shake, 0.7);
  message("ГИГАНТ ПОВЕРЖЕН", 3);
}
function updateBossBar() {
  const g = bots.find((b) => b.giant && !b.dead);
  if (!g || !$("bossfill")) return;
  $("bossfill").style.width = Math.max(0, (g.hp / g.maxHp) * 100) + "%";
  for (const side of ["left", "right"]) {
    const el = $("boss-" + side),
      a = g.arms[side];
    if (!el) continue;
    el.classList.toggle("off", a.off);
    el.style.setProperty("--p", a.off ? 1 : 1 - Math.max(0, a.hp) / (GIANT.hp * GIANT.armShare));
  }
}
function updateGiant(g, dt) {
  g.mixer.update(dt);
  // arms that were shot off stay gone (the animation would bring them back)
  for (const a of Object.values(g.arms)) if (a.off && a.bone) a.bone.scale.setScalar(0.001);
  const p = g.group.position,
    me = player.group.position,
    to = new T.Vector3(me.x - p.x, 0, me.z - p.z),
    distance = to.length();
  g.group.rotation.y = Math.atan2(to.x, to.z);
  // you can't walk into it: its body pushes you out
  if (distance < GIANT.radius + 0.6 && Math.abs(me.y - p.y) < GIANT.height) {
    const out = distance > 0.01 ? to.clone().normalize() : new T.Vector3(1, 0, 0);
    move(player, out.x * (GIANT.radius + 0.6 - distance), out.z * (GIANT.radius + 0.6 - distance));
  }
  // in the air: entrance drop, moat hop or the shockwave jump
  if (g.flight) {
    const f = g.flight;
    f.vy -= 22 * dt;
    if (f.vx || f.vz) {
      const nx = p.x + f.vx * dt,
        nz = p.z + f.vz * dt;
      if (!giantOccupied(nx, p.y, nz)) p.x = nx, p.z = nz;
    }
    p.y += f.vy * dt;
    const floor = actorFloor(p.x, p.z, p.y + 0.5);
    if (f.vy < 0 && p.y <= floor) {
      p.y = floor;
      g.flight = null;
      if (giantOccupied(p.x, p.y, p.z)) {
        const free = giantFreeSpot(p);
        if (free) p.copy(free);
      }
      giantLand(g);
    }
    animate(g, "jump");
    return;
  }
  // safety: never stay inside geometry (a crate column, a hop that ended against a wall)
  if (giantOccupied(p.x, p.y, p.z)) {
    const free = giantFreeSpot(p);
    if (free) p.copy(free);
  }
  // in the moat: hop out towards the player
  if (p.y < -1.5) {
    const dir = to.clone().normalize();
    g.flight = { vy: 15, vx: dir.x * 7, vz: dir.z * 7 };
    return;
  }
  // shockwave jump when close
  g.jumpTimer -= dt;
  if (g.jumpTimer <= 0 && distance < giantWaveRadius(g) + 4) {
    g.jumpTimer = g.type.jumpEvery[0] + Math.random() * (g.type.jumpEvery[1] - g.type.jumpEvery[0]);
    const dir = to.clone().normalize(),
      hop = distance > 9 ? 2.5 : 0; // never lands on top of you
    g.flight = { vy: 10, vx: dir.x * hop, vz: dir.z * hop };
    message("ПРЫГАЙ!", 1);
    return;
  }
  // walk: straight at you; if blocked, try angles to its preferred side, then the other (wall-following)
  let moved = false;
  // a ranged giant that can't see you for 3 s stops holding its distance and comes for you
  g.blind = visible(p.clone().add(new T.Vector3(0, 4, 0)), me.clone().add(new T.Vector3(0, 1.05, 0))) ? 0 : (g.blind || 0) + dt;
  const near = g.blind > 3 ? 0 : g.type.keep[0],
    far = g.blind > 3 ? 6 : g.type.keep[1],
    approach = distance > Math.max(6, far),
    retreat = distance < near;
  if (approach || retreat) {
    const base = Math.atan2(to.x, to.z) + (retreat ? Math.PI : 0),
      stepLen = g.type.speed * Math.sqrt(difficulty.speed) * SPEED_SCALE * dt;
    for (const off of [0, 0.5, 1, 1.5, 2.1, -0.5, -1, -1.5, -2.1]) {
      const a = base + off * g.side;
      if (giantStep(g, Math.sin(a) * stepLen, Math.cos(a) * stepLen)) {
        moved = true;
        if (off < 0) g.side = -g.side;
        break;
      }
    }
  }
  // no progress towards you for a while (stuck behind something): a big hop over it, with a shockwave
  g.best = Math.min(g.best ?? Infinity, distance);
  if (distance < g.best + 0.5 && distance < (g.lastBest ?? Infinity) - 1) (g.lastBest = distance), (g.stuckTime = 0);
  g.stuckTime = (g.stuckTime || 0) + (distance > Math.max(8, far + 2) ? dt : 0);
  if (g.stuckTime > 4) {
    g.stuckTime = 0;
    g.lastBest = distance;
    const dir = to.clone().normalize();
    g.flight = { vy: 14, vx: dir.x * 6, vz: dir.z * 6 };
    return;
  }
  animate(g, moved ? "walk" : "idle");
  // laser giant: a sight line from the hand, then the beam along it 0.7 s later (step aside to dodge)
  if (g.laser) {
    const L = g.laser;
    L.time -= dt;
    L.arm.gun.updateWorldMatrix(true, true);
    const from = L.arm.gun.muzzle.getWorldPosition(new T.Vector3());
    L.line.position.copy(from);
    L.line.material.opacity = 0.2 + (1 - L.time / 0.7) * 0.6;
    if (L.time <= 0 || L.arm.off) {
      scene.remove(L.line);
      L.line.geometry.dispose();
      L.line.material.dispose();
      g.laser = null;
      if (!L.arm.off) {
        spawnProjectile(from, L.dir, g.weaponIndex, true); // hitscan beam (laserShot)
        g.fired = (g.fired || 0) + 1;
        muzzleFlash(from, g.weaponIndex);
        const shot = shotSound(weapons[g.weaponIndex]);
        if (shot) sfx.play(shot.name, { position: from, group: "enemy", volume: shot.volume, rate: (shot.rate ?? 1) * 0.75 });
      }
    }
    return;
  }
  // guns: every hand fires its own weapon on its own rhythm; a hand that was shot off is gone
  if (distance >= 45) return;
  const chest = me.clone().add(new T.Vector3(0, 1.05, 0));
  for (const side of ["right", "left"]) {
    const arm = g.arms[side];
    if (arm.off) continue;
    arm.shot -= dt;
    if (arm.shot > 0) continue;
    const spec = arm.spec,
      w = weapons[arm.wi];
    arm.gun.updateWorldMatrix(true, true);
    const muzzle = arm.gun.muzzle.getWorldPosition(new T.Vector3()),
      dir = me.clone().add(new T.Vector3((Math.random() - 0.5) * 1.6, 1.05, (Math.random() - 0.5) * 1.6)).sub(muzzle).normalize();
    arm.burstLeft--;
    arm.shot = (arm.burstLeft > 0 ? spec.fireGap : spec.burstPause) * botReact();
    if (arm.burstLeft <= 0) arm.burstLeft = spec.burst;
    if (!visible(muzzle, chest)) continue;
    if (w.kind === 4) {
      if (g.laser) continue;
      const len = 60,
        line = new T.Mesh(
          new T.CylinderGeometry(0.05, 0.05, len, 6).rotateX(Math.PI / 2).translate(0, 0, len / 2),
          new T.MeshBasicMaterial({ color: HDR(0xff3040, 2.5), transparent: true, opacity: 0.2, depthWrite: false }),
        );
      line.position.copy(muzzle);
      line.lookAt(muzzle.clone().add(dir));
      line.userData.laserSight = true;
      scene.add(line);
      g.laser = { time: 0.7, dir, line, arm };
      g.weaponIndex = arm.wi;
      return;
    }
    const shots = w.kind === 3 ? 4 : spec.pellets || 1;
    for (let i = 0; i < shots; i++) {
      const d = dir.clone();
      if (shots > 1) d.applyAxisAngle(new T.Vector3(0, 1, 0), ((i - (shots - 1) / 2) / (shots - 1)) * (w.kind === 3 ? w.spread : 0.35));
      spawnProjectile(muzzle, d.normalize(), arm.wi, true);
    }
    g.fired = (g.fired || 0) + 1;
    muzzleFlash(muzzle, arm.wi);
    const shot = shotSound(w);
    if (shot) sfx.play(shot.name, { position: muzzle, group: "enemy", volume: shot.volume * 0.9, rate: (shot.rate ?? 1) * 0.8 });
  }
}
// ── Bots change weapons ────────────────────────────────────────────────────────────────────────────────────
// Bots carry 3 magazines (one "volley" = one shot/salvo). Out of ammo, or 10 volleys in a row without
// touching you, a bot looks for a gun on the ground (30 m when empty, 15 m when it just keeps missing),
// walks over and swaps, leaving its old gun behind. No gun around for 4 s when empty: it scrapes up a
// spare magazine and fights on.
let shooter = null; // the bot whose shot is being fired (projectiles remember it)
const BOT_MAGS = 3,
  BOT_MISS_LIMIT = 10;
function botHasAmmo(b) {
  b.ammo ??= weapons[b.weaponIndex].mag * BOT_MAGS;
  return b.ammo > 0;
}
function botFired(b) {
  b.ammo = (b.ammo ?? weapons[b.weaponIndex].mag * BOT_MAGS) - 1;
  b.misses = (b.misses || 0) + 1;
  if (b.ammo <= 0) b.wantGun ||= "ammo";
  else if (b.misses >= BOT_MISS_LIMIT) b.wantGun ||= "miss";
}
function botSeekDrop(b, dt) {
  if (!b.wantGun) return null;
  const p = b.group.position,
    radius = b.wantGun === "ammo" ? 30 : 15;
  let d = b.seekDrop;
  if (!d || !drops.includes(d) || (d.claim && d.claim !== b && !d.claim.dead)) {
    d = null;
    let best = radius;
    for (const o of drops) {
      if (weapons[o.index].kind === 5 || o.index === b.weaponIndex || (o.claim && o.claim !== b && !o.claim.dead)) continue;
      const dist = o.group.position.distanceTo(p);
      if (dist < best) (best = dist), (d = o);
    }
    b.seekDrop = d;
    if (d) d.claim = b;
  }
  if (!d) {
    b.seekTime = (b.seekTime || 0) + dt;
    if (b.seekTime > 4) {
      if (b.wantGun === "ammo") b.ammo = weapons[b.weaponIndex].mag; // a spare magazine
      b.misses = Math.floor(BOT_MISS_LIMIT / 2); // try again a bit later
      b.wantGun = null;
      b.seekTime = 0;
    }
    return null;
  }
  b.seekTime = 0;
  if (Math.hypot(d.group.position.x - p.x, d.group.position.z - p.z) < 2) {
    botSwapWeapon(b, d);
    return null;
  }
  return d;
}
function botSwapWeapon(b, d) {
  const old = b.weaponIndex,
    at = d.group.position.clone();
  scene.remove(d.group);
  unregisterPlacement(d.group);
  d.ring.geometry.dispose();
  d.ring.material.dispose();
  drops.splice(drops.indexOf(d), 1);
  attachGun(b, d.index);
  b.ammo = weapons[d.index].mag * BOT_MAGS;
  b.misses = 0;
  b.wantGun = null;
  b.seekDrop = null;
  b.shot = Math.max(b.shot, 0.4);
  if (b.laserAim) (scene.remove(b.laserAim.line), (b.laserAim = null));
  spawnDrop(old, at);
  impact(at.clone().add(new T.Vector3(0, 0.6, 0)), weapons[d.index].color, 0.5);
  sfx.play(reloadSound(weapons[d.index]), { position: at, group: "enemy", volume: 0.5, jitter: 0 });
}
// ── Shield bearer (wave 2 on) ───────────────────────────────────────────────────────────────────────────
// Every 5th enemy (max 2 at once) carries an energy shield in front: shots, beams and the blade coming from
// the front (±60°) are stopped. Hit it from behind or the side, or break the shield for good with a rocket
// blast, an exploding barrel or a dash into it. Walks slower and always comes straight at you.
// ── ПОДРЫВНИК (bomber): runs straight at you, arms a short fuse when close and blows up like a red barrel.
// Shot down before that, it still explodes where it falls — hurting the bots around it.
const BOMBER = { fromWave: 2, maxAlive: 2, pace: 5.4, trigger: 2.4, fuse: 0.7, radius: 4.2, damage: 38 };
function makeBomber(b) {
  b.bomber = true;
  b.hp = b.maxHp = 30 + wave * 8;
  if (b.gun) b.gun.visible = false;
  const pack = new T.Mesh(sharedSphere(0.26, 12, 8), new T.MeshBasicMaterial({ color: HDR(0xff3a2a, 2.5) }));
  pack.position.set(0, 1.15, -0.32);
  b.group.add(pack);
  const ring = new T.Mesh(new T.RingGeometry(0.55, 0.75, 28), new T.MeshBasicMaterial({ color: HDR(0xff3a2a, 2), transparent: true, opacity: 0.5, side: T.DoubleSide, depthWrite: false, blending: T.AdditiveBlending }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  b.group.add(ring);
  b.bomb = { pack, ring, fuse: 0, beep: 0 };
}
function updateBomber(b, dt) {
  b.mixer.update(dt);
  b.flash = Math.max(0, b.flash - dt);
  b.stun = Math.max(0, b.stun - dt);
  b.bar.quaternion.copy(camera.quaternion);
  b.bar.scale.x = Math.max(0.01, b.hp / b.maxHp);
  b.bar.material.color.set(b.flash > 0 ? 0xffffff : 0xff3a2a);
  recoverPosition(b);
  const me = player.group.position,
    delta = me.clone().sub(b.group.position),
    distance = delta.length(),
    dir = delta.clone().setY(0).normalize(),
    B = b.bomb;
  b.group.rotation.y = Math.atan2(dir.x, dir.z);
  // blink: faster and brighter once the fuse is lit
  const rate = B.fuse > 0 ? 22 : 6,
    pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.001 * rate);
  B.pack.scale.setScalar(1 + pulse * (B.fuse > 0 ? 0.6 : 0.25));
  B.ring.material.opacity = 0.25 + pulse * 0.5;
  B.ring.scale.setScalar(B.fuse > 0 ? 1 + (1 - B.fuse / BOMBER.fuse) * 4.5 : 1);
  if (B.fuse > 0) {
    B.fuse -= dt;
    B.beep -= dt;
    if (B.beep <= 0) (B.beep = 0.12), sound(1400, 0.05, "square", 0.03);
    if (B.fuse <= 0) {
      // went off by itself: no kill credit, no weapon drop
      b.hp = 0;
      b.dead = true;
      scene.remove(b.group);
      b.mixer.stopAllAction();
      bomberBlast(b);
    }
    animate(b, "idle");
    return;
  }
  if (distance < BOMBER.trigger && Math.abs(delta.y) < 1.6) {
    B.fuse = BOMBER.fuse;
    sound(900, 0.12, "square", 0.04);
    return;
  }
  b.pathTime = (b.pathTime || 0) - dt;
  const los = visible(b.group.position.clone().add(new T.Vector3(0, 1, 0)), me.clone().add(new T.Vector3(0, 1, 0)));
  let m = new T.Vector3();
  if (los && Math.abs(delta.y) < 1) m.copy(dir);
  else {
    if (b.pathTime <= 0 || !b.path) (b.path = findPath(b.group.position, me)), (b.pathTime = 0.5);
    while (b.path.length && b.path[0].distanceTo(b.group.position) < 0.65) b.path.shift();
    if (b.path.length) m.copy(b.path[0]).sub(b.group.position).setY(0).normalize();
    else m.copy(dir);
  }
  const old = b.group.position.clone(),
    pace = BOMBER.pace * difficulty.speed * SPEED_SCALE * (b.stun > 0 ? 0.2 : 1) * dt;
  move(b, m.x * pace, m.z * pace);
  if (generatedPlan?.moat && old.y > -0.5 && b.group.position.y < -1) b.group.position.copy(old);
  animate(b, "sprint");
}
// shared explosion: red-barrel look, falloff damage to the player, bots (not itself) and chained barrels
function bomberBlast(b) {
  if (b.blasted) return;
  b.blasted = true;
  const at = b.group.position.clone().add(new T.Vector3(0, 0.6, 0));
  if (performance.now() - (rocketExplosion.lastSound || 0) > 120) {
    rocketExplosion.lastSound = performance.now();
    sfx.play("rocket-blast", { position: at, group: "impact", volume: 0.8 });
  }
  burst(at, 0xff6a3a);
  impact(at, 0xff4a2a, 1.4);
  flashes.flash(at.clone().add(new T.Vector3(0, 0.6, 0)), 0xff5a30, 460, 14, 0.45);
  shake = Math.max(shake, 0.25);
  const R = BOMBER.radius,
    pd = player.group.position.distanceTo(b.group.position);
  blastWalls(at, R, 100);
  if (pd < R) damagePlayer(Math.round(BOMBER.damage * (1 - (0.6 * pd) / R)));
  for (const o of bots) {
    if (o.dead || o === b) continue;
    const d = o.group.position.distanceTo(b.group.position);
    if (d > R) continue;
    const dmg = Math.round(60 * (1 - (0.5 * d) / R));
    o.hp -= dmg;
    o.flash = 0.14;
    if (o.giant) giantHit(o, "body", dmg);
    if (o.hp <= 0) kill(o, "gun");
  }
  for (const c of explosives) if (!c.dead && c.group.position.distanceTo(b.group.position) < R) explode(c);
  updateHUD();
}
// ═══ v182: level-filling logic — systems that keep the player moving ═══════════════════════════════════════
// 1. areaBlast: one explosion helper (mines, mortar strikes).
// 2. Mines (traps): placed on open walkable ground at the start, count per map (plan.traps).
// 3. Mortar pressure: stand within 7 m for 7 s during a wave and shells start landing on you (red marker first).
// 4. Wave tasks: wave 2 and 4 — capture a far point, wave 3 — collect three cores; the wave does not end
//    until the task is done. Rewards: health / power dashes.
// 5. Snipers map: bombers keep coming while snipers are alive.
const playerVel = new T.Vector3(),
  lastPlayerPos = new T.Vector3();
let velReady = false;
function trackPlayerVelocity(dt) {
  if (!player || dt <= 0) return;
  const p = player.group.position;
  if (velReady) playerVel.lerp(p.clone().sub(lastPlayerPos).divideScalar(dt).setY(0), Math.min(1, dt * 8));
  lastPlayerPos.copy(p);
  velReady = true;
}
function areaBlast(at, { radius = 3.5, toPlayer = 30, toBots = 60, walls = 60, color = 0xff5a30 } = {}) {
  if (performance.now() - (rocketExplosion.lastSound || 0) > 120) {
    rocketExplosion.lastSound = performance.now();
    sfx.play("rocket-blast", { position: at, group: "impact", volume: 0.75 });
  }
  burst(at, 0xffa050);
  impact(at, color, 1.3);
  flashes.flash(at.clone().add(new T.Vector3(0, 0.8, 0)), color, 420, 13, 0.4);
  shake = Math.max(shake, 0.2 * Math.max(0.3, 1 - player.group.position.distanceTo(at) / 30));
  const pd = player.group.position.distanceTo(at);
  if (pd < radius && toPlayer) damagePlayer(Math.round(toPlayer * (1 - (0.55 * pd) / radius)));
  for (const b of bots) {
    if (b.dead) continue;
    const d = b.group.position.distanceTo(at);
    if (d > radius) continue;
    const dmg = Math.round(toBots * (1 - (0.5 * d) / radius));
    b.hp -= dmg;
    b.flash = 0.14;
    if (b.giant) giantHit(b, "body", dmg);
    if (b.hp <= 0) kill(b, "barrel");
  }
  for (const c of explosives) if (!c.dead && c.group.position.distanceTo(at) < radius) explode(c);
  if (walls) blastWalls(at, radius, walls);
  updateHUD();
}
// ── mines ──
const mines = [];
const MINE = { trigger: 1.7, fuse: 0.55, radius: 3.6 };
function openSpot(minDist, maxDist, from, tries = 60) {
  for (let k = 0; k < tries; k++) {
    const a = Math.random() * Math.PI * 2,
      r = minDist + Math.random() * (maxDist - minDist),
      cell = nearestOpen(navCell({ x: from.x + Math.cos(a) * r, z: from.z + Math.sin(a) * r }));
    if (!navGrid[navIndex(cell.x, cell.z)]) continue;
    const x = navMin + cell.x * navStep,
      z = navMin + cell.z * navStep,
      p = new T.Vector3(x, terrainHeight(x, z), z);
    if (p.y < -1.5 || occupied(p.x, p.y, p.z, 1)) continue;
    if (jumpPads.some((q) => Math.hypot(q.x - x, q.z - z) < 4)) continue;
    if (Math.hypot(x - from.x, z - from.z) < minDist * 0.8) continue;
    return p;
  }
  return null;
}
function placeTraps() {
  for (const m of mines) scene.remove(m.group);
  mines.length = 0;
  if (!generatedPlan || !navigation) return;
  const count = generatedPlan.traps ?? 6,
    start = player?.group.position || new T.Vector3(),
    zones = generatedPlan.zones || [];
  for (let k = 0, tries = 0; k < count && tries < count * 20; tries++) {
    const p = openSpot(20, 95, new T.Vector3(0, 0, 0));
    if (!p) continue;
    if (p.distanceTo(start) < 22 || zones.some((z) => Math.hypot(z.x - p.x, z.z - p.z) < 9)) continue;
    if (mines.some((m) => m.group.position.distanceTo(p) < 10)) continue;
    const group = new T.Group(),
      plate = new T.Mesh(new T.CylinderGeometry(0.42, 0.5, 0.12, 12), new T.MeshStandardMaterial({ color: 0x2b2e33, metalness: 0.5, roughness: 0.5 })),
      eye = new T.Mesh(sharedSphere(0.11, 8, 6), new T.MeshBasicMaterial({ color: HDR(0xff2a2a, 4) }));
    plate.position.y = 0.06;
    eye.position.y = 0.16;
    group.add(plate, eye);
    group.position.copy(p);
    scene.add(group);
    mines.push({ group, eye, fuse: 0, phase: Math.random() * 6 });
    k++;
  }
}
function updateMines(dt) {
  const t = performance.now() * 0.001;
  for (let i = mines.length - 1; i >= 0; i--) {
    const m = mines[i],
      at = m.group.position;
    if (m.fuse > 0) {
      m.fuse -= dt;
      m.eye.visible = Math.floor(t * 16) % 2 === 0;
      if (m.fuse <= 0) {
        scene.remove(m.group);
        mines.splice(i, 1);
        areaBlast(at.clone().add(new T.Vector3(0, 0.3, 0)), { radius: MINE.radius, toPlayer: difficulty === DIFFICULTY.hard ? 42 : 34, toBots: 70 });
      }
      continue;
    }
    m.eye.visible = Math.sin(t * 3 + m.phase) > 0.2;
    if (!active) continue;
    const near = (q) => Math.hypot(q.x - at.x, q.z - at.z) < MINE.trigger && Math.abs(q.y - at.y) < 1.4;
    if (near(player.group.position) || bots.some((b) => !b.dead && !b.flight && near(b.group.position))) {
      m.fuse = MINE.fuse;
      sound(1500, 0.08, "square", 0.04);
    }
  }
}
// ── mortar pressure ──
const PRESSURE = { radius: 7, delay: 7, every: 2.1, warn: 1.3, blast: 3.2 };
const strikes = [];
let campAnchor = null,
  campTime = 0,
  strikeTimer = 0,
  campWarned = 0;
function updatePressure(dt) {
  for (let i = strikes.length - 1; i >= 0; i--) {
    const s = strikes[i];
    s.time -= dt;
    const k = 1 - Math.max(0, s.time) / PRESSURE.warn;
    s.ring.material.opacity = 0.35 + 0.5 * Math.abs(Math.sin(k * 14));
    s.fill.scale.setScalar(Math.max(0.01, k));
    s.shell.visible = s.time < 0.45;
    s.shell.position.y = s.at.y + 0.3 + Math.max(0, s.time) * 60;
    if (s.time <= 0) {
      scene.remove(s.ring, s.fill, s.shell);
      strikes.splice(i, 1);
      areaBlast(s.at.clone().add(new T.Vector3(0, 0.3, 0)), { radius: PRESSURE.blast, toPlayer: difficulty === DIFFICULTY.hard ? 30 : 22, toBots: 40, walls: 40 });
    }
  }
  if (!active || !wave || cardsOpen || !player) return;
  const me = player.group.position;
  if (!campAnchor || campAnchor.distanceTo(me) > PRESSURE.radius) {
    campAnchor = me.clone();
    campTime = 0;
    strikeTimer = 0;
    return;
  }
  campTime += dt;
  if (campTime < PRESSURE.delay) return;
  strikeTimer -= dt;
  if (strikeTimer > 0) return;
  strikeTimer = PRESSURE.every;
  if (campWarned <= 0) {
    message("НЕ СТОЙ НА МЕСТЕ — ОБСТРЕЛ!", 2.2);
    campWarned = 1;
  }
  const at = me.clone().addScaledVector(playerVel, 0.8).add(new T.Vector3((Math.random() - 0.5) * 3, 0, (Math.random() - 0.5) * 3));
  at.y = terrainHeight(at.x, at.z, me.y + 0.5);
  const ring = new T.Mesh(
      new T.RingGeometry(PRESSURE.blast - 0.25, PRESSURE.blast, 36),
      new T.MeshBasicMaterial({ color: HDR(0xff2a2a, 2), transparent: true, opacity: 0.6, side: T.DoubleSide, depthWrite: false }),
    ),
    fill = new T.Mesh(new T.CircleGeometry(PRESSURE.blast, 36), new T.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.22, side: T.DoubleSide, depthWrite: false })),
    shell = new T.Mesh(sharedSphere(0.25, 8, 6), new T.MeshBasicMaterial({ color: HDR(0xffc070, 4) }));
  for (const o of [ring, fill]) {
    o.rotation.x = -Math.PI / 2;
    o.position.copy(at).setY(at.y + 0.06);
  }
  shell.position.copy(at);
  shell.visible = false;
  scene.add(ring, fill, shell);
  strikes.push({ at, ring, fill, shell, time: PRESSURE.warn });
  sound(420, 0.25, "sine", 0.03);
}
// ── wave tasks ──
const WAVE_TASKS = { 2: "capture", 3: "cores", 4: "capture" },
  TASK = { captureRadius: 5, captureTime: 8, coreCount: 3, minDistance: 32 };
let task = null;
function taskSpots(n) {
  const me = player.group.position,
    picks = [],
    cands = [];
  for (const node of generatedPlan?.graph?.nodes || []) {
    const y = node.height ?? terrainHeight(node.world.x, node.world.z);
    cands.push(new T.Vector3(node.world.x, y, node.world.z));
  }
  for (let k = 0; k < 30; k++) {
    const p = openSpot(TASK.minDistance, 90, me, 20);
    if (p) cands.push(p);
  }
  // nearer candidates (32–80 m) first, the far ones only if nothing else fits
  const far = (p) => Math.hypot(p.x - me.x, p.z - me.z) > 80;
  for (const p of cands.sort(() => Math.random() - 0.5).sort((a, b) => far(a) - far(b))) {
    if (picks.length >= n) break;
    if (Math.hypot(p.x - me.x, p.z - me.z) < TASK.minDistance) continue;
    if (picks.some((q) => q.distanceTo(p) < 22)) continue;
    const c = nearestOpen(navCell(p)),
      q = new T.Vector3(navMin + c.x * navStep, 0, navMin + c.z * navStep);
    q.y = terrainHeight(q.x, q.z, p.y + 0.5);
    if (!findPath(me, q).length) continue;
    picks.push(q);
  }
  return picks;
}
function beacon(at, color, radius) {
  const group = new T.Group(),
    ring = new T.Mesh(new T.RingGeometry(radius - 0.35, radius, 48), new T.MeshBasicMaterial({ color: HDR(color, 2.5), transparent: true, opacity: 0.8, side: T.DoubleSide, depthWrite: false })),
    beam = new T.Mesh(new T.CylinderGeometry(0.35, 0.35, 40, 10, 1, true), new T.MeshBasicMaterial({ color: HDR(color, 2), transparent: true, opacity: 0.35, depthWrite: false, blending: T.AdditiveBlending }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.08;
  beam.position.y = 20;
  group.add(ring, beam);
  group.position.copy(at);
  scene.add(group);
  return { group, ring, beam };
}
function clearTask() {
  if (!task) return;
  for (const b of task.beacons || []) scene.remove(b.group);
  task = null;
}
function startTask() {
  clearTask();
  const type = sniperMode() ? null : WAVE_TASKS[wave];
  if (!type || !navigation) return;
  if (type === "capture") {
    const [at] = taskSpots(1);
    if (!at) return;
    task = { type, at, progress: 0, beacons: [beacon(at, 0x39e6ff, TASK.captureRadius)] };
    message("ЗАДАЧА: ЗАХВАТИ ТОЧКУ", 3);
  } else {
    const spots = taskSpots(TASK.coreCount);
    if (!spots.length) return;
    task = { type, cores: spots.map((at) => ({ at, taken: false })), beacons: [] };
    for (const c of task.cores) {
      const b = beacon(c.at, 0xffc83d, 1.4),
        gem = new T.Mesh(new T.OctahedronGeometry(0.55), new T.MeshBasicMaterial({ color: HDR(0xffd45a, 3.5) }));
      gem.position.y = 1.3;
      b.group.add(gem);
      b.gem = gem;
      c.beacon = b;
      task.beacons.push(b);
    }
    message("ЗАДАЧА: СОБЕРИ " + spots.length + " ЯДРА", 3);
  }
  task.idle = 0;
}
const taskDone = () => !task || task.done;
function taskHint() {
  if (!task || task.done) return "";
  const target = task.type === "capture" ? task.at : task.cores.filter((c) => !c.taken).sort((a, b) => a.at.distanceTo(player.group.position) - b.at.distanceTo(player.group.position))[0]?.at;
  if (!target) return "";
  const head = task.type === "capture" ? "ТОЧКА " + Math.floor(task.progress * 100) + "%" : "ЯДРА " + task.cores.filter((c) => c.taken).length + "/" + task.cores.length;
  return head + " · " + directionHint(target);
}
function directionHint(target) {
  const me = player.group.position,
    look = viewMode === "rear" ? viewYaw : yaw,
    rel = Math.atan2(target.x - me.x, target.z - me.z) - look,
    a = Math.atan2(Math.sin(rel), Math.cos(rel)),
    arrows = ["↑", "↖", "←", "↙", "↓", "↘", "→", "↗"];
  return Math.round(Math.hypot(target.x - me.x, target.z - me.z)) + " м " + arrows[(Math.round(a / (Math.PI / 4)) + 8) % 8];
}
function finishTask(text) {
  task.done = true;
  for (const b of task.beacons) scene.remove(b.group);
  message(text, 2.6);
  sound(990, 0.18, "triangle", 0.05);
  updateHUD();
}
let taskHudTimer = 0;
function updateTask(dt) {
  if (!task || task.done || !active) return;
  const me = player.group.position,
    t = performance.now() * 0.001;
  for (const b of task.beacons) {
    b.beam.material.opacity = 0.25 + 0.15 * Math.sin(t * 3);
    if (b.gem) (b.gem.rotation.y = t * 2), (b.gem.position.y = 1.3 + Math.sin(t * 2.5) * 0.2);
  }
  if (task.type === "capture") {
    const inside = Math.hypot(me.x - task.at.x, me.z - task.at.z) < TASK.captureRadius && Math.abs(me.y - task.at.y) < 2.5;
    task.progress = Math.max(0, Math.min(1, task.progress + (inside ? dt / TASK.captureTime : -dt / 30)));
    task.beacons[0].ring.material.color.copy(HDR(inside ? 0x7dffbd : 0x39e6ff, 2.5));
    if (task.progress >= 1) {
      hp = Math.min(playerMaxHp, hp + 30);
      finishTask("ТОЧКА ЗАХВАЧЕНА · +30 ЗДОРОВЬЯ");
      return;
    }
  } else
    for (const c of task.cores)
      if (!c.taken && Math.hypot(me.x - c.at.x, me.z - c.at.z) < 2 && Math.abs(me.y - c.at.y) < 2.5) {
        c.taken = true;
        scene.remove(c.beacon.group);
        sound(1200, 0.12, "triangle", 0.05);
        impact(c.at.clone().add(new T.Vector3(0, 1.2, 0)), 0xffd45a, 0.8);
        if (task.cores.every((q) => q.taken)) {
          dashCharges = Math.min(DASH_CHARGES_MAX, dashCharges + 2);
          finishTask("ЯДРА СОБРАНЫ · +2 МОЩНЫХ РЫВКА");
          return;
        }
        message("ЯДРО " + task.cores.filter((q) => q.taken).length + "/" + task.cores.length, 1.4);
      }
  taskHudTimer -= dt;
  if (taskHudTimer <= 0) (taskHudTimer = 0.25), updateHUD();
  // everyone is dead but the task is not done: a bomber now and then keeps the pressure on
  if (wave && waveGroup >= WAVE_GROUPS[wave - 1].length && !bots.some((b) => !b.dead)) {
    task.idle += dt;
    if (task.idle > 14) {
      task.idle = 0;
      spawnExtraBomber();
    }
  } else task.idle = 0;
}
function spawnExtraBomber() {
  const spot = openSpot(30, 70, player.group.position, 40);
  if (!spot) return null;
  const b = character(people[Math.floor(Math.random() * people.length)], spot.x, spot.z, true, botWeapon(Math.floor(Math.random() * 7)));
  b.group.position.copy(spot);
  b.hp = b.maxHp = 40 + wave * 8;
  makeBomber(b);
  recoverPosition(b);
  bots.push(b);
  updateHUD();
  return b;
}
// snipers map: two bombers every ~20 s (15 s on hard) while any sniper is alive
let sniperBomberTimer = 12;
function updateSniperPressure(dt) {
  if (!sniperMode() || !active || !wave) return;
  if (!bots.some((b) => !b.dead && b.sniper)) return;
  sniperBomberTimer -= dt;
  if (sniperBomberTimer > 0) return;
  sniperBomberTimer = difficulty === DIFFICULTY.hard ? 15 : 20;
  if (bots.filter((b) => !b.dead && b.bomber).length >= 4) return;
  spawnExtraBomber();
  spawnExtraBomber();
  message("ПОДРЫВНИКИ!", 1.4);
}
function updateLevelSystems(dt) {
  trackPlayerVelocity(dt);
  updateMines(dt);
  updatePressure(dt);
  updateTask(dt);
  updateSniperPressure(dt);
}
const SHIELD = { fromWave: 2, maxAlive: 2, pace: 0.75, frontCos: 0.5 };
function giveShield(b) {
  const mat = new T.MeshBasicMaterial({ color: HDR(0x55d8ff, 1.6), transparent: true, opacity: 0.32, side: T.DoubleSide, depthWrite: false, blending: T.AdditiveBlending }),
    arc = new T.Mesh(new T.CylinderGeometry(1.0, 1.0, 1.9, 24, 1, true, -1.05, 2.1), mat),
    rim = new T.Mesh(
      new T.CylinderGeometry(1.0, 1.0, 1.9, 24, 1, true, -1.05, 2.1),
      new T.MeshBasicMaterial({ color: HDR(0x9af0ff, 2.2), wireframe: true, transparent: true, opacity: 0.25, depthWrite: false }),
    );
  arc.position.y = rim.position.y = 1.0;
  const shield = new T.Group();
  shield.add(arc, rim);
  b.group.add(shield);
  b.shield = { mesh: shield, mat, flash: 0 };
  b.hp += 30;
  b.maxHp = b.hp;
}
// true when a shot travelling along `dir` hits the bot from the front
function shieldFacing(b, dir) {
  const fwd = new T.Vector3(Math.sin(b.group.rotation.y), 0, Math.cos(b.group.rotation.y));
  return -new T.Vector3(dir.x, 0, dir.z).normalize().dot(fwd) > SHIELD.frontCos;
}
function shieldBlock(b, at) {
  impact(at, 0x7fe6ff, 0.45);
  b.shield.mat.opacity = 0.75;
  b.shield.flash = 0.12;
  if (performance.now() - (shieldBlock.t || 0) > 90) {
    shieldBlock.t = performance.now();
    sfx.play("hit", { position: at, group: "impact", volume: 0.5, rate: 1.7 });
  }
}
function breakShield(b) {
  if (!b.shield) return;
  const at = b.group.position.clone().add(new T.Vector3(0, 1.1, 0));
  b.group.remove(b.shield.mesh);
  b.shield.mesh.traverse((n) => n.isMesh && (n.geometry.dispose(), n.material.dispose()));
  b.shield = null;
  b.stun = Math.max(b.stun, 0.6);
  impact(at, 0x7fe6ff, 1.6);
  sfx.play("rocket-blast", { position: at, group: "impact", volume: 0.5, rate: 1.8 });
}
function updateShield(b, dt) {
  if (!b.shield) return;
  b.shield.flash = Math.max(0, b.shield.flash - dt);
  if (b.shield.flash <= 0) b.shield.mat.opacity = 0.28 + Math.sin(performance.now() / 180) * 0.04;
}
// ── Bot dash (wave 3 on) ────────────────────────────────────────────────────────────────────────────────────
// Sideways out of the way of your shot coming at it, or straight at you to close the gap. 5–8 s cooldown.
const BOT_DASH = { fromWave: 3, speed: 18, time: 0.22, windup: 0.3, cooldown: [9, 14], dodgeChance: 0.4 };
function botMaybeDash(b, dir, distance, los, dt) {
  if (wave < BOT_DASH.fromWave || b.flight || b.stun > 0 || b.dashTime > 0) return;
  if (b.dashWind > 0) {
    // wind-up: the bot crouches, glows and stops, then goes
    b.dashWind -= dt;
    b.flash = Math.max(b.flash, 0.06);
    if (b.dashWind <= 0) {
      b.dashTime = BOT_DASH.time;
      impact(b.group.position.clone().add(new T.Vector3(0, 0.15, 0)), 0xff6a6a, 0.8);
      sfx.play("jump-pad", { position: b.group.position, group: "enemy", volume: 0.4, rate: 1.6 });
    }
    return;
  }
  b.dashCd = (b.dashCd ?? 1 + Math.random() * 3) - dt;
  if (b.dashCd > 0) return;
  let to = null;
  const p = b.group.position;
  for (const s of projectiles) {
    if (s.enemy) continue;
    const rel = new T.Vector3(p.x - s.group.position.x, 0, p.z - s.group.position.z),
      d = rel.length();
    if (d > 0.5 && d < 7 && (s.dodge ??= new Map()).get(b) !== false && rel.normalize().dot(new T.Vector3(s.dir.x, 0, s.dir.z).normalize()) > 0.93) {
      // each bot rolls once per incoming shot whether it tries to dodge it
      if (!s.dodge.has(b)) s.dodge.set(b, Math.random() < BOT_DASH.dodgeChance);
      if (!s.dodge.get(b)) continue;
      to = new T.Vector3(-s.dir.z, 0, s.dir.x).normalize().multiplyScalar(Math.random() < 0.5 ? -1 : 1); // dodge sideways
      break;
    }
  }
  if (!to && los && distance > 12 && distance < 24 && Math.random() < dt * 0.15) to = dir.clone().setY(0).normalize(); // close in
  if (!to) return;
  b.dashDir = to;
  b.dashWind = BOT_DASH.windup;
  b.dashCd = BOT_DASH.cooldown[0] + Math.random() * (BOT_DASH.cooldown[1] - BOT_DASH.cooldown[0]);
  b.dashCd += BOT_DASH.windup;
}
// a fading red silhouette left behind while a bot dashes
function dashGhost(b) {
  const ghost = new T.Mesh(
    new T.CapsuleGeometry(0.42, 0.9, 4, 8),
    new T.MeshBasicMaterial({ color: HDR(0xff5a6a, 1.6), transparent: true, opacity: 0.45, depthWrite: false, blending: T.AdditiveBlending }),
  );
  ghost.position.copy(b.group.position).y += 0.9;
  addEffect(ghost, 0.3, { initialOpacity: 0.45 });
}
const BOT_SPACE = 2.6, // metres a bot tries to keep from others
  BOT_BODY = 1.0; // closer than this they are pushed apart
function updateBots(dt) {
  for (const b of bots) {
    if (b.dead) continue;
    if (b.giant) {
      updateGiant(b, dt);
      continue;
    }
    if (b.sniper) {
      updateSniper(b, dt);
      continue;
    }
    if (b.bomber) {
      updateBomber(b, dt);
      continue;
    }
    if (b.flight) updateBotFlight(b, dt);
    else recoverPosition(b);
    b.padCooldown = Math.max(0, (b.padCooldown || 0) - dt);
    b.stun = Math.max(0, b.stun - dt);
    b.alert = Math.max(0, (b.alert || 0) - dt);
    updateShield(b, dt);
    b.flash = Math.max(0, b.flash - dt);
    b.bar.material.color.set(b.flash > 0 ? 0xffffff : b.elite ? 0xffb548 : weapons[b.weaponIndex].color);
    b.mixer.update(dt);
    b.bar.quaternion.copy(camera.quaternion);
    b.bar.scale.x = Math.max(0.01, b.hp / b.maxHp);
    const delta = player.group.position.clone().sub(b.group.position),
      distance = delta.length(),
      dir = delta.clone().setY(0).normalize();
    b.group.rotation.y = Math.atan2(dir.x, dir.z);
    const from = b.group.position.clone().add(new T.Vector3(0, 1.05, 0)),
      to = player.group.position.clone().add(new T.Vector3(0, 1.05, 0)),
      los = visible(from, to);
    // ---- Aggressive AI ----
    // Each bot is a flanker (60 %) or an assault bot. Flankers path to a point beside you (11 m off your
    // line to them, on their own side) and close in from there; assault bots press to their preferred range
    // and keep circling while they shoot — nobody stands still. When your health drops below 35 % everyone
    // rushes you: straight in, faster, firing more often.
    const w = weapons[b.weaponIndex],
      prefer = w.kind === 1 ? 4.5 : w.kind === 0 ? 13 : 8,
      // the last enemies of a wave (no groups left to come, ≤ 3 alive) stop holding ground and hunt you down
      hunting = lastEnemies() || (b.alert > 0 && distance > (weapons[b.weaponIndex].range || 20) * 0.8),
      rush = hp < 35 * difficulty.smart || hunting;
    b.role ||= b.shield ? "assault" : Math.random() < Math.min(0.9, 0.6 * difficulty.smart) ? "flank" : "assault";
    if (b.flanked && distance > prefer + 12) b.flanked = false;
    const seek = botSeekDrop(b, dt),
      flanking = !seek && !rush && b.role === "flank" && !b.flanked && distance > prefer + 3,
      goal = seek
        ? seek.group.position
        : flanking
        ? player.group.position.clone().addScaledVector(new T.Vector3(-dir.z * b.side, 0, dir.x * b.side), 11).addScaledVector(dir, -2)
        : player.group.position;
    if (flanking && b.group.position.distanceTo(goal) < 4) b.flanked = true;
    let m = new T.Vector3();
    b.pathTime -= dt;
    b.forcePath = Math.max(0, (b.forcePath || 0) - dt);
    if (seek || !los || Math.abs(delta.y) > 1 || b.forcePath > 0 || flanking || (rush && distance > 6)) {
      if (b.pathTime <= 0) {
        b.path = findPath(b.group.position, hunting && !seek ? player.group.position : goal);
        b.pathTime = 0.6 + Math.random() * 0.3;
      }
      while (b.path.length && b.path[0].distanceTo(b.group.position) < 0.65) b.path.shift();
      if (b.path.length) m.copy(b.path[0]).sub(b.group.position).setY(0).normalize();
      else if (los) m.copy(dir);
    } else if (rush) m.copy(dir);
    else if (distance > prefer) m.copy(dir).addScaledVector(new T.Vector3(dir.z * b.side, 0, -dir.x * b.side), 0.35).normalize();
    else if (distance < prefer * 0.55) m.copy(dir).multiplyScalar(-0.6).addScaledVector(new T.Vector3(dir.z * b.side, 0, -dir.x * b.side), 0.6);
    else {
      // circle at range, drifting in a little, and switch direction every few seconds
      b.circle = (b.circle ?? 1.5 + Math.random() * 2) - dt;
      if (b.circle <= 0) {
        b.side *= -1;
        b.circle = 1.5 + Math.random() * 2;
      }
      m.set(dir.z * b.side * 0.8, 0, -dir.x * b.side * 0.8).addScaledVector(dir, 0.25);
    }
    botMaybeDash(b, dir, distance, los, dt);
    if (b.dashWind > 0) m.set(0, 0, 0);
    if (b.dashTime > 0) {
      b.dashTime -= dt;
      m.copy(b.dashDir);
      b.ghostT = (b.ghostT || 0) - dt;
      if (b.ghostT <= 0) (b.ghostT = 0.045), dashGhost(b);
    }
    const pace = b.dashTime > 0 ? BOT_DASH.speed : (b.shield ? SHIELD.pace : 1) * (w.kind === 1 ? 4.6 : w.kind === 0 ? 3 : 3.8) * (rush ? 1.3 : 1) * difficulty.speed;
    // separation: bots keep personal space instead of piling into one blob — steer away from close
    // neighbours and, if they still overlap, get pushed apart (through move(), so walls still hold)
    if (!b.flight) {
      let sx = 0,
        sz = 0;
      for (const o of bots) {
        if (o === b || o.dead || o.flight || o.giant) continue;
        const dx = b.group.position.x - o.group.position.x,
          dz = b.group.position.z - o.group.position.z,
          d = Math.hypot(dx, dz);
        if (d > BOT_SPACE || Math.abs(b.group.position.y - o.group.position.y) > 1.5) continue;
        const k = d < 0.01 ? 1 : (BOT_SPACE - d) / BOT_SPACE,
          nx = d < 0.01 ? Math.cos(b.side * 2.4 + bots.indexOf(b)) : dx / d,
          nz = d < 0.01 ? Math.sin(b.side * 2.4 + bots.indexOf(b)) : dz / d;
        sx += nx * k;
        sz += nz * k;
        if (d < BOT_BODY) move(b, nx * (BOT_BODY - d) * 0.5, nz * (BOT_BODY - d) * 0.5);
      }
      if (sx || sz) m.x += sx * 1.6, m.z += sz * 1.6;
      if (m.lengthSq() > 1) m.normalize();
    }
    // never walk into the player: closer than 1.8 m the forward part of the move is dropped (circle instead)
    if (distance < 1.8 && b.dashTime <= 0) {
      const fwd = m.dot(dir);
      if (fwd > 0) m.addScaledVector(dir, -fwd).addScaledVector(new T.Vector3(dir.z * b.side, 0, -dir.x * b.side), 0.6);
    }
    const old = b.group.position.clone();
    if (!b.flight)
      move(b, m.x * pace * SPEED_SCALE * (b.stun > 0 ? 0.2 : 1) * dt, m.z * pace * SPEED_SCALE * (b.stun > 0 ? 0.2 : 1) * dt);
    // a bot never steps down into the moat on its own (only a pad or the blast can throw it in)
    if (generatedPlan?.moat && old.y > -0.5 && b.group.position.y < -1 && !b.flight) b.group.position.copy(old);
    if (distance < 1.1 && !b.flight) {
      const away = b.group.position.clone().sub(player.group.position).setY(0);
      if (away.lengthSq() < 1e-4) away.set(1, 0, 0);
      away.normalize();
      move(b, away.x * (1.1 - distance), away.z * (1.1 - distance));
    }
    if (m.lengthSq() > 0.1 && old.distanceTo(b.group.position) < 0.002) {
      move(b, -dir.z * b.side * 2 * SPEED_SCALE * dt, dir.x * b.side * 2 * SPEED_SCALE * dt);
      b.think -= dt;
      if (b.think < 0) {
        b.side *= -1;
        b.think = 2;
      }
    }
    // Stuck watchdog (stairs, stair walls, tight cluster alleys): if a bot that wants to move has gained
    // less than 0.35 m in 1.2 s it follows the navigation path even with line of sight; after 3.5 s it is
    // placed back on the path (the next path point, else its own nearest open cell).
    if (!b.flight && m.lengthSq() > 0.1) {
      b.stuckTime = (b.stuckTime || 0) + dt;
      if (!b.stuckFrom) b.stuckFrom = b.group.position.clone();
      if (b.group.position.distanceTo(b.stuckFrom) > 0.35) {
        b.stuckTime = 0;
        b.stuckFrom.copy(b.group.position);
      } else if (b.stuckTime > 1.2 && !b.forcePath) {
        b.forcePath = 2.5;
        b.pathTime = 0;
      }
      if (b.stuckTime > 3.5) {
        const next = b.path?.find((p) => p.distanceTo(b.group.position) > 2.5);
        if (next && !occupied(next.x, next.y, next.z, b.elite ? 0.78 : 0.6)) b.group.position.copy(next);
        else move(b, -dir.z * b.side * 1.2, dir.x * b.side * 1.2);
        b.stuckTime = 0;
        b.stuckFrom.copy(b.group.position);
        runtimeStats.unstuck = (runtimeStats.unstuck || 0) + 1;
      }
    } else b.stuckTime = 0;
    if (!b.flight && b.padCooldown <= 0) launchBot(b, m.lengthSq() > 0.01 ? m : dir);
    animate(b, m.lengthSq() > 0.05 ? "walk" : "idle");
    b.shot -= dt;
    if (b.laserAim) updateBotLaserAim(b, dt);
    else if (b.shot <= 0 && los && distance < weapons[b.weaponIndex].range && b.stun <= 0 && botHasAmmo(b) && weapons[b.weaponIndex].kind === 4) {
      // Laser bots telegraph: a thin red sight line locks where you are now, the beam fires 0.55 s later
      // along that line — step aside and it misses (a hitscan beam with no warning was almost a sure hit).
      b.shot = (0.85 + Math.random() * 0.5) * (hp < 35 ? 0.7 : 1) * botReact() + 0.55;
      const muzzle = weaponMuzzle(b),
        dir = to
          .clone()
          .add(new T.Vector3((Math.random() - 0.5) * botAim(), 0, (Math.random() - 0.5) * botAim()))
          .sub(muzzle)
          .normalize(),
        len = weapons[b.weaponIndex].range,
        line = new T.Mesh(
          new T.CylinderGeometry(0.018, 0.018, len, 5).rotateX(Math.PI / 2).translate(0, 0, len / 2),
          new T.MeshBasicMaterial({ color: HDR(0xff3040, 2), transparent: true, opacity: 0.15, depthWrite: false }),
        );
      line.position.copy(muzzle);
      line.lookAt(muzzle.clone().add(dir));
      line.userData.laserSight = true;
      scene.add(line);
      b.laserAim = { time: 0.55, dir, line };
      botFired(b);
    } else if (b.shot <= 0 && los && distance < weapons[b.weaponIndex].range && b.stun <= 0 && botHasAmmo(b)) {
      b.shot = ((weapons[b.weaponIndex].kind === 1 ? 1.4 : 0.85) + Math.random() * 0.5) * (hp < 35 ? 0.7 : 1) * botReact();
      botFired(b);
      shooter = b;
      const target = to
          .clone()
          .add(new T.Vector3((Math.random() - 0.5) * botAim(), 0, (Math.random() - 0.5) * botAim())),
        muzzle = weaponMuzzle(b),
        direction = target.sub(muzzle).normalize();
      muzzleFlash(muzzle, b.weaponIndex);
      {
        const shot = shotSound(weapons[b.weaponIndex]);
        if (shot) sfx.play(shot.name, { position: muzzle, group: "enemy", volume: shot.volume * 0.75, rate: (shot.rate ?? 1) * 0.97 });
      }
      const blocked = muzzleObstruction(b, muzzle);
      if (blocked && weapons[b.weaponIndex].kind !== 4) impact(blocked.point, 0xffdb9b, 0.25);
      else if (weapons[b.weaponIndex].kind === 3) {
        for (let barrel = 0; barrel < 4; barrel++) {
          const spreadDirection = direction
            .clone()
            .applyAxisAngle(new T.Vector3(0, 1, 0), ((barrel - 1.5) / 3) * weapons[b.weaponIndex].spread);
          spawnProjectile(muzzle, spreadDirection, b.weaponIndex, true);
        }
      } else {
        const w = weapons[b.weaponIndex],
          count = w.kind === 1 ? w.pellets : 1;
        for (let i = 0; i < count; i++) {
          const d = direction.clone();
          if (count > 1)
            d.applyAxisAngle(new T.Vector3(0, 1, 0), (Math.random() - 0.5) * w.spread).normalize();
          spawnProjectile(muzzle, d, b.weaponIndex, true);
        }
      }
      shooter = null;
    }
  }
}
function update(dt) {
  if (!player) return;
  if (navigationDirty) {
    navigationDirty = false;
    navigationQueue.length = 0;
    buildNavigation();
  } else if (navigationQueue.length && navigation) {
    for (const box of navigationQueue.splice(0)) {
      navigation.refresh(box.min.x - 1, box.min.z - 1, box.max.x + 1, box.max.z + 1);
      // keep the open-cell grid (used by spawn and recovery) in step with the refreshed cells
      const c0 = navCell(box.min),
        c1 = navCell(box.max);
      for (let z = Math.max(0, c0.z - 2); z <= Math.min(navSize - 1, c1.z + 2); z++)
        for (let x = Math.max(0, c0.x - 2); x <= Math.min(navSize - 1, c1.x + 2); x++)
          navGrid[navIndex(x, z)] = navigation.cells[navIndex(x, z)].length > 0;
    }
  }
  time += dt;
  for (const pad of padVisuals) {
    pad.arrow.position.y = 1 + Math.sin(time * 3) * 0.15;
    pad.arrow.rotation.y = time;
  }
  shake = Math.max(0, shake - dt);
  if (active) {
    if (viewMode === "rear") updateAim();
    if (viewMode === "rear" && document.pointerLockElement !== canvas && lastMouse) {
      const edge =
        lastMouse.x < 40
          ? -(1 - lastMouse.x / 40)
          : lastMouse.x > innerWidth - 40
            ? 1 - (innerWidth - lastMouse.x) / 40
            : 0;
      viewYaw -= edge * 1.8 * dt;
    }
    dashCooldown = Math.max(0, dashCooldown - dt);
    updatePowerDash();
    updateSpawnShield(dt);
    updateOrbs(dt);
    updateSpeedEffect(dt);
    dashTime = Math.max(0, dashTime - dt);
    updateDashWidget();
    $("dash").textContent =
      dashCharges > 0
        ? "ПКМ · МОЩНЫЙ РЫВОК ×" + dashCharges
        : dashCooldown > 0
          ? "РЫВОК · " + dashCooldown.toFixed(1) + " c"
          : "ПКМ · РЫВОК ГОТОВ";
    player.gun.position.z = T.MathUtils.lerp(
      player.gun.position.z,
      player.gun.userData.restZ,
      1 - Math.exp(-15 * dt),
    );
    player.gun.rotation.x = T.MathUtils.lerp(player.gun.rotation.x, 0, 1 - Math.exp(-12 * dt));
    cooldown = Math.max(0, cooldown - dt);
    if (reloading > 0) {
      reloading -= dt;
      if (reloading <= 0) {
        ammo = weapons[gunIndex].mag;
        updateHUD();
        sound(650, 0.06, "triangle");
      }
    }
    const input = new T.Vector3();
    if (keys.KeyW || keys.ArrowUp) input.add(screenUp);
    if (keys.KeyS || keys.ArrowDown) input.sub(screenUp);
    if (keys.KeyD || keys.ArrowRight) input.add(screenRight);
    if (keys.KeyA || keys.ArrowLeft) input.sub(screenRight);
    // Touch stick: analog direction and speed; full tilt sprints.
    let analog = 1;
    if (touch?.move.active) {
      const aiming = touch.aim.active && Math.hypot(touch.aim.x, touch.aim.y) > 0.2;
      if (false && viewMode === "rear" && !aiming) {
        // rear view, not aiming: sideways turns the camera, forward/back walks
        // (small dead zone so a resting thumb does not slowly spin the camera)
        const turn = Math.abs(touch.move.x) < 0.12 ? 0 : touch.move.x;
        viewYaw -= turn * Math.abs(turn) * 2.6 * TOUCH_AIM_SENSITIVITY * dt;
        input.addScaledVector(screenUp, -touch.move.y);
        analog = Math.min(1, Math.abs(touch.move.y) * 1.25);
      } else {
        // isometric, or rear view while the fire stick aims: the camera belongs to the aim, the move stick
        // only walks (sideways = strafe), so the two thumbs never fight over the camera
        input.addScaledVector(screenUp, -touch.move.y).addScaledVector(screenRight, touch.move.x);
        analog = Math.min(1, Math.hypot(touch.move.x, touch.move.y) * 1.25);
      }
    }
    const moving = input.lengthSq() > 0.0025,
      sprint =
        keys.ShiftLeft ||
        (touch?.move.active && Math.hypot(touch.move.x, touch.move.y) > 0.85); // stick pushed (almost) all the way = run
    touch?.root.querySelector(".joystick")?.classList.toggle("run", !!(touch?.move.active && sprint));
    if (moving) lastMove.copy(input).normalize();
    else input.set(0, 0, 0);
    lastStepMoving = moving;
    lastStepSprint = !!sprint;
    input.normalize().multiplyScalar((sprint ? 9 : 6) * analog * SPEED_SCALE * dt);
    if (dashTime > 0) input.copy(dashDirection).multiplyScalar((dashPower ? 34 : 24) * dt);

    padCooldown = Math.max(0, padCooldown - dt);
    if (jumpFlight) {
      updateJumpFlight(dt);
    } else {
      const beforeMove = player.group.position.clone();
      move(player, input.x, input.z);
      player.padMotion = player.group.position
        .clone()
        .sub(beforeMove)
        .multiplyScalar(1 / Math.max(dt, 0.001));
      const floor = actorFloor(
        player.group.position.x,
        player.group.position.z,
        player.group.position.y + 0.4,
      );
      if (grounded && player.group.position.y > floor + 0.15) grounded = false;
      if ((keys.Space || touch?.jump) && grounded) {
        vy = 9.5;
        grounded = false;
      }
      const oldY = player.group.position.y;
      vy -= 17 * dt;
      player.group.position.y += vy * dt;
      // Stepping off an edge: the body's centre is past the edge but its radius still overlaps the block,
      // so falling would sink it into the block's side and the recovery search would yank it around
      // ("stuck on the edge"). Instead slide it straight off, out of the nearest side — but only while really
      // falling: on the ground (stair tops, seams between platforms) the step-up in move() must win.
      {
        const p = player.group.position;
        if (vy < 0 && actorFloor(p.x, p.z, p.y + 0.4) < p.y - 0.05) slideOffEdges(p, 0.43);
      }
      const landing = actorFloor(player.group.position.x, player.group.position.z, oldY + 0.001);
      if (vy <= 0 && player.group.position.y <= landing) {
        player.group.position.y = landing;
        player.padImpact = vy;
        vy = 0;
        grounded = true;
      }
      tryJumpPad();
    }
    if (!jumpFlight) recoverPosition(player);
    animate(player, grounded ? (moving ? (sprint ? "sprint" : "walk") : "idle") : "jump");
    player.mixer.update(dt);
    updateCamera(dt);
    if (touch) {
      applySwipeLook();
      applyTouchAim(dt);
      // touch: jump is a one-shot press; medkits are used automatically when hurt and standing on one
      if (touch.jump && !grounded) touch.jump = false;
    }
    updateAim();
    scene.updateMatrixWorld(true);
    if (mouseDown || touchFiring) shoot();
    updateSlowmo(dt);
    updateCombo(dt);
    updateBots(dt * worldScale());
    updateProjectiles(dt);
    updatePickup();
    updateMedkits();
    if (active && wave) runStats.time += dt;
    if (active && wave && waveGroup < WAVE_GROUPS[wave - 1].length) {
      groupTimer -= dt * worldScale();
      if (groupTimer <= 0 || bots.filter((b) => !b.dead).length <= 1) spawnGroup();
    }
    updateSkyDrops(dt * worldScale());
    updateDarkness(dt);
    updateWalls(dt);
    updateLevelSystems(dt);
    updateTowers(dt);
    if (active && lastEnemies()) {
      hintTimer -= dt;
      if (hintTimer <= 0) (hintTimer = 0.25), updateHUD();
    }
    if (active && wave && waveGroup >= WAVE_GROUPS[wave - 1].length && !bots.some((b) => !b.dead) && wave === GIANT.wave && !giantSpawned && !sniperMode() && taskDone()) {
      giantSpawned = true;
      spawnGiant();
    }
    if (giantKnock.lengthSq() > 0.01 && active) {
      move(player, giantKnock.x * dt, giantKnock.z * dt);
      giantKnock.multiplyScalar(Math.exp(-4 * dt));
    }
    updateBossBar();
    if (active && wave && waveGroup >= WAVE_GROUPS[wave - 1].length && !bots.some((b) => !b.dead) && taskDone()) {
      if (!waveDelay) {
        waveDelay = 3;
        message(wave < WAVE_COUNT ? "ВОЛНА ПРОЙДЕНА · ПОДБЕРИ ОРУЖИЕ" : "АРЕНА ОЧИЩЕНА", 3);
      }
      waveDelay -= dt;
      if (waveDelay <= 0) {
        if (wave >= WAVE_COUNT) finish(true);
        else openCards();
      }
    }
  } else {
    updateCamera(dt);
    player.mixer.update(dt);
  }
  for (const d of drops) {
    d.gun.position.y = d.baseY + Math.sin(time * 2 + d.phase) * 0.045;
    d.ring.material.opacity = 0.6 + Math.sin(time * 3 + d.phase) * 0.2;
  }
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.life -= dt;
    if (e.velocity) {
      e.velocity.y -= (e.gravity ?? 8) * dt;
      e.obj.position.addScaledVector(e.velocity, dt);
      if (e.spin) ((e.obj.rotation.x += e.spin * dt), (e.obj.rotation.z += e.spin * 0.7 * dt));
      if (e.floor !== undefined && e.obj.position.y < e.floor) {
        e.obj.position.y = e.floor;
        e.velocity.y *= -0.3;
        e.velocity.x *= 0.55;
        e.velocity.z *= 0.55;
        e.spin = (e.spin || 0) * 0.5;
      }
    }
    if (e.grow) e.obj.scale.addScalar(e.grow * dt);
    const fade = (e.initialOpacity ?? 1) * Math.max(0, e.life / e.max);
    if (e.obj.material) e.obj.material.opacity = fade;
    else e.obj.traverse((n) => n.isMesh && (n.material.opacity = fade));
    if (e.life <= 0) {
      scene.remove(e.obj);
      disposeEffect(e.obj);
      effects.splice(i, 1);
    }
  }
  updateOcclusion();
  hitTime = Math.max(0, hitTime - dt);
  damageTime = Math.max(0, damageTime - dt);
  $("hitmarker").style.opacity = hitTime > 0 ? "1" : "0";
  $("hitmarker").style.left = $("crosshair").style.left;
  $("hitmarker").style.top = $("crosshair").style.top;
  // hit vignette: full in the isometric view, barely visible (and softer) in the rear view
  $("damage").style.opacity = (damageTime / 0.3) * (viewMode === "rear" ? 0.32 : 0.4);
  $("damage").classList.toggle("soft", viewMode === "rear");
  if (noticeTime > 0) {
    noticeTime -= dt;
    if (noticeTime <= 0) $("notice").textContent = "";
  }
}
// adaptive resolution (phones): average frame time over ~1.5 s windows
let frameTimeSum = 0,
  frameCount = 0,
  lastResolutionChange = 0;
function adaptResolution(dt) {
  if (!MOBILE || !post) return;
  frameTimeSum += dt;
  frameCount++;
  if (frameTimeSum < 1.5) return;
  const avg = frameTimeSum / frameCount,
    now = performance.now() / 1000,
    ratio = renderer.getPixelRatio();
  frameTimeSum = frameCount = 0;
  let next = ratio;
  if (avg > 1 / 45 && ratio > MOBILE_MIN_RATIO) next = Math.max(MOBILE_MIN_RATIO, ratio - 0.25);
  else if (avg < 1 / 57 && ratio < MOBILE_MAX_RATIO && now - lastResolutionChange > 5) next = Math.min(MOBILE_MAX_RATIO, ratio + 0.25);
  if (next !== ratio) {
    lastResolutionChange = now;
    renderer.setPixelRatio(next);
    renderer.setSize(innerWidth, innerHeight);
    post.setSize(innerWidth, innerHeight);
  }
  // sharpen more when the picture is rendered at a lower resolution than the screen
  post.setSharpen?.(Math.min(0.6, Math.max(0.15, (devicePixelRatio - next) * 0.35)));
}
function frame() {
  requestAnimationFrame(frame);
  touch?.show(active && !ended);
  const frameDt = clock.getDelta();
  if (active) adaptResolution(Math.min(frameDt, 0.25));
  update(Math.min(frameDt, 0.05));
  post ? post.render(scene, camera) : renderer.render(scene, camera);
}
frame();
const graveFiles = [
  "crypt-a",
  "grave",
  "gravestone-round",
  "gravestone-broken",
  "gravestone-cross",
  "iron-fence",
  "iron-fence-damaged",
  "rocks",
  "rocks-tall",
  "trunk",
  "coffin-old",
  "altar-stone",
];
// Models for the decor of THIS arena only (its clusters, fill props and landmarks), not every arena type's:
// faster loading, and new arena types do not slow down the others. The classic arena loads the full set.
function arenaAssetKeys() {
  if (!generatedPlan) return [...clusterKeys(), ...fillKeys()];
  generatedPlan.decor ||= decorate(generatedPlan);
  const d = generatedPlan.decor;
  return [
    ...clusterKeys([...new Set(d.clusters.map((c) => c.id))]),
    ...d.fill.map((f) => f.key),
    ...(generatedPlan.landmarks || []).map((m) => m.key),
    ...(generatedPlan.wallRuns || []).map((r) => r.key || "arena/wall"),
  ];
}
const files = [...new Set([
  ...expansionAssets,
  ...graveFiles.map((p) => "graveyard/" + p),
  ...people.filter((p) => p.startsWith("character-")).map((p) => "people/" + p),
  "arena/floor",
  "arena/block",
  "arena/wall",
  "arena/column",
  "arena/column-damaged",
  "arena/banner",
  "arena/statue",
  "arena/weapon-rack",
  "guns/target-large",
  "castle/tower-square-base",
  "castle/flag-wide",
  "castle/flag-banner-long",
  "castle/rocks-large",
  ...arenaAssetKeys(),
  "arena/stairs",
  "arena/tree",
  "guns/crate-wide",
  "guns/crate-small",
  "graveyard/lantern-glass",
  ...weapons.map((w) => "guns/" + w.model),
  ...Object.values(UPGRADE_EFFECTS)
    .map((e) => e.icon || "")
    .filter((k) => k.includes("/")),
])];
let loaded = 0;

Promise.all([
  ...files.map(async (key) => {
    assets[key] = await loader.loadAsync("./assets/" + key + ".glb");
    assets[key].scene.traverse((n) => {
      if (!n.isMesh) return;
      for (const m of [n.material].flat()) {
        if (!m.isMeshStandardMaterial) continue;
        if (key.startsWith("guns/") && !key.includes("crate")) {
          m.metalness = 0.35;
          m.roughness = 0.38;
        } else if (key.startsWith("arena/") || key.startsWith("graveyard/")) {
          m.metalness = 0;
          m.roughness = 0.78;
        }
      }
    });
    $("loading").textContent = "Загрузка моделей: " + ++loaded + " / " + files.length;
  }),
])
  .then(() => {
    buildArena();
    player = character(people[0], 0, 18);
    if (startWeapon()) {
      gunIndex = startWeapon();
      attachGun(player, gunIndex);
      ammo = weapons[gunIndex].mag;
    }
    if (generatedPlan) {
      $("startzone").innerHTML = generatedPlan.zones
        .map((z, i) => '<option value="' + z.id + '">' + (i + 1) + " · " + zoneLayout(z).name + "</option>")
        .join("");
      $("startzone").value = generatedPlan.zones[0].id;
      chooseZoneStart();
    }
    updateCamera(1);
    updateAim();
    $("start").disabled = false;
    setTimeout(() => $("splash")?.classList?.add?.("gone"), Math.max(0, 1600 - performance.now()));
    $("start").textContent = "НАЧАТЬ БОЙ";
    if (arenaParameters?.get("autostart")) {
      try {
        const u = new URL(location.href);
        u.searchParams.delete("autostart");
        history.replaceState(null, "", u.href);
      } catch {}
      $("splash")?.classList?.add?.("gone");
      setTimeout(() => start(), 0);
    }
    $("loading").textContent =
      (generatedPlan?.typeName ? "Арена: " + generatedPlan.typeName + (generatedPlan.biomeName ? ", " + generatedPlan.biomeName.toLowerCase() : "") + " · " : "") +
      "Модели и анимации Kenney · звук включается с началом боя";
    window.__arena = {
      get state() {
        return {
          arenaSeed: generatedPlan?.seed,
          arenaGraph: generatedPlan?.graph,
          active,
          ended,
          wave,
          hp,
          ammo,
          gunIndex,
          kills,
          hits,
          bots: bots.filter((b) => !b.dead).length,
          drops: drops.map((d) => ({ index: d.index, ammo: d.ammo, position: d.group.position.toArray() })),
          position: player.group.position.toArray(),
          assets: loaded,
          performance: {
            ...runtimeStats,
            worldMeshes: solidMeshes.length,
            spatialCells: worldIndex.cells.size,
          },
          cameraType: camera.type,
          viewMode,
          viewYaw,
          viewPitch,
          terrainHeight: terrainHeight(
            player.group.position.x,
            player.group.position.z,
            player.group.position.y + 0.4,
          ),
          viewHeight: VIEW_HEIGHT,
          dashCooldown,
          immortal,
          projectiles: projectiles.length,
          explosives: explosives.filter((c) => !c.dead).length,
        };
      },
      start,
      shoot,
      reload,
      pickup,
      toggleImmortality,
      toggleView,
    };
  })
  .catch((e) => {
    console.error(e);
    $("loading").textContent = "Не удалось загрузить арену. Обнови страницу.";
  });

// v169: start in rear view by default
try { if (viewMode === "iso" && typeof document !== "undefined") toggleView(); } catch (e) { console.warn(e); }
