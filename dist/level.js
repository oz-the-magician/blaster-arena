import { applyPadTier } from "./engine/jump-pad.js";
import { zoneInstances, zoneLayout } from "./zone-templates.js";
// One authored fort: a sheltered ravine, courts on its banks, connected roofs.
export const pit = { x: 0, z: 0, w: 16, d: 50, h: -3 };
export const platforms = [
  { x: -22, z: -20, w: 16, d: 12, h: 2 },
  { x: 22, z: 28, w: 16, d: 12, h: 3 },
  { x: 24, z: -20, w: 16, d: 24, h: 1.2 },
];
export const ramps = [
  { x0: -6, z0: -20, x1: -14, z1: -20, width: 6, h: 2, rotation: Math.PI / 2 },
  { x0: 40, z0: 28, x1: 30, z1: 28, width: 5, h: 3, rotation: Math.PI / 2 },
  { x0: 8, z0: -19, x1: 16, z1: -19, width: 6, h: 1.2, rotation: -Math.PI / 2 },
  { x0: 0, z0: -37, x1: 0, z1: -25, width: 5, h: -3, rotation: 0 },
  { x0: 0, z0: 37, x1: 0, z1: 25, width: 5, h: -3, rotation: Math.PI },
  { x0: -20, z0: 14, x1: -8, z1: 14, width: 5, h: -3, rotation: -Math.PI / 2 },
  { x0: 20, z0: -5, x1: 8, z1: -5, width: 5, h: -3, rotation: Math.PI / 2 },
  { x0: -24, z0: 30, x1: -24, z1: 11, width: 5, h: 6, rotation: 0 },
  { x0: 24, z0: 30, x1: 24, z1: 11, width: 5, baseHeight: 3, h: 6, rotation: 0 },
  { x0: -24, z0: -11, x1: -24, z1: -19, width: 4, baseHeight: 6, h: 9, rotation: 0 },
  { x0: -48, z0: -24, x1: -31, z1: -24, width: 4, h: 9, rotation: Math.PI / 2 },
  { x0: -8, z0: -28, x1: -8, z1: -39, width: 2.5, h: 6, rotation: 0 },
  { x0: 8, z0: -28, x1: 8, z1: -39, width: 2.5, h: 6, rotation: 0 },
];
export const skyPlatforms = [
  // Ground-level crossing has a genuine lower passage beneath it.
  { x: 0, z: 20, w: 22, d: 7, h: 0 },
  { x: -24, z: 0, w: 20, d: 22, h: 6 },
  { x: 24, z: 0, w: 20, d: 22, h: 6 },
  { x: 0, z: 0, w: 30, d: 6, h: 6 },
  { x: -24, z: -24, w: 14, d: 10, h: 9 },
  { x: -8, z: -42, w: 6, d: 6, h: 6 },
  { x: 8, z: -42, w: 6, d: 6, h: 6 },
];
export const jumpPads = [
  { x: 0, z: -7, y: -3, role: "escape", speed: 7, vertical: 14 },
  { x: 0, z: 7, y: -3, role: "escape", speed: 7, vertical: 14 },
  { x: -24, z: 5, y: 6, role: "flank", speed: 8, vertical: 10 },
  { x: 24, z: 5, y: 6, role: "flank", speed: 8, vertical: 10 },
  { x: -24, z: -24, y: 9, role: "attack", speed: 7, vertical: 9 },
  { x: -11, z: 0, y: 6, role: "transfer", speed: 16, vertical: 11 },
  { x: 11, z: 0, y: 6, role: "transfer", speed: 16, vertical: 11 },
];
export let ARENA_LIMIT = 80;
export const extraMedkits = [[-64, 20], [0, 64], ...zoneLayout(zoneInstances[2]).medkits];
platforms.push(
  { x: -64, z: 20, w: 16, d: 16, h: 2, model: "dungeon/floor-detail" },
  { x: 0, z: 64, w: 26, d: 14, h: 1.5, model: "platformer/block-grass-large" },
);
ramps.push(
  { x0: -44, z0: 20, x1: -56, z1: 20, width: 5, h: 2, rotation: -Math.PI / 2 },
  { x0: 0, z0: 46, x1: 0, z1: 57, width: 5, h: 1.5, rotation: Math.PI },
);
const verticalZone = zoneLayout(zoneInstances[2]);
platforms.push(...verticalZone.platforms);
ramps.push(...verticalZone.ramps);
skyPlatforms.push(...verticalZone.skyPlatforms);
skyPlatforms.sort((a, b) => b.h - a.h);
jumpPads.push(
  { x: -64, z: 22, y: 2, role: "escape", speed: 7, vertical: 13, model: "platformer/spring" },
  { x: -10, z: 64, y: 1.5, role: "transfer", speed: 9, vertical: 10, model: "platformer/spring" },
  ...verticalZone.jumpPads,
);

for (const instance of zoneInstances.slice(3)) {
  const zone = zoneLayout(instance);
  platforms.push(...zone.platforms);
  ramps.push(...zone.ramps);
  skyPlatforms.push(...zone.skyPlatforms);
  jumpPads.push(...zone.jumpPads);
  extraMedkits.push(...zone.medkits);
}
skyPlatforms.sort((a, b) => b.h - a.h);

// Continuous lanes reserve space before any loose scenery or supplies are placed.
export const coreRoutes = [
  {
    role: "lower",
    points: [
      [4, -3, -22],
      [4, -3, 22],
    ],
  },
  {
    role: "main",
    points: [
      [-45, 0, -45],
      [0, 0, -45],
      [35, 0, -45],
    ],
  },
  {
    role: "main",
    points: [
      [-40, 0, 20],
      [-12, 0, 20],
      [12, 0, 20],
      [40, 0, 20],
    ],
  },
  {
    role: "main",
    points: [
      [-40, 0, 38],
      [0, 0, 38],
      [40, 0, 38],
    ],
  },
  {
    role: "upper",
    points: [
      [-24, 6, -10],
      [-24, 6, 0],
      [24, 6, 0],
      [24, 6, 10],
    ],
  },
  {
    role: "upper",
    points: [
      [-30, 9, -24],
      [-24, 9, -24],
      [-24, 9, -20],
    ],
  },
  {
    role: "upper",
    points: [
      [-8, 6, -39],
      [-8, 6, -44],
    ],
  },
  {
    role: "upper",
    points: [
      [8, 6, -39],
      [8, 6, -44],
    ],
  },
  {
    role: "upper",
    points: [
      [55, 6, -20],
      [62, 6, -20],
      [62, 6, -15],
    ],
  },
];

export let generatedPlan = null;
export function initializeGeneratedLevel(plan) {
  generatedPlan = plan;
  // Arenas without a ravine get a zero-size pit, which every consumer treats as absent.
  Object.assign(pit, plan.pit || { x: 0, z: 0, w: 0, d: 0, h: 0 });
  platforms.splice(0, platforms.length, ...plan.platforms);
  ramps.splice(0, ramps.length, ...plan.ramps);
  skyPlatforms.splice(0, skyPlatforms.length, ...plan.skyPlatforms);
  jumpPads.splice(0, jumpPads.length, ...plan.jumpPads.map(applyPadTier));
  coreRoutes.splice(0, coreRoutes.length, ...plan.coreRoutes);
  extraMedkits.splice(0, extraMedkits.length, ...plan.medkits);
  zoneInstances.splice(0, zoneInstances.length, ...plan.zones);
  ARENA_LIMIT = plan.limit;
}
