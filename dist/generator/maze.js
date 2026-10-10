// «Лабиринт»: an 8 × 8 maze of 22 m cells whose walls are all DESTRUCTIBLE (rockets, barrels, bombers and the
// giant break them). A seeded backtracker carves a perfect maze, then extra openings make loops; some walls have
// a door gap, some are only waist-high (cover you can shoot over). The four centre cells form a plaza with a
// 3 m stone dais (two stairs). Corner and edge cells are the courtyards where fights start and objectives appear.
// Level-filling idea: no line of sight longer than a corridor, so the player has to move to find anything;
// rockets and barrels open new routes; objectives in far cells pull the player through the maze.
import { seededRandom } from "./world.js";

const shuffle = (random, list) => {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export function generateMaze(seed) {
  const random = seededRandom(seed + "-maze"),
    N = 8,
    CELL = 22,
    O = -(N * CELL) / 2, // -88
    L = 110,
    cx = (i) => O + CELL / 2 + i * CELL,
    key = (i, j) => i + "," + j;
  // walls: east wall of (i,j) and south wall of (i,j); true = wall stands
  const east = Array.from({ length: N }, () => Array(N).fill(true)),
    south = Array.from({ length: N }, () => Array(N).fill(true));
  const plaza = (i, j) => (i === 3 || i === 4) && (j === 3 || j === 4);
  east[3][3] = east[3][4] = false; // plaza: the four centre cells are one room
  south[3][3] = south[4][3] = false;
  // recursive backtracker (iterative)
  const seen = new Set([key(0, 0)]),
    stack = [[0, 0]];
  while (stack.length) {
    const [i, j] = stack[stack.length - 1],
      next = shuffle(random, [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        .map(([di, dj]) => [i + di, j + dj])
        .filter(([a, b]) => a >= 0 && b >= 0 && a < N && b < N && !seen.has(key(a, b)));
    if (!next.length) {
      stack.pop();
      continue;
    }
    const [a, b] = next[0];
    if (a !== i) east[Math.min(a, i)][j] = false;
    else south[i][Math.min(b, j)] = false;
    // entering the plaza opens all four of its cells at once
    for (const [p, q] of plaza(a, b) ? [[3, 3], [3, 4], [4, 3], [4, 4]] : [[a, b]]) seen.add(key(p, q));
    stack.push([a, b]);
  }
  // loops: knock out 9 more walls so there is always a second way round
  const standing = [];
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      if (i < N - 1 && east[i][j]) standing.push(["e", i, j]);
      if (j < N - 1 && south[i][j]) standing.push(["s", i, j]);
    }
  for (const [k, i, j] of shuffle(random, standing).slice(0, 9)) (k === "e" ? east : south)[i][j] = false;

  // wall segments: full-height runs, some with a 5 m door gap, some waist-high
  const breakWalls = [];
  const addWall = (x0, z0, x1, z1) => {
    const roll = random(),
      height = roll < 0.18 ? 1.4 : 4.4;
    if (height > 2 && roll < 0.36) {
      // door: split the run around a 5 m gap at a random spot
      const len = Math.hypot(x1 - x0, z1 - z0),
        at = 5 + random() * (len - 10),
        ux = (x1 - x0) / len,
        uz = (z1 - z0) / len;
      breakWalls.push([x0, z0, x0 + ux * (at - 2.5), z0 + uz * (at - 2.5), height]);
      breakWalls.push([x0 + ux * (at + 2.5), z0 + uz * (at + 2.5), x1, z1, height]);
    } else breakWalls.push([x0, z0, x1, z1, height]);
  };
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      const x = O + (i + 1) * CELL,
        z = O + (j + 1) * CELL;
      if (i < N - 1 && east[i][j]) addWall(x, O + j * CELL, x, O + (j + 1) * CELL);
      if (j < N - 1 && south[i][j]) addWall(O + i * CELL, z, O + (i + 1) * CELL, z);
    }

  // plaza dais: 3 m, 14 m square, two stairs
  const skyPlatforms = [{ x: 0, z: 0, w: 14, d: 14, h: 3, base: 0, solid: true, node: "dais" }],
    ramps = [],
    coreRoutes = [];
  for (const [nx, nz] of shuffle(random, [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]).slice(0, 2)) {
    ramps.push({ x0: nx * 14, z0: nz * 14, x1: nx * 7, z1: nz * 7, width: 5, baseHeight: 0, h: 3 });
    coreRoutes.push({ role: "stairs", points: [[nx * 14, 0, nz * 14], [nx * 7, 3, nz * 7]] });
  }
  // nodes: four corners, four edge middles, the dais
  const spots = [
    [0, 0, "corner"],
    [N - 1, 0, "corner"],
    [0, N - 1, "corner"],
    [N - 1, N - 1, "corner"],
    [0, 3, "edge"],
    [N - 1, 4, "edge"],
    [4, 0, "edge"],
    [3, N - 1, "edge"],
  ];
  const nodes = spots.map(([i, j, role], k) => ({ id: "c" + k, role, height: 0, world: { x: cx(i), z: cx(j) }, template: "empty" }));
  nodes.push({ id: "dais", role: "dais", height: 3, world: { x: 0, z: 0 }, template: "empty" });
  const graph = { scheme: "maze", nodes, edges: [] };

  // outer wall of the maze (solid, not breakable: the arena edge), barrels in a few cells, braziers at the plaza
  const wallRuns = [];
  for (const s of [-1, 1]) {
    wallRuns.push({ x0: O, z0: s * -O, x1: -O, z1: s * -O, y: 0, height: 4.4, key: "dungeon/wall" });
    wallRuns.push({ x0: s * -O, z0: O, x1: s * -O, z1: -O, y: 0, height: 4.4, key: "dungeon/wall" });
  }
  const landmarks = [
    { key: "arena/statue", x: 0, z: 0, size: 3, rot: random() * 6.28 },
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ key: "arena/column-damaged", x: sx * 16, z: sz * 16, size: 4, rot: random() * 6.28 }))),
  ];
  const barrels = [];
  for (let k = 0; k < 10; k++) {
    const i = Math.floor(random() * N),
      j = Math.floor(random() * N);
    if (plaza(i, j)) continue;
    barrels.push([cx(i) + (random() - 0.5) * 8, cx(j) + (random() - 0.5) * 8]);
  }
  const medkits = nodes.filter((n) => n.role !== "dais").map((n) => [n.world.x + 5, n.world.z + 5]);

  return {
    seed: String(seed),
    graph,
    orient: { swap: false, fx: 1, fz: 1 },
    zones: nodes.map((n) => ({ id: n.id, template: n.template, x: n.world.x, z: n.world.z })),
    platforms: [],
    skyPlatforms,
    ramps,
    jumpPads: [],
    coreRoutes,
    connections: nodes.map((n) => ({ edge: n.id, points: [n.world] })),
    limit: L,
    landmarks,
    wallRuns,
    breakWalls,
    barrels,
    medkits,
    traps: 10,
    theme: {
      id: "ruins",
      ground: 0x8a7d62,
      platform: 0x8e9095,
      lights: ["sunset", "overcast"],
      fill: { deadDistance: 7, maxDead: 0.3, maxClusters: 26, repeat: 3 },
    },
  };
}
