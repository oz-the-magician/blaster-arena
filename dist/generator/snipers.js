// «Снайперы на вышках»: the ravine layout packed with cover; the game puts ~10 sniper towers on it
// (some down in the ravine) and runs a single wave: kill every sniper. See SNIPER / buildTowers in game.js.
import { generateWorld } from "./world.js";

export function generateSnipers(seed) {
  const plan = generateWorld(seed + "-snipers");
  plan.seed = String(seed);
  plan.snipers = 10;
  // much denser decoration: little open ground, lots to hide behind
  plan.theme = { ...plan.theme, fill: { deadDistance: 3.5, maxDead: 0.1, maxClusters: 52, repeat: 6 } };
  return plan;
}
