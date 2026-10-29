"""Pure policy tests for opt-in browser smoke logging."""
import unittest

from startup_smoke import SMOKE_ENV, SMOKE_TASK, browser_smoke_enabled, summarize_browser_smoke


class BrowserStartupSmokeTests(unittest.TestCase):
    def test_smoke_is_opt_in_and_off_by_default(self):
        self.assertFalse(browser_smoke_enabled({}))
        self.assertFalse(browser_smoke_enabled({SMOKE_ENV: "true"}))
        self.assertFalse(browser_smoke_enabled({SMOKE_ENV: "yes"}))
        self.assertTrue(browser_smoke_enabled({SMOKE_ENV: "YES"}))

    def test_smoke_task_is_public_and_read_only(self):
        self.assertIn("https://example.com", SMOKE_TASK)
        self.assertIn("do not click links", SMOKE_TASK.lower())
        self.assertNotRegex(SMOKE_TASK.lower(), r"\\b(send|submit|purchase|delete|publish|post|email|buy)\\b")

    def test_summarizer_does_not_return_page_content(self):
        raw_page = "Example Domain — PRIVATE PAGE CONTENT MUST NOT BE LOGGED"
        result = summarize_browser_smoke({
            "status": "completed",
            "result": raw_page,
            "allowedHosts": ["example.com"],
            "provider": "openrouter-compatible",
            "model": "openrouter/free",
        })
        self.assertEqual(result["status"], "passed")
        self.assertEqual(result["targetHost"], "example.com")
        self.assertNotIn("result", result)
        self.assertNotIn(raw_page, str(result))

    def test_summarizer_rejects_missing_or_unattested_result(self):
        self.assertEqual(summarize_browser_smoke(None)["reason"], "INVALID_RESULT")
        self.assertEqual(summarize_browser_smoke({"status": "failed"})["reason"], "NAVIGATION_NOT_COMPLETED")
        self.assertEqual(
            summarize_browser_smoke({"status": "completed", "result": "title", "allowedHosts": []})["reason"],
            "TARGET_NOT_ATTESTED",
        )


if __name__ == "__main__":
    unittest.main()
