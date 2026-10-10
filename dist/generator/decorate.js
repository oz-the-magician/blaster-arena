// Decorator: fills a finished arena plan with catalogue clusters, then a light layer of single props.
// Pure data: works from the plan alone and returns { clusters: [{ id, x, z, rot }], fill: [{ key, x, z, size, rot, solid }], stats };
// the game places the models and runs the per-model checks (routes, pads, stairs, overlaps).
//
// Fill rule (coverage): the arena is sampled on a 4 m grid. Route corridors (±3 m), stairs and the ravine floor
// are "roads" and never count. Every other cell is "dead" when nothing — courtyard, platform, cluster, landmark,
// prop, ravine edge — lies within DEAD_DISTANCE. Target: at most MAX_DEAD of the free cells dead in EACH quarter
// of the map. Clusters go first (only where they cover dead cells); the remaining holes get small props.
//
// Designer rules encoded here:
//   • spots come from the layout: arena edges and corners, the sides of ground routes, open ground;
//   • a cluster only goes where its `place` allows; its theme must match the arena theme;
//   • nothing sits on a route, stair, pad, platform, the ravine, a courtyard or a fixed landmark;
//   • clusters keep their distance from each other; dense ones are capped per arena, others appear at most twice;
//   • every cluster turns its front (+z) towards the nearest route, edge clusters face the arena centre.
import { CLUSTERS } from "./clusters.js";
import { zoneTemplates } from "../zone-templates.js";
import { seededRandom } from "./world.js";

export const ARENA_THEMES = { desert: ["desert", "coast"], meadow: ["meadow", "fortress", "forest"], ruins: ["fortress", "forest", "meadow"], night: ["siege", "fortress", "meadow"] };
export const DEAD_DISTANCE = 8; // metres from anything before ground counts as empty
export const MAX_DEAD = 0.3; // share of dead free cells allowed per quarter
const CELL = 4;
// Single props for the fill layer, by arena theme: [key, size range, solid]
export const FILL = {
  desert: [
    ["nature/cactus_tall", [2, 3], true],
    ["nature/cactus_short", [1, 1.4], true],
    ["pirate/rocks-sand-a", [2, 3.4], true],
    ["pirate/rocks-sand-b", [1.6, 2.6], true],
    ["pirate/rocks-sand-c", [1.4, 2.2], true],
    ["nature/rock_tallC", [2.4, 3.6], true],
    ["nature/stone_smallFlatA", [1, 1.6], false],
    ["pirate/grass-plant", [0.8, 1.2], false],
    ["pirate/palm-straight", [4.5, 6], true],
    ["pirate/barrel", [1, 1.2], true],
    ["pirate/crate", [1, 1.3], true],
  ],
  meadow: [
    ["nature/tree_oak", [5, 7], true],
    ["nature/tree_default", [4.5, 6], true],
    ["nature/tree_pineDefaultA", [5, 7], true],
    ["nature/plant_bushLarge", [1.6, 2.4], true],
    ["nature/plant_bush", [1, 1.6], false],
    ["nature/rock_largeA", [1.8, 3], true],
    ["nature/stump_roundDetailed", [0.9, 1.3], true],
    ["nature/grass_large", [0.8, 1.2], false],
    ["nature/flower_yellowA", [0.5, 0.7], false],
    ["nature/flower_purpleB", [0.5, 0.7], false],
    ["nature/log_large", [2.4, 3.2], true],
    ["survival/barrel", [1, 1.2], true],
  ],
};
export const fillKeys = () => [...new Set(Object.values(FILL).flatMap((list) => list.map((f) => f[0])))];

const segDistance = (px, pz, ax, az, bx, bz) => {
  const dx = bx - ax,
    dz = bz - az,
    l = dx * dx + dz * dz,
    t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l)) : 0;
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
};
const rectDistance = (px, pz, r) =>
  Math.hypot(Math.max(0, Math.abs(px - r.x) - r.w / 2), Math.max(0, Math.abs(pz - r.z) - r.d / 2));

export function decorate(plan, options = {}) {
  // per-theme overrides: plan.theme.fill = { deadDistance, maxDead, maxClusters, repeat }
  const fillRule = plan.theme?.fill || {},
    dense = options.dense ?? 2,
    maxDead = options.maxDead ?? fillRule.maxDead ?? MAX_DEAD,
    maxClusters = options.maxClusters ?? fillRule.maxClusters ?? 26,
    repeat = fillRule.repeat ?? 3,
    deadDistance = fillRule.deadDistance ?? DEAD_DISTANCE;
  const random = seededRandom(plan.seed + "-decor"),
    themes = ARENA_THEMES[plan.theme?.id] || [plan.theme?.id],
    L = plan.limit ?? 110;
  const pool = Object.entries(CLUSTERS).filter(([, c]) => c.decor !== false && c.themes.some((t) => themes.includes(t)));
  if (!pool.length) return { clusters: [], fill: [], stats: null };

  // Ground routes as segments (upper bridges are excluded by the platform footprints instead).
  const segments = [];
  for (const r of plan.coreRoutes || [])
    if (r.role !== "upper")
      for (let i = 1; i < r.points.length; i++) {
        const [ax, , az] = r.points[i - 1],
          [bx, , bz] = r.points[i];
        segments.push([ax, az, bx, bz]);
      }
  const rampRects = (plan.ramps || []).map((r) => {
    const alongX = Math.abs(r.x1 - r.x0) > Math.abs(r.z1 - r.z0);
    return {
      x: (r.x0 + r.x1) / 2,
      z: (r.z0 + r.z1) / 2,
      w: alongX ? Math.abs(r.x1 - r.x0) : r.width,
      d: alongX ? r.width : Math.abs(r.z1 - r.z0),
    };
  });
  const zoneRects = (plan.zones || []).map((z) => {
    const e = zoneTemplates[z.template]?.extent || { w: 30, d: 30 };
    return { x: z.x, z: z.z, w: Math.max(e.w, e.d), d: Math.max(e.w, e.d) };
  });
  const points = [
    ...(plan.jumpPads || []).map((p) => [p.x, p.z, 3]),
    ...(plan.medkits || []).map(([x, z]) => [x, z, 1.5]),
    ...(plan.graph?.nodes || []).map((n) => [n.world.x, n.world.z, 3]),
    ...(plan.landmarks || []).filter((m) => !m.scatter).map((m) => [m.x, m.z, 2 + (m.size || 2) / 2]),
  ];
  const nearestRoute = (x, z) => {
    let best = Infinity,
      at = null;
    for (const [ax, az, bx, bz] of segments) {
      const d = segDistance(x, z, ax, az, bx, bz);
      if (d < best) {
        best = d;
        const dx = bx - ax,
          dz = bz - az,
          l = dx * dx + dz * dz,
          t = l ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l)) : 0;
        at = [ax + dx * t, az + dz * t];
      }
    }
    return { distance: best, at };
  };
  const placed = [];
  const fits = (x, z, r) => {
    if (Math.abs(x) > L - 3 - r || Math.abs(z) > L - 3 - r) return false;
    if (nearestRoute(x, z).distance < r + 2.5) return false;
    if (rampRects.some((q) => rectDistance(x, z, q) < r + 2)) return false;
    if ((plan.skyPlatforms || []).some((q) => rectDistance(x, z, q) < r + 1)) return false;
    if (plan.pit?.w > 0 && rectDistance(x, z, plan.pit) < r + 2) return false;
    if ((plan.moat || []).some((q) => rectDistance(x, z, q) < r + 2)) return false;
    if (zoneRects.some((q) => rectDistance(x, z, q) < r + 1.5)) return false;
    if (points.some(([px, pz, pr]) => Math.hypot(x - px, z - pz) < r + pr)) return false;
    return !placed.some((p) => Math.hypot(x - p.x, z - p.z) < r + p.r + 2.5);
  };

  // ---- Coverage grid ----
  const cells = [];
  for (let x = -L + CELL / 2; x < L; x += CELL)
    for (let z = -L + CELL / 2; z < L; z += CELL) {
      const road =
        segments.some(([ax, az, bx, bz]) => segDistance(x, z, ax, az, bx, bz) < 3) ||
        rampRects.some((q) => rectDistance(x, z, q) < 1) ||
        (plan.pit?.w > 0 && rectDistance(x, z, plan.pit) < 0.01) ||
        (plan.moat || []).some((q) => rectDistance(x, z, q) < 0.01);
      if (road) continue;
      cells.push({ x, z, q: (x >= 0 ? 1 : 0) + (z >= 0 ? 2 : 0), near: Infinity });
    }
  const cover = (distanceTo) => {
    for (const c of cells) c.near = Math.min(c.near, distanceTo(c.x, c.z));
  };
  const deadIn = (c) => c.near > deadDistance;
  zoneRects.forEach((q) => cover((x, z) => rectDistance(x, z, q)));
  (plan.skyPlatforms || []).forEach((q) => cover((x, z) => rectDistance(x, z, q)));
  rampRects.forEach((q) => cover((x, z) => rectDistance(x, z, q)));
  if (plan.pit?.w > 0) cover((x, z) => rectDistance(x, z, plan.pit));
  (plan.moat || []).forEach((q) => cover((x, z) => rectDistance(x, z, q)));
  points.forEach(([px, pz, pr]) => cover((x, z) => Math.max(0, Math.hypot(x - px, z - pz) - pr / 2)));
  const quarters = () =>
    [0, 1, 2, 3].map((q) => {
      const list = cells.filter((c) => c.q === q);
      return list.length ? list.filter(deadIn).length / list.length : 0;
    });
  const gain = (x, z, r) => cells.filter((c) => deadIn(c) && Math.hypot(c.x - x, c.z - z) - r <= deadDistance).length;
  const before = quarters();
  // clusters the arena generator placed on purpose (e.g. the siege camp around the moat) come first
  for (const f of plan.fixedClusters || []) {
    const c = CLUSTERS[f.id];
    if (!c) continue;
    const r = c.radius * (f.scale ?? 1);
    placed.push({ ...f, r, kind: "fixed" });
    cover((cx, cz) => Math.max(0, Math.hypot(cx - f.x, cz - f.z) - r));
  }

  // Candidate spots, each with the kind of place it offers and the direction its front should face.
  const candidates = [];
  const facing = (x, z) => {
    const { at } = nearestRoute(x, z);
    return at ? Math.atan2(at[0] - x, at[1] - z) : Math.atan2(-x, -z);
  };
  for (let t = -L + 16; t <= L - 16; t += 9)
    for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
      candidates.push({ kind: "edge", wall: [nx ? -nx * L : t, nz ? -nz * L : t], normal: [nx, nz] });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) candidates.push({ kind: "corner", corner: [sx, sz] });
  for (const [ax, az, bx, bz] of segments) {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 10) continue;
    for (let s = 7; s < len - 6; s += 13)
      for (const side of [-1, 1])
        candidates.push({ kind: "path", at: [ax + ((bx - ax) * s) / len, az + ((bz - az) * s) / len], normal: [(-(bz - az) / len) * side, ((bx - ax) / len) * side] });
  }
  for (let i = 0; i < 220; i++) candidates.push({ kind: "open", at: [(random() * 2 - 1) * (L - 20), (random() * 2 - 1) * (L - 20)] });
  // shuffle so the arena does not fill from one side
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  const usage = new Map();
  let denseLeft = dense;
  for (const spot of candidates) {
    if (placed.length >= maxClusters || quarters().every((d) => d <= maxDead)) break;
    // prefer clusters used least so far, then random order
    const options = pool
      .filter(
        ([, c]) =>
          c.place.includes(spot.kind) ||
          (spot.kind === "open" && c.place.includes("focal")) ||
          (spot.kind === "path" && c.place.includes("open")),
      )
      .filter(([id, c]) => (c.dense ? denseLeft > 0 && !usage.get(id) : (usage.get(id) || 0) < repeat))
      .sort((a, b) => (usage.get(a[0]) || 0) - (usage.get(b[0]) || 0) || random() - 0.5);
    for (const [id, c] of options) {
      const r = c.radius;
      let x, z, rot;
      if (spot.kind === "edge") {
        x = spot.wall[0] + spot.normal[0] * (r + 4);
        z = spot.wall[1] + spot.normal[1] * (r + 4);
        rot = Math.atan2(spot.normal[0], spot.normal[1]);
      } else if (spot.kind === "corner") {
        x = spot.corner[0] * (L - 5 - r);
        z = spot.corner[1] * (L - 5 - r);
        rot = Math.atan2(-spot.corner[0], -spot.corner[1]);
      } else if (spot.kind === "path") {
        x = spot.at[0] + spot.normal[0] * (r + 3);
        z = spot.at[1] + spot.normal[1] * (r + 3);
        rot = Math.atan2(-spot.normal[0], -spot.normal[1]);
      } else {
        [x, z] = spot.at;
        rot = facing(x, z);
      }
      if (!fits(x, z, r)) continue;
      // only where the cluster brings life to empty ground, and only in quarters that still need it
      const q = (x >= 0 ? 1 : 0) + (z >= 0 ? 2 : 0);
      if (quarters()[q] <= maxDead || gain(x, z, r) < 8) continue;
      placed.push({ id, x, z, rot, r, kind: spot.kind });
      cover((cx, cz) => Math.max(0, Math.hypot(cx - x, cz - z) - r));
      usage.set(id, (usage.get(id) || 0) + 1);
      if (c.dense) denseLeft--;
      break;
    }
  }
  // ---- Fill layer: small clumps of single props into the remaining dead cells ----
  const fillList = FILL[plan.theme?.id] || FILL.meadow, // ruins use the meadow fill
    fill = [],
    taken = [];
  const fillFits = (x, z, r) =>
    Math.abs(x) <= L - 3 - r &&
    Math.abs(z) <= L - 3 - r &&
    nearestRoute(x, z).distance >= r + 3 &&
    !rampRects.some((q) => rectDistance(x, z, q) < r + 1.5) &&
    !(plan.skyPlatforms || []).some((q) => rectDistance(x, z, q) < r + 0.5) &&
    !(plan.pit?.w > 0 && rectDistance(x, z, plan.pit) < r + 1.5) &&
    !(plan.moat || []).some((q) => rectDistance(x, z, q) < r + 1.5) &&
    !zoneRects.some((q) => rectDistance(x, z, q) < r + 0.5) &&
    !points.some(([px, pz, pr]) => Math.hypot(x - px, z - pz) < r + pr) &&
    !placed.some((p) => Math.hypot(x - p.x, z - p.z) < r + p.r + 1) &&
    !taken.some(([tx, tz, tr]) => Math.hypot(x - tx, z - tz) < r + tr + 1.2);
  const holes = cells.filter(deadIn);
  for (let i = holes.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [holes[i], holes[j]] = [holes[j], holes[i]];
  }
  for (const h of holes) {
    const dead = quarters();
    if (dead.every((d) => d <= maxDead)) break;
    if (!deadIn(h) || dead[h.q] <= maxDead) continue;
    // a clump of 1–3 props around the hole, odd counts read as natural
    const n = random() < 0.4 ? 1 : 3;
    let added = 0;
    for (let k = 0; k < n * 3 && added < n; k++) {
      const [key, [lo, hi], solid] = fillList[Math.floor(random() * fillList.length)],
        size = lo + random() * (hi - lo),
        r = size / 2,
        x = h.x + (k ? (random() - 0.5) * 5 : 0),
        z = h.z + (k ? (random() - 0.5) * 5 : 0);
      if (!fillFits(x, z, r)) continue;
      fill.push({ key, x, z, size: Math.round(size * 10) / 10, rot: random() * Math.PI * 2, solid });
      taken.push([x, z, r]);
      cover((cx, cz) => Math.max(0, Math.hypot(cx - x, cz - z) - r));
      added++;
    }
  }
  return {
    clusters: placed.map(({ id, x, z, rot, kind, y, scale }) => ({ id, x, z, rot, kind, ...(y !== undefined ? { y } : {}), ...(scale ? { scale } : {}) })),
    fill,
    stats: { before, after: quarters(), cells: cells.length },
  };
}
