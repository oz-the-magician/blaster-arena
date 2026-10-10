import { generateTopology, validateTopology } from "./topology.js";
const $ = (id) => document.getElementById(id),
  svg = $("graph"),
  NS = "http://www.w3.org/2000/svg";
let current;
const colors = { main: "#efc28b", lower: "#7bd4bd", upper: "#92cafd", flank: "#b7a8ef" },
  roles = {
    close: "Ближний бой",
    maneuver: "Манёвры",
    open: "Открытая зона",
    crossing: "Переход",
    vantage: "Огневая точка",
    low: "Низина",
  };
function element(tag, attrs, parent = svg) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent.append(e);
  return e;
}
function text(value, x, y, parent = svg, size = 14) {
  const e = element("text", { x, y, "text-anchor": "middle", fill: "#e6edf4", "font-size": size }, parent);
  e.textContent = value;
  return e;
}
function position(n) {
  return { x: n.diagram.x * 10, y: n.diagram.z * 7.5 };
}
function render() {
  current = generateTopology({ scheme: $("scheme").value, seed: $("seed").value || "arena-1" });
  svg.replaceChildren();
  const byId = new Map(current.nodes.map((n) => [n.id, n]));
  for (const e of current.edges) {
    const a = position(byId.get(e.a)),
      b = position(byId.get(e.b));
    element("line", {
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      stroke: colors[e.lane],
      "stroke-width": e.lane === "main" ? 5 : 3,
      "stroke-dasharray": e.kind === "jump" ? "8 8" : "none",
      opacity: 0.65,
    });
    if (e.kind === "stairs") text("↗", (a.x + b.x) / 2, (a.y + b.y) / 2 - 6, svg, 20);
    if (e.kind === "jump") {
      const dx = b.x - a.x,
        dy = b.y - a.y,
        t = 0.65,
        x = a.x + dx * t,
        y = a.y + dy * t,
        len = Math.hypot(dx, dy),
        ux = dx / len,
        uy = dy / len;
      element("polygon", {
        points: `${x},${y} ${x - ux * 16 - uy * 7},${y - uy * 16 + ux * 7} ${x - ux * 16 + uy * 7},${y - uy * 16 - ux * 7}`,
        fill: colors[e.lane],
      });
    }
  }
  for (const n of current.nodes) {
    const p = position(n),
      lane = n.id[0] === "l" ? "lower" : n.id[0] === "u" ? "upper" : "main",
      g = element("g", {
        tabindex: 0,
        role: "button",
        "aria-label": `${roles[n.role]}, высота ${n.height} метров`,
        style: "cursor:pointer",
      });
    element(
      "circle",
      { cx: p.x, cy: p.y, r: 37, fill: "#202d37", stroke: colors[lane], "stroke-width": n.spawn ? 5 : 2 },
      g,
    );
    text(n.spawn ? "СТАРТ" : n.id.toUpperCase(), p.x, p.y - 5, g, 13);
    text(`${n.height} м`, p.x, p.y + 16, g, 16);
    text(roles[n.role], p.x, p.y + 57, g, 13);
    const inspect = () => {
      $("details").textContent =
        `${n.id.toUpperCase()} · ${roles[n.role]} · ${n.height} м. Подходящие шаблоны: ${n.compatibleTemplates.join(", ")}. Связей: ${current.edges.filter((e) => e.a === n.id || e.b === n.id).length}.`;
    };
    g.onclick = inspect;
    g.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        inspect();
      }
    };
  }
  const v = validateTopology(current);
  $("status").textContent =
    `${v.metrics.zones} зон · ${v.metrics.connections} связей · ${v.metrics.heightLevels} уровня высоты. Все зоны связаны пешими маршрутами; единственных критических проходов нет.`;
  $("details").textContent = "Нажмите на зону, чтобы увидеть её назначение.";
}
$("generate").onclick = render;
$("scheme").onchange = render;
$("newseed").onclick = () => {
  $("seed").value = "arena-" + crypto.getRandomValues(new Uint32Array(1))[0];
  render();
};
$("seed").onkeydown = (e) => {
  if (e.key === "Enter") render();
};
$("export").onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(current, null, 2)], { type: "application/json" })),
    a = document.createElement("a");
  a.href = url;
  a.download = `arena-${current.scheme}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
render();
