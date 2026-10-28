import { safePinnedFetch } from "../network-safety.js";

const USER_AGENT = "ULTRON-AI/1.0 (https://github.com/ayaanraza2008/ULTRON-AI)";
const MAX_RESPONSE_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 9000;

const PUBLIC_API_CATALOG = Object.freeze([
  {
    id: "weather",
    name: "Weather and forecast",
    provider: "Open-Meteo",
    requiresApiKey: false,
    capabilities: ["current weather", "temperature", "wind", "humidity", "precipitation", "location geocoding"],
    terms: "Free for non-commercial use; attribute Open-Meteo under CC BY 4.0. Provider limits apply."
  },
  {
    id: "currency",
    name: "Currency exchange rates",
    provider: "Frankfurter",
    requiresApiKey: false,
    capabilities: ["latest published reference exchange rate", "amount conversion"],
    terms: "Rates are published reference data, not a live trading quote."
  },
  {
    id: "country",
    name: "Country information",
    provider: "World Bank Country API",
    requiresApiKey: false,
    capabilities: ["country name", "ISO country codes", "capital", "region", "income level", "coordinates"],
    terms: "Public country metadata endpoint; no API key required. Attribute the World Bank and note data limitations."
  },
  {
    id: "wikipedia",
    name: "Wikipedia article summary",
    provider: "Wikimedia",
    requiresApiKey: false,
    capabilities: ["encyclopedia summary", "article URL"],
    terms: "Attribute Wikipedia and respect the linked article's CC BY-SA terms."
  },
  {
    id: "books",
    name: "Book search",
    provider: "Open Library",
    requiresApiKey: false,
    capabilities: ["book titles", "authors", "first publication year", "edition counts"],
    terms: "Human-facing search only; respect Open Library usage guidelines and rate limits."
  },
  {
    id: "github_repo",
    name: "Public GitHub repository metadata",
    provider: "GitHub REST API",
    requiresApiKey: false,
    capabilities: ["public repository description", "language", "stars", "forks", "license", "last update"],
    terms: "Unauthenticated GitHub rate limits apply; private repository data is not queried."
  }
]);

function apiError(code, message, status = 502) {
  return Object.assign(new Error(message), { code, status });
}

function boundedQuery(value, max = 120) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeCurrency(value) {
  const result = String(value || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(result) ? result : "";
}

async function readTextLimited(response, maxBytes = MAX_RESPONSE_BYTES) {
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    try { await response.body?.cancel?.(); } catch {}
    throw apiError("PUBLIC_API_RESPONSE_TOO_LARGE", "The public API response exceeded ULTRON's size limit.", 502);
  }
  if (!response.body?.getReader) {
    throw apiError("PUBLIC_API_RESPONSE_UNBOUNDED", "The public API response could not be safely size-limited.", 502);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      totalBytes += part.value.byteLength;
      if (totalBytes > maxBytes) {
        try { await reader.cancel(); } catch {}
        throw apiError("PUBLIC_API_RESPONSE_TOO_LARGE", "The public API response exceeded ULTRON's size limit.", 502);
      }
      chunks.push(decoder.decode(part.value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}

async function requestJson(fetchImpl, url) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch {
    throw apiError("PUBLIC_API_UNAVAILABLE", "The selected public data service is temporarily unreachable.", 503);
  }
  if (!response?.ok) {
    if (response?.status === 404) throw apiError("PUBLIC_API_NOT_FOUND", "The public data service found no matching result.", 404);
    if (response?.status === 429) throw apiError("PUBLIC_API_RATE_LIMITED", "The public data service rate limit was reached. Try again later.", 429);
    throw apiError("PUBLIC_API_UPSTREAM_FAILED", "The selected public data service returned an error.", 502);
  }
  const raw = await readTextLimited(response);
  try {
    return JSON.parse(raw);
  } catch {
    throw apiError("PUBLIC_API_INVALID_JSON", "The selected public data service returned invalid JSON.", 502);
  }
}

function sourceRecord(id, extra = {}) {
  const service = PUBLIC_API_CATALOG.find(item => item.id === id);
  return {
    service: id,
    provider: service.provider,
    sourceUrl: {
      weather: "https://open-meteo.com/en/docs",
      currency: "https://frankfurter.dev/",
      country: "https://datahelpdesk.worldbank.org/knowledgebase/articles/898590-country-api-queries",
      wikipedia: "https://www.mediawiki.org/wiki/API:REST_API",
      books: "https://openlibrary.org/developers/api",
      github_repo: "https://docs.github.com/en/rest/repos/repos"
    }[id],
    attribution: service.terms,
    ...extra
  };
}

export function getPublicApiCatalog() {
  return PUBLIC_API_CATALOG.map(({ id, name, provider, requiresApiKey, capabilities, terms }) => ({
    id, name, provider, requiresApiKey, capabilities: [...capabilities], terms
  }));
}

export async function lookupPublicApi(args = {}, { fetchImpl = safePinnedFetch } = {}) {
  const service = boundedQuery(args.service, 40);
  if (!PUBLIC_API_CATALOG.some(item => item.id === service)) {
    throw apiError("PUBLIC_API_SERVICE_UNSUPPORTED", "Choose a supported public API service: weather, currency, country, wikipedia, books, or github_repo.", 400);
  }

  if (service === "weather") {
    const query = boundedQuery(args.query);
    if (query.length < 2) throw apiError("PUBLIC_API_QUERY_REQUIRED", "Provide a city, town, or place name for the weather lookup.", 400);
    const geocodeUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
    geocodeUrl.search = new URLSearchParams({ name: query, count: "1", language: "en", format: "json" }).toString();
    const geocoded = await requestJson(fetchImpl, geocodeUrl.toString());
    const place = Array.isArray(geocoded?.results) ? geocoded.results[0] : null;
    if (!place || !Number.isFinite(Number(place.latitude)) || !Number.isFinite(Number(place.longitude))) {
      throw apiError("PUBLIC_API_NOT_FOUND", "No matching place was found for the weather lookup.", 404);
    }
    const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
    forecastUrl.search = new URLSearchParams({
      latitude: String(place.latitude),
      longitude: String(place.longitude),
      current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m",
      timezone: "auto",
      forecast_days: "1"
    }).toString();
    const forecast = await requestJson(fetchImpl, forecastUrl.toString());
    return sourceRecord(service, {
      location: {
        name: boundedQuery(place.name, 120),
        region: boundedQuery(place.admin1, 120) || undefined,
        country: boundedQuery(place.country, 120) || undefined,
        latitude: Number(place.latitude),
        longitude: Number(place.longitude),
        timezone: boundedQuery(forecast?.timezone, 80) || undefined
      },
      current: forecast?.current && typeof forecast.current === "object" ? forecast.current : {},
      units: forecast?.current_units && typeof forecast.current_units === "object" ? forecast.current_units : {},
      observedAt: boundedQuery(forecast?.current?.time, 50) || undefined
    });
  }

  if (service === "currency") {
    const base = normalizeCurrency(args.baseCurrency);
    const quote = normalizeCurrency(args.quoteCurrency);
    const amount = args.amount === undefined ? 1 : Number(args.amount);
    if (!base || !quote) throw apiError("PUBLIC_API_CURRENCY_REQUIRED", "Provide valid three-letter baseCurrency and quoteCurrency codes, such as USD and INR.", 400);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000_000) {
      throw apiError("PUBLIC_API_AMOUNT_INVALID", "Amount must be a positive number no greater than 1,000,000,000,000.", 400);
    }
    const url = "https://api.frankfurter.dev/v2/rate/" + encodeURIComponent(base) + "/" + encodeURIComponent(quote);
    const rateData = await requestJson(fetchImpl, url);
    const rate = Number(rateData?.rate);
    if (!Number.isFinite(rate) || rate <= 0) throw apiError("PUBLIC_API_RATE_MISSING", "No reference rate was returned for that currency pair.", 404);
    return sourceRecord(service, {
      date: boundedQuery(rateData.date, 20) || undefined,
      base,
      quote,
      rate,
      amount,
      convertedAmount: Number((amount * rate).toFixed(6))
    });
  }

  if (service === "country") {
    const query = boundedQuery(args.query);
    if (query.length < 2) throw apiError("PUBLIC_API_QUERY_REQUIRED", "Provide a country name or ISO country code.", 400);
    const url = new URL("https://api.worldbank.org/v2/country");
    url.search = new URLSearchParams({ format: "json", per_page: "400" }).toString();
    const data = await requestJson(fetchImpl, url.toString());
    const queryLower = query.toLocaleLowerCase("en");
    const codeQuery = query.toUpperCase();
    const rows = Array.isArray(data?.[1]) ? data[1] : [];
    const matching = rows.filter(item => {
      const name = boundedQuery(item?.name, 120).toLocaleLowerCase("en");
      const iso2 = boundedQuery(item?.iso2Code, 2).toUpperCase();
      const iso3 = boundedQuery(item?.id, 3).toUpperCase();
      return name === queryLower || iso2 === codeQuery || iso3 === codeQuery || name.includes(queryLower);
    }).slice(0, 5);
    const countries = matching.map(item => {
      const latitude = item?.latitude !== "" && item?.latitude != null ? Number(item.latitude) : NaN;
      const longitude = item?.longitude !== "" && item?.longitude != null ? Number(item.longitude) : NaN;
      return {
        name: boundedQuery(item?.name, 120),
        code: boundedQuery(item?.id, 3) || undefined,
        iso2Code: boundedQuery(item?.iso2Code, 2) || undefined,
        capital: boundedQuery(item?.capitalCity, 120) || undefined,
        region: boundedQuery(item?.region?.value, 120) || undefined,
        incomeLevel: boundedQuery(item?.incomeLevel?.value, 120) || undefined,
        ...(Number.isFinite(latitude) ? { latitude } : {}),
        ...(Number.isFinite(longitude) ? { longitude } : {})
      };
    });
    if (!countries.length) throw apiError("PUBLIC_API_NOT_FOUND", "No matching country was found.", 404);
    return sourceRecord(service, { results: countries });
  }

  if (service === "wikipedia") {
    const query = boundedQuery(args.query);
    if (query.length < 2) throw apiError("PUBLIC_API_QUERY_REQUIRED", "Provide an article title or topic for Wikipedia.", 400);
    const title = query.replace(/\s+/g, "_");
    const url = "https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title);
    const data = await requestJson(fetchImpl, url);
    const pageUrl = data?.content_urls?.desktop?.page;
    return sourceRecord(service, {
      title: boundedQuery(data?.title, 240),
      description: boundedQuery(data?.description, 300) || undefined,
      summary: boundedQuery(data?.extract, 5000),
      url: typeof pageUrl === "string" && pageUrl.startsWith("https://en.wikipedia.org/") ? pageUrl : undefined
    });
  }

  if (service === "books") {
    const query = boundedQuery(args.query);
    if (query.length < 2) throw apiError("PUBLIC_API_QUERY_REQUIRED", "Provide a book title, author, or topic to search.", 400);
    const url = new URL("https://openlibrary.org/search.json");
    url.search = new URLSearchParams({
      q: query,
      limit: "5",
      fields: "key,title,author_name,first_publish_year,edition_count,cover_i"
    }).toString();
    const data = await requestJson(fetchImpl, url.toString());
    const results = (Array.isArray(data?.docs) ? data.docs : []).slice(0, 5).map(item => {
      const key = typeof item?.key === "string" && /^\/works\/OL[0-9]+W$/.test(item.key) ? item.key : "";
      return {
        title: boundedQuery(item?.title, 300),
        authors: Array.isArray(item?.author_name) ? item.author_name.slice(0, 5).map(x => boundedQuery(x, 120)) : [],
        firstPublished: Number.isInteger(item?.first_publish_year) ? item.first_publish_year : undefined,
        editionCount: Number.isInteger(item?.edition_count) ? item.edition_count : undefined,
        url: key ? "https://openlibrary.org" + key : undefined,
        coverUrl: Number.isInteger(item?.cover_i) && item.cover_i > 0 ? "https://covers.openlibrary.org/b/id/" + item.cover_i + "-M.jpg" : undefined
      };
    });
    return sourceRecord(service, { query, count: results.length, results });
  }

  if (service === "github_repo") {
    const query = boundedQuery(args.query, 220);
    const match = /^([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})$/.exec(query);
    if (!match) throw apiError("PUBLIC_API_QUERY_INVALID", "Provide a public repository in owner/repository format, such as openai/openai.", 400);
    const url = "https://api.github.com/repos/" + encodeURIComponent(match[1]) + "/" + encodeURIComponent(match[2]);
    const repo = await requestJson(fetchImpl, url);
    return sourceRecord(service, {
      repository: boundedQuery(repo?.full_name, 220),
      description: boundedQuery(repo?.description, 1000) || undefined,
      url: typeof repo?.html_url === "string" && repo.html_url.startsWith("https://github.com/") ? repo.html_url : undefined,
      language: boundedQuery(repo?.language, 80) || undefined,
      stars: Number.isFinite(Number(repo?.stargazers_count)) ? Number(repo.stargazers_count) : undefined,
      forks: Number.isFinite(Number(repo?.forks_count)) ? Number(repo.forks_count) : undefined,
      openIssues: Number.isFinite(Number(repo?.open_issues_count)) ? Number(repo.open_issues_count) : undefined,
      license: boundedQuery(repo?.license?.spdx_id, 60) || undefined,
      updatedAt: boundedQuery(repo?.updated_at, 40) || undefined
    });
  }

  throw apiError("PUBLIC_API_SERVICE_UNSUPPORTED", "The selected public API service is not supported.", 400);
}

export function inferPublicApiRequest(text) {
  const value = boundedQuery(text, 1200);
  if (!value) return null;

  const currency = value.match(/\b(?:(\d+(?:\.\d+)?)\s*)?([A-Z]{3})\s+(?:to|into)\s+([A-Z]{3})\b/i);
  if (currency && /\b(convert|currency|exchange rate|exchange|rate|how much|worth)\b/i.test(value)) {
    const baseCurrency = normalizeCurrency(currency[2]);
    const quoteCurrency = normalizeCurrency(currency[3]);
    if (baseCurrency && quoteCurrency) {
      return { service: "currency", baseCurrency, quoteCurrency, ...(currency[1] ? { amount: Number(currency[1]) } : {}) };
    }
  }

  const weather = value.match(/\b(?:weather|forecast|temperature|rainfall|wind speed)\b.{0,50}?\b(?:in|for|at)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .,'-]{1,80}?)(?=\s+(?:today|tomorrow|now|right now|please|batao|dikhao|kya|hai|pls)\b|[?.!,;]|$)/i);
  if (weather && !/\b(?:api|provider|endpoint|integration|documentation|key)\b/i.test(value)) {
    const query = boundedQuery(weather[1], 120);
    if (query.length >= 2) return { service: "weather", query };
  }

  const country = value.match(/\b(?:capital|population|currency|languages?|country info|country information)\s+(?:of|for|about)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .'-]{1,80}?)(?=[?.!,;]|$)/i);
  if (country) {
    const query = boundedQuery(country[1].replace(/\s+(?:please|batao|dikhao)$/i, ""), 120);
    if (query.length >= 2) return { service: "country", query };
  }

  const wiki = value.match(/\b(?:wikipedia|wiki)\s+(?:summary|page|about|for)?\s*[:\-]?\s*(.{2,100}?)(?=[?.!,;]|$)/i);
  if (wiki) return { service: "wikipedia", query: boundedQuery(wiki[1], 120) };

  const books = value.match(/\b(?:find books about|books about|book search|search books for|books on)\s+(.{2,100}?)(?=[?.!,;]|$)/i);
  if (books) return { service: "books", query: boundedQuery(books[1], 120) };

  const github = value.match(/\b(?:github repo|github repository|check github repo)\s+([A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100})\b/i);
  if (github) return { service: "github_repo", query: github[1] };

  return null;
}
