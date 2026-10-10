// «Царь горы»: a stepped citadel hill in the middle of old ruins.
//   three solid terraces (3, 6, 9 m), each smaller than the one below; the top is the prize;
//   2–4 stairs from the ground onto the first terrace, 2 onto the second, 1–2 onto the top (sides chosen by seed);
//   spring pads lift onto the first terrace where there is no stair, a blue pad on the first terrace reaches the top;
//   continuous parapets / battlements on every terrace edge, open only at stair landings;
//   four courtyards in the corners plus 1–2 at the sides, a ring road around the hill.
// Canonical frame first, one seeded orientation at the end (same convention as the other generators).
import { seededRandom } from "./world.js";

const pick = (random, list) => list[Math.floor(random() * list.length)];
const shuffle = (random, list) => {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
// sides as unit normals: east, west, south, north
const SIDES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function generateHill(seed) {
  const random = seededRandom(seed + "-hill"),
    a1 = 30 + Math.floor(random() * 3) * 2, // half-size of terrace 1 (30..34)
    // each ring is 11 m wide: a 7 m stair, the wall on the edge and room to walk past both
    a2 = a1 - 11,
    a3 = a2 - 11,
    heights = [3, 6, 15], // the summit tower is three times taller than a terrace step (9 m above terrace 2)
    halves = [a1, a2, a3],
    STAIR = 7, // stair run (rise 3 m over 7 m)
    MOAT_IN = a1 + 10, // moat: a water ring outside the stair feet and spring pads
    MOAT_OUT = a1 + 16,
    ring = a1 + 40; // ring road through the courtyards; the siege camp sits between moat and road

  const skyPlatforms = halves.map((a, i) => ({
    x: 0,
    z: 0,
    w: a * 2,
    d: a * 2,
    h: heights[i],
    base: i ? heights[i - 1] : 0,
    solid: true,
    node: "u" + i,
  }));
  const ramps = [],
    coreRoutes = [],
    landings = [[], [], []]; // stair tops per terrace edge: { side, along }
  // a stair from level `lvl` (0 = ground) up onto terrace `lvl`, on `side`, offset `along` the edge
  const stair = (lvl, [nx, nz], along) => {
    const a = halves[lvl],
      // tangent along the edge
      tx = -nz,
      tz = nx,
      top = { x: nx * a + tx * along, z: nz * a + tz * along },
      bottom = { x: top.x + nx * STAIR, z: top.z + nz * STAIR },
      base = lvl ? heights[lvl - 1] : 0;
    ramps.push({ x0: bottom.x, z0: bottom.z, x1: top.x, z1: top.z, width: 6, baseHeight: base, h: heights[lvl] });
    coreRoutes.push({ role: "stairs", points: [[bottom.x, base, bottom.z], [top.x, heights[lvl], top.z]] });
    landings[lvl].push({ n: [nx, nz], along });
    return bottom;
  };
  const sides = shuffle(random, SIDES),
    groundStairs = 2 + Math.floor(random() * 3), // 2..4
    feet = [];
  for (let i = 0; i < groundStairs; i++) {
    const along = (random() * 2 - 1) * (a1 - 8);
    feet.push(stair(0, sides[i], along));
  }
  for (const side of shuffle(random, SIDES).slice(0, 2)) stair(1, side, (random() * 2 - 1) * (a2 - 6));
  // summit tower (9 m above terrace 2): a switchback-free double flight along one or two tower faces —
  // flight, 3 m landing, flight — running beside the wall and ending level with the top, where the parapet opens
  const towerFlights = [];
  for (const [nx, nz] of shuffle(random, SIDES).slice(0, 1 + Math.floor(random() * 2))) {
    const tx = -nz,
      tz = nx,
      lane = a3 + 3, // stair centre line, 3 m out from the tower face
      end = a3 - 4, // where the climb ends: beside the tower face, clear of the corner parapets
      start = end - 18,
      at = (t) => ({ x: nx * lane + tx * t, z: nz * lane + tz * t }),
      p0 = at(start),
      p1 = at(start + 7.5),
      p2 = at(start + 10.5),
      p3 = at(end);
    ramps.push({ x0: p0.x, z0: p0.z, x1: p1.x, z1: p1.z, width: 6, baseHeight: heights[1], h: 10.5 });
    ramps.push({ x0: p2.x, z0: p2.z, x1: p3.x, z1: p3.z, width: 6, baseHeight: 10.5, h: heights[2] });
    const mid = at(start + 9);
    // the landing is a slab (walkable from both flights), not a solid block: a block's side would stop the last treads
    skyPlatforms.push({ x: mid.x, z: mid.z, w: nx ? 6 : 3, d: nx ? 3 : 6, h: 10.5, landing: true });
    // top landing: 3 m past the last tread, in the stair's own lane, flush against the tower face at the
    // tower's height — the climb ends on a floor that steps straight onto the tower top through the parapet opening
    const topMid = at(end + 1.5);
    skyPlatforms.push({
      x: topMid.x,
      z: topMid.z,
      w: nx ? 6 : 3,
      d: nx ? 3 : 6,
      h: heights[2],
      landing: true,
    });
    coreRoutes.push({ role: "stairs", points: [[p0.x, heights[1], p0.z], [p1.x, 10.5, p1.z], [p2.x, 10.5, p2.z], [p3.x, heights[2], p3.z]] });
    landings[2].push({ n: [nx, nz], along: end - 2, wide: true });
    towerFlights.push({ n: [nx, nz], start, end });
  }

  // spring pads on the ground in front of stair-less sides; one blue pad on terrace 1 towards the top
  const jumpPads = [];
  for (const [nx, nz] of sides.slice(groundStairs)) {
    jumpPads.push({ x: nx * (a1 + 4), z: nz * (a1 + 4), y: 0, role: "transfer", tier: "springHigh", speed: 6, vertical: 14 });
    landings[0].push({ n: [nx, nz], along: 0 }); // the parapet opens where the spring throws you onto the terrace
  }
  {
    // blue pad on terrace 1, on a side without a terrace-2 stair, in the middle of the ring
    const free = SIDES.find(([nx, nz]) => !landings[1].some((l) => l.n[0] === nx && l.n[1] === nz)) || SIDES[0],
      d = (a1 + a2) / 2;
    jumpPads.push({ x: free[0] * d, z: free[1] * d, y: heights[0], role: "transfer", tier: "blue", speed: 4, vertical: 21 });
  }

  // a free spot on the ring of a terrace (between its edge `outer` and the next terrace `inner`):
  // clear of every stair (with its landing) and every pad, used for the graph node of that level
  const ringSpot = (outer, inner) => {
    const mid = (outer + inner) / 2;
    for (const t of [0, 0.5, -0.5, 0.8, -0.8, 0.25, -0.25])
      for (const [nx, nz] of SIDES) {
        const x = nx * mid - nz * t * mid,
          z = nz * mid + nx * t * mid,
          clear =
            ramps.every((r) => {
              const cx = Math.max(Math.min(x, Math.max(r.x0, r.x1)), Math.min(r.x0, r.x1)),
                cz = Math.max(Math.min(z, Math.max(r.z0, r.z1)), Math.min(r.z0, r.z1));
              return Math.hypot(x - cx, z - cz) > r.width / 2 + 3;
            }) && jumpPads.every((p) => Math.hypot(x - p.x, z - p.z) > 4);
        if (clear) return { x, z };
      }
    return { x: mid, z: mid };
  };
  // zones: four corners and 1–2 side courtyards (sides opposite to each other look best)
  const C = 72,
    zoneSpots = [
      ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ x: sx * C, z: sz * C, role: "corner" }))),
      ...shuffle(random, SIDES)
        .slice(0, 1 + Math.floor(random() * 2))
        .map(([nx, nz]) => ({ x: nx * 74, z: nz * 74, role: "side" })),
    ],
    nodes = zoneSpots.map((p, i) => ({
      id: "m" + i,
      role: p.role,
      height: 0,
      world: { x: p.x, z: p.z },
      template: pick(random, p.role === "corner" ? ["ruins", "courtyard", "quarter"] : ["tower", "courtyard", "ruins"]),
    }));
  const graph = {
    scheme: "hill",
    nodes: [
      ...nodes,
      { id: "u0", role: "terrace-1", height: heights[0], world: ringSpot(a1, a2) },
      { id: "u1", role: "terrace-2", height: heights[1], world: ringSpot(a2, a3) },
      { id: "u2", role: "summit", height: heights[2], world: { x: 0, z: 0 } },
    ],
    edges: [],
  };
  // ring road and spokes from every courtyard and every stair foot onto it
  const ringPts = [
    [-ring, 0, -ring],
    [ring, 0, -ring],
    [ring, 0, ring],
    [-ring, 0, ring],
    [-ring, 0, -ring],
  ];
  coreRoutes.push({ role: "main", points: ringPts });
  // moat: four water strips around the hill (north/south full width, east/west between them)
  const moat = [
    { x: 0, z: -(MOAT_IN + MOAT_OUT) / 2, w: MOAT_OUT * 2, d: MOAT_OUT - MOAT_IN },
    { x: 0, z: (MOAT_IN + MOAT_OUT) / 2, w: MOAT_OUT * 2, d: MOAT_OUT - MOAT_IN },
    { x: -(MOAT_IN + MOAT_OUT) / 2, z: 0, w: MOAT_OUT - MOAT_IN, d: MOAT_IN * 2 },
    { x: (MOAT_IN + MOAT_OUT) / 2, z: 0, w: MOAT_OUT - MOAT_IN, d: MOAT_IN * 2 },
  ];
  // four bridges across the moat, one in the middle of every side; road from the ring to each bridge
  const inner = a1 + 5; // walkway between the hill and the moat
  for (const [nx, nz] of SIDES) {
    const mid = (MOAT_IN + MOAT_OUT) / 2,
      span = MOAT_OUT - MOAT_IN + 4;
    skyPlatforms.push({ x: nx * mid, z: nz * mid, w: nx ? span : 6, d: nx ? 6 : span, h: 0, connector: true, bridge: true });
    coreRoutes.push({ role: "main", points: [[nx * ring, 0, nz * ring], [nx * inner, 0, nz * inner]] });
  }
  coreRoutes.push({ role: "main", points: [[-inner, 0, -inner], [inner, 0, -inner], [inner, 0, inner], [-inner, 0, inner], [-inner, 0, -inner]] });
  for (const f of feet) coreRoutes.push({ role: "main", points: [[f.x, 0, f.z], [Math.sign(f.x) * Math.min(Math.abs(f.x), inner) || f.x, 0, Math.sign(f.z) * Math.min(Math.abs(f.z), inner) || f.z]] });
  // siege camp between moat and ring road: eight spots on the diagonals' sides, every one facing the citadel
  const siegeIds = shuffle(random, ["trebuchet", "ballistaNest", "siegeTowerRam", "powderStore", "ruinedWall", "siege", "powderStore", "ruinedWall"]),
    siegeR = (MOAT_OUT + ring) / 2,
    fixedClusters = [];
  for (let k = 0; k < 8; k++) {
    const ang = Math.PI / 8 + (k * Math.PI) / 4,
      x = Math.cos(ang) * siegeR,
      z = Math.sin(ang) * siegeR;
    fixedClusters.push({ id: siegeIds[k], x, z, rot: Math.atan2(-x, -z) });
  }

  // continuous walls on every terrace edge, open where a stair arrives
  const wallRuns = [],
    inset = 0.45,
    wallHeight = [1.1, 1.8, 1.2];
  for (let lvl = 0; lvl < 3; lvl++) {
    const a = halves[lvl] - inset;
    for (const [nx, nz] of SIDES) {
      const tx = -nz,
        tz = nx,
        gaps = landings[lvl].filter((l) => l.n[0] === nx && l.n[1] === nz).map((l) => (l.wide ? [l.along - 5, l.along + 5] : [l.along - 3.6, l.along + 3.6]));
      // the blue pad on terrace 1 needs open sky, not a wall: no change at the edge
      let t = -a;
      for (const [g0, g1] of [...gaps.sort((p, q) => p[0] - q[0]), [a, a]]) {
        if (g0 - t > 1.2)
          wallRuns.push({
            x0: nx * a + tx * t,
            z0: nz * a + tz * t,
            x1: nx * a + tx * g0,
            z1: nz * a + tz * g0,
            y: heights[lvl],
            height: wallHeight[lvl],
          });
        t = Math.max(t, g1);
      }
    }
  }

  // landmarks: corner towers on terrace 1, banners on terrace 2, siege machines below, ruined columns
  const landmarks = [];
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      landmarks.push({ key: "castle/tower-square-base", x: sx * (a1 - 3), z: sz * (a1 - 3), size: 4.5, rot: 0 });
      landmarks.push({ key: "castle/flag-banner-long", x: sx * (a2 - 2.5), z: sz * (a2 - 2.5), size: 3.4, collision: false });
    }
  landmarks.push({ key: "castle/flag-wide", x: 0, z: -(a3 - 2), size: 4, collision: false });
  for (let i = 0; i < 10; i++) {
    const ang = random() * Math.PI * 2,
      r = ring + 8 + random() * 14;
    landmarks.push({ key: pick(random, ["arena/column-damaged", "graveyard/rocks-tall", "castle/rocks-large"]), x: Math.cos(ang) * r, z: Math.sin(ang) * r, size: 3 + random() * 2.5, rot: random() * 6.28, scatter: true });
  }
  for (let i = 0; i < 24; i++) {
    const t = random() * 2 - 1,
      band = 98 + random() * 6,
      onX = random() < 0.5,
      sign = random() < 0.5 ? -1 : 1;
    landmarks.push({ key: pick(random, ["nature/tree_pineTallA", "nature/tree_default", "nature/rock_largeA"]), x: onX ? sign * band : t * 100, z: onX ? t * 100 : sign * band, size: 4 + random() * 4, rot: random() * 6.28, scatter: true });
  }

  const medkits = [...nodes.map((n) => [n.world.x + 6, n.world.z + 6]), [(a1 + a2) / 2, 4], [0, -(a3 - 2.5)]];
  const connections = graph.nodes.map((n) => ({ edge: n.id, points: [n.world] }));

  const orient = { swap: random() < 0.5, fx: random() < 0.5 ? -1 : 1, fz: random() < 0.5 ? -1 : 1 },
    o = (x, z) => {
      const p = x * orient.fx,
        q = z * orient.fz;
      return orient.swap ? [q, p] : [p, q];
    },
    point = (q) => {
      const [x, z] = o(q.x, q.z);
      return { ...q, x, z };
    },
    box = (r) => {
      const [x, z] = o(r.x, r.z);
      return orient.swap ? { ...r, x, z, w: r.d, d: r.w } : { ...r, x, z };
    };
  graph.nodes.forEach((n) => (n.world = point(n.world)));
  return {
    seed: String(seed),
    graph,
    orient,
    zones: nodes.map((n) => ({ id: n.id, template: n.template, x: n.world.x, z: n.world.z })),
    platforms: [],
    skyPlatforms: skyPlatforms.map(box),
    ramps: ramps.map((r) => {
      const [x0, z0] = o(r.x0, r.z0),
        [x1, z1] = o(r.x1, r.z1);
      return { ...r, x0, z0, x1, z1 };
    }),
    jumpPads: jumpPads.map(point),
    coreRoutes: coreRoutes.map((r) => ({
      ...r,
      points: r.points.map(([x, h, z]) => {
        const [p, q] = o(x, z);
        return [p, h, q];
      }),
    })),
    connections: connections.map((c) => ({ ...c, points: c.points.map(point) })),
    limit: 110,
    landmarks: landmarks.map((m) => ({ ...point(m), rot: m.rot })),
    wallRuns: wallRuns.map((r) => {
      const [x0, z0] = o(r.x0, r.z0),
        [x1, z1] = o(r.x1, r.z1);
      return { ...r, x0, z0, x1, z1 };
    }),
    medkits: medkits.map(([x, z]) => o(x, z)),
    moat: moat.map(box),
    fixedClusters: fixedClusters.map((c) => {
      const [x, z] = o(c.x, c.z);
      return { ...c, x, z, rot: Math.atan2(-x, -z) };
    }),
    theme: {
      id: "ruins",
      ground: 0x7d8a5a,
      platform: 0x8e9095,
      lights: ["sunset", "noon"],
      fill: { deadDistance: 6, maxDead: 0.25, maxClusters: 36, repeat: 4 },
    },
  };
}
