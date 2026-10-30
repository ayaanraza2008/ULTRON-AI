import base64
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ultron_local_assistant import voice


class WakeWordTests(unittest.TestCase):
    def test_requires_exact_leading_wake_word(self):
        self.assertEqual(voice.wake_command("Ultron, open Notepad"), "open Notepad")
        self.assertEqual(voice.wake_command("  ULTRON: what time is it?"), "what time is it?")
        self.assertEqual(voice.wake_command("Ultron"), "")
        self.assertIsNone(voice.wake_command("open Notepad"))
        self.assertIsNone(voice.wake_command("Hey Ultron, open Notepad"))

    def test_fixed_desktop_phrases_are_allowlisted(self):
        cases = [
            ("open Notepad", {"kind": "launch", "target": "notepad"}),
            ("please launch Calculator", {"kind": "launch", "target": "calculator"}),
            ("start File Explorer", {"kind": "launch", "target": "explorer"}),
            ("open my Downloads folder", {"kind": "open-folder", "target": "downloads"}),
            ("documents kholo", {"kind": "open-folder", "target": "documents"}),
            ("notepad khol do", {"kind": "launch", "target": "notepad"}),
        ]
        for phrase, expected in cases:
            with self.subTest(phrase=phrase):
                self.assertEqual(voice.classify_desktop_command(phrase), expected)

    def test_free_form_or_consequential_commands_are_not_desktop_actions(self):
        for phrase in (
            "delete my downloads", "open C drive", "run powershell",
            "send an email", "shutdown the computer", "open Chrome",
            "please open Notepad and delete the file",
        ):
            with self.subTest(phrase=phrase):
                self.assertIsNone(voice.classify_desktop_command(phrase))

    def test_voice_capture_is_windows_only(self):
        with patch.object(voice.platform, "system", return_value="Linux"):
            with self.assertRaisesRegex(RuntimeError, "only on Windows"):
                voice.listen_once()

    def test_voice_capture_validates_locale_and_timeout_before_launch(self):
        with patch.object(voice.platform, "system", return_value="Windows"):
            with patch.object(voice.subprocess, "run") as run:
                with self.assertRaises(ValueError):
                    voice.listen_once(locale="not-a-locale")
                with self.assertRaises(ValueError):
                    voice.listen_once(timeout=99)
                run.assert_not_called()

    def test_voice_capture_uses_encoded_local_powershell_and_parses_transcript(self):
        with patch.object(voice.platform, "system", return_value="Windows"):
            with patch.object(voice.shutil, "which", return_value="powershell.exe"):
                with patch.object(voice.subprocess, "run", return_value=SimpleNamespace(
                    returncode=0, stdout="noise\nULTRON_TRANSCRIPT:Ultron, hello there\n", stderr=""
                )) as run:
                    self.assertEqual(voice.listen_once("en-IN", 8), "Ultron, hello there")
        args, kwargs = run.call_args
        self.assertEqual(args[0][0], "powershell.exe")
        self.assertIn("-EncodedCommand", args[0])
        script = base64.b64decode(args[0][-1]).decode("utf-16le")
        self.assertIn("System.Speech.Recognition", script)
        self.assertIn("InstalledRecognizers", script)
        self.assertIn("DictationGrammar", script)
        self.assertIs(kwargs["shell"], False)
        self.assertEqual(kwargs["stdin"], voice.subprocess.DEVNULL)
        self.assertEqual(kwargs["timeout"], 20)
        self.assertEqual(kwargs["env"]["ULTRON_VOICE_LOCALE"], "en-IN")

    def test_voice_capture_redacts_recognizer_and_microphone_errors(self):
        with patch.object(voice.platform, "system", return_value="Windows"):
            with patch.object(voice.shutil, "which", return_value="powershell.exe"):
                with patch.object(voice.subprocess, "run", return_value=SimpleNamespace(
                    returncode=3, stdout="", stderr="private machine detail"
                )):
                    with self.assertRaisesRegex(RuntimeError, "No matching installed"):
                        voice.listen_once()
                with patch.object(voice.subprocess, "run", return_value=SimpleNamespace(
                    returncode=2, stdout="", stderr="private machine detail"
                )):
                    with self.assertRaisesRegex(RuntimeError, "microphone permission"):
                        voice.listen_once()


class VoiceCommandParserTests(unittest.TestCase):
    def test_voice_subcommand_and_bounded_options(self):
        from ultron_local_assistant.cli import build_parser
        args = build_parser().parse_args(["voice", "--locale", "hi-IN", "--timeout", "9", "--once", "--no-speak"])
        self.assertEqual(args.command, "voice")
        self.assertEqual(args.locale, "hi-IN")
        self.assertEqual(args.timeout, 9)
        self.assertTrue(args.once)
        self.assertTrue(args.no_speak)


if __name__ == "__main__":
    unittest.main()
