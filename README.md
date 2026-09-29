# SYMATEQ Calling Server

Asterisk/PJSIP + Telnyx Elastic SIP Trunking + WireGuard-only softphone
access, for SYMATEQ's business calling (support line + outreach line),
eventually feeding call events into n8n → CRM/Teams.

See [HANDOVER.md](HANDOVER.md) for the full implementation spec — read
its blocker note at the top before doing anything else. Nothing has
been executed against a server yet; this repo currently holds planning
docs only.

## Status (2026-09-29)
- ⛔ **Blocked on server choice** — see HANDOVER.md's blocker box. The
  server this was originally planned for is now live production
  infrastructure (symateq's website/Company OS/Planvas), which the
  handover's own Gate 0 forbids installing onto.
- No Telnyx numbers purchased yet.
- No server touched yet.

## Repo layout (planned, once work starts)
```
/deploy/           infra-as-code: nginx-equivalent, systemd units, etc. mirrored here from the server
/docs/
  inventory-redacted.txt
  firewall-plan.md
  telnyx-portal-checklist.md
  softphone-runbook.md
  test-report.md
  rollback.md
HANDOVER.md         the original implementation spec (this project's source of truth)
```
