# LINE Login and server sessions

This module uses the official authorization code flow with S256 PKCE and LINE's
server-side ID-token verification endpoint. It does not trust a browser profile,
user ID, access token payload, or unsigned identity header.

## Required configuration

- `APP_ORIGIN`: exact HTTPS origin, for example `https://staging.nongoon.com`.
- `LINE_LOGIN_CHANNEL_ID`: a LINE **Login** channel under the same Provider as
  the Messaging API channel, so LINE user IDs agree across login and webhooks.
- `LINE_LOGIN_CHANNEL_SECRET`: the Login channel secret, entered through
  Cloudflare Secrets. This is separate from `LINE_CHANNEL_SECRET` and from the
  Messaging API access token.
- Register `${APP_ORIGIN}/auth/callback` on the Login channel. API and login
  feature gates are controlled by the integrating Worker. Never open staging
  Access policies merely because this code has been deployed.

## Interfaces

- `handleAuth(request, env, {now, fetcher})`: handles `/auth/login` (GET),
  `/auth/callback` (GET), `/auth/logout` (POST). Returns `null` for another path.
  Throws `AuthError` with safe `code` and HTTP `status`; caller returns only
  those safe fields and never raw database/provider errors.
- `authenticate(request, env, {now})`: returns server-derived `{actorId, csrf}`
  or throws. `actorId` is the verified LINE subject.
- `requireCsrf(request, env, identity)`: requires exact configured `Origin`,
  same request origin, no cross-site fetch provenance, and `X-CSRF-Token`.

State and session bearer tokens have 256 bits of random entropy. D1 stores only
their SHA-256 digests. A separate host-only, Secure, HttpOnly cookie binds each
OAuth state to the browser; state is consumed atomically before provider calls.
OAuth state, nonce and verifier expire after 10 minutes. Sessions expire after
12 hours with no implicit extension, and are replaced on successful login.
Cookies use the `__Host-` prefix, `Path=/`, `SameSite=Lax`, no Domain attribute,
and logout clears the current session. Blocked accounts cannot obtain or use
sessions. Only the `openid` scope is requested; no profile/email is collected.

Login starts allow ten requests per minute per ingress IP. The application trusts
Cloudflare to overwrite `CF-Connecting-IP`; deployment behind another proxy must
preserve that trust boundary. Missing or invalid addresses share one restrictive
bucket. D1 stores only a hash combining the address, minute bucket and a random
daily salt, never the address itself. Rate entries expire at the next minute,
while the salt occupies a single rotating row. Salted address digests remain
pseudonymous metadata and must be treated as private. Each start purges at most
100 expired rate entries and 100 expired OAuth states. Both tables have a hard
5,000-row capacity; reaching capacity fails closed and never grows the table.
This is an application backstop; Cloudflare ingress limits remain appropriate
before enabling public traffic. No session or external LINE request is created
by a throttled login start.

The token exchange and verify calls use fixed HTTPS LINE endpoints, deny
redirects, have an 8-second request timeout, and bound each response to 64 KiB.
ID-token issuer, audience, subject syntax, nonce, issuance and expiry times are
checked after LINE verification. Access/refresh/ID tokens are not stored or
logged. Callback redirects use only a fixed configured origin, not `next` or
other user-provided destinations.

Apply migration `0004_auth.sql` before enabling auth. Maintenance must remove
expired `oauth_states` and `sessions` in bounded batches; session indexes support
both expiry and account deletion. Also purge expired `auth_rate_limits` entries;
the rotating `auth_rate_salt` table is bounded to one row. Authentication tests use actual SQLite and
a mock LINE endpoint; they do not demonstrate a live LINE Login integration.

References:
- https://developers.line.biz/en/docs/line-login/integrate-line-login/
- https://developers.line.biz/en/docs/line-login/integrate-pkce/
- https://developers.line.biz/en/reference/line-login/#verify-id-token
