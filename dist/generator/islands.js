// «Острова»: a 3 × 3 grid of islands in a deadly ditch (the hill's stake moat).
//   Islands are 52 m squares; channels between them are 12 m wide; the outer band is ditch too.
//   Some channels have narrow wooden bridges (a spanning tree, so every island can be reached on foot,
//   plus one shortcut); every other channel is crossed only by blue jump pads on both banks.
//   The centre island carries a 4 m plateau with two stairs and a spring pad — the high ground everyone wants.
// Level-filling rules (shared with «Лабиринт»): objectives and pickups sit on far islands, the plateau is the
// one strong position, every island has cover from the decorator, bridges are chokepoints, pads are shortcuts.
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

export function generateIslands(seed) {
  const random = seededRandom(seed + "-islands"),
    C = [-64, 0, 64], // island centres along each axis
    HALF = 26, // island half-size
    CH = 12, // channel width
    L = 110;
  const id = (r, c) => "i" + r + c;
  // moat strips: two channels each way, full length, and the outer band
  const moat = [
    ...[-1, 1].map((s) => ({ x: s * 32, z: 0, w: CH, d: 2 * L })),
    ...[-1, 1].map((s) => ({ x: 0, z: s * 32, w: 2 * L, d: CH })),
    ...[-1, 1].map((s) => ({ x: s * 100, z: 0, w: 20, d: 2 * L })),
    ...[-1, 1].map((s) => ({ x: 0, z: s * 100, w: 2 * L, d: 20 })),
  ];

  // links between neighbouring islands: a random spanning tree (+1 shortcut) gets bridges, the rest get pads
  const links = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) {
      if (c < 2) links.push({ a: [r, c], b: [r, c + 1], axis: "x" });
      if (r < 2) links.push({ a: [r, c], b: [r + 1, c], axis: "z" });
    }
  const parent = new Map(),
    root = (k) => {
      while (parent.has(k) && parent.get(k) !== k) k = parent.get(k);
      return k;
    };
  const bridged = [],
    padded = [];
  for (const l of shuffle(random, links)) {
    const ka = id(...l.a),
      kb = id(...l.b),
      ra = root(ka),
      rb = root(kb);
    if (ra !== rb) {
      parent.set(ra, rb);
      bridged.push(l);
    } else padded.push(l);
  }
  // one extra bridge (a second way round), the rest of the channels are pad crossings
  if (padded.length) bridged.push(padded.splice(Math.floor(random() * padded.length), 1)[0]);

  const skyPlatforms = [],
    jumpPads = [],
    coreRoutes = [];
  const centre = ([r, c]) => ({ x: C[c], z: C[r] });
  for (const l of bridged) {
    const A = centre(l.a),
      B = centre(l.b),
      off = (random() * 2 - 1) * 14, // bridges are not all on the centre line
      span = CH + 6;
    if (l.axis === "x") {
      const x = (A.x + B.x) / 2,
        z = A.z + off;
      skyPlatforms.push({ x, z, w: span, d: 5, h: 0, connector: true, bridge: true });
      coreRoutes.push({ role: "main", points: [[A.x, 0, A.z], [x - span / 2, 0, z], [x + span / 2, 0, z], [B.x, 0, B.z]] });
    } else {
      const z = (A.z + B.z) / 2,
        x = A.x + off;
      skyPlatforms.push({ x, z, w: 5, d: span, h: 0, connector: true, bridge: true });
      coreRoutes.push({ role: "main", points: [[A.x, 0, A.z], [x, 0, z - span / 2], [x, 0, z + span / 2], [B.x, 0, B.z]] });
    }
  }
  // pad crossings: a blue pad 4 m from each bank, facing the other island (run onto it towards the channel)
  for (const l of padded) {
    const A = centre(l.a),
      B = centre(l.b),
      off = (random() * 2 - 1) * 10;
    if (l.axis === "x") {
      const z = A.z + off;
      jumpPads.push({ x: A.x + HALF - 4, z, y: 0, role: "transfer", tier: "blue", speed: 7 });
      jumpPads.push({ x: B.x - HALF + 4, z, y: 0, role: "transfer", tier: "blue", speed: 7 });
    } else {
      const x = A.x + off;
      jumpPads.push({ x, z: A.z + HALF - 4, y: 0, role: "transfer", tier: "blue", speed: 7 });
      jumpPads.push({ x, z: B.z - HALF + 4, y: 0, role: "transfer", tier: "blue", speed: 7 });
    }
  }

  // the centre plateau: 4 m high, 22 m square, two stairs on random sides and a spring pad on a third
  const P = 11,
    PH = 4,
    sides = shuffle(random, [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]);
  skyPlatforms.push({ x: 0, z: 0, w: 2 * P, d: 2 * P, h: PH, base: 0, solid: true, node: "plateau" });
  const ramps = [];
  for (const [nx, nz] of sides.slice(0, 2)) {
    const along = (random() * 2 - 1) * 5,
      tx = -nz,
      tz = nx,
      top = { x: nx * P + tx * along, z: nz * P + tz * along },
      bottom = { x: top.x + nx * 8, z: top.z + nz * 8 };
    ramps.push({ x0: bottom.x, z0: bottom.z, x1: top.x, z1: top.z, width: 6, baseHeight: 0, h: PH });
    coreRoutes.push({ role: "stairs", points: [[bottom.x, 0, bottom.z], [top.x, PH, top.z]] });
  }
  {
    const [nx, nz] = sides[2];
    jumpPads.push({ x: nx * (P + 4), z: nz * (P + 4), y: 0, role: "transfer", tier: "springHigh", speed: 4 });
  }
  // low parapet around the plateau, open where the stairs and the spring arrive
  const wallRuns = [];
  for (const [nx, nz] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const a = P - 0.45,
      tx = -nz,
      tz = nx,
      // openings: stairs whose top sits on this side (their offset along the side) and the spring's landing
      open = ramps.filter((r) => (nx ? Math.abs(r.x1 - nx * P) < 0.01 : Math.abs(r.z1 - nz * P) < 0.01)).map((r) => (nx ? r.z1 : r.x1) * (nx ? tz : tx));
    if (sides[2][0] === nx && sides[2][1] === nz) open.push(0);
    let t = -a;
    for (const g of [...open.sort((p, q) => p - q), null]) {
      const g0 = g === null ? a : g - 3.8;
      if (g0 - t > 1.2) wallRuns.push({ x0: nx * a + tx * t, z0: nz * a + tz * t, x1: nx * a + tx * g0, z1: nz * a + tz * g0, y: PH, height: 1.1 });
      if (g !== null) t = g + 3.8;
    }
  }

  // islands: a courtyard template on every island but the centre (empty anchor on the plateau)
  const nodes = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) {
      const mid = r === 1 && c === 1;
      nodes.push({
        id: id(r, c),
        role: mid ? "plateau" : r !== 1 && c !== 1 ? "corner" : "side",
        height: mid ? PH : 0,
        world: mid ? { x: 0, z: 0 } : { x: C[c] + (random() - 0.5) * 8, z: C[r] + (random() - 0.5) * 8 },
        template: mid ? "empty" : pick(random, ["ruins", "courtyard", "quarter", "tower"]),
      });
    }
  const graph = { scheme: "islands", nodes, edges: [] };

  // landmarks: palms and rocks along the island shores, a statue on the plateau
  const landmarks = [{ key: "arena/statue", x: 0, z: 0, size: 3.2, rot: random() * 6.28 }];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      for (let k = 0; k < 3; k++) {
        const side = Math.floor(random() * 4),
          t = (random() * 2 - 1) * (HALF - 6),
          edge = HALF - 3,
          [dx, dz] = [
            [edge, t],
            [-edge, t],
            [t, edge],
            [t, -edge],
          ][side];
        landmarks.push({ key: pick(random, ["nature/tree_palmTall", "nature/rock_largeA", "graveyard/rocks-tall", "nature/tree_default"]), x: C[c] + dx, z: C[r] + dz, size: 3 + random() * 3, rot: random() * 6.28, scatter: true });
      }

  const medkits = nodes.filter((n) => n.role !== "plateau").map((n) => [n.world.x + 7, n.world.z - 7]);
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
    connections: nodes.map((n) => ({ edge: n.id, points: [n.world] })),
    limit: L,
    landmarks,
    wallRuns,
    medkits,
    moat,
    moatBanks: "strips", // banks only where a strip meets ground (channels cross each other)
    traps: 8,
    theme: {
      id: "ruins",
      ground: 0x6f8f4a,
      platform: 0x9a9ca0,
      lights: ["noon", "sunset"],
      fill: { deadDistance: 5, maxDead: 0.2, maxClusters: 40, repeat: 4 },
    },
  };
}
