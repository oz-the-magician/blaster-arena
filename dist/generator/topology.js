// Stage 1: logical connectivity. Diagram positions are not world coordinates.
export const schemes = {
  ravine: "Кольцо вокруг оврага",
  fort: "Два двора и крепость",
  cascade: "Каскад террас",
};
const candidates = {
  close: ["quarter", "ruins"],
  maneuver: ["courtyard", "terraces"],
  open: ["plaza"],
  crossing: ["bridges"],
  vantage: ["tower", "terraces"],
  low: ["ruins", "courtyard"],
};
function random(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let n = h;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
export function generateTopology({ scheme = "ravine", seed = "arena-1" } = {}) {
  if (!Object.hasOwn(schemes, scheme)) throw Error("Unknown arena scheme");
  seed = String(seed);
  const rng = random(scheme + ":" + seed),
    nodes = [],
    edges = [],
    cycles = [];
  function node(id, role, height, x, z) {
    const n = {
      id,
      role,
      height,
      diagram: { x, z },
      compatibleTemplates: [...candidates[role]],
      spawn: id === "m0",
    };
    nodes.push(n);
    return n;
  }
  function edge(a, b, lane, kind) {
    if (edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a))) return;
    const na = nodes.find((n) => n.id === a),
      nb = nodes.find((n) => n.id === b);
    kind ??= na.height !== nb.height ? "stairs" : na.height >= 5 ? "bridge" : "passage";
    edges.push({
      id: "e" + edges.length,
      a,
      b,
      lane,
      kind,
      walkable: kind !== "jump",
      bidirectional: kind !== "jump",
      heightDelta: nb.height - na.height,
      width: lane === "main" ? 5 : lane === "upper" ? 3 : 4,
      ports: { a: "exit-" + b, b: "exit-" + a },
      ...(kind === "jump" ? { launch: "movement-direction", optional: true } : {}),
    });
  }
  const roles = ["close", "maneuver", "open", "close", "maneuver", "open"];
  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }
  const coords =
    scheme === "fort"
      ? [
          [15, 20],
          [40, 15],
          [70, 20],
          [85, 65],
          [60, 80],
          [20, 70],
        ]
      : [
          [20, 20],
          [50, 10],
          [80, 20],
          [80, 75],
          [50, 90],
          [20, 75],
        ];
  const heights = scheme === "cascade" ? [0, 2, 4, 6, 4, 2] : [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 6; i++) node("m" + i, roles[i], heights[i], ...coords[i]);
  for (let i = 0; i < 6; i++) edge("m" + i, "m" + ((i + 1) % 6), "main");
  cycles.push(["m0", "m1", "m2", "m3", "m4", "m5", "m0"]);
  const lowHeight = scheme === "cascade" ? -2 : -3;
  for (let i = 0; i < 3; i++) node("l" + i, "low", lowHeight, 35 + i * 15, 60);
  edge("m0", "l0", "lower");
  edge("l0", "l1", "lower");
  edge("l1", "l2", "lower");
  edge("l2", "m3", "lower");
  const upper = scheme === "cascade" ? [6, 10, 8] : scheme === "fort" ? [4, 9, 4] : [6, 9, 6];
  for (let i = 0; i < 3; i++) node("u" + i, i === 1 ? "vantage" : "crossing", upper[i], 35 + i * 15, 35);
  edge("m1", "u0", "upper");
  edge("u0", "u1", "upper");
  edge("u1", "u2", "upper");
  edge("u2", "m4", "upper");
  edge("u1", "m2", "upper", "jump");
  if (scheme === "fort") {
    node("c", "maneuver", 3, 50, 48);
    edge("m0", "c", "main");
    edge("c", "m3", "main");
    edge("c", "u0", "upper");
  }
  // Seed chooses a further ground flank; the required circulation stays intact.
  const pair = rng() < 0.5 ? ["m1", "m4"] : ["m2", "m5"];
  edge(...pair, "flank");
  const graph = {
    version: 1,
    scheme,
    name: schemes[scheme],
    seed,
    nodes,
    edges,
    mainCycle: cycles[0],
    lanes: {
      main: ["m0", "m1", "m2", "m3", "m4", "m5"],
      lower: ["l0", "l1", "l2"],
      upper: ["u0", "u1", "u2"],
    },
  };
  const result = validateTopology(graph);
  if (!result.valid) throw Error(result.errors.join("; "));
  return graph;
}
export function validateTopology(graph) {
  const errors = [],
    nodes = graph.nodes ?? [],
    edges = graph.edges ?? [],
    ids = new Set(nodes.map((n) => n.id)),
    adj = new Map(nodes.map((n) => [n.id, []]));
  if (ids.size !== nodes.length) errors.push("Duplicate node");
  const pairs = new Set();
  for (const e of edges) {
    if (!ids.has(e.a) || !ids.has(e.b) || e.a === e.b) {
      errors.push("Invalid endpoint");
      continue;
    }
    const pair = [e.a, e.b].sort().join("|");
    if (pairs.has(pair)) errors.push("Duplicate connection");
    pairs.add(pair);
    if (e.walkable) {
      adj.get(e.a).push(e.b);
      adj.get(e.b).push(e.a);
    }
    const a = nodes.find((n) => n.id === e.a),
      b = nodes.find((n) => n.id === e.b);
    if (!Number.isFinite(e.width) || e.width <= 0 || e.heightDelta !== b.height - a.height)
      errors.push("Invalid transition");
    if (e.walkable && a.height !== b.height && e.kind !== "stairs") errors.push("Elevation requires stairs");
  }
  const reachable = (removed) => {
    const start = nodes.find((n) => n.id !== removed)?.id;
    if (!start) return new Set();
    const seen = new Set([start]),
      queue = [start];
    for (let i = 0; i < queue.length; i++)
      for (const n of adj.get(queue[i]) ?? [])
        if (n !== removed && !seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
    return seen;
  };
  if (!nodes.length || reachable().size !== nodes.length) errors.push("Disconnected walking routes");
  for (const n of nodes) {
    if (!Number.isFinite(n.height) || !n.compatibleTemplates?.length) errors.push("Invalid zone role");
    if (n.height >= 6 && adj.get(n.id).length < 2) errors.push("High zone needs two walking approaches");
    if (reachable(n.id).size !== nodes.length - 1) errors.push("Single point of failure: " + n.id);
  }
  const cycle = graph.mainCycle ?? [];
  if (cycle.length < 4 || cycle[0] !== cycle.at(-1) || new Set(cycle.slice(0, -1)).size !== cycle.length - 1)
    errors.push("Invalid main cycle");
  for (let i = 1; i < cycle.length; i++)
    if (
      !edges.some(
        (e) =>
          e.walkable &&
          ((e.a === cycle[i - 1] && e.b === cycle[i]) || (e.b === cycle[i - 1] && e.a === cycle[i])),
      )
    )
      errors.push("Broken main cycle");
  if (nodes.filter((n) => n.spawn).length !== 1) errors.push("One start zone required");
  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    metrics: {
      zones: nodes.length,
      connections: edges.length,
      walkingConnections: edges.filter((e) => e.walkable).length,
      heightLevels: new Set(nodes.map((n) => n.height)).size,
    },
  };
}
