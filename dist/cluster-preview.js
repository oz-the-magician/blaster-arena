// Cluster catalogue: renders every recipe from generator/clusters.js as a small diorama.
// Thumbnails come from one shared renderer; clicking a card opens an orbit viewer.
import * as T from "three";
import { GLTFLoader } from "./vendor/GLTFLoader.js";
import { clone as cloneSkinned } from "./vendor/SkeletonUtils.js";
import { CLUSTERS, clusterKeys } from "./generator/clusters.js";
import { PAD_TIERS } from "./engine/jump-pad.js";

const GROUND = { meadow: 0x7f9c55, forest: 0x56743f, desert: 0xd2a467, coast: 0xe0c48f, town: 0xa9a49a, fortress: 0x8e9a7c };
const loader = new GLTFLoader(),
  assets = {};
const $ = (s) => document.querySelector(s);

function fit(key, size, tint) {
  const obj = assets[key].scene.clone(true);
  obj.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(obj),
    s = box.getSize(new T.Vector3()),
    scale = size / Math.max(s.x, s.y, s.z);
  obj.scale.setScalar(scale);
  obj.position.sub(box.getCenter(new T.Vector3()).multiplyScalar(scale));
  obj.position.y = -box.min.y * scale;
  const holder = new T.Group();
  holder.add(obj);
  obj.traverse((n) => {
    if (!n.isMesh) return;
    n.castShadow = n.receiveShadow = true;
    if (tint !== undefined)
      n.material = [n.material].flat().map((m) => {
        // Kenney models are coloured by a palette texture; a tint replaces it with a flat colour,
        // keeping the original's brightness so trims stay darker than walls.
        const c = m.clone();
        if (c.map) {
          const l = (c.color?.r ?? 1) * 0.3 + 0.7;
          c.map = null;
          c.color.set(tint).multiplyScalar(l);
        } else c.color?.lerp(new T.Color(tint), 0.75);
        return c;
      });
    if (Array.isArray(n.material) && n.material.length === 1) n.material = n.material[0];
  });
  return holder;
}

function buildCluster(id, withPerson) {
  const c = CLUSTERS[id],
    group = new T.Group(),
    r = c.radius + 1.5;
  const plinth = new T.Mesh(
    new T.CylinderGeometry(r, r + 0.3, 0.5, 48),
    new T.MeshStandardMaterial({ color: GROUND[c.themes[0]] ?? 0x8a8a7a, roughness: 1 }),
  );
  plinth.position.y = -0.25;
  plinth.receiveShadow = true;
  group.add(plinth);
  // footprint ring: the area the decorator reserves
  const ring = new T.Mesh(
    new T.RingGeometry(c.radius - 0.06, c.radius + 0.06, 64),
    new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  group.add(ring);
  // arrow on the plinth edge: +z is the side that faces the path
  const arrow = new T.Mesh(new T.ConeGeometry(0.35, 0.8, 3), new T.MeshBasicMaterial({ color: 0xe84aa9 }));
  arrow.rotation.x = Math.PI / 2;
  arrow.position.set(0, 0.05, r - 0.2);
  group.add(arrow);
  for (const [key, x, z, size, rot = 0, , y = 0] of c.items) {
    if (!assets[key]) continue;
    const m = fit(key, size, c.tints?.[key]);
    m.position.set(x, y, z);
    m.rotation.y = (rot * Math.PI) / 180;
    group.add(m);
  }
  // Jump pads that come with the cluster: glowing rings like in the game, plus the landing arc.
  for (const pad of c.pads || []) group.add(padModel(pad));
  return finishCluster(group, c, withPerson);
}
// Pad as in the game: base (or a spring for the light tier), two rings in the tier colour, landing arc.
function padModel(pad) {
  const group = new T.Group(),
    tier = PAD_TIERS[pad.tier] || PAD_TIERS.blue,
    apex = (tier.vertical * tier.vertical) / 34;
  {
    for (const [r, col] of [[0.6, tier.ring], [1.05, tier.ring]]) {
      const ring = new T.Mesh(new T.TorusGeometry(r, 0.07, 8, 32), new T.MeshBasicMaterial({ color: col }));
      ring.rotation.x = Math.PI / 2;
      ring.position.set(pad.x, 0.23, pad.z);
      group.add(ring);
    }
    const base = new T.Mesh(new T.CylinderGeometry(1.3, 1.5, 0.2, 24), new T.MeshStandardMaterial({ color: 0x184e65 }));
    base.position.set(pad.x, 0.1, pad.z);
    group.add(base);
    if (pad.target) {
      const [tx, ty, tz] = pad.target,
        from = new T.Vector3(pad.x, 0.3, pad.z),
        to = new T.Vector3(tx, ty, tz),
        mid = from.clone().lerp(to, 0.5).setY(Math.max(ty + 1, 2 * apex - (0.3 + ty) / 2)),
        curve = new T.QuadraticBezierCurve3(from, mid, to);
      const line = new T.Line(
        new T.BufferGeometry().setFromPoints(curve.getPoints(32)),
        new T.LineDashedMaterial({ color: tier.ring, dashSize: 0.35, gapSize: 0.25 }),
      );
      line.computeLineDistances();
      group.add(line);
    }
  }
  if (tier.model && assets[tier.model]) {
    group.children.find((n) => n.geometry?.type === "CylinderGeometry").visible = false;
    const spring = fit(tier.model, 2.3);
    spring.scale.y *= 0.28 / Math.max(0.01, new T.Box3().setFromObject(spring).getSize(new T.Vector3()).y);
    spring.position.set(pad.x, 0, pad.z);
    group.add(spring);
  }
  // apex marker: how high this tier throws
  const mark = new T.Mesh(new T.SphereGeometry(0.18, 10, 8), new T.MeshBasicMaterial({ color: tier.ring }));
  mark.position.set(pad.x, apex, pad.z);
  if (!pad.target) group.add(mark);
  return group;
}
function finishCluster(group, c, withPerson) {
  if (withPerson && assets["people/character-male-a"]) {
    const p = cloneSkinned(assets["people/character-male-a"].scene);
    p.updateMatrixWorld(true);
    const b = new T.Box3().setFromObject(p),
      k = 1.75 / (b.max.y - b.min.y);
    p.scale.setScalar(k);
    p.position.set(c.radius + 0.6, -b.min.y * k, -0.6);
    p.rotation.y = -Math.PI / 2;
    p.traverse((n) => n.isMesh && (n.castShadow = true));
    group.add(p);
  }
  return group;
}

function stage(renderer) {
  const scene = new T.Scene();
  scene.background = new T.Color(0x1b1426);
  scene.add(new T.HemisphereLight(0xcfd8ff, 0x5a4636, 1.1));
  const sun = new T.DirectionalLight(0xfff1d8, 2.6);
  sun.position.set(-8, 14, 9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 50 });
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  const fill = new T.DirectionalLight(0xffc89a, 0.6);
  fill.position.set(8, 4, -8);
  scene.add(fill);
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  return scene;
}

function isoCamera(radius, aspect, yaw = Math.PI / 4, pitch = 0.62, zoom = 1) {
  const h = (radius * 2 + 4) / zoom,
    cam = new T.OrthographicCamera((-h * aspect) / 2, (h * aspect) / 2, h / 2, -h / 2, 0.1, 200);
  const d = 40;
  cam.position.set(Math.sin(yaw) * Math.cos(pitch) * d, Math.sin(pitch) * d, Math.cos(yaw) * Math.cos(pitch) * d);
  cam.lookAt(0, radius * 0.18, 0);
  return cam;
}

async function main() {
  const keys = [...clusterKeys(), "people/character-male-a", ...Object.values(PAD_TIERS).map((t) => t.model).filter(Boolean)];
  let done = 0;
  await Promise.all(
    keys.map(async (k) => {
      try {
        assets[k] = await loader.loadAsync("./assets/" + k + ".glb");
      } catch (e) {
        console.warn("missing", k, e);
      }
      $("#status").textContent = "Загружаю модели: " + ++done + " из " + keys.length;
    }),
  );
  $("#status").textContent = Object.keys(CLUSTERS).length + " сборок · " + (keys.length) + " моделей";

  // Thumbnails
  const thumb = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  thumb.setPixelRatio(Math.min(2, devicePixelRatio));
  thumb.setSize(360, 260);
  const tScene = stage(thumb),
    grid = $("#grid");
  const themes = new Set();
  for (const [id, c] of Object.entries(CLUSTERS)) {
    c.themes.forEach((t) => themes.add(t));
    const g = buildCluster(id, true);
    tScene.add(g);
    thumb.render(tScene, isoCamera(c.radius + 1.6, 360 / 260, ((c.previewYaw ?? 45) * Math.PI) / 180, ((c.previewPitch ?? 35.5) * Math.PI) / 180, 1.45));
    tScene.remove(g);
    const card = document.createElement("article");
    card.className = "card";
    card.dataset.themes = c.themes.join(" ");
    const img = document.createElement("img");
    img.src = thumb.domElement.toDataURL("image/png");
    img.alt = c.name;
    card.innerHTML = `<button class="id" title="Скопировать имя">${id}</button><h2>${c.name}</h2>
      <p class="meta"><span>${c.items.length} моделей</span><span>Ø ${c.radius * 2} м</span><span>${c.place.join(", ")}</span>${c.dense ? "<strong>плотная</strong>" : ""}${c.pads?.length ? "<strong>пад</strong>" : ""}</p>
      <p class="tags">${c.themes.map((t) => `<em>${t}</em>`).join("")}</p>`;
    card.prepend(img);
    card.querySelector(".id").onclick = (e) => {
      e.stopPropagation();
      navigator.clipboard?.writeText(id).catch(() => {});
      e.target.classList.add("copied");
      setTimeout(() => e.target.classList.remove("copied"), 900);
    };
    card.onclick = () => openViewer(id);
    grid.appendChild(card);
  }
  // Theme filter
  const filter = $("#filter");
  for (const t of ["все", ...themes]) {
    const b = document.createElement("button");
    b.textContent = t;
    b.className = t === "все" ? "on" : "";
    b.onclick = () => {
      filter.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      grid.querySelectorAll(".card").forEach((c) => (c.hidden = t !== "все" && !c.dataset.themes.split(" ").includes(t)));
    };
    filter.appendChild(b);
  }

  // Pad tiers legend: three pads side by side with their jump height and a person for scale.
  {
    const legend = new T.Group();
    const strip = new T.Mesh(new T.BoxGeometry(26, 0.5, 6), new T.MeshStandardMaterial({ color: 0xc8a36c, roughness: 1 }));
    strip.position.y = -0.25;
    legend.add(strip);
    ["spring", "blue", "yellow"].forEach((tier, i) => {
      const x = -8 + i * 8,
        apex = (PAD_TIERS[tier].vertical ** 2) / 34;
      legend.add(padModel({ x, z: 0, tier }));
      const line = new T.Line(
        new T.BufferGeometry().setFromPoints([new T.Vector3(x, 0.3, 0), new T.Vector3(x, apex, 0)]),
        new T.LineDashedMaterial({ color: PAD_TIERS[tier].ring, dashSize: 0.4, gapSize: 0.3 }),
      );
      line.computeLineDistances();
      legend.add(line);
    });
    finishCluster(legend, { radius: 11.4 }, true);
    tScene.add(legend);
    thumb.setSize(900, 420);
    // slightly-from-above side view: 21 m of height fits the strip; width follows the 900×420 image
    const cam = new T.OrthographicCamera(-22.5, 22.5, 10.5, -10.5, 0.1, 200);
    cam.position.set(0, 9 + 9, 40);
    cam.lookAt(0, 9, 0);
    cam.updateProjectionMatrix();
    thumb.render(tScene, cam);
    $("#legend img").src = thumb.domElement.toDataURL("image/png");
    $("#legend figcaption").innerHTML = ["spring", "blue", "yellow"]
      .map((t) => `<span><b style="color:#${PAD_TIERS[t].ring.toString(16).padStart(6, "0")}">${PAD_TIERS[t].name}</b> ${t} · до ${Math.round((PAD_TIERS[t].vertical ** 2) / 34)} м</span>`)
      .join("");
    tScene.remove(legend);
    thumb.setSize(360, 260);
  }

  // Viewer
  const view = $("#viewer"),
    canvas = $("#view"),
    vr = new T.WebGLRenderer({ canvas, antialias: true });
  vr.setPixelRatio(Math.min(2, devicePixelRatio));
  const vScene = stage(vr);
  let current = null,
    yaw = Math.PI / 4,
    pitch = 0.62,
    zoom = 1,
    drag = null,
    open = false;
  function draw() {
    if (!open) return;
    const w = canvas.clientWidth,
      h = canvas.clientHeight;
    vr.setSize(w, h, false);
    vr.render(vScene, isoCamera(CLUSTERS[current].radius + 1.6, w / h, yaw, pitch, zoom));
  }
  function openViewer(id) {
    if (current) vScene.remove(vScene.getObjectByName("cluster"));
    current = id;
    const g = buildCluster(id, $("#person").checked);
    g.name = "cluster";
    vScene.add(g);
    const c = CLUSTERS[id];
    $("#vname").textContent = c.name;
    $("#vid").textContent = id;
    $("#vitems").innerHTML = c.items
      .map(([k, x, z, s, r = 0, solid = true]) => `<li><code>${k}</code><span>${s} м${solid === false ? " · декор" : ""}</span></li>`)
      .join("") +
      (c.pads || []).map((p) => `<li><code>прыжковая платформа</code><span>${p.role}</span></li>`).join("");
    view.hidden = false;
    open = true;
    yaw = ((c.previewYaw ?? 45) * Math.PI) / 180;
    pitch = ((c.previewPitch ?? 35.5) * Math.PI) / 180;
    zoom = 1;
    requestAnimationFrame(draw);
  }
  $("#close").onclick = () => ((view.hidden = true), (open = false));
  view.addEventListener("click", (e) => e.target === view && $("#close").onclick());
  document.addEventListener("keydown", (e) => e.key === "Escape" && $("#close").onclick());
  $("#person").onchange = () => current && openViewer(current);
  canvas.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    yaw -= (e.clientX - drag.x) * 0.008;
    pitch = Math.min(1.45, Math.max(0.12, pitch + (e.clientY - drag.y) * 0.006));
    drag = { x: e.clientX, y: e.clientY };
    draw();
  });
  canvas.addEventListener("pointerup", () => (drag = null));
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoom = Math.min(3, Math.max(0.6, zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
      draw();
    },
    { passive: false },
  );
  addEventListener("resize", draw);
}
main().catch((e) => {
  console.error(e);
  $("#status").textContent = "Не удалось загрузить модели";
});
