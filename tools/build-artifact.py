#!/usr/bin/env python3
"""Builds the single-file published version of the game: dist/ -> build/blaster-arena.html.

  pip/npm needs: esbuild (npx downloads it)
  usage: python3 tools/build-artifact.py [out.html]

1. bundles tools/embed-setup.js + dist/game.js with esbuild (three resolved to dist/vendor);
2. embeds every model and texture the game can load, as window.__ASSETS:
   models gzip-compressed ("gz:" + base64), textures as data: URIs;
3. inlines style.css and drops the dev-only import map and the arena-schemes link.
The page then needs no network at all (the hosted artifact forbids it).
"""
import base64, gzip, json, os, re, subprocess, sys

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
dist = os.path.join(root, "dist")
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, "build", "blaster-arena.html")
os.makedirs(os.path.dirname(out), exist_ok=True)
tmp = os.path.join(root, "build")
os.makedirs(tmp, exist_ok=True)

entry = os.path.join(tmp, "entry.js")
open(entry, "w").write("import '../tools/embed-setup.js';\nimport '../dist/main.js';\n")
bundle = os.path.join(tmp, "bundle.js")
subprocess.run(["npx", "-y", "esbuild@0.24", entry, "--bundle", "--format=esm", "--minify",
                "--alias:three=" + os.path.join(dist, "vendor", "three.module.js"), "--outfile=" + bundle], check=True)

# every asset under dist/assets that the game may request: all models and the kits' colormaps
assets = {}
for folder, _, names in os.walk(os.path.join(dist, "assets")):
    for name in names:
        path = os.path.join(folder, name)
        rel = os.path.relpath(path, dist).replace(os.sep, "/")
        data = open(path, "rb").read()
        if name.endswith(".glb"):
            assets[rel] = "gz:" + base64.b64encode(gzip.compress(data, 9)).decode()
        elif name.endswith(".png"):
            assets[rel] = "data:image/png;base64," + base64.b64encode(data).decode()
        elif name.endswith(".webp"):
            assets[rel] = "data:image/webp;base64," + base64.b64encode(data).decode()
        elif name.endswith(".jpg"):
            assets[rel] = "data:image/jpeg;base64," + base64.b64encode(data).decode()
        elif name.endswith(".mp3"):
            assets[rel] = "data:audio/mpeg;base64," + base64.b64encode(data).decode()

html = open(os.path.join(dist, "index.html"), encoding="utf-8").read()
css = open(os.path.join(dist, "style.css"), encoding="utf-8").read()
js = open(bundle, encoding="utf-8").read().replace("</script", "<\\/script")
html = re.sub(r'<link rel="stylesheet"[^>]*>', lambda m: "<style>" + css + "</style>", html)
html = re.sub(r'<script type="importmap">.*?</script>', "", html, flags=re.S)
html = re.sub(r'<a class="arena-schemes".*?</a>', "", html, flags=re.S)
html = html.replace('initial-scale=1"', 'initial-scale=1, viewport-fit=cover"')
html = re.sub(r'<script type="module" src="(?:game|main).js\?v=\d+"></script>',
              lambda m: "<script>window.__ASSETS=" + json.dumps(assets) + ";</script><script type=\"module\">" + js + "</script>", html)
assert "__ASSETS" in html, "game.js script tag not found in index.html"
open(out, "w", encoding="utf-8").write(html)
print(f"{out}: {len(html.encode()) / 1e6:.2f} MB, {len(assets)} assets")
