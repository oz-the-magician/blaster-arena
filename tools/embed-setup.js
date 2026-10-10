// Single-file publishing helper (bundled before game.js by the build): the published page cannot fetch,
// so every asset is embedded in window.__ASSETS. Models are stored gzip-compressed ("gz:" + base64) —
// Kenney GLBs shrink about 5× — and are inflated in the page with DecompressionStream (no network);
// textures stay data: URIs and load through <img>.
import { DefaultLoadingManager } from "three";
import { GLTFLoader } from "../dist/vendor/GLTFLoader.js";
const A = window.__ASSETS;
const key = (url) => {
  const k = String(url).replace(/^https?:\/\/[^/]+\//, "").split("?")[0],
    i = k.indexOf("assets/");
  return i >= 0 ? k.slice(i) : k;
};
try {
  window.createImageBitmap = undefined;
} catch {}
DefaultLoadingManager.setURLModifier((url) => {
  const d = A[key(url)];
  return d && !d.startsWith("gz:") ? d : url;
});
const bytes = (b64) => {
  const s = atob(b64),
    out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};
async function decode(d) {
  if (!d.startsWith("gz:")) return bytes(d.slice(d.indexOf(",") + 1)).buffer;
  const stream = new Blob([bytes(d.slice(3))]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}
const original = GLTFLoader.prototype.load;
GLTFLoader.prototype.load = function (url, onLoad, onProgress, onError) {
  const k = key(url),
    d = A[k];
  if (!d) return original.call(this, url, onLoad, onProgress, onError);
  const base = k.slice(0, k.lastIndexOf("/") + 1),
    fail = (e) => {
      console.error("GLTF", k, e);
      onError?.(e);
    };
  decode(d)
    .then((buffer) => this.parse(buffer, base, onLoad, fail))
    .catch(fail);
};
