#!/usr/bin/env python3
"""Turns the raw sound pack (source-audio/sfx) into the game's effects: python3 tools/process-sfx.py [pack folder]

Each effect = a cut of one source file + a sound "style", then levelled to a target loudness:
  scifi  — guns: pitched up (rubberband, length kept), low rumble and harsh highs cut, a presence lift,
           phaser + flanger + a short slap echo for the toy/sci-fi colour, then compressed;
  clean  — lasers, UI and foley: gentle compression only.
All effects are levelled by measured mean loudness, so a shotgun is no longer three times a rifle.
Output: mono MP3 80 kb/s in dist/assets/sfx/.
"""
import os, re, subprocess, sys, tempfile

SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "source-audio", "sfx")
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "dist", "assets", "sfx")
os.makedirs(OUT, exist_ok=True)

SCIFI = ("rubberband=pitch={pitch},highpass=f=180,lowpass=f=7000,"
         "equalizer=f=2600:width_type=o:width=1.2:g=3,"
         "aphaser=in_gain=0.7:out_gain=0.85:delay=2.2:decay=0.35:speed=1.4,"
         "flanger=delay=1:depth=2.5:speed=0.7:width=60,"
         "aecho=0.7:0.45:38:0.22,"
         "acompressor=threshold=-20dB:ratio=4:attack=2:release=70:makeup=2")
CLEAN = "highpass=f=90,acompressor=threshold=-18dB:ratio=2.5:attack=3:release=80"

# name: (source, start, end, fade-out, style, pitch, target mean dB)
EFFECTS = {
    "rifle-impulse":     ("impluse-gun-01", 0.13, 0.95, 0.15, "scifi", 1.22, -23),
    "rifle-spark":       ("rifle-02", 0, 1.15, 0.25, "scifi", 1.30, -23),
    "rifle-arrow":       ("one-shot-gun-01", 0, 0.85, 0.2, "scifi", 1.26, -23),
    "rifle-storm":       ("rifle-slow-01", 0.08, 1.25, 0.3, "scifi", 1.12, -23),
    "smg-spectre-loop":  ("automat-01", 0, 1.43, 0.02, "scifi", 1.30, -27),
    "smg-vector-loop":   ("automat-fast-01", 0.57, 2.15, 0.02, "scifi", 1.35, -27),
    "smg-wasp-loop":     ("automat-fast-02", 0, 1.6, 0.02, "scifi", 1.40, -27),
    "smg-phantom-loop":  ("automat-fast-03", 0, 1.54, 0.02, "scifi", 1.28, -27),
    "smg-single":        ("automat-fast-04", 0.57, 0.75, 0.06, "scifi", 1.30, -26),
    "shotgun":           ("shotgun-01", 0.44, 1.7, 0.35, "scifi", 1.15, -22),
    "shotgun-double":    ("double-shotgun-01", 0, 2.3, 0.35, "scifi", 1.15, -22),
    "laser-storm":       ("lazer-gun-one-shot-01", 0, 0.4, 0.12, "clean", 1, -25),
    "laser-pulse":       ("lazer-gun-one-shot-02", 0, 1.29, 0.25, "clean", 1, -22),
    # the pack's rocket file is launch (0–1.2 s) + explosion (1.45–3 s): split, the blast plays where it lands
    "rocket":            ("rocket-launcher-kill", 0, 1.15, 0.3, "clean", 1, -22),
    "rocket-blast":      ("rocket-launcher-kill", 1.45, 3.0, 0.5, "clean", 1, -21),
    "blade-loop":        ("plasma-gun", 0.08, 4.7, 0.02, "clean", 1, -27),
    "reload-a":          ("reload-01", 0, 1.24, 0.06, "clean", 1, -26),
    "reload-b":          ("reload-02", 0, 1.24, 0.06, "clean", 1, -26),
    "reload-c":          ("reload-03", 0, 1.2, 0.06, "clean", 1, -26),
    "reload-d":          ("reload-04", 0, 1.2, 0.06, "clean", 1, -26),
    "reload-shotgun-8":  ("shotgun-reload-8x", 0, 3.73, 0.08, "clean", 1, -26),
    "hit":               ("hit", 0, 0.4, 0.08, "clean", 1, -21),
    "empty":             ("no-bullets", 0, 0.39, 0.03, "clean", 1, -26),
    "jump-pad":          ("jump-pad", 0.11, 1.5, 0.2, "clean", 1, -25),
    "steps-loop":        ("run", 0, 4.9, 0.02, "clean", 1, -31),
}

def mean_db(path):
    out = subprocess.run(["ffmpeg", "-hide_banner", "-i", path, "-af", "volumedetect", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    return float(re.search(r"mean_volume: (-?[\d.]+) dB", out).group(1))

for name, (src, start, end, fade, style, pitch, target) in EFFECTS.items():
    length = end - start
    chain = (SCIFI.format(pitch=pitch) if style == "scifi" else CLEAN)
    tail = f"afade=t=in:d=0.004,afade=t=out:st={max(0, length - fade):.3f}:d={fade}"
    with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", str(start), "-to", str(end),
                        "-i", os.path.join(SRC, src + ".mp3"), "-af", chain + "," + tail, "-ac", "1", "-ar", "44100", tmp.name], check=True)
        gain = target - mean_db(tmp.name)
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", tmp.name,
                        "-af", f"volume={gain:.2f}dB,alimiter=limit=0.89", "-b:a", "80k", os.path.join(OUT, name + ".mp3")], check=True)
    print(f"{name:20s} {style:5s} pitch {pitch:<4} -> {target} dB (gain {gain:+.1f})")

# Background music: kept stereo, sits under the effects. The shots live around 2–3 kHz, so the music gets a
# gentle dip there (it does not mask them), the same 11 kHz ceiling as the guns so it shares their colour,
# light compression, and a level well below the effects (mean −31 dB vs −22…−27 for effects).
MUSIC_DIR = os.path.join(os.path.dirname(OUT), "..", "..", "source-audio")
# leading and trailing silence trimmed so the loop crossfade meets music, not a gap
chain = ("silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,"
         "highpass=f=40,lowpass=f=11000,equalizer=f=2600:width_type=o:width=1.4:g=-4,"
         "acompressor=threshold=-16dB:ratio=2.5:attack=8:release=200")
# every source-audio/music-*.mp3 becomes a game track (one is picked per arena)
for track in sorted(f for f in os.listdir(MUSIC_DIR) if f.startswith("music-") and f.endswith(".mp3")):
    with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", os.path.join(MUSIC_DIR, track), "-af", chain, tmp.name], check=True)
        gain = -31 - mean_db(tmp.name)
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", tmp.name, "-af", f"volume={gain:.2f}dB,alimiter=limit=0.7",
                        "-ac", "2", "-b:a", "112k", os.path.join(OUT, track)], check=True)
    print(f"{track[:-4]:20s} music (gain {gain:+.1f})")
