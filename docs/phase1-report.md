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

**All three were resolved in the hardening pass below (2026-09-29).**

Wording correction: an earlier draft of this report said "nothing is
exposed because the NSG has zero rules." That is not accurate, and the
distinction matters. An empty NSG grants nothing but also **blocks**
nothing — actual exposure is the *union* of the shared Security List and
any NSG rules. Ports 80/443/8080 were therefore reachable at the cloud
network layer via the shared list (they simply had nothing listening
behind them once nginx was purged). SIP 5060 and IAX2 4569 were never
externally reachable, because neither the shared list nor any NSG
permitted those ports — which is why these findings carried no live risk
at the time, not the empty NSG by itself.

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

---

# Phase 1 hardening pass

Performed: 2026-09-29, after reboot verification. Phase 2 **not** started.

## 1. Legacy `chan_sip` removed

- `modules.conf` backed up to `/root/config-backups/<ts>-hardening/`.
- Dependency check before disabling: `sip show peers` gave 0 peers;
  `sip show channels` gave 0 active dialogs; every `Dial()` in the
  dialplan is `PJSIP/...` with no bare `SIP/` channel anywhere; and
  `sip.conf` held only the stock Ubuntu template, no configured peers.
- `noload => chan_sip.so` added to `modules.conf`; Asterisk restarted (a
  `noload` directive needs a restart, not a reload).
- Verified: `chan_sip` reports **0 modules loaded**. `res_pjsip.so` is
  still Running (use count 51) — not removed, as required. UDP 5060 is
  now owned solely by the PJSIP transport, and endpoints 101/102/telnyx
  are intact.

## 2. IAX2 removed

- Dependency check: `iax2 show peers` 0, `iax2 show channels` 0, no
  `IAX2/` references in the dialplan, `iax.conf` stock only.
- `noload => chan_iax2.so` added.
- Verified: `chan_iax2` reports **0 modules loaded**, and **UDP 4569 is
  no longer listening**.

## 3. containerd removed, after dependency checks

Checks run before touching it:

- `apt-cache rdepends --installed containerd` returned **no reverse
  dependencies**.
- `dpkg --purge --dry-run` confirmed it would remove containerd and
  nothing else.
- Docker / dockerd absent. Kubernetes tooling (kubelet, kubeadm, crictl,
  k3s) absent.
- Snaps present are core18, oracle-cloud-agent and snapd — none use
  containerd.
- `ctr containers list` empty; `ctr namespaces list` empty.
- `systemctl list-dependencies --reverse containerd.service` showed only
  `multi-user.target`, i.e. nothing requires it.

Stopped, disabled, purged. Orphan cleanup was **dry-run first**, and each
candidate was individually verified as unused before removal.

**Exactly 6 packages were removed by `apt-get autoremove`:**
`ubuntu-fan`, `bridge-utils`, `dns-root-data`, `dnsmasq-base`, `pigz`,
`runc`.

Why each was safe: the set is a closed Docker/FAN leftover cluster —
`bridge-utils` was needed only by `ubuntu-fan`, `dns-root-data` only by
`dnsmasq-base`, and `dnsmasq-base` only by `ubuntu-fan`; `pigz` and
`runc` had no dependents at all. Separately confirmed that the `dnsmasq`
service was **inactive** (DNS here is served by `systemd-resolved` on
127.0.0.53/54, unaffected) and that **no bridge interfaces existed**.
After removal: DNS still resolves, all calling services still active.

## 4. Host-level default-deny firewall

**Existing configuration was inspected first.** The backend is iptables
(nf_tables) with `iptables-persistent` already installed; `ufw` is
absent. The pre-existing IPv4 INPUT chain was Oracle's default plus two
stale rules left over from the removed nginx:

    ACCEPT established,related / ACCEPT icmp / ACCEPT lo / ACCEPT tcp 22
    ACCEPT tcp 80   (comment: http nginx)    <-- stale, removed
    ACCEPT tcp 443  (comment: https nginx)   <-- stale, removed
    REJECT everything else

IPv6 was worse: the `ip6tables` INPUT chain was **completely empty with
policy ACCEPT** — no host-level filtering at all on that stack.

**Lockout protection.** Before changing anything, the current rules were
saved and an automatic rollback was armed. The first attempt — a `nohup`
background job — silently failed to start, because its log redirect hit
a permission error, and a failed redirect prevents the command from
executing at all. This was caught by explicitly checking that the
process was running rather than trusting the "armed" message it had
printed; without that check, the firewall change would have proceeded
behind a safety net that did not exist. It was re-armed as a **systemd
transient timer** (`systemd-run --on-active=300`) and verified genuinely
active before proceeding.

**New ruleset**, applied atomically via `iptables-restore` (so there is
no window in which SSH could be dropped), for both IPv4 and IPv6:

    policy INPUT DROP        <-- true default-deny, not just a trailing REJECT
    ACCEPT established,related
    ACCEPT loopback
    ACCEPT icmp   (ipv6-icmp on v6 - required, or IPv6 neighbour discovery breaks)
    ACCEPT tcp 22 NEW        <-- SSH
    REJECT everything else

No 80, no 443, no 8080. **No SIP, RTP or WireGuard rules** — those are
deferred to the approved phase, and must be narrow when added.

**Validation:** a genuinely fresh SSH session (`ControlPath=none`, no
connection reuse) was confirmed working under the new policy *before*
the rollback timer was cancelled. Only then were the rules persisted with
`netfilter-persistent save`.

**Docker firewall remnants cleared.** The first save captured stale
Docker rules in the `nat` and `raw` tables — DNAT entries pointing at a
bridge (`br-1f40492da35c`) and container IPs (172.18.0.x) that no longer
exist. Both tables were reset to clean empty policies (nothing on this
box needs NAT — WireGuard is split-tunnel with no MASQUERADE) and
re-saved. Verified afterwards: zero Docker remnants across
filter/nat/mangle/raw.

**Reload behaviour — one defect found and fixed.** Reloading
`netfilter-persistent` re-applies `rules.v4` *without flushing*, which
**duplicated** the entire ruleset. It is functionally harmless (the first
REJECT catches everything, so the duplicate set is unreachable) but it
would grow with every reload. The rules were re-applied atomically to
de-duplicate, and the canonical ruleset is now kept on the server at
`/opt/symateq-calling/firewall-rules.v4` and `.v6` so it can always be
re-applied cleanly. For future reloads, prefer
`iptables-restore < /opt/symateq-calling/firewall-rules.v4` over
`netfilter-persistent reload`.

**Side benefit:** `rpcbind` (UDP/TCP 111) is still running as a stock
Ubuntu service, but it is now unreachable from outside, since the host
firewall does not permit it. Removing it entirely remains an optional
tidy-up rather than an exposure concern.

## 5. Post-hardening verification

| Check | Result |
|---|---|
| Asterisk active, dialplan clean | PASS — "Dialplan reloaded."; contexts: internal 4, from-softphones 6, outbound-main 3, outbound-outreach 3, from-telnyx 3 |
| PJSIP loaded | PASS — res_pjsip.so Running, use count 51 |
| chan_sip not loaded | PASS — 0 modules loaded |
| chan_iax2 not loaded | PASS — 0 modules loaded |
| UDP 4569 closed | PASS — absent from `ss` output |
| No unexpected listening ports | PASS — only 5060 (PJSIP), 51820 (WireGuard), 22 (SSH), 111 (rpcbind, now firewalled), 127.0.0.1:5038 (Asterisk AMI, loopback-only), systemd-resolved stubs, and Asterisk ephemeral RTP ports |
| WireGuard healthy | PASS — service active, wg0 up, same server key, port 51820 |
| Fail2ban jails active | PASS — asterisk + sshd |
| SSH reconnect succeeds | PASS — fresh no-reuse session verified repeatedly throughout |
| Firewall survives service reload | PASS — policy DROP and rules preserved across a netfilter-persistent reload and an Asterisk restart (duplication defect noted and fixed above) |
| NSG attached, zero rules | PASS — still attached, rule count 0 |
| Production + shared Security List untouched | PASS — symateq-a1 RUNNING at 144.24.119.32, nsg_ids empty; shared list still exactly 6 ingress rules; sites live: calculate 200, portal 307, personal 200 |

**External reachability test from outside the cloud** — the definitive
check on the inherited web exposure:

    80.225.229.192:80   -> blocked
    80.225.229.192:443  -> blocked
    80.225.229.192:8080 -> blocked
    80.225.229.192:22   -> reachable (correct)

The shared Security List still permits 80/443/8080 at the cloud layer,
unchanged as required — but the host firewall now denies them on this
instance specifically, which was the goal.

## Stopped here

No Telnyx credentials added, no public ingress rules created, the two
purchased numbers not configured, Phase 2 not started.
