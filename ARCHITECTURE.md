# BLASTER ARENA: architecture and validation

Static browser game. No bundler or runtime server is required. Run `npm run check` and `npm test`; all model dependencies are local.

## Modules

- `dist/game.js`: input, cameras, combat, actors, placement and lifecycle.
- `dist/level.js`: the authored ravine fort, routes, terrain, stairs and pad parameters.
- `dist/zone-templates.js`: seven local-coordinate zone templates and translation adapter.
- `dist/fortress.js`: connected wall assemblies, gates, roof supports and parapets.
- `dist/expansion.js`, `expansion-assets.js`: outer districts and 36 additional Kenney models.
- `dist/engine/navigation.js`: multiple walking layers per cell, sampled edges and shared target search.
- `dist/engine/spatial.js`: conservative broad phase for rays, collision and placement.
- `dist/engine/ground.js`: ground subtraction around ravine and descending stair footprints.
- `dist/engine/jump-pad.js`: contact impulse using actual motion, falling boost and mass.

## Authored ravine fort, version 38

The 160 × 160 m arena now has a continuous 16 × 50 m ravine at −3 m, a ground-level crossing with an independent passage beneath, courts at 0–3 m, connected roofs and a high bridge at 6 m, and a 9 m tower with ground and roof stair approaches. Four descending stairways enter the ravine. Eastern terraces also have two walking approaches to their upper deck. Roof foundations and bridge pillars connect the elevated geometry to the fort. Parapets leave stair mouths open.

`coreRoutes` reserves continuous lower, main and upper lane envelopes before loose scenery is placed. The seven existing outer templates remain authored placements; this is a coherent hand-authored foundation for a later arena assembler, not a random graph generator.

## Generation invariants

Generate terrain, fixed architecture, loose decorations, supplies and pads, then build the spatial indices and navigation. Architecture pieces stay at explicit joints; they cannot relocate independently. Stair corridors reserve 1.85 m of headroom and reject blocking architecture. Treads have continuous foundations and match the walking height function, including stairs starting from an elevated base. Solid stair interiors block actors.

Loose objects must fit their complete support footprint, clear stairs, reserved lanes, pad envelopes and all registered decorations. Rounded grass surfaces additionally require nine ray-tested flat support points. Invalid proposals search nearby on the same support surface; impossible placements are rejected. Pickups reserve their rotation/bobbing envelope. Persistent supply locations remain reserved through destruction and collection so restart cannot restore them inside dropped weapons.

Ground meshes and instanced tiles subtract the complete descending stair footprints before construction. Ravine faces are split around the stair mouths. A ray regression checks the centre and both edges of every descending tread.

## Navigation and runtime

Navigation contains separate nodes for each physical floor at a shared X/Z location. Solid platforms and stair foundations replace the floor beneath them; bridge slabs add an independent upper surface. Headroom and actor collision reject unusable nodes. Adjacent cells connect only when height changes are walkable, with three intermediate clearance samples to catch thin walls. All enemies pursuing the same target node reuse one search field. Navigation is rebuilt after collision changes; explosive chains defer this rebuild until the next update. Bots seek stairs when their target is on another elevation even with line of sight. Jump pads launch bots on contact but are not strategic graph edges.

Spatial buckets reduce collision, placement and short-ray candidates. Exact Three.js geometry still determines ray hits. Repeated terrain is instanced in local groups. Projectile/particle geometry is cached; effect count is bounded. Removed drops deregister and dispose owned resources. Restart clears actors, drops, effects and restores supplies. Shared asset geometry is retained.

## Validation and limits

Six unit tests cover spatial boundaries and rays, pad impulse/contact behavior, overlapping navigation layers and thin-wall edge rejection. The runtime harness loads real Three.js GLTF geometry and animations with a fake DOM/renderer. It checks all 18 weapons and 12 characters, all generated pads and medkits, footprint support, overlap and lane rules, every positive staircase, descending stair visibility, all spawn routes and upper decks, the lower/main/upper routes and both tower approaches. A bot actually follows the tower stair path and walks beneath the ground-level bridge. Additional checks cover rear-camera aiming, jumping onto a 1.85 m crate, bridge-pad landing, three waves and three restarts, and indexed/full-scene equivalence for 200 rays.

The current layout has 13 pads and 17 medkits. These checks verify geometry and simulation; they do not measure browser FPS or validate WebGL appearance. Wave sizes are unchanged. Strategic jump-pad navigation and procedural assembly remain future work.

## Weapon muzzle origins, version 40

Each equipped weapon has a muzzle anchor at the centre of its forward geometry tip. Its world position follows the holder, recoil, actor rotation and actor scale. Player camera/aim targets are resolved from this origin; enemies use the same muzzle helper. Both projectile and flash originate at the anchor. A chest-to-muzzle geometry check prevents a protruding barrel from firing through walls. Regression covers all 18 guns at three rotations, shared flash/projectile origins, a scaled enemy and wall obstruction.

## Arena generator, stage 1

`dist/generator/topology.js` produces a versioned logical graph from a named scheme and seed. Three schemes define a required main cycle, an independently connected lower bypass, an upper route, a high position with two walking approaches, and an optional directional jump escape. The seed changes combat roles and a further flank connection. Nodes declare elevations and compatible template candidates; edges declare transition kind, lane, width and symbolic endpoint ports. Diagram coordinates are schematic and must not be used as world placements.

Validation checks unique nodes/connections, endpoint references, walking connectivity without jump edges, main-cycle integrity, two high approaches, no articulation points, and elevation transition consistency. Unit tests cover 300 seeds, determinism and invalid graphs. The separate `generator/` browser view previews and exports graphs as JSON. Existing runtime geometry is unchanged. Stage 2 must resolve actual template placement/rotation, physical entry points, connectors and reserved envelopes; stage 3 must validate actual geometry and actor navigation before accepting an arena.

## Weapon classes (v44)

ZALP (blaster-o) is a four-projectile rocket salvo: 85 damage per rocket, 4.5 radius with falloff, impact/range-limit detonation, 3 salvos per magazine. SHTORM (blaster-e) is an instant laser: 9 damage, 95 range, zero spread, unlimited target penetration including scenery. Both retain the model-derived muzzle anchor. Rocket blasts can hurt the shooter (25 base self-damage) and trigger explosive crates. Reserves remain unlimited under the existing reload system.

`spawnArenaWeapons()` places all 18 weapons once per fresh match, validating safe placement and walking connectivity. The previous step-of-three selection covered only a subset. Runtime checks cover class behavior, laser wall/range penetration, four rockets, splash/impact/expiry, muzzle origins, placement and the restarted inventory.

## Playable ravine generator (v48)

The default browser arena is compiled by `generator/world.js` from the stage-one ravine graph. Seed controls bank spacing, pit dimensions, upper crossing location, top height, template choices and flank crossing. Twelve nodes have real coordinates; every walking edge produces ground passage, bridge or stair geometry. The arena spans 220 units and four tiers: -5, 0, 8 and 14–16. Routes are reserved before connected template walls, scenery and supplies. Both upper approaches remain walkable without jump pads.

`level.initializeGeneratedLevel` updates the shared level descriptors before navigation bounds initialize. `game.buildGeneratedArena` builds pit faces, stairs with retaining walls, upper decks, connected wall assemblies and supplies; physical navigation verifies every graph node before enabling play. All 18 weapons remain available. Enemy placement selects nearby graph zones and local flanks, avoiding the player start. New-arena controls and replay after the battle reload with a fresh seed; `?seed=...` reproduces a layout. `?arena=classic` preserves the previous arena for regression QA.

Checks: 300 graph-to-world seeds, real GLB runtime checks on 12 further seeds, all node routes, exposed treads, supplies/pad clearance, enemy spawns and the new-arena action. The legacy runtime suite still covers arsenal, projectiles, camera aim and collisions. Managed preview does not support this plain static project; visual browser QA is not available in this environment.

## Combat fixes (v49)

Enemy rockets no longer damage bots; rocket damage to the player is 20 per enemy rocket and 25 for self-damage. Rocket and crate blasts require line of sight to the target. Enemy shotguns fire their full pellet count. Dash no longer grants invulnerability. Medkits are used with Q near a visible kit (tooltip shows the heal amount); they are no longer consumed automatically.

## Ravine variety (v50)

`generateWorld` adds a seeded orientation (90° swap plus mirror on each axis, 8 variants), 0–2 extra ground crossings that avoid stairs, pads and other crossings, and independent east/west bank distances. Pit faces and bank landmarks are emitted by the plan (`pitFaces`, `landmarks`) already oriented; `buildGeneratedArena` no longer assumes a north–south ravine.

## Lighting (v50)

`engine/lighting.js` defines four seeded presets (noon, sunset, dusk, overcast; `?light=<id>` forces one), a gradient sky, distance fog and a sun whose 2048 shadow map follows the view (±34 m isometric, ±60 m rear) with texel snapping.

## Post-processing (v50)

`engine/post.js` renders the scene into a 4× multisampled half-float target and applies one full-screen pass: saturation, contrast, brightness, cool-shadow/warm-highlight split toning and a soft vignette, followed by ACES tone mapping and sRGB output. Values live in `GRADE`. Disabled automatically without WebGL (test harness).

## Effects and quality (v51)

`engine/post.js` adds GTAO ambient occlusion (one pass per camera type, vendored from three r186 under `vendor/addons/`) and a dual-filter bloom fed only by HDR values above `BLOOM.threshold`. The quality button cycles high (AO + bloom), medium (bloom) and low (grade + vignette); the choice is saved in localStorage. Emissive elements use colours above 1 via `HDR(color, k)`: jump-pad rings and arrows, tracers, bolts, muzzle and explosion flashes, and four lanterns at the ravine corners. `engine/flashes.js` keeps a fixed pool of four point lights for muzzle flashes and explosions. Loaded blasters get metalness 0.35 / roughness 0.38 so the environment map reflects on them; stone and arena props get roughness 0.78.

## Perimeter walls (v52)

`buildPerimeterWalls()` rings every generated arena with `arena/wall` tiles (6 m long, 3 m tall) just outside `ARENA_LIMIT`. They are obstacles and solid meshes (block movement, bullets and line of sight) and use the same transparent-fade materials as other arena walls.

## Breakable props (v53)

Crates, barrels, chests and pots placed through `prop()` join the `explosives` list as `inert` entries with HP (pot 12, small crate 25, barrel 30, chest 40, wide crate 45); pots shatter into thin ceramic shards with a higher-pitched sound, chests drop some metal bits. Any weapon or blast that damages explosives breaks them; `shatter()` removes the obstacle, disables their ray layers, marks navigation dirty and throws bouncing debris. Red explosive crates keep their blast. Restart restores everything.

## Balance pass (v54)

`SPEED_SCALE = 1.15` multiplies player walk/sprint and all bot movement (dash unchanged). Enemy shotguns fire nine pellets since v49, so their per-pellet damage drops from 14 to 3 (max 27 point-blank instead of 126). ШТОРМ laser damage 9 → 12 (sustained DPS 49 → 65, burst 64 → 86): still the lowest, offset by unlimited penetration and range.

## Code layout (v56)

All source outside `vendor/` is Prettier-formatted (print width 110); no more minified one-line source. Module imports carry no `?v=` query: only `index.html` versions `game.js`, which avoids loading one module twice under two URLs. `weapons.js` holds the arsenal and `SPEED_SCALE`. `generator/arenas.js` is the arena-type registry: `generateArena(seed, type)` picks a type (from `?type=<id>` or the seed) and stamps `plan.type`. Plans may omit `pit`, `pitFaces` and `landmarks`: `initializeGeneratedLevel` then installs a zero-size pit, `groundOpenings` skips it and `buildGeneratedArena` skips `buildRavine()` and the ravine lanterns. Tests strip multi-line imports and hook `window.__arena = {` with a whitespace-tolerant regex.

## «Две крепости» (v57)

`generator/fortresses.js` builds two mirrored keeps (22 × 26–32 m, 6 m high) on a meadow, joined by a continuous upper lane (keep → bridge → central bastion → bridge → keep). Each keep has two front stairs and one back stair; the bastion has stairs from both flank sides. Six ground zones (four corners, two lane middles) use mirrored templates. Four flank pads lift players onto the upper lane. Decoration comes as plan `landmarks`: battlements on keep tops, team-tinted flags and banners (red west, blue east), weapon racks and practice targets behind the keeps, statues, mirrored field cover (rocks, low fences, crates) and a border of trees and flowers. `scatter` landmarks are skipped when their spot is taken; `collision: false` keeps them decorative; `tint` recolours them.

Visual themes: plans carry `theme` (`ground`, `platform`, optional `lights`). Ravine is desert sand with tan platforms; fortresses is a green meadow with grey stone and only noon, overcast or sunset light.

`generator/arenas.js` registers both types; the seed chooses one, `?type=ravine|fortresses` forces it. The loading line names the arena. `?overview` shows the whole arena from above without fog (layout checking). Tests: `tests/fortresses.test.mjs` (200 seeds of invariants, registry) and two fortress runs of the full generated-runtime harness.

## Arena type picker (v58)

The menu has a «ТИП АРЕНЫ» select filled from `ARENA_TYPES`: «Случайная» (shows the type the seed picked) or a fixed type. Changing it reloads with a fresh seed and `?type=<id>` (or without `type` for random); «НОВАЯ АРЕНА» keeps the chosen type. Disabled on the classic arena.

## Touch controls (v59)

`engine/touch.js` adds landscape touch controls on coarse-pointer devices: a floating move stick on the left 45 % (analog speed, full tilt sprints) and a floating aim stick on the right 55 % (isometric: aims around the player and fires past 55 % tilt; rear view: turns the camera). Buttons: fire, dash, reload, pick up, medkit, view. The start button requests fullscreen and a landscape orientation lock where the browser allows it (Android); in portrait a full-screen «поверни устройство» teaser covers the page (CSS media query, works on iOS too). The HUD is compacted to the top-left on touch devices; pointer lock is skipped.

## Cluster library (v60)

New Kenney kits live under `assets/survival`, `assets/pirate`, `assets/castle`, `assets/town` and `assets/nature` (all GLB models plus colormaps). `generator/clusters.js` holds `CLUSTERS`: named hand-composed scenes (items `[key, x, z, size, rotationDeg, solid]`, themes, allowed placements, footprint radius) and `clusterKeys()`. `clusters.html` + `cluster-preview.js` is the catalogue: thumbnails, theme filter, copyable ids and an orbit viewer with a 1.75 m person for scale. Items may carry a 7th field `y` for stacked pieces; clusters may carry `dense: true`, `tints`, `pads` (jump pads that travel with the cluster, with a landing `target`) and `previewYaw`/`previewPitch` (flat recolour per model key, replacing the palette texture). Clusters are not yet placed in arenas; the decorator pass will reference them by id.

## Pad tiers (v61)

`PAD_TIERS` in `engine/jump-pad.js`: `spring` (vertical 11, ~3.6 m apex, spring model, white rings), `blue` (21, ~13 m, blue rings), `yellow` (25, ~18 m, yellow rings). Flight gravity is 17 m/s², apex = vertical² / 34. A pad with `tier` gets its vertical speed and model from the table (`applyPadTier`, applied in `initializeGeneratedLevel`); horizontal `speed` stays per pad; the pad label names the tier. Ravine: pit escapes blue, flank pads yellow, the tower-top attack pad spring. Fortresses: flank pads blue. The cluster catalogue shows a tier legend and draws cluster pads in their tier.

## Decorator pass 1: clusters in arenas (v62)

`generator/decorate.js` picks up to 11 cluster spots per plan (at most 2 dense ones, other clusters at most twice) from arena edges, corners, the sides of ground routes and open ground, matching the arena theme (`desert` → desert/coast clusters, `meadow` → meadow/fortress/forest). Spots keep clear of routes, stairs, platforms, the ravine, courtyards, pads, medkits, graph nodes, fixed landmarks and each other; clusters face the nearest route (edge clusters face the centre). `placeCluster()` in game.js builds every model (rotation, stacking `y`, flat tints), runs `freePlacement` on each, and commits all or nothing as one assembly: solid parts become obstacles (large tops standable), crates/barrels/chests/pots become breakables, cluster pads join `jumpPads` before pads and navigation are built. Clusters are placed before scattered decor so trees and flowers fill the gaps. `runtimeStats.clusters` lists what was placed; the generated-runtime harness prints it.

## Fill rule (v63)

`decorate()` now measures emptiness on a 4 m grid: route corridors (±3 m), stairs and the ravine floor are roads and never count; any other cell is dead when nothing (courtyard, platform, stair, ravine edge, fixed landmark, cluster, fill prop) lies within `DEAD_DISTANCE` (8 m). Target `MAX_DEAD` (30 %) per quarter of the map. Clusters are placed only in quarters above target and only where they cover at least 8 dead cells (up to 26 clusters, dense ≤ 2, others ≤ 3 times); the remaining holes get clumps of 1 or 3 single props from `FILL[theme]` (rocks, cacti, palms, trees, bushes, logs, barrels, crates). Returns `{ clusters, fill, stats: { before, after } }`; the game places fill through `placeLandmark` with `scatter` checks. `tests/decorate.test.mjs` checks 40 seeds per arena type.

## Ravine pads and bridge undersides (v64)

Ravine escape pads pick their z from the open sky only: never within 4 m of any platform or crossing above the ravine (tower, upper bridge, flank and extra crossings) or of a floor stair; one per half, as close to ±20 m as possible (`tests/world.test.mjs` checks 400 seeds). Bridge and crossing slabs (`connector` sky platforms) are `solidFromBelow`: a rising pad flight of the player or a bot stops at the underside instead of passing through (`hitsBridgeFromBelow`; the generated-runtime harness launches a jump under a bridge and checks the head never crosses it). Walking and landing on top are unchanged.

## КОБРА: double-barrel shotgun (v65)

КОБРА is now shotgun class (`kind: 1`) with `pellets: 2` (both barrels, fired a fixed 0.07 rad apart) and `split: { count: 6, after: 3.5, spread: 0.34 }`: after 3.5 m each slug bursts into six small pellets (own hit set each, same damage 14). Mag 2, rate 0.32 s, reload 1.7 s, range 15 m: 168 damage per pull at most, ~144 sustained DPS, in line with the other shotguns. Bots with КОБРА fire the same two slugs (enemy pellet damage 3). The generated-runtime harness fires a pull and logs slugs and resulting pellets.

## Arsenal catalogue (v65)

`weapons.html` + `weapon-preview.js` render every weapon from `weapons.js` (model thumbnail, class, damage × pellets, per-shot damage, shot pattern incl. split slugs, rate, magazine, reload, range, sustained DPS including reload, pierce and blast notes), grouped by class with a class filter. It reads the live table, so changes to `weapons.js` show up automatically.

## ПУЛЬС and ОХОТНИК (v66)

ПУЛЬС is a laser rifle: `kind: 4` with `beam: "pulse"`, `wallStop` and `pierce: 1`. `laserShot` now sorts everything on the beam (player or bots, breakables) by distance, stops at the first wall for `wallStop` beams and after `pierce` targets; ШТОРМ keeps unlimited reach through walls. Pulse: 110 damage, 1.15 s, mag 6, reload 2.1 s, 48 m; thick short beam with a light flash; enemy pulse hits for 16 + 2·wave.

ОХОТНИК is a new class, `kind: 5`, plasma blade (reworked in v70). Hold fire: the blade (rounded: two flattened capsules, core and glow, cross-section = front quarter of the gun) burns and drains `drain` (12) charge per second; every bot or breakable within 2.6 m in an 80° arc takes 40 every 0.25 s per target (160/s), with a light push and a short stun; contact shows an impact spark and a light flash, there is no swing animation. Release: after 0.4 s the charge refills at 5/s (full in 20 s), counted in game time. The blade works at any charge above zero, also while refilling, it just runs out sooner. R does nothing; HUD shows «% ЗАРЯДА». Bots never carry the blade (`botWeapon`). The harness holds the blade on a bot, drains it dry, refills it and checks it works mid-refill.

`?weapon=<NAME>` (e.g. `?weapon=ОХОТНИК`) starts every round with that weapon, for testing.

## Ground layer (v72)

`engine/ground-paint.js` paints the generated arena floor into one 2048² canvas texture (≈9 px per metre) mapped by world x/z (`groundUVs`): a theme palette (desert sand / meadow grass), a darker border falloff, speckle noise, worn dirt patches at stair feet, ground pads and cluster centres, paved courtyards with a 2.5 m tile grid (zone template extents), and trodden tracks along every ground route (v74: no colour of their own — a ragged mask of blobs, 3.5 m on main lanes and 2.6 m elsewhere, with half-strength stray blobs at the edges, is laid over once and darkens the ground under it by `TRACK_SHADE`; since v75 TRACK_SHADE = 0, so tracks are invisible (code kept, nothing drawn); drawn before the courtyards so the opaque paving hides them inside yards). Upper, stair and ravine-floor routes are not painted. The decorator result is cached on the plan (`plan.decor`) so the painter and `placeClusters` share it. Without a DOM (tests) the ground keeps its flat theme colour.

## Playtest fixes (v76)

- Bots: stuck watchdog in `updateBots` — a bot that wants to move but gains < 0.35 m in 1.2 s follows the navigation path even with line of sight for 2.5 s; after 3.5 s it is put on a path point ≥ 2.5 m ahead (else side-stepped). `runtimeStats.unstuck` counts it; `BOTFLOW=<s> node tests/generated-runtime.mjs <seed>` simulates bots and reports it.
- Ravine: the plain shipwreck is catalogue-only (`decor: false`); arenas use `reefWreck`, the ship stranded 5 m up on a sandstone reef — an unreachable landmark on the dried seabed.
- Fortresses: the upper level gets continuous `wallRuns` from the generator (`buildWallRuns` tiles each run evenly, no gaps): 2.2 m battlements on every keep edge, 1.1 m parapets along bridges and the bastion, open only at stair landings and bridge joins. They replace the old spaced battlement landmarks.
- Ground: only real courtyards are paved (template walls ≥ 20 m, inside the walls' outline); open-plaza and wall-less zones keep natural ground.
- Fortress fill: `theme.fill = { deadDistance: 5.5, maxDead: 0.25, maxClusters: 40, repeat: 4 }` — about 40 clusters and 25–75 fill props per arena.

## Visual relief (v77)

`engine/relief.js` makes the ground look uneven without touching gameplay — `terrainHeight`, navigation and placement still treat it as flat. A seeded heightfield (desert: long wind-swept dunes along a random direction with domain warp; meadow: soft tussocks; plus fine noise) drives two layers: (1) a 768² normal map (`normalCanvas`, strength 4.2 desert / 3.2 meadow) on the ground material, so light and shade show the relief everywhere; (2) `lift(x, z)`, a displacement of the ground mesh — now subdivided into 2 m cells (`groundVertices(limit, openings, step)`) — of at most `AMPLITUDE` = 0.25 m, faded to zero within a few metres of ground routes, courtyards, platforms, stairs, the ravine, pads, medkits and clusters, so feet and props never visibly float or sink.
v78: the ground was too busy. The normal map now uses only the large shapes of the heightfield (no fine noise) at strength 1.1 desert / 0.8 meadow, and the paint speckles are halved in count and opacity. The 0.25 m mesh wave is unchanged.

## «Царь горы» (v80)

`generator/hill.js`: a stepped citadel in the middle of old ruins. Three solid terraces (3, 6, 9 m; half-sizes a1 = 30–34, a2 = a1 − 11, a3 = a2 − 11, so each ring is 11 m wide: a 7 m stair, the edge wall and room to walk past). Ground → terrace 1: 2–4 stairs on random sides with random offsets; terrace 1 → 2: 2 stairs; 2 → summit: 1–2. Spring pads in front of stair-less sides (with a parapet opening above them) and a blue pad on terrace 1 to the top. Continuous `wallRuns` on every terrace edge (1.1 / 1.8 / 1.2 m), open at every stair landing. Four corner courtyards plus 1–2 side courtyards, a square ring road with spokes, castle towers on the terrace-1 corners, banners and a flag on top, scattered ruins and a tree border. Graph nodes for the terraces use `ringSpot`, a spot clear of stairs and pads. Theme `ruins`: mossy ground, grey stone, overcast / sunset / noon, fill rule 6 m / 25 % / 36 clusters.

Game: sky platforms with `solid: true` are built as full stone blocks from `base` to the top (flat tint, stone tiles a shade lighter per level), with a standable, non-one-way obstacle — nothing walks underneath. The upper-level crate/column props now go through `placeLandmark` with `scatter`, so they can never block a stair or landing. Tests: `tests/hill.test.mjs` (200 seeds) and a hill run of the full generated-runtime harness.

## Hill v2: tall tower, moat, siege camp (v82)

- Summit tower: terrace 3 now tops out at 15 m (9 m above terrace 2, three times a terrace step). It is climbed by a double flight on one or two faces: a 7.5 m flight to a 10.5 m landing slab (a slab, not a solid block, so the last treads meet its top), then a 7.5 m flight ending beside the tower face 4 m from the corner; the tower parapet opens 10 m wide there.
- Moat: `plan.moat`, four water strips between `a1 + 10` and `a1 + 16` around the hill, cut out of the ground (`groundOpenings(pit, ramps, extra)`), with stone banks, a dark bottom and a water surface (`buildMoat`). Invisible low boxes block walking into the water except across four bridges (connector sky platforms at h = 0) in the middle of each side; roads lead from the ring road over the bridges to a walkway around the hill.
- Siege camp: `plan.fixedClusters`, eight clusters on a ring between the moat and the ring road, between the bridge roads and facing the citadel; the decorator places them first. New catalogue clusters: `trebuchet`, `ballistaNest`, `siegeTowerRam`, `powderStore` (black-powder barrels listed in `explosive` blow up and chain like red crates), `ruinedWall`.
- Debug: `globalThis.__allowDisconnected` lets the harness probe an unreachable layout instead of throwing.

## Hill fixes (v83)

- Siege machines aim at the citadel: Kenney siege models (catapult, trebuchet, ballista, ram, siege tower) face +x and pirate cannons −z in model space, so cluster items turn them −90° / 180° to the cluster front (+z); siege-camp clusters face the centre.
- The moat is a 4 m deep ditch (`MOAT_DEPTH`) full of leaning wooden stakes (one instanced mesh), earth banks, no water and no blocking boxes: `terrainFloors` drops to −4 inside it, so you can fall in. `updateMoatHazard` deals 20 damage every 0.25 s to the player (dead in ~1.1 s) and 80/s to bots; with immortality the player is put back on the last safe ground after 1.2 s. Bridges still cross it.
- Ground springs around the hill use the new `springHigh` tier (vertical 14, ~5.8 m apex, speed 6): they clear the 3 m terrace edge and land well onto terrace 1. The harness launches a player from a spring pad (must land at y = 3) and drops one into the moat (must die).
v84–86: the tower climb ends on a top landing slab (3 m past the last tread, in the stair lane, flush against the tower face, at 15 m; stone-tinted like the citadel), so the stair leads onto a floor that runs into the tower top through the parapet opening. `?at=x,z` (testing) starts the round at that spot on whatever floor is there.

## Assets per arena and the single-file build (v85)

- `arenaAssetKeys()` loads only the models this arena's decor needs (its clusters, fill props, landmarks and wall runs) on top of the shared base set; the classic arena loads everything.
- `tools/build-artifact.py` builds the published single-file page reproducibly: it bundles `tools/embed-setup.js` + `dist/game.js` with esbuild and embeds every model and texture under `dist/assets`. Models are stored gzip-compressed (`"gz:" + base64`, Kenney GLBs shrink ~5×) and inflated in the page with `DecompressionStream`; textures stay `data:` URIs. All five new kits plus the old packs (876 files) now fit in about 6.6 MB of the 16 MB limit, so future arena types can use any model without a size worry.

## «Амфитеатр», night (v88)

`generator/amphitheatre.js`: a round bowl — flat fighting floor (radius 26–30 m) and three stands (2, 4, 6 m, 8 m deep), rasterised on the 4 m grid (cell centres are multiples of 4) into solid axis-aligned blocks: round from afar, stepped up close. Stairs run radially inside the axis rows (z = 0 / x = 0, width 4, 5 m long for 2 m rises so the last tread is deeper than a body radius): 2–4 floor → stand 1, 2–4 between stands, 2–4 from outside up the back of the top stand (10 m, 6 m rise). The top stand's outer rim carries a 1.2 m parapet (cell edges merged into runs, open at the outer stairs). Springs on the floor diagonals, four corner courtyards outside, a square road and floor cross-routes. Theme `night`: dark sand, dark stone, the `night` light preset (cool moon, readable, never picked at random elsewhere), 12 torches on the top stand (every other one with a flickering point light) and 4 braziers on the floor (`plan.torches`, `buildTorches`/`updateTorches`, HDR flames for the bloom), alternating red/gold banners, broken columns, statues and crates on the floor, siege/fortress clusters outside.

Also: `generatedEnemySpawn` falls back to the nearest nodes at least 18 m away when none is within 95 m (big arenas), instead of possibly the player's own node. Tests: `tests/amphitheatre.test.mjs` (100 seeds) and an amphitheatre run of the generated-runtime harness.
v89: the night preset adds a starry sky — 1 800 stars on the upper hemisphere (a few bright and tinted, pushed above 1 for the bloom), a glowing moon with a soft halo in the moonlight's direction. The dome follows the camera (`lighting.updateSky(camera)`), stays inside the far plane and ignores fog. It shows best in the rear view (V); from the isometric camera mostly the ground is in frame.

## Feel: death burst and weapon punch (v90)

`deathBurst(bot)` replaces the small kill spark: a big flash, an expanding shock ring in the weapon colour, 16 (elite 24) voxel chunks in character colours that fly out, spin and bounce on the ground, a short point light, a two-tone thump and a little camera shake. `shotPunch(w)` gives every shot its weight: camera shake, gun kick-back and a muzzle flip, light for SMGs and the laser, medium for rifles, heavy for shotguns, ПУЛЬС, КОБРА and the rocket launcher; the gun springs back each frame.

## Sound effects (v91)

`dist/assets/sfx/` holds 24 effects cut from the supplied pack with ffmpeg (one clean shot out of each series, silence and long tails trimmed, short fades, mono MP3 80 kb/s, ~390 KB): rifles (`rifle-impulse` ИМПУЛЬС, `rifle-spark` ИСКРА, `rifle-arrow` СТРЕЛА, `rifle-storm` БУРЯ), SMG burst loops (СПЕКТР, ВЕКТОР, ОСА, ФАНТОМ; `smg-single` for bots), `shotgun` (one sample for five guns, pitch per gun), `shotgun-double` (КОБРА, the whole double-shotgun-01: both barrels, 2.3 s), `laser-storm` (ШТОРМ), `laser-pulse` (ПУЛЬС), `rocket` (ЗАЛП), `blade-loop` (ОХОТНИК hum), four reloads plus `reload-shotgun-8` (ДУЭЛЯНТ), `hit` (enemy hit; player hit pitched down), `empty` (dry fire), `jump-pad`, `steps-loop`.

`engine/audio.js`: Web Audio with space. The listener is the player; panning follows screen-right; gain and a low-pass close down between 6 m and 75 m. Voice limits per group (player 8, enemy 4, impact 5, loops 6): a full group drops new far sounds or replaces its farthest voice. Rockets duck everything else briefly; shotgun pellet hits collapse into one hit sound. SMGs loop their burst while the trigger is held, the blade hums while lit, footsteps loop while walking (faster when sprinting). Samples decode from embedded data in the published page (no network); without usable Web Audio the old synth beeps remain.

Balance tied to the sounds: ДУЭЛЯНТ reload 1.65 → 3.8 s with pellets 13 → 15; rifles reload 1.15 → 1.25 s.

## Explosion stutter (v94)

Breaking a crate or blowing up a barrel used to set `navigationDirty`, which rebuilt the whole navigation grid next frame — 300–600 ms on the big arenas (the amphitheatre has ~780 obstacles), a visible freeze. Now `explode` queues the removed box and `LayeredNavigation.refresh(minX, minZ, maxX, maxZ)` updates only that patch: new walkable layers in the cells there, edges recomputed for those cells and one ring around them, the shared search invalidated (~2 ms). `navGrid` is updated for the same cells. Full rebuilds remain for restarts. `prewarmEffects()` compiles the debris / ring / flash materials at round start (materials kept so the programs stay cached), so the first explosion does not stall on shader compilation with the torch lights. `TIMENAV=1 node tests/generated-runtime.mjs <seed> <type>` prints the timings.

## Movement: slide and dash recharge (v96)

- A kill recharges the dash instantly (`kill` → `dashCooldown = 0`, a small cyan puff).
- Slide: C while sprinting (not Ctrl: Ctrl+W would close the tab) on the ground (touch: the ⤓ button): 0.6 s glide along the run direction, 14 → 7 m/s, 0.9 s cooldown, no jumping out of it; the character leans back, and enemy shots test a lower, smaller body (`playerHitHeight()` 0.55 m instead of 1.05 m, radius 0.5) so chest-high shots fly over.

## Biomes (v96)

`generator/biomes.js` separates the look from the layout: `BIOMES` (desert, meadow, ruins, night — ground and stone colours, light presets, model swaps such as pines → palms, torches for night) and `HOME_BIOME` per type (ravine desert, fortresses meadow, hill ruins, amphitheatre night). `generateArena(seed, type, biome)` applies a biome after the layout: the seed picks the home biome 40 % of the time and each other biome 20 %; `?biome=` and the new «БИОМ» menu select force one. The theme keeps the type's fill rule; palette, relief style, cluster pool and fill list follow the biome id. Night on any layout gets `autoTorches` (platform corners, along roads, braziers at courtyards, every third torch lit), placed last and dropped wherever they would collide; amphitheatre torches disappear by day. The loading line names type and biome. Tests: `tests/biomes.test.mjs` and a night-fortress run of the full harness.

## Sound levelling and sci-fi colour (v97)

`tools/process-sfx.py <pack folder>` rebuilds `dist/assets/sfx/` reproducibly. Guns get a "scifi" chain — pitched up 12–40 % with rubberband (length kept), rumble below 180 Hz and harsh highs above 7 kHz cut, a presence lift at 2.6 kHz, phaser, flanger and a short slap echo, then compression; lasers, UI and foley get gentle compression only. Every effect is then levelled to a target mean loudness (shots −22/−23 dB, SMG loops −27, steps −31…) with a limiter, so guns no longer differ by 10–20 dB. At runtime a bus compressor glues the mix and the master is lower (0.62); per-weapon volumes now sit between 0.5 and 0.7.

## Background music (v98)

`source-audio/music-action.mp3` (28 s action loop) is processed by `tools/process-sfx.py` to sit under the effects: 40 Hz–11 kHz like the guns, a −4 dB dip around 2.6 kHz where the shots live (so it does not mask them), light compression, level ~6 dB below the effects, stereo 112 kb/s (~390 KB). `sfx.setMusic(on, level)` plays it as a seamless loop with a 1.5 s crossfade between repeats, on its own gain that bypasses the effects compressor (gunfire does not pump it). Full level in battle, quieter under pause and the end screen. M or the «МУЗЫКА» button toggles it; the choice is remembered. The raw sound pack now lives in `source-audio/sfx/`, so the script runs without arguments.
v99: three background tracks — `music-action` (28 s), `music-drive` (111 s), `music-funk` (128 s). Every `source-audio/music-*.mp3` is processed the same way (leading/trailing silence trimmed for clean loops, same EQ, compression and level). Each arena picks one by its seed (`?music=action|drive|funk` forces one); only the chosen track is decoded (a decoded 2-minute track is ~40 MB of memory). The published page is now ~12.2 MB of the 16 MB limit — the music is most of the growth, so more tracks would need a lower bitrate.

v100: `music-action` removed; two tracks remain (`music-drive`, `music-funk`).
v101: the rocket sound is split into launch (1.15 s) and `rocket-blast` (1.55 s), played where a rocket or an explosive crate goes off (a salvo plays it once); Ctrl no longer triggers the slide.

## Power dash and aggressive bots (v102)

- The slide is removed (C, touch button, hit-height code).
- Power dash: each kill stores a charge (max 2). With a charge, the dash (right mouse / touch ») is a power dash — 0.28 s at 34 m/s (~9.5 m), not blocked by the cooldown, and it rams every enemy it passes through once: 35 damage, 0.6 s stun, thrown aside (`updatePowerDash`). Without charges it is the old short dash on a 1.4 s cooldown. The HUD shows «МОЩНЫЙ РЫВОК ×N».
- Bot AI: 60 % flankers path to a point 11 m beside your line to them (their side) and close in from there; assault bots approach on a curve to their preferred range (shotgun 4.5, SMG 8, rifle 13 m), then keep circling with direction changes and a slight drift inwards; nobody stands still. Below 35 % health everyone rushes straight at you, 30 % faster, firing 30 % more often. Bot speeds raised (shotgun 4.6, SMG 3.8, rifle 3.0 m/s before SPEED_SCALE).
- Waves are 10 / 13 / 16 enemies (was 7 / 10 / 13).

## Dash speed effect (v103)

`updateSpeedEffect`: while dashing, cyan additive after-images of the player (frozen skinned clones that share the model geometry, `userData.keepGeometry`) are left every 45–60 ms and fade in 0.28 s; thin glowing streaks trail behind; the final post pass gets a radial speed blur (`post.setSpeedBlur(amount, x, y)`, 8 samples toward the player's screen position, 0.045 normal / 0.07 power dash) that eases in and out; in the rear view the field of view kicks +7° / +12°. Effects can now be groups: fading and disposal walk all meshes.

## Edge sticking and running feel (v104)

- Stepping off a platform edge: the body's centre is past the edge, so the floor is lower and the player falls, but the 0.43 m radius still overlapped the block; the fall sank the body into the block's side and `recoverPosition` yanked it to some free spot — the "stuck on the edge" jitter (47 such jumps in 40 s of random walking in the amphitheatre). `slideOffEdges` now pushes a falling body straight out of the nearest side of any block it overlaps by less than its radius (0 jumps in the same test). `WALK=<s> node tests/generated-runtime.mjs <seed> <type>` runs that random-walk check; `runtimeStats.playerRecover` counts recoveries.
- Running feel: while sprinting the view widens slightly (isometric zoom out 6 %, rear-view field of view +6°) and the screen edges blur faintly (0.012); no after-images. Eases in over ~0.3 s and out faster.
v105: `slideOffEdges` (v104) also ran on the ground and pushed the player back from every step up — the top of each stair and seams between platforms of slightly different height — so you could only jump over them. It now runs only while really falling (`vy < 0` and no floor under the centre) and never pushes away from a block whose top is within the 0.4 m step height. `testClimb` in the generated-runtime harness walks the player up every stair of the arena with real key input and fails if it does not get 0.6 m past the top (it reproduced the bug: stuck exactly at the top edge).
v106: stepping DOWN off a stand or terrace edge got stuck: the v105 guard "never push away from a block within step height" also applied while falling off that very block, so the body sank into its side and `recoverPosition` put it back on top. The guard is gone; pushing still only happens while really falling (no floor under the body's centre), so stair tops keep working. Harness: `dropWalk` walks off every stand edge in 16 directions (48 cases in the amphitheatre: all stuck before, none after) and runs automatically on arenas with stands; `testClimb` still passes. Trims are no longer drawn on seams between same-height platforms (no more double "kerb" lines). The hit vignette is barely visible and softer in the rear view (0.16 instead of 0.4).

## Mobile controls, volumes, mobile performance (v107)

- Touch layout (`engine/touch.js` rewritten): one fixed joystick bottom-left (isometric: move; rear view: sideways turns the camera, forward/back walks; full tilt sprints), dash / fire (hold) / jump bottom-right, reload top-left, the game's immortality and view toggles top-right (quality and music buttons hidden on touch). Aiming on touch is automatic (`applyTouchAim`): the nearest visible enemy within the gun's reach, preferring the one in front; otherwise the aim follows movement. In the rear view firing nudges the camera toward an enemy within ~25°. The «swap weapon» notice is tappable (pickup); medkits are used automatically below 45 HP when standing on one.
- Fullscreen: after rotating to landscape a tap-to-fullscreen hint appears where the browser supports page fullscreen (Android Chrome etc.); iPhone Safari has none — `apple-mobile-web-app-capable` meta tags let a home-screen shortcut open without the address bar.
- Volume sliders in the menu (music; shots and effects), saved in localStorage; `sfx.setVolumes({ music, fx })` scales the music gain and an effects gain before the bus compressor.
- Phones (`MOBILE`): pixel ratio capped at 1.25 (was 1.6), default quality «medium» (bloom, no AO), 1024² shadow map, at most 4 torch point lights, half the death debris.
- Hit vignette in the rear view raised to 0.32 (iso 0.4).
v108–109: touch HUD about half the size (joystick 96 px, buttons 40 px, fire 58 px, wave banner 9 px, health/ammo 16 px numbers in a compact top-left row next to a 30 px reload button, toggles 8 px top-right, brand hidden). The touch overlay no longer swallows taps (`#touch{pointer-events:none}`, only its joystick and buttons take input) — that is why the immortality / view toggles, pause and the pickup notice did not respond on phones.
v110: touch controls use Kenney "Mobile Controls" sprites (CC0, `dist/assets/ui/`: style G pad, nub and button, white icons — crosshair fire, arrow dash, double-chevron jump, rotate reload, pause), loaded through `uiImage()` (embedded data in the published page). Joystick 125 px (+30 %), fire 75 px (+30 %). Stuck-stick fix ("kept turning right"): the stick now also ends on `lostpointercapture` and on window-level pointerup/cancel, and everything is released when no finger is left on the screen (`touchend` with zero touches), on blur and when the page is hidden; the rear-view turn has a 0.12 dead zone.
v111: the stick now runs on Touch Events with a single touch identifier (more reliable on iPhone than pointer events when the finger slides off the pad); a new touch on the pad always takes over, and any end/cancel of that touch anywhere releases it — the "keeps turning right and later input does not fix it" bug was a stale pointer id that made the pad ignore new touches. Phones also ignore emulated mouse events (they could turn the rear camera and start firing after taps). Phones (`CAMERA_ZOOM` 1.5): isometric view height 20 → 13.3, rear camera 1.5× closer. Harness/emulation check: drag past the pad edge and release in rear view → the camera stays still.
v112: the fire button is also an aim stick (touch): pressing fires, dragging away from the button's centre aims while firing (the icon follows the thumb), release stops both. Isometric: the crosshair goes from the player in the stick's direction, farther with more tilt; rear view: the stick turns the camera (and pitches it) while firing. A press without dragging (tilt < 0.2) keeps the automatic aim. Same touch-identifier tracking and takeover as the move stick; `releaseAll` also releases fire. Emulation check: dragging left from the button moves the crosshair left of the player and the gun fires.
v113: an E (pick up / swap weapon) button with a hand icon sits above the move stick on touch; it lights up (gold ring) when a weapon is in reach.
v114 (touch): a 175 px invisible aim pad is centred on the fire button behind the other buttons (dash, jump and E still take their own taps); aim travel is 70 px like the move stick and the rear-view aim turn is linear-plus-quadratic (more responsive near the centre). Auto-run: the move stick at ≥ 85 % tilt runs in both views (the pad glows green). Camera ownership is split: in the rear view, while the fire stick aims, the move stick only walks and strafes and no longer turns the camera; without aiming, its sideways tilt still turns.
v115 (touch): the rear-view vertical aim is gentler and limited (dead zone 0.4, 0.45 rad/s, pitch −0.45…+0.22) so drifting the thumb up while firing no longer throws the view at the sky; the move stick, the button row, the aim pad and E sit 15 % of the screen height higher.
v116 (phones): the render resolution is adaptive instead of a fixed 1.25 pixel ratio (which on 3× screens rendered about 40 % of the native width and looked soft): it starts at min(screen density, 2) and every ~1.5 s steps 0.25 down if frames average slower than 45 fps, or back up (at most every 5 s) above 57 fps, never below 1.25. A light 4-tap unsharp mask in the final pass (`post.setSharpen`, 0.15–0.6, stronger at lower resolution) restores edges.
v117 (phones): the page is locked in place — html/body fixed and non-scrolling, canvas fixed at 0,0, the touch layer clips its children, any pan the browser applies on resize / orientation change / visual-viewport change is undone (scrollTo(0,0)); the menu scrolls on its own. iOS browsers (Chrome there is WebKit) could pan the whole page sideways.

## Spawn shield and health orbs (v118)

- Every round starts with a 5 s spawn shield (`SPAWN_SHIELD`): `damagePlayer` ignores hits, a pale blue bubble pulses around the player and blinks in the last second, and the health label counts «ЗАЩИТА · 5…1».
- Health orbs: 35 % of kills (elites always) drop a glowing green orb at the body (`maybeDropOrb`): +15 HP (elite +30), bobs for 12 s and blinks in the last 3, drifts toward the player within 4 m, picked up at 1.2 m with a chime and «+N ЗДОРОВЬЯ». Cleared on restart. Harness `testShieldOrbs` checks both.
- Note: the full `npm test` now takes longer than five minutes in this sandbox; run `node --test tests/*.test.mjs`, `node tests/runtime.mjs` and the `generated-runtime` arenas separately when time-limited.
v119: one pick-up key — E takes whatever is closest, a weapon on the ground (swap) or a medkit (only when hurt); Q is gone, the medkit tip says E, touch no longer auto-uses medkits and its E button lights up for medkits too. Health orbs stay automatic (they fly to you).

## Map JSON: load and export (v121) — foundation for the arena editor

`generator/custom-map.js` defines the map format `blaster-arena-map` v1 (documented at the top of the file): name, biome, limit, fill, platforms (h or level 1–3, solid by default, slabs/connectors/landings), stairs (from/to heights), pads (tier), walls (wall runs), zones (templates), clusters (catalogue id, x, z, rot), props (single models), torches, spawns, medkits, optional pit and moat. `planFromMap` turns a map into a plan: graph nodes from courtyards, spawns and raised platforms (deduplicated), routes the decorator keeps clear (every stair plus a minimal tree joining ground nodes), biome via `applyBiome`; `fill: true` lets the decorator add clusters and props around the given ones, `false` builds exactly the listed ones. Unreachable points on a custom map are reported as warnings at round start instead of failing the load. `exportMap(plan)` writes any arena (including the decorator's result) as a map; `validateMap` checks the basics.

Menu: «ЗАГРУЗИТЬ КАРТУ» (paste JSON or pick a .json file → stored in localStorage → reload with `?map=custom`, loading line «Своя карта») and «ЭКСПОРТ АРЕНЫ» (shows the current arena's JSON selected in the dialog, copies it to the clipboard when allowed, and offers a file where downloads work). `maps/example-small.json` is a small hand-written example (two hills, a bridge slab, stairs, a pad, a wall, two courtyards, two clusters, fill on). Harness: `ROUNDTRIP=1` exports an arena and rebuilds it from the JSON (all four types pass every check), `MAPFILE=<path>` loads a map file.

## Arena editor (v122)

The page is now entered through `dist/main.js`: with `?editor` it opens the editor (`dist/editor/editor.js`), otherwise the game — the same single published file holds both, so «ИГРАТЬ» in the editor can hand the map to the game through localStorage. The editor removes the game's styles and builds its own UI: a top-down canvas of the arena (pan with right mouse / space, zoom with the wheel), tools P platform (drag a rectangle; level 1–3 = 3/6/9 m; block or slab), S stairs (drag from bottom to top, kept straight; heights read from the platforms under the start and just past the end; «fit length» button), W wall (base height from the platform under it), J pad (tier), Z courtyard (template, drawn with its extent), C cluster (palette of all catalogue clusters with top-down silhouettes, sorted by fit to the biome; footprint circle, item squares and front arrow on the map; R / Shift+R / Shift+wheel rotate), T torch (Alt = brazier), X spawn; V select / move / resize platform corners; Del, Ctrl+Z (history of 80), Ctrl+D duplicate; properties panel per object; map name, biome and «fill empty ground». Live checks (stairs straight / not too steep / top matches the platform, clusters overlapping each other, stairs or pads or standing on a platform, objects outside the arena, nowhere to spawn) are listed and highlighted in red; clicking one selects it. Full reachability is checked by the game on load. Import / export JSON (dialog with paste, file or copy), autosave to localStorage. The game menu has «РЕДАКТОР КАРТ», and the load / export dialog has «ОТКРЫТЬ В РЕДАКТОРЕ» to edit any exported arena.

## Editor v2 (v123)

- Groups: rubber-band selection on empty ground (Shift adds), Shift+click toggles, dragging any selected object moves the whole group, **Alt+drag copies** the selection and drags the copies, Ctrl+C / Ctrl+V (pasted under the mouse), Ctrl+D, Del and R act on the whole group.
- Pit (H, one per map: a walkable floor 5 m down by default, depth editable; stairs read the pit floor) and moat with stakes (M, any number of strips; deadly). Platform level «0 м · мост» makes a ground-height slab to bridge them.
- Time of day: «Авто по биому», noon, sunset, overcast, dusk, night → `map.light` (planFromMap sets the theme's light list to it).
- Player start (G) vs enemy spawns (X): `map.playerStart` is where the round starts (`chooseZoneStart` uses it); with any enemy spawns on a map, `generatedEnemySpawn` uses only those (the ones ≥ 18 m from the player).
- Side view toggle (top / from the south / from the west): an elevation with a height grid, platforms, slabs, stairs (sloped or end-on), walls, cluster models as bars, courtyard outlines, pits and moats, pads, the player start and enemy spawns as 1.75 m figures plus a fixed 1.75 m person for scale; it opens zoomed in; editing stays in the top view.
- New check: a raised platform with no stair ending on it, no pad within ~25 m and nothing higher touching it.
- Maps without courtyards get an invisible `empty` anchor zone (zone template with no walls, props or routes) at the player start, so the game has a start zone; the harness does not require full reachability for custom maps (the game warns instead).

## Editor v3 (v124)

- Transform tool (E): square handles resize platforms / pits / moats (corners), move stair ends along their axis (stairs stay straight) and wall ends freely, and scale clusters (`scale` 0.3–3, applied by `placeCluster` to positions and model sizes, and by the decorator to the footprint); the round yellow handle turns rectangles and stairs by 90°, walls and clusters in 15° steps (Alt = free).
- Height: walls, clusters, pads, torches, enemy spawns and the player start carry `y`; an object rests on the first surface at or below its height — platform top, ground, pit or moat floor, and inside a solid block its top (`surfaceBelow` in the editor, `surfaceAt` in the game; also used by props, torches, the player start, cluster bases and, on custom maps, each wall tile). New objects take the top surface; moved objects re-settle (a wall at 9 m moved over a 6 m block lands on it, over open ground it drops to 0). The "cluster on a platform" error became "cluster overhangs the platform edge"; overlap checks respect height.
- «Новая» no longer uses `confirm()` (blocked in embedded pages): the first click arms it («Точно? Ещё раз»), a second within 3 s clears the map. Import errors show in the dialog title instead of `alert()`.
- Harness: `HEIGHTS=1 MAPFILE=…` prints wall tile, cluster and player heights (checked: wall at 9 m over a 6 m platform → 6, over ground → 0; cluster and start on the platform → 6).
v125: custom maps — pits and moats were cut out of the ground without side walls (the generated arenas bring their own wall lists, custom ones did not), so the isometric camera looked through the cut at the sky background: the "grey, transparent" strip. Now a custom pit gets four earth walls and every custom moat strip gets its own four. Ground-level slabs (`h ≤ 0.5`, bridges over moats and pits) are drawn as wooden decks and are opaque; batches no longer mix fading and non-fading pieces (`m.transparent` is part of the batch key), so a deck never fades together with a wall it was batched with.
v126: enemy lasers are telegraphed. A laser bot (ШТОРМ / ПУЛЬС) no longer fires an instant beam at you: it shows a thin red sight line locked on where you are, brightening for 0.55 s, then fires along that line (`updateBotLaserAim`); stunning or killing it cancels the shot. Harness `LASERDODGE=1`: in 8 s a ПУЛЬС bot at 14 m hits a standing player 3 times and a player stepping side to side 0 times. (Also repaired a harness probe string broken by an earlier edit.)

## v127 — шаг 1 плана
Waves in groups (WAVE_GROUPS, GROUP_PAUSE 15–30 s or ≤1 enemy left), weapon tiers (weapons.js WEAPON_TIERS; bots and arena racks use open tiers), sky-drop capsules with beacon (skyDrop/updateSkyDrops). Test: WAVES=1 node tests/generated-runtime.mjs <seed> <type>.

## v128 — шаг 2 плана
Weapon block: name · class (WEAPON_CLASS_NAMES by kind), mag / ∞, three class-upgrade bolts from classUpgrades[kind] (reset each round; filled by cards in step 4).

## v129 — шаг 3 плана
Run stats (runStats: kills by weapon class, damage taken, best streak without damage, accuracy, time, feats dash/barrel/air/moat), end screen runReport(), rank generator dist/ranks.js (editable word tables). kill(bot, cause). Weapon description lines hidden from HUD. Test: REPORT=1 node tests/generated-runtime.mjs <seed> <type>.

## v130 — экран итогов
Separate #results screen (menu background): rank, 3 numbers (kills, damage taken, time), player model idle with the last weapon on a low round podium (own small WebGLRenderer on #podium), ЗАКРЫТЬ button. Known pre-existing: amphitheatre seeds s6/s7 fail dropWalk ("stuck on stand edges") already in v126.

## v131
Results screen layout: canvas inside flex box (#podium-box), camera framing with margin.

## v132
Results screen: shadow bias against striping, rank/stats grouped right above the podium, glow (halo behind figure, light pool under podium, rotating rim beams).

## v133
Results: pink close button (menu style), rim beams removed, smaller glows, canvas edges faded with a radial mask.

## v134
Results stats in a 3-column grid (centred).

## v135
iOS audio: sfx.resume() on any gesture/visibility, volume changes via cancel+ramp (glide) instead of stacked setTargetAtTime.

## v136
Menu text centred.

## v137
Music on/off button in the menu volume block (#musicmenu; HUD toggle is hidden on phones), music slider up re-enables music, navigator.audioSession.type = "playback" (iOS silent switch).

## v138
iOS audio: silent-sample priming in sfx.resume(), sound engine created on the first touch. Touch aim sensitivity +15% (TOUCH_AIM_SENSITIVITY, fire stick travel 61 px).

## v139 (experimental, separate link)
Swipe look in rear view on touch (.look-zone right half; centre-to-edge = 180° at 100%, default 120%), fire finger swipes at ADS 0.8, left stick strafes in rear view, gentler aim assist, menu slider ОБЗОР (СВАЙП) 50–200 %. Working version stays v138.

## v140 — шаг 4 плана
Upgrade cards after waves 1 and 2 (#cards): УРОН +15/15/20 %, ПЕРЕЗАРЯДКА −15/15/20 %, СКОРОСТЬ (fire rate) +10/10/15 % per class (light class bolts, max 3); УДАЧА orb chance 35→55 % (once per run); ЗДОРОВЬЕ +20 max HP and full heal (twice per run). 3D icons via one offscreen renderer copied into card canvases. Test: CARDS=1 node tests/generated-runtime.mjs <seed> <type>.

## v141
Card icon canvases no longer inherit the global fixed canvas rule; taller cards.

## v142
Cards: УДАЧА icon is a built gold star, note «ПОПРОБУЙ ВЫЖИТЬ», logo-style words, thick floating tilted cards, flickering rotating neon rim.

## v143
Cards: no flicker, steady breathing laser glow; icon renderer preserveDrawingBuffer. Bots: separation (BOT_SPACE 2.6 m steering, BOT_BODY 1 m push via move()). Test: SPREAD=1 node tests/generated-runtime.mjs <seed> <type>.

## v144
Cards: pink-only neon gradient, ambient glow (outer pink glow, inner face glow, soft halo).

## v145
Cards: steady near-white pink rim (no colour flow), pink glow only around the frame, captions 1.5x smaller, glow softened.

## v146
Cards: thin rim + box-shadow glow (removed masked blur ring), captions 11/14 px, wider gaps, smaller tilt.

## v147
Cards: torch-like glow (wide soft pink light pool behind each card, gentle irregular flicker), darker backdrop.

## v148
Day sky (noon, overcast) pastel blue; sky is an equirect panorama turning with the camera; faint cloud haze (preset.clouds).

## v149
Noon sky bluer, clouds visible (alpha 0.38, 4–37° above horizon), overcast removed from random/biome picks (still via ?light=overcast).

## v150
5 waves (WAVE_GROUPS adds 6+6+7 and 7+7+8; WAVE_COUNT), elite in the last wave, cards after waves 1–4, sky drops capped at tier 3.

## v151 — GIANT boss (test placement: after wave 1)
GIANT config in game.js: x3 model, 2600 HP, gun in each hand (alternating bursts), weak points on hands (8 hits in a row within 2.5 s shoot the arm off; both arms = death), smashes crates/barrels, blocked by low ceilings/bridges/narrow gaps (own giantOccupied with 5.2 m height, 1.25 m radius), steps up to 1.3 m else walks around (wall-following), hops out of the moat, stuck >4 s = big hop, shockwave jump every 7–11 s (hurts and knocks back unless airborne), sky-drop entrance, boss bar (#bossbar). Final placement: GIANT.wave = WAVE_COUNT (after the elite). Test: GIANT=1 node tests/generated-runtime.mjs <seed> <type>.

## v152
Giant arms: each holds 40% of the health (GIANT.armShare); damage on a weak point drains that arm and the total.

## v153
Last enemies of a wave (no groups left, ≤3 alive) hunt the player (rush + pathing). HUD shows «ОСТАЛОСЬ N · 48 м ↗» to the nearest enemy (arrow relative to view), refreshed 4×/s. Test: HUNT=1 node tests/generated-runtime.mjs <seed> <type>.

## v154 — range balance
Player projectile damage falls off with distance by class (FALLOFF: rifles none; SMG full to 35% of range then down to 35%; shotguns full to 30% then down to 25%). SMG bloom: spread grows ×1→×2.6 during a burst, resets 0.25 s after release. Bots hit from beyond 80% of their weapon range get alert for 5 s and push in. Test: FALLOFF=1 node tests/generated-runtime.mjs <seed> <type>.

## v155
Difficulty (menu #difficulty, localStorage): mama 120 HP / bots as before; hard 80 HP, bot speed x1.5, smarts x1.5 (aim error /1.5, shot pause x0.8, flankers 90%, rush below 52 HP); giant speed x sqrt(speed). Red barrels (survival/barrel*) are explosive (blast hurts bots and player, chain). Giant types GIANT_TYPES: smg/shotgun/rocket/laser (weapon, bursts, keep distance, tint, name in boss bar; laser telegraph 0.7 s); ranged giants approach after 3 s without sight; ?giant=<type>. Shockwave radius 13 m -> 22 m as health drops to 20% (giantWaveRadius). Tests: GTYPES=1, DIFF=1.

## v156
Bots change weapons: 3 magazines of volleys (BOT_MAGS); empty or 10 volleys in a row without hitting (BOT_MISS_LIMIT) -> seek a gun on the ground (30 m / 15 m), swap within 2 m, old gun dropped; no gun for 4 s -> spare magazine. Projectiles remember their shooter (owner) to reset misses on hit. Test: SWAP=1.

## v157
Bot dash from wave 3 (BOT_DASH): sideways dodge of a player shot within 7 m heading at it, or a dash in from 10–24 m with line of sight; 0.22 s at 18 m/s, cooldown 5–8 s. Slow-motion orb (SLOWMO): 5% of kills (not elite), blue; 5 s of world time x0.5 for bots, enemy shots, giant, group timers, sky drops (player and player shots full speed); blue overlay #slowmo, sounds pitched down (sfx.setTimeScale). Test: DASH=1.

## v158
Combo counter (#combo): kills in a row without damage, shown from x2 (pop, pink from x6, "СЕРИЯ ПРЕРВАНА" on damage); rank feat «Неудержимый» from best x10. Sniper map (type snipers, special = not random; generator/snipers.js = dense ravine): ~10 wooden towers (3+ in the ravine), red powder crate at each foot; exploding it collapses the tower and kills its sniper; snipers stand still, 0.9 s (hard 0.7) red sight line, laser 85 m / 24 dmg; one wave, WAVE_COUNT=1, no giant/cards; 3 sky drops at start. Tests: COMBO=1, SNIPE=1 (type snipers).

## v159-ui (test link)
Illustrated UI (splash, menu/pause art, difficulty cards, art upgrade cards; new reload art). Combo lasts 5 s after the last kill and blinks out (COMBO_TIME). Bot dash: 0.3 s glowing wind-up, red afterimages, 9–14 s cooldown, dodge roll 40% once per shot. Slow-mo: world x0.25, near-greyscale, motion trails (post.setSaturation/setTrail, history targets). Rushing bots pathfind (no straight run into the moat); bots never step down into the moat; bots keep >=1.1 m from the player and stop pushing forward within 1.8 m. Rocket giant: launcher right + SMG left; per-hand weapons and rhythms. Test: MOAT=1.

## v162
Difficulty card names 8cqw, shrunk to fit on one line (fitDiffNames). Shield bearer (SHIELD): from wave 2 every 5th enemy (max 2 alive), energy arc in front; front shots/beams/blade (within ±60°) blocked; blast, barrel or any dash breaks it; +30 HP, 0.75 pace, always assault. Test: SHIELD=1.

## v182 — level-filling logic, harder snipers, «Острова», «Лабиринт»

Systems that keep the player moving (game.js, block «level-filling logic»):
- **areaBlast(at, opts)** — one explosion helper (mines, mortar strikes).
- **Mines** — `placeTraps()` at round start, `plan.traps` per map (default 6): open nav cells ≥ 22 m from start,
  not in a ditch, not by pads. Player or bot within 1.7 m arms a 0.55 s fuse.
- **Mortar pressure** — `updatePressure`: staying within 7 m for 7 s of a wave brings shells every 2.1 s
  (1.3 s red marker, lead by player velocity).
- **Wave tasks** — `WAVE_TASKS = {2: capture, 3: cores, 4: capture}`; spots from graph nodes / far open cells,
  32–80 m away, reachable. The wave (and the giant) waits for `taskDone()`. Idle with no enemies → extra bomber
  every 14 s. Rewards: capture +30 HP, cores +2 power dashes. HUD wave plate shows progress and a direction.
- **Sky drops** land 24–54 m away.
- **Snipers map**: 14 snipers (8 on ditch-ring islands from `plan.towerSpots`), faster aim (0.6/0.45 s),
  1.5–2.3 s pause, 28 dmg, lead the target; powder crates only on some towers; 18 mines; 2 bombers every 20 s.

Generic plan features: `moatBanks: "strips"` (earth banks only where a strip meets ground), `breakWalls`
(plan-level destructible walls), `barrels`, `traps`. Navigation has no nodes in the stake ditch.

New arenas: `generator/islands.js` (3 × 3 islands, channels, bridges on a spanning tree, blue pads elsewhere,
4 m centre plateau) and `generator/maze.js` (8 × 8 maze of 22 m cells, all walls destructible, door gaps and
waist-high walls, plaza with a 3 m dais).

### v183 — «Острова» redone as floating islands
9 solid rock islands (base = top − 3 m) at 2–12 m over a ditch covering the whole arena (`moat` = one
220 m strip, `stakeDensity` 0.12, `moatDamage` 10 per 0.25 s). No bridges: islands are linked only by
**targeted pads** (`pad.target`): the throw always goes to the target, speed from the arc formula in the
generator (`padSpeed`). Targeted pads are one-way links in navigation (stored on the target node, since the
path search runs backwards; kept through local refreshes via `node.extra`) — bots fly between islands too.
`padKeepout` keeps the pad spots free of template walls/props. Rescue blocks (4.6 m, top −3.4) on a 22 m
grid in the ditch carry a yellow pad back to the nearest island; standing on them is safe (`plan.rescue`).
Zones carry `y`: courtyard template walls are raised to the island top. Start position uses terrain height.
Test hook: PADFLIGHTS simulates every targeted pad flight (lands within 7 m of the target).
