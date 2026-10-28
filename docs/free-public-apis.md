# Free public-data integrations

ULTRON uses the public-apis/public-apis repository as a discovery catalogue, not as a bundle of API credentials. Its listing is MIT-licensed, but each upstream API has its own terms. ULTRON does not scrape, copy, or depend on shared API keys committed elsewhere.

## Integrated no-key providers

### Weather — Open-Meteo

- Uses the public geocoding endpoint followed by the current-weather forecast endpoint.
- No API key is sent or stored.
- The free API is for non-commercial use; weather results include the required attribution: "Weather data by Open-Meteo.com (CC BY 4.0)."
- The lookup is read-only, accepts a place name rather than an arbitrary URL, refuses redirects, uses the pinned outbound transport, and limits request time and response size.
- Provider terms and fair-use limits must be reviewed again before commercial use or higher traffic.

### Currency reference rates — Frankfurter

- Uses the v2 public /rates endpoint with a base currency and one target quote.
- No API key is sent or stored.
- The returned quote is a daily reference rate, not an intraday market/trading quote. The result exposes the provider's rate date when present.
- Same-currency conversion is computed locally without a network call.

### Dictionary — Free Dictionary API

- Looks up words using a fixed HTTPS endpoint.
- No API key is sent or stored.
- Results are bounded to a small number of meanings, definitions, examples and synonyms. Provider text is treated as untrusted external data.

### Public holidays — Nager.Date

- Returns public holiday dates by ISO alpha-2 country code and year.
- No API key is sent or stored.
- Country names are normalized from a small common-country map; callers can also specify an ISO alpha-2 code.
- The adapter validates the year and filters results to bounded fields.

## Example prompts

- "What is the weather in Agra?"
- "Convert 500 USD to INR."
- "What is the exchange rate from EUR to USD?"
- "Define serendipity."
- "What are the public holidays in India for 2026?"

## Security and reliability

- The adapter owns its upstream URLs; caller input cannot choose a host or path.
- Network calls use HTTPS, redirect rejection, DNS-pinned transport, fixed timeouts, and a 256 KiB response cap.
- Error bodies and provider credentials are not returned to the model.
- Public data is not treated as instructions. Results contain source and attribution metadata.
- The integration catalog's available_unverified status means no configuration key is required; it does not guarantee the upstream is currently reachable.

## Discovery source

- Catalogue: https://github.com/public-apis/public-apis
- Open-Meteo terms and documentation: https://open-meteo.com/en/docs
- Frankfurter v2 API: https://frankfurter.dev/v2/
