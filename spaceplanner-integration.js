// SpacePlanner-compatible plan generation for ULTRON's automatic design tool.
const EDITOR_URL = "https://spaceplanner.co/editor";
const MAX_DIMENSION_CM = 100000;

function positiveDimension(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 100 && n <= MAX_DIMENSION_CM ? Math.round(n) : fallback;
}

function roomNames(request) {
  const s = String(request || "").toLowerCase();
  const bedrooms = Math.max(1, Math.min(8, Number(s.match(/\b(\d+)\s*(?:bedrooms?|beds?)\b/)?.[1] || (s.includes("studio") ? 0 : 2))));
  const bathrooms = Math.max(1, Math.min(6, Number(s.match(/\b(\d+)\s*(?:bathrooms?|baths?|toilets?)\b/)?.[1] || Math.ceil(bedrooms / 2))));
  const rooms = ["Living room", "Kitchen"];
  for (let i = 1; i <= bedrooms; i++) rooms.push("Bedroom " + i);
  for (let i = 1; i <= bathrooms; i++) rooms.push("Bathroom " + i);
  if (/\b(dining|dining room)\b/.test(s)) rooms.push("Dining room");
  if (/\b(study|office|work room)\b/.test(s)) rooms.push("Study");
  if (/\b(garage|car parking)\b/.test(s)) rooms.push("Garage");
  return rooms.slice(0, 18);
}

export function createSpacePlannerPlan({ request, widthCm, heightCm, units = "cm" } = {}) {
  const description = typeof request === "string" ? request.trim().slice(0, 3000) : "";
  if (!description) throw Object.assign(new Error("Describe the floor plan you want."), { code: "SPACEPLANNER_REQUEST_REQUIRED" });
  const width = positiveDimension(widthCm, 1200);
  const height = positiveDimension(heightCm, 1000);
  const names = roomNames(description);
  const columns = Math.ceil(Math.sqrt(names.length));
  const rows = Math.ceil(names.length / columns);
  const rooms = names.map((name, index) => ({
    name,
    x: (index % columns) / columns,
    y: Math.floor(index / columns) / rows,
    w: 1 / columns,
    h: 1 / rows
  }));
  const plan = { plan_width_cm: width, plan_height_cm: height, rooms };
  return {
    provider: "spaceplanner",
    state: "plan_generated",
    editorUrl: EDITOR_URL,
    importMethod: "Open the editor, choose Import photo → Import SpacePlanner file, then paste planJson or save it as a .json file and open it.",
    request: description,
    dimensions: { widthCm: width, heightCm: height, units: ["cm", "m", "ft-in"].includes(units) ? units : "cm" },
    roomCount: rooms.length,
    planJson: plan,
    notice: "Generated a compatible starter layout, not a construction-ready architectural drawing. Review dimensions, circulation, structure, local codes, and accessibility before building."
  };
}

export function isSpacePlannerRequest(text) {
  const s = String(text || "").toLowerCase();
  return /\b(floor\s*plan|house\s*plan|home\s*plan|room\s*layout|space\s*planning|interior\s*layout|bedroom\s*layout|office\s*layout|architectural\s*plan|spaceplanner)\b/.test(s)
    && /\b(create|make|design|draw|build|generate|plan|layout|arrange|spaceplanner)\b/.test(s);
}
