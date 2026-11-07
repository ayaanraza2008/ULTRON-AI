// Minimal, inert JavaScript application fixture for the REA MCP startup self-test.
// REA analyzes this source statically; the gateway never executes the target app.
export const SEARCH_RESULTS_FEATURE = "search results";

const catalog = Object.freeze([
  Object.freeze({ id: "demo-1", title: "Example result", tags: ["demo", "search"] }),
  Object.freeze({ id: "demo-2", title: "Another example", tags: ["sample", "search"] })
]);

export function searchCatalog(query = "") {
  const normalized = String(query).trim().toLowerCase();
  return catalog.filter(item =>
    item.title.toLowerCase().includes(normalized) ||
    item.tags.some(tag => tag.includes(normalized))
  );
}

export function renderSearchResults(query) {
  const results = searchCatalog(query);
  return {
    feature: SEARCH_RESULTS_FEATURE,
    count: results.length,
    items: results.map(({ id, title }) => ({ id, title }))
  };
}
