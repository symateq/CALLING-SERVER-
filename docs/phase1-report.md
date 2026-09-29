# Phase 1 report

Completed: 2026-09-29
Reboot-recovery audit appended: 2026-09-29 (post-reboot, boot time 18:27:38 UTC)

## What was done

**Network isolation (correction applied before anything else):**
- Created a dedicated NSG (`symateq-calling-server-nsg`), attached to
  this instance's VNIC only. Shared subnet Security List untouched.
- NSG currently has **0 rules** — deny-by-default, nothing exposed.

**OS preparation:**
- Security updates applied (`apt-get upgrade`), no auto-reboot at the time.
  The resulting reboot-required flag was cleared by the controlled reboot
  documented below.
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

**Asterisk configuration deployed** (all placeholder values only):
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

**WireGuard**: server keypair generated directly on the box (private key
never left it, never printed anywhere — root-only, `chmod 600`). `wg0`
interface up at `10.66.66.1/24`, port `51820`. No peers added yet
(that's Phase 5, per-device). Split-tunnel by design — no
NAT/MASQUERADE rules.

**Fail2ban**: `sshd` jail plus a new `asterisk` jail. Found and fixed a
real path mismatch — the package default expects
`/var/log/asterisk/messages`, but this Asterisk version actually writes
`/var/log/asterisk/messages.log` (confirmed by listing the directory,
not assumed). `ignoreip` covers loopback, the VCN private range, and the
WireGuard subnet, so admin access can never be auto-banned.

---

# Reboot-recovery audit

Controlled reboot performed while the server is still fully isolated —
no Telnyx connection, no WireGuard peers, nothing depending on it.

## Pre-reboot checks

| # | Check | Result |
|---|-------|--------|
| 1 | No package install / config write in progress | PASS — no apt/dpkg process, dpkg lock free |
| 2 | Status recorded | Asterisk active+enabled, wg0 active+enabled, Fail2ban active+enabled (2 jails), SSH active, IP `80.225.229.192` |
| 3 | Services enabled at boot | PASS — see SSH note below |

**SSH boot-enablement — caught before rebooting, not after.** The initial
check showed `ssh.service` as `disabled`, which would normally mean a
reboot locks us out. Rather than assume it was "probably fine," this was
verified explicitly: Ubuntu 24.04 uses **socket activation**, and
`ssh.socket` is `active` + `enabled` (`WantedBy=sockets.target`), with
systemd (PID 1) holding the listener on :22. `ssh.service` showing
`disabled` is correct and expected under that model. Reboot proceeded
only after that evidence was in hand — and SSH did return, confirming it.

## Post-reboot checks (all 11)

| # | Check | Result |
|---|-------|--------|
| 1 | SSH reconnects | **PASS** — reconnected as `ubuntu@instance-20260903-2044` |
| 2 | Reserved IP still `80.225.229.192` | **PASS** — lifetime `RESERVED`, state `ASSIGNED` |
| 3 | Asterisk active, dialplan loads clean | **PASS** — all 5 contexts present (internal 4, from-softphones 6, outbound-main 3, outbound-outreach 3, from-telnyx 3 extensions); `dialplan reload` → "Dialplan reloaded." no errors |
| 4 | PJSIP loads correctly | **PASS** — `res_pjsip.so` Running (use count 51); endpoints 101, 102, telnyx all present; transport bound `0.0.0.0:5060` |
| 5 | WireGuard wg0 active | **PASS** — service active, interface up `10.66.66.1/24`, listening 51820, same server public key as before reboot |
| 6 | Fail2ban + both jails active | **PASS** — service active, jails: `asterisk`, `sshd` |
| 7 | CDR + voicemail dirs accessible to asterisk user | **PASS** — `cdr-csv`, `cdr-custom`, `voicemail` all owned `asterisk:asterisk`; write test as the `asterisk` user succeeded on both `cdr-custom` and `voicemail` |
| 8 | No unexpected public listening ports | **PASS with 3 findings** — see below |
| 9 | NSG attached, zero telephony ingress | **PASS** — NSG still attached to the VNIC, rule count **0** |
| 10 | NSG / Security List additivity noted | **Documented** — see note below |
| 11 | Production server + shared Security List unchanged | **PASS** — `symateq-a1` RUNNING at `144.24.119.32`, `nsg_ids` empty (untouched); shared Security List still exactly 6 ingress rules (TCP 22, ICMP ×2, TCP 8080, TCP 80, TCP 443) with **no** SIP/RTP/WireGuard entries added. All three sites verified live: calculate 200, portal 307, personal 200 |

## Note on NSG / Security List additivity (check 10)

OCI evaluates NSGs and subnet Security Lists **additively, not as an
override**. Traffic is permitted if *either* the attached NSG *or* the
subnet's Security List allows it — an empty NSG does not restrict or
revoke anything the Security List already permits.

Two practical consequences:
- SSH (TCP 22) keeps working through the shared Security List even
  though the NSG has zero rules. That is why the reboot did not risk
  lockout.
- Adding telephony rules to the NSG in Phase 2 will grant access **only
  to this instance**, and cannot widen exposure for the production
  website server that shares the same subnet and Security List. This is
  precisely why the NSG approach was chosen over editing the shared list.
- Conversely: the NSG cannot be used to *close* ports 80/443/8080 that
  the shared Security List currently leaves open. Tightening those would
  require editing the shared list, which affects the production server
  too — out of scope, flagged only.

## Findings from check 8 — require action before Phase 2

None of these are exposed to the internet right now (NSG has zero rules
and the shared Security List permits none of these ports), so there is
no live risk at this moment. All three must be resolved before any
firewall rule opens anything.

**Finding 1 — `chan_sip` is loaded and bound to `0.0.0.0:5060`.**
The deprecated SIP stack is Running alongside PJSIP, both claiming 5060.
This directly contradicts the handover's requirement to "use chan_pjsip,
not deprecated chan_sip," and an unmaintained SIP stack on a port that
will soon face the internet is exactly the sort of attack surface the
handover's safeguards exist to prevent. **Recommended: disable
`chan_sip.so` in `modules.conf` and confirm PJSIP alone owns 5060.**

**Finding 2 — `chan_iax2` listening on `0.0.0.0:4569`.**
The IAX2 protocol is entirely unnecessary for a Telnyx SIP trunk, but it
is running and bound to all interfaces. **Recommended: disable
`chan_iax2.so`.**

**Finding 3 — `containerd` still installed and running (46 MB RAM).**
Leftover from the earlier Docker removal: the purge targeted
`containerd.io` (the Docker-repo package), but this box had Ubuntu's
`containerd` package, which survived. It is loopback-only
(`127.0.0.1:46289`) so not an exposure, but it is consuming ~5% of this
954 MB server's RAM for something with no remaining purpose.
**Recommended: purge `containerd`.**

Also noted, benign: `res_hep_pjsip declined to load` (optional SIP-capture
module, not configured, harmless) and Asterisk's own ephemeral RTP ports
(`51534`, `33729`) which are normal media-stack behaviour.

## Current state

Server rebooted cleanly, all intended services recovered automatically
with no manual intervention, nothing exposed, production untouched.
Memory after reboot: 498 MB available of 954 MB.

**Stopped here as instructed.** Phase 2 not started — no external
firewall rules added, no WireGuard peers created, no Telnyx
configuration touched.
