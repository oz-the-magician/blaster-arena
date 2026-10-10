// «Острова»: floating rock islands at different heights over a stake ditch that covers the whole arena.
//   No bridges: islands are linked only by directional launch pads (a pad always throws you at its target
//   island, whichever way you run onto it). Every island carries a courtyard template (walls, props), cover
//   and barrels. Down in the ditch, tiny rescue blocks with a pad throw you back up to the nearest island —
//   you have to reach one before the stakes finish you (the ditch hurts slower here than on «Царь горы»).
// Level-filling: the high islands are the strong positions but are reached only by pads; objectives and
// pickups land on other islands, so the player keeps flying; falling is a real risk but not instant death.
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
const GRAVITY = 17;
// horizontal speed so that a pad with vertical speed `v` lands `d` metres away and `dh` metres higher
function padSpeed(v, d, dh) {
  const disc = v * v - 2 * GRAVITY * dh;
  if (disc <= 0) return null;
  const t = (v + Math.sqrt(disc)) / GRAVITY; // the falling half of the arc
  return d / t;
}

export function generateIslands(seed) {
  const random = seededRandom(seed + "-islands"),
    L = 110,
    THICK = 3; // rock thickness under the walking surface
  // 3 × 3 jittered grid of islands; the centre one is the biggest, heights vary 2..12 m
  const islands = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) {
      const mid = r === 1 && c === 1,
        size = mid ? 42 : 32 + Math.floor(random() * 4) * 2, // 32..38
        x = (c - 1) * 66 + (mid ? 0 : (random() - 0.5) * 8),
        z = (r - 1) * 66 + (mid ? 0 : (random() - 0.5) * 8),
        h = mid ? 6 : pick(random, [2, 4, 8, 10, 12]);
      islands.push({ id: "i" + r + c, r, c, x: Math.round(x), z: Math.round(z), w: size, d: size, h, mid });
    }
  const skyPlatforms = islands.map((s) => ({ x: s.x, z: s.z, w: s.w, d: s.d, h: s.h, base: s.h - THICK, solid: true, island: true, node: s.id }));

  // links between grid neighbours (incl. diagonals for the centre): every island gets pads to 2–3 others,
  // and the links form a connected graph (spanning tree first), all links both ways
  const cand = [];
  for (const a of islands)
    for (const b of islands)
      if (a.id < b.id && Math.abs(a.r - b.r) <= 1 && Math.abs(a.c - b.c) <= 1 && (a.r === b.r || a.c === b.c || a.mid || b.mid)) cand.push([a, b]);
  const parent = new Map(),
    root = (k) => {
      while (parent.has(k) && parent.get(k) !== k) k = parent.get(k);
      return k;
    },
    links = [],
    rest = [];
  for (const [a, b] of shuffle(random, cand)) {
    const ra = root(a.id),
      rb = root(b.id);
    if (ra !== rb) {
      parent.set(ra, rb);
      links.push([a, b]);
    } else rest.push([a, b]);
  }
  links.push(...rest.slice(0, 4)); // a few extra routes

  const jumpPads = [];
  // a pad near the edge of `a` that faces `b`, aimed 7 m inside b's facing edge (5 m in from a's edge)
  const padTo = (a, b) => {
    const dx = b.x - a.x,
      dz = b.z - a.z,
      len = Math.hypot(dx, dz),
      ux = dx / len,
      uz = dz / len,
      // where the line between centres leaves island a (minus 4 m) and enters island b (plus 7 m)
      exitA = Math.min(a.w / 2 / Math.max(Math.abs(ux), 1e-6), a.d / 2 / Math.max(Math.abs(uz), 1e-6)) - 5,
      enterB = Math.min(b.w / 2 / Math.max(Math.abs(ux), 1e-6), b.d / 2 / Math.max(Math.abs(uz), 1e-6)) - 7,
      px = a.x + ux * exitA,
      pz = a.z + uz * exitA,
      tx = b.x - ux * enterB,
      tz = b.z - uz * enterB,
      d = Math.hypot(tx - px, tz - pz),
      dh = b.h - a.h;
    for (const tier of ["blue", "yellow"]) {
      const v = tier === "blue" ? 21 : 25,
        speed = padSpeed(v, d, dh);
      if (speed && v * v / (2 * GRAVITY) > dh + 2.5) {
        jumpPads.push({ x: px, z: pz, y: a.h, role: "transfer", tier, speed: Math.round(speed * 100) / 100, target: { x: tx, z: tz, y: b.h } });
        return;
      }
    }
  };
  for (const [a, b] of links) {
    padTo(a, b);
    padTo(b, a);
  }

  // the whole arena is ditch; rescue blocks on a 22 m grid where the open sky is above them
  const moat = [{ x: 0, z: 0, w: 2 * L, d: 2 * L }],
    rescue = [];
  const under = (x, z, m) => islands.some((s) => Math.abs(x - s.x) < s.w / 2 + m && Math.abs(z - s.z) < s.d / 2 + m);
  for (let x = -99; x <= 99; x += 22)
    for (let z = -99; z <= 99; z += 22) {
      const jx = x + (random() - 0.5) * 6,
        jz = z + (random() - 0.5) * 6;
      if (under(jx, jz, 4)) continue;
      // nearest island: thrown onto it
      const near = islands.slice().sort((p, q) => Math.hypot(p.x - jx, p.z - jz) - Math.hypot(q.x - jx, q.z - jz))[0],
        dx = near.x - jx,
        dz = near.z - jz,
        len = Math.hypot(dx, dz),
        enter = Math.min(near.w / 2 / Math.max(Math.abs(dx / len), 1e-6), near.d / 2 / Math.max(Math.abs(dz / len), 1e-6)) - 6,
        tx = near.x - (dx / len) * enter,
        tz = near.z - (dz / len) * enter,
        top = -3.4,
        dh = near.h - top,
        d = Math.hypot(tx - jx, tz - jz),
        speed = padSpeed(25, d, dh);
      if (!speed || 25 * 25 / (2 * GRAVITY) < dh + 1.5) continue;
      rescue.push({ x: Math.round(jx * 10) / 10, z: Math.round(jz * 10) / 10 });
      skyPlatforms.push({ x: jx, z: jz, w: 4.6, d: 4.6, h: top, base: -4, solid: true, rescue: true });
      jumpPads.push({ x: jx, z: jz, y: top, role: "escape", tier: "yellow", speed: Math.round(speed * 100) / 100, target: { x: tx, z: tz, y: near.h } });
    }

  // low parapets on some island edges (cover, and a little safety), never in front of a pad
  const wallRuns = [];
  for (const s of islands)
    for (const [nx, nz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      if (random() < 0.45) continue;
      const a = (nx ? s.w : s.d) / 2 - 0.45,
        half = (nx ? s.d : s.w) / 2 - 3,
        t0 = -half + random() * half * 0.6,
        t1 = half - random() * half * 0.6,
        tx = -nz,
        tz = nx,
        x0 = s.x + nx * a + tx * t0,
        z0 = s.z + nz * a + tz * t0,
        x1 = s.x + nx * a + tx * t1,
        z1 = s.z + nz * a + tz * t1;
      // keep 6 m clear of every pad on this island
      const blocked = jumpPads.some((p) => {
        const along = (p.x - s.x) * tx + (p.z - s.z) * tz,
          out = (p.x - s.x) * nx + (p.z - s.z) * nz;
        return Math.abs(out - a) < 8 && along > t0 - 6 && along < t1 + 6 && Math.abs(p.y - s.h) < 0.1;
      });
      if (!blocked) wallRuns.push({ x0, z0, x1, z1, y: s.h, height: 1.1 });
    }

  const nodes = islands.map((s) => ({
    id: s.id,
    role: s.mid ? "centre" : "island",
    height: s.h,
    world: { x: s.x, z: s.z },
    template: s.mid ? "courtyard" : pick(random, ["ruins", "courtyard", "quarter", "tower"]),
  }));
  const graph = { scheme: "islands", nodes, edges: links.map(([a, b]) => [a.id, b.id]) };
  // zones sit on the island tops (the game raises template walls to zone.y)
  const zones = nodes.map((n) => ({ id: n.id, template: n.template, x: n.world.x, z: n.world.z, y: n.height }));

  const landmarks = [];
  for (const s of islands)
    for (let k = 0; k < 4; k++)
      landmarks.push({
        key: pick(random, ["nature/tree_palmTall", "nature/rock_largeA", "graveyard/rocks-tall", "nature/tree_default", "arena/column-damaged"]),
        x: s.x + (random() - 0.5) * (s.w - 8),
        z: s.z + (random() - 0.5) * (s.d - 8),
        y: s.h,
        size: 2.5 + random() * 2.5,
        rot: random() * 6.28,
        scatter: true,
      });
  const barrels = islands.flatMap((s) => (random() < 0.7 ? [[s.x + (random() - 0.5) * (s.w - 10), s.z + (random() - 0.5) * (s.d - 10)]] : []));
  const medkits = islands.filter((s) => !s.mid).map((s) => [s.x + s.w / 2 - 5, s.z - s.d / 2 + 5]);

  return {
    seed: String(seed),
    graph,
    orient: { swap: false, fx: 1, fz: 1 },
    zones,
    platforms: [],
    skyPlatforms,
    ramps: [],
    jumpPads,
    coreRoutes: [],
    connections: nodes.map((n) => ({ edge: n.id, points: [n.world] })),
    limit: L,
    landmarks,
    wallRuns,
    medkits,
    barrels,
    moat,
    moatBanks: "strips",
    moatDamage: 10, // per 0.25 s (hill: 20) — time to run to a rescue pad
    stakeDensity: 0.12,
    rescue,
    traps: 6,
    theme: {
      id: "meadow",
      ground: 0x6f8f4a,
      platform: 0x8f8a80,
      lights: ["noon", "sunset"],
      fill: { deadDistance: 5, maxDead: 0.2, maxClusters: 40, repeat: 4 },
    },
  };
}
