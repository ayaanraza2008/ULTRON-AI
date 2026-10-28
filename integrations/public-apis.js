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
  },
  {
    id: "sunrise_sunset",
    name: "Sunrise, sunset and moon data",
    provider: "Sunrise-Sunset.org",
    requiresApiKey: false,
    capabilities: ["sunrise", "sunset", "twilight", "golden hour", "moonrise", "moonset", "moon phase"],
    terms: "Free for reasonable use; visible attribution to Sunrise-Sunset.org is required."
  },
  {
    id: "ebooks",
    name: "Project Gutenberg ebook search",
    provider: "Gutendex",
    requiresApiKey: false,
    capabilities: ["public-domain ebook search", "authors", "subjects", "languages", "download links"],
    terms: "Metadata API for Project Gutenberg; ebook availability and copyright status vary by jurisdiction."
  },
  {
    id: "trivia",
    name: "Trivia question generator",
    provider: "Open Trivia Database",
    requiresApiKey: false,
    capabilities: ["general knowledge questions", "subject categories", "difficulty", "multiple choice", "true/false"],
    terms: "Content is licensed CC BY-SA 4.0; API rate limits apply (documented one request per 5 seconds per IP)."
  },
  {
    id: "earthquakes",
    name: "Recent earthquake activity",
    provider: "USGS Earthquake Hazards Program",
    requiresApiKey: false,
    capabilities: ["recent earthquake events", "magnitude", "place", "time", "coordinates", "event link"],
    terms: "Use USGS event feed data with source attribution; event catalogs can be revised."
  },
  {
    id: "dictionary",
    name: "Dictionary definitions and vocabulary",
    provider: "FreeDictionaryAPI.com",
    requiresApiKey: false,
    capabilities: ["word definitions", "parts of speech", "examples", "synonyms", "antonyms", "multilingual entries"],
    terms: "Wiktionary-derived content is CC BY-SA 4.0; attribute FreeDictionaryAPI.com and link the original Wiktionary source. Rate limit: 1,000 requests/hour per IP."
  },
  {
    id: "news",
    name: "Public news search",
    provider: "GDELT DOC 2.0",
    requiresApiKey: false,
    capabilities: ["recent news articles", "titles", "source domains", "publication-seen time", "article links"],
    terms: "News coverage is not exhaustive. Verify important claims against the linked publisher source."
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
      github_repo: "https://docs.github.com/en/rest/repos/repos",
      sunrise_sunset: "https://sunrise-sunset.org/api",
      ebooks: "https://gutendex.com/",
      trivia: "https://opentdb.com/api_config.php",
      earthquakes: "https://earthquake.usgs.gov/data/software/",
      dictionary: "https://freedictionaryapi.com/",
      news: "https://api.gdeltproject.org/api/v2/doc/doc"
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


  if (service === "sunrise_sunset") {
    const query = boundedQuery(args.query);
    if (query.length < 2) throw apiError("PUBLIC_API_QUERY_REQUIRED", "Provide a city or place name for sunrise/sunset times.", 400);
    const date = boundedQuery(args.date, 10);
    if (date && date !== "today" && date !== "tomorrow" && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw apiError("PUBLIC_API_DATE_INVALID", "Provide a date as YYYY-MM-DD, today, or tomorrow.", 400);
    }
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isNaN(Date.parse(date + "T00:00:00Z"))) {
      throw apiError("PUBLIC_API_DATE_INVALID", "Provide a valid calendar date.", 400);
    }
    const geocodeUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
    geocodeUrl.search = new URLSearchParams({ name: query, count: "1", language: "en", format: "json" }).toString();
    const geocoded = await requestJson(fetchImpl, geocodeUrl.toString());
    const place = Array.isArray(geocoded?.results) ? geocoded.results[0] : null;
    if (!place || !Number.isFinite(Number(place.latitude)) || !Number.isFinite(Number(place.longitude))) {
      throw apiError("PUBLIC_API_NOT_FOUND", "No matching place was found for sunrise/sunset times.", 404);
    }
    const url = new URL("https://api.sunrise-sunset.org/v2");
    const params = { lat: String(place.latitude), lng: String(place.longitude), time_format: "iso8601" };
    if (date) params.date = date;
    url.search = new URLSearchParams(params).toString();
    const solar = await requestJson(fetchImpl, url.toString());
    if (solar?.status && solar.status !== "OK") throw apiError("PUBLIC_API_UPSTREAM_FAILED", "Sunrise-Sunset.org could not calculate data for this place/date.", 502);
    return sourceRecord(service, {
      location: { name: boundedQuery(place.name, 120), region: boundedQuery(place.admin1, 120) || undefined, country: boundedQuery(place.country, 120) || undefined, latitude: Number(place.latitude), longitude: Number(place.longitude) },
      date: boundedQuery(solar?.date, 20) || date || undefined,
      timezone: boundedQuery(solar?.tzid, 80) || undefined,
      sunrise: boundedQuery(solar?.sunrise, 50) || undefined,
      sunset: boundedQuery(solar?.sunset, 50) || undefined,
      solarNoon: boundedQuery(solar?.solar_noon, 50) || undefined,
      dayLengthSeconds: Number.isFinite(Number(solar?.day_length)) ? Number(solar.day_length) : undefined,
      dawn: boundedQuery(solar?.civil_twilight_begin, 50) || undefined,
      dusk: boundedQuery(solar?.civil_twilight_end, 50) || undefined,
      moonrise: boundedQuery(solar?.moonrise, 50) || undefined,
      moonset: boundedQuery(solar?.moonset, 50) || undefined,
      moonPhase: boundedQuery(solar?.moon_phase, 60) || undefined,
      moonIlluminationPercent: Number.isFinite(Number(solar?.moon_illumination)) ? Number(solar.moon_illumination) : undefined,
      attribution: "Sun data by Sunrise-Sunset.org"
    });
  }

  if (service === "ebooks") {
    const query = boundedQuery(args.query);
    if (query.length < 2) throw apiError("PUBLIC_API_QUERY_REQUIRED", "Provide a title, author, subject, or topic to search Project Gutenberg books.", 400);
    const url = new URL("https://gutendex.com/books/");
    url.search = new URLSearchParams({ search: query }).toString();
    const data = await requestJson(fetchImpl, url.toString());
    const results = (Array.isArray(data?.results) ? data.results : []).slice(0, 8).map(book => {
      const authors = Array.isArray(book?.authors) ? book.authors.slice(0, 5).map(author => ({
        name: boundedQuery(author?.name, 160),
        birthYear: Number.isInteger(author?.birth_year) ? author.birth_year : undefined,
        deathYear: Number.isInteger(author?.death_year) ? author.death_year : undefined
      })) : [];
      const formats = book?.formats && typeof book.formats === "object" ? book.formats : {};
      const textUrl = [formats["text/html"], formats["text/html; charset=utf-8"], formats["application/epub+zip"], formats["text/plain; charset=utf-8"], formats["text/plain"]]
        .find(value => typeof value === "string" && value.startsWith("https://www.gutenberg.org/"));
      return {
        id: Number.isInteger(book?.id) ? book.id : undefined,
        title: boundedQuery(book?.title, 300),
        authors,
        languages: Array.isArray(book?.languages) ? book.languages.slice(0, 8).map(x => boundedQuery(x, 15)) : [],
        subjects: Array.isArray(book?.subjects) ? book.subjects.slice(0, 8).map(x => boundedQuery(x, 180)) : [],
        downloadCount: Number.isFinite(Number(book?.download_count)) ? Number(book.download_count) : undefined,
        copyright: typeof book?.copyright === "boolean" ? book.copyright : null,
        downloadUrl: textUrl || undefined
      };
    });
    return sourceRecord(service, { query, totalMatches: Number.isFinite(Number(data?.count)) ? Number(data.count) : results.length, results });
  }

  if (service === "trivia") {
    const amount = args.amount === undefined ? 5 : Number(args.amount);
    if (!Number.isInteger(amount) || amount < 1 || amount > 10) {
      throw apiError("PUBLIC_API_AMOUNT_INVALID", "Trivia amount must be an integer from 1 to 10.", 400);
    }
    const difficulty = boundedQuery(args.difficulty, 20).toLowerCase();
    if (difficulty && !["easy", "medium", "hard"].includes(difficulty)) {
      throw apiError("PUBLIC_API_DIFFICULTY_INVALID", "Trivia difficulty must be easy, medium, or hard.", 400);
    }
    const categoryId = Number.isInteger(args.categoryId) ? args.categoryId : undefined;
    if (categoryId !== undefined && (categoryId < 9 || categoryId > 32)) {
      throw apiError("PUBLIC_API_CATEGORY_INVALID", "Open Trivia Database categoryId must be from 9 to 32.", 400);
    }
    const url = new URL("https://opentdb.com/api.php");
    const params = { amount: String(amount), encode: "base64" };
    if (difficulty) params.difficulty = difficulty;
    if (categoryId !== undefined) params.category = String(categoryId);
    if (["multiple", "boolean"].includes(args.questionType)) params.type = args.questionType;
    url.search = new URLSearchParams(params).toString();
    const data = await requestJson(fetchImpl, url.toString());
    if (Number(data?.response_code) !== 0) {
      const messages = {
        1: "There are not enough trivia questions for those filters.",
        2: "The trivia request contains invalid parameters.",
        3: "The trivia service did not recognize its session token.",
        4: "The trivia service has exhausted questions for this session.",
        5: "The trivia service rate limit was reached; wait at least five seconds before retrying."
      };
      throw apiError(Number(data?.response_code) === 5 ? "PUBLIC_API_RATE_LIMITED" : "PUBLIC_API_TRIVIA_EMPTY", messages[Number(data?.response_code)] || "The trivia service could not return questions.", Number(data?.response_code) === 5 ? 429 : 502);
    }
    const decode = value => {
      if (typeof value !== "string") return "";
      try { return Buffer.from(value, "base64").toString("utf8").slice(0, 1000); }
      catch { return ""; }
    };
    const results = (Array.isArray(data?.results) ? data.results : []).slice(0, amount).map(item => ({
      category: decode(item?.category),
      type: boundedQuery(item?.type, 20),
      difficulty: boundedQuery(item?.difficulty, 20),
      question: decode(item?.question),
      correctAnswer: decode(item?.correct_answer),
      incorrectAnswers: Array.isArray(item?.incorrect_answers) ? item.incorrect_answers.slice(0, 4).map(decode) : []
    }));
    return sourceRecord(service, { amount: results.length, categoryId: categoryId ?? null, difficulty: difficulty || "any", results, attribution: "Open Trivia Database — CC BY-SA 4.0" });
  }

  if (service === "earthquakes") {
    const period = ["hour", "day", "week"].includes(args.period) ? args.period : "day";
    const significant = args.significant === true;
    const minMagnitude = args.minMagnitude === undefined ? 0 : Number(args.minMagnitude);
    if (!Number.isFinite(minMagnitude) || minMagnitude < 0 || minMagnitude > 10) {
      throw apiError("PUBLIC_API_MAGNITUDE_INVALID", "minMagnitude must be between 0 and 10.", 400);
    }
    const feedName = (significant ? "significant_" : "all_") + period;
    const url = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/" + feedName + ".geojson";
    const data = await requestJson(fetchImpl, url);
    const features = Array.isArray(data?.features) ? data.features : [];
    const results = features.filter(item => Number(item?.properties?.mag ?? 0) >= minMagnitude).slice(0, 12).map(item => {
      const coordinates = Array.isArray(item?.geometry?.coordinates) ? item.geometry.coordinates : [];
      const eventUrl = typeof item?.properties?.url === "string" && item.properties.url.startsWith("https://earthquake.usgs.gov/") ? item.properties.url : undefined;
      return {
        id: boundedQuery(item?.id, 80),
        magnitude: Number.isFinite(Number(item?.properties?.mag)) ? Number(item.properties.mag) : null,
        place: boundedQuery(item?.properties?.place, 240),
        time: Number.isFinite(Number(item?.properties?.time)) ? new Date(Number(item.properties.time)).toISOString() : undefined,
        updatedAt: Number.isFinite(Number(item?.properties?.updated)) ? new Date(Number(item.properties.updated)).toISOString() : undefined,
        depthKm: Number.isFinite(Number(coordinates[2])) ? Number(coordinates[2]) : undefined,
        longitude: Number.isFinite(Number(coordinates[0])) ? Number(coordinates[0]) : undefined,
        latitude: Number.isFinite(Number(coordinates[1])) ? Number(coordinates[1]) : undefined,
        url: eventUrl
      };
    });
    return sourceRecord(service, { period, significantOnly: significant, minMagnitude, totalInFeed: features.length, matchingEvents: results.length, events: results, notice: "Preliminary earthquake catalog data can be updated as new reports are reviewed." });
  }


  if (service === "dictionary") {
    const word = boundedQuery(args.query, 100);
    if (!/^[\p{L}\p{M}'’-]{1,80}$/u.test(word)) {
      throw apiError("PUBLIC_API_WORD_INVALID", "Provide a single word using letters, apostrophes, or hyphens.", 400);
    }
    const language = boundedQuery(args.language || "en", 12).toLowerCase();
    if (!/^(?:[a-z]{2,3}|all)$/.test(language)) throw apiError("PUBLIC_API_LANGUAGE_INVALID", "Provide a 2- or 3-letter language code.", 400);
    const url = "https://freedictionaryapi.com/api/v1/entries/" + encodeURIComponent(language) + "/" + encodeURIComponent(word);
    const data = await requestJson(fetchImpl, url);
    const entries = (Array.isArray(data?.entries) ? data.entries : []).slice(0, 6).map(entry => ({
      language: {
        code: boundedQuery(entry?.language?.code, 12),
        name: boundedQuery(entry?.language?.name, 80)
      },
      partOfSpeech: boundedQuery(entry?.partOfSpeech, 40),
      pronunciations: Array.isArray(entry?.pronunciations) ? entry.pronunciations.slice(0, 3).map(item => ({
        type: boundedQuery(item?.type, 30),
        text: boundedQuery(item?.text, 100)
      })) : [],
      definitions: (Array.isArray(entry?.senses) ? entry.senses : []).slice(0, 5).map(sense => ({
        definition: boundedQuery(sense?.definition, 800),
        examples: Array.isArray(sense?.examples) ? sense.examples.slice(0, 3).map(item => boundedQuery(item, 300)) : [],
        synonyms: Array.isArray(sense?.synonyms) ? sense.synonyms.slice(0, 8).map(item => boundedQuery(item, 80)) : [],
        antonyms: Array.isArray(sense?.antonyms) ? sense.antonyms.slice(0, 8).map(item => boundedQuery(item, 80)) : []
      })),
      synonyms: [...new Set([...(Array.isArray(entry?.synonyms) ? entry.synonyms : []), ...(Array.isArray(entry?.senses) ? entry.senses.flatMap(sense => Array.isArray(sense?.synonyms) ? sense.synonyms : []) : [])].map(item => boundedQuery(item, 80)).filter(Boolean))].slice(0, 10),
      antonyms: [...new Set([...(Array.isArray(entry?.antonyms) ? entry.antonyms : []), ...(Array.isArray(entry?.senses) ? entry.senses.flatMap(sense => Array.isArray(sense?.antonyms) ? sense.antonyms : []) : [])].map(item => boundedQuery(item, 80)).filter(Boolean))].slice(0, 10)
    }));
    const originalUrl = typeof data?.source?.url === "string" && data.source.url.startsWith("https://en.wiktionary.org/") ? data.source.url : undefined;
    const license = boundedQuery(data?.source?.license?.name, 80) || "CC BY-SA 4.0";
    return sourceRecord(service, {
      word: boundedQuery(data?.word || word, 100),
      entries,
      wiktionarySourceUrl: originalUrl,
      contentLicense: license,
      attribution: "Dictionary data sourced from Wiktionary (CC BY-SA 4.0), via FreeDictionaryAPI.com"
    });
  }

  if (service === "news") {
    const query = boundedQuery(args.query, 220);
    if (query.length < 3) throw apiError("PUBLIC_API_QUERY_REQUIRED", "Provide at least three characters for news search.", 400);
    const period = args.period === "week" ? "7d" : args.period === "hour" ? "1h" : "1d";
    const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
    url.search = new URLSearchParams({
      query,
      mode: "ArtList",
      format: "json",
      maxrecords: "10",
      sort: "HybridRel",
      timespan: period
    }).toString();
    const data = await requestJson(fetchImpl, url.toString());
    const articles = (Array.isArray(data?.articles) ? data.articles : []).slice(0, 10).map(article => ({
      title: boundedQuery(article?.title, 400),
      url: typeof article?.url === "string" && article.url.startsWith("https://") ? article.url : undefined,
      domain: boundedQuery(article?.domain, 120),
      language: boundedQuery(article?.language, 40),
      sourceCountry: boundedQuery(article?.sourcecountry, 60),
      seenAt: boundedQuery(article?.seendate, 40)
    })).filter(article => article.title && article.url);
    return sourceRecord(service, {
      query,
      timespan: period,
      totalArticlesReturned: articles.length,
      articles,
      notice: "GDELT provides best-effort coverage; a returned article is not proof that every claim in its headline or article is true."
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

  const solar = value.match(/\b(?:sunrise|sunset|golden hour|moonrise|moonset)\b.{0,50}?\b(?:in|for|at)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .,'-]{1,80}?)(?=\s+(?:today|tomorrow|please|batao|dikhao|kya|hai|pls)\b|[?.!,;]|$)/i);
  if (solar) {
    const query = boundedQuery(solar[1], 120);
    const dateMatch = value.match(/\b(today|tomorrow|\d{4}-\d{2}-\d{2})\b/i);
    if (query.length >= 2) return { service: "sunrise_sunset", query, ...(dateMatch ? { date: dateMatch[1] } : {}) };
  }

  if (/\b(?:public[- ]domain|project gutenberg|gutendex|ebook search|free ebooks)\b/i.test(value)) {
    const ebook = value.match(/\b(?:books?|ebooks?)\s+(?:about|on|for|named|called)\s+(.{2,100}?)(?=[?.!,;]|$)/i)
      || value.match(/\b(?:search|find)\s+(?:project gutenberg|gutendex)?\s*(?:books?|ebooks?)?\s*(?:about|on|for)\s+(.{2,100}?)(?=[?.!,;]|$)/i);
    const query = ebook ? boundedQuery(ebook[1], 120) : "public domain classics";
    if (query.length >= 2) return { service: "ebooks", query };
  }

  if (/\b(?:trivia|quiz questions?|general knowledge quiz)\b/i.test(value) && !/\b(?:api|provider|endpoint|documentation|integration)\b/i.test(value)) {
    const amountMatch = value.match(/\b(\d{1,2})\s+(?:trivia\s+)?questions?\b/i);
    const categoryMap = [
      [17, /\b(science|nature)\b/i], [18, /\b(computer|computers|technology|computing)\b/i],
      [19, /\b(math|mathematics)\b/i], [20, /\b(mythology)\b/i], [21, /\b(sports?)\b/i],
      [22, /\b(geography|maps?)\b/i], [23, /\b(history)\b/i], [24, /\b(politics|political)\b/i],
      [25, /\b(art|arts)\b/i], [26, /\b(celebrities|celebrity)\b/i], [27, /\b(animals?)\b/i],
      [28, /\b(vehicles?|cars?)\b/i], [29, /\b(comics?)\b/i], [30, /\b(gadgets?)\b/i],
      [31, /\b(anime|manga)\b/i], [32, /\b(cartoon|cartoons|animation)\b/i],
      [10, /\b(books|literature)\b/i], [11, /\b(films?|movies?)\b/i],
      [12, /\b(music)\b/i], [14, /\b(television|tv)\b/i], [15, /\b(video games?|gaming)\b/i],
      [16, /\b(board games?)\b/i], [9, /\b(general knowledge|general trivia)\b/i]
    ];
    const category = categoryMap.find(([, pattern]) => pattern.test(value));
    const difficulty = value.match(/\b(easy|medium|hard)\b/i)?.[1]?.toLowerCase();
    return { service: "trivia", amount: amountMatch ? Math.max(1, Math.min(10, Number(amountMatch[1]))) : 5, ...(category ? { categoryId: category[0] } : {}), ...(difficulty ? { difficulty } : {}) };
  }

  if (/\b(?:recent|latest|show|list|any|earthquake activity|seismic activity|earthquakes today|earthquakes in the last)\b.{0,70}\b(?:earthquakes?|seismic)\b|\b(?:recent|latest|show|list)\s+earthquakes?\b/i.test(value)) {
    const period = /\b(hour|hourly|last hour)\b/i.test(value) ? "hour" : /\b(week|weekly|last week)\b/i.test(value) ? "week" : "day";
    const magnitude = value.match(/\b(?:magnitude|mag|above|over|greater than)\s*(?:of\s*)?(\d(?:\.\d)?)\b/i);
    const significant = /\b(significant|major)\b/i.test(value);
    return { service: "earthquakes", period, ...(magnitude ? { minMagnitude: Number(magnitude[1]) } : {}), ...(significant ? { significant: true } : {}) };
  }


  if (/\b(?:define|definition of|meaning of|dictionary|synonyms? for|antonyms? for|what does .{1,70} mean)\b/i.test(value) && !/\b(?:api|provider|endpoint|documentation|integration)\b/i.test(value)) {
    const wordMatch = value.match(/\b(?:define|definition of|meaning of|dictionary(?: entry)? for|synonyms? for|antonyms? for|what does)\s+["“]?([\p{L}\p{M}'’-]{1,80})/iu);
    if (wordMatch) return { service: "dictionary", query: wordMatch[1] };
  }

  if (/\b(?:news|headlines|latest updates|recent articles|news search|what is happening about)\b/i.test(value) && !/\b(?:api|provider|endpoint|documentation|integration)\b/i.test(value)) {
    const newsMatch = value.match(/\b(?:news|headlines|articles|updates)\s+(?:about|on|for|regarding)\s+(.{3,160}?)(?=[?.!,;]|$)/i)
      || value.match(/\b(?:search|find|show)\s+(?:the\s+)?(?:news|headlines|articles)\s+(?:about|on|for)\s+(.{3,160}?)(?=[?.!,;]|$)/i);
    if (newsMatch) {
      const period = /\b(last hour|past hour|hourly)\b/i.test(value) ? "hour" : /\b(last week|past week|weekly)\b/i.test(value) ? "week" : "day";
      return { service: "news", query: boundedQuery(newsMatch[1], 200), period };
    }
  }

  return null;
}
