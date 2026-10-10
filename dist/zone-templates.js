// Local coordinates in metres. Templates reserve routes before decorations.
export const zoneTemplates = {
  // invisible anchor for custom maps without courtyards: no walls, props or routes (never generated)
  empty: { name: "Без двора", role: "anchor", extent: { w: 4, d: 4 }, ports: [], routes: [[0, 0]], walls: [], props: [], medkits: [] },
  bridges: {
    name: "Мосты над низиной",
    role: "narrow upper routes and open lower bypass",
    extent: { w: 26, d: 44 },
    ports: [
      [-12, 0],
      [12, 0],
      [0, 15],
    ],
    routes: [
      [0, 0],
      [-8, 0],
      [8, 0],
    ],
    walls: [],
    props: [
      ["dungeon/column", -4, -9, 2.8],
      ["dungeon/column", 4, 9, 2.8],
    ],
    skyPlatforms: [
      { x: -8, z: 0, w: 5, d: 18, h: 3 },
      { x: 8, z: 0, w: 5, d: 18, h: 3 },
      { x: 0, z: -8, w: 16, d: 5, h: 3 },
    ],
    ramps: [
      { x0: -8, z0: 22, x1: -8, z1: 9, width: 4, h: 3, rotation: Math.PI },
      { x0: 8, z0: 22, x1: 8, z1: 9, width: 4, h: 3, rotation: Math.PI },
    ],
    jumpPads: [{ x: 0, z: 5, y: 0, role: "escape", speed: 6, vertical: 11, model: "platformer/spring" }],
    medkits: [[-8, -3]],
  },
  quarter: {
    name: "Застроенный квартал",
    role: "close combat and interconnected alleys",
    extent: { w: 26, d: 24 },
    ports: [
      [-13, 0],
      [13, 0],
      [0, 12],
    ],
    routes: [
      [-11, 0],
      [0, 0],
      [11, 0],
      [0, 10],
    ],
    walls: [
      [-10, -10, -2, -10, 3.4],
      [-10, -10, -10, -3, 3.4],
      [-10, -3, -5, -3, 1.5],
      [2, -10, 10, -10, 3.4],
      [10, -10, 10, -3, 3.4],
      [5, -3, 10, -3, 1.5],
      [-10, 3, -10, 10, 3.4],
      [-10, 10, -2, 10, 3.4],
      [2, 10, 10, 10, 3.4],
      [10, 3, 10, 10, 3.4],
    ],
    props: [
      ["dungeon/barrel", -6, -6, 1.6],
      ["dungeon/chest", 6, 6, 1.5],
      ["dungeon/pot", 6, -7, 1.1],
    ],
    medkits: [[-6, 6]],
  },
  plaza: {
    name: "Открытая площадь",
    role: "long sightlines and isolated large cover",
    extent: { w: 28, d: 24 },
    ports: [
      [-14, 0],
      [14, 0],
      [0, 12],
    ],
    routes: [
      [-12, 0],
      [0, 0],
      [12, 0],
      [0, 10],
    ],
    walls: [
      [-8, -5, -3, -5, 2.4],
      [3, 5, 8, 5, 2.4],
      [-9, 7, -6, 7, 1.5],
      [6, -7, 9, -7, 1.5],
    ],
    props: [
      ["platformer/rocks", -8, -9, 3],
      ["platformer/crate", 8, 9, 1.7],
    ],
    medkits: [[0, -8]],
  },
  tower: {
    name: "Башня с обходом",
    role: "high firing position with two approaches",
    extent: { w: 40, d: 40 },
    ports: [
      [-20, 0],
      [0, -20],
      [12, 12],
    ],
    routes: [
      [0, 0],
      [-20, 0],
      [0, -20],
      [10, 10],
    ],
    walls: [
      [8, -5, 8, 5, 1.5],
      [-5, 8, 5, 8, 1.5],
    ],
    props: [
      ["dungeon/column", 10, -10, 3.2],
      ["dungeon/barrel", -8, 10, 1.5],
    ],
    platforms: [{ x: 0, z: 0, w: 10, d: 10, h: 4 }],
    ramps: [
      { x0: -20, z0: 0, x1: -5, z1: 0, width: 4, h: 4, rotation: Math.PI / 2 },
      { x0: 0, z0: -20, x1: 0, z1: -5, width: 4, h: 4, rotation: Math.PI },
    ],
    jumpPads: [{ x: 0, z: 1, y: 4, role: "attack", speed: 6, vertical: 9, model: "platformer/spring" }],
    medkits: [[0, 0]],
  },

  courtyard: {
    name: "Двор манёвров",
    role: "medium-range combat and two flanks",
    extent: { w: 30, d: 18 },
    ports: [
      [-15, 0],
      [15, 0],
      [0, 9],
    ],
    routes: [
      [-12, 0],
      [12, 0],
      [0, 7],
    ],
    walls: [
      [-15, -9, 15, -9, 3.4],
      [-15, -9, -15, -3, 3.4],
      [-15, 3, -15, 9, 1.5],
      [15, -9, 15, -3, 3.4],
      [15, 3, 15, 9, 1.5],
      [-15, 9, -4, 9, 1.5],
      [4, 9, 15, 9, 1.5],
      [-8, -3, -3, -3, 1.5],
      [3, 3, 8, 3, 1.5],
    ],
    props: [
      ["platformer/crate", -7, 4, 1.6],
      ["platformer/barrel", 7, -4, 1.3],
    ],
  },
  ruins: {
    name: "Руины с обходами",
    role: "close combat, doorway and alternate passage",
    extent: { w: 22, d: 28 },
    ports: [
      [11, 0],
      [0, 14],
    ],
    routes: [
      [0, -6],
      [0, 3],
      [9, -5],
    ],
    walls: [
      [-11, -14, 11, -14, 3.4],
      [-11, -14, -11, 14, 3.4],
      [-11, 14, -3, 14, 1.5],
      [3, 14, 11, 14, 3.4],
      [11, -14, 11, -3, 3.4],
      [11, 3, 11, 14, 3.4],
      [-11, 0, -3, 0, 3.4],
      [3, 0, 11, 0, 1.5],
    ],
    door: { x: 0, z: 0, w: 6, d: 1, h: 4 },
    props: [],
  },
  terraces: {
    name: "Вертикальный фланг",
    role: "elevated combat, stairs and aerial attack",
    extent: { w: 34, d: 58 },
    ports: [
      [-20, 4],
      [-16, 25],
    ],
    routes: [
      [0, 4],
      [8, 25],
    ],
    platforms: [
      { x: 0, z: 4, w: 20, d: 18, h: 2, model: "platformer/block-grass-large" },
      { x: 8, z: 25, w: 12, d: 12, h: 4, model: "platformer/block-grass-large" },
    ],
    ramps: [
      { x0: -20, z0: 4, x1: -10, z1: 4, width: 5, h: 2, rotation: Math.PI / 2 },
      { x0: -16, z0: 25, x1: 2, z1: 25, width: 4, h: 4, rotation: Math.PI / 2 },
      { x0: 0, z0: -3, x1: 0, z1: -15, width: 4, baseHeight: 2, h: 6, rotation: 0 },
      { x0: -19, z0: -20, x1: -7, z1: -20, width: 4, h: 6, rotation: Math.PI / 2 },
    ],
    skyPlatforms: [{ x: 0, z: -20, w: 14, d: 10, h: 6, model: "platformer/platform-fortified" }],
    jumpPads: [
      { x: -6, z: 5, y: 2, role: "flank", speed: 8, vertical: 13, model: "platformer/spring" },
      { x: 0, z: -20, y: 6, role: "attack", speed: 8, vertical: 9, model: "platformer/spring" },
    ],
    medkits: [
      [0, 4],
      [8, 25],
    ],
    walls: [],
    props: [],
  },
};
export const zoneInstances = [
  { template: "courtyard", x: 0, z: -65 },
  { template: "ruins", x: -64, z: -24 },
  { template: "terraces", x: 62, z: 0 },
  { template: "bridges", x: -62, z: 48 },
  { template: "quarter", x: -60, z: -64 },
  { template: "plaza", x: 43, z: -62 },
  { template: "tower", x: 55, z: 59 },
];
export function zoneLayout(instance) {
  const t = zoneTemplates[instance.template];
  if (!t) throw Error("Unknown zone template");
  const move = (p) => ({
    ...p,
    ...("x" in p
      ? { x: p.x + instance.x, z: p.z + instance.z }
      : { x0: p.x0 + instance.x, z0: p.z0 + instance.z, x1: p.x1 + instance.x, z1: p.z1 + instance.z }),
  });
  return {
    ...t,
    platforms: (t.platforms || []).map(move),
    ramps: (t.ramps || []).map(move),
    skyPlatforms: (t.skyPlatforms || []).map(move),
    jumpPads: (t.jumpPads || []).map(move),
    medkits: (t.medkits || []).map(([x, z]) => [x + instance.x, z + instance.z]),
    ports: t.ports.map(([x, z]) => [x + instance.x, z + instance.z]),
    spawns: t.routes.map(([x, z]) => [x + instance.x, z + instance.z]),
    routes: t.routes.map(([x, z]) => [x + instance.x, z + instance.z]),
  };
}
export function buildZoneTemplates({ T, model, commit, prop }) {
  for (const i of zoneInstances) {
    const t = zoneTemplates[i.template],
      parts = [];
    function piece(key, x, z, w, d, h, rot = 0) {
      const o = model(key, 1),
        s = new T.Box3().setFromObject(o).getSize(new T.Vector3());
      o.scale.set(w / s.x, h / s.y, d / s.z);
      o.position.set(x + i.x, 0, z + i.z);
      o.rotation.y = rot;
      o.userData.assembly = t.name;
      o.userData.walkableTop = h <= 1.5;
      o.userData.opening = key === "dungeon/wall-opening";
      parts.push(o);
    }
    for (const [x0, z0, x1, z1, h] of t.walls) {
      const length = Math.hypot(x1 - x0, z1 - z0),
        n = Math.ceil(length / 4);
      for (let k = 0; k < n; k++) {
        const f = (k + 0.5) / n;
        piece(
          h <= 1.5 ? "dungeon/wall-half" : "dungeon/wall",
          x0 + (x1 - x0) * f,
          z0 + (z1 - z0) * f,
          length / n,
          0.9,
          h,
          x0 === x1 ? Math.PI / 2 : 0,
        );
      }
    }
    if (t.door) {
      const d = t.door;
      piece("dungeon/wall-opening", d.x, d.z, d.w, d.d, d.h);
    }
    if (parts.length) commit(t.name, parts);
    for (const [key, x, z, size] of t.props) prop(key, x + i.x, z + i.z, size, 0, true);
  }
}
