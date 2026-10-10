// Arena type registry. Every generator takes a seed and returns a plan in the same format
// (zones, graph, skyPlatforms, ramps, jumpPads, coreRoutes, connections, medkits, limit;
// pit, pitFaces and landmarks are optional). New arena types register here.
import { generateWorld, seededRandom } from "./world.js";
import { generateFortresses } from "./fortresses.js";
import { generateHill } from "./hill.js";
import { generateAmphitheatre } from "./amphitheatre.js";
import { generateSnipers } from "./snipers.js";
import { BIOMES, pickBiome, autoTorches } from "./biomes.js";

export const ARENA_TYPES = {
  ravine: { name: "Ущелье", generate: generateWorld },
  fortresses: { name: "Две крепости", generate: generateFortresses },
  hill: { name: "Царь горы", generate: generateHill },
  amphitheatre: { name: "Амфитеатр", generate: generateAmphitheatre },
  // a separate mode, not picked at random: one wave of snipers on towers
  snipers: { name: "Снайперы на вышках", generate: generateSnipers, special: true },
};

// Picks a type from ?type=<id>, otherwise from the seed, so a seed always reproduces its arena.
// `biome` (optional) forces a biome; otherwise the seed picks one (home biome more often).
export function generateArena(seed, requested = null, biome = null) {
  const ids = Object.keys(ARENA_TYPES).filter((id) => !ARENA_TYPES[id].special);
  const id = ARENA_TYPES[requested] ? requested : ids[Math.floor(seededRandom(seed + "-type")() * ids.length)];
  const plan = ARENA_TYPES[id].generate(seed);
  plan.type = id;
  plan.typeName = ARENA_TYPES[id].name;
  applyBiome(plan, BIOMES[biome] ? biome : pickBiome(id, seededRandom(seed + "-biome")));
  return plan;
}

// Re-skin a plan: theme colours, lights and decor pools from the biome; type-specific rules (fill) stay.
export function applyBiome(plan, id) {
  const b = BIOMES[id];
  plan.biome = id;
  plan.biomeName = b.name;
  plan.theme = { ...plan.theme, id, ground: b.ground, platform: b.platform, lights: b.lights };
  if (Object.keys(b.swap).length)
    for (const m of plan.landmarks || []) if (b.swap[m.key]) m.key = b.swap[m.key];
  if (b.torches && !plan.torches) plan.torches = autoTorches(plan);
  // a night arena keeps its torches in other biomes only as unlit decoration would look odd: drop them
  if (!b.torches && plan.torches) delete plan.torches;
}
