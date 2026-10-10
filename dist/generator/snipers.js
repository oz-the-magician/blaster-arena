// «Снайперы на вышках»: the ravine layout packed with cover; the game puts ~14 sniper towers on it
// (some down in the ravine) and runs a single wave: kill every sniper. See SNIPER / buildTowers in game.js.
// Hard version: most ground towers stand on a little island inside a stake ditch (you can't just run up and
// shoot the powder crate point-blank), the field is mined, and bombers keep coming while snipers are alive.
import { generateWorld, seededRandom } from "./world.js";

const RING = { island: 3.6, width: 5 }; // half-size of the tower's island, width of the ditch around it

export function generateSnipers(seed) {
  const plan = generateWorld(seed + "-snipers"),
    random = seededRandom(seed + "-snipers-moats");
  plan.seed = String(seed);
  plan.snipers = 14;
  // much denser decoration: little open ground, lots to hide behind
  plan.theme = { ...plan.theme, fill: { deadDistance: 3.5, maxDead: 0.1, maxClusters: 52, repeat: 6 } };
  // tower spots with a ditch ring: away from the ravine, the zones, stairs, platforms and each other
  const pit = plan.pit,
    outer = RING.island + RING.width,
    near = (x, z, r, q) => Math.abs(x - q.x) < q.w / 2 + r && Math.abs(z - q.z) < q.d / 2 + r,
    start = plan.zones[0] || { x: 0, z: 0 },
    spots = [];
  for (let tries = 0; tries < 900 && spots.length < 8; tries++) {
    const x = (random() * 2 - 1) * (plan.limit - 22),
      z = (random() * 2 - 1) * (plan.limit - 22);
    if (pit && near(x, z, outer + 6, pit)) continue;
    if (Math.hypot(x - start.x, z - start.z) < 34) continue;
    if (plan.zones.some((q) => Math.hypot(x - q.x, z - q.z) < 24)) continue;
    if ((plan.skyPlatforms || []).some((q) => near(x, z, outer + 3, q))) continue;
    if ((plan.ramps || []).some((r) => Math.hypot(x - (r.x0 + r.x1) / 2, z - (r.z0 + r.z1) / 2) < outer + 10)) continue;
    if (spots.some((p) => Math.hypot(p.x - x, p.z - z) < 24)) continue;
    spots.push({ x: Math.round(x), z: Math.round(z), moat: true });
  }
  plan.towerSpots = spots;
  // four strips per ring (north/south full width, east/west between them)
  plan.moat = spots.flatMap(({ x, z }) => {
    const mid = RING.island + RING.width / 2;
    return [
      { x, z: z - mid, w: outer * 2, d: RING.width },
      { x, z: z + mid, w: outer * 2, d: RING.width },
      { x: x - mid, z, w: RING.width, d: RING.island * 2 },
      { x: x + mid, z, w: RING.width, d: RING.island * 2 },
    ];
  });
  plan.moatBanks = "strips";
  plan.traps = 18; // a minefield between the towers
  return plan;
}
