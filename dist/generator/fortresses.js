// «Две крепости»: two mirrored keeps on a meadow, three lanes between them.
//   upper lane  — keep → bridge → central bastion → bridge → keep (all at keep height);
//   flank lanes — ground lanes along both long sides, each with a contested zone at its middle.
// Canonical frame: keeps sit on the x axis; one seeded orientation is applied at the end.
import { seededRandom } from "./world.js";

const STEP = 2;
const pick = (random, list) => list[Math.floor(random() * list.length)];
const stepped = (random, min, count) => min + Math.floor(random() * count) * STEP;

export function generateFortresses(seed) {
  const random = seededRandom(seed + "-fort"),
    H = 6, // keep, bridges and bastion share one height so the upper lane is continuous
    keepX = stepped(random, 62, 5), // keep centre distance from the middle (62..70)
    keepW = 22,
    keepD = stepped(random, 26, 4), // 26..32
    inner = keepX - keepW / 2, // inner keep edge, faces the centre
    outer = keepX + keepW / 2,
    centre = stepped(random, 16, 4) / 2, // bastion half-size (8..11)
    laneZ = stepped(random, 58, 5), // flank lanes (58..66)
    stairZ = keepD / 2 - 4, // keep stairs land inside the keep footprint
    bridgeW = 5,
    padOffset = centre + 9 + Math.floor(random() * 3) * 2;

  // Graph: m = ground zones (flank corners and lane middles), u = keep, bastion, keep.
  const cornerTemplates = ["courtyard", "quarter", "ruins"],
    middleTemplates = ["plaza", "terraces", "courtyard"],
    nodes = [
      ...[-1, 1].flatMap((side) => [-1, 1].map((zs) => ({ x: side * (keepX + 4), z: zs * laneZ, kind: "corner" }))),
      ...[-1, 1].map((zs) => ({ x: 0, z: zs * laneZ, kind: "middle" })),
    ].map((p, i) => ({
      id: "m" + i,
      role: p.kind,
      height: 0,
      world: { x: p.x, z: p.z },
      template: pick(random, p.kind === "corner" ? cornerTemplates : middleTemplates),
    }));
  // Mirror templates so both sides of the map play alike.
  nodes[2].template = nodes[0].template;
  nodes[3].template = nodes[1].template;
  const upper = [
    { id: "u0", role: "keep-west", height: H, world: { x: -keepX, z: 0 } },
    { id: "u1", role: "bastion", height: H, world: { x: 0, z: 0 } },
    { id: "u2", role: "keep-east", height: H, world: { x: keepX, z: 0 } },
  ];
  const graph = { scheme: "fortresses", nodes: [...nodes, ...upper], edges: [] };

  const skyPlatforms = [
      { x: -keepX, z: 0, w: keepW, d: keepD, h: H, node: "u0", keep: "west" },
      { x: keepX, z: 0, w: keepW, d: keepD, h: H, node: "u2", keep: "east" },
      { x: 0, z: 0, w: centre * 2, d: centre * 2, h: H, node: "u1" },
      ...[-1, 1].map((side) => ({
        x: (side * (inner + centre)) / 2,
        z: 0,
        w: inner - centre,
        d: bridgeW,
        h: H,
        connector: true,
      })),
    ],
    ramps = [],
    coreRoutes = [],
    connections = [];
  const stair = (x0, z0, x1, z1, width = 6) => {
    ramps.push({ x0, z0, x1, z1, width, baseHeight: 0, h: H });
    coreRoutes.push({ role: "stairs", points: [[x0, 0, z0], [x1, H, z1]] });
  };
  for (const side of [-1, 1]) {
    // two front stairs into each keep, one back stair for a quiet retreat
    for (const zs of [-1, 1]) stair(side * (inner - 14), zs * stairZ, side * inner, zs * stairZ);
    stair(side * (outer + 14), 0, side * outer, 0);
    // bastion stairs come up from the flank-lane side
    stair(0, side * (centre + 14), 0, side * centre);
    coreRoutes.push({ role: "upper", points: [[side * inner, H, 0], [side * centre, H, 0]] });
  }
  for (const zs of [-1, 1]) {
    coreRoutes.push({ role: "main", points: [[-keepX - 4, 0, zs * laneZ], [keepX + 4, 0, zs * laneZ]] });
    // each keep's front stair joins the flank lane
    for (const side of [-1, 1])
      coreRoutes.push({
        role: "main",
        points: [[side * (inner - 14), 0, zs * stairZ], [side * (inner - 14), 0, zs * laneZ]],
      });
    coreRoutes.push({ role: "main", points: [[0, 0, zs * (centre + 14)], [0, 0, zs * laneZ]] });
  }
  for (const n of graph.nodes) connections.push({ edge: n.id, points: [n.world] });

  const jumpPads = [-1, 1].flatMap((sx) =>
    [-1, 1].map((sz) => ({ x: sx * padOffset, z: sz * padOffset, y: 0, role: "flank", tier: "blue", speed: 9, vertical: 19.5 })),
  );

  // Team colours and decoration. Every landmark is a prop; `tint` recolours it, `collision` false keeps it decorative.
  const RED = 0xc8463a,
    BLUE = 0x3d6fd0,
    landmarks = [];
  for (const side of [-1, 1]) {
    const team = side < 0 ? RED : BLUE,
      kx = side * keepX;
    // corner flags on the keep top and banners at its foot
    for (const zs of [-1, 1]) {
      landmarks.push({ key: "platformer/flag", x: side * (outer - 3.6), z: zs * (keepD / 2 - 3.6), size: 3, tint: team, collision: false });
      landmarks.push({ key: "arena/banner", x: side * (outer + 3), z: zs * (keepD / 2 - 3), size: 4, tint: team, rot: Math.PI / 2 });
    }
    // armoury by the back stair, practice targets behind it
    landmarks.push({ key: "arena/weapon-rack", x: side * (outer + 4), z: 6, size: 2.2, rot: side < 0 ? Math.PI / 2 : -Math.PI / 2 });
    for (const zs of [-1, 1])
      landmarks.push({ key: "guns/target-large", x: side * (outer + 16), z: zs * 9, size: 2.4, rot: side < 0 ? Math.PI / 2 : -Math.PI / 2 });
  }
  // Mirrored field cover between the keeps and the flank lanes: rocks, low fences, crates.
  const coverKeys = ["platformer/rocks", "platformer/fence-low-straight", "guns/crate-wide", "platformer/fence-low-broken"];
  for (let i = 0; i < 9; i++) {
    const x = 14 + random() * (inner - 26),
      z = (random() < 0.5 ? -1 : 1) * (centre + 6 + random() * (laneZ - centre - 22)),
      key = pick(random, coverKeys),
      size = key.includes("fence") ? 3.2 : key.includes("rocks") ? 2.6 : 2.4,
      rot = random() < 0.5 ? 0 : Math.PI / 2;
    for (const side of [-1, 1]) landmarks.push({ key, x: side * x, z, size, rot, scatter: true });
  }
  // Neutral statue facing each flank lane at the middle line, and a meadow border of trees.
  for (const zs of [-1, 1])
    landmarks.push({ key: "arena/statue", x: centre + 16, z: zs * (laneZ - 22), size: 4.5, rot: zs < 0 ? 0 : Math.PI });
  for (let i = 0; i < 26; i++) {
    const t = random() * 2 - 1,
      band = 98 + random() * 6,
      onX = random() < 0.5,
      sign = random() < 0.5 ? -1 : 1,
      x = onX ? sign * band : t * 100,
      z = onX ? t * 100 : sign * band;
    landmarks.push({
      key: random() < 0.55 ? "platformer/tree-pine-small" : "platformer/tree",
      x,
      z,
      size: 5 + random() * 4,
      rot: random() * Math.PI * 2,
      scatter: true,
    });
  }
  for (let i = 0; i < 22; i++) {
    const t = random() * 2 - 1,
      band = 86 + random() * 18,
      sign = random() < 0.5 ? -1 : 1,
      onX = random() < 0.5;
    landmarks.push({
      key: random() < 0.5 ? "platformer/flowers" : "platformer/plant",
      x: onX ? sign * band : t * 100,
      z: onX ? t * 100 : sign * band,
      size: 0.9 + random() * 0.5,
      collision: false,
      scatter: true,
    });
  }

  const medkits = [
    ...nodes.map((n) => [n.world.x + 6, n.world.z + 6]),
    [-keepX + 4, 4],
    [keepX - 4, -4],
    [0, centre - 3],
  ];

  // Continuous walls on the upper level (game builds them from `wallRuns`, tile by tile, no gaps):
  //   keeps — 2.2 m battlements on every edge, open only where a stair lands or the bridge joins;
  //   bastion and bridges — 1.1 m parapets, open at stair landings and bridge joins.
  const wallRuns = [],
    inset = 0.45;
  // edge from (x0,z0) to (x1,z1) minus open intervals [a,b] measured along the edge from its start
  const edgeRuns = (x0, z0, x1, z1, gaps, height) => {
    const len = Math.hypot(x1 - x0, z1 - z0),
      cuts = gaps.map(([a, b]) => [Math.max(0, a), Math.min(len, b)]).filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
    let t = 0;
    for (const [a, b] of [...cuts, [len, len]]) {
      if (a - t > 1.2)
        wallRuns.push({
          x0: x0 + ((x1 - x0) * t) / len,
          z0: z0 + ((z1 - z0) * t) / len,
          x1: x0 + ((x1 - x0) * a) / len,
          z1: z0 + ((z1 - z0) * a) / len,
          y: H,
          height,
        });
      t = Math.max(t, b);
    }
  };
  const gapAround = (centre, half, start) => [centre - start - half, centre - start + half];
  for (const side of [-1, 1]) {
    const xi = side * (inner - inset),
      xo = side * (outer - inset),
      zs = keepD / 2 - inset;
    // inner edge: bridge in the middle, two stair landings
    edgeRuns(xi, -zs, xi, zs, [gapAround(0, bridgeW / 2 + 0.6, -zs), gapAround(-stairZ, 3.6, -zs), gapAround(stairZ, 3.6, -zs)], 2.2);
    // outer edge: back stair
    edgeRuns(xo, -zs, xo, zs, [gapAround(0, 3.6, -zs)], 2.2);
    // long sides
    for (const zz of [-zs, zs]) edgeRuns(xi, zz, xo, zz, [], 2.2);
    // bridge parapets along both long sides
    for (const zz of [-(bridgeW / 2 - 0.3), bridgeW / 2 - 0.3]) edgeRuns(side * (centre + 0.2), zz, side * (inner - 0.2), zz, [], 1.1);
    // bastion: side facing this bridge (opening for the bridge) and the stair side
    const bx = side * (centre - inset);
    edgeRuns(bx, -(centre - inset), bx, centre - inset, [gapAround(0, bridgeW / 2 + 0.6, -(centre - inset))], 1.1);
    const bz = side * (centre - inset);
    edgeRuns(-(centre - inset), bz, centre - inset, bz, [gapAround(0, 3.6, -(centre - inset))], 1.1);
  }

  // Seeded orientation, same convention as the ravine generator.
  const orient = { swap: random() < 0.5, fx: random() < 0.5 ? -1 : 1, fz: random() < 0.5 ? -1 : 1 },
    o = (x, z) => {
      const a = x * orient.fx,
        b = z * orient.fz;
      return orient.swap ? [b, a] : [a, b];
    },
    point = (q) => {
      const [x, z] = o(q.x, q.z);
      return { ...q, x, z };
    },
    box = (r) => {
      const [x, z] = o(r.x, r.z);
      return orient.swap ? { ...r, x, z, w: r.d, d: r.w } : { ...r, x, z };
    },
    turn = (rot = 0) => {
      // rotation of a model whose length runs along x: mirror and swap the angle with the plan
      let a = rot;
      if (orient.fx < 0) a = Math.PI - a;
      if (orient.fz < 0) a = -a;
      if (orient.swap) a = Math.PI / 2 - a;
      return a;
    };
  graph.nodes.forEach((n) => (n.world = point(n.world)));
  const zones = nodes.map((n) => ({ id: n.id, template: n.template, x: n.world.x, z: n.world.z }));
  return {
    seed: String(seed),
    graph,
    orient,
    zones,
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
        const [a, b] = o(x, z);
        return [a, h, b];
      }),
    })),
    connections: connections.map((c) => ({ ...c, points: c.points.map(point) })),
    limit: 110,
    landmarks: landmarks.map((m) => ({ ...point(m), rot: turn(m.rot) })),
    wallRuns: wallRuns.map((r) => {
      const [x0, z0] = o(r.x0, r.z0),
        [x1, z1] = o(r.x1, r.z1);
      return { ...r, x0, z0, x1, z1 };
    }),
    medkits: medkits.map(([x, z]) => o(x, z)),
    theme: {
      id: "meadow",
      ground: 0x7f9c55,
      platform: 0x98a0a8,
      lights: ["noon", "sunset"],
      teams: { west: RED, east: BLUE },
      // the meadow is big and open: count ground as empty sooner and allow more clusters
      fill: { deadDistance: 5.5, maxDead: 0.25, maxClusters: 40, repeat: 4 },
    },
  };
}
