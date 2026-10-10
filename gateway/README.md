# Calling gateway — Stage 2 foundation

Status: **Implemented and tested locally. Not deployed anywhere.** This is the
first concrete slice of the SYMATEQ Connect plan's Stage 2 ("foundation"):
Entra-authenticated device registry, a calling-permission concept, and
server-side dual-number routing checks. It has **no media path** — it cannot
place, answer, or touch a live call. It does not talk to Asterisk, ARI, AMI,
or Telnyx in any way.

It is deliberately **standalone**: its own SQLite database, not Company OS's
Postgres instance, and it runs only on the calling server — never on the
4 vCPU/24 GB box that hosts Company OS, the calculator and the live website.

## What's real right now

| Piece | Status | Evidence |
|---|---|---|
| Entra ID bearer-token validation (signature, issuer, audience, tenant `tid` claim) | **Implemented, tested** | `test/auth.test.ts` — 8 tests, signed/expired/wrong-audience/wrong-tenant tokens, against a synthetic JWKS (see caveat below) |
| Calling-permission gate, separate from identity | **Implemented, tested** | unapproved → 403; admin-approved → 200; revoked → 403 |
| Device registry (register/list/revoke, upsert on re-register, per-user isolation) | **Implemented, tested** | `test/devices.test.ts` — 5 tests |
| Assigned-lines + server-side caller-ID enforcement | **Implemented, tested** | `test/lines.test.ts` — 4 tests |
| Admin stopgap endpoints (approve user, assign line, create line, revoke) | **Implemented, tested** | same suites; protected by a single static bearer token, see "Known gap" below |
| Production build | **Verified** | `npm run build` compiles clean; `node dist/index.js` boots and was smoke-tested with real `curl` requests (health check, 401 without a token, 401 on admin routes without the admin token, successful line creation with it) |
| Deployment to the actual calling server | **Not started** | Nothing has been pushed to `80.225.229.192`. That's a separate, explicit step — see "Before deploying," below |
| Media bridge / WebRTC / ARI / Asterisk integration | **Not started** | Out of scope for this piece. Stage 3 |
| Android / Windows client apps | **Not started** | Separate piece of work |
| Real Entra app registration | **Blocked** | Needs Entra admin access this session doesn't have — see below |

### The one real caveat on "tested"

`test/auth.test.ts` proves the middleware's *own logic* is correct — it signs
tokens with a throwaway local RSA keypair and points the verifier at that key
instead of Microsoft's real JWKS endpoint. It does **not** prove a real Azure
AD app registration issues tokens this gateway accepts end-to-end, because no
such app registration exists yet. That's the same blocker the Stage 1 gap
report named: creating it needs Entra admin portal access.

## Known gap, not hidden

`/admin/*` is guarded by one static shared bearer token
(`GATEWAY_ADMIN_TOKEN`), not a real admin UI or an Entra app-role check. It
exists only so this foundation could be built and tested end-to-end without
first building an admin portal. Treat it as a placeholder to replace, not a
real access-control model — anyone holding that one token can approve any
user for calling and assign any line.

## Running it locally

```
cp .env.example .env     # edit the placeholder values; never commit .env
npm install
npm run prisma:generate
npm run prisma:migrate   # creates prisma/dev.db
npm run dev               # http://localhost:8081
npm test                   # 17 tests, isolated prisma/test.db
```

## Data model

`prisma/schema.prisma` — `GatewayUser`, `Device`, `Line`,
`UserLineAssignment`, `Contact`, `CallSession`, `CallLeg`, `CallOutcome`,
`CallNote`, `Transcript`, `TranscriptSegment`, `Reminder`,
`ReminderDelivery`. Only the first four are wired to real routes yet
(device registry + line/caller-ID enforcement). The rest exist in the schema
now so Stage 3/4 (calling clients, then captions/transcripts/reminders) can
build against a settled shape instead of re-migrating repeatedly — they have
no routes yet and are not exercised by any test.

SQLite has no native enum type, so fields that are conceptually enums are
plain strings, constrained by the zod enums in `src/types.ts`.

## Before deploying this to the calling server

This has only run on a local dev machine so far. Putting it on
`80.225.229.192` — even though that's the box this work is scoped to — means
a new systemd-managed process next to a live Asterisk/Telnyx setup serving
real phone lines. That's a separate, explicit step: real `.env` values (a
real `AZURE_AD_TENANT_ID`/`AZURE_AD_AUDIENCE` from an actual app registration,
a real generated `GATEWAY_ADMIN_TOKEN`), a firewall rule limited to 443 (never
the SIP port), and a decision on where its SQLite file persists across
restarts/backups. None of that has happened yet.
