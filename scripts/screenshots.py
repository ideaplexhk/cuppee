"""Capture screenshots of the CUPPEE app for PRs (scripts/verify.sh --screens).

Starts the API (dev seed) and the Expo web build, then opens each screen in scripts/screens.json at both tablet
sizes and in both languages, and saves PNGs to screenshots/<lang>/<size>/<name>.png.

Requires: Python Playwright with Chromium (`pip install playwright && playwright install chromium`).
Backlog M0.3 finishes this harness (sign-in helper, language switch); until then screens that need
sign-in or a language switch are captured as far as they load.
"""
import json
import os
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "screenshots"
SIZES = {"android-1280x800": (1280, 800), "ipad-1180x820": (1180, 820)}
LANGS = ["en", "zh-HK"]
API = "http://localhost:8787"
WEB = "http://localhost:8081"


def wait_for(url: str, timeout: float = 180) -> None:
    end = time.time() + timeout
    while time.time() < end:
        try:
            urllib.request.urlopen(url, timeout=3)
            return
        except Exception:
            time.sleep(2)
    raise SystemExit(f"timed out waiting for {url}")


def main() -> int:
    screens = json.loads((ROOT / "scripts" / "screens.json").read_text(encoding="utf-8"))
    env = {**os.environ, "EXPO_PUBLIC_API_URL": API, "CI": "1"}
    procs = [
        subprocess.Popen(["npm", "start"], cwd=ROOT / "server", env=env, start_new_session=True),
        subprocess.Popen(["npx", "expo", "start", "--web", "--port", "8081"], cwd=ROOT / "app", env=env,
                         start_new_session=True),
    ]
    try:
        wait_for(f"{API}/health")
        wait_for(WEB)
        failures = 0
        with sync_playwright() as p:
            browser = p.chromium.launch()
            for lang in LANGS:
                for size_name, (w, h) in SIZES.items():
                    ctx = browser.new_context(viewport={"width": w, "height": h}, locale=lang)
                    page = ctx.new_page()
                    for s in screens:
                        target = OUT / lang / size_name / f"{s['name']}.png"
                        target.parent.mkdir(parents=True, exist_ok=True)
                        try:
                            page.goto(f"{WEB}{s['path']}?lang={lang}", wait_until="networkidle", timeout=60000)
                            page.wait_for_timeout(800)
                            page.screenshot(path=str(target), full_page=True)
                            print(f"saved {target.relative_to(ROOT)}")
                        except Exception as e:  # keep going; report at the end
                            failures += 1
                            print(f"FAILED {s['name']} {lang} {size_name}: {e}", file=sys.stderr)
                    ctx.close()
            browser.close()
        return 1 if failures else 0
    finally:
        for pr in procs:
            try:
                os.killpg(pr.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass


if __name__ == "__main__":
    sys.exit(main())
