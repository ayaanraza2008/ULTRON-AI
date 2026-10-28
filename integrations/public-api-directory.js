import { PUBLIC_API_DIRECTORY, PUBLIC_API_DIRECTORY_SOURCE } from "./public-api-directory-data.js";

const STOP_WORDS = new Set([
  "a", "an", "and", "api", "apis", "browse", "catalog", "directory", "find",
  "for", "from", "in", "list", "me", "of", "on", "or", "please", "public",
  "recommend", "search", "service", "services", "show", "the", "to", "what",
  "which", "with"
]);

function cleanText(value, max = 240) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function normalize(value) {
  return cleanText(value, 500).toLocaleLowerCase("en").replace(/[^a-z0-9+#.-]+/g, " ").trim();
}

function authStatus(value) {
  const auth = normalize(String(value || "").replace(/[*_]/g, "").replaceAll(String.fromCharCode(96), ""));
  if (!auth) return "unspecified";
  if (/^(no|none|no auth|no authentication|not required|public)$/.test(auth)) return "no_auth";
  return "requires_auth_or_provider_setup";
}

function selectedMetadata(entry) {
  const auth = cleanText(entry.auth, 100);
  const https = cleanText(entry.https, 80);
  const cors = cleanText(entry.cors, 80);
  const transport = cleanText(entry.transport, 100);
  const install = cleanText(entry.install, 240);
  return {
    name: cleanText(entry.name, 160),
    url: cleanText(entry.url, 500),
    description: cleanText(entry.description, 600),
    category: cleanText(entry.category, 120),
    auth: auth || "Not stated in the upstream catalog",
    authStatus: authStatus(auth),
    ...(https ? { https } : {}),
    ...(cors ? { cors } : {}),
    ...(transport ? { transport } : {}),
    ...(install ? { install } : {})
  };
}

/** Report the size and provenance of the locally bundled discovery catalog. */
export function getPublicApiDirectoryStats() {
  const categories = [...new Set(PUBLIC_API_DIRECTORY.map(item => item.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const authCounts = { no_auth: 0, requires_auth_or_provider_setup: 0, unspecified: 0 };
  for (const entry of PUBLIC_API_DIRECTORY) authCounts[authStatus(entry.auth)]++;
  return {
    entries: PUBLIC_API_DIRECTORY.length,
    categories: categories.length,
    categoryNames: categories,
    authCounts,
    source: {
      repository: PUBLIC_API_DIRECTORY_SOURCE.repository,
      file: PUBLIC_API_DIRECTORY_SOURCE.file,
      commit: PUBLIC_API_DIRECTORY_SOURCE.commit,
      license: PUBLIC_API_DIRECTORY_SOURCE.license
    },
    notice: "Directory metadata is for discovery only. Listings are not proof of availability, policy compatibility, security, or successful integration."
  };
}

/**
 * Search the bundled upstream API directory. Results are metadata only: this
 * function never calls a catalog URL, reads credentials, or executes returned instructions.
 */
export function searchPublicApiDirectory(args = {}) {
  const query = cleanText(args.query, 220);
  const categoryFilter = normalize(args.category || "");
  const authFilter = ["any", "no_auth", "requires_auth", "unknown"].includes(args.authFilter)
    ? args.authFilter
    : "any";
  const limit = Number.isInteger(args.limit) ? Math.max(1, Math.min(12, args.limit)) : 8;
  const phrase = normalize(query);
  const tokens = [...new Set(phrase.split(/\s+/).filter(token => token.length > 1 && !STOP_WORDS.has(token)))];

  const ranked = [];
  for (const entry of PUBLIC_API_DIRECTORY) {
    if (categoryFilter && !normalize(entry.category).includes(categoryFilter)) continue;
    const auth = authStatus(entry.auth);
    if (authFilter === "no_auth" && auth !== "no_auth") continue;
    if (authFilter === "requires_auth" && auth !== "requires_auth_or_provider_setup") continue;
    if (authFilter === "unknown" && auth !== "unspecified") continue;

    const name = normalize(entry.name);
    const description = normalize(entry.description);
    const category = normalize(entry.category);
    const url = normalize(entry.url);
    let score = 0;
    if (phrase && name === phrase) score += 30;
    if (phrase && name.includes(phrase)) score += 18;
    if (phrase && category.includes(phrase)) score += 9;
    if (phrase && description.includes(phrase)) score += 8;
    for (const token of tokens) {
      if (name.includes(token)) score += 8;
      if (category.includes(token)) score += 5;
      if (description.includes(token)) score += 3;
      if (url.includes(token)) score += 1;
    }
    if (!phrase && categoryFilter) score = 1;
    if (!phrase && !categoryFilter) continue;
    if (score > 0) ranked.push({ entry, score });
  }

  ranked.sort((left, right) =>
    right.score - left.score ||
    String(left.entry.category).localeCompare(String(right.entry.category)) ||
    String(left.entry.name).localeCompare(String(right.entry.name))
  );
  const results = ranked.slice(0, limit).map(({ entry }) => selectedMetadata(entry));
  const categoryCounts = new Map();
  for (const entry of PUBLIC_API_DIRECTORY) {
    if (!categoryFilter || normalize(entry.category).includes(categoryFilter)) {
      categoryCounts.set(entry.category, (categoryCounts.get(entry.category) || 0) + 1);
    }
  }
  const categories = [...categoryCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 15)
    .map(([name, count]) => ({ name, entries: count }));

  return {
    query: query || undefined,
    category: categoryFilter ? cleanText(args.category, 120) : undefined,
    authFilter,
    totalMatches: !phrase && !categoryFilter ? PUBLIC_API_DIRECTORY.length : ranked.length,
    results,
    ...(query ? {} : { popularCategories: categories }),
    source: {
      repository: PUBLIC_API_DIRECTORY_SOURCE.repository,
      commit: PUBLIC_API_DIRECTORY_SOURCE.commit,
      license: PUBLIC_API_DIRECTORY_SOURCE.license
    },
    notice: "These are upstream listings, not verified live integrations. ULTRON only executes separate fixed adapters or explicitly configured service connectors. Authentication labels describe catalog metadata, not usable API keys."
  };
}

/** Route only explicit catalog-discovery requests here; live data intents take precedence. */
export function inferPublicApiCatalogQuery(text) {
  const value = cleanText(text, 1200);
  if (!value) return null;
  const directoryPhrase = /\b(?:public[\s-]?apis?(?:\s+(?:catalog|directory|list))?|api\s+(?:catalog|directory)|catalog\s+of\s+apis?)\b/i.test(value);
  const queryPhrase = /\b(?:find|search|browse|recommend|list|show|what|which)\b.{0,100}\bapis?\b.{0,100}\b(?:for|about|related to|covering)\b/i.test(value);
  if (!directoryPhrase && !queryPhrase) return null;

  const topicMatch = value.match(/\b(?:apis?|services?)\s+(?:for|about|related to|covering|that handle|that support)\s+(.{2,200}?)(?=[?.!]|$)/i)
    || value.match(/\b(?:catalog|directory|list)\s+(?:for|about|covering)\s+(.{2,200}?)(?=[?.!]|$)/i);
  let query = topicMatch ? cleanText(topicMatch[1], 180) : "";
  query = query.replace(/\b(?:please|batao|dikhao|na|pls)\b/gi, " ").replace(/\s+/g, " ").trim();
  return { query };
}
