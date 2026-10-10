// Arena editor (open the game with ?editor). A top-down map of the arena: draw platforms (levels 1–3),
// stairs, walls, pads, courtyards, catalogue clusters, torches and spawns; check the map; export the JSON
// or press «ИГРАТЬ» to load it straight into the game (same page, so it works in the published file too).
// The map is the "blaster-arena-map" format from generator/custom-map.js.
import { CLUSTERS } from "../generator/clusters.js";
import { BIOMES } from "../generator/biomes.js";
import { zoneTemplates } from "../zone-templates.js";
import { validateMap } from "../generator/custom-map.js";

const LEVELS = [
  { h: 0, name: "Земля", color: "#5d7a46" },
  { h: 3, name: "Уровень 1 · 3 м", color: "#8c8f96" },
  { h: 6, name: "Уровень 2 · 6 м", color: "#a9adb5" },
  { h: 9, name: "Уровень 3 · 9 м", color: "#c9ccd2" },
];
const PAD_TIERS = { spring: "#f2efe6", springHigh: "#ffffff", blue: "#39b5ff", yellow: "#ffc233" };
const TOOLS = [
  ["select", "V", "Выбор и перемещение"],
  ["transform", "E", "Трансформация: поворот и размер"],
  ["platform", "P", "Платформа"],
  ["stairs", "S", "Лестница"],
  ["wall", "W", "Стена"],
  ["pad", "J", "Прыжковый пад"],
  ["zone", "Z", "Двор"],
  ["cluster", "C", "Сборка"],
  ["torch", "T", "Факел"],
  ["pit", "H", "Яма (одна)"],
  ["moat", "M", "Ров с кольями"],
  ["start", "G", "Старт игрока"],
  ["spawn", "X", "Появление врагов"],
];
const LIGHTS = [["", "Авто по биому"], ["noon", "Полдень"], ["sunset", "Закат"], ["overcast", "Пасмурно"], ["dusk", "Сумерки"], ["night", "Ночь"]];
const STORE = "blaster-editor-map";

const blank = () => ({
  format: "blaster-arena-map",
  version: 1,
  name: "Моя арена",
  biome: "meadow",
  limit: 110,
  fill: true,
  platforms: [],
  stairs: [],
  pads: [],
  walls: [],
  zones: [],
  clusters: [],
  props: [],
  torches: [],
  spawns: [],
});

export function startEditor() {
  // the editor is the same page as the game: drop the game's styles (fixed canvas, header, HUD…) first
  document.querySelectorAll('style, link[rel="stylesheet"]').forEach((n) => n.remove());
  document.body.innerHTML = "";
  document.body.className = "editor";
  document.title = "Редактор арен · Blaster Arena";
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
  document.body.innerHTML = HTML;
  const $ = (s) => document.querySelector(s);

  // ---------- state ----------
  let map = load() || blank(),
    tool = "select",
    selected = null, // { kind, index }
    level = 1,
    padTier = "blue",
    zoneTemplate = "courtyard",
    clusterId = Object.keys(CLUSTERS)[0],
    snap = 1,
    view = { x: 0, z: 0, scale: 3.2 }, // px per metre
    drag = null,
    issues = [];
  let group = []; // multi-selection: [{ kind, index }], the primary `selected` is one of them
  let mode = "top"; // top | sideX | sideZ
  let clipboard = null;
  // object lists by kind (the pit and the player start are single objects in the map)
  const list = (kind) =>
    kind === "pit" ? (map.pit ? [map.pit] : []) : kind === "start" ? (map.playerStart ? [map.playerStart] : []) : kind === "moat" ? (map.moat ||= []) : map[kind];
  const item = (ref) => ref && list(ref.kind)[ref.index];
  const removeItems = (refs) => {
    // remove from the highest index down so earlier indices stay valid
    for (const r of [...refs].sort((a, b) => b.index - a.index)) {
      if (r.kind === "pit") delete map.pit;
      else if (r.kind === "start") delete map.playerStart;
      else list(r.kind).splice(r.index, 1);
    }
    group = [];
    selected = null;
  };
  const addItem = (kind, obj) => {
    if (RESTING.includes(kind) && obj.y === undefined) settle(kind, obj, Infinity);
    if (kind === "pit") return (map.pit = obj), { kind, index: 0 };
    if (kind === "start") return (map.playerStart = obj), { kind, index: 0 };
    list(kind).push(obj);
    return { kind, index: list(kind).length - 1 };
  };
  const inGroup = (kind, index) => group.some((g) => g.kind === kind && g.index === index);
  const selectOnly = (ref) => ((selected = ref), (group = ref ? [ref] : []));
  const anchor = (o) => ("x0" in o ? [(o.x0 + o.x1) / 2, (o.z0 + o.z1) / 2] : [o.x, o.z]);
  const shift = (o, dx, dz) => ("x0" in o ? Object.assign(o, { x0: o.x0 + dx, z0: o.z0 + dz, x1: o.x1 + dx, z1: o.z1 + dz }) : Object.assign(o, { x: o.x + dx, z: o.z + dz }));
  const KINDS = ["platforms", "stairs", "walls", "pads", "zones", "clusters", "torches", "spawns", "moat", "pit", "start"];
  const history = [JSON.stringify(map)];
  const commit = () => {
    const s = JSON.stringify(map);
    if (history[history.length - 1] !== s) history.push(s);
    if (history.length > 80) history.shift();
    save();
    check();
    panel();
    draw();
  };
  function load() {
    try {
      return JSON.parse(localStorage.getItem(STORE) || "null");
    } catch {
      return null;
    }
  }
  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify(map));
    } catch {}
  }

  // ---------- geometry helpers ----------
  const canvas = $("#map"),
    ctx = canvas.getContext("2d");
  const toScreen = (x, z) => [canvas.width / 2 + (x - view.x) * view.scale * devicePixelRatio, canvas.height / 2 + (z - view.z) * view.scale * devicePixelRatio];
  const toWorld = (px, py) => [view.x + (px * devicePixelRatio - canvas.width / 2) / (view.scale * devicePixelRatio), view.z + (py * devicePixelRatio - canvas.height / 2) / (view.scale * devicePixelRatio)];
  const sn = (v) => Math.round(v / snap) * snap;
  const platformH = (p) => p.h ?? LEVELS[p.level]?.h ?? 3;
  const heightAt = (x, z) => {
    if (map.pit && Math.abs(x - map.pit.x) <= map.pit.w / 2 && Math.abs(z - map.pit.z) <= map.pit.d / 2) {
      let h = map.pit.h ?? -5;
      for (const p of map.platforms) if (Math.abs(x - p.x) <= p.w / 2 && Math.abs(z - p.z) <= p.d / 2) h = Math.max(h, platformH(p));
      return h;
    }
    let h = 0;
    for (const p of map.platforms) if (Math.abs(x - p.x) <= p.w / 2 && Math.abs(z - p.z) <= p.d / 2) h = Math.max(h, platformH(p));
    return h;
  };
  const clusterRadius = (id, scale = 1) => (CLUSTERS[id]?.radius ?? 5) * scale;
  // the first surface at or below height y (same rule as the game): ground / pit / moat floor, stair-free;
  // platform tops at or below y; inside a solid block → that block's top
  const surfaceBelow = (x, z, y = Infinity) => {
    let h = 0;
    if (map.pit && Math.abs(x - map.pit.x) <= map.pit.w / 2 && Math.abs(z - map.pit.z) <= map.pit.d / 2) h = map.pit.h ?? -5;
    if ((map.moat || []).some((m) => Math.abs(x - m.x) <= m.w / 2 && Math.abs(z - m.z) <= m.d / 2)) h = -4;
    for (const p of map.platforms) {
      if (Math.abs(x - p.x) > p.w / 2 || Math.abs(z - p.z) > p.d / 2) continue;
      const top = platformH(p),
        solid = !p.slab && p.solid !== false;
      if (top <= y + 0.001) h = Math.max(h, top);
      else if (solid && (p.base ?? 0) <= y + 0.001) h = Math.max(h, top);
    }
    return h;
  };
  // objects that rest on a surface; their y snaps to the surface below the wanted height
  const RESTING = ["walls", "clusters", "pads", "torches", "spawns", "start"];
  const settle = (kind, o, wanted = o.y ?? Infinity) => {
    if (!RESTING.includes(kind)) return;
    const [x, z] = "x0" in o ? [(o.x0 + o.x1) / 2, (o.z0 + o.z1) / 2] : [o.x, o.z];
    o.y = surfaceBelow(x, z, wanted);
  };

  // ---------- drawing ----------
  function resize() {
    const r = canvas.getBoundingClientRect();
    canvas.width = r.width * devicePixelRatio;
    canvas.height = r.height * devicePixelRatio;
    draw();
  }
  function draw() {
    if (mode !== "top") return drawSide();
    const k = view.scale * devicePixelRatio,
      L = map.limit ?? 110;
    ctx.fillStyle = "#1b1426";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // ground and grid
    const [gx, gy] = toScreen(-L, -L);
    ctx.fillStyle = BIOME_GROUND[map.biome] || "#5d7a46";
    ctx.fillRect(gx, gy, 2 * L * k, 2 * L * k);
    ctx.strokeStyle = "#ffffff14";
    ctx.lineWidth = 1;
    const step = view.scale > 5 ? 2 : view.scale > 2.5 ? 4 : 10;
    for (let v = -L; v <= L; v += step) {
      const [a, b] = toScreen(v, -L),
        [c, d] = toScreen(-L, v);
      ctx.beginPath();
      ctx.moveTo(a, b);
      ctx.lineTo(a, b + 2 * L * k);
      ctx.moveTo(c, d);
      ctx.lineTo(c + 2 * L * k, d);
      ctx.stroke();
    }
    ctx.strokeStyle = "#ffffff55";
    ctx.lineWidth = 2;
    ctx.strokeRect(gx, gy, 2 * L * k, 2 * L * k);
    const bad = new Set(issues.map((i) => i.kind + i.index));
    const outline = (kind, index) => {
      if (inGroup(kind, index)) return "#71eaff";
      return bad.has(kind + index) ? "#ff4d6a" : null;
    };
    // pit / moat
    for (const [kind, r, i] of [...(map.pit?.w ? [["pit", map.pit, 0]] : []), ...(map.moat || []).map((m, j) => ["moat", m, j])]) {
      const [x, y] = toScreen(r.x - r.w / 2, r.z - r.d / 2);
      ctx.fillStyle = kind === "pit" ? "#2a2420" : "#1a1a22";
      ctx.fillRect(x, y, r.w * k, r.d * k);
      if (kind === "moat" && view.scale > 2.5) {
        ctx.fillStyle = "#7a5432";
        for (let sx = r.x - r.w / 2 + 1; sx < r.x + r.w / 2; sx += 1.6)
          for (let sz = r.z - r.d / 2 + 1; sz < r.z + r.d / 2; sz += 1.6) {
            const [px, py] = toScreen(sx, sz);
            ctx.fillRect(px - 1.5, py - 1.5, 3, 3);
          }
      }
      ctx.strokeStyle = outline(kind, i) || "#000";
      ctx.lineWidth = outline(kind, i) ? 3 : 1;
      ctx.strokeRect(x, y, r.w * k, r.d * k);
      label(kind === "pit" ? "яма " + (r.h ?? -5) + " м" : "ров", r.x, r.z, "#ffffffaa");
    }
    // zones
    map.zones.forEach((zn, i) => {
      const e = zoneTemplates[zn.template]?.extent || { w: 26, d: 26 },
        [x, y] = toScreen(zn.x - e.w / 2, zn.z - e.d / 2);
      ctx.fillStyle = "#ffffff12";
      ctx.fillRect(x, y, e.w * k, e.d * k);
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = outline("zones", i) || "#ffffff66";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, e.w * k, e.d * k);
      ctx.setLineDash([]);
      label(zoneTemplates[zn.template]?.name || zn.template, zn.x, zn.z - e.d / 2 + 2, "#ffffffaa");
    });
    // platforms (lower first)
    map.platforms
      .map((p, i) => [p, i])
      .sort((a, b) => platformH(a[0]) - platformH(b[0]))
      .forEach(([p, i]) => {
        const h = platformH(p),
          lv = LEVELS.findIndex((l) => l.h === h),
          [x, y] = toScreen(p.x - p.w / 2, p.z - p.d / 2);
        ctx.fillStyle = p.slab || p.solid === false ? "#b08a5c" : lv >= 0 ? LEVELS[lv].color : "#9aa0a8";
        ctx.fillRect(x, y, p.w * k, p.d * k);
        ctx.fillStyle = "#00000033";
        ctx.fillRect(x, y + p.d * k - 3 * devicePixelRatio, p.w * k, 3 * devicePixelRatio);
        ctx.strokeStyle = outline("platforms", i) || "#00000066";
        ctx.lineWidth = outline("platforms", i) ? 3 : 1;
        ctx.strokeRect(x, y, p.w * k, p.d * k);
        label(h + " м", p.x, p.z, "#1b1426", true);
        if (group.length === 1 && selected?.kind === "platforms" && selected.index === i) handles(p);
      });
    // stairs
    map.stairs.forEach((s, i) => {
      const dx = s.x1 - s.x0,
        dz = s.z1 - s.z0,
        len = Math.hypot(dx, dz) || 1,
        nx = -dz / len,
        nz = dx / len,
        w = (s.width ?? 4) / 2,
        pts = [
          [s.x0 + nx * w, s.z0 + nz * w],
          [s.x1 + nx * w, s.z1 + nz * w],
          [s.x1 - nx * w, s.z1 - nz * w],
          [s.x0 - nx * w, s.z0 - nz * w],
        ].map(([x, z]) => toScreen(x, z));
      ctx.fillStyle = "#d9a86a";
      ctx.beginPath();
      pts.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#7a5432";
      ctx.lineWidth = 1;
      const steps = Math.max(2, Math.round(len / 0.8));
      for (let t = 1; t < steps; t++) {
        const f = t / steps,
          a = toScreen(s.x0 + dx * f + nx * w, s.z0 + dz * f + nz * w),
          b = toScreen(s.x0 + dx * f - nx * w, s.z0 + dz * f - nz * w);
        ctx.beginPath();
        ctx.moveTo(...a);
        ctx.lineTo(...b);
        ctx.stroke();
      }
      ctx.strokeStyle = outline("stairs", i) || "#5a3a20";
      ctx.lineWidth = outline("stairs", i) ? 3 : 1.5;
      ctx.beginPath();
      pts.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.stroke();
      arrow(s.x0 + dx * 0.2, s.z0 + dz * 0.2, s.x0 + dx * 0.8, s.z0 + dz * 0.8, "#3a2410");
      label((s.from ?? 0) + "→" + s.to, (s.x0 + s.x1) / 2 + nx * (w + 1.5), (s.z0 + s.z1) / 2 + nz * (w + 1.5), "#fff");
    });
    // walls
    map.walls.forEach((wl, i) => {
      ctx.strokeStyle = outline("walls", i) || "#6e6a80";
      ctx.lineWidth = Math.max(3, (wl.height ?? 1.2) * 0.55 * k);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(...toScreen(wl.x0, wl.z0));
      ctx.lineTo(...toScreen(wl.x1, wl.z1));
      ctx.stroke();
      ctx.lineCap = "butt";
    });
    // clusters: footprint, items as small squares, front arrow
    map.clusters.forEach((c, i) => {
      const def = CLUSTERS[c.id],
        sc = c.scale ?? 1,
        r = clusterRadius(c.id, sc),
        [cx, cy] = toScreen(c.x, c.z);
      ctx.fillStyle = "#e84aa922";
      ctx.beginPath();
      ctx.arc(cx, cy, r * k, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = outline("clusters", i) || "#e84aa9aa";
      ctx.lineWidth = outline("clusters", i) ? 3 : 1.5;
      ctx.stroke();
      const cos = Math.cos(c.rot || 0),
        sin = Math.sin(c.rot || 0);
      for (const [, lx, lz, size, , solid = true] of def?.items || []) {
        const wx = c.x + (lx * cos + lz * sin) * sc,
          wz = c.z + (-lx * sin + lz * cos) * sc,
          [px, py] = toScreen(wx, wz),
          s = Math.max(2, size * sc * 0.55 * k);
        ctx.fillStyle = solid === false ? "#ffffff55" : "#3a2a3a";
        ctx.fillRect(px - s / 2, py - s / 2, s, s);
      }
      arrow(c.x, c.z, c.x + sin * r, c.z + cos * r, "#e84aa9");
      label((def?.name || c.id) + ((c.y ?? 0) > 0 ? " · " + c.y + " м" : ""), c.x, c.z - r - 1.5, "#ffd6ef");
    });
    // pads, torches, spawns
    map.pads.forEach((p, i) => {
      const [x, y] = toScreen(p.x, p.z);
      ctx.fillStyle = "#184e65";
      ctx.beginPath();
      ctx.arc(x, y, 1.4 * k, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = outline("pads", i) || PAD_TIERS[p.tier] || "#39b5ff";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, 1 * k, 0, Math.PI * 2);
      ctx.stroke();
    });
    map.torches.forEach((t, i) => {
      const [x, y] = toScreen(t.x, t.z);
      ctx.fillStyle = outline("torches", i) || "#ff9a3a";
      ctx.beginPath();
      ctx.arc(x, y, Math.max(3, (t.kind === "brazier" ? 0.8 : 0.4) * k), 0, Math.PI * 2);
      ctx.fill();
    });
    map.spawns.forEach((p, i) => {
      const [x, y] = toScreen(p.x, p.z),
        s = Math.max(5, 1.2 * k);
      ctx.strokeStyle = outline("spawns", i) || "#ff5a5a";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x - s, y - s);
      ctx.lineTo(x + s, y + s);
      ctx.moveTo(x + s, y - s);
      ctx.lineTo(x - s, y + s);
      ctx.stroke();
    });
    if (map.playerStart) {
      const [x, y] = toScreen(map.playerStart.x, map.playerStart.z),
        s = Math.max(7, 1.6 * k);
      ctx.fillStyle = outline("start", 0) || "#8ce4b4";
      ctx.beginPath();
      ctx.moveTo(x, y - s);
      ctx.lineTo(x + s * 0.8, y + s * 0.7);
      ctx.lineTo(x - s * 0.8, y + s * 0.7);
      ctx.closePath();
      ctx.fill();
      label("СТАРТ", map.playerStart.x, map.playerStart.z + 2.6, "#8ce4b4", true);
    }
    drawTransform();
    if (drag?.band) {
      const [ax, ay] = toScreen(...drag.band.a),
        [bx, by] = toScreen(...drag.band.b);
      ctx.strokeStyle = "#71eaff";
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
      ctx.setLineDash([]);
    }
    // the shape being drawn
    if (drag?.preview) {
      ctx.strokeStyle = "#71eaff";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      const { a, b } = drag.preview;
      if (["platform", "pit", "moat"].includes(tool)) {
        const [x, y] = toScreen(Math.min(a[0], b[0]), Math.min(a[1], b[1]));
        ctx.strokeRect(x, y, Math.abs(b[0] - a[0]) * k, Math.abs(b[1] - a[1]) * k);
      } else {
        ctx.beginPath();
        ctx.moveTo(...toScreen(...a));
        ctx.lineTo(...toScreen(...b));
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
  }
  // Side view (elevation): horizontal = x (seen from the south) or z (seen from the west), vertical = height.
  // Everything is drawn back to front with depth shading; a 1.75 m person stands at the left for scale.
  function drawSide() {
    const k = view.scale * devicePixelRatio,
      alongX = mode === "sideX",
      L = map.limit ?? 110,
      H = (u, y) => [canvas.width / 2 + (u - (alongX ? view.x : view.z)) * k, canvas.height * 0.62 - y * k];
    ctx.fillStyle = "#1b1426";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // sky gradient band and ground
    const [, g0] = H(0, 0);
    ctx.fillStyle = "#241b33";
    ctx.fillRect(0, 0, canvas.width, g0);
    ctx.fillStyle = BIOME_GROUND[map.biome] || "#5d7a46";
    ctx.fillRect(0, g0, canvas.width, canvas.height - g0);
    // height grid every metre (labels every 3 m)
    ctx.font = `${10 * devicePixelRatio}px Arial`;
    for (let y = -6; y <= 20; y++) {
      const [, py] = H(0, y);
      ctx.strokeStyle = y % 3 === 0 ? "#ffffff22" : "#ffffff0c";
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(canvas.width, py);
      ctx.stroke();
      if (y % 3 === 0) {
        ctx.fillStyle = "#ffffff66";
        ctx.textAlign = "left";
        ctx.fillText(y + " м", 6, py - 3);
      }
    }
    const u = (o) => (alongX ? o.x : o.z),
      depth = (o) => (alongX ? o.z : o.x), // smaller = farther (drawn first, darker)
      shade = (o, base) => {
        const t = Math.max(0, Math.min(1, (depth(o) + L) / (2 * L)));
        return `color-mix(in srgb, ${base} ${55 + t * 45}%, #1b1426)`;
      },
      span = (o) => (alongX ? o.w : o.d);
    const things = [];
    if (map.pit) things.push(["pit", map.pit]);
    (map.moat || []).forEach((m) => things.push(["moat", m]));
    map.platforms.forEach((p) => things.push(["platform", p]));
    map.stairs.forEach((s) => things.push(["stairs", s]));
    map.walls.forEach((w) => things.push(["wall", w]));
    map.clusters.forEach((c) => things.push(["cluster", c]));
    map.zones.forEach((z) => things.push(["zone", z]));
    things.sort((a, b) => (depth(a[1]) ?? 0) - (depth(b[1]) ?? 0));
    for (const [kind, o] of things) {
      if (kind === "pit" || kind === "moat") {
        const [x0, y0] = H(u(o) - span(o) / 2, 0),
          depthM = kind === "pit" ? -(o.h ?? -5) : 4;
        ctx.fillStyle = "#120d18";
        ctx.fillRect(x0, y0, span(o) * k, depthM * k);
      } else if (kind === "platform") {
        const h = platformH(o),
          base = o.slab || o.solid === false ? h - 0.65 : o.base ?? 0,
          [x0, y0] = H(u(o) - span(o) / 2, h);
        ctx.fillStyle = shade(o, o.slab ? "#b08a5c" : "#a9adb5");
        ctx.fillRect(x0, y0, span(o) * k, (h - base) * k);
        ctx.strokeStyle = "#00000088";
        ctx.strokeRect(x0, y0, span(o) * k, (h - base) * k);
      } else if (kind === "stairs") {
        const a = H(alongX ? o.x0 : o.z0, o.from ?? 0),
          b = H(alongX ? o.x1 : o.z1, o.to);
        ctx.fillStyle = shade({ x: (o.x0 + o.x1) / 2, z: (o.z0 + o.z1) / 2 }, "#d9a86a");
        const ground = H(0, Math.min(o.from ?? 0, 0))[1];
        if (Math.abs(a[0] - b[0]) < 2) {
          // seen end-on: a column of steps
          ctx.fillRect(a[0] - ((o.width ?? 4) * k) / 2, b[1], (o.width ?? 4) * k, ground - b[1]);
        } else {
          ctx.beginPath();
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(b[0], b[1]);
          ctx.lineTo(b[0], ground);
          ctx.lineTo(a[0], ground);
          ctx.closePath();
          ctx.fill();
        }
      } else if (kind === "wall") {
        const a = H(alongX ? Math.min(o.x0, o.x1) : Math.min(o.z0, o.z1), (o.y ?? 0) + (o.height ?? 1.2)),
          w = Math.max(0.6, Math.abs(alongX ? o.x1 - o.x0 : o.z1 - o.z0));
        ctx.fillStyle = shade({ x: (o.x0 + o.x1) / 2, z: (o.z0 + o.z1) / 2 }, "#6e6a80");
        ctx.fillRect(a[0], a[1], w * k, (o.height ?? 1.2) * k);
      } else if (kind === "cluster") {
        const def = CLUSTERS[o.id];
        if (!def) continue;
        const cos = Math.cos(o.rot || 0),
          sin = Math.sin(o.rot || 0);
        for (const [, lx, lz, size, , solid = true, y = 0] of def.items) {
          const wx = o.x + lx * cos + lz * sin,
            wz = o.z - lx * sin + lz * cos,
            p = H(alongX ? wx : wz, y + size * 0.75);
          ctx.fillStyle = shade(o, solid === false ? "#d9c7e8" : "#c86aa8");
          ctx.fillRect(p[0] - (size * 0.4 * k), p[1], size * 0.8 * k, size * 0.75 * k);
        }
      } else if (kind === "zone") {
        const e = zoneTemplates[o.template]?.extent || { w: 26, d: 26 },
          a = H(u(o) - (alongX ? e.w : e.d) / 2, 2.4);
        ctx.strokeStyle = "#ffffff44";
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(a[0], a[1], (alongX ? e.w : e.d) * k, 2.4 * k);
        ctx.setLineDash([]);
      }
    }
    // pads, start, spawns as markers
    for (const p of map.pads) {
      const [x, y] = H(u(p), heightAt(p.x, p.z));
      ctx.fillStyle = PAD_TIERS[p.tier] || "#39b5ff";
      ctx.fillRect(x - 1.4 * k, y - 0.25 * k, 2.8 * k, 0.25 * k);
    }
    const person = (px, py, color) => {
      // a 1.75 m figure: head, body, legs — the scale reference
      ctx.fillStyle = color;
      ctx.fillRect(px - 0.22 * k, py - 1.75 * k, 0.44 * k, 0.4 * k);
      ctx.fillRect(px - 0.3 * k, py - 1.32 * k, 0.6 * k, 0.62 * k);
      ctx.fillRect(px - 0.25 * k, py - 0.7 * k, 0.2 * k, 0.7 * k);
      ctx.fillRect(px + 0.05 * k, py - 0.7 * k, 0.2 * k, 0.7 * k);
    };
    if (map.playerStart) person(...H(u(map.playerStart), heightAt(map.playerStart.x, map.playerStart.z)), "#8ce4b4");
    for (const sp of map.spawns) person(...H(u(sp), heightAt(sp.x, sp.z)), "#ff5a5a");
    // fixed scale person at the left edge of the arena
    const [lx, ly] = H(-L + 3, 0);
    person(lx, ly, "#ffffffcc");
    ctx.fillStyle = "#ffffffaa";
    ctx.textAlign = "left";
    ctx.fillText("человек 1,75 м", lx + 0.6 * k, ly - 1.9 * k);
    $("#coords").textContent = (alongX ? "вид с юга: по горизонтали X" : "вид с запада: по горизонтали Z") + " · правка — в виде сверху";
  }
  function label(text, x, z, color, bold) {
    if (view.scale < 1.6) return;
    const [px, py] = toScreen(x, z);
    ctx.font = `${bold ? "700 " : ""}${11 * devicePixelRatio}px Arial`;
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, px, py);
  }
  function arrow(x0, z0, x1, z1, color) {
    const [a, b] = toScreen(x0, z0),
      [c, d] = toScreen(x1, z1),
      ang = Math.atan2(d - b, c - a),
      s = 8 * devicePixelRatio;
    ctx.strokeStyle = ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(a, b);
    ctx.lineTo(c, d);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(c, d);
    ctx.lineTo(c - s * Math.cos(ang - 0.45), d - s * Math.sin(ang - 0.45));
    ctx.lineTo(c - s * Math.cos(ang + 0.45), d - s * Math.sin(ang + 0.45));
    ctx.closePath();
    ctx.fill();
  }
  // ---------- transform handles (tool E) ----------
  // rectangles (platforms, pit, moat): 4 corners resize, the round handle turns them by 90°;
  // stairs and walls: end handles change length / direction, round handle turns (stairs by 90°, walls freely);
  // clusters: the round handle on the front arrow turns (15° steps, Alt = free), the square one scales
  function transformHandles(ref) {
    const o = item(ref);
    if (!o) return [];
    if (["platforms", "pit", "moat"].includes(ref.kind))
      return [
        ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => ({ type: "corner", sx, sz, x: o.x + (sx * o.w) / 2, z: o.z + (sz * o.d) / 2 })),
        { type: "rotate90", x: o.x, z: o.z - o.d / 2 - 4 },
      ];
    if (ref.kind === "stairs" || ref.kind === "walls") {
      const mx = (o.x0 + o.x1) / 2,
        mz = (o.z0 + o.z1) / 2,
        len = Math.hypot(o.x1 - o.x0, o.z1 - o.z0) || 1,
        nx = -(o.z1 - o.z0) / len,
        nz = (o.x1 - o.x0) / len;
      return [
        { type: "end", which: 0, x: o.x0, z: o.z0 },
        { type: "end", which: 1, x: o.x1, z: o.z1 },
        { type: ref.kind === "stairs" ? "rotate90" : "rotate", x: mx + nx * ((o.width ?? 2) / 2 + 3), z: mz + nz * ((o.width ?? 2) / 2 + 3) },
      ];
    }
    if (ref.kind === "clusters") {
      const r = clusterRadius(o.id, o.scale ?? 1),
        rot = o.rot || 0;
      return [
        { type: "rotate", x: o.x + Math.sin(rot) * (r + 2), z: o.z + Math.cos(rot) * (r + 2) },
        { type: "scale", x: o.x + Math.cos(rot) * r, z: o.z - Math.sin(rot) * r },
      ];
    }
    return [];
  }
  function drawTransform() {
    if (tool !== "transform" || group.length !== 1 || !selected) return;
    for (const h of transformHandles(selected)) {
      const [x, y] = toScreen(h.x, h.z),
        s = 6 * devicePixelRatio;
      ctx.fillStyle = h.type.startsWith("rotate") ? "#f6b73d" : "#71eaff";
      ctx.strokeStyle = "#1b1426";
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (h.type.startsWith("rotate")) ctx.arc(x, y, s, 0, Math.PI * 2);
      else ctx.rect(x - s, y - s, 2 * s, 2 * s);
      ctx.fill();
      ctx.stroke();
    }
  }
  function handles(p) {
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const [x, y] = toScreen(p.x + (sx * p.w) / 2, p.z + (sz * p.d) / 2),
        s = 5 * devicePixelRatio;
      ctx.fillStyle = "#71eaff";
      ctx.fillRect(x - s, y - s, 2 * s, 2 * s);
    }
  }

  // ---------- hit testing ----------
  function hit(x, z) {
    const r = 2 / view.scale + 0.6;
    const near = (px, pz, rad) => Math.hypot(x - px, z - pz) <= rad;
    if (map.playerStart && near(map.playerStart.x, map.playerStart.z, 2 + r)) return { kind: "start", index: 0 };
    for (let i = map.spawns.length - 1; i >= 0; i--) if (near(map.spawns[i].x, map.spawns[i].z, 1.5 + r)) return { kind: "spawns", index: i };
    for (let i = map.torches.length - 1; i >= 0; i--) if (near(map.torches[i].x, map.torches[i].z, 1 + r)) return { kind: "torches", index: i };
    for (let i = map.pads.length - 1; i >= 0; i--) if (near(map.pads[i].x, map.pads[i].z, 1.6 + r)) return { kind: "pads", index: i };
    for (let i = map.clusters.length - 1; i >= 0; i--) if (near(map.clusters[i].x, map.clusters[i].z, clusterRadius(map.clusters[i].id, map.clusters[i].scale ?? 1))) return { kind: "clusters", index: i };
    for (let i = map.walls.length - 1; i >= 0; i--) if (segDist(x, z, map.walls[i]) < 1 + r) return { kind: "walls", index: i };
    for (let i = map.stairs.length - 1; i >= 0; i--) if (segDist(x, z, map.stairs[i]) < (map.stairs[i].width ?? 4) / 2) return { kind: "stairs", index: i };
    const plats = map.platforms.map((p, i) => [p, i]).sort((a, b) => platformH(b[0]) - platformH(a[0]));
    for (const [p, i] of plats) if (Math.abs(x - p.x) <= p.w / 2 && Math.abs(z - p.z) <= p.d / 2) return { kind: "platforms", index: i };
    for (let i = (map.moat || []).length - 1; i >= 0; i--) {
      const m = map.moat[i];
      if (Math.abs(x - m.x) <= m.w / 2 && Math.abs(z - m.z) <= m.d / 2) return { kind: "moat", index: i };
    }
    if (map.pit && Math.abs(x - map.pit.x) <= map.pit.w / 2 && Math.abs(z - map.pit.z) <= map.pit.d / 2) return { kind: "pit", index: 0 };
    for (let i = map.zones.length - 1; i >= 0; i--) {
      const zn = map.zones[i],
        e = zoneTemplates[zn.template]?.extent || { w: 26, d: 26 };
      if (Math.abs(x - zn.x) <= e.w / 2 && Math.abs(z - zn.z) <= e.d / 2) return { kind: "zones", index: i };
    }
    return null;
  }
  const segDist = (x, z, s) => {
    const dx = s.x1 - s.x0,
      dz = s.z1 - s.z0,
      l = dx * dx + dz * dz,
      t = l ? Math.max(0, Math.min(1, ((x - s.x0) * dx + (z - s.z0) * dz) / l)) : 0;
    return Math.hypot(x - s.x0 - dx * t, z - s.z0 - dz * t);
  };
  const cornerAt = (x, z) => {
    if (selected?.kind !== "platforms" || group.length !== 1) return null;
    const p = map.platforms[selected.index],
      tol = 8 / view.scale;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]])
      if (Math.abs(x - (p.x + (sx * p.w) / 2)) < tol && Math.abs(z - (p.z + (sz * p.d) / 2)) < tol) return [sx, sz];
    return null;
  };

  // ---------- mouse ----------
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (e.shiftKey && group.some((g) => g.kind === "clusters")) {
      for (const g of group) if (g.kind === "clusters") item(g).rot = ((item(g).rot || 0) + Math.sign(e.deltaY) * (Math.PI / 12)) % (Math.PI * 2);
      return commit();
    }
    if (mode !== "top") {
      view.scale = Math.min(16, Math.max(0.8, view.scale * (e.deltaY < 0 ? 1.12 : 0.89)));
      return draw();
    }
    const [wx, wz] = toWorld(e.offsetX, e.offsetY);
    view.scale = Math.min(16, Math.max(0.8, view.scale * (e.deltaY < 0 ? 1.12 : 0.89)));
    const [nx, nz] = toWorld(e.offsetX, e.offsetY);
    view.x += wx - nx;
    view.z += wz - nz;
    draw();
  }, { passive: false });
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    const [x, z] = toWorld(e.offsetX, e.offsetY);
    if (e.button === 1 || e.button === 2 || spaceDown) {
      drag = { pan: true, sx: e.offsetX, sy: e.offsetY, vx: view.x, vz: view.z };
      return;
    }
    if (mode !== "top") return; // side views are for looking; edit from above
    const at = [sn(x), sn(z)];
    if (tool === "transform") {
      const tol = 9 / view.scale,
        h = group.length === 1 && transformHandles(selected).find((q) => Math.abs(q.x - x) < tol && Math.abs(q.z - z) < tol);
      if (h) {
        const o = item(selected);
        drag = { handle: h, start: JSON.parse(JSON.stringify(o)), a0: Math.atan2(x - (o.x ?? (o.x0 + o.x1) / 2), z - (o.z ?? (o.z0 + o.z1) / 2)) };
        return;
      }
      selectOnly(hit(x, z));
      panel();
      draw();
      return;
    }
    if (tool === "select") {
      const corner = cornerAt(x, z);
      if (corner) {
        drag = { resize: corner, start: JSON.parse(JSON.stringify(map.platforms[selected.index])) };
        return;
      }
      const h = hit(x, z);
      if (!h) {
        // empty ground: rubber-band selection (Shift adds to the current one)
        if (!e.shiftKey) selectOnly(null);
        drag = { band: { a: [x, z], b: [x, z] }, add: e.shiftKey };
        panel();
        draw();
        return;
      }
      if (e.shiftKey) {
        // Shift+click toggles an object in the group
        if (inGroup(h.kind, h.index)) group = group.filter((g) => !(g.kind === h.kind && g.index === h.index));
        else group.push(h);
        selected = group[group.length - 1] || null;
        panel();
        draw();
        return;
      }
      if (!inGroup(h.kind, h.index)) selectOnly(h);
      else selected = h;
      // Alt+drag: copy the selection and drag the copies
      if (e.altKey) {
        const copies = group.map((g) => addItem(g.kind === "pit" || g.kind === "start" ? "skip" : g.kind, JSON.parse(JSON.stringify(item(g))))).filter((r) => r.kind !== "skip");
        group = copies;
        selected = copies[copies.length - 1] || null;
      }
      drag = { move: true, ox: x, oz: z, starts: group.map((g) => JSON.parse(JSON.stringify(item(g)))) };
      panel();
      draw();
      return;
    }
    if (["platform", "stairs", "wall", "pit", "moat"].includes(tool)) {
      drag = { preview: { a: at, b: at } };
      return;
    }
    // single-click tools
    const [sx, sz] = at;
    if (tool === "pad") selectOnly(addItem("pads", { x: sx, z: sz, y: heightAt(sx, sz), tier: padTier }));
    if (tool === "zone") selectOnly(addItem("zones", { template: zoneTemplate, x: sx, z: sz }));
    if (tool === "cluster") selectOnly(addItem("clusters", { id: clusterId, x: sx, z: sz, rot: 0 }));
    if (tool === "torch") selectOnly(addItem("torches", { x: sx, z: sz, kind: e.altKey ? "brazier" : "torch", light: true }));
    if (tool === "spawn") selectOnly(addItem("spawns", { x: sx, z: sz, y: heightAt(sx, sz) }));
    if (tool === "start") selectOnly(addItem("start", { x: sx, z: sz }));
    commit();
  });
  canvas.addEventListener("pointermove", (e) => {
    const [x, z] = toWorld(e.offsetX, e.offsetY);
    mouse = [x, z];
    if (mode === "top") $("#coords").textContent = `${x.toFixed(1)}, ${z.toFixed(1)} · высота ${heightAt(x, z)} м`;
    if (!drag) return;
    if (drag.pan) {
      view.x = drag.vx - (e.offsetX - drag.sx) / view.scale;
      view.z = drag.vz - (e.offsetY - drag.sy) / view.scale;
      return draw();
    }
    if (drag.preview) {
      let b = [sn(x), sn(z)];
      if (tool === "stairs") {
        // stairs are straight along x or z
        const a = drag.preview.a;
        b = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? [b[0], a[1]] : [a[0], b[1]];
      }
      drag.preview.b = b;
      return draw();
    }
    if (drag.resize) {
      const p = map.platforms[selected.index],
        s = drag.start,
        [cx, cz] = drag.resize,
        fx = s.x - (cx * s.w) / 2,
        fz = s.z - (cz * s.d) / 2,
        nx = sn(x),
        nz = sn(z);
      p.w = Math.max(2, Math.abs(nx - fx));
      p.d = Math.max(2, Math.abs(nz - fz));
      p.x = (nx + fx) / 2;
      p.z = (nz + fz) / 2;
      return draw();
    }
    if (drag.band) {
      drag.band.b = [x, z];
      return draw();
    }
    if (drag.handle) {
      const o = item(selected),
        s0 = drag.start,
        h = drag.handle;
      if (h.type === "corner") {
        const fx = s0.x - (h.sx * s0.w) / 2,
          fz = s0.z - (h.sz * s0.d) / 2,
          nx = sn(x),
          nz = sn(z);
        Object.assign(o, { w: Math.max(2, Math.abs(nx - fx)), d: Math.max(2, Math.abs(nz - fz)), x: (nx + fx) / 2, z: (nz + fz) / 2 });
      } else if (h.type === "end") {
        let nx = sn(x),
          nz = sn(z);
        if (selected.kind === "stairs") {
          // stairs stay straight: the moving end slides along the stair's own axis
          if (s0.x0 === s0.x1) nx = h.which ? s0.x1 : s0.x0;
          else nz = h.which ? s0.z1 : s0.z0;
        }
        if (h.which) Object.assign(o, { x1: nx, z1: nz });
        else Object.assign(o, { x0: nx, z0: nz });
      } else if (h.type === "scale") {
        const base = clusterRadius(o.id);
        o.scale = Math.round(Math.max(0.3, Math.min(3, Math.hypot(x - o.x, z - o.z) / base)) * 20) / 20;
      } else {
        const cx = s0.x ?? (s0.x0 + s0.x1) / 2,
          cz = s0.z ?? (s0.z0 + s0.z1) / 2;
        let a = Math.atan2(x - cx, z - cz);
        if (h.type === "rotate90") {
          // quarter turns: rectangles swap width and depth, stairs turn around their middle
          const turns = Math.round((a - drag.a0) / (Math.PI / 2));
          Object.assign(o, JSON.parse(JSON.stringify(s0)));
          for (let t = 0; t < ((turns % 4) + 4) % 4; t++) {
            if ("x0" in o) {
              const r = (px, pz) => [cx - (pz - cz), cz + (px - cx)];
              [o.x0, o.z0] = r(o.x0, o.z0);
              [o.x1, o.z1] = r(o.x1, o.z1);
            } else [o.w, o.d] = [o.d, o.w];
          }
        } else if (selected.kind === "clusters") {
          if (!e.altKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
          o.rot = (a + Math.PI * 2) % (Math.PI * 2);
        } else {
          // walls turn freely around their middle (15° steps unless Alt)
          let d = a - drag.a0;
          if (!e.altKey) d = Math.round(d / (Math.PI / 12)) * (Math.PI / 12);
          const c = Math.cos(-d),
            sn2 = Math.sin(-d),
            r = (px, pz) => [cx + (px - cx) * c - (pz - cz) * sn2, cz + (px - cx) * sn2 + (pz - cz) * c];
          [o.x0, o.z0] = r(s0.x0, s0.z0);
          [o.x1, o.z1] = r(s0.x1, s0.z1);
        }
      }
      return draw();
    }
    if (drag.move) {
      const dx = sn(x - drag.ox),
        dz = sn(z - drag.oz);
      group.forEach((g, n) => {
        const o = item(g);
        if (!o) return;
        Object.assign(o, JSON.parse(JSON.stringify(drag.starts[n])));
        shift(o, dx, dz);
      });
      return draw();
    }
  });
  canvas.addEventListener("pointerup", () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.move || d.handle) for (const g of group) settle(g.kind, item(g)); // moved objects rest on what is now below them
    if (d.band) {
      const [ax, az] = d.band.a,
        [bx, bz] = d.band.b,
        inside = ([x, z]) => x >= Math.min(ax, bx) && x <= Math.max(ax, bx) && z >= Math.min(az, bz) && z <= Math.max(az, bz);
      if (Math.hypot(bx - ax, bz - az) > 1)
        for (const kind of KINDS)
          list(kind).forEach((o, index) => inside(anchor(o)) && !inGroup(kind, index) && group.push({ kind, index }));
      selected = group[group.length - 1] || null;
      panel();
      return draw();
    }
    if (d.preview) {
      const [a, b] = [d.preview.a, d.preview.b];
      const rect = { x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, w: Math.abs(b[0] - a[0]), d: Math.abs(b[1] - a[1]) };
      if (tool === "pit" && rect.w >= 4 && rect.d >= 4) selectOnly(addItem("pit", { ...rect, h: -5 }));
      if (tool === "moat" && rect.w >= 2 && rect.d >= 2) selectOnly(addItem("moat", rect));
      if (tool === "platform" && Math.abs(b[0] - a[0]) >= 2 && Math.abs(b[1] - a[1]) >= 2) {
        selectOnly(addItem("platforms", level === 0 ? { ...rect, h: 0, slab: true } : { ...rect, level }));
      }
      if (tool === "stairs" && Math.hypot(b[0] - a[0], b[1] - a[1]) >= 2) {
        // from = floor under the start, to = floor just past the end (the platform the stairs climb onto)
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]),
          ux = (b[0] - a[0]) / len,
          uz = (b[1] - a[1]) / len,
          from = heightAt(a[0] - ux * 0.5, a[1] - uz * 0.5),
          to = heightAt(b[0] + ux * 0.5, b[1] + uz * 0.5);
        selectOnly(addItem("stairs", { x0: a[0], z0: a[1], x1: b[0], z1: b[1], width: 4, from, to: to > from ? to : from + 3 }));
      }
      if (tool === "wall" && Math.hypot(b[0] - a[0], b[1] - a[1]) >= 1.5) {
        selectOnly(addItem("walls", { x0: a[0], z0: a[1], x1: b[0], z1: b[1], y: heightAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), height: 1.2 }));
      }
    }
    commit();
  });
  let spaceDown = false,
    mouse = [0, 0];
  addEventListener("keydown", (e) => {
    if (e.target.closest?.("input, select, textarea")) return;
    if (e.code === "Space") spaceDown = true;
    const t = TOOLS.find(([, key]) => e.key.toUpperCase() === key || e.code === "Key" + key);
    if (t && !e.metaKey && !e.ctrlKey) setTool(t[0]);
    if ((e.key === "Delete" || e.key === "Backspace") && group.length) {
      removeItems(group);
      commit();
    }
    if (e.key.toLowerCase() === "r" && group.some((g) => g.kind === "clusters")) {
      for (const g of group) if (g.kind === "clusters") item(g).rot = ((item(g).rot || 0) + (e.shiftKey ? Math.PI / 2 : Math.PI / 12)) % (Math.PI * 2);
      commit();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && group.length) {
      e.preventDefault();
      clipboard = group.filter((g) => g.kind !== "pit" && g.kind !== "start").map((g) => ({ kind: g.kind, o: JSON.parse(JSON.stringify(item(g))) }));
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v" && clipboard?.length) {
      e.preventDefault();
      // paste centred on the mouse
      const cx = clipboard.reduce((s, c) => s + anchor(c.o)[0], 0) / clipboard.length,
        cz = clipboard.reduce((s, c) => s + anchor(c.o)[1], 0) / clipboard.length;
      group = clipboard.map((c) => addItem(c.kind, shift(JSON.parse(JSON.stringify(c.o)), sn(mouse[0] - cx), sn(mouse[1] - cz))));
      selected = group[group.length - 1];
      commit();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (history.length > 1) {
        history.pop();
        map = JSON.parse(history[history.length - 1]);
        selected = null;
        save();
        check();
        panel();
        draw();
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d" && group.length) {
      e.preventDefault();
      group = group.filter((g) => g.kind !== "pit" && g.kind !== "start").map((g) => addItem(g.kind, shift(JSON.parse(JSON.stringify(item(g))), 4, 4)));
      selected = group[group.length - 1] || null;
      commit();
    }
  });
  addEventListener("keyup", (e) => e.code === "Space" && (spaceDown = false));

  // ---------- checks ----------
  function check() {
    issues = [];
    const add = (kind, index, text) => issues.push({ kind, index, text });
    map.stairs.forEach((s, i) => {
      const len = Math.hypot(s.x1 - s.x0, s.z1 - s.z0),
        rise = (s.to ?? 0) - (s.from ?? 0);
      if (s.x0 !== s.x1 && s.z0 !== s.z1) add("stairs", i, "лестница должна быть прямой (вдоль X или Z)");
      if (rise <= 0) add("stairs", i, "лестница никуда не поднимает");
      else if (rise / len > 0.65) add("stairs", i, `лестница слишком крутая: нужно ≥ ${Math.ceil(rise / 0.62)} м длины`);
      const top = heightAt(s.x1 + ((s.x1 - s.x0) / len) * 0.5, s.z1 + ((s.z1 - s.z0) / len) * 0.5);
      if (Math.abs(top - (s.to ?? 0)) > 0.3) add("stairs", i, `верх лестницы (${s.to} м) не совпадает с платформой (${top} м)`);
    });
    map.clusters.forEach((c, i) => {
      if (!CLUSTERS[c.id]) return add("clusters", i, "нет такой сборки: " + c.id);
      const r = clusterRadius(c.id, c.scale ?? 1);
      map.clusters.forEach((o, j) => j > i && Math.abs((o.y ?? 0) - (c.y ?? 0)) < 2 && Math.hypot(o.x - c.x, o.z - c.z) < r + clusterRadius(o.id, o.scale ?? 1) && add("clusters", i, "сборки налезают друг на друга"));
      map.stairs.forEach((s) => (c.y ?? 0) < Math.max(s.to ?? 0, s.from ?? 0) && segDist(c.x, c.z, s) < r + (s.width ?? 4) / 2 && add("clusters", i, "сборка налезает на лестницу"));
      map.pads.forEach((p) => Math.hypot(p.x - c.x, p.z - c.z) < r + 2 && add("clusters", i, "сборка налезает на пад"));
      const plat = (c.y ?? 0) > 0 && map.platforms.find((p) => Math.abs(c.x - p.x) <= p.w / 2 && Math.abs(c.z - p.z) <= p.d / 2 && Math.abs(platformH(p) - c.y) < 0.3);
      if (plat && (Math.abs(c.x - plat.x) + r > plat.w / 2 + 0.5 || Math.abs(c.z - plat.z) + r > plat.d / 2 + 0.5)) add("clusters", i, "сборка свисает с края платформы");
    });
    // raised platforms need a way up: a stair ending on them, or a pad within ~25 m (pads throw you up)
    map.platforms.forEach((p, i) => {
      const h = platformH(p);
      if (h <= 0 || p.slab) return;
      const onIt = (x, z) => Math.abs(x - p.x) <= p.w / 2 + 1 && Math.abs(z - p.z) <= p.d / 2 + 1;
      const stair = map.stairs.some((s) => onIt(s.x1, s.z1) && Math.abs((s.to ?? 0) - h) < 0.3),
        pad = map.pads.some((d) => Math.hypot(d.x - p.x, d.z - p.z) < 25 + Math.max(p.w, p.d) / 2),
        under = map.platforms.some((q) => q !== p && platformH(q) >= h && onIt(q.x, q.z));
      if (!stair && !pad && !under) add("platforms", i, `на платформу ${h} м не ведёт ни лестница, ни пад`);
    });
    map.pads.forEach((p, i) => map.stairs.forEach((s) => segDist(p.x, p.z, s) < 3 && add("pads", i, "пад на лестнице или вплотную к ней")));
    const L = map.limit ?? 110;
    for (const kind of ["platforms", "pads", "zones", "clusters", "spawns", "torches"])
      map[kind].forEach((o, i) => (Math.abs(o.x) > L || Math.abs(o.z) > L) && add(kind, i, "за пределами арены"));
    if (!map.zones.length && !map.spawns.length) issues.push({ kind: "map", index: 0, text: "нет ни одного двора и точки появления — врагам негде появляться" });
    for (const e of validateMap(map)) issues.push({ kind: "map", index: 0, text: e });
    const list = $("#issues");
    list.innerHTML = issues.length ? issues.map((it, n) => `<li data-n="${n}">${it.text}</li>`).join("") : `<li class="ok">Ошибок не найдено. Полную проверку проходимости делает игра при загрузке.</li>`;
    list.querySelectorAll("li[data-n]").forEach((li) => {
      li.onclick = () => {
        const it = issues[+li.dataset.n];
        if (it.kind !== "map") {
          selectOnly({ kind: it.kind, index: it.index });
          const o = item(selected);
          view.x = o.x ?? (o.x0 + o.x1) / 2;
          view.z = o.z ?? (o.z0 + o.z1) / 2;
          panel();
          draw();
        }
      };
    });
  }

  // ---------- panels ----------
  function setTool(t) {
    tool = t;
    document.querySelectorAll("#tools button").forEach((b) => b.classList.toggle("on", b.dataset.tool === t));
    panel();
  }
  $("#tools").innerHTML = TOOLS.map(([id, key, name]) => `<button data-tool="${id}" title="${name} (${key})"><b>${key}</b>${name}</button>`).join("");
  $("#tools").onclick = (e) => {
    const b = e.target.closest("button");
    if (b) setTool(b.dataset.tool);
  };
  const field = (labelText, html) => `<label><span>${labelText}</span>${html}</label>`;
  const num = (key, value, step = 0.5) => `<input data-key="${key}" type="number" step="${step}" value="${value}">`;
  const sel = (key, value, options) => `<select data-key="${key}">${options.map(([v, n]) => `<option value="${v}" ${String(v) === String(value) ? "selected" : ""}>${n}</option>`).join("")}</select>`;
  function panel() {
    const box = $("#props");
    let html = "";
    // tool options
    if (tool === "platform") html += `<h3>Новая платформа</h3>` + field("Уровень", sel("@level", level, [[0, "0 м · мост через ров или яму"], ...LEVELS.slice(1).map((l, i) => [i + 1, l.name])]));
    if (tool === "pad") html += `<h3>Новый пад</h3>` + field("Вид", sel("@tier", padTier, [["spring", "Пружина ~4 м"], ["springHigh", "Сильная пружина ~6 м"], ["blue", "Синий ~13 м"], ["yellow", "Жёлтый ~18 м"]]));
    if (tool === "zone") html += `<h3>Новый двор</h3>` + field("Шаблон", sel("@template", zoneTemplate, Object.entries(zoneTemplates).map(([k, t]) => [k, t.name])));
    if (tool === "cluster") {
      const biomeThemes = { desert: ["desert", "coast"], meadow: ["meadow", "fortress", "forest"], ruins: ["fortress", "forest", "meadow", "siege"], night: ["siege", "fortress", "meadow"] }[map.biome] || [];
      html +=
        `<h3>Сборки</h3><p class="hint">Клик по карте ставит выбранную. R — повернуть на 15°, Shift+R — на 90°, Shift+колесо — тоже поворот. Сначала идут сборки, подходящие к биому.</p><div class="palette">` +
        Object.entries(CLUSTERS)
          .sort((a, b) => (b[1].themes.some((t) => biomeThemes.includes(t)) ? 1 : 0) - (a[1].themes.some((t) => biomeThemes.includes(t)) ? 1 : 0))
          .map(([id, c]) => `<button data-cluster="${id}" class="${id === clusterId ? "on" : ""} ${c.themes.some((t) => biomeThemes.includes(t)) ? "" : "off-biome"}"><canvas data-preview="${id}" width="64" height="64"></canvas><span>${c.name}</span><small>Ø ${c.radius * 2} м</small></button>`)
          .join("") +
        `</div>`;
    }
    if (tool === "torch") html += `<h3>Факел</h3><p class="hint">Клик — факел, Alt+клик — жаровня.</p>`;
    if (tool === "stairs") html += `<h3>Лестница</h3><p class="hint">Тяни от низа к верху. Высоты берутся с платформ под началом и сразу за концом. Нужно ≈ 1,6 м длины на каждый метр подъёма.</p>`;
    if (tool === "wall") html += `<h3>Стена</h3><p class="hint">Тяни линию. Высота основания берётся с платформы под серединой.</p>`;
    if (tool === "pit") html += `<h3>Яма</h3><p class="hint">Тяни прямоугольник. На карте может быть одна яма (как дно ущелья): по ней можно ходить, выбираться — по лестницам или падам. Новая яма заменяет старую.</p>`;
    if (tool === "moat") html += `<h3>Ров с кольями</h3><p class="hint">Тяни прямоугольники — их может быть сколько угодно. Упавший в ров погибает. Переходы — платформы уровня «0 м · мост».</p>`;
    if (tool === "transform") html += `<h3>Трансформация</h3><p class="hint">Выбери объект. Квадратные ручки: размер платформ, ям и рвов, концы лестниц и стен, масштаб сборки. Круглая жёлтая: поворот (платформы и лестницы на 90°, стены и сборки по 15°, с Alt — свободно).</p>`;
    if (tool === "start") html += `<h3>Старт игрока</h3><p class="hint">Клик ставит точку, где игрок начинает раунд (одна на карту).</p>`;
    if (tool === "spawn") html += `<h3>Появление врагов</h3><p class="hint">Если на карте есть такие точки, враги появляются только здесь (те, что не ближе 18 м к игроку).</p>`;
    if (tool === "select" && group.length > 1) html += `<h3>Выбрано: ${group.length}</h3><p class="hint">Перетаскивай любой из них — двигаются все. Alt+перетаскивание — копия, Ctrl+C / Ctrl+V — копировать и вставить под курсор, Ctrl+D — дубликат, Del — удалить, R — повернуть сборки.</p>`;
    // selected object
    if (selected) {
      const o = item(selected);
      if (o) {
        html += `<h3>${KIND_NAMES[selected.kind]}</h3>`;
        if (selected.kind === "platforms")
          html +=
            field("Высота, м", num("h", platformH(o), 1)) + field("Ширина", num("w", o.w, 1)) + field("Глубина", num("d", o.d, 1)) + field("Тип", sel("slab", o.slab ? 1 : 0, [[0, "Сплошной блок"], [1, "Плита (мост, площадка)"]]));
        if (selected.kind === "stairs") html += field("Снизу, м", num("from", o.from ?? 0, 1)) + field("Наверху, м", num("to", o.to, 1)) + field("Ширина", num("width", o.width ?? 4, 1)) + `<button id="fitstair">Подогнать длину под подъём</button>`;
        if (selected.kind === "walls") html += field("Основание, м", num("y", o.y ?? 0, 1)) + field("Высота стены", num("height", o.height ?? 1.2, 0.1));
        if (selected.kind === "pads") html += field("Вид", sel("tier", o.tier, [["spring", "Пружина"], ["springHigh", "Сильная пружина"], ["blue", "Синий"], ["yellow", "Жёлтый"]]));
        if (selected.kind === "zones") html += field("Шаблон", sel("template", o.template, Object.entries(zoneTemplates).map(([k, t]) => [k, t.name])));
        if (selected.kind === "clusters")
          html +=
            field("Сборка", sel("id", o.id, Object.entries(CLUSTERS).map(([k, c]) => [k, c.name]))) +
            field("Поворот, °", num("rotDeg", Math.round(((o.rot || 0) * 180) / Math.PI), 15));
        if (RESTING.includes(selected.kind))
          html += field("Высота, м", num("y", o.y ?? 0, 1)) + `<p class="hint">Встаёт на первую поверхность под этой высотой: платформу, лестницу или землю.</p>`;
        if (selected.kind === "clusters") html += field("Масштаб", num("scale", o.scale ?? 1, 0.1));
        if (selected.kind === "pit") html += field("Глубина, м", num("h", o.h ?? -5, 1)) + field("Ширина", num("w", o.w, 1)) + field("Длина", num("d", o.d, 1));
        if (selected.kind === "moat") html += field("Ширина", num("w", o.w, 1)) + field("Длина", num("d", o.d, 1));
        if (selected.kind === "torches") html += field("Вид", sel("kind", o.kind, [["torch", "Факел"], ["brazier", "Жаровня"]])) + field("Светит", sel("light", o.light ? 1 : 0, [[1, "Да"], [0, "Нет"]]));
        html += `<button id="delete" class="danger">Удалить (Del)</button>`;
      }
    }
    box.innerHTML = html || `<p class="hint">Выбери инструмент слева или объект на карте. Колесо — масштаб, правая кнопка или пробел — сдвиг карты, Ctrl+Z — отмена, Ctrl+D — копия.</p>`;
    box.querySelectorAll("[data-key]").forEach((input) => {
      input.onchange = () => {
        const key = input.dataset.key,
          v = input.type === "number" ? parseFloat(input.value) : input.value;
        if (key === "@level") level = +v;
        else if (key === "@light") (map.light = v || undefined), commit();
        else if (key === "@tier") padTier = v;
        else if (key === "@template") zoneTemplate = v;
        else {
          const o = item(selected);
          if (key === "y") settle(selected.kind, o, v);
          else if (key === "scale") o.scale = Math.max(0.3, Math.min(3, v));
          else if (key === "h") (o.h = v), delete o.level;
          else if (key === "slab") v === "1" ? (o.slab = true) : delete o.slab;
          else if (key === "rotDeg") o.rot = (v * Math.PI) / 180;
          else if (key === "light") o.light = v === "1";
          else o[key] = v;
          commit();
        }
      };
    });
    box.querySelectorAll("[data-cluster]").forEach((b) => (b.onclick = () => ((clusterId = b.dataset.cluster), panel())));
    box.querySelectorAll("canvas[data-preview]").forEach(previewCluster);
    const fit = box.querySelector("#fitstair");
    if (fit)
      fit.onclick = () => {
        const s = map.stairs[selected.index],
          len = Math.hypot(s.x1 - s.x0, s.z1 - s.z0) || 1,
          need = Math.ceil(((s.to ?? 3) - (s.from ?? 0)) / 0.62),
          ux = (s.x1 - s.x0) / len,
          uz = (s.z1 - s.z0) / len;
        s.x0 = s.x1 - ux * need;
        s.z0 = s.z1 - uz * need;
        commit();
      };
    const del = box.querySelector("#delete");
    if (del)
      del.onclick = () => {
        removeItems(group.length ? group : [selected]);
        commit();
      };
  }
  // a tiny top-down silhouette of a cluster for the palette
  function previewCluster(c) {
    const def = CLUSTERS[c.dataset.preview],
      g = c.getContext("2d"),
      r = def.radius,
      k = 28 / r;
    g.fillStyle = "#2a2036";
    g.fillRect(0, 0, 64, 64);
    g.strokeStyle = "#e84aa9";
    g.beginPath();
    g.arc(32, 32, r * k, 0, Math.PI * 2);
    g.stroke();
    for (const [, x, z, size, , solid = true] of def.items) {
      const s = Math.max(2, size * 0.55 * k);
      g.fillStyle = solid === false ? "#ffffff66" : "#d8c9e8";
      g.fillRect(32 + x * k - s / 2, 32 + z * k - s / 2, s, s);
    }
    g.fillStyle = "#e84aa9";
    g.beginPath();
    g.moveTo(32, 62);
    g.lineTo(28, 56);
    g.lineTo(36, 56);
    g.fill();
  }

  // ---------- map settings and file actions ----------
  const top = () => {
    $("#mapname").value = map.name || "";
    $("#mapbiome").innerHTML = Object.entries(BIOMES).map(([k, b]) => `<option value="${k}" ${k === map.biome ? "selected" : ""}>${b.name}</option>`).join("");
    $("#mapfill").checked = !!map.fill;
    $("#maplight").innerHTML = LIGHTS.map(([v, n]) => `<option value="${v}" ${v === (map.light || "") ? "selected" : ""}>${n}</option>`).join("");
  };
  $("#maplight").onchange = (e) => ((map.light = e.target.value || undefined), commit());
  $("#viewmode").onclick = () => {
    mode = mode === "top" ? "sideX" : mode === "sideX" ? "sideZ" : "top";
    // heights are small next to a 220 m arena: the side view starts zoomed in (wheel to zoom, drag right/space to pan)
    if (mode !== "top") view.scale = Math.max(view.scale, 9);
    $("#viewmode").textContent = mode === "top" ? "Вид: сверху" : mode === "sideX" ? "Вид: сбоку (с юга)" : "Вид: сбоку (с запада)";
    draw();
  };
  $("#mapname").onchange = (e) => ((map.name = e.target.value), commit());
  $("#mapbiome").onchange = (e) => ((map.biome = e.target.value), commit());
  $("#mapfill").onchange = (e) => ((map.fill = e.target.checked), commit());
  let newArmed = 0;
  $("#new").onclick = () => {
    // browsers in embedded pages may block confirm(): ask with the button itself
    if (Date.now() - newArmed > 3000) {
      newArmed = Date.now();
      $("#new").textContent = "Точно? Ещё раз";
      setTimeout(() => ($("#new").textContent = "Новая"), 3000);
      return;
    }
    newArmed = 0;
    $("#new").textContent = "Новая";
    map = blank();
    group = [];
    selected = null;
    top();
    commit();
  };
  $("#import").onclick = () => {
    $("#io-title").textContent = "ИМПОРТ КАРТЫ";
    $("#io-text").value = "";
    $("#io-apply").hidden = false;
    $("#io").hidden = false;
  };
  $("#export").onclick = async () => {
    const text = JSON.stringify(map, null, 1);
    $("#io-title").textContent = "ЭКСПОРТ КАРТЫ";
    $("#io-text").value = text;
    $("#io-apply").hidden = true;
    $("#io").hidden = false;
    $("#io-text").select();
    try {
      await navigator.clipboard.writeText(text);
    } catch {}
  };
  $("#io-file").onchange = async (e) => {
    const f = e.target.files?.[0];
    if (f) $("#io-text").value = await f.text();
  };
  $("#io-close").onclick = () => ($("#io").hidden = true);
  $("#io-apply").onclick = () => {
    try {
      const json = JSON.parse($("#io-text").value),
        errors = validateMap(json);
      if (errors.length) throw new Error(errors.join("; "));
      map = { ...blank(), ...json };
      selected = null;
      $("#io").hidden = true;
      top();
      commit();
    } catch (e) {
      $("#io-title").textContent = "НЕ УДАЛОСЬ ОТКРЫТЬ: " + e.message;
    }
  };
  $("#play").onclick = () => {
    try {
      localStorage.setItem("blaster-map", JSON.stringify(map));
    } catch {}
    const url = new URL(location.href);
    url.searchParams.delete("editor");
    url.searchParams.set("map", "custom");
    location.assign(url.href);
  };
  $("#back").onclick = () => {
    const url = new URL(location.href);
    url.searchParams.delete("editor");
    location.assign(url.href);
  };
  top();
  setTool("select");
  addEventListener("resize", resize);
  resize();
  check();
}

const KIND_NAMES = { pit: "Яма", moat: "Ров", start: "Старт игрока", platforms: "Платформа", stairs: "Лестница", walls: "Стена", pads: "Пад", zones: "Двор", clusters: "Сборка", torches: "Факел", spawns: "Появление врагов" };
const BIOME_GROUND = { desert: "#a9824f", meadow: "#5d7a46", ruins: "#5f6a46", night: "#3d3a40" };

const HTML = `
<div id="ed">
  <header>
    <b>РЕДАКТОР АРЕН</b>
    <input id="mapname" placeholder="Название карты">
    <select id="mapbiome" title="Биом"></select>
    <select id="maplight" title="Время суток"></select>
    <label class="check"><input id="mapfill" type="checkbox"> заполнять пустоты</label>
    <button id="viewmode" title="Вид сверху или сбоку (для масштаба)">Вид: сверху</button>
    <span class="grow"></span>
    <button id="new">Новая</button><button id="import">Импорт</button><button id="export">Экспорт JSON</button>
    <button id="play" class="primary">▶ ИГРАТЬ</button><button id="back">В игру</button>
  </header>
  <nav id="tools"></nav>
  <main><canvas id="map"></canvas><div id="coords"></div></main>
  <aside><div id="props"></div><h3>Проверка</h3><ul id="issues"></ul></aside>
  <div id="io" hidden><div class="io-panel"><b id="io-title"></b><textarea id="io-text" spellcheck="false"></textarea><input id="io-file" type="file" accept=".json,application/json"><div class="io-actions"><button id="io-close">Закрыть</button><button id="io-apply" class="primary">Открыть</button></div></div></div>
</div>`;

const CSS = `
body.editor{position:fixed;inset:0;margin:0;background:#150f1e;color:#ece7f4;font:13px/1.4 Arial,Helvetica,sans-serif;overflow:hidden;touch-action:none}
#ed{display:grid;grid-template-columns:150px 1fr 290px;grid-template-rows:50px 1fr;height:100vh}
#ed header{grid-column:1/-1;display:flex;align-items:center;gap:10px;padding:0 12px;background:#1f1730;border-bottom:1px solid #3b2f48}
#ed header b{color:#e84aa9;letter-spacing:2px;margin-right:6px}
#ed header .grow{flex:1}
#ed input,#ed select,#ed textarea{background:#140f1e;color:#ece7f4;border:1px solid #3b2f48;border-radius:4px;padding:6px 8px;font:inherit}
#ed button{background:#2a2038;color:#ece7f4;border:1px solid #3b2f48;border-radius:4px;padding:7px 11px;cursor:pointer;font:700 12px Arial,sans-serif}
#ed button:hover{border-color:#71eaff}
#ed button.primary{background:#e84aa9;border-color:#e84aa9;color:#fff}
#ed button.danger{border-color:#ff4d6a;color:#ff9aa8;margin-top:8px}
#ed .check{display:flex;align-items:center;gap:6px;color:#a8b8c9}
#tools{display:flex;flex-direction:column;gap:6px;padding:10px;background:#1a1328;border-right:1px solid #3b2f48;overflow:auto}
#tools button{text-align:left;display:flex;gap:8px;align-items:center;font-weight:400}
#tools button b{display:inline-block;width:18px;color:#f6b73d}
#tools button.on{background:#e84aa933;border-color:#e84aa9}
#ed main{position:relative;overflow:hidden}
#map{position:static;width:100%;height:100%;display:block;cursor:crosshair}
#coords{position:absolute;left:10px;bottom:8px;color:#a8b8c9;font-size:12px;background:#150f1ecc;padding:3px 8px;border-radius:4px}
#ed aside{background:#1a1328;border-left:1px solid #3b2f48;padding:12px;overflow:auto}
#ed aside h3{margin:14px 0 8px;font-size:12px;letter-spacing:1.5px;color:#f6b73d}
#ed aside h3:first-child{margin-top:0}
#ed aside label{display:grid;grid-template-columns:100px 1fr;align-items:center;gap:8px;margin:6px 0}
#ed aside label span{color:#a8b8c9}
#ed aside input,#ed aside select{width:100%;box-sizing:border-box}
#ed .hint{color:#a8b8c9;margin:4px 0 8px}
#ed .palette{display:grid;grid-template-columns:repeat(2,1fr);gap:6px}
#ed .palette button{display:grid;justify-items:center;gap:3px;padding:6px;font-weight:400}
#ed .palette button.on{border-color:#e84aa9;background:#e84aa922}
#ed .palette button.off-biome{opacity:.5}
#ed .palette canvas{width:64px;height:64px;border-radius:4px}
#ed .palette span{font-size:11px;text-align:center}
#ed .palette small{color:#a8b8c9;font-size:10px}
#issues{list-style:none;padding:0;margin:0;display:grid;gap:4px}
#issues li{background:#ff4d6a1f;border-left:3px solid #ff4d6a;padding:5px 8px;cursor:pointer;border-radius:3px}
#issues li.ok{background:#8ce4b41a;border-color:#8ce4b4;cursor:default}
#io{position:fixed;inset:0;background:#0b0812d8;display:flex;align-items:center;justify-content:center;z-index:10}
#io[hidden]{display:none}
.io-panel{width:min(680px,94vw);background:#1f1730;border:1px solid #3b2f48;border-radius:10px;padding:18px;display:grid;gap:10px}
.io-panel b{color:#f6b73d;letter-spacing:2px}
#io-text{min-height:300px;font:12px ui-monospace,Menlo,monospace}
.io-actions{display:flex;justify-content:flex-end;gap:8px}
`;
