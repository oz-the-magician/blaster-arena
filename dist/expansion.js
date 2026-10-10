import { buildZoneTemplates } from "./zone-templates.js";
// Outer districts use all three supplied sets. Architecture is fixed; loose props
// still pass the runtime's support, stair-clearance and overlap predicates.
export function buildExpansion({ T, model, commit, prop }) {
  buildZoneTemplates({ T, model, commit, prop });
  for (const [x, z] of [
    [-69, -32],
    [-58, -32],
    [-69, -16],
    [-59, -15],
  ]) {
    prop("dungeon/barrel", x, z, 1.6, 0, true);
    prop("dungeon/pot", x + 2, z + 1, 1, 0, true);
  }
  prop("dungeon/gate", -72, -35, 2.7, 0, true);
  prop("platformer/tree-pine-small", 70, 37, 3.2, 0, true);
  prop("dungeon/chest", -65, -34, 1.7, 0, true);
  prop("dungeon/rocks", -58, -19, 2.4, 0, true);
  prop("dungeon/wood-structure", -63, -14, 3.2);
  prop("dungeon/wood-support", -72, -29, 2.8);
  prop("dungeon/banner", -71, -35, 2.2);
  for (const [x, z] of [
    [57, -1],
    [65, 8],
    [72, 26],
    [65, 29],
    [2, 66],
    [-5, 62],
  ]) {
    prop("platformer/tree", x, z, 4.6, 0, true);
    prop("platformer/flowers", x + 2, z + 1, 0.8);
    prop("platformer/plant", x - 2, z - 1, 1);
  }
  for (const [x, z] of [
    [58, 10],
    [69, 1],
    [68, 22],
    [-4, 68],
    [6, 60],
  ])
    prop("platformer/mushrooms", x, z, 1.1);
  for (const [x, z] of [
    [58, 16],
    [73, -8],
    [45, 58],
    [-39, 64],
    [-62, 33],
  ]) {
    prop("platformer/rocks", x, z, 2.8, 0, true);
    prop("platformer/crate", x + 3, z + 2, 1.6, 0, true);
    prop("platformer/barrel", x - 2, z + 3, 1.3, 0, true);
  }
  for (const [x, z] of [
    [-66, 18],
    [-59, 24],
    [-69, 24],
  ]) {
    prop("dungeon/column", x, z, 3, 0, true);
    prop("dungeon/chest", x + 2, z - 2, 1.5, 0, true);
  }
  for (let i = 0; i < 6; i++) prop("platformer/fence-low-straight", -9 + i * 3, 73, 3);
  prop("platformer/block-grass-low-large", 58, -32, 4.2, 0, true);
  prop("platformer/fence-low-broken", 12, 73, 3);
  prop("platformer/flag", 8, 65, 3);
  const pets = ["cat", "dog", "fox", "bunny", "deer", "beaver", "bee", "lion"];
  pets.forEach((animal, i) =>
    prop(
      "pets/animal-" + animal,
      -6 + (i % 4) * 4,
      60 + Math.floor(i / 4) * 7,
      1.1,
      i % 2 ? Math.PI / 4 : -Math.PI / 4,
    ),
  );
  return ["Западное подземелье", "Восточный оазис", "Сад кубических животных"];
}
