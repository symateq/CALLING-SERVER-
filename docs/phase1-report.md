# Phase 1 report

Completed: 2026-09-29

## What was done

**Network isolation (correction applied before anything else):**
- Created a dedicated NSG (`symateq-calling-server-nsg`), attached to
  this instance's VNIC only. Shared subnet Security List untouched.
- NSG currently has **0 rules** — deny-by-default, nothing exposed.

**OS preparation:**
- Security updates applied (`apt-get upgrade`), no auto-reboot. A reboot
  is now flagged as required (kernel update) — **not yet performed**,
  held for a moment you choose. SSH and all services will need to
  survive that reboot cleanly; worth verifying once it happens (ties
  into the handover's own Phase 6 test #13).
- Root-only config-backup directory created (`/root/config-backups`),
  every default config file backed up there with a timestamp before any
  edit.

**Packages installed** (versions recorded in `inventory-redacted.txt`):
Asterisk 20.6.0 (with `asterisk-modules`, confirmed `res_pjsip.so`
present), WireGuard + wireguard-tools, Fail2ban 1.0.2, sqlite3, plus
`tcpdump`/`dnsutils`/`net-tools` for diagnostics. Nothing outside this
list — no FreePBX, no Apache/PHP/MySQL, no GUI panels.

**Asterisk confirmed running as its own unprivileged account**: process
verified via `ps` as `asterisk -U asterisk`, not root.

**Asterisk configuration deployed** (all placeholder values only — see
safety note below):
- `pjsip.conf`: extensions 101 (main) and 102 (outreach) as PJSIP
  endpoints with placeholder passwords; a `telnyx` trunk endpoint with
  placeholder auth/host, `type=identify` left with no `match=` until
  Telnyx's real IP ranges are fetched in Phase 4.
- `extensions.conf`: the five contexts the handover specifies
  (`internal`, `from-softphones`, `outbound-main`, `outbound-outreach`,
  `from-telnyx`), extension-to-voicemail fallback for 101/102, an echo
  test at `600`, voicemail retrieval at `*97`. Outbound contexts pattern-
  match ordinary 10-digit US NANP numbers only — anything else hits an
  explicit deny-and-hangup rather than falling through to the trunk.
  `from-telnyx` has no path back to any outbound context, so it cannot
  become an inbound-to-outbound relay even if the trunk were compromised.
- `voicemail.conf`: mailboxes for 101/102, placeholder PINs.
- `cdr.conf` / `cdr_sqlite3_custom.conf`: CDR fields limited to call ID,
  direction, extension, DID, destination, timestamps, disposition,
  duration — no extra personal data captured.
- Validated via `asterisk -rx "core reload"`, `pjsip show endpoints`,
  `dialplan show internal` — all load cleanly, no errors in the log.

**WireGuard**: server keypair generated directly on the box (private key
never left it, never printed anywhere — root-only, `chmod 600`). `wg0`
interface up locally at `10.66.66.1/24`, port `51820`. No peers added yet
(that's Phase 5, per-device). Split-tunnel by design — no
NAT/MASQUERADE rules, since peers only need to reach Asterisk, not
browse the internet through this box.

**Fail2ban**: `sshd` jail (already default-enabled) plus a new
`asterisk` jail. Found and fixed a real path mismatch here — the
package's default jail definition expects
`/var/log/asterisk/messages`, but this Asterisk version actually writes
`/var/log/asterisk/messages.log` (confirmed by listing the directory,
not assumed). Corrected in `jail.local`. `ignoreip` covers loopback, the
VCN's private range, and the WireGuard subnet, so admin access can never
be accidentally auto-banned. Both jails confirmed active, watching, zero
current bans.

## Safety checklist (verified, not assumed)

- [x] No real Telnyx credentials anywhere — `grep -c REPLACE_WITH` on
      every config file confirms only placeholder strings.
- [x] No SIP/RTP/WireGuard port exposed publicly — NSG has 0 rules,
      confirmed via API query after all changes.
- [x] SSH access preserved throughout — never interrupted, verified
      after every change.
- [x] Every modified config backed up with a timestamp before editing.
- [x] WireGuard private key never printed in any output; file
      permissions 600, root-owned.
- [x] Asterisk runs as its own unprivileged `asterisk` account, not root.

## Open item — needs your input

The approval message was cut off mid-sentence ("...stop after"). I
stopped here — Phase 1 complete and verified, nothing exposed, no
Telnyx/Phase 4 work started — on the assumption that's the intended
stopping point. Let me know if you meant something more specific.

## Pending, your call on timing

A **reboot is flagged as required** (kernel security update). Not done
yet — recommend doing it once convenient, then re-verifying SSH,
Asterisk, WireGuard and Fail2ban all come back up cleanly (this doubles
as an early version of Phase 6's reboot-recovery test).

## Not started (by design)

Phase 2's actual firewall rules (documented as a plan only, see
`firewall-plan.md`, nothing applied), Phase 4 Telnyx portal work, Phase 5
softphone peer provisioning, Phase 6 testing, Phase 7 n8n integration.
