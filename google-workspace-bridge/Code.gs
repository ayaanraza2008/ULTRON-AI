/**
 * ULTRON Google Workspace read-only bridge.
 *
 * Deploy as an Apps Script web app. Store a random 32+ character token in
 * Script Properties under ULTRON_BRIDGE_TOKEN. The ULTRON backend sends that
 * token in the HTTPS POST body; never put it in the deployment URL or logs.
 *
 * Enabled actions are deliberately read-only. Do not add send, edit, move,
 * create, or delete handlers without a separate action-specific approval design.
 */

const MAX_BODY_CHARS = 16000;
const MAX_ITEMS = 20;
const ALLOWED_ACTIONS = new Set([
  "gmail_list_unread",
  "gmail_search",
  "calendar_get_events",
  "drive_list_files",
  "drive_read_doc",
  "sheets_read"
]);

function output_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function constantTimeEqual_(a, b) {
  a = String(a || "");
  b = String(b || "");
  if (!a || !b || a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

function boundedString_(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function clampInt_(value, fallback, minValue, maxValue) {
  const n = Number(value);
  return Number.isInteger(n) ? Math.max(minValue, Math.min(maxValue, n)) : fallback;
}

function escapeDriveLiteral_(value) {
  // Google Drive search literals need both quote and backslash escaping.
  return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function assertValidId_(value, label) {
  const id = boundedString_(value, 120);
  if (!/^[A-Za-z0-9_-]{10,120}$/.test(id)) throw new Error(label + " is invalid.");
  return id;
}

function doPost(e) {
  try {
    const raw = e && e.postData && typeof e.postData.contents === "string"
      ? e.postData.contents : "";
    if (!raw || raw.length > MAX_BODY_CHARS) return output_({ status: "error", error: "Invalid request." });
    const body = JSON.parse(raw);
    const expected = PropertiesService.getScriptProperties().getProperty("ULTRON_BRIDGE_TOKEN") || "";
    if (!constantTimeEqual_(body.bridgeToken, expected)) {
      return output_({ status: "error", error: "Unauthorized." });
    }
    const action = typeof body.action === "string" ? body.action : "";
    if (!ALLOWED_ACTIONS.has(action)) {
      return output_({ status: "error", error: "Action not allowed." });
    }
    const params = body.params && typeof body.params === "object" && !Array.isArray(body.params)
      ? body.params : {};
    return output_({ status: "success", data: dispatchReadOnly_(action, params) });
  } catch (err) {
    // Avoid returning stack traces, document content, or account details.
    return output_({ status: "error", error: "Request failed validation or the read operation was unavailable." });
  }
}

function dispatchReadOnly_(action, p) {
  switch (action) {
    case "gmail_list_unread":
      return gmailListUnread_(p);
    case "gmail_search":
      return gmailSearch_(p);
    case "calendar_get_events":
      return calendarGetEvents_(p);
    case "drive_list_files":
      return driveListFiles_(p);
    case "drive_read_doc":
      return driveReadDoc_(p);
    case "sheets_read":
      return sheetsRead_(p);
    default:
      throw new Error("Unsupported action.");
  }
}

function gmailListUnread_(p) {
  const limit = clampInt_(p.limit, 10, 1, MAX_ITEMS);
  const threads = GmailApp.search("is:unread in:inbox", 0, limit);
  const emails = threads.map(function(thread) {
    const messages = thread.getMessages();
    const message = messages.length ? messages[messages.length - 1] : null;
    if (!message) return null;
    return {
      subject: boundedString_(message.getSubject(), 300),
      from: boundedString_(message.getFrom(), 200),
      date: message.getDate().toISOString(),
      snippet: boundedString_(message.getPlainBody(), 200).replace(/\s+/g, " ")
    };
  }).filter(Boolean);
  return {
    count: emails.length,
    totalUnread: Math.max(0, GmailApp.getInboxUnreadCount()),
    emails: emails
  };
}

function gmailSearch_(p) {
  const query = boundedString_(p.query, 300);
  if (query.length < 2 || /[\r\n]/.test(query)) throw new Error("Invalid Gmail query.");
  const limit = clampInt_(p.limit, 10, 1, MAX_ITEMS);
  const threads = GmailApp.search(query, 0, limit);
  const emails = threads.map(function(thread) {
    const messages = thread.getMessages();
    const message = messages.length ? messages[messages.length - 1] : null;
    if (!message) return null;
    return {
      subject: boundedString_(message.getSubject(), 300),
      from: boundedString_(message.getFrom(), 200),
      date: message.getDate().toISOString(),
      snippet: boundedString_(message.getPlainBody(), 500).replace(/\s+/g, " ")
    };
  }).filter(Boolean);
  return { count: emails.length, emails: emails };
}

function calendarGetEvents_(p) {
  const startText = boundedString_(p.timeMin, 40);
  const endText = boundedString_(p.timeMax, 40);
  const start = startText ? new Date(startText) : new Date();
  const end = endText ? new Date(endText) : new Date(start.getTime() + 24 * 60 * 60 * 1000);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) ||
      end.getTime() <= start.getTime() || end.getTime() - start.getTime() > 90 * 24 * 60 * 60 * 1000) {
    throw new Error("Invalid calendar date range.");
  }
  const events = CalendarApp.getDefaultCalendar().getEvents(start, end).slice(0, 100).map(function(event) {
    return {
      title: boundedString_(event.getTitle(), 300),
      start: event.getStartTime().toISOString(),
      end: event.getEndTime().toISOString(),
      location: boundedString_(event.getLocation(), 300)
    };
  });
  return { count: events.length, events: events };
}

function driveListFiles_(p) {
  const query = boundedString_(p.query, 80);
  const type = boundedString_(p.fileType, 20).toLowerCase();
  const typeMap = {
    document: "application/vnd.google-apps.document",
    spreadsheet: "application/vnd.google-apps.spreadsheet",
    presentation: "application/vnd.google-apps.presentation",
    pdf: "application/pdf",
    folder: "application/vnd.google-apps.folder"
  };
  if (type && !Object.prototype.hasOwnProperty.call(typeMap, type)) throw new Error("Invalid Drive file type.");
  let criteria = "trashed = false";
  if (type) criteria += " and mimeType = '" + typeMap[type] + "'";
  if (query) criteria += " and name contains '" + escapeDriveLiteral_(query) + "'";
  const limit = clampInt_(p.limit, 20, 1, MAX_ITEMS);
  const files = DriveApp.searchFiles(criteria);
  const result = [];
  while (files.hasNext() && result.length < limit) {
    const file = files.next();
    result.push({
      name: boundedString_(file.getName(), 300),
      id: boundedString_(file.getId(), 150),
      mimeType: boundedString_(file.getMimeType(), 150),
      modifiedTime: file.getLastUpdated().toISOString()
    });
  }
  return { count: result.length, files: result };
}

function driveReadDoc_(p) {
  const docId = assertValidId_(p.documentId, "Document ID");
  const file = DriveApp.getFileById(docId);
  if (file.getMimeType() !== "application/vnd.google-apps.document") throw new Error("Only Google Docs can be read by this action.");
  const doc = DocumentApp.openById(docId);
  return { content: boundedString_(doc.getBody().getText(), 12000) };
}

function sheetsRead_(p) {
  const spreadsheetId = assertValidId_(p.spreadsheetId, "Spreadsheet ID");
  const sheetName = boundedString_(p.sheetName, 100) || "Sheet1";
  if (!/^[\p{L}\p{N} _.-]{1,100}$/.test(sheetName)) throw new Error("Invalid sheet name.");
  const range = boundedString_(p.range, 80) || "A1:Z40";
  const match = /^([A-Z]{1,3})([1-9]\d{0,6})(?::([A-Z]{1,3})([1-9]\d{0,6}))?$/i.exec(range);
  if (!match) throw new Error("Invalid A1 range.");
  const col = function(s) {
    let result = 0;
    for (let i = 0; i < s.length; i++) result = result * 26 + s.toUpperCase().charCodeAt(i) - 64;
    return result;
  };
  const c1 = col(match[1]), r1 = Number(match[2]);
  const c2 = match[3] ? col(match[3]) : c1, r2 = match[4] ? Number(match[4]) : r1;
  if (c2 < c1 || r2 < r1 || c2 - c1 + 1 > 20 || r2 - r1 + 1 > 40) throw new Error("Sheet range exceeds the limit.");
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) throw new Error("Sheet was not found.");
  const values = sheet.getRange(range.toUpperCase()).getValues();
  const safe = values.slice(0, 40).map(function(row) {
    return row.slice(0, 20).map(function(cell) {
      if (cell instanceof Date) return cell.toISOString();
      if (typeof cell === "string" || typeof cell === "number" || typeof cell === "boolean") return String(cell).slice(0, 500);
      return "";
    });
  });
  return { values: safe };
}
