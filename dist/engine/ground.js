// Subtract rectangular terrain openings BEFORE constructing the ground mesh.
// Includes the full footprint of every stair descending below the ground plane.
// `extra` (optional) — more rectangles { x, z, w, d } cut out of the ground (e.g. a moat).
export function groundOpenings(pit, ramps, extra = []) {
  // A pit of zero size (arenas without a ravine) contributes no opening.
  return [
    ...extra.map((r) => ({ minX: r.x - r.w / 2, maxX: r.x + r.w / 2, minZ: r.z - r.d / 2, maxZ: r.z + r.d / 2 })),
    ...(pit.w > 0 && pit.d > 0
      ? [{ minX: pit.x - pit.w / 2, maxX: pit.x + pit.w / 2, minZ: pit.z - pit.d / 2, maxZ: pit.z + pit.d / 2 }]
      : []),
    ...ramps
      .filter((r) => r.h < 0)
      .map((r) => {
        const alongX = Math.abs(r.x1 - r.x0) > Math.abs(r.z1 - r.z0);
        return {
          minX: Math.min(r.x0, r.x1) - (alongX ? 0 : r.width / 2),
          maxX: Math.max(r.x0, r.x1) + (alongX ? 0 : r.width / 2),
          minZ: Math.min(r.z0, r.z1) - (alongX ? r.width / 2 : 0),
          maxZ: Math.max(r.z0, r.z1) + (alongX ? r.width / 2 : 0),
        };
      }),
  ];
}

export function intersectsOpening(rect, openings) {
  return openings.some(
    (o) => rect.minX < o.maxX && rect.maxX > o.minX && rect.minZ < o.maxZ && rect.maxZ > o.minZ,
  );
}

// `step` (optional) subdivides the ground into cells no larger than step metres, for visual relief.
export function groundVertices(limit, openings, step = 0) {
  const grid = step ? Array.from({ length: Math.floor((2 * limit) / step) + 1 }, (_, i) => -limit + i * step) : [];
  const xs = [...new Set([-limit, limit, ...grid, ...openings.flatMap((o) => [o.minX, o.maxX])])].sort(
    (a, b) => a - b,
  );
  const zs = [...new Set([-limit, limit, ...grid, ...openings.flatMap((o) => [o.minZ, o.maxZ])])].sort(
    (a, b) => a - b,
  );
  const vertices = [];
  for (let i = 0; i < xs.length - 1; i++)
    for (let j = 0; j < zs.length - 1; j++) {
      const a = xs[i],
        b = xs[i + 1],
        c = zs[j],
        d = zs[j + 1];
      if (intersectsOpening({ minX: a, maxX: b, minZ: c, maxZ: d }, openings)) continue;
      vertices.push(a, 0, c, a, 0, d, b, 0, d, a, 0, c, b, 0, d, b, 0, c);
    }
  return vertices;
}
