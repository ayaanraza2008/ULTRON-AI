"""Regression tests for the Windows companion's local approval boundary."""
import io
import sys
import unittest
from datetime import datetime as RealDateTime, timezone
from unittest.mock import patch

from ultron_local_assistant import cli


ACTION_ID = "88888888-8888-4888-8888-888888888888"


def future_action():
    expiry = RealDateTime.now(timezone.utc).replace(microsecond=0)
    from datetime import timedelta
    expiry += timedelta(minutes=1)
    return {
        "id": ACTION_ID,
        "name": "launch_application",
        "target": "notepad",
        "expiresAt": expiry.isoformat(),
    }


class CompanionLocalApprovalTests(unittest.TestCase):
    def test_non_interactive_terminal_denies_without_launching(self):
        action = future_action()
        with patch.object(cli.sys, "stdin", io.StringIO("")):
            with patch.object(cli, "complete_companion_action") as complete:
                with patch.object(cli, "launch_application") as launch:
                    cli.process_companion_action(action)
        complete.assert_called_once_with(ACTION_ID, "denied", "LOCAL_APPROVAL_REQUIRED")
        launch.assert_not_called()

    def test_local_user_can_deny_without_launching(self):
        action = future_action()
        with patch.object(cli, "confirm_interactive", return_value=False):
            with patch.object(cli, "complete_companion_action") as complete:
                with patch.object(cli, "launch_application") as launch:
                    cli.process_companion_action(action)
        complete.assert_called_once_with(ACTION_ID, "denied", "USER_DENIED")
        launch.assert_not_called()

    def test_typed_allow_runs_only_the_fixed_local_launcher_and_records_completion(self):
        action = future_action()
        with patch.object(cli, "confirm_interactive", return_value=True):
            with patch.object(cli, "authorize_companion_action", return_value=True) as authorize:
                with patch.object(cli, "launch_application", return_value={"status": "process_start_requested"}) as launch:
                    with patch.object(cli, "complete_companion_action") as complete:
                        cli.process_companion_action(action)
        authorize.assert_called_once_with(ACTION_ID)
        launch.assert_called_once_with("notepad", confirm=True)
        complete.assert_called_once_with(ACTION_ID, "completed", "ACTION_COMPLETED")

    def test_revoked_or_expired_action_is_not_launched_after_local_allow(self):
        action = future_action()
        with patch.object(cli, "confirm_interactive", return_value=True):
            with patch.object(cli, "authorize_companion_action", return_value=False) as authorize:
                with patch.object(cli, "launch_application") as launch:
                    with patch.object(cli, "complete_companion_action") as complete:
                        cli.process_companion_action(action)
        authorize.assert_called_once_with(ACTION_ID)
        launch.assert_not_called()
        complete.assert_not_called()

    def test_authorization_error_fails_closed_before_launch(self):
        action = future_action()
        with patch.object(cli, "confirm_interactive", return_value=True):
            with patch.object(cli, "authorize_companion_action", side_effect=RuntimeError("network unavailable")):
                with patch.object(cli, "launch_application") as launch:
                    cli.process_companion_action(action)
        launch.assert_not_called()

    def test_action_expiring_during_the_prompt_is_never_run(self):
        start = RealDateTime.now(timezone.utc).replace(microsecond=0)
        from datetime import timedelta
        action = {
            "id": ACTION_ID,
            "name": "launch_application",
            "target": "notepad",
            "expiresAt": (start + timedelta(seconds=30)).isoformat(),
        }

        class MutableClock:
            current = start

            @classmethod
            def now(cls, tz=None):
                return cls.current

            @staticmethod
            def fromisoformat(value):
                return RealDateTime.fromisoformat(value)

        def approve_then_expire(*_args, **_kwargs):
            MutableClock.current = start + timedelta(minutes=3)
            return True

        with patch.object(cli, "datetime", MutableClock):
            with patch.object(cli, "confirm_interactive", side_effect=approve_then_expire):
                with patch.object(cli, "complete_companion_action") as complete:
                    with patch.object(cli, "launch_application") as launch:
                        cli.process_companion_action(action)
        complete.assert_called_once_with(ACTION_ID, "expired", "ACTION_EXPIRED")
        launch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
