export function searchItems(items, query) {
  const normalizedQuery = String(query ?? "").trim().toLocaleLowerCase();
  if (!normalizedQuery) return [];
  return items.filter(item =>
    String(item.title ?? "").toLocaleLowerCase().includes(normalizedQuery)
  );
}

export function formatSearchResults(items) {
  return items.map((item, index) => ({
    position: index + 1,
    title: item.title,
    summary: item.summary ?? ""
  }));
}
