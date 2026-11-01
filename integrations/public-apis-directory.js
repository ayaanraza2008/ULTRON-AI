/**
 * ULTRON AI — Curated Public APIs Directory & Safe Discovery Catalog
 * Evaluates and integrates API discovery principles from public-apis/public-apis
 *
 * Implements a vetted catalog of open public APIs supporting research, weather,
 * scientific data, and geospatial queries with mandatory anti-SSRF domain validation.
 */

import { safeServiceBase } from "../network-safety.js";

export const API_AUTH_TYPES = {
  NONE: "No Key Required",
  API_KEY: "Free API Key",
  OAUTH: "OAuth 2.0"
};

export class PublicApisCatalog {
  constructor() {
    this.directory = new Map();
    this.initializeDirectory();
  }

  initializeDirectory() {
    this.registerApi({
      id: "open-meteo",
      name: "Open-Meteo Weather API",
      category: "Weather & Environment",
      description: "High-resolution global weather forecasts, historical observations, and air quality data.",
      baseUrl: "https://api.open-meteo.com/v1",
      docsUrl: "https://open-meteo.com/en/docs",
      authType: API_AUTH_TYPES.NONE,
      cors: true,
      https: true,
      responseFormat: "JSON",
      capabilities: ["weather_forecast", "air_quality", "historical_weather"]
    });

    this.registerApi({
      id: "nominatim-osm",
      name: "OpenStreetMap Nominatim Geocoder",
      category: "Geospatial & Maps",
      description: "Forward and reverse geocoding from OpenStreetMap data.",
      baseUrl: "https://nominatim.openstreetmap.org",
      docsUrl: "https://nominatim.org/release-docs/latest/api/Overview/",
      authType: API_AUTH_TYPES.NONE,
      cors: true,
      https: true,
      responseFormat: "JSON",
      capabilities: ["forward_geocode", "reverse_geocode", "place_search"]
    });

    this.registerApi({
      id: "frankfurter-fx",
      name: "Frankfurter Currency & FX Rates",
      category: "Finance & Economics",
      description: "Open-source reference exchange rates published by the European Central Bank.",
      baseUrl: "https://api.frankfurter.app",
      docsUrl: "https://www.frankfurter.app/docs/",
      authType: API_AUTH_TYPES.NONE,
      cors: true,
      https: true,
      responseFormat: "JSON",
      capabilities: ["currency_conversion", "historical_fx_rates"]
    });

    this.registerApi({
      id: "opensky-network",
      name: "The OpenSky Network",
      category: "Aviation & Tracking",
      description: "Live ADS-B aircraft flight tracking data for academic and personal research.",
      baseUrl: "https://opensky-network.org/api",
      docsUrl: "https://openskynetwork.github.io/opensky-api/rest.html",
      authType: API_AUTH_TYPES.NONE,
      cors: true,
      https: true,
      responseFormat: "JSON",
      capabilities: ["live_flight_vectors", "airport_arrivals_departures"]
    });

    this.registerApi({
      id: "arxiv-api",
      name: "arXiv Preprint Search API",
      category: "Science & Education",
      description: "Search 2+ million scientific research articles in physics, computer science, and AI.",
      baseUrl: "https://export.arxiv.org/api",
      docsUrl: "https://info.arxiv.org/help/api/index.html",
      authType: API_AUTH_TYPES.NONE,
      cors: true,
      https: true,
      responseFormat: "Atom XML / JSON",
      capabilities: ["paper_search", "author_query", "abstract_retrieval"]
    });

    this.registerApi({
      id: "nvd-cve-api",
      name: "NIST National Vulnerability Database (NVD)",
      category: "Cybersecurity & Intel",
      description: "Authoritative CVE records, CVSS severity metrics, and CPE hardware/software configurations.",
      baseUrl: "https://services.nvd.nist.gov/rest/json/cves/2.0",
      docsUrl: "https://nvd.nist.gov/developers/vulnerabilities",
      authType: API_AUTH_TYPES.NONE,
      cors: true,
      https: true,
      responseFormat: "JSON",
      capabilities: ["cve_lookup", "cpe_match_search"]
    });

    this.registerApi({
      id: "open-library",
      name: "Internet Archive Open Library",
      category: "Books & Knowledge",
      description: "Over 20 million catalog records, ISBN resolution, author biographies, and subject headings.",
      baseUrl: "https://openlibrary.org",
      docsUrl: "https://openlibrary.org/developers/api",
      authType: API_AUTH_TYPES.NONE,
      cors: true,
      https: true,
      responseFormat: "JSON",
      capabilities: ["isbn_search", "book_metadata", "author_search"]
    });
  }

  registerApi(apiMeta) {
    if (!apiMeta.id || !apiMeta.name || !apiMeta.baseUrl) {
      throw new Error("registerApi requires id, name, and baseUrl.");
    }

    const safeBase = safeServiceBase(apiMeta.baseUrl);
    if (!safeBase) {
      throw new Error(`SSRF_DENIED: Candidate API '${apiMeta.baseUrl}' does not resolve to an approved safe HTTPS origin.`);
    }

    this.directory.set(apiMeta.id, {
      ...apiMeta,
      safeBase,
      verifiedAt: new Date().toISOString()
    });
    return this.directory.get(apiMeta.id);
  }

  getApi(id) {
    return this.directory.get(id) || null;
  }

  listApis(category = null) {
    let list = Array.from(this.directory.values());
    if (category) {
      list = list.filter(a => a.category.toLowerCase().includes(category.toLowerCase()));
    }
    return list;
  }

  searchApis(query = "") {
    const q = String(query).toLowerCase().trim();
    if (!q) return this.listApis();

    return Array.from(this.directory.values()).filter(a =>
      a.name.toLowerCase().includes(q) ||
      a.description.toLowerCase().includes(q) ||
      a.category.toLowerCase().includes(q) ||
      a.capabilities.some(c => c.toLowerCase().includes(q))
    );
  }

  /**
   * Validates whether a candidate third-party API URL is safe to contact (Anti-SSRF).
   */
  validateCandidateUrl(url) {
    const checked = safeServiceBase(url);
    if (!checked) {
      return { safe: false, reason: "Target fails anti-SSRF policy (must be HTTPS, public domain, no private/loopback IP)." };
    }
    return { safe: true, safeOrigin: checked };
  }
}

export const publicApisCatalog = new PublicApisCatalog();
