// Post-processing pipeline:
//   scene → HDR multisampled target → [GTAO, quality high] → [bloom, quality ≥ medium]
//   → final pass: colour grade, bloom add, vignette, ACES tone mapping, sRGB.
// Quality: 'high' = AO + bloom, 'medium' = bloom, 'low' = grade and vignette only.
import * as T from '../vendor/three.module.js';
import { GTAOPass } from '../vendor/addons/postprocessing/GTAOPass.js';

export const GRADE = {
  contrast: 1.08, saturation: 1.15, brightness: 1.02,
  shadowTint: [0.97, 0.99, 1.05], highlightTint: [1.04, 1.01, 0.96],
  vignette: 0.14, vignetteSoftness: 0.75
};
export const BLOOM = { threshold: 3.2, knee: 1.2, strength: 0.55, levels: 5 };
export const AO = { radius: 1.4, thickness: 1, distanceExponent: 1.5, scale: 1.4, samples: 12 };
export const QUALITIES = ['high', 'medium', 'low'];
export const QUALITY_NAMES = { high: 'ВЫСОКОЕ', medium: 'СРЕДНЕЕ', low: 'НИЗКОЕ' };

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

// Soft-knee threshold: only very bright HDR pixels (emissives, flashes) feed the bloom.
const PREFILTER = `uniform sampler2D tMap; uniform vec2 texel; uniform float threshold, knee; varying vec2 vUv;
void main(){
  vec3 c = (texture2D(tMap, vUv + texel*vec2(-.5,-.5)).rgb + texture2D(tMap, vUv + texel*vec2(.5,-.5)).rgb
          + texture2D(tMap, vUv + texel*vec2(-.5,.5)).rgb + texture2D(tMap, vUv + texel*vec2(.5,.5)).rgb) * .25;
  float b = max(c.r, max(c.g, c.b));
  float soft = clamp(b - threshold + knee, 0.0, 2.0*knee); soft = soft*soft / (4.0*knee + 1e-4);
  float w = max(soft, b - threshold) / max(b, 1e-4);
  gl_FragColor = vec4(min(c * w, vec3(64.0)), 1.0);
}`;
// Dual-filter (Kawase) down and up sampling: cheap, wide, stable.
const DOWN = `uniform sampler2D tMap; uniform vec2 texel; varying vec2 vUv;
void main(){
  vec3 s = texture2D(tMap, vUv).rgb * 4.0;
  s += texture2D(tMap, vUv - texel).rgb; s += texture2D(tMap, vUv + texel).rgb;
  s += texture2D(tMap, vUv + vec2(texel.x, -texel.y)).rgb; s += texture2D(tMap, vUv - vec2(texel.x, -texel.y)).rgb;
  gl_FragColor = vec4(s / 8.0, 1.0);
}`;
const UP = `uniform sampler2D tMap, tBase; uniform vec2 texel; varying vec2 vUv;
void main(){
  vec3 s = texture2D(tMap, vUv + vec2(-texel.x*2.0, 0.0)).rgb;
  s += texture2D(tMap, vUv + vec2(-texel.x, texel.y)).rgb * 2.0;
  s += texture2D(tMap, vUv + vec2(0.0, texel.y*2.0)).rgb;
  s += texture2D(tMap, vUv + vec2(texel.x, texel.y)).rgb * 2.0;
  s += texture2D(tMap, vUv + vec2(texel.x*2.0, 0.0)).rgb;
  s += texture2D(tMap, vUv + vec2(texel.x, -texel.y)).rgb * 2.0;
  s += texture2D(tMap, vUv + vec2(0.0, -texel.y*2.0)).rgb;
  s += texture2D(tMap, vUv + vec2(-texel.x, -texel.y)).rgb * 2.0;
  gl_FragColor = vec4(s / 12.0 + texture2D(tBase, vUv).rgb, 1.0);
}`;
const FINAL = `uniform sampler2D tScene, tBloom; uniform float bloomStrength;
uniform float zoomBlur; uniform vec2 zoomCenter; uniform float sharpen; uniform vec2 texel;
uniform float contrast, saturation, brightness, vignette, softness, aspect;
uniform vec3 shadowTint, highlightTint; varying vec2 vUv;
void main(){
  vec3 c;
  if (zoomBlur > 0.001) {
    // speed blur: samples pulled toward the focus point, stronger towards the screen edges
    vec2 d = (vUv - zoomCenter) * zoomBlur;
    c = vec3(0.0);
    for (int i = 0; i < 8; i++) c += texture2D(tScene, vUv - d * (float(i) / 7.0)).rgb;
    c /= 8.0;
  } else c = texture2D(tScene, vUv).rgb;
  if (sharpen > 0.001) {
    // light unsharp mask (4 taps): restores edge crispness lost to a reduced render resolution
    vec3 n = texture2D(tScene, vUv + vec2(texel.x, 0.0)).rgb + texture2D(tScene, vUv - vec2(texel.x, 0.0)).rgb
           + texture2D(tScene, vUv + vec2(0.0, texel.y)).rgb + texture2D(tScene, vUv - vec2(0.0, texel.y)).rgb;
    c = max(c + (c - n * 0.25) * sharpen, 0.0);
  }
  c += texture2D(tBloom, vUv).rgb * bloomStrength;
  vec3 g = pow(max(c, 0.0), vec3(1.0/2.2));
  float l = dot(g, vec3(0.2126, 0.7152, 0.0722));
  g = mix(vec3(l), g, saturation);
  g = (g - 0.5) * contrast + 0.5;
  g *= brightness;
  g *= mix(shadowTint, highlightTint, smoothstep(0.15, 0.85, l));
  vec2 d = (vUv - 0.5) * vec2(aspect, 1.0) / max(aspect, 1.0) * 2.0;
  g *= 1.0 - vignette * smoothstep(1.0 - softness, 1.9, length(d));
  gl_FragColor = vec4(pow(max(g, 0.0), vec3(2.2)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createPost(renderer, width, height, scene, quality = 'high') {
  if (!renderer?.getContext) return null; // test harness / no WebGL
  const hdr = { type: T.HalfFloatType, depthBuffer: false };
  const sceneTarget = new T.WebGLRenderTarget(width, height, { type: T.HalfFloatType, samples: 4 });
  const aoTarget = new T.WebGLRenderTarget(width, height, hdr);
  // motion trails (slow motion): the frame is blended with the previous ones
  let histA = new T.WebGLRenderTarget(width, height, hdr), histB = new T.WebGLRenderTarget(width, height, hdr), trail = 0, trailFresh = true;
  const black = new T.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); black.needsUpdate = true;
  const mips = Array.from({ length: BLOOM.levels }, () => new T.WebGLRenderTarget(1, 1, hdr));
  const ups = Array.from({ length: BLOOM.levels - 1 }, () => new T.WebGLRenderTarget(1, 1, hdr));

  const quad = new T.Mesh(new T.PlaneGeometry(2, 2)); quad.frustumCulled = false;
  const quadScene = new T.Scene(); quadScene.add(quad);
  const quadCamera = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const pass = (fragmentShader, uniforms, extra = {}) =>
    new T.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader, depthTest: false, depthWrite: false, toneMapped: false, ...extra });
  const prefilter = pass(PREFILTER, { tMap: { value: null }, texel: { value: new T.Vector2() }, threshold: { value: BLOOM.threshold }, knee: { value: BLOOM.knee } });
  const down = pass(DOWN, { tMap: { value: null }, texel: { value: new T.Vector2() } });
  const up = pass(UP, { tMap: { value: null }, tBase: { value: null }, texel: { value: new T.Vector2() } });
  const final = pass(FINAL, {
    tScene: { value: null }, tBloom: { value: black }, bloomStrength: { value: BLOOM.strength },
    zoomBlur: { value: 0 }, zoomCenter: { value: new T.Vector2(0.5, 0.5) },
    sharpen: { value: 0 }, texel: { value: new T.Vector2(1 / width, 1 / height) },
    contrast: { value: GRADE.contrast }, saturation: { value: GRADE.saturation }, brightness: { value: GRADE.brightness },
    shadowTint: { value: new T.Vector3(...GRADE.shadowTint) }, highlightTint: { value: new T.Vector3(...GRADE.highlightTint) },
    vignette: { value: GRADE.vignette }, softness: { value: GRADE.vignetteSoftness }, aspect: { value: width / height }
  }, { toneMapped: true });

  const draw = (material, target) => { quad.material = material; renderer.setRenderTarget(target); renderer.render(quadScene, quadCamera); };
  const accum = new T.ShaderMaterial({
    uniforms: { tCur: { value: null }, tPrev: { value: null }, keep: { value: 0 } },
    vertexShader: VERT, depthTest: false, depthWrite: false, toneMapped: false,
    fragmentShader: `uniform sampler2D tCur, tPrev; uniform float keep; varying vec2 vUv;
      void main(){ gl_FragColor = vec4(mix(texture2D(tCur, vUv).rgb, texture2D(tPrev, vUv).rgb, keep), 1.0); }`
  });

  // One GTAO pass per camera type (the pass bakes perspective vs orthographic into its shader).
  const aoPasses = new Map();
  let size = [width, height];
  function aoFor(camera) {
    let p = aoPasses.get(camera);
    if (!p) {
      p = new GTAOPass(scene, camera, size[0], size[1]);
      p.output = GTAOPass.OUTPUT.Default;
      p.blendIntensity = 1;
      p.updateGtaoMaterial({ radius: AO.radius, thickness: AO.thickness, distanceExponent: AO.distanceExponent, scale: AO.scale, samples: AO.samples });
      p.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      aoPasses.set(camera, p);
    }
    return p;
  }

  function setSize(w, h) {
    const ratio = renderer.getPixelRatio(), pw = Math.max(1, Math.floor(w * ratio)), ph = Math.max(1, Math.floor(h * ratio));
    size = [pw, ph];
    sceneTarget.setSize(pw, ph); aoTarget.setSize(pw, ph); histA.setSize(pw, ph); histB.setSize(pw, ph); trailFresh = true;
    final.uniforms.texel.value.set(1 / pw, 1 / ph);
    let mw = pw, mh = ph;
    for (let i = 0; i < mips.length; i++) {
      mw = Math.max(1, mw >> 1); mh = Math.max(1, mh >> 1);
      mips[i].setSize(mw, mh); if (i < ups.length) ups[i].setSize(mw, mh);
    }
    for (const p of aoPasses.values()) p.setSize(pw, ph);
    final.uniforms.aspect.value = w / h;
  }

  function bloom(source) {
    prefilter.uniforms.tMap.value = source.texture;
    prefilter.uniforms.texel.value.set(1 / source.width, 1 / source.height);
    draw(prefilter, mips[0]);
    for (let i = 1; i < mips.length; i++) {
      down.uniforms.tMap.value = mips[i - 1].texture;
      down.uniforms.texel.value.set(1 / mips[i - 1].width, 1 / mips[i - 1].height);
      draw(down, mips[i]);
    }
    let current = mips[mips.length - 1];
    for (let i = mips.length - 2; i >= 0; i--) {
      up.uniforms.tMap.value = current.texture; up.uniforms.tBase.value = mips[i].texture;
      up.uniforms.texel.value.set(0.5 / current.width, 0.5 / current.height);
      draw(up, ups[i]); current = ups[i];
    }
    return current.texture;
  }

  return {
    get quality() { return quality; },
    // speed effect: radial blur amount (0 = off, ~0.06 strong) around a screen point (uv)
    // sharpening strength (0 = off); used on phones, more when the render resolution is lower
    setSharpen(amount) { final.uniforms.sharpen.value = amount; },
    // slow motion look: saturation (1 = normal grade) and how much of the previous frames stays (0..0.9)
    setSaturation(v) { final.uniforms.saturation.value = GRADE.saturation * v; },
    setTrail(v) { if (v > 0.01 && trail <= 0.01) trailFresh = true; trail = v; },
    setSpeedBlur(amount, x = 0.5, y = 0.5) { final.uniforms.zoomBlur.value = amount; final.uniforms.zoomCenter.value.set(x, y); },
    set quality(q) { if (QUALITIES.includes(q)) quality = q; },
    setSize,
    render(s, camera) {
      renderer.setRenderTarget(sceneTarget);
      renderer.render(s, camera);
      let source = sceneTarget;
      if (quality === 'high') { aoFor(camera).render(renderer, aoTarget, sceneTarget); source = aoTarget; }
      if (trail > 0.01) {
        accum.uniforms.tCur.value = source.texture;
        accum.uniforms.tPrev.value = (trailFresh ? source : histA).texture;
        accum.uniforms.keep.value = trailFresh ? 0 : trail;
        draw(accum, histB);
        [histA, histB] = [histB, histA];
        trailFresh = false;
        source = histA;
      }
      final.uniforms.tBloom.value = quality === 'low' ? black : bloom(source);
      final.uniforms.tScene.value = source.texture;
      draw(final, null);
    }
  };
}
