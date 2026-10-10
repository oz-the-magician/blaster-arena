// «Амфитеатр» (night): a round bowl. A flat fighting floor in the middle, three stepped stands around it
// (2, 4, 6 m), built from axis-aligned stone blocks rasterised on a 4 m grid — round from a distance,
// stepped up close. Stairs run radially on the four cardinal axes (the only places where the raster edge is
// straight): 2–4 from the floor onto stand 1, 2–4 between stands, 2–4 from outside up the back of stand 3.
// Torches ring the top stand and braziers stand on the floor; courtyards sit in the corners outside.
import { seededRandom } from "./world.js";

const CELL = 4,
  L = 110;
const pick = (random, list) => list[Math.floor(random() * list.length)];
const shuffle = (random, list) => {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const SIDES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function generateAmphitheatre(seed) {
  const random = seededRandom(seed + "-amph"),
    R1 = 26 + Math.floor(random() * 3) * 2, // floor radius = inner edge of stand 1 (26..30)
    BAND = 8, // stand depth
    radii = [R1, R1 + BAND, R1 + 2 * BAND, R1 + 3 * BAND], // stand i spans radii[i]..radii[i+1]
    heights = [2, 4, 6];
  const centres = [];
  for (let c = -L + CELL / 2; c < L; c += CELL) centres.push(c);
  const tierOf = (x, z) => {
    const r = Math.hypot(x, z);
    for (let i = 0; i < 3; i++) if (r >= radii[i] && r < radii[i + 1]) return i;
    return -1;
  };

  // stands: one solid block per horizontal run of cells of the same stand
  const skyPlatforms = [];
  for (const z of centres)
    for (let i = 0; i < 3; i++) {
      let run = null;
      for (const x of [...centres, Infinity]) {
        const inside = x !== Infinity && tierOf(x, z) === i;
        if (inside && !run) run = { x0: x - CELL / 2 };
        if (!inside && run) {
          const x1 = x - CELL / 2;
          skyPlatforms.push({ x: (run.x0 + x1) / 2, z, w: x1 - run.x0, d: CELL, h: heights[i], base: 0, solid: true, stand: i });
          run = null;
        }
      }
    }

  // cell centres are multiples of 4 (−108 … 108), so the row z = 0 lies on the axis: stairs run inside that
  // one 4 m row, where the stand edge is straight. Edges of each stand along the axis:
  const innerEdge = (tier) => {
    let c = 0;
    while (tierOf(c, 0) !== tier) c += CELL;
    return c - CELL / 2;
  };
  const outerEdge = (tier) => {
    let c = 0;
    while (tierOf(c, 0) !== tier) c += CELL;
    while (tierOf(c + CELL, 0) === tier) c += CELL;
    return c + CELL / 2;
  };
  const ramps = [],
    coreRoutes = [],
    outerTops = [];
  const radialStair = ([nx, nz], from, to, base, h) => {
    ramps.push({ x0: nx * from, z0: nz * from, x1: nx * to, z1: nz * to, width: 4, baseHeight: base, h });
    coreRoutes.push({ role: "stairs", points: [[nx * from, base, nz * from], [nx * to, h, nz * to]] });
  };
  const count = () => 2 + Math.floor(random() * 3);
  // floor → stand 1 (stair on the floor, 5 m long, rising 2 m: the last tread must be deeper than a body
  // radius, or the block side next to it blocks the top step)
  for (const side of shuffle(random, SIDES).slice(0, count())) radialStair(side, innerEdge(0) - 5, innerEdge(0), 0, heights[0]);
  // stand 1 → 2, stand 2 → 3 (stairs on the lower stand)
  for (let t = 1; t < 3; t++)
    for (const side of shuffle(random, SIDES).slice(0, count())) radialStair(side, innerEdge(t) - 5, innerEdge(t), heights[t - 1], heights[t]);
  // outside → top of stand 3, up the back (10 m long, rising 6 m)
  const back = outerEdge(2);
  for (const side of shuffle(random, SIDES).slice(0, count())) {
    radialStair(side, back + 10, back, 0, heights[2]);
    outerTops.push(side);
  }

  // parapet along the outer rim of the top stand: unit cell edges facing outside, merged into runs,
  // left open where an outer stair arrives
  const segs = [];
  for (const x of centres)
    for (const z of centres) {
      if (tierOf(x, z) !== 2) continue;
      for (const [dx, dz] of SIDES) {
        if (tierOf(x + dx * CELL, z + dz * CELL) !== -1 || Math.hypot(x + dx * CELL, z + dz * CELL) < radii[2]) continue;
        const ex = x + (dx * CELL) / 2,
          ez = z + (dz * CELL) / 2,
          nearStair = outerTops.some(([nx, nz]) => Math.hypot(ex - nx * back, ez - nz * back) < 5.5);
        if (nearStair) continue;
        // inset 0.45 m from the rim
        const ix = ex - dx * 0.45,
          iz = ez - dz * 0.45;
        segs.push(dx ? { x0: ix, z0: z - CELL / 2, x1: ix, z1: z + CELL / 2 } : { x0: x - CELL / 2, z0: iz, x1: x + CELL / 2, z1: iz });
      }
    }
  // merge collinear neighbours
  const key = (s) => (s.x0 === s.x1 ? "x" + s.x0 : "z" + s.z0);
  const lines = new Map();
  for (const s of segs) (lines.get(key(s)) || lines.set(key(s), []).get(key(s))).push(s);
  const wallRuns = [];
  for (const [k, list] of lines) {
    const vertical = k[0] === "x";
    list.sort((a, b) => (vertical ? a.z0 - b.z0 : a.x0 - b.x0));
    let cur = { ...list[0] };
    for (const s of list.slice(1)) {
      if (vertical ? Math.abs(s.z0 - cur.z1) < 0.01 : Math.abs(s.x0 - cur.x1) < 0.01) {
        cur.x1 = s.x1;
        cur.z1 = s.z1;
      } else {
        wallRuns.push({ ...cur, y: heights[2], height: 1.2 });
        cur = { ...s };
      }
    }
    wallRuns.push({ ...cur, y: heights[2], height: 1.2 });
  }

  // jump pads: springs on the floor at the diagonals, onto stand 1
  const jumpPads = [];
  for (const [sx, sz] of shuffle(random, [[1, 1], [-1, 1], [1, -1], [-1, -1]]).slice(0, 2 + Math.floor(random() * 2))) {
    const r = R1 - 4;
    jumpPads.push({ x: (sx * r) / Math.SQRT2, z: (sz * r) / Math.SQRT2, y: 0, role: "transfer", tier: "spring", speed: 5, vertical: 11 });
  }

  // courtyards outside, in the corners; graph nodes on each stand at a diagonal
  const C = 80,
    nodes = [-1, 1].flatMap((sx) =>
      [-1, 1].map((sz, i) => ({
        id: "m" + (sx < 0 ? i : i + 2),
        role: "corner",
        height: 0,
        world: { x: sx * C, z: sz * C },
        template: pick(random, ["ruins", "courtyard", "quarter", "tower"]),
      })),
    );
  // a cell centre on the stand's diagonal, well inside the stand
  const standNode = (t) => {
    const r = (radii[t] + radii[t + 1]) / 2;
    let x = Math.round(r / Math.SQRT2 / CELL) * CELL;
    for (const dx of [0, CELL, -CELL, 2 * CELL, -2 * CELL]) if (tierOf(x + dx, -(x + dx)) === t) return { x: x + dx, z: -(x + dx) };
    return { x, z: -x };
  };
  const graph = {
    scheme: "amphitheatre",
    nodes: [
      ...nodes,
      { id: "f0", role: "floor", height: 0, world: { x: 0, z: 0 } },
      ...[0, 1, 2].map((t) => ({ id: "u" + t, role: "stand-" + (t + 1), height: heights[t], world: standNode(t) })),
    ],
    edges: [],
  };

  // routes: a square road through the courtyards, spokes to the outer stairs, a cross on the floor
  const ring = C;
  coreRoutes.push({ role: "main", points: [[-ring, 0, -ring], [ring, 0, -ring], [ring, 0, ring], [-ring, 0, ring], [-ring, 0, -ring]] });
  for (const [nx, nz] of outerTops) coreRoutes.push({ role: "main", points: [[nx * (back + 10), 0, nz * (back + 10)], [nx * ring, 0, nz * ring]] });
  const floorEdge = innerEdge(0) - 5;
  coreRoutes.push({ role: "main", points: [[-floorEdge, 0, 0], [floorEdge, 0, 0]] });
  coreRoutes.push({ role: "main", points: [[0, 0, -floorEdge], [0, 0, floorEdge]] });

  // torches on the top stand every 30°, braziers on the floor, banners and cover on the fighting floor
  const torches = [];
  for (let k = 0; k < 12; k++) {
    // middle of the top stand, offset 7.5° from the banners so they never share a spot
    const a = (k * Math.PI) / 6 + Math.PI / 24,
      r = (radii[2] + radii[3]) / 2 + 0.5;
    torches.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, kind: "torch", light: k % 2 === 0 });
  }
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + Math.PI / 4,
      r = R1 * 0.42;
    torches.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, kind: "brazier", light: true });
  }
  const landmarks = [];
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4 + Math.PI / 8 + (random() - 0.5) * 0.3,
      r = R1 * (0.55 + random() * 0.2);
    landmarks.push({ key: pick(random, ["arena/column-damaged", "arena/statue", "guns/crate-wide", "castle/rocks-large"]), x: Math.cos(a) * r, z: Math.sin(a) * r, size: 2.6 + random() * 1.6, rot: random() * 6.28, scatter: true });
  }
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4,
      r = (radii[2] + radii[3]) / 2 + 1.5;
    landmarks.push({ key: "arena/banner", x: Math.cos(a) * r, z: Math.sin(a) * r, size: 3.4, rot: -a + Math.PI / 2, tint: k % 2 ? 0x8a2a2a : 0xc9a24a, collision: false, scatter: true });
  }
  for (let i = 0; i < 24; i++) {
    const t = random() * 2 - 1,
      band = 98 + random() * 6,
      onX = random() < 0.5,
      sign = random() < 0.5 ? -1 : 1;
    landmarks.push({ key: pick(random, ["nature/tree_pineTallA", "nature/rock_largeA", "graveyard/rocks-tall"]), x: onX ? sign * band : t * 100, z: onX ? t * 100 : sign * band, size: 4 + random() * 4, rot: random() * 6.28, scatter: true });
  }

  const medkits = [...nodes.map((n) => [n.world.x + 6, n.world.z + 6]), [6, 0], [-standNode(2).x, standNode(2).x]];
  return {
    seed: String(seed),
    graph,
    orient: { swap: false, fx: 1, fz: 1 },
    zones: nodes.map((n) => ({ id: n.id, template: n.template, x: n.world.x, z: n.world.z })),
    platforms: [],
    skyPlatforms,
    ramps,
    jumpPads,
    coreRoutes,
    connections: graph.nodes.map((n) => ({ edge: n.id, points: [n.world] })),
    limit: L,
    landmarks,
    wallRuns,
    torches,
    medkits,
    theme: {
      id: "night",
      ground: 0x5e5546,
      platform: 0x6c6a72,
      lights: ["night"],
      fill: { deadDistance: 6, maxDead: 0.25, maxClusters: 34, repeat: 4 },
    },
  };
}
