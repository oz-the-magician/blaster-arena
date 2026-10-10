// Ground relief that does not touch gameplay: physics, navigation and placement still treat the ground
// as flat (y = 0). Two visual layers:
//   1. normalCanvas — a normal map painted from a noise heightfield, so light and shade show dunes / tussocks
//      on the whole floor (zero geometric change);
//   2. lift(x, z) — a gentle displacement of the ground mesh, at most AMPLITUDE metres, faded out near routes,
//      courtyards, stairs, platforms, pads, the ravine and clusters, so feet and props never visibly float or sink.
export const AMPLITUDE = 0.25;

function hash(ix, iz, seed) {
  let h = (ix * 374761393 + iz * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function valueNoise(x, z, seed) {
  const ix = Math.floor(x),
    iz = Math.floor(z),
    fx = x - ix,
    fz = z - iz,
    sx = fx * fx * (3 - 2 * fx),
    sz = fz * fz * (3 - 2 * fz),
    a = hash(ix, iz, seed),
    b = hash(ix + 1, iz, seed),
    c = hash(ix, iz + 1, seed),
    d = hash(ix + 1, iz + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz; // 0..1
}
const segDistance = (px, pz, ax, az, bx, bz) => {
  const dx = bx - ax,
    dz = bz - az,
    l = dx * dx + dz * dz,
    t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l)) : 0;
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
};
const rectDistance = (px, pz, r) =>
  Math.hypot(Math.max(0, Math.abs(px - r.x) - r.w / 2), Math.max(0, Math.abs(pz - r.z) - r.d / 2));
const smooth = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export function createRelief(plan, { zones = [], clusters = [] } = {}) {
  const seed = [...String(plan.seed)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7),
    desert = plan.theme?.id === "desert",
    angle = hash(1, 2, seed) * Math.PI;
  // heightfield in metres-ish units; desert = long wind-swept dunes, meadow = soft tussocks
  const field = (x, z, fine = true) => {
    let h;
    if (desert) {
      const u = x * Math.cos(angle) + z * Math.sin(angle),
        v = -x * Math.sin(angle) + z * Math.cos(angle),
        warp = valueNoise(v / 18, u / 40, seed) * 6;
      h = Math.sin((u + warp) / 4.2) * 0.5 + 0.5;
      h = h * 0.75 + valueNoise(x / 9, z / 9, seed + 3) * 0.25;
    } else h = valueNoise(x / 7, z / 7, seed) * 0.7 + valueNoise(x / 3, z / 3, seed + 5) * 0.3;
    if (fine) h += (valueNoise(x / 1.1, z / 1.1, seed + 9) - 0.5) * (desert ? 0.12 : 0.35);
    return h;
  };
  // where the ground must stay flat (the walkable / built parts)
  const segments = [];
  for (const r of plan.coreRoutes || [])
    for (let i = 1; i < r.points.length; i++) {
      const [ax, ah, az] = r.points[i - 1],
        [bx, bh, bz] = r.points[i];
      if (Math.abs(ah) < 0.5 && Math.abs(bh) < 0.5) segments.push([ax, az, bx, bz]);
    }
  const rects = [
    ...zones.map((z) => ({ ...z, pad: 2 })),
    ...(plan.skyPlatforms || []).map((p) => ({ ...p, pad: 1.5 })),
    ...(plan.ramps || []).map((r) => {
      const alongX = Math.abs(r.x1 - r.x0) > Math.abs(r.z1 - r.z0);
      return {
        x: (r.x0 + r.x1) / 2,
        z: (r.z0 + r.z1) / 2,
        w: alongX ? Math.abs(r.x1 - r.x0) : r.width,
        d: alongX ? r.width : Math.abs(r.z1 - r.z0),
        pad: 2.5,
      };
    }),
    ...(plan.pit?.w > 0 ? [{ ...plan.pit, pad: 2 }] : []),
    ...(plan.moat || []).map((m) => ({ ...m, pad: 2 })),
  ];
  const discs = [
    ...(plan.jumpPads || []).map((p) => [p.x, p.z, 3]),
    ...clusters.map((c) => [c.x, c.z, 9]),
    ...(plan.medkits || []).map(([x, z]) => [x, z, 1.5]),
  ];
  const freedom = (x, z) => {
    let m = 1;
    for (const [ax, az, bx, bz] of segments) m = Math.min(m, smooth(3, 7, segDistance(x, z, ax, az, bx, bz)));
    for (const r of rects) m = Math.min(m, smooth(r.pad * 0.3, r.pad + 3, rectDistance(x, z, r)));
    for (const [px, pz, pr] of discs) m = Math.min(m, smooth(pr * 0.6, pr + 2, Math.hypot(x - px, z - pz)));
    return m;
  };
  const lift = (x, z) => {
    const m = freedom(x, z);
    return m <= 0 ? 0 : (field(x, z, false) - 0.35) * AMPLITUDE * m;
  };

  // normal map from the full-detail field
  let normalCanvas = null;
  if (typeof document !== "undefined" && document.createElement) {
    const size = 768, // ~0.29 m per pixel: enough for the 1 m tussocks, cheap to build
      L = plan.limit ?? 110,
      step = (2 * L) / size,
      canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext?.("2d");
    if (ctx) {
      const img = ctx.createImageData(size, size),
        strength = desert ? 1.1 : 0.8; // v78: barely there; only large shapes
      for (let j = 0; j < size; j++)
        for (let i = 0; i < size; i++) {
          const x = -L + (i + 0.5) * step,
            z = -L + (j + 0.5) * step,
            dx = (field(x + step, z, false) - field(x - step, z, false)) / (2 * step),
            dz = (field(x, z + step, false) - field(x, z - step, false)) / (2 * step);
          let nx = -dx * strength,
            ny = 1,
            nz = -dz * strength;
          const l = Math.hypot(nx, ny, nz);
          nx /= l;
          ny /= l;
          nz /= l;
          const o = (j * size + i) * 4;
          // tangent space for a ground plane with uv.u = +x and uv.v = −z: R = x, G = −z, B = up
          img.data[o] = (nx * 0.5 + 0.5) * 255;
          img.data[o + 1] = (-nz * 0.5 + 0.5) * 255;
          img.data[o + 2] = (ny * 0.5 + 0.5) * 255;
          img.data[o + 3] = 255;
        }
      ctx.putImageData(img, 0, 0);
      normalCanvas = canvas;
    }
  }
  return { lift, normalCanvas };
}
