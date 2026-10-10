// Ground layer: one canvas texture painted from the arena plan, so the floor itself shows where to go.
//   routes   → trodden tracks: currently invisible (TRACK_SHADE = 0), kept in code
//   courtyards → paved plazas with a tile grid
//   stair feet, pads, cluster centres → worn patches
//   arena border → darker, untouched ground; light speckle noise everywhere
// Pure 2D canvas; returns null where there is no DOM (tests), and the game keeps a flat colour then.
const PALETTES = {
  desert: { base: "#c5965e", speckLight: "#d8ad74", speckDark: "#ab7f4c", plaza: "#cdb48c", tile: "#a8926c", worn: "#9d7246", border: "#a67a4a" },
  ruins: { base: "#7d8a5a", speckLight: "#8f9a68", speckDark: "#66724a", plaza: "#9b9a92", tile: "#7a7870", worn: "#7c6f52", border: "#5c6a42" },
  night: { base: "#6a604e", speckLight: "#7a6f5a", speckDark: "#574e40", plaza: "#7d7a76", tile: "#5e5b58", worn: "#4f4636", border: "#3f3a33" },
  meadow: { base: "#7f9c55", speckLight: "#94b264", speckDark: "#6a8746", plaza: "#aaa59a", tile: "#8a8579", worn: "#8f7a50", border: "#5f7d40" },
};

export function paintGround(plan, { zones = [], clusters = [], size = 2048, random = Math.random } = {}) {
  if (typeof document === "undefined" || !document.createElement) return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext?.("2d");
  if (!ctx) return null;
  const P = PALETTES[plan.theme?.id] || PALETTES.desert,
    L = plan.limit ?? 110,
    k = size / (2 * L),
    X = (x) => (x + L) * k,
    Z = (z) => (z + L) * k;

  // base and border falloff
  ctx.fillStyle = P.base;
  ctx.fillRect(0, 0, size, size);
  const edge = ctx.createRadialGradient(size / 2, size / 2, size * 0.32, size / 2, size / 2, size * 0.72);
  edge.addColorStop(0, "rgba(0,0,0,0)");
  edge.addColorStop(1, P.border);
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, size, size);
  ctx.globalAlpha = 1;

  // speckle noise: small blotches of lighter and darker ground
  for (let i = 0; i < 5500; i++) { // v78: half as many, half as strong
    ctx.fillStyle = random() < 0.5 ? P.speckLight : P.speckDark;
    ctx.globalAlpha = 0.09 + random() * 0.11;
    const r = (1 + random() * 3.2) * (size / 1024);
    ctx.beginPath();
    ctx.arc(random() * size, random() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // worn patches: soft dirt under busy spots
  const worn = (x, z, r, a = 0.55) => {
    const g = ctx.createRadialGradient(X(x), Z(z), 0, X(x), Z(z), r * k);
    g.addColorStop(0, P.worn);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = a;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(X(x), Z(z), r * k, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  };
  for (const r of plan.ramps || []) if ((r.baseHeight || 0) >= 0) worn(r.x0, r.z0, 5);
  for (const p of plan.jumpPads || []) if ((p.y || 0) >= 0) worn(p.x, p.z, 4, 0.45);
  for (const c of clusters) worn(c.x, c.z, 7, 0.4);

  // Trodden tracks along ground routes: no colour of their own — the ground underneath is simply
  // darkened by TRACK_SHADE. The ragged shape is drawn opaque into a mask, then laid over once,
  // so overlaps never stack. Drawn before the plazas, whose paving covers them inside courtyards.
  // v75: tracks are invisible (shade 0); the mask code stays so they can be switched back on.
  const TRACK_SHADE = 0,
    mask = document.createElement("canvas");
  mask.width = mask.height = size;
  const m = mask.getContext("2d");
  m.fillStyle = "#000";
  const tread = (points, width) => {
    for (let i = 1; i < points.length; i++) {
      const [ax, , az] = points[i - 1],
        [bx, , bz] = points[i],
        len = Math.hypot(bx - ax, bz - az),
        nx = -(bz - az) / (len || 1),
        nz = (bx - ax) / (len || 1);
      for (let t = 0; t <= len; t += 0.7) {
        const x = ax + ((bx - ax) * t) / len,
          z = az + ((bz - az) * t) / len;
        m.globalAlpha = 1;
        for (let b = 0; b < 3; b++) {
          const off = (random() - 0.5) * width * 0.6,
            r = width * (0.28 + random() * 0.14) * k;
          m.beginPath();
          m.arc(X(x + nx * off), Z(z + nz * off), r, 0, Math.PI * 2);
          m.fill();
        }
        // ragged edge: half-strength stray blobs just outside the track
        if (random() < 0.35) {
          const off = (random() < 0.5 ? -1 : 1) * width * (0.45 + random() * 0.25);
          m.globalAlpha = 0.5;
          m.beginPath();
          m.arc(X(x + nx * off), Z(z + nz * off), (0.4 + random() * 0.6) * k, 0, Math.PI * 2);
          m.fill();
        }
      }
    }
  };
  if (TRACK_SHADE > 0) {
    for (const r of plan.coreRoutes || []) {
      if (r.role === "upper" || r.points.some(([, h]) => Math.abs(h) > 0.5)) continue;
      tread(r.points, r.role === "main" ? 3.5 : 2.6);
    }
    ctx.globalAlpha = TRACK_SHADE;
    ctx.drawImage(mask, 0, 0);
    ctx.globalAlpha = 1;
  }

  // plazas: paved courtyards with a tile grid
  for (const z of zones) {
    const x0 = X(z.x - z.w / 2),
      z0 = Z(z.z - z.d / 2),
      w = z.w * k,
      d = z.d * k;
    ctx.fillStyle = P.plaza;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x0, z0, w, d, 2.5 * k) : ctx.rect(x0, z0, w, d);
    ctx.fill();
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = P.tile;
    ctx.lineWidth = 1;
    const step = 2.5 * k;
    for (let gx = x0 + step; gx < x0 + w - 1; gx += step) {
      ctx.beginPath();
      ctx.moveTo(gx, z0 + 2);
      ctx.lineTo(gx, z0 + d - 2);
      ctx.stroke();
    }
    for (let gz = z0 + step; gz < z0 + d - 1; gz += step) {
      ctx.beginPath();
      ctx.moveTo(x0 + 2, gz);
      ctx.lineTo(x0 + w - 2, gz);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  return canvas;
}

// UVs for the ground mesh: world x/z mapped onto the painted square.
export function groundUVs(positions, limit) {
  const uv = new Float32Array((positions.length / 3) * 2);
  for (let i = 0, j = 0; i < positions.length; i += 3, j += 2) {
    uv[j] = (positions[i] + limit) / (2 * limit);
    uv[j + 1] = 1 - (positions[i + 2] + limit) / (2 * limit);
  }
  return uv;
}
