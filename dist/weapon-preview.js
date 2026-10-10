// Arsenal catalogue: every weapon from weapons.js with its model, class and numbers.
import * as T from "three";
import { GLTFLoader } from "./vendor/GLTFLoader.js";
import { weapons } from "./weapons.js";

const CLASS = { 0: "Винтовка", 1: "Дробовик", 2: "Пистолет-пулемёт", 3: "Ракетница", 4: "Лазер", 5: "Клинок" };
const className = (w) => (w.beam === "pulse" ? "Лазерная винтовка" : CLASS[w.kind]);
const $ = (s) => document.querySelector(s);
const hex = (c) => "#" + c.toString(16).padStart(6, "0");
const loader = new GLTFLoader(),
  assets = {};

function stats(w) {
  const pellets = (w.pellets || 1) * (w.split ? w.split.count : 1),
    perShot = w.damage * pellets,
    burst = perShot / w.rate,
    sustained = (perShot * w.mag) / (w.mag * w.rate + w.reload);
  return { pellets, perShot, burst, sustained };
}

function gunModel(w) {
  const obj = assets["guns/" + w.model].scene.clone(true);
  obj.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(obj),
    s = box.getSize(new T.Vector3()),
    k = 2 / Math.max(s.x, s.y, s.z);
  obj.scale.setScalar(k);
  obj.position.sub(box.getCenter(new T.Vector3()).multiplyScalar(k));
  const g = new T.Group();
  g.add(obj);
  if (w.kind === 5) {
    // plasma blade as long as the weapon, out of the muzzle (Kenney barrels point along -Z)
    const b = new T.Box3().setFromObject(obj),
      len = b.max.z - b.min.z,
      glow = new T.Mesh(new T.BoxGeometry(0.16, 0.16, len), new T.MeshBasicMaterial({ color: w.color, transparent: true, opacity: 0.6 })),
      core = new T.Mesh(new T.BoxGeometry(0.06, 0.06, len), new T.MeshBasicMaterial({ color: 0xffe2c0 }));
    glow.position.set(0, (b.min.y + b.max.y) / 2 + 0.1, b.min.z - len / 2);
    core.position.copy(glow.position);
    g.add(glow, core);
    g.scale.setScalar(0.6);
  }
  obj.traverse((n) => n.isMesh && (n.castShadow = true));
  return g;
}

function stage() {
  const scene = new T.Scene();
  scene.add(new T.HemisphereLight(0xdfe6ff, 0x4a3a50, 1.4));
  const key = new T.DirectionalLight(0xfff0dc, 2.6);
  key.position.set(3, 5, 4);
  scene.add(key);
  const rim = new T.DirectionalLight(0x9fc4ff, 1.2);
  rim.position.set(-4, 2, -3);
  scene.add(rim);
  return scene;
}
// Kenney barrels point along -Z: the camera sits on that side, a little off-axis, so the muzzle faces the viewer.
const camera = (aspect, yaw = Math.PI - 0.5, pitch = 0.22, zoom = 1) => {
  const h = 2.1 / zoom,
    cam = new T.OrthographicCamera((-h * aspect) / 2, (h * aspect) / 2, h / 2, -h / 2, 0.1, 50);
  cam.position.set(Math.sin(yaw) * Math.cos(pitch) * 10, Math.sin(pitch) * 10, Math.cos(yaw) * Math.cos(pitch) * 10);
  cam.lookAt(0, 0, 0);
  return cam;
};

function card(w, i, img) {
  const s = stats(w),
    el = document.createElement("article");
  el.className = "card";
  el.dataset.kind = w.kind;
  el.style.setProperty("--tone", hex(w.color));
  const shot = w.split
    ? `${w.pellets} заряда × ${w.split.count} дробин`
    : w.pellets > 1
      ? `${w.pellets} ${w.kind === 3 ? "ракеты" : "дробин"}`
      : "1 снаряд";
  el.innerHTML = `
    <div class="pic"></div>
    <div class="body">
      <p class="class">${className(w)}</p>
      <h2>${w.name}</h2>
      <p class="desc">${w.description || ""}</p>
      ${w.kind === 5 ? `<dl>
        <div><dt>Урон касания</dt><dd>${w.damage} каждые ${w.tick} с</dd></div>
        <div><dt>Урон/с по цели</dt><dd>${Math.round(w.damage / w.tick)}</dd></div>
        <div><dt>Зона</dt><dd>${Math.round((w.arc * 180) / Math.PI)}°, ${w.range} м</dd></div>
        <div><dt>Заряд</dt><dd>${w.mag}, расход ${w.drain}/с</dd></div>
        <div><dt>Горит без перерыва</dt><dd>${Math.round(w.mag / w.drain)} с</dd></div>
        <div><dt>Подзарядка</dt><dd>${w.regen}/с, полная ${Math.round(w.mag / w.regen)} с</dd></div>
      </dl>` : `<dl>
        <div><dt>Урон</dt><dd>${w.damage}${s.pellets > 1 ? ` × ${s.pellets}` : ""}</dd></div>
        <div><dt>За выстрел</dt><dd>${s.perShot}</dd></div>
        <div><dt>Выстрел</dt><dd>${shot}</dd></div>
        <div><dt>Темп</dt><dd>${w.rate.toFixed(2)} с</dd></div>
        <div><dt>Магазин</dt><dd>${w.mag}</dd></div>
        <div><dt>Перезарядка</dt><dd>${w.reload} с</dd></div>
        <div><dt>Дальность</dt><dd>${w.range} м</dd></div>
        <div><dt>Урон/с</dt><dd>${Math.round(s.sustained)} <small>с перезарядкой</small></dd></div>
      </dl>`}
      ${w.blastRadius ? `<p class="note">Взрыв радиусом ${w.blastRadius} м</p>` : ""}
      ${w.kind === 5 ? "" : w.pierce === Infinity ? `<p class="note">Пробивает врагов и стены</p>` : w.pierce > 1 ? `<p class="note">Пробивает ${w.pierce} целей</p>` : ""}
      <p class="use">${w.use || ""}</p>
    </div>`;
  el.querySelector(".pic").appendChild(img);
  return el;
}

async function main() {
  const keys = [...new Set(weapons.map((w) => "guns/" + w.model))];
  let done = 0;
  await Promise.all(
    keys.map(async (k) => {
      assets[k] = await loader.loadAsync("./assets/" + k + ".glb");
      $("#status").textContent = "Загружаю модели: " + ++done + " из " + keys.length;
    }),
  );
  $("#status").textContent = weapons.length + " стволов · " + new Set(weapons.map((w) => w.kind)).size + " классов";
  const r = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setPixelRatio(Math.min(2, devicePixelRatio));
  r.setSize(320, 200);
  r.toneMapping = T.ACESFilmicToneMapping;
  const scene = stage(),
    grid = $("#grid");
  // order: by class, then by name, so variants of one class sit together
  const order = weapons.map((w, i) => i).sort((a, b) => weapons[a].kind - weapons[b].kind || weapons[a].name.localeCompare(weapons[b].name, "ru"));
  for (const i of order) {
    const w = weapons[i],
      g = gunModel(w);
    scene.add(g);
    r.render(scene, camera(320 / 200));
    scene.remove(g);
    const img = new Image();
    img.src = r.domElement.toDataURL("image/png");
    img.alt = w.name;
    grid.appendChild(card(w, i, img));
  }
  const filter = $("#filter");
  for (const k of ["all", "0", "1", "2", "3", "4", "5"]) {
    const b = document.createElement("button");
    b.textContent = k === "all" ? "все" : CLASS[k];
    b.className = k === "all" ? "on" : "";
    b.onclick = () => {
      filter.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      grid.querySelectorAll(".card").forEach((c) => (c.hidden = k !== "all" && c.dataset.kind !== k));
    };
    filter.appendChild(b);
  }
}
main().catch((e) => {
  console.error(e);
  $("#status").textContent = "Не удалось загрузить модели";
});
