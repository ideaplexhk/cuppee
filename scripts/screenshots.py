"""Capture screenshots of the CUPPEE app for PRs (scripts/verify.sh --screens).

1. Seeds a throwaway dev database and starts the API on it (dev mode, fake data only).
2. Builds the Expo web export and serves it locally.
3. Signs in through the API (member via dev OTP, staff via the seeded dev PIN) and puts the session into the
   browser's storage, so screens that need sign-in render signed in.
4. Opens each screen in scripts/screens.json at both tablet sizes and in both languages and saves
   screenshots/<lang>/<size>/<name>.png. A screen that redirects elsewhere, renders blank or cannot reach the API
   counts as a failure, and the script exits non-zero.

The language is passed as `?lang=<code>`, the browser locale and localStorage `lang`. Until backlog M2.1 (i18n)
lands, the app ignores it and the zh-HK screenshots show English.

Requires Python Playwright with Chromium.
"""
from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from dataclasses import dataclass
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "screenshots"
SIZES = {"android-1280x800": (1280, 800), "ipad-1180x820": (1180, 820)}
LANGS = ["en", "zh-HK"]
AUTH_KINDS = ("none", "member", "staff")
SESSION_KEYS = ("memberToken", "staffToken", "staff")
API_PORT = int(os.environ.get("SCREENS_API_PORT", "8787"))
WEB_PORT = int(os.environ.get("SCREENS_WEB_PORT", "8081"))
API = f"http://localhost:{API_PORT}"
WEB = f"http://localhost:{WEB_PORT}"

# Dev seed accounts only (server/seed/seed-data.json). Not real people.
DEV_MEMBER = {"phone": "90000001", "displayName": "Demo Member"}
DEV_STAFF = {"cafeId": "cafe_cohee", "staffId": "stf_cohee_1", "pin": "1234"}


# ---------- pure helpers (unit-tested in scripts/test_screenshots.py) ----------

def validate_screens(screens: list[dict]) -> list[dict]:
    seen = set()
    out = []
    for sc in screens:
        name, path, auth = sc.get("name"), sc.get("path"), sc.get("auth", "none")
        if not name or not isinstance(name, str):
            raise ValueError(f"screen without a name: {sc}")
        if name in seen:
            raise ValueError(f"duplicate screen name: {name}")
        if not isinstance(path, str) or not path.startswith("/"):
            raise ValueError(f"screen {name}: path must start with /")
        if auth not in AUTH_KINDS:
            raise ValueError(f"screen {name}: auth must be one of {AUTH_KINDS}")
        seen.add(name)
        out.append({"name": name, "path": path, "auth": auth})
    return out


def load_screens(path: Path) -> list[dict]:
    return validate_screens(json.loads(path.read_text(encoding="utf-8")))


@dataclass(frozen=True)
class Shot:
    name: str
    path: str
    auth: str
    lang: str
    size: str
    viewport: tuple[int, int]

    @property
    def out(self) -> Path:
        return Path(self.lang) / self.size / f"{self.name}.png"

    def url(self, web: str) -> str:
        return f"{web}{self.path}?lang={self.lang}"


def plan(screens: list[dict]) -> list[Shot]:
    return [
        Shot(sc["name"], sc["path"], sc["auth"], lang, size, vp)
        for lang in LANGS
        for size, vp in SIZES.items()
        for sc in screens
    ]


def init_script(lang: str, session: dict[str, str]) -> str:
    lines = [f"localStorage.setItem({json.dumps('lang')}, {json.dumps(lang)});"]
    for k in SESSION_KEYS:
        if k in session:
            lines.append(f"localStorage.setItem({json.dumps(k)}, {json.dumps(session[k])});")
        else:
            lines.append(f"localStorage.removeItem({json.dumps(k)});")
    return "try {\n  " + "\n  ".join(lines) + "\n} catch (e) {}\n"


def spa_file(root: Path, request_path: str) -> Path | None:
    """File to serve for a request: real files as-is, extension-less routes fall back to index.html."""
    rel = urlsplit(request_path).path.lstrip("/")
    target = (root / rel).resolve()
    if root.resolve() not in target.parents and target != root.resolve():
        return None
    if target.is_file():
        return target
    if "." in Path(rel).name:
        return None  # a missing asset is a 404, not the app shell
    return root / "index.html"


def landing_problem(expected_path: str, final_url: str, text: str) -> str | None:
    final_path = urlsplit(final_url).path.rstrip("/") or "/"
    if final_path != (expected_path.rstrip("/") or "/"):
        return f"redirected to {final_path}"
    if not text.strip():
        return "rendered blank"
    if "Can’t reach CUPPEE" in text:
        return "app could not reach the API"
    return None


# ---------- side effects ----------

def wait_for(url: str, timeout: float = 120) -> None:
    end = time.time() + timeout
    while time.time() < end:
        try:
            urllib.request.urlopen(url, timeout=3)
            return
        except Exception:
            time.sleep(1)
    raise SystemExit(f"timed out waiting for {url}")


def post(path: str, body: dict) -> dict:
    req = urllib.request.Request(f"{API}{path}", data=json.dumps(body).encode(), method="POST",
                                 headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


def sessions() -> dict[str, dict[str, str]]:
    otp = post("/v1/auth/otp/request", {"phone": DEV_MEMBER["phone"]})
    if not otp.get("devCode"):
        raise SystemExit("API did not return a dev OTP code; is it running in dev mode?")
    member = post("/v1/auth/otp/verify", {**DEV_MEMBER, "code": otp["devCode"]})
    staff = post("/v1/staff/login", DEV_STAFF)
    return {
        "none": {},
        "member": {"memberToken": member["token"]},
        "staff": {"staffToken": staff["token"], "staff": json.dumps(staff["staff"])},
    }


class SpaHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, root: Path, **kw):
        self.spa_root = root
        super().__init__(*args, directory=str(root), **kw)

    def translate_path(self, path: str) -> str:
        f = spa_file(self.spa_root, path)
        return str(f) if f else str(self.spa_root / "__missing__")

    def log_message(self, *args) -> None:
        pass


def main() -> int:
    from playwright.sync_api import sync_playwright

    screens = load_screens(ROOT / "scripts" / "screens.json")
    work = Path(tempfile.mkdtemp(prefix="cuppee-screens-"))
    env = {**os.environ, "NODE_ENV": "development", "PORT": str(API_PORT), "DB_PATH": str(work / "screens.db"),
           "EXPO_PUBLIC_API_URL": API, "CI": "1"}
    procs: list[subprocess.Popen] = []
    httpd = None
    try:
        print("== screenshots: seed dev database", flush=True)
        subprocess.run(["npm", "run", "--silent", "seed"], cwd=ROOT / "server", env=env, check=True,
                       stdout=subprocess.DEVNULL)
        procs.append(subprocess.Popen(["npm", "start", "--silent"], cwd=ROOT / "server", env=env,
                                      start_new_session=True))
        print("== screenshots: export web build", flush=True)
        web_dir = work / "web"
        subprocess.run(["npx", "expo", "export", "--platform", "web", "--output-dir", str(web_dir)],
                       cwd=ROOT / "app", env=env, check=True, stdout=subprocess.DEVNULL)
        httpd = ThreadingHTTPServer(("127.0.0.1", WEB_PORT), partial(SpaHandler, root=web_dir))
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        wait_for(f"{API}/health")
        wait_for(WEB)
        auth = sessions()

        failures = []
        with sync_playwright() as p:
            browser = p.chromium.launch()
            for shot in plan(screens):
                ctx = browser.new_context(viewport={"width": shot.viewport[0], "height": shot.viewport[1]},
                                          locale=shot.lang)
                ctx.add_init_script(init_script(shot.lang, auth[shot.auth]))
                page = ctx.new_page()
                target = OUT / shot.out
                target.parent.mkdir(parents=True, exist_ok=True)
                try:
                    page.goto(shot.url(WEB), wait_until="networkidle", timeout=60000)
                    page.wait_for_timeout(800)
                    problem = landing_problem(shot.path, page.url, page.inner_text("body"))
                    page.screenshot(path=str(target), full_page=True)
                    if problem:
                        failures.append(f"{shot.out}: {problem}")
                        print(f"FAILED {shot.out}: {problem}", file=sys.stderr)
                    else:
                        print(f"saved screenshots/{shot.out}")
                except Exception as e:  # keep going; report at the end
                    failures.append(f"{shot.out}: {e}")
                    print(f"FAILED {shot.out}: {e}", file=sys.stderr)
                ctx.close()
            browser.close()
        if "zh-HK" in LANGS:
            print("note: zh-HK screenshots show English until backlog M2.1 (i18n) lands")
        print(f"== screenshots: {len(plan(screens)) - len(failures)} saved, {len(failures)} failed")
        return 1 if failures else 0
    finally:
        if httpd:
            httpd.shutdown()
        for pr in procs:
            try:
                os.killpg(pr.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass


if __name__ == "__main__":
    sys.exit(main())
