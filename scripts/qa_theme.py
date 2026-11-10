"""QA: fail if a hex/rgb colour or a theme font name appears in app code outside the theme files."""
import json
import re
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent / "app"
THEME_FILES = {APP / "theme.json"} | set((APP / "themes").glob("*.json"))
fonts = set()
for f in THEME_FILES:
    t = json.loads(f.read_text(encoding="utf-8"))
    fonts |= {v for k, v in t.get("fonts", {}).items() if k in ("heading", "body")}

COLOUR = re.compile(r"#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d")
problems = []
for f in APP.rglob("*"):
    if f.is_dir() or f in THEME_FILES or f.suffix not in {".js", ".css", ".html"}:
        continue
    for n, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
        for m in COLOUR.finditer(line):
            # allow URL fragments like "#place=" and CSS selectors like "#map"
            if re.match(r"#[0-9a-fA-F]{3,8}\b", m.group()) and re.search(r"[#][a-z-]*[g-z]", line[m.start():m.start() + 12]):
                continue
            problems.append(f"{f.relative_to(APP)}:{n}: colour {m.group()}")
        for font in fonts:
            # index.html asks for the default font up front (one line, id="theme-fonts"), so text doesn't wait for theme.js
            if font in line and 'id="theme-fonts"' not in line:
                problems.append(f"{f.relative_to(APP)}:{n}: font name '{font}'")
print("\n".join(problems) or "theme QA: OK (no hard-coded colours or font names outside theme files)")
sys.exit(1 if problems else 0)
