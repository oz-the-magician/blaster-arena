import { generateTopology } from "./topology.js";
export function seededRandom(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Compile the logical ravine graph into orthogonal, playable world geometry.
export function generateWorld(seed) {
  const random = seededRandom(seed),
    graph = generateTopology({ scheme: "ravine", seed }),
    bank = 64 + Math.floor(random() * 7) * 2,
    bankEast = 64 + Math.floor(random() * 8) * 2,
    extent = 68 + Math.floor(random() * 5) * 2,
    bridgeZ = (random() < 0.5 ? -1 : 1) * (26 + Math.floor(random() * 5) * 2),
    shoulder = 42 + Math.floor(random() * 4) * 2,
    top = 14 + Math.floor(random() * 2) * 2;
  const pit = {
      x: 0,
      z: 0,
      w: 24 + Math.floor(random() * 5) * 2,
      d: 104 + Math.floor(random() * 4) * 2,
      h: -5,
    },
    main = [
      [-bank, -extent],
      [-bank, 0],
      [-bank, extent],
      [bankEast, extent],
      [bankEast, 0],
      [bankEast, -extent],
    ],
    points = {};
  graph.nodes.forEach((n) => {
    const i = Number(n.id.slice(1));
    const [x, z] =
      n.id[0] === "m"
        ? main[i]
        : n.id[0] === "l"
          ? [0, [-44, 0, 44][i]]
          : [[-shoulder, 0, shoulder][i], bridgeZ];
    n.height = n.id[0] === "l" ? -5 : n.id === "u1" ? top : n.id[0] === "u" ? 8 : 0;
    n.world = { x, z };
    n.template = n.compatibleTemplates[Math.floor(random() * n.compatibleTemplates.length)];
    points[n.id] = { x, z, h: n.height };
  });
  const skyPlatforms = graph.nodes
      .filter((n) => n.id[0] === "u")
      .map((n) => ({ ...n.world, w: 20, d: 20, h: n.height, node: n.id })),
    ramps = [],
    coreRoutes = [],
    connections = [];
  const addFlat = (a, b, h, width) => {
    if (Math.hypot(a.x - b.x, a.z - b.z) < 0.01) return;
    coreRoutes.push({
      role: h > 0 ? "upper" : h < 0 ? "lower" : "main",
      points: [
        [a.x, h, a.z],
        [b.x, h, b.z],
      ],
    });
    if (h > 0)
      skyPlatforms.push({
        x: (a.x + b.x) / 2,
        z: (a.z + b.z) / 2,
        w: a.x === b.x ? width : Math.abs(a.x - b.x),
        d: a.z === b.z ? width : Math.abs(a.z - b.z),
        h,
        connector: true,
      });
    else if (
      h === 0 &&
      Math.abs((a.z + b.z) / 2) < pit.d / 2 &&
      a.z === b.z &&
      Math.min(a.x, b.x) < -pit.w / 2 &&
      Math.max(a.x, b.x) > pit.w / 2
    )
      skyPlatforms.push({ x: 0, z: a.z, w: pit.w + 4, d: width, h: 0, connector: true });
  };
  const addStair = (a, b, width) => {
    if (a.h > b.h) [a, b] = [b, a];
    if (a.h < 0 && b.h === 0) [a, b] = [b, a];
    ramps.push({ x0: a.x, z0: a.z, x1: b.x, z1: b.z, width, baseHeight: a.h, h: b.h });
    coreRoutes.push({
      role: "stairs",
      points: [
        [a.x, a.h, a.z],
        [b.x, b.h, b.z],
      ],
    });
  };
  for (const edge of graph.edges) {
    const a = points[edge.a],
      b = points[edge.b];
    edge.heightDelta = b.h - a.h;
    edge.kind = edge.kind === "jump" ? "jump" : a.h !== b.h ? "stairs" : a.h > 0 ? "bridge" : "passage";
    if (!edge.walkable) continue;
    let route;
    if (edge.lane === "lower" && a.h !== b.h) {
      const low = a.h < 0 ? a : b,
        ground = a.h === 0 ? a : b,
        corner = { x: 0, z: ground.z, h: 0 };
      addFlat(ground, corner, 0, 6);
      addStair(corner, low, 6);
      route = [ground, corner, low];
    } else if (edge.lane === "upper" && a.h !== b.h && (a.h === 0 || b.h === 0)) {
      const ground = a.h === 0 ? a : b,
        upper = a.h > 0 ? a : b,
        sign = Math.sign(ground.x - upper.x),
        corner = { x: upper.x + sign * 3, z: ground.z, h: upper.h };
      addStair(ground, corner, 6);
      addFlat({ x: upper.x, z: ground.z }, upper, upper.h, 6);
      route = [ground, corner, upper];
    } else if (a.h !== b.h) {
      const direction = Math.sign(b.x - a.x),
        start = { ...a, x: a.x + direction * 10 },
        end = { ...b, x: b.x - direction * 10 };
      addStair(start, end, 6);
      route = [a, start, end, b];
    } else if (edge.lane === "flank") {
      const z = (random() < 0.5 ? -1 : 1) * (14 + Math.floor(random() * 6) * 2),
        c = { x: a.x, z },
        d = { x: b.x, z };
      addFlat(a, c, 0, 6);
      addFlat(c, d, 0, 6);
      addFlat(d, b, 0, 6);
      route = [a, c, d, b];
    } else {
      const corner = { x: a.x, z: b.z };
      addFlat(a, corner, a.h, 6);
      addFlat(corner, b, b.h, 6);
      route = [a, corner, b];
    }
    connections.push({ edge: edge.id, points: route });
  }
  const zones = graph.nodes
    .filter((n) => n.id[0] === "m")
    .map((n) => ({ id: n.id, template: n.template, x: n.world.x, z: n.world.z }));
  // Escape pads on the ravine floor must have open sky: never under a crossing or near a floor stair.
  const overPit = skyPlatforms.filter((q) => Math.abs(q.x) - q.w / 2 < pit.w / 2),
    clearZ = (z) =>
      Math.abs(z) <= pit.d / 2 - 6 &&
      !overPit.some((q) => Math.abs(z - q.z) < q.d / 2 + 4) &&
      !ramps.some(
        (r) => Math.min(r.h, r.baseHeight || 0) < 0 && z > Math.min(r.z0, r.z1) - 4 && z < Math.max(r.z0, r.z1) + 4,
      ),
    openZ = [];
  for (let z = -pit.d / 2; z <= pit.d / 2; z += 2) if (clearZ(z)) openZ.push(z);
  // one pad per half of the ravine, as close to ±20 as the sky allows; if a half has no open sky, use the other half
  const near = (target, list) => list.slice().sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0];
  let zNeg = near(-20, openZ.filter((z) => z < 0)),
    zPos = near(20, openZ.filter((z) => z > 0));
  if (zNeg === undefined) zNeg = near(-20, openZ.filter((z) => Math.abs(z - zPos) >= 14));
  if (zPos === undefined) zPos = near(20, openZ.filter((z) => Math.abs(z - zNeg) >= 14));
  const padZ = (sign) => (sign < 0 ? zNeg : zPos) ?? sign * 20;
  const jumpPads = [
    ...[-1, 1].flatMap((side) =>
      [padZ(-1), padZ(1)].map((z) => ({
        x: side * (pit.w / 2 - 3),
        z,
        y: -5,
        role: "escape",
        tier: "blue",
        speed: 10,
        vertical: 17,
      })),
    ),
    ...[-1, 1].map((side) => ({
      x: side * (shoulder + 20),
      z: bridgeZ,
      y: 0,
      role: "flank",
      tier: "yellow",
      speed: 10,
      vertical: 19.5,
    })),
    { x: 0, z: bridgeZ + 5, y: top, role: "attack", tier: "spring", speed: 11, vertical: 10 },
  ];
  const jump = graph.edges.find((e) => !e.walkable);
  if (jump) {
    jump.b = "l1";
    jump.heightDelta = -5 - top;
    jump.ports = { a: "exit-l1", b: "exit-u1" };
  }
  // Extra ground crossings (seeded 0-2) avoid stairs, pads and existing crossings.
  const crossings = skyPlatforms.filter((p) => p.h === 0 && p.connector).map((p) => p.z),
    blocked = (z) =>
      crossings.some((c) => Math.abs(c - z) < 16) ||
      jumpPads.some((p) => p.y < 0 && Math.abs(p.z - z) < 8) ||
      ramps.some(
        (r) =>
          Math.min(r.h, r.baseHeight || 0) < 0 &&
          z > Math.min(r.z0, r.z1) - 6 &&
          z < Math.max(r.z0, r.z1) + 6,
      ) ||
      Math.abs(z) > pit.d / 2 - 8 ||
      Math.abs(z - bridgeZ) < 6;
  const extraBridges = Math.floor(random() * 3);
  for (let k = 0, tries = 0; k < extraBridges && tries < 40; tries++) {
    const z = Math.round((random() * 2 - 1) * (pit.d / 2 - 8));
    if (blocked(z)) continue;
    crossings.push(z);
    skyPlatforms.push({ x: 0, z, w: pit.w + 4, d: 5, h: 0, connector: true, extra: true });
    coreRoutes.push({
      role: "main",
      points: [
        [-pit.w / 2 - 2, 0, z],
        [pit.w / 2 + 2, 0, z],
      ],
    });
    k++;
  }
  // Canonical faces and landmarks, then one seeded orientation for the whole plan.
  const faces = [
    ...[-1, 1].map((side) => ({ x: side * (pit.w / 2 + 0.1), z: 0, w: 0.2, d: pit.d })),
    ...[-1, 1].flatMap((side) =>
      [-1, 1].map((x) => {
        const width = pit.w / 2 - 3;
        return { x: x * (3 + width / 2), z: side * (pit.d / 2 + 0.1), w: width, d: 0.2 };
      }),
    ),
  ];
  const landmarks = [
    ...[-1, 1].flatMap((side) =>
      [-34, 0, 34]
        .filter((z) => !crossings.some((c) => Math.abs(c - z) < 6))
        .map((z) => ({ key: "graveyard/rocks", x: side * (pit.w / 2 - 5), z, size: 3 })),
    ),
    ...[-1, 1].flatMap((side) =>
      [-95, -45, 45, 95].flatMap((z) => [
        { key: "arena/column", x: side * 94, z, size: 7 + random() * 4 },
        { key: "graveyard/rocks-tall", x: side * 88, z: z + 5, size: 5 + random() * 3 },
      ]),
    ),
  ];
  const orient = { swap: random() < 0.5, fx: random() < 0.5 ? -1 : 1, fz: random() < 0.5 ? -1 : 1 },
    o = (x, z) => {
      const a = x * orient.fx,
        b = z * orient.fz;
      return orient.swap ? [b, a] : [a, b];
    },
    box = (r) => {
      const [x, z] = o(r.x, r.z);
      return orient.swap ? { ...r, x, z, w: r.d, d: r.w } : { ...r, x, z };
    };
  const point = (q) => {
    const [x, z] = o(q.x, q.z);
    return { ...q, x, z };
  };
  graph.nodes.forEach((n) => {
    n.world = point(n.world);
  });
  const plan = {
    seed: String(seed),
    graph,
    orient,
    zones: zones.map(point),
    pit: box(pit),
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
    pitFaces: faces.map(box),
    landmarks: landmarks.map(point),
    bridges: 1 + crossings.length,
    theme: { id: "desert", ground: 0xc5965e, platform: 0xb09372 },
    medkits: [
      ...zones.map((z) => [z.x + 6, z.z + 6]),
      [0, bridgeZ + 5],
      [-shoulder, bridgeZ + 4],
      [shoulder, bridgeZ + 4],
      [0, 20],
    ].map(([x, z]) => o(x, z)),
  };
  return plan;
}
