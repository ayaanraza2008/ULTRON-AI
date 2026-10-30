"""Opt-in, read-only Google Workspace adapter for the local morning digest."""
from __future__ import annotations

import json
from datetime import datetime, time, timedelta
from pathlib import Path
from typing import Any

from .core import app_data_dir, secure_write

GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly"
SCOPES = [GMAIL_SCOPE, CALENDAR_SCOPE]
CLIENT_FILE = "google-oauth-client.json"
TOKEN_FILE = "google-oauth-token.json"


def configure_google_credentials(source: str | Path) -> Path:
    source_path = Path(source).expanduser().resolve()
    if not source_path.is_file() or source_path.stat().st_size > 1_000_000:
        raise ValueError("Select a valid Google desktop OAuth client JSON file under 1 MB.")
    try:
        payload = json.loads(source_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("Google OAuth credentials must be valid JSON.") from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("installed"), dict):
        raise ValueError("Use a Google OAuth Client ID whose application type is Desktop app (installed).")
    destination = app_data_dir() / CLIENT_FILE
    secure_write(destination, json.dumps(payload, indent=2))
    return destination


def _load_google_services(*, reauth: bool = False) -> tuple[Any, Any]:
    try:
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow
        from googleapiclient.discovery import build
    except ImportError as exc:
        raise RuntimeError(
            "Google integration dependencies are missing. Install with "
            'python -m pip install -e "tools/local-assistant[google]".'
        ) from exc

    data_dir = app_data_dir()
    client_path = data_dir / CLIENT_FILE
    token_path = data_dir / TOKEN_FILE
    if not client_path.is_file():
        raise RuntimeError(
            "Google access is not configured. Download a Desktop OAuth client JSON from Google Cloud, "
            "enable Gmail API and Calendar API, then run: ultron-local google setup --credentials PATH"
        )
    creds = None
    if not reauth and token_path.is_file():
        try:
            creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)
            if creds and not set(SCOPES).issubset(set(creds.scopes or [])):
                creds = None
        except (ValueError, OSError, json.JSONDecodeError):
            creds = None
    if creds and not creds.valid and creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
        except Exception:
            creds = None
    if not creds or not creds.valid:
        # Explicitly invoked by a local user; binds the OAuth callback to loopback only.
        flow = InstalledAppFlow.from_client_secrets_file(str(client_path), SCOPES)
        creds = flow.run_local_server(host="127.0.0.1", port=0, open_browser=True)
    secure_write(token_path, creds.to_json())
    return build("gmail", "v1", credentials=creds, cache_discovery=False), build("calendar", "v3", credentials=creds, cache_discovery=False)


def fetch_morning_digest_data(*, reauth: bool = False, max_emails: int = 10, max_events: int = 25) -> dict[str, Any]:
    """Fetch only unread-message metadata/snippets and today's upcoming calendar events."""
    gmail, calendar = _load_google_services(reauth=reauth)
    messages: list[dict[str, str]] = []
    listed = gmail.users().messages().list(
        userId="me", q="is:unread newer_than:1d", maxResults=max(1, min(max_emails, 10))
    ).execute()
    for item in (listed.get("messages") or [])[:10]:
        message_id = item.get("id")
        if not isinstance(message_id, str) or len(message_id) > 200:
            continue
        message = gmail.users().messages().get(
            userId="me", id=message_id, format="metadata", metadataHeaders=["From", "Subject", "Date"]
        ).execute()
        headers = (message.get("payload") or {}).get("headers") or []
        by_name = {str(header.get("name", "")).lower(): str(header.get("value", "")) for header in headers}
        messages.append({
            "from": by_name.get("from", "Unknown sender")[:160],
            "subject": by_name.get("subject", "(no subject)")[:250],
            "date": by_name.get("date", "")[:100],
            "snippet": str(message.get("snippet", ""))[:240],
        })

    now = datetime.now().astimezone()
    tomorrow = datetime.combine(now.date() + timedelta(days=1), time.min, tzinfo=now.tzinfo)
    events_response = calendar.events().list(
        calendarId="primary", timeMin=now.isoformat(), timeMax=tomorrow.isoformat(),
        maxResults=max(1, min(max_events, 25)), singleEvents=True, orderBy="startTime",
    ).execute()
    events: list[dict[str, str]] = []
    for event in (events_response.get("items") or [])[:25]:
        start = event.get("start") or {}
        events.append({
            "start": str(start.get("dateTime") or start.get("date") or "")[:80],
            "title": str(event.get("summary") or "(untitled event)")[:240],
            "location": str(event.get("location") or "")[:160],
        })
    return {"created_at": now.isoformat(timespec="minutes"), "unread_emails": messages, "today_events": events}


def format_digest_data(data: dict[str, Any]) -> str:
    lines = ["ULTRON morning digest", f"Generated locally at: {data.get('created_at', 'unknown')}", "", "TODAY'S CALENDAR"]
    events = data.get("today_events") or []
    if events:
        lines.extend(f"- {event.get('start', '')}: {event.get('title', '')}" + (f" ({event['location']})" if event.get("location") else "") for event in events)
    else:
        lines.append("- No upcoming calendar events were returned.")
    lines.extend(["", "UNREAD EMAILS (metadata and short snippets only)"])
    messages = data.get("unread_emails") or []
    if messages:
        lines.extend(f"- {message.get('subject', '(no subject)')} — {message.get('from', 'Unknown sender')}: {message.get('snippet', '')}" for message in messages)
    else:
        lines.append("- No unread email matches from the last day.")
    return "\n".join(lines)
