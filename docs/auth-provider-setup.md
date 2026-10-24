# Auth provider setup

## Phone number sign-in

POST /api/auth/phone/send-otp accepts a phone number in E.164 format, such as +919876543210.
POST /api/auth/phone/verify-otp accepts the same phone number and the received SMS token.

In the Supabase dashboard, enable Phone sign-in and configure a supported SMS provider. Successful verification sets HttpOnly session cookies; access and refresh tokens are not returned to the client as JSON. SMS delivery must be tested in the deployed environment.

## Google sign-in

GET /api/auth/google starts the PKCE redirect flow. GET /api/auth/google/callback validates the one-time state value and exchanges the authorization code.

Set ULTRON_AUTH_CALLBACK_URL to the HTTPS URL ending in /api/auth/google/callback. For the current Render backend, the URL is https://ultron-ai-zvd7.onrender.com/api/auth/google/callback.

In Supabase Auth URL Configuration, add https://ultron-ai-zvd7.onrender.com/api/auth/google/callback* to the redirect URL allow-list. The wildcard is needed because each sign-in adds a one-time state query parameter; keep ULTRON_AUTH_CALLBACK_URL itself set to the exact base callback URL without a query or wildcard. Enable the Google provider in Supabase Auth and set its client credentials there. Google Cloud must use the provider callback URI shown by Supabase, not the ULTRON callback URL.

## Remaining dashboard-only security setting

Leaked-password protection is a Supabase Auth project setting, not a database migration. Enable it in Supabase Authentication password/security settings and then rerun the Security Advisor.