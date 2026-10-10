// XZ broad phase. Exact geometry/height checks remain in the caller.
export class SpatialIndex {
  constructor(cellSize = 8) {
    this.cellSize = cellSize;
    this.cells = new Map();
    this.members = new Map();
  }
  clear() {
    this.cells.clear();
    this.members.clear();
  }
  insert(item, box) {
    this.remove(item);
    const keys = [];
    for (let x = Math.floor(box.min.x / this.cellSize); x <= Math.floor(box.max.x / this.cellSize); x++)
      for (let z = Math.floor(box.min.z / this.cellSize); z <= Math.floor(box.max.z / this.cellSize); z++) {
        const key = `${x},${z}`;
        if (!this.cells.has(key)) this.cells.set(key, new Set());
        this.cells.get(key).add(item);
        keys.push(key);
      }
    this.members.set(item, keys);
  }
  remove(item) {
    for (const key of this.members.get(item) || []) {
      const cell = this.cells.get(key);
      cell.delete(item);
      if (!cell.size) this.cells.delete(key);
    }
    this.members.delete(item);
  }
  queryBox(box) {
    const found = new Set();
    for (let x = Math.floor(box.min.x / this.cellSize); x <= Math.floor(box.max.x / this.cellSize); x++)
      for (let z = Math.floor(box.min.z / this.cellSize); z <= Math.floor(box.max.z / this.cellSize); z++)
        for (const item of this.cells.get(`${x},${z}`) || []) found.add(item);
    return [...found];
  }
  queryPoint(x, z, radius = 0) {
    return this.queryBox({ min: { x: x - radius, z: z - radius }, max: { x: x + radius, z: z + radius } });
  }
  querySegment(origin, direction, distance) {
    if (!Number.isFinite(distance)) throw new Error("Spatial ray requires a finite range");
    const end = { x: origin.x + direction.x * distance, z: origin.z + direction.z * distance };
    // Bounding rectangle is conservative, including diagonal rays and boundary contacts.
    return this.queryBox({
      min: { x: Math.min(origin.x, end.x), z: Math.min(origin.z, end.z) },
      max: { x: Math.max(origin.x, end.x), z: Math.max(origin.z, end.z) },
    });
  }
}
