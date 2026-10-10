// Touch controls for phones and tablets in landscape.
//   bottom left  — one fixed joystick: moves you; in the rear view sideways tilt turns the camera
//                  and forward/back walks (full tilt sprints)
//   bottom right — three buttons: dash, fire (hold), jump
//   top left     — reload (it also happens automatically on an empty magazine)
//   above stick  — E: pick up / swap the weapon on the ground
//   top right    — the game's own immortality and view toggles (shown bigger on touch by CSS)
// Aiming is automatic on touch (game.js): the nearest visible enemy, otherwise the way you move.
// The module owns only DOM and state; game.js reads `move`, `firing`, `jump` and wires the actions.
export const isTouchDevice = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(pointer: coarse)").matches || "ontouchstart" in window || navigator.maxTouchPoints > 1);

// Sprites: Kenney "Mobile Controls" (CC0), style G pad/nub/button + white icons, in assets/ui/.
// The published single-file page has no network, so images come from the embedded asset table.
export const uiImage = (name) => {
  const path = "assets/ui/" + name + ".png";
  return (typeof window !== "undefined" && window.__ASSETS?.[path]) || "./" + path;
};

export function createTouchControls(actions) {
  const root = document.createElement("div");
  root.id = "touch";
  const icon = (name) => `<img class="icon" src="${uiImage("icon-" + name)}" alt="" draggable="false">`;
  root.innerHTML = `
    <div class="joystick" style="background-image:url('${uiImage("joystick-pad")}')"><i style="background-image:url('${uiImage("joystick-nub")}')"></i></div>
    <button data-act="reload" class="reload" aria-label="Перезарядка">${icon("arrow_rotate")}</button>
    <button data-act="pickup" class="pickup" aria-label="Поднять оружие (E)">${icon("hand")}<b>E</b></button>
    <div class="look-zone" aria-hidden="true"></div>
    <div class="aim-zone" aria-hidden="true"></div>
    <div class="touch-buttons">
      <button data-act="dash" aria-label="Рывок">${icon("arrow")}</button>
      <button data-act="fire" class="fire" aria-label="Огонь">${icon("crosshair")}</button>
      <button data-act="jump" aria-label="Прыжок">${icon("jump")}</button>
    </div>`;
  for (const b of root.querySelectorAll("button")) b.style.backgroundImage = `url('${uiImage("button")}')`;
  document.body.appendChild(root);
  // look: swipe deltas in px since the last frame (game.js consumes and zeroes them); ads = while firing
  const state = { move: { x: 0, y: 0, active: false }, aim: { x: 0, y: 0, active: false }, look: { dx: 0, dy: 0, adsDx: 0, adsDy: 0, active: false }, firing: false, jump: false, root };
  const base = root.querySelector(".joystick"),
    knob = base.querySelector("i");
  let id = null;
  const set = (e) => {
    const r = base.getBoundingClientRect(),
      radius = r.width / 2,
      cx = r.left + radius,
      cy = r.top + radius;
    let dx = e.clientX - cx,
      dy = e.clientY - cy;
    const len = Math.hypot(dx, dy),
      max = radius * 0.8;
    if (len > max) (dx *= max / len), (dy *= max / len);
    state.move.x = dx / max;
    state.move.y = dy / max;
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  // The stick follows Touch Events (one touch identifier) — on iPhone they are more reliable than pointer
  // events when a finger slides off the pad. A new touch on the pad always takes over, so a lost release can
  // never leave the stick stuck ("keeps turning right"); any end/cancel of that touch, anywhere, releases it.
  const end = () => {
    id = null;
    state.move.active = false;
    state.move.x = state.move.y = 0;
    knob.style.transform = "";
    base.classList.remove("on");
  };
  const find = (list) => [...list].find((t) => t.identifier === id);
  base.addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      id = t.identifier;
      state.move.active = true;
      base.classList.add("on");
      set(t);
    },
    { passive: false },
  );
  addEventListener(
    "touchmove",
    (e) => {
      const t = id !== null && find(e.changedTouches);
      if (t) set(t);
    },
    { passive: true },
  );
  const release = (e) => {
    if (id !== null && (find(e.changedTouches) || !find(e.touches))) end();
  };
  addEventListener("touchend", release, true);
  addEventListener("touchcancel", release, true);
  // mouse / pen fallback (desktop testing)
  base.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch") return;
    id = "p";
    state.move.active = true;
    set(e);
    const move = (ev) => set(ev),
      up = () => (end(), removeEventListener("pointermove", move), removeEventListener("pointerup", up));
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  });
  // Swipe look (rear view): a finger dragged on the free right half of the screen turns the camera
  {
    const look = root.querySelector(".look-zone");
    let lid = null,
      last = null;
    look.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        const t = e.changedTouches[0];
        lid = t.identifier;
        last = { x: t.clientX, y: t.clientY };
        state.look.active = true;
      },
      { passive: false },
    );
    addEventListener(
      "touchmove",
      (e) => {
        const t = lid !== null && [...e.changedTouches].find((x) => x.identifier === lid);
        if (!t) return;
        state.look.dx += t.clientX - last.x;
        state.look.dy += t.clientY - last.y;
        last = { x: t.clientX, y: t.clientY };
      },
      { passive: true },
    );
    const lookEnd = (e) => {
      if (lid !== null && ([...e.changedTouches].some((x) => x.identifier === lid) || ![...e.touches].some((x) => x.identifier === lid))) {
        lid = null;
        state.look.active = false;
      }
    };
    addEventListener("touchend", lookEnd, true);
    addEventListener("touchcancel", lookEnd, true);
  }
  const releaseAll = () => {
    end();
    state.releaseFire?.();
    state.firing = false;
    for (const b of root.querySelectorAll("button.down")) b.classList.remove("down");
  };
  document.addEventListener("touchend", (e) => e.touches.length === 0 && releaseAll(), true);
  document.addEventListener("touchcancel", (e) => e.touches.length === 0 && releaseAll(), true);
  addEventListener("blur", releaseAll);
  document.addEventListener("visibilitychange", () => document.hidden && releaseAll());
  // Fire is also an aim stick: press to fire, drag to aim while firing (release stops both).
  // A short press without dragging fires with the automatic aim.
  {
    const fire = root.querySelector("button.fire"),
      zone = root.querySelector(".aim-zone"),
      glyph = fire.querySelector(".icon");
    let fid = null;
    const aimSet = (t) => {
      const r = fire.getBoundingClientRect(),
        cx = r.left + r.width / 2,
        cy = r.top + r.height / 2,
        max = 61; // px of travel for full aim (70 / 1.15: +15 % aim sensitivity)

      if (aimSet.last) {
        state.look.adsDx += t.clientX - aimSet.last.x;
        state.look.adsDy += t.clientY - aimSet.last.y;
      }
      aimSet.last = { x: t.clientX, y: t.clientY };
      let dx = t.clientX - cx,
        dy = t.clientY - cy;
      const len = Math.hypot(dx, dy);
      if (len > max) (dx *= max / len), (dy *= max / len);
      state.aim.x = dx / max;
      state.aim.y = dy / max;
      glyph.style.transform = `translate(${dx * 0.45}px, ${dy * 0.45}px)`;
    };
    const fireEnd = () => {
      fid = null;
      aimSet.last = null;
      state.firing = false;
      state.aim.active = false;
      state.aim.x = state.aim.y = 0;
      glyph.style.transform = "";
      fire.classList.remove("down");
    };
    const fireStart = (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      fid = t.identifier;
      state.firing = true;
      state.aim.active = true;
      fire.classList.add("down");
      aimSet(t);
    };
    // a bigger invisible pad around the fire button (behind the other buttons, so they still get their taps)
    zone.addEventListener("touchstart", fireStart, { passive: false });
    fire.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        const t = e.changedTouches[0];
        fid = t.identifier;
        state.firing = true;
        state.aim.active = true;
        fire.classList.add("down");
        aimSet(t);
      },
      { passive: false },
    );
    addEventListener(
      "touchmove",
      (e) => {
        const t = fid !== null && [...e.changedTouches].find((x) => x.identifier === fid);
        if (t) aimSet(t);
      },
      { passive: true },
    );
    const fireRelease = (e) => {
      if (fid !== null && ([...e.changedTouches].some((x) => x.identifier === fid) || ![...e.touches].some((x) => x.identifier === fid)))
        fireEnd();
    };
    addEventListener("touchend", fireRelease, true);
    addEventListener("touchcancel", fireRelease, true);
    fire.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "touch") return;
      state.firing = true;
      state.aim.active = true;
      aimSet(e);
      const mv = (ev) => aimSet(ev),
        up = () => (fireEnd(), removeEventListener("pointermove", mv), removeEventListener("pointerup", up));
      addEventListener("pointermove", mv);
      addEventListener("pointerup", up);
    });
    state.releaseFire = fireEnd;
  }
  for (const button of root.querySelectorAll("button:not(.fire)")) {
    const act = button.dataset.act;
    button.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      button.classList.add("down");
      if (act === "fire") state.firing = true;
      else if (act === "jump") state.jump = true;
      else actions[act]?.();
    });
    const up = () => {
      button.classList.remove("down");
      if (act === "fire") state.firing = false;
    };
    button.addEventListener("pointerup", up);
    button.addEventListener("pointercancel", up);
    button.addEventListener("pointerleave", up);
  }
  root.addEventListener("contextmenu", (e) => e.preventDefault());
  state.show = (on) => root.classList.toggle("visible", on);
  return state;
}

// Fullscreen + landscape lock where the browser allows it (Android Chrome and most others; needs a tap).
// iPhone Safari has no fullscreen for pages: there "Add to Home Screen" opens the game without the address bar.
export async function preferLandscape() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.({ navigationUI: "hide" });
  } catch {}
  try {
    await screen.orientation?.lock?.("landscape");
  } catch {}
}
