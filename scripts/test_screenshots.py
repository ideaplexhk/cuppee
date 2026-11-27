"""Unit tests for the screenshot harness (run by scripts/verify.sh; no browser or server needed)."""
import json
import tempfile
import unittest
from pathlib import Path

import screenshots as s

ROOT = Path(__file__).resolve().parent.parent


class ScreensFile(unittest.TestCase):
    def test_repo_screens_json_is_valid(self):
        screens = s.load_screens(ROOT / "scripts" / "screens.json")
        self.assertGreater(len(screens), 0)
        for sc in screens:
            self.assertIn(sc["auth"], s.AUTH_KINDS)

    def test_rejects_unknown_auth_and_bad_paths(self):
        with self.assertRaises(ValueError):
            s.validate_screens([{"name": "x", "path": "/x", "auth": "admin"}])
        with self.assertRaises(ValueError):
            s.validate_screens([{"name": "x", "path": "x", "auth": "none"}])
        with self.assertRaises(ValueError):
            s.validate_screens([{"name": "a", "path": "/a"}, {"name": "a", "path": "/b"}])

    def test_auth_defaults_to_none(self):
        self.assertEqual(s.validate_screens([{"name": "a", "path": "/a"}])[0]["auth"], "none")


class Plan(unittest.TestCase):
    def test_every_screen_at_both_sizes_and_languages(self):
        screens = s.validate_screens([{"name": "card", "path": "/card", "auth": "member"}])
        shots = s.plan(screens)
        self.assertEqual(len(shots), 4)
        self.assertEqual({(x.lang, x.size) for x in shots},
                         {("en", "android-1280x800"), ("en", "ipad-1180x820"),
                          ("zh-HK", "android-1280x800"), ("zh-HK", "ipad-1180x820")})
        self.assertEqual({x.viewport for x in shots}, {(1280, 800), (1180, 820)})
        zh = next(x for x in shots if x.lang == "zh-HK")
        self.assertEqual(zh.out, Path("zh-HK") / zh.size / "card.png")
        self.assertEqual(zh.url("http://w"), "http://w/card?lang=zh-HK")


class InitScript(unittest.TestCase):
    def test_member_session_is_stored_and_staff_cleared(self):
        js = s.init_script("en", {"memberToken": "m1"})
        self.assertIn('localStorage.setItem("memberToken", "m1")', js)
        self.assertIn('localStorage.removeItem("staffToken")', js)
        self.assertIn('localStorage.setItem("lang", "en")', js)

    def test_no_session_clears_everything(self):
        js = s.init_script("zh-HK", {})
        for k in s.SESSION_KEYS:
            self.assertIn(f'localStorage.removeItem("{k}")', js)


class SpaRouting(unittest.TestCase):
    def test_routes_fall_back_to_index_but_assets_do_not(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "index.html").write_text("<html></html>")
            (root / "_expo").mkdir()
            (root / "_expo" / "a.js").write_text("x")
            self.assertEqual(s.spa_file(root, "/staff/login?lang=en"), root / "index.html")
            self.assertEqual(s.spa_file(root, "/_expo/a.js"), root / "_expo" / "a.js")
            self.assertIsNone(s.spa_file(root, "/_expo/missing.js"))
            self.assertIsNone(s.spa_file(root, "/../etc/passwd"))


class Landing(unittest.TestCase):
    def test_redirect_to_another_screen_is_a_failure(self):
        self.assertIsNone(s.landing_problem("/card", "http://w/card?lang=en", "Your card"))
        self.assertIn("redirected", s.landing_problem("/card", "http://w/sign-in", "Sign in"))
        self.assertIn("blank", s.landing_problem("/card", "http://w/card", "   "))
        self.assertIn("API", s.landing_problem("/card", "http://w/card", "Can’t reach CUPPEE. Check your connection."))


if __name__ == "__main__":
    unittest.main()
