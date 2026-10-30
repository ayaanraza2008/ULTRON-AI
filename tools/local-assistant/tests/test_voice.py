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


class VoiceModeSafetyTests(unittest.TestCase):
    def _args(self):
        return SimpleNamespace(model=None, locale="auto", timeout=8, once=True, no_speak=True)

    def test_utterance_without_wake_word_is_ignored(self):
        from ultron_local_assistant import cli
        with patch.object(cli.sys, "platform", "win32"):
            with patch.object(cli.sys, "stdin", SimpleNamespace(isatty=lambda: True)):
                with patch.object(cli, "listen_once", return_value="open Notepad"):
                    with patch.object(cli, "local_chat") as chat:
                        with patch.object(cli, "confirm_interactive") as confirm:
                            self.assertEqual(cli.voice_mode(self._args()), 0)
        chat.assert_not_called()
        confirm.assert_not_called()

    def test_voice_chat_accepts_hindi_hinglish_context_and_requests_english_reply(self):
        from ultron_local_assistant import cli
        with patch.object(cli.sys, "platform", "win32"):
            with patch.object(cli.sys, "stdin", SimpleNamespace(isatty=lambda: True)):
                with patch.object(cli, "listen_once", return_value="Ultron, mujhe quantum physics samjhao"):
                    with patch.object(cli, "local_chat", return_value="Here is a simple explanation.") as chat:
                        self.assertEqual(cli.voice_mode(self._args()), 0)
        chat.assert_called_once()
        system_prompt = chat.call_args.kwargs["system"]
        self.assertIn("Hindi, English, or Hinglish", system_prompt)
        self.assertIn("always answer in concise, natural English", system_prompt)
        self.assertIn("ask the user to repeat", system_prompt)

    def test_voice_launch_still_requires_typed_terminal_approval(self):
        from ultron_local_assistant import cli
        with patch.object(cli.sys, "platform", "win32"):
            with patch.object(cli.sys, "stdin", SimpleNamespace(isatty=lambda: True)):
                with patch.object(cli, "listen_once", return_value="Ultron, open Notepad"):
                    with patch.object(cli, "confirm_interactive", return_value=True) as confirm:
                        with patch.object(cli, "launch_application", return_value={"status": "process_start_requested"}) as launch:
                            with patch.object(cli, "speak_text"):
                                self.assertEqual(cli.voice_mode(self._args()), 0)
        confirm.assert_called_once_with("LAUNCH", "Voice requested launching the fixed application 'notepad'.")
        launch.assert_called_once_with("notepad", confirm=True)

    def test_voice_launch_cancellation_never_starts_process(self):
        from ultron_local_assistant import cli
        with patch.object(cli.sys, "platform", "win32"):
            with patch.object(cli.sys, "stdin", SimpleNamespace(isatty=lambda: True)):
                with patch.object(cli, "listen_once", return_value="Ultron, launch Calculator"):
                    with patch.object(cli, "confirm_interactive", return_value=False):
                        with patch.object(cli, "launch_application") as launch:
                            self.assertEqual(cli.voice_mode(self._args()), 0)
        launch.assert_not_called()

    def test_voice_mode_refuses_noninteractive_terminal_before_microphone_access(self):
        from ultron_local_assistant import cli
        with patch.object(cli.sys, "platform", "win32"):
            with patch.object(cli.sys, "stdin", SimpleNamespace(isatty=lambda: False)):
                with patch.object(cli, "listen_once") as listen:
                    self.assertEqual(cli.voice_mode(self._args()), 2)
        listen.assert_not_called()


if __name__ == "__main__":
    unittest.main()
