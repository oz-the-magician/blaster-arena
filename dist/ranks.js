// Rank generator for the end-of-run screen. Edit the word tables freely:
// all nouns are masculine nominative, all adjectives masculine, so any adjective fits any noun.
// Formula: "<adjective by damage taken> <noun by weapon class>"; on the heaviest damage step:
// "<Noun>, <tail phrase>". A bright feat replaces the adjective. The choice is random but
// deterministic for a run (seeded by the run's statistics).

export const RANK_NOUNS = {
  smg: ["скорострел", "пулемётчик", "свинцовый дождь", "тарахтун"],
  rifle: ["снайпер", "стрелок", "глазомер", "меткач"],
  shotgun: ["дуэлянт", "громила", "дробовой маньяк", "хозяин ближнего боя"],
  rocket: ["подрывник", "пиротехник", "ходячий фейерверк", "разрушитель"],
  laser: ["лучник будущего", "лазерный жнец", "светоносец", "физик-практик"],
  blade: ["самурай", "мясник с плазмой", "джедай-самоучка", "резчик"],
  mixed: ["мастер на все руки", "коллекционер стволов", "универсал", "хаотичный стрелок"],
};
// Damage steps: [max damage taken, adjectives]. The last step uses tail phrases instead.
export const RANK_DAMAGE = [
  [60, ["Неуязвимый", "Неуловимый", "Нетронутый", "Безупречный"]],
  [200, ["Хладнокровный", "Собранный", "Опытный", "Расчётливый"]],
  [450, ["Потрёпанный", "Помятый", "Закалённый", "Упрямый"]],
];
export const RANK_TAILS = ["почти мёртв, но не сломлен", "держится на честном слове", "собран из запчастей", "отказался умирать"];
// Feats: [stat key, how many count as "bright", adjective]
export const RANK_FEATS = [
  ["dash", 3, "Таранный"],
  ["barrel", 2, "Огнеопасный"],
  ["moat", 2, "Знакомый с кольями"],
  ["air", 2, "Летучий"],
  ["combo", 10, "Неудержимый"], // best combo (kills in a row without damage)
];
// weapon kind (weapons.js) → class key
export const KIND_CLASS = ["rifle", "shotgun", "smg", "rocket", "laser", "blade"];
export const CLASS_NAMES = { smg: "ПП", rifle: "Винтовки", shotgun: "Дробовики", rocket: "Ракеты", laser: "Лазеры", blade: "Клинок" };

function hash(values) {
  let h = 2166136261;
  for (const ch of values.join("|")) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}
const capital = (s) => s[0].toUpperCase() + s.slice(1);

// stats: { classKills: {rifle: n, …}, damage, feats: {dash, barrel, moat, air}, kills, shots, hits, time }
export function makeRank(stats) {
  const total = Object.values(stats.classKills).reduce((a, b) => a + b, 0),
    [top, topKills] = Object.entries(stats.classKills).sort((a, b) => b[1] - a[1])[0] || ["mixed", 0],
    cls = total && topKills / total > 0.5 ? top : "mixed",
    seed = hash([stats.kills, stats.damage, stats.shots, stats.hits, Math.round(stats.time), cls]),
    pick = (list, salt) => list[(seed >>> salt) % list.length],
    noun = pick(RANK_NOUNS[cls], 0),
    feat = RANK_FEATS.map(([key, need, word]) => [(stats.feats[key] || 0) / need, word])
      .filter(([score]) => score >= 1)
      .sort((a, b) => b[0] - a[0])[0]?.[1],
    step = RANK_DAMAGE.find(([max]) => stats.damage < max);
  if (step) return (feat || pick(step[1], 3)) + " " + noun;
  return (feat ? feat + " " + noun : capital(noun)) + ", " + pick(RANK_TAILS, 6);
}
