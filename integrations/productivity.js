/**
 * ULTRON AI — Personal Assistant & Productivity Suite
 *
 * Implements calendar event management, reminders, personal notes,
 * and automated JARVIS daily briefings.
 */

export class ProductivitySuite {
  constructor(options = {}) {
    this.events = [];
    this.reminders = [];
    this.notes = [];
  }

  // --- Reminders ---
  addReminder({ title, dueDate = null, priority = "normal" }) {
    if (!title) throw new Error("Reminder title is required.");
    const reminder = {
      id: "rem-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      title: String(title).slice(0, 160),
      dueDate: dueDate ? new Date(dueDate).toISOString() : null,
      priority,
      completed: false,
      createdAt: new Date().toISOString()
    };
    this.reminders.push(reminder);
    return reminder;
  }

  completeReminder(reminderId) {
    const reminder = this.reminders.find(r => r.id === reminderId);
    if (!reminder) return false;
    reminder.completed = true;
    reminder.completedAt = new Date().toISOString();
    return true;
  }

  listReminders(includeCompleted = false) {
    return includeCompleted ? this.reminders : this.reminders.filter(r => !r.completed);
  }

  // --- Calendar Events ---
  addEvent({ title, startTime, endTime = null, location = null }) {
    if (!title || !startTime) throw new Error("Event title and startTime are required.");
    const event = {
      id: "evt-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      title: String(title).slice(0, 200),
      startTime: new Date(startTime).toISOString(),
      endTime: endTime ? new Date(endTime).toISOString() : null,
      location: location ? String(location).slice(0, 100) : null,
      createdAt: new Date().toISOString()
    };
    this.events.push(event);
    return event;
  }

  listEvents() {
    return [...this.events].sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  }

  // --- Personal Notes ---
  addNote({ title, content, tags = [] }) {
    const note = {
      id: "note-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      title: String(title || "Untitled Note").slice(0, 160),
      content: String(content || "").slice(0, 10_000),
      tags: Array.isArray(tags) ? tags.map(t => String(t).slice(0, 40)) : [],
      updatedAt: new Date().toISOString()
    };
    this.notes.unshift(note);
    return note;
  }

  searchNotes(query) {
    const q = String(query).toLowerCase().trim();
    if (!q) return this.notes;
    return this.notes.filter(n => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q) || n.tags.some(t => t.toLowerCase().includes(q)));
  }

  /**
   * Daily Briefing Generator (JARVIS Style)
   */
  generateDailyBriefing(options = {}) {
    const pendingReminders = this.listReminders(false);
    const upcomingEvents = this.listEvents();
    const systemTelemetry = options.telemetry || null;

    let greeting = "Good day, sir. Here is your daily operational summary.";
    const hour = new Date().getHours();
    if (hour < 12) greeting = "Good morning, sir. All core systems are online.";
    else if (hour > 18) greeting = "Good evening, sir. Here is your end-of-day digest.";

    return {
      greeting,
      timestamp: new Date().toISOString(),
      pendingRemindersCount: pendingReminders.length,
      upcomingEventsCount: upcomingEvents.length,
      reminders: pendingReminders.slice(0, 5),
      events: upcomingEvents.slice(0, 5),
      systemTelemetry: systemTelemetry ? {
        cpuCores: systemTelemetry.cpuCores,
        ramUsedPercent: systemTelemetry.memory?.usedPercent,
        memoryPressure: systemTelemetry.memory?.memoryPressureWarning
      } : null,
      spokenSummary: `${greeting} You have ${pendingReminders.length} pending reminders and ${upcomingEvents.length} scheduled events today.`
    };
  }
}
