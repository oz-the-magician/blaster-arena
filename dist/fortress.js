// Connected architecture uses explicit joints; placement may never move one of its pieces.
// Joints within one assembly are intentional. Separate assemblies and loose props must stay clear.
export function buildFortress({ T, model, commit, skyPlatforms }) {
  const assemblies = [];
  function assembly(name, build) {
    const parts = [],
      id = name;
    function piece(key, x, z, w, d, h, y = 0) {
      const obj = model(key, 1),
        box = new T.Box3().setFromObject(obj),
        size = box.getSize(new T.Vector3());
      obj.scale.set(w / size.x, h / size.y, d / size.z);
      obj.position.set(x, y, z);
      obj.userData.assembly = id;
      obj.userData.walkableTop = key === "arena/wall" || key === "arena/block";
      parts.push(obj);
      return obj;
    }
    function wall(x0, z0, x1, z1, h = 3.4, y = 0, key = "arena/wall") {
      const length = Math.hypot(x1 - x0, z1 - z0),
        count = Math.ceil(length / 4),
        alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
      for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count;
        const obj = piece(
          key,
          x0 + (x1 - x0) * t,
          z0 + (z1 - z0) * t,
          length / count,
          key.startsWith("graveyard/") ? 0.3 : 0.8,
          h,
          y,
        );
        if (!alongX) obj.rotation.y = Math.PI / 2;
      }
    }
    function post(x, z, h = 4, y = 0) {
      piece("arena/column", x, z, 1.35, 1.35, h, y);
    }
    build({ piece, wall, post });
    commit(name, parts);
    assemblies.push({ name, parts });
  }
  assembly("Крепостная ограда", ({ wall, post }) => {
    wall(-79, -79, 79, -79, 3);
    wall(-79, 79, 79, 79, 3);
    wall(-79, -79, -79, 79, 3);
    wall(79, -79, 79, 79, 3);
    for (const x of [-79, 79]) for (const z of [-79, 79]) post(x, z, 4);
  });
  assembly("Северные ворота", ({ piece, wall, post }) => {
    for (const x of [-8, 8]) {
      piece("arena/block", x, -42, 5, 5, 6);
      for (const dx of [-2.15, 2.15]) for (const dz of [-2.15, 2.15]) post(x + dx, -42 + dz, 7);
      piece("arena/banner", x, -39.35, 1.2, 0.12, 2.8, 3);
    }
    piece("arena/block", 0, -42, 11, 0.9, 1.2, 6);
    wall(-30, -42, -10.5, -42, 3.4);
    wall(10.5, -42, 30, -42, 3.4);
    post(-30, -42);
    post(30, -42);
  });
  for (const side of [-1, 1])
    assembly((side < 0 ? "Западное" : "Восточное") + " крыло форта", ({ wall, post }) => {
      const x = side * 33;
      wall(x, -9, x, -3, 6);
      wall(x, 3, x, 9, 6);
      wall(x, -9, side * 28, -9, 6);
      post(x, -9, 6);
      post(x, 9, 6);
    });
  assembly("Опоры верхнего моста", ({ post }) => {
    for (const x of [-12, 12]) for (const z of [-1.2, 1.2]) post(x, z, 5.35);
  });
  assembly("Западный разрушенный двор", ({ wall, post }) => {
    wall(-45, -33, -31, -33);
    wall(-45, -33, -45, -27);
    wall(-45, -21, -45, -15, 1.4);
    wall(-31, -33, -31, -27, 2.6);
    wall(-31, -21, -31, -15, 1.2);
    wall(-45, -15, -40, -15, 2);
    wall(-36, -15, -31, -15, 2.8);
    for (const [x, z] of [
      [-45, -33],
      [-31, -33],
      [-45, -15],
      [-31, -15],
    ])
      post(x, z, 3.7);
  });
  assembly("Южный разрушенный двор", ({ wall, post }) => {
    wall(17, 33, 27, 33, 2);
    wall(32, 33, 39, 33, 3.6);
    wall(39, 33, 39, 47, 3.6);
    wall(39, 47, 27, 47, 2.7);
    wall(22, 47, 17, 47, 1.2);
    wall(17, 47, 17, 42, 2.7);
    for (const [x, z] of [
      [39, 33],
      [39, 47],
      [17, 47],
    ])
      post(x, z, 4);
  });
  assembly("Кладбищенская ограда", ({ wall, post }) => {
    const y = 1.2;
    wall(16.8, -31.2, 31.2, -31.2, 1.6, y, "graveyard/iron-fence");
    wall(31.2, -31.2, 31.2, -8.8, 1.6, y, "graveyard/iron-fence");
    wall(16.8, -31.2, 16.8, -24, 1.6, y, "graveyard/iron-fence");
    wall(16.8, -10, 16.8, -8.8, 1.6, y, "graveyard/iron-fence");
    wall(16.8, -8.8, 21, -8.8, 1.6, y, "graveyard/iron-fence");
    wall(27, -8.8, 31.2, -8.8, 1.6, y, "graveyard/iron-fence");
    for (const [x, z] of [
      [16.8, -31.2],
      [31.2, -31.2],
      [16.8, -8.8],
      [31.2, -8.8],
    ])
      post(x, z, 2, y);
  });
  for (const p of skyPlatforms.filter((p) => p.h >= 9))
    assembly("Башня " + p.x + "," + p.z, ({ piece, post }) => {
      piece("arena/block", p.x, p.z, 5, 5, p.h - 0.65);
      for (const dx of [-2.1, 2.1]) for (const dz of [-2.1, 2.1]) post(p.x + dx, p.z + dz, p.h - 0.65);
    });
  for (const p of skyPlatforms.filter((p) => p.d > 6))
    assembly("Парапет " + p.x + "," + p.z, ({ wall }) => {
      if (p.h >= 6) {
        wall(p.x - p.w / 2 + 0.65, p.z - p.d / 2 + 0.65, p.x - 3, p.z - p.d / 2 + 0.65, 1, p.h);
        wall(p.x + 3, p.z - p.d / 2 + 0.65, p.x + p.w / 2 - 0.65, p.z - p.d / 2 + 0.65, 1, p.h);
      } else
        wall(p.x - p.w / 2 + 0.65, p.z - p.d / 2 + 0.65, p.x + p.w / 2 - 0.65, p.z - p.d / 2 + 0.65, 1, p.h);
    });
  return assemblies;
}
