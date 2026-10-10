# Stage 2 live audit — 10 October 2026 (afternoon recheck)

Read-only recheck, run after the SYMATEQ Connect plan was formalized with the
explicit hosting boundary (calling server only; the 4 OCPU/24GB Company OS
server stays fully unchanged). Nothing below changed any server state —
every command was a PJSIP/CDR/systemd *read*, not a write.

## Device registrations

| AOR | Contacts | Detail |
|---|---|---|
| 101 (Primary, +1 407-751-1755) | 1 | Laptop only, `10.66.66.2`. No phone registered. |
| 102 (Outreach, +1 407-751-1178) | 0 | Nothing registered — phone or laptop. |

Both AORs still have `max_contacts=2`. Device registration state is volatile
and must be rechecked again at actual implementation/cutover time, not
assumed from this snapshot either.

## Telnyx trunk

`telnyx-aor` contact: `Avail`, 378.8ms RTT. Endpoint `telnyx`: not in use,
0 of inf channels — healthy and idle at check time.

## Asterisk health

Active since `2026-10-09 06:22:46 UTC`, 0 restarts since then.
`journalctl -u asterisk --since "2 days ago"` grepped for
error/warn/restart/fail: no matches.

## Resource headroom (relevant to the plan's ₹0 / VM-RAM boundary)

- Memory: 952Mi total, 654Mi available, 649Mi in buff/cache, swap 37Mi/4.0Gi used.
  Matches the plan's cited ~640MB closely — this really is an
  OCI VM.Standard.E2.1.Micro, not a larger box.
- Disk: 137G free of 145G on `/`.
- WireGuard (`wg-quick@wg0`) and fail2ban: both active.

Any new component placed on this server (the gateway included) needs to stay
small against that ~650MB available figure. The gateway as currently built
(Node + Express + Prisma/SQLite, no heavy dependencies) is a reasonable fit,
but actual RSS on this box hasn't been measured yet — that's a Stage 2
exit-criteria item, not something to assume.

## CDR, since 8 October

Queried `/var/log/asterisk/master.db` (`cdr_sqlite3_custom`) directly.

| Presented caller ID | Disposition | Count |
|---|---|---|
| "SYMATEQ" \<+14077511755\> (Primary) | ANSWERED | 20 |
| "SYMATEQ" \<+14077511755\> (Primary) | NO ANSWER | 12 |
| "SYMATEQ" \<+14077511178\> (Outreach) | NO ANSWER | 6 |
| "SYMATEQ" \<+14077511178\> (Outreach) | ANSWERED | 0 |
| +1484•••9151 (neither business number — redacted, provenance unconfirmed) | ANSWERED | 1 |

Two things worth flagging honestly, not glossing over:

1. **Outreach has zero answered calls in this window**, all via the `*2`
   caller-ID prefix from the 101 device (no 102 device is registered to
   generate its own CDR rows). Low sample size — not enough to draw a
   conclusion about Outreach answer rate specifically.
2. **One call presented a caller ID that is neither business number.**
   This is a live, concrete instance of exactly the gap the plan calls
   out: *the PBX does not yet enforce which caller ID a client may
   present.* The gateway's `/lines/validate-caller-id` endpoint (see
   `gateway/`) implements that check at the gateway layer, but nothing in
   the current Asterisk dialplan calls it yet — enforcement isn't real
   until that's wired up, which is Stage 3 work, not done now.

## What this does and doesn't tell us

Per the plan's own caution: an answered CDR row proves the call connected,
not that a human had a conversation (could be voicemail). A NO ANSWER row
doesn't prove deliberate rejection. This audit draws no conclusion beyond
what's measured above.
