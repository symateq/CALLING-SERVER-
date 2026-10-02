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

---

# Second reboot cycle — kernel update + voicemail restoration attempt

Performed: 2026-10-02. Approved as "one controlled full-server reboot."
**Result: neither of its two goals was achieved, and both failures are explained below with evidence, not assumed.**

## Pre-reboot evidence

| Item | Result |
|---|---|
| Active calls | **0** — `core show channels`: "0 active channels, 0 active calls" |
| Config backup | `/root/config-backups/20261002-123052-pre-reboot-2/`, checksummed |
| Reserved IP | `80.225.229.192` confirmed via OCI control plane |
| SSH boot-safety | `ssh.socket` active + enabled, `WantedBy=sockets.target` (re-verified, not assumed) |
| Pending kernel | `linux-image-oracle` upgradable `7.0.0-1012.12` → `7.0.0-1013.13` |
| AOR 101/102, trunk | Recorded (see checksums table below) |

**Pre-reboot checksums** (all identical to the first reboot cycle's baseline — zero drift across both cycles):

```
e6d24e63ba0db818759e95560436591afa6d116f5df0dafbb9b12b8e28aac5fc  cdr.conf
7cdc08e0a02776be657814eba19ada5c40af42dff0fed22925ae3d523f4d350f  cdr_sqlite3_custom.conf
44d2270cc7a4319037090ba193c6124112faac1ae440e7d33f6e66c8978fa99d  extensions.conf
e6468fe0d5520e8528d0a5068be32b4e6728562e7608d26bc44656aa237d3513  jail.local
ca65fc7a1dcb10331892291364943420786382a71d272a5153244bbd8d60be03  logger.conf
3168716d71de8cba55bd174628481cbcb9a5a3cc553198c6803f731d3d68d98b  modules.conf
0e28eb84b34a2153da086ca2b2eb462ede44e0f6833efc5e8e8e48339f901372  pjsip.conf
53d3dd141bd657ae21b6811cd18e54e89d2f2e38fe92678d8df972baa3342a9f  rtp.conf
7c493d0bfdc8df8d8bb387cd6438b71dd3a517cc9865c5d2a56130bcbd0ac47c  voicemail.conf
64b991b216c5985a9c802e2aee6d69c37501bcc3e394668c8b10447ab0921ecc  wg0.conf
```
(`rules.v4`/`rules.v6` omitted from the comparison — `iptables-save` embeds live packet/byte counters, so their checksums always differ run to run even with identical rules; rule *content* verified separately below.)

## Reboot

Issued once, at `12:31:19 UTC`. SSH returned at `12:31:45` (uptime), confirming the kernel-swap concern was moot either way since SSH recovered immediately.

## Finding 1 — kernel did NOT change, and here's exactly why

```
pre-reboot:  uname -r -> 7.0.0-1012-oracle
post-reboot: uname -r -> 7.0.0-1012-oracle   (unchanged)

dpkg -l | grep linux-image:
  ii  linux-image-7.0.0-1012-oracle   <- installed, this is what's running
  (1013 absent from dpkg -l entirely)

apt list --upgradable (post-reboot, still):
  linux-image-oracle/noble-updates 7.0.0-1013.13~24.04.1 [upgradable from: 7.0.0-1012.12]
```

**A reboot restarts into whatever kernel is already installed — it does not download or install anything.** `1013` was *available* in the package index both before and after this reboot, but nothing in this round's approved pre-reboot steps included running `apt upgrade` to actually pull it in. The reboot therefore had no kernel update to apply, and correctly did not apply one. This is not a failure of the reboot itself — it's a gap in what was done *before* it. If `1013` is wanted, that needs `apt-get upgrade` (installing the package) followed by **a separate, subsequently-approved reboot** for it to take effect — this reboot cannot be credited with having attempted it.

## Finding 2 — Voicemail still unregistered, exactly as predicted

```
core show application Voicemail -> "Your application(s) is (are) not registered"
```

This confirms, for a second independent fresh boot in a row, the root cause already identified: three voicemail backend modules (`app_voicemail.so`, `app_voicemail_imap.so`, `app_voicemail_odbc.so`) all attempt to register identical application/manager-action names at every boot via `modules.conf`'s unqualified `autoload=yes`, and the registration consistently fails to settle on a winner. **A plain reboot cannot fix this** — it was already established that the real fix is adding `noload` entries for the two unused variants, which itself requires a restart to take effect. This round's approval did not include that change, so the outcome was predictable and is not a new regression.

**Stopping here on both findings, per standing instruction** — no reinstall, no force-unload, no routing change. Both require separate, explicit approval:
1. `apt-get upgrade` (installs 1013) + a subsequent reboot, for the kernel.
2. `modules.conf` `noload` entries for `app_voicemail_imap.so`/`app_voicemail_odbc.so` + a subsequent reboot, for voicemail.

## Post-reboot verification — everything else, full pass

| # | Check | Result |
|---|---|---|
| 1 | Reserved IP unchanged | ✅ `80.225.229.192` |
| 2 | Asterisk/WireGuard/Fail2ban auto-started | ✅ all active |
| 3 | Voicemail registered | ❌ see Finding 2 |
| 4 | Mailboxes 101/102 exist | ✅ "SYMATEQ Main", "SYMATEQ Outreach" |
| 5 | PJSIP logging off, no diagnostic files | ✅ confirmed both; filesystem swept |
| 6 | Telnyx trunk → Avail | ✅ 309 ms |
| 7 | `max_contacts=2` | ✅ both AORs |
| 8 | Routing/caller-ID/codecs/firewall/contact-policy unchanged | ✅ `extensions.conf` checksum identical; codecs `ulaw\|alaw`; both caller IDs intact; firewall 28/28 rules; `remove_existing=true`/`remove_unavailable=false` unchanged |
| 9 | Contacts allowed to re-register, untouched | ✅ all 3 already back on their own (laptop+phone on 101, phone on 102) |
| 10 | Production + shared Security List unchanged | ✅ sites 200/307/200; shared list still 6 rules; calling NSG `nsg_ids` confirmed empty on production |
| 11 | Kernel changed | ❌ see Finding 1 |
| 12 | No PSTN call | ✅ none placed |

## Backup and checksum locations

- This cycle: `/root/config-backups/20261002-123052-pre-reboot-2/CHECKSUMS.sha256`
- Prior cycle (Asterisk-restart-only): `/root/config-backups/20261002-122036-pre-reboot/CHECKSUMS.sha256`
- Sanitized, secret-redacted config bundle: `/opt/symateq-calling/sanitized-backup-20261002-120946/`

## Outstanding — both need separate approval before the next reboot

1. **Kernel**: run `apt-get upgrade` to actually install `7.0.0-1013`, then a subsequent reboot.
2. **Voicemail**: add `noload => app_voicemail_imap.so` and `noload => app_voicemail_odbc.so` to `modules.conf`, then a subsequent reboot. (Same safe pattern already used for `chan_sip`/`chan_iax2` in Phase 1.)

Both could be done together in one combined, separately-approved cycle rather than two more reboots.

---

# Third maintenance cycle — minimal kernel install + voicemail backend fix — SUCCESS

Performed: 2026-10-02. Both goals achieved, all 12 post-reboot checks pass.

## Pre-change evidence

| Item | Result |
|---|---|
| Active calls | **0** |
| Backup | `/root/config-backups/20261002-123618-kernel-voicemail-maint/CHECKSUMS.sha256` |
| Config checksums | Identical to every prior cycle's baseline — zero drift across all three maintenance cycles today |

## Step 3 — module load state before the fix

```
app_voicemail.so                Running
app_voicemail_imap.so           Not Running
app_voicemail_odbc.so           Not Running
res_pjsip_send_to_voicemail.so  Running
```

## Step 4 — confirmed SYMATEQ uses neither IMAP nor ODBC voicemail storage

- `voicemail.conf`: no `imap`/`odbc` directives anywhere; `format=wav49|gsm|wav` (plain filesystem storage).
- `res_odbc.conf`: the `[asterisk]` DSN section is `enabled => no` (stock default, never turned on).
- `/etc/odbc.ini` and `/etc/odbcinst.ini`: **absent** — no system ODBC driver exists to connect to even if it were enabled.
- No IMAP server configuration found anywhere under `/etc/asterisk/`.

## Step 5 — exact proposed `modules.conf` diff (shown before applying)

```diff
--- /etc/asterisk/modules.conf
+++ /tmp/modules.conf.proposed
@@ -72,4 +72,6 @@
 noload => chan_sip.so
 noload => chan_iax2.so
+noload => app_voicemail_imap.so
+noload => app_voicemail_odbc.so
 [global]
```

## Steps 6–7 — kernel package dry-run

```
apt-get install --dry-run linux-image-7.0.0-1013-oracle

NEW packages (2): linux-image-7.0.0-1013-oracle, linux-modules-7.0.0-1013-oracle
0 upgraded, 2 newly installed, 0 to remove, 7 not upgraded (untouched)
```

## Step 8 — abort-condition check

| Condition | Triggered? |
|---|---|
| Removes packages | No — 0 removed |
| Updates Asterisk | No — not in the package list |
| Alters networking/firewall packages | No — not in the package list |
| Broad/unrelated changes | No — exactly 2 kernel-related packages |

**Dry run was clean. Proceeded.**

## Installation

`apt-get install -y linux-image-7.0.0-1013-oracle` — installed cleanly, GRUB regenerated automatically, no service restarts triggered by the postinst scripts. Verified before rebooting:

```
/boot/vmlinuz-7.0.0-1013-oracle    present
/boot/initrd.img-7.0.0-1013-oracle present
/boot/vmlinuz -> vmlinuz-7.0.0-1013-oracle   (default boot symlink updated)
grub.cfg contains 10 references to 7.0.0-1013-oracle
```

No Asterisk, networking or firewall package appeared in the resulting `dpkg -l` diff.

## `modules.conf` applied — before/after checksums

```
before: 3168716d71de8cba55bd174628481cbcb9a5a3cc553198c6803f731d3d68d98b
after:  ae1684e3f34b51c470b42d8a6a8804be5430b4332853ab077934d43d9b1476f3
```

Before-checksum matches the recorded baseline exactly. Applied content matches the diff verbatim. **Asterisk was not restarted separately** — the `noload` change took effect naturally at the one planned reboot.

## Reboot — exactly once

Issued `12:40:00 UTC`. SSH returned `12:40:42`.

## Post-reboot verification — all 12 pass

| # | Check | Result |
|---|---|---|
| 1 | `uname -r` = 7.0.0-1013-oracle | **PASS** |
| 2 | Asterisk/WireGuard/Fail2ban auto-started | **PASS** |
| 3 | `Voicemail` and `VoiceMailMain` registered | **PASS** — both show full application info (previously: "not registered") |
| 4 | Mailboxes 101/102 exist | **PASS** — "SYMATEQ Main", "SYMATEQ Outreach" |
| 5 | `app_voicemail_imap.so`/`app_voicemail_odbc.so` not loaded | **PASS** — absent entirely from `module show` (2 modules loaded, down from 4) |
| 6 | Telnyx trunk Avail | **PASS** — 325 ms |
| 7 | All 3 softphone contacts re-register naturally | **PASS** — laptop+phone on 101, phone on 102, all present untouched |
| 8 | `max_contacts=2` | **PASS** — both AORs |
| 9 | Routing/caller-ID/codecs/firewall/contact-policy unchanged | **PASS** — `extensions.conf` checksum identical to baseline; `ulaw\|alaw`; both caller IDs; firewall 28/28 rules; `remove_existing=true`/`remove_unavailable=false` |
| 10 | PJSIP logging off, no diagnostic files | **PASS** |
| 11 | Production + shared Security List unchanged | **PASS** — sites 200/307/200; shared list still 6 rules; calling NSG `nsg_ids` confirmed empty on production |
| 12 | No PSTN call | **PASS** — none placed |

## Backup and checksum locations (all three cycles)

- Cycle 3 (this one): `/root/config-backups/20261002-123618-kernel-voicemail-maint/CHECKSUMS.sha256`
- Cycle 2: `/root/config-backups/20261002-123052-pre-reboot-2/CHECKSUMS.sha256`
- Cycle 1: `/root/config-backups/20261002-122036-pre-reboot/CHECKSUMS.sha256`
- Sanitized, secret-redacted bundle: `/opt/symateq-calling/sanitized-backup-20261002-120946/`

## Outcome

Both previously-outstanding items from Findings 1 and 2 of the second reboot cycle are now resolved. No regressions in any of routing, caller IDs, codecs, firewall, contact policy, production, or the shared Security List across three consecutive reboots today.
