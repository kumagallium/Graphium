# graphium-token-broker

A stateless Cloudflare Worker that exchanges a Google OAuth authorization code
(`POST /exchange`) or refresh token (`POST /refresh`) at Google's token endpoint,
so the mobile PWA stays connected without ever holding the client secret.

## What it does not do

- Stores nothing (no KV, no database) and logs nothing (`observability` is off).
- Talks only to Google's token endpoint (and `revoke`); URL, client_id, redirect_uri,
  grant_type and scope are never taken from the request.
- Returns only `access_token`, `expires_in` and (on `/exchange`) `refresh_token`.
- Refuses any grant whose scope is not exactly `drive.file`, and revokes it (on `/refresh`, the refresh token sent in the request).
- Caps request bodies at 4096 bytes (counted while streaming).
- Rate-limits per IP (30 requests / 60 s) when the `RATE_LIMITER` binding exists.

## Deploy

```sh
cd workers/token-broker
# set GOOGLE_CLIENT_ID (and ALLOWED_ORIGINS if needed) in wrangler.toml
pnpm dlx wrangler deploy
pnpm dlx wrangler secret put GOOGLE_CLIENT_SECRET
```

The rate limit binding in `wrangler.toml` (`[[ratelimits]]`) follows the current wrangler
format as far as we know; check the wrangler documentation for the exact syntax when deploying.

## Security notes

- The Origin and `X-Requested-With` checks only stop browsers on other sites from calling
  the broker. Non-browser clients can forge both headers, so anyone holding a refresh token can
  obtain access tokens through this Worker. Refresh tokens must be protected on the device.
- `ALLOWED_ORIGINS` matches whole origins. Other sites served from the same origin (for example
  other repositories under the same GitHub Pages account) are allowed too and share
  `localStorage`. Only host sites you fully trust on that origin.

## Google Cloud prerequisites

- Use a new project with an OAuth client of type **Web application**.
- Add the PWA origin to **Authorized JavaScript origins**.
- Set the consent screen to **Production** (in Testing, refresh tokens expire in 7 days).

## If the secret leaks

Rotate the client secret in Google Cloud and `wrangler secret put` the new one.
Rotating invalidates **every** refresh token issued so far, which is how you stop
a compromise (users reconnect once).
