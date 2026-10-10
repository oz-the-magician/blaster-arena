// A cell can contain several independent walkable layers (bridge and passage).
// One reverse search is shared by all enemies pursuing the same target node.
export class LayeredNavigation {
  constructor({ min, size, step, floors, clear, maxRise = 1.4 }) {
    Object.assign(this, { min, size, step, floors, clear, maxRise });
    this.cells = Array.from({ length: size * size }, () => []);
    this.nodes = [];
    for (let z = 0; z < size; z++)
      for (let x = 0; x < size; x++)
        for (const y of floors(min + x * step, min + z * step))
          if (clear(min + x * step, y, min + z * step)) {
            const id = this.nodes.length;
            this.cells[z * size + x].push(id);
            this.nodes.push({ x: min + x * step, y, z: min + z * step, cx: x, cz: z, edges: [] });
          }
    for (const n of this.nodes) this.linkNode(n);
    this.target = -1;
    this.field = new Int32Array(this.nodes.length);
  }
  // edges from node n to walkable neighbours (4-connected), rejecting thin obstacles and low headroom
  linkNode(n) {
    const { size, floors, clear, maxRise } = this;
    n.edges = [];
    for (const [x, z] of [
      [n.cx + 1, n.cz],
      [n.cx - 1, n.cz],
      [n.cx, n.cz + 1],
      [n.cx, n.cz - 1],
    ]) {
      if (x < 0 || z < 0 || x >= size || z >= size) continue;
      for (const id of this.cells[z * size + x]) {
        const b = this.nodes[id];
        if (Math.abs(b.y - n.y) > maxRise) continue;
        // Reject narrow obstacles between samples; validate headroom along the edge.
        let valid = true;
        for (const t of [0.25, 0.5, 0.75]) {
          const px = n.x + (b.x - n.x) * t,
            pz = n.z + (b.z - n.z) * t,
            levels = floors(px, pz),
            h = levels.reduce(
              (best, v) =>
                Math.abs(v - (n.y + (b.y - n.y) * t)) < Math.abs(best - (n.y + (b.y - n.y) * t)) ? v : best,
              levels[0],
            );
          if (Math.abs(h - (n.y + (b.y - n.y) * t)) > 0.45 || !clear(px, h, pz)) {
            valid = false;
            break;
          }
        }
        if (valid) n.edges.push(id);
      }
    }
    // extra one-way links (targeted jump pads) survive local refreshes
    for (const id of n.extra || []) if (!n.edges.includes(id)) n.edges.push(id);
  }
  // Local update after something in [minX, maxX] × [minZ, maxZ] stopped blocking (a crate broke, a barrel blew up):
  // cells there may gain walkable layers, and nodes there and next to it get their edges recomputed.
  // Much cheaper than a full rebuild, which on a big arena takes hundreds of milliseconds.
  refresh(minX, minZ, maxX, maxZ) {
    const { min, size, step, floors, clear } = this,
      cx0 = Math.max(0, Math.floor((minX - min) / step) - 1),
      cx1 = Math.min(size - 1, Math.ceil((maxX - min) / step) + 1),
      cz0 = Math.max(0, Math.floor((minZ - min) / step) - 1),
      cz1 = Math.min(size - 1, Math.ceil((maxZ - min) / step) + 1),
      touched = [];
    for (let z = cz0; z <= cz1; z++)
      for (let x = cx0; x <= cx1; x++) {
        const cell = this.cells[z * size + x];
        for (const y of floors(min + x * step, min + z * step)) {
          if (cell.some((id) => Math.abs(this.nodes[id].y - y) < 0.01)) continue;
          if (!clear(min + x * step, y, min + z * step)) continue;
          const id = this.nodes.length;
          cell.push(id);
          this.nodes.push({ x: min + x * step, y, z: min + z * step, cx: x, cz: z, edges: [] });
        }
        touched.push(...cell);
      }
    // recompute edges inside the region and one ring around it (neighbours may now reach new nodes)
    for (let z = Math.max(0, cz0 - 1); z <= Math.min(size - 1, cz1 + 1); z++)
      for (let x = Math.max(0, cx0 - 1); x <= Math.min(size - 1, cx1 + 1); x++)
        for (const id of this.cells[z * size + x]) this.linkNode(this.nodes[id]);
    if (this.field.length !== this.nodes.length) this.field = new Int32Array(this.nodes.length);
    this.target = -1; // invalidate the shared search
    return touched.length;
  }
  nearest(p) {
    const cx = Math.round((p.x - this.min) / this.step),
      cz = Math.round((p.z - this.min) / this.step);
    let best = -1,
      distance = Infinity;
    for (let r = 0; r <= 5; r++) {
      for (let z = Math.max(0, cz - r); z <= Math.min(this.size - 1, cz + r); z++)
        for (let x = Math.max(0, cx - r); x <= Math.min(this.size - 1, cx + r); x++)
          for (const id of this.cells[z * this.size + x]) {
            const n = this.nodes[id],
              d = (n.x - p.x) ** 2 + (n.z - p.z) ** 2 + 4 * (n.y - p.y) ** 2;
            if (d < distance) {
              distance = d;
              best = id;
            }
          }
      if (best >= 0 && distance <= this.step * this.step * 2) break;
    }
    return best;
  }
  path(from, to) {
    const start = this.nearest(from),
      end = this.nearest(to);
    if (start < 0 || end < 0) return [];
    if (this.target !== end) {
      this.target = end;
      this.field.fill(-1);
      this.field[end] = end;
      const queue = new Int32Array(this.nodes.length);
      queue[0] = end;
      let tail = 1;
      for (let head = 0; head < tail; head++) {
        const id = queue[head];
        for (const next of this.nodes[id].edges)
          if (this.field[next] < 0) {
            this.field[next] = id;
            queue[tail++] = next;
          }
      }
    }
    if (this.field[start] < 0) return [];
    const path = [];
    for (let at = start; at !== end;) {
      at = this.field[at];
      const { x, y, z } = this.nodes[at];
      path.push({ x, y, z });
    }
    return path;
  }
}
