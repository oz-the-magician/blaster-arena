// Arsenal: three base classes, fifteen generated variants, rockets and laser.
// Pure data; game.js imports it. SPEED_SCALE is the global movement multiplier.
// Global movement multiplier for the player (walk/sprint) and bots.
export const SPEED_SCALE = 1.15;
export const weapons = [
  {
    name: "ИМПУЛЬС",
    model: "blaster-b",
    mag: 16,
    rate: 0.32,
    damage: 44,
    pellets: 1,
    spread: 0.005,
    reload: 1.15,
    range: 38,
    color: 0x48e7ff,
    description: "ТОЧНАЯ ВИНТОВКА · прошивает двух врагов",
    use: "Дальний бой и противники в линию",
    pierce: 2,
    speed: 44,
  },
  {
    name: "ГРОМ",
    model: "blaster-n",
    mag: 6,
    rate: 0.65,
    damage: 16,
    pellets: 9,
    spread: 0.48,
    reload: 1.65,
    range: 12,
    color: 0xffa42b,
    description: "ДРОБОВИК · широкий залп и отбрасывание",
    use: "Сблизься: больше дроби попадёт в цель",
    pierce: 1,
    speed: 30,
  },
  {
    name: "СПЕКТР",
    model: "blaster-f",
    mag: 36,
    rate: 0.075,
    damage: 12,
    pellets: 1,
    spread: 0.075,
    reload: 1.3,
    range: 26,
    color: 0xd383ff,
    description: "АВТОМАТ · быстрая очередь замедляет врага",
    use: "Стреляй на ходу и сдерживай натиск",
    pierce: 1,
    speed: 36,
  },
];
weapons.forEach((w, i) => {
  w.kind = i;
  w.length = [1.45, 1.3, 1.55][i];
  w.grip = [0.08, 0.04, 0.1][i];
});
const extraModels = ["a", "c", "d", "e", "g", "h", "i", "j", "k", "l", "m", "o", "p", "q", "r"];
const extraNames = [
  "ИСКРА",
  "ДУЭЛЯНТ",
  "ВЕКТОР",
  "ШТОРМ",
  "ПУЛЬС",
  "ОСА",
  "БУРЯ",
  "РАЗРЯД",
  "ОХОТНИК",
  "КОБРА",
  "ТИТАН",
  "ЗАЛП",
  "СТРЕЛА",
  "РАЗЛОМ",
  "ФАНТОМ",
];
extraModels.forEach((letter, i) => {
  const kind = i % 3,
    base = weapons[kind],
    factor = [0.8, 1, 1.2, 1.4, 0.9][Math.floor(i / 3)];
  weapons.push({
    ...base,
    name: extraNames[i],
    model: "blaster-" + letter,
    kind,
    length: kind === 1 ? 1.3 : 1.45,
    grip: 0.08,
    damage: Math.round(base.damage * factor),
    rate: base.rate * factor,
    mag: Math.max(4, Math.round(base.mag / factor)),
    range: Math.round(base.range * (0.85 + (i % 5) * 0.08)),
    description: base.description + " · " + (factor > 1 ? "тяжёлый" : "быстрый") + " вариант",
  });
});
// Distinct weapon classes: 3 = rockets, 4 = penetrating laser.
Object.assign(
  weapons.find((w) => w.name === "ЗАЛП"),
  {
    kind: 3,
    mag: 3,
    rate: 1.35,
    damage: 85,
    pellets: 4,
    spread: 0.42,
    reload: 2.6,
    range: 45,
    speed: 22,
    pierce: 1,
    blastRadius: 4.5,
    color: 0xff593c,
    description: "РАКЕТНИЦА · четыре ракеты и взрыв по области",
    use: "Группы врагов · 3 залпа · держи дистанцию",
  },
);
Object.assign(
  weapons.find((w) => w.name === "ШТОРМ"),
  {
    kind: 4,
    mag: 40,
    rate: 0.14,
    damage: 12,
    pellets: 1,
    spread: 0,
    reload: 1.8,
    range: 95,
    speed: 150,
    pierce: Infinity,
    color: 0x7dffbd,
    description: "ЛАЗЕР · точный луч пробивает врагов и стены",
    use: "Дальний бой и цели в линию · низкий урон",
  },
);
// КОБРА: double-barrel shotgun. Each trigger pull fires both barrels (two slugs); after `split.after` metres
// every slug bursts into `split.count` small pellets in a cone of `split.spread` radians.
Object.assign(
  weapons.find((w) => w.name === "КОБРА"),
  {
    kind: 1,
    mag: 2,
    rate: 0.32,
    damage: 14,
    pellets: 2,
    spread: 0.07,
    split: { count: 6, after: 3.5, spread: 0.34 },
    reload: 1.7,
    range: 15,
    speed: 34,
    pierce: 1,
    length: 1.3,
    description: "ДВУСТВОЛКА · два заряда, каждый раскрывается в 6 дробин",
    use: "Ближний бой · 2 выстрела · перезарядка после дуплета",
  },
);
// ПУЛЬС: laser rifle. Instant beam like ШТОРМ, but slow and heavy: stops at the first wall and the first enemy.
Object.assign(
  weapons.find((w) => w.name === "ПУЛЬС"),
  {
    kind: 4,
    beam: "pulse",
    wallStop: true,
    mag: 6,
    rate: 1.15,
    damage: 110,
    pellets: 1,
    spread: 0,
    reload: 2.1,
    range: 48,
    speed: 150,
    pierce: 1,
    length: 1.45,
    color: 0xff4fd8,
    description: "ЛАЗЕРНАЯ ВИНТОВКА · короткий мощный импульс",
    use: "Один точный выстрел · стены и первая цель держат луч",
  },
);
// ОХОТНИК: plasma blade (kind 5, melee). `mag` is the charge (0–100).
// Hold fire: the blade burns and drains `drain` charge per second; every enemy or breakable touching it
// (within `range` metres in an `arc` in front) takes `damage` each `tick` seconds.
// Release: after `regenDelay` the charge refills at `regen` per second. The blade works at any charge above zero,
// also while it is refilling — it just runs out again sooner. No reload.
Object.assign(
  weapons.find((w) => w.name === "ОХОТНИК"),
  {
    kind: 5,
    mag: 100,
    rate: 0.25,
    tick: 0.25,
    damage: 40,
    pellets: 1,
    spread: 0,
    reload: 0,
    range: 2.6,
    arc: 1.4,
    drain: 12,
    regen: 5,
    regenDelay: 0.4,
    pierce: Infinity,
    speed: 0,
    length: 1.3,
    color: 0xff5a1f,
    description: "ПЛАЗМЕННЫЙ КЛИНОК · ближний бой на заряде",
    use: "Держи огонь — лезвие режет всех, кого касается · заряд копится сам, долго",
  },
);
// v91 sound pass: reload times follow the reload sounds.
// ДУЭЛЯНТ loads 8 shells one by one (reload-shotgun-8, 3.7 s): longer reload, stronger pellets to keep its DPS.
Object.assign(weapons.find((w) => w.name === "ДУЭЛЯНТ"), { reload: 3.8, damage: 15 });
// rifles: the reload sound runs ~1.2 s
for (const w of weapons) if (w.kind === 0) w.reload = 1.25;
// Weapon tiers: tier N unlocks with wave N (bots, arena racks and sky drops only use open tiers).
const WEAPON_TIERS = {
  1: ["СПЕКТР", "ВЕКТОР", "ОСА", "ФАНТОМ", "ИМПУЛЬС", "ИСКРА"],
  2: ["ГРОМ", "РАЗЛОМ", "РАЗРЯД", "ТИТАН", "ДУЭЛЯНТ", "КОБРА", "СТРЕЛА", "БУРЯ"],
  3: ["ЗАЛП", "ПУЛЬС", "ШТОРМ", "ОХОТНИК"],
};
for (const [tier, names] of Object.entries(WEAPON_TIERS))
  for (const name of names) weapons.find((w) => w.name === name).tier = Number(tier);
