// Biomes: the look of an arena, independent of its layout. Any arena type can come in any biome;
// each type keeps a "home" biome that the seed picks more often.
//   ground / platform — floor and stone colours; lights — light presets to pick from;
//   swap — model replacements for type-specific scenery (e.g. pines become palms in the desert).
// Palette (engine/ground-paint.js), relief style (engine/relief.js), cluster pool and fill list
// (generator/decorate.js) are all looked up by the biome id.
export const BIOMES = {
  desert: {
    name: "Пустыня",
    ground: 0xc5965e,
    platform: 0xb09372,
    lights: ["noon", "sunset"],
    swap: {
      "platformer/tree-pine-small": "pirate/palm-straight",
      "platformer/tree": "pirate/palm-bend",
      "nature/tree_pineTallA": "pirate/palm-straight",
      "nature/tree_default": "pirate/palm-bend",
      "platformer/flowers": "nature/cactus_short",
      "platformer/plant": "pirate/grass-plant",
      "nature/rock_largeA": "pirate/rocks-sand-a",
    },
  },
  meadow: { name: "Луг", ground: 0x7f9c55, platform: 0x98a0a8, lights: ["noon", "sunset"], swap: {} },
  ruins: { name: "Руины", ground: 0x7d8a5a, platform: 0x8e9095, lights: ["sunset", "noon"], swap: {} },
  night: { name: "Ночь", ground: 0x5e5546, platform: 0x6c6a72, lights: ["night"], swap: {}, torches: true },
};
export const HOME_BIOME = { ravine: "desert", fortresses: "meadow", hill: "ruins", amphitheatre: "night", snipers: "desert", islands: "meadow", maze: "ruins" };

// home biome 40 %, every other biome 20 %
export function pickBiome(type, random) {
  const home = HOME_BIOME[type] || "meadow",
    ids = Object.keys(BIOMES),
    others = ids.filter((id) => id !== home),
    r = random();
  return r < 0.4 ? home : others[Math.min(others.length - 1, Math.floor(((r - 0.4) / 0.6) * others.length))];
}

// Torches for a night biome on arena types that do not place their own: on the corners of raised
// platforms and terraces (well inside the edge walls) and along ground roads, 3.5 m to the side.
export function autoTorches(plan) {
  const torches = [],
    far = (x, z, d) => torches.every((t) => Math.hypot(t.x - x, t.z - z) > d);
  for (const p of plan.skyPlatforms || []) {
    if (p.h <= 0 || p.w < 8 || p.d < 8 || p.landing) continue;
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const x = p.x + sx * (p.w / 2 - 2.4),
          z = p.z + sz * (p.d / 2 - 2.4);
        if (far(x, z, 10)) torches.push({ x, z, kind: "torch", light: false });
      }
  }
  for (const r of plan.coreRoutes || []) {
    if (r.role !== "main") continue;
    for (let i = 1; i < r.points.length; i++) {
      const [ax, ah, az] = r.points[i - 1],
        [bx, , bz] = r.points[i],
        len = Math.hypot(bx - ax, bz - az);
      if (Math.abs(ah) > 0.5 || len < 12) continue;
      for (let s = 8; s < len - 4; s += 22) {
        const side = (s / 22) % 2 < 1 ? 1 : -1,
          x = ax + ((bx - ax) * s) / len + (-(bz - az) / len) * 3.5 * side,
          z = az + ((bz - az) * s) / len + ((bx - ax) / len) * 3.5 * side;
        if (far(x, z, 12)) torches.push({ x, z, kind: "torch", light: false });
      }
    }
  }
  // a warm light on every third torch, braziers at the courtyards
  torches.forEach((t, i) => (t.light = i % 3 === 0));
  for (const z of plan.zones || []) torches.push({ x: z.x, z: z.z + 0.5, kind: "brazier", light: true, optional: true });
  return torches.slice(0, 40);
}
