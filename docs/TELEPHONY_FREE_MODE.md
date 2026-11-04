# ULTRON telephony: safe free-mode boundary

## What works without a carrier

The telephony gateway can be unit-tested and run in a disabled-by-default state. It will not invent an owner phone number, a SIP endpoint, or a default PIN. Carrier callbacks are rejected until an authenticating secret is configured.

## Real phone numbers and PSTN calls

Software alone cannot terminate calls to ordinary mobile/landline numbers. That requires a telecom carrier account, a provisioned number or calling route, identity/KYC where required, and usually paid call minutes. Exotel's official onboarding guide requires account verification/KYC and an ExoPhone purchase; its API calls require account credentials. Twilio likewise requires a live account and paid voice service after any trial credit. There is no honest, unlimited, zero-cost PSTN calling route that can be switched on from this repository.

A free app-to-app internet voice feature is a different product: it needs a client on each device and a WebRTC signalling/media path. The current telephony gateway does not implement that feature; it must not be presented as available merely because a configuration flag exists.

## Required server-side configuration

- `ULTRON_OWNER_PHONE_NUMBERS`: comma-separated E.164 numbers explicitly authorized to control ULTRON.
- `ULTRON_TELEPHONY_PIN`: optional four-digit fallback PIN for callers outside the allowlist. Keep it secret and rotate it if exposed.
- `ULTRON_TELEPHONY_WEBHOOK_SECRET`: at least 32 random characters, sent in the `X-ULTRON-Telephony-Secret` header by a compatible private webhook sender.
- For Twilio only: set `TWILIO_AUTH_TOKEN` and `TELEPHONY_PUBLIC_BASE_URL` to the exact public HTTPS base URL registered with Twilio. Twilio callbacks are validated against `X-Twilio-Signature`.

Never put these secrets in source control, client code, chat messages, or logs. Do not configure a default PIN. A missing webhook secret or invalid signature returns an error before call state is created.

## Current limit

This change hardens the existing carrier webhook surface. It does not create an Exotel/Twilio account, provision a caller ID, complete KYC, or place a live phone call. Those steps require the account holder and carrier. The branch is not deployed.
