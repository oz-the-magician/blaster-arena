// Entry point: the same page is the game, or — with ?editor — the arena editor.
const params = new URLSearchParams(location.search);
if (params.has("editor")) import("./editor/editor.js").then((m) => m.startEditor());
else import("./game.js");
