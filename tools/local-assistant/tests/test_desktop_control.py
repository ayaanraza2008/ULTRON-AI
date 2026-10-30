import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from ultron_local_assistant import desktop_control
from ultron_local_assistant.cli import build_parser


class DesktopControlTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.windows_root = self.root / "Windows"
        self.system32 = self.windows_root / "System32"
        self.system32.mkdir(parents=True)
        (self.system32 / "notepad.exe").write_bytes(b"fixture")
        (self.system32 / "explorer.exe").write_bytes(b"fixture")
        self.data_dir = self.root / "private-user-data"
        self.platform_patch = patch("ultron_local_assistant.desktop_control.platform.system", return_value="Windows")
        self.platform_patch.start()
        self.addCleanup(self.platform_patch.stop)
        self.env_patch = patch.dict(os.environ, {"WINDIR": str(self.windows_root), "SystemRoot": str(self.windows_root)})
        self.env_patch.start()
        self.addCleanup(self.env_patch.stop)
        self.data_patch = patch("ultron_local_assistant.desktop_control.app_data_dir", return_value=self.data_dir)
        self.data_patch.start()
        self.addCleanup(self.data_patch.stop)
        self.popen_patch = patch("ultron_local_assistant.desktop_control.subprocess.Popen", return_value=SimpleNamespace(pid=4321))
        self.popen = self.popen_patch.start()
        self.addCleanup(self.popen_patch.stop)

    def test_catalog_is_fixed_and_reports_that_remote_control_is_not_available(self):
        catalog = desktop_control.list_desktop_actions()
        self.assertTrue(catalog["platform_supported"])
        self.assertEqual(catalog["applications"], ["notepad", "explorer", "calculator"])
        self.assertEqual(catalog["folders"], ["desktop", "documents", "downloads"])
        self.assertFalse(catalog["remote_control"])

    def test_launch_requires_explicit_confirmation_before_audit_or_process_start(self):
        with self.assertRaises(PermissionError):
            desktop_control.launch_application("notepad", confirm=False)
        self.popen.assert_not_called()
        self.assertFalse(self.data_dir.exists())

    def test_unknown_application_and_arbitrary_executable_are_rejected(self):
        for value in ("cmd.exe", "powershell", r"C:\Windows\System32\notepad.exe", "../notepad"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                desktop_control.launch_application(value, confirm=True)
        self.popen.assert_not_called()

    def test_notepad_uses_fixed_system32_path_and_shell_is_disabled(self):
        result = desktop_control.launch_application("notepad", confirm=True)
        args, kwargs = self.popen.call_args
        self.assertEqual(args[0], [str((self.system32 / "notepad.exe").resolve())])
        self.assertIs(kwargs["shell"], False)
        self.assertIs(kwargs["close_fds"], True)
        self.assertEqual(kwargs["stdin"], desktop_control.subprocess.DEVNULL)
        self.assertEqual(kwargs["stdout"], desktop_control.subprocess.DEVNULL)
        self.assertEqual(kwargs["stderr"], desktop_control.subprocess.DEVNULL)
        self.assertEqual(result["status"], "process_start_requested")
        self.assertEqual(result["process_id"], 4321)
        self.assertIn("not verified", result["note"])

    def test_calculator_uses_only_the_fixed_windows_app_identity(self):
        desktop_control.launch_application("calculator", confirm=True)
        args, _ = self.popen.call_args
        self.assertEqual(args[0][0], str((self.system32 / "explorer.exe").resolve()))
        self.assertEqual(
            args[0][1:],
            [r"shell:AppsFolder\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"],
        )

    def test_known_folder_uses_fixed_shell_location_not_a_user_path(self):
        desktop_control.open_known_folder("downloads", confirm=True)
        args, _ = self.popen.call_args
        self.assertEqual(args[0][0], str((self.system32 / "explorer.exe").resolve()))
        self.assertEqual(args[0][1:], ["shell:Downloads"])
        with self.assertRaises(ValueError):
            desktop_control.open_known_folder(str(self.root), confirm=True)
        with self.assertRaises(ValueError):
            desktop_control.open_known_folder("../../", confirm=True)
        self.assertEqual(self.popen.call_count, 1)

    def test_non_windows_platform_is_blocked_before_process_creation(self):
        with patch("ultron_local_assistant.desktop_control.platform.system", return_value="Linux"):
            with self.assertRaisesRegex(RuntimeError, "only on Windows"):
                desktop_control.launch_application("notepad", confirm=True)
        self.popen.assert_not_called()

    def test_linked_windows_executable_is_rejected(self):
        if not hasattr(os, "symlink"):
            self.skipTest("Symbolic links are unavailable on this runner.")
        target = self.system32 / "notepad-real.exe"
        target.write_bytes(b"fixture")
        path = self.system32 / "notepad.exe"
        path.unlink()
        try:
            path.symlink_to(target)
        except OSError:
            self.skipTest("This runner cannot create symbolic links.")
        with self.assertRaisesRegex(RuntimeError, "symbolic link"):
            desktop_control.launch_application("notepad", confirm=True)
        self.popen.assert_not_called()

    def test_audit_log_contains_only_allowlisted_target_and_process_metadata(self):
        desktop_control.launch_application("notepad", confirm=True)
        audit = self.data_dir / desktop_control.AUDIT_FILENAME
        records = [json.loads(line) for line in audit.read_text(encoding="utf-8").splitlines()]
        self.assertEqual([record["outcome"] for record in records], ["approved", "process_start_requested"])
        self.assertEqual(records[-1]["process_id"], 4321)
        self.assertEqual({record["target"] for record in records}, {"notepad"})
        self.assertNotIn(str(self.root), audit.read_text(encoding="utf-8"))
        self.assertLessEqual(audit.stat().st_size, desktop_control.MAX_AUDIT_BYTES)

    def test_audit_symlink_blocks_the_launch_and_preserves_target_file(self):
        self.data_dir.mkdir()
        sentinel = self.root / "sentinel.txt"
        sentinel.write_text("untouched", encoding="utf-8")
        audit = self.data_dir / desktop_control.AUDIT_FILENAME
        try:
            audit.symlink_to(sentinel)
        except OSError:
            self.skipTest("This runner cannot create symbolic links.")
        with self.assertRaisesRegex(RuntimeError, "symbolic link"):
            desktop_control.launch_application("notepad", confirm=True)
        self.popen.assert_not_called()
        self.assertEqual(sentinel.read_text(encoding="utf-8"), "untouched")

    def test_full_or_corrupt_audit_log_fails_closed(self):
        self.data_dir.mkdir()
        audit = self.data_dir / desktop_control.AUDIT_FILENAME
        audit.write_text("x" * (desktop_control.MAX_AUDIT_BYTES + 1), encoding="utf-8")
        with self.assertRaisesRegex(RuntimeError, "bounded regular file"):
            desktop_control.launch_application("notepad", confirm=True)
        self.popen.assert_not_called()
        audit.write_text("{not-json}\n", encoding="utf-8")
        with self.assertRaisesRegex(RuntimeError, "cannot be read safely"):
            desktop_control.launch_application("notepad", confirm=True)
        self.popen.assert_not_called()

    def test_failed_process_start_is_recorded_without_raw_exception_text(self):
        self.popen.side_effect = FileNotFoundError("private-path-not-for-audit")
        with self.assertRaisesRegex(RuntimeError, "could not start"):
            desktop_control.launch_application("notepad", confirm=True)
        audit_text = (self.data_dir / desktop_control.AUDIT_FILENAME).read_text(encoding="utf-8")
        records = [json.loads(line) for line in audit_text.splitlines()]
        self.assertEqual([record["outcome"] for record in records], ["approved", "launch_failed"])
        self.assertEqual(records[-1]["error_code"], "FileNotFoundError")
        self.assertNotIn("private-path-not-for-audit", audit_text)


class DesktopCommandParserTests(unittest.TestCase):
    def test_fixed_desktop_subcommands_parse_to_expected_handlers(self):
        cases = [
            (["desktop", "list"], "desktop_list"),
            (["desktop", "launch", "notepad"], "desktop_launch"),
            (["desktop", "open-folder", "downloads"], "desktop_open_folder"),
        ]
        for argv, expected in cases:
            with self.subTest(argv=argv):
                parsed = build_parser().parse_args(argv)
                self.assertEqual(parsed.handler.__name__, expected)

    def test_there_is_no_confirmation_bypass_argument(self):
        with self.assertRaises(SystemExit):
            build_parser().parse_args(["desktop", "launch", "notepad", "--yes"])


if __name__ == "__main__":
    unittest.main()
