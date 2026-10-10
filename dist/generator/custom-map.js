// Arena maps as JSON: the bridge between the arena editor and the game.
//   exportMap(plan)   — a generated (or loaded) arena → map JSON (exact: includes the decorator's result)
//   planFromMap(json) — map JSON → a plan the game builds like any generated arena
// Map format "blaster-arena-map" v1 (all coordinates in metres, arena centre 0,0, ±limit):
//   name, biome (desert|meadow|ruins|night), limit (110), fill (true = the decorator fills empty ground)
//   platforms [{ x, z, w, d, h | level (1–3 → 3/6/9 m), base?, solid? (default true), slab? }]
//   stairs    [{ x0, z0, x1, z1, width?, from, to }]          — straight, from height `from` at (x0,z0) up to `to`
//   pads      [{ x, z, y?, tier (spring|springHigh|blue|yellow), speed? }]
//   walls     [{ x0, z0, x1, z1, y?, height }]                 — continuous wall runs
//   zones     [{ template, x, z }]                              — courtyards from zone-templates.js
//   clusters  [{ id, x, z, rot, y? }]                           — catalogue clusters (rot in radians, front = +z)
//   any placed object may carry y: it rests on the first surface at or below that height (platform, ground…)
//   props     [{ key, x, z, size, rot, solid? }]                — single models
//   torches   [{ x, z, kind (torch|brazier), light? }]
//   spawns    [{ x, z, y? }]                                    — enemy spawn points (if any, enemies appear only there)
//   playerStart { x, z }                                       — where the player starts (else a courtyard)
//   light     noon|sunset|overcast|dusk|night                  — time of day (else picked from the biome)
//   medkits   [[x, z]], pit {x,z,w,d,h}, moat [{x,z,w,d}]       — optional
import { BIOMES } from "./biomes.js";
import { applyBiome } from "./arenas.js";

const LEVEL_HEIGHT = [0, 3, 6, 9];
const round = (v) => Math.round(v * 100) / 100;

export function exportMap(plan) {
  const decor = plan.decor || { clusters: [], fill: [] };
  return {
    format: "blaster-arena-map",
    version: 1,
    name: plan.mapName || (plan.typeName ? plan.typeName + " · " + plan.seed : "arena"),
    biome: plan.biome || plan.theme?.id || "meadow",
    limit: plan.limit ?? 110,
    fill: false, // the decorator's result is exported below, so the map loads exactly as it is now
    platforms: (plan.skyPlatforms || []).map((p) => ({
      x: round(p.x), z: round(p.z), w: round(p.w), d: round(p.d), h: p.h,
      ...(p.base ? { base: p.base } : {}),
      ...(p.solid ? {} : { solid: false }),
      ...(p.connector ? { connector: true } : {}),
      ...(p.bridge ? { bridge: true } : {}),
      ...(p.landing ? { landing: true } : {}),
    })),
    stairs: (plan.ramps || []).map((r) => ({ x0: round(r.x0), z0: round(r.z0), x1: round(r.x1), z1: round(r.z1), width: r.width, from: r.baseHeight || 0, to: r.h })),
    pads: (plan.jumpPads || []).map((p) => ({ x: round(p.x), z: round(p.z), y: p.y || 0, tier: p.tier || "blue", speed: p.speed })),
    walls: (plan.wallRuns || []).map((w) => ({ x0: round(w.x0), z0: round(w.z0), x1: round(w.x1), z1: round(w.z1), y: w.y, height: w.height })),
    zones: (plan.zones || []).map((z) => ({ template: z.template, x: round(z.x), z: round(z.z) })),
    clusters: decor.clusters.map((c) => ({ id: c.id, x: round(c.x), z: round(c.z), rot: round(c.rot) })),
    props: [
      ...decor.fill.map((f) => ({ key: f.key, x: round(f.x), z: round(f.z), size: f.size, rot: round(f.rot), solid: f.solid })),
      ...(plan.landmarks || []).map((m) => ({ key: m.key, x: round(m.x), z: round(m.z), size: m.size, rot: round(m.rot || 0), ...(m.collision === false ? { solid: false } : {}), ...(m.tint ? { tint: m.tint } : {}) })),
    ],
    torches: (plan.torches || []).map((t) => ({ x: round(t.x), z: round(t.z), kind: t.kind, light: !!t.light })),
    spawns: (plan.graph?.nodes || []).map((n) => ({ x: round(n.world.x), z: round(n.world.z), y: n.height })),
    medkits: (plan.medkits || []).map(([x, z]) => [round(x), round(z)]),
    ...(plan.pit?.w > 0 ? { pit: plan.pit } : {}),
    ...(plan.moat ? { moat: plan.moat } : {}),
  };
}

export function validateMap(json) {
  const errors = [];
  if (!json || json.format !== "blaster-arena-map") errors.push("это не карта Blaster Arena (нет format: blaster-arena-map)");
  for (const key of ["platforms", "stairs", "pads", "walls", "zones", "clusters", "props", "torches", "spawns"])
    if (json && json[key] !== undefined && !Array.isArray(json[key])) errors.push(key + " должен быть списком");
  if (json?.biome && !BIOMES[json.biome]) errors.push("неизвестный биом " + json.biome);
  return errors;
}

export function planFromMap(json) {
  const limit = json.limit ?? 110,
    skyPlatforms = (json.platforms || []).map((p) => {
      const h = p.h ?? LEVEL_HEIGHT[p.level] ?? 3;
      return {
        x: p.x, z: p.z, w: p.w, d: p.d, h,
        base: p.base ?? 0,
        solid: p.solid !== false && !p.connector && !p.landing && !p.slab,
        ...(p.connector ? { connector: true } : {}),
        ...(p.bridge ? { bridge: true, connector: true } : {}),
        ...(p.landing ? { landing: true } : {}),
      };
    }),
    ramps = (json.stairs || []).map((s) => ({ x0: s.x0, z0: s.z0, x1: s.x1, z1: s.z1, width: s.width ?? 4, baseHeight: s.from ?? 0, h: s.to })),
    zones = (json.zones || []).map((z, i) => ({ id: "m" + i, template: z.template || "plaza", x: z.x, z: z.z }));
  // graph nodes: courtyards, the given spawns, and the centre of every raised platform
  const nodes = [
    ...zones.map((z) => ({ id: z.id, role: "zone", height: 0, world: { x: z.x, z: z.z } })),
    ...(json.spawns || []).map((s, i) => ({ id: "s" + i, role: "spawn", height: s.y ?? 0, world: { x: s.x, z: s.z } })),
    ...skyPlatforms
      .filter((p) => p.h > 0 && p.w >= 4 && p.d >= 4 && !p.landing)
      .map((p, i) => ({ id: "p" + i, role: "platform", height: p.h, world: { x: p.x, z: p.z } })),
  ];
  // drop duplicates (an exported arena lists its courtyards again as spawns)
  for (let i = nodes.length - 1; i > 0; i--)
    if (nodes.slice(0, i).some((n) => Math.abs(n.height - nodes[i].height) < 0.5 && Math.hypot(n.world.x - nodes[i].world.x, n.world.z - nodes[i].world.z) < 3))
      nodes.splice(i, 1);
  // no courtyards: an invisible anchor zone where the player starts (or the first spawn / platform)
  if (!zones.length) {
    const at = json.playerStart || (nodes[0] && nodes[0].world) || { x: 0, z: 0 };
    zones.push({ id: "m0", template: "empty", x: at.x, z: at.z });
    nodes.unshift({ id: "m0", role: "zone", height: 0, world: { x: at.x, z: at.z } });
  }
  // routes the decorator and the ground painter keep clear: every stair, and a minimal tree joining ground nodes
  const coreRoutes = ramps.map((r) => ({ role: "stairs", points: [[r.x0, r.baseHeight, r.z0], [r.x1, r.h, r.z1]] })),
    ground = [...nodes.filter((n) => n.height === 0).map((n) => n.world), ...ramps.filter((r) => !r.baseHeight).map((r) => ({ x: r.x0, z: r.z0 }))],
    linked = ground.length ? [ground[0]] : [],
    rest = ground.slice(1);
  while (rest.length) {
    let best = null;
    for (const a of linked)
      for (const b of rest) {
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (!best || d < best.d) best = { a, b, d };
      }
    coreRoutes.push({ role: "main", points: [[best.a.x, 0, best.a.z], [best.b.x, 0, best.b.z]] });
    linked.push(best.b);
    rest.splice(rest.indexOf(best.b), 1);
  }
  const plan = {
    seed: String(json.name || "custom"),
    mapName: json.name || "Своя карта",
    custom: true,
    type: "custom",
    typeName: "Своя карта",
    graph: { scheme: "custom", nodes, edges: [] },
    zones,
    platforms: [],
    skyPlatforms,
    ramps,
    jumpPads: (json.pads || []).map((p) => ({ x: p.x, z: p.z, y: p.y ?? 0, role: "transfer", tier: p.tier || "blue", speed: p.speed ?? 6, vertical: 18 })),
    coreRoutes,
    connections: nodes.map((n) => ({ edge: n.id, points: [n.world] })),
    limit,
    landmarks: (json.props || []).map((m) => ({ key: m.key, x: m.x, z: m.z, size: m.size ?? 2, rot: m.rot ?? 0, ...(m.y !== undefined ? { y: m.y } : {}), ...(m.solid === false ? { collision: false } : {}), ...(m.tint ? { tint: m.tint } : {}), scatter: true })),
    wallRuns: (json.walls || []).map((w) => ({ x0: w.x0, z0: w.z0, x1: w.x1, z1: w.z1, y: w.y ?? 0, height: w.height ?? 1.2 })),
    medkits: json.medkits || zones.filter((z) => z.template !== "empty").map((z) => [z.x + 6, z.z + 6]),
    theme: { id: json.biome || "meadow", fill: { deadDistance: 6, maxDead: 0.25, maxClusters: 30, repeat: 3 } },
    ...(json.pit ? { pit: json.pit } : {}),
    ...(json.moat ? { moat: json.moat } : {}),
    ...(json.torches?.length ? { torches: json.torches } : {}),
  };
  applyBiome(plan, BIOMES[json.biome] ? json.biome : "meadow");
  if (json.light) plan.theme.lights = [json.light]; // time of day chosen in the editor
  if (json.playerStart) plan.playerStart = json.playerStart;
  if (json.spawns?.length) plan.enemySpawns = json.spawns.map((s) => ({ x: s.x, z: s.z }));
  if (json.torches?.length) plan.torches = json.torches; // explicit torches win over the biome's own rule
  const clusters = (json.clusters || []).map((c) => ({ id: c.id, x: c.x, z: c.z, rot: c.rot ?? 0, kind: "fixed", ...(c.y !== undefined ? { y: c.y } : {}), ...(c.scale ? { scale: c.scale } : {}) }));
  if (json.fill) plan.fixedClusters = clusters; // the decorator adds more around them
  else plan.decor = { clusters, fill: [], stats: null }; // exactly what the map says
  return plan;
}
