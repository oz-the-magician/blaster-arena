// Adapted concept from GameDevEducation/UnityTutorial_JumpPads, JumpPad.cs:
// contact velocity projected onto the pad plane, upward impulse, impact scaling.
// Speeds remain arena-tuned; stronger falls are capped to avoid overshooting.
export function padImpulse(pad, contact, mass = 1) {
  const horizontal = Math.hypot(contact.x, contact.z),
    boost = Math.min(1.08, 1 + Math.max(0, -contact.y) * 0.01);
  const tilt = Math.min(pad.speed / pad.vertical, horizontal > 0.01 ? pad.speed / pad.vertical : 0);
  const magnitude = Math.hypot(pad.vertical, pad.speed),
    normalizer = Math.hypot(1, tilt);
  const vertical = ((horizontal > 0.01 ? magnitude / normalizer : pad.vertical) * boost) / Math.sqrt(mass);
  const speed = vertical * tilt;
  return {
    x: horizontal > 0.01 ? (contact.x / horizontal) * speed : 0,
    z: horizontal > 0.01 ? (contact.z / horizontal) * speed : 0,
    vertical,
  };
}
export function padContact(pad, position, radius = 0.43) {
  return (
    !pad.disabled &&
    Math.hypot(position.x - pad.x, position.z - pad.z) < 1.15 + radius * 0.5 &&
    Math.abs(position.y - pad.top) < 0.31
  );
}

// Three pad tiers. Gravity in flight is 17 m/s², so the apex above the pad is vertical² / 34:
//   spring — light hop, ~3.6 m: onto crates, low walls, a ledge;
//   blue   — medium, ~13 m: roofs, keeps, the far side of a ravine;
//   yellow — high, ~18 m: towers and long cross-map arcs.
// A pad with `tier` takes its vertical speed and look from here; `speed` (horizontal) stays per pad.
export const PAD_TIERS = {
  spring: { name: "Пружина", vertical: 11, ring: 0xf2efe6, model: "platformer/spring" },
  // stronger spring (~5.8 m apex): from the ground over a 3 m wall-top and well onto the terrace
  springHigh: { name: "Пружина", vertical: 14, ring: 0xf2efe6, model: "platformer/spring" },
  blue: { name: "Синяя", vertical: 21, ring: 0x39b5ff },
  yellow: { name: "Жёлтая", vertical: 25, ring: 0xffc233 },
};
export function applyPadTier(pad) {
  const t = PAD_TIERS[pad.tier];
  return t ? { ...pad, vertical: t.vertical, model: pad.model ?? t.model } : pad;
}
