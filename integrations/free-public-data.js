import { safePinnedFetch } from "../network-safety.js";

const MAX_RESPONSE_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const OPEN_METEO_GEOCODING = "https://geocoding-api.open-meteo.com/v1/search";
const OPEN_METEO_FORECAST = "https://api.open-meteo.com/v1/forecast";
const FRANKFURTER_RATES = "https://api.frankfurter.dev/v2/rates";

function apiError(code, message, status = 502) {
  return Object.assign(new Error(message), { code, status });
}

function cleanString(value, max = 160) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().replace(/\s+/g, " ").slice(0, max)
    : "";
}

async function readJsonLimited(response) {
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    try { await response.body?.cancel?.(); } catch {}
    throw apiError("FREE_PUBLIC_API_RESPONSE_TOO_LARGE", "The free public-data provider returned an oversized response.");
  }
  const reader = response.body?.getReader?.();
  if (!reader) throw apiError("FREE_PUBLIC_API_UNSAFE_RESPONSE", "The free public-data provider response could not be safely bounded.");
  let raw = "";
  let total = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        try { await reader.cancel(); } catch {}
        throw apiError("FREE_PUBLIC_API_RESPONSE_TOO_LARGE", "The free public-data provider returned an oversized response.");
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  try { return JSON.parse(raw); }
  catch { throw apiError("FREE_PUBLIC_API_INVALID_RESPONSE", "The free public-data provider returned invalid JSON."); }
}

async function getJson(url, { fetchImpl, provider }) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": "ULTRON-AI/1.0 (free public-data adapter)" },
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch {
    throw apiError("FREE_PUBLIC_API_UNAVAILABLE", provider + " is temporarily unavailable.");
  }
  if (!response?.ok) {
    const status = Number(response?.status) || 0;
    try { await response?.body?.cancel?.(); } catch {}
    if (status === 429) throw apiError("FREE_PUBLIC_API_RATE_LIMITED", provider + " rate-limited the request.", 429);
    throw apiError("FREE_PUBLIC_API_UNAVAILABLE", provider + " could not complete the request.");
  }
  return readJsonLimited(response);
}

const WEATHER_CODES = new Map([
  [0, "Clear sky"], [1, "Mainly clear"], [2, "Partly cloudy"], [3, "Overcast"],
  [45, "Fog"], [48, "Depositing rime fog"],
  [51, "Light drizzle"], [53, "Moderate drizzle"], [55, "Dense drizzle"],
  [56, "Light freezing drizzle"], [57, "Dense freezing drizzle"],
  [61, "Slight rain"], [63, "Moderate rain"], [65, "Heavy rain"],
  [66, "Light freezing rain"], [67, "Heavy freezing rain"],
  [71, "Slight snow"], [73, "Moderate snow"], [75, "Heavy snow"], [77, "Snow grains"],
  [80, "Slight rain showers"], [81, "Moderate rain showers"], [82, "Violent rain showers"],
  [85, "Slight snow showers"], [86, "Heavy snow showers"],
  [95, "Thunderstorm"], [96, "Thunderstorm with slight hail"], [99, "Thunderstorm with heavy hail"]
]);

async function getWeather(location, fetchImpl) {
  const place = cleanString(location, 100);
  if (place.length < 2) throw apiError("FREE_PUBLIC_WEATHER_LOCATION_REQUIRED", "Give a place name for the weather lookup.", 400);

  const geocodingUrl = new URL(OPEN_METEO_GEOCODING);
  geocodingUrl.searchParams.set("name", place);
  geocodingUrl.searchParams.set("count", "1");
  geocodingUrl.searchParams.set("language", "en");
  geocodingUrl.searchParams.set("format", "json");
  const geocoding = await getJson(geocodingUrl.toString(), { fetchImpl, provider: "Open-Meteo geocoding" });
  const result = Array.isArray(geocoding?.results) ? geocoding.results[0] : null;
  if (!result) throw apiError("FREE_PUBLIC_WEATHER_LOCATION_NOT_FOUND", "No matching location was found. Try a more specific city or region.", 404);
  const latitude = Number(result.latitude);
  const longitude = Number(result.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw apiError("FREE_PUBLIC_API_INVALID_RESPONSE", "The geocoding provider returned invalid coordinates.");
  }

  const forecastUrl = new URL(OPEN_METEO_FORECAST);
  forecastUrl.searchParams.set("latitude", String(latitude));
  forecastUrl.searchParams.set("longitude", String(longitude));
  forecastUrl.searchParams.set("current", "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m");
  forecastUrl.searchParams.set("timezone", "auto");
  const forecast = await getJson(forecastUrl.toString(), { fetchImpl, provider: "Open-Meteo weather" });
  const current = forecast?.current;
  if (!current || !Number.isFinite(current.temperature_2m) || !Number.isFinite(current.weather_code)) {
    throw apiError("FREE_PUBLIC_API_INVALID_RESPONSE", "Open-Meteo did not return valid current weather fields.");
  }

  return {
    kind: "weather",
    location: {
      name: cleanString(result.name, 100),
      region: cleanString(result.admin1, 100) || null,
      country: cleanString(result.country, 100) || null,
      latitude,
      longitude
    },
    current: {
      time: cleanString(current.time, 40) || null,
      timezone: cleanString(forecast.timezone, 80) || cleanString(result.timezone, 80) || null,
      temperatureC: current.temperature_2m,
      feelsLikeC: Number.isFinite(current.apparent_temperature) ? current.apparent_temperature : null,
      relativeHumidityPercent: Number.isFinite(current.relative_humidity_2m) ? current.relative_humidity_2m : null,
      precipitationMm: Number.isFinite(current.precipitation) ? current.precipitation : null,
      windSpeedKmh: Number.isFinite(current.wind_speed_10m) ? current.wind_speed_10m : null,
      weatherCode: current.weather_code,
      conditions: WEATHER_CODES.get(current.weather_code) || "Unmapped weather code",
      isDay: Number.isFinite(current.is_day) ? current.is_day === 1 : null
    },
    source: "Open-Meteo",
    sourceUrl: "https://open-meteo.com/",
    attribution: "Weather data by Open-Meteo.com (CC BY 4.0).",
    usageNotice: "The free Open-Meteo API is for non-commercial use; review its current terms before commercial use."
  };
}

async function getCurrency({ amount = 1, from, to }, fetchImpl) {
  const sourceCurrency = cleanString(from, 3).toUpperCase();
  const targetCurrency = cleanString(to, 3).toUpperCase();
  const numericAmount = Number(amount);
  if (!/^[A-Z]{3}$/.test(sourceCurrency) || !/^[A-Z]{3}$/.test(targetCurrency)) {
    throw apiError("FREE_PUBLIC_CURRENCY_CODES_INVALID", "Provide valid three-letter currency codes, for example USD and INR.", 400);
  }
  if (!Number.isFinite(numericAmount) || numericAmount < 0 || numericAmount > 1_000_000_000_000) {
    throw apiError("FREE_PUBLIC_CURRENCY_AMOUNT_INVALID", "The conversion amount must be between 0 and 1,000,000,000,000.", 400);
  }
  if (sourceCurrency === targetCurrency) {
    return {
      kind: "currency",
      amount: numericAmount,
      from: sourceCurrency,
      to: targetCurrency,
      rate: 1,
      convertedAmount: numericAmount,
      rateDate: null,
      rateType: "same-currency calculation",
      source: "ULTRON local calculation",
      sourceUrl: null
    };
  }

  const url = new URL(FRANKFURTER_RATES);
  url.searchParams.set("base", sourceCurrency);
  url.searchParams.set("quotes", targetCurrency);
  const data = await getJson(url.toString(), { fetchImpl, provider: "Frankfurter" });
  const rows = Array.isArray(data) ? data : [data];
  const row = rows.find(item => item && String(item.base || "").toUpperCase() === sourceCurrency &&
    String(item.quote || "").toUpperCase() === targetCurrency);
  if (!row || !Number.isFinite(row.rate) || row.rate <= 0) {
    throw apiError("FREE_PUBLIC_CURRENCY_PAIR_UNAVAILABLE", "Frankfurter did not return this currency pair. Check the codes or try another pair.", 422);
  }
  return {
    kind: "currency",
    amount: numericAmount,
    from: sourceCurrency,
    to: targetCurrency,
    rate: row.rate,
    convertedAmount: Number((numericAmount * row.rate).toFixed(6)),
    rateDate: cleanString(row.date, 20) || null,
    rateType: "daily reference rate; not a real-time trading quote",
    source: "Frankfurter",
    sourceUrl: "https://frankfurter.dev/v2/"
  };
}

export async function getFreePublicData({ kind, location, amount = 1, from, to } = {}, { fetchImpl = safePinnedFetch } = {}) {
  if (typeof fetchImpl !== "function") throw apiError("FREE_PUBLIC_API_UNAVAILABLE", "No outbound HTTP transport is available.");
  if (kind === "weather") return getWeather(location, fetchImpl);
  if (kind === "currency") return getCurrency({ amount, from, to }, fetchImpl);
  throw apiError("FREE_PUBLIC_DATA_KIND_INVALID", "Choose weather or currency for the free public-data lookup.", 400);
}
