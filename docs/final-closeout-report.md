# Final closeout report

Completed: 2026-10-02. Non-disruptive by design — no restart, no routing/firewall/credential/caller-ID/codec/contact-policy change, no PSTN call placed.

## All three final acceptance tests verified in CDR

| Test | uniqueid(s) | Answer time | Duration | Billsec |
|---|---|---|---|---|
| Internal 101 → 102 | `1790942554.101` | 12:02:46 | 72s | **60s** |
| Primary 101 → Outreach DID | `1790942721.105` / `.107` | 12:05:33 | 39s | **27s / 28s** |
| Outreach 102 → Primary DID | `1790942804.113` / `.115` | 12:06:56 | 42s / 41s | **29s / 29s** |

All three show real `answer_time` and nonzero `billsec` — genuine two-way, billed-duration calls, not just ringing. The DID-to-DID tests each produced the expected outbound+inbound CDR pair (same-account loopback, as established earlier in this project).

## Voicemail application defect — root cause found, live fix not possible without a restart

**Root cause, finally isolated:** `app_voicemail.so` loads as a module (`Running`, confirmed) but never completes its *application* registration. The exact trigger is in the historical log:

```
[Oct 1 06:56:16] WARNING pbx_app.c: Already have an application 'VoiceMail'
```

A one-time registration race at boot (app_voicemail_imap.so competing for the same app name) left the real `Voicemail`/`VoiceMailMain` applications permanently unregistered for the life of this Asterisk process — confirmed by `core show application Voicemail` failing under every casing, while only the unrelated `Minivm*` family and `Directory` show as registered.

**Fix attempted via every live-safe path, all failed — and that failure is itself informative, not a mistake:**
1. `module unload app_voicemail.so` → **`Unable to unload resource`** ("Firm unload failed")
2. Removed its only dependent (`res_pjsip_send_to_voicemail.so`) first, retried unload → **still refused**
3. `module reload app_voicemail.so` → reports success, but only re-reads `voicemail.conf` (mailboxes); does not re-run application registration, which happens once at module *load* time only

`app_voicemail.so` is documented in the wider Asterisk community as a module that deliberately refuses runtime unload once loaded, due to internal state it holds. This isn't something my attempts caused — it's a known property of the module. **The only fix is a full Asterisk process restart**, which was explicitly out of scope for this session.

`res_pjsip_send_to_voicemail.so` was unloaded during diagnosis and **restored** immediately afterward — confirmed `Running` again, Asterisk PID unchanged throughout (never restarted).

### Why this is safe to leave open for now

Every one of today's successful tests — internal, both outbound DIDs — completed with a real answer. **None of them exercised the voicemail fallback path**, because none needed to. The defect only matters for an unanswered call, which is a real scenario worth fixing, but it did not affect, and does not retroactively affect, anything verified today.

**Recommended next step, your call on timing:** schedule a brief Asterisk restart (not urgent — the system is fully functional for answered calls) to clear this one-time registration failure. I'd suggest doing it in the same planned-maintenance window as the earlier-deferred kernel-update reboot, rather than as its own disruption.

## Cleanup verification

| Item | Result |
|---|---|
| Diagnostic capture files | Full filesystem sweep — **none found** (matches from `find /` are unrelated kernel headers) |
| PJSIP logging | Confirmed **off** |
| Capture processes | None running |
| `logger.conf` | SHA-256 `ca65fc7a1d…` — **identical to pre-investigation baseline** |
| AOR 101 contacts | Preserved: laptop `10.66.66.2:51646` + phone `10.66.66.3:34348` |
| AOR 102 contacts | Preserved: phone `10.66.66.3:34348` only |
| `max_contacts` | Unchanged at 2 on both |
| Telnyx trunk | `Avail`, 311 ms |

## Sanitized configuration backup

Created at `/opt/symateq-calling/sanitized-backup-20261002-120946/` on the server — `pjsip.conf` (passwords redacted), `extensions.conf`, `voicemail.conf` (PINs redacted), `rtp.conf`, `modules.conf`, `cdr.conf`, `cdr_sqlite3_custom.conf`, `jail.local`, both firewall rule files. Verified secret-free by grep before leaving it in place (`password=<random>` and `PrivateKey` patterns — zero matches).

`wg0.conf` deliberately **excluded** — it contains the server's WireGuard private key with no clean way to redact in place, and isn't needed for configuration review.

## Client secrets — deleted server-side, confirmed safe elsewhere first

Checked **before** deleting anything:
- **Laptop** (`C:\oci\symateq-calling-secrets\`): all 4 files confirmed present, correct sizes, unchanged since original delivery.
- **Mobile**: no direct filesystem access, but *stronger* evidence than a file check — the phone **actively registered and placed working, answered test calls as both 101 and 102** throughout this session. That's proof its saved config works, not an assumption.

Then deleted, server-side, `/root/wg-clients/` in full: `symateq-laptop.conf`, `symateq-laptop.priv`, `symateq-laptop.pub`, `symateq-mobile.conf`, `symateq-mobile.priv`, `symateq-mobile.pub`, `symateq-mobile-qr.png`, `sip-credentials.txt`. All `shred`ed, directory removed, filesystem swept afterward — nothing remains.

## System state at closeout

- Asterisk: active, same PID throughout this entire investigation (never restarted)
- PJSIP: endpoints 101, 102, telnyx all present and correctly configured
- WireGuard: `wg0` up, 2 peers (laptop, mobile)
- Fail2ban: `sshd` + `asterisk` jails active
- Telnyx trunk: `Avail`
- Firewall: unchanged, default-deny both stacks, narrow Telnyx + VPN-only softphone rules
- Production website server: never touched at any point in this entire project — separate NSG, shared Security List still exactly 6 rules

## Outstanding, not fixed this session

**Voicemail application registration** — needs a scheduled Asterisk restart. No live-safe fix exists for the module's refusal-to-unload behavior. Does not affect any currently-working call path.
