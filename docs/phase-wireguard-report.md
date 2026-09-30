# WireGuard client-access phase — verification report (redacted)

Completed: 2026-09-30. **No PSTN call placed.**

This report contains no private keys, passwords, QR codes or complete
client configurations, by design.

## Secret handling

Every secret was generated **on the server**, under `umask 077` in a
root-only directory (`/root/wg-clients`, mode 0700), and never rendered
to terminal output at any point.

Delivery was file-to-file: server → your laptop at
`C:\oci\symateq-calling-secrets\`, which sits outside this repository.
The staging copies used for transfer were `shred`ed afterwards.

The repo now carries a `.gitignore` blocking `*.conf`, `*.key`, `*.png`,
`*credential*`, `*password*` and the specific client filenames, so these
cannot be committed by accident.

Delivered (sizes only):

| File | Size | Purpose |
|---|---|---|
| `symateq-laptop.conf` | 413 B | Windows WireGuard import |
| `symateq-mobile.conf` | 413 B | Android WireGuard import (QR backup) |
| `symateq-mobile-qr.png` | 1388 B | Android QR — valid PNG, 231×231 |
| `sip-credentials.txt` | 972 B | SIP settings for 101 and 102 |

Server-side copies remain in `/root/wg-clients` (root-only) **until you
confirm both imports work**. Deleting them before that would mean
regenerating on failure. Say the word once imported and I will shred
them — the server does not need client private keys, only the public
keys already in `wg0.conf`.

## Peers created — exactly two

| Peer | VPN address | Key pair |
|---|---|---|
| `symateq-laptop` | `10.66.66.2/32` | unique, generated for this device |
| `symateq-mobile` | `10.66.66.3/32` | unique, generated for this device |

Both are live on the server interface. Public keys are not secret; the
server holds only those.

```
interface: wg0   10.66.66.1/24   listening port 51820
  peer O0fmNmER…  allowed ips 10.66.66.2/32     (laptop)
  peer JGFF2nRW…  allowed ips 10.66.66.3/32     (mobile)
```

Client configs use **split tunnelling** (`AllowedIPs = 10.66.66.0/24`),
so only VPN-subnet traffic is routed — normal internet use on those
devices is unaffected — plus `PersistentKeepalive = 25` to survive
carrier NAT timeouts on mobile data.

## Firewall

**Dedicated OCI NSG — now 20 rules** (was 19):

| Rule | Source |
|---|---|
| UDP 51820 (WireGuard) | `0.0.0.0/0` |
| UDP 5060 ×3 (Telnyx) | the 3 US Telnyx addresses **only** — unchanged |
| UDP 10000-20000 ×16 (Telnyx media) | the 16 published media CIDRs — unchanged |

**Host firewall**, mirrored, policy `INPUT DROP` on IPv4 and IPv6:

```
udp 51820                      from anywhere      (WireGuard)
udp 5060      -i wg0 -s 10.66.66.0/24             (softphone SIP, VPN only)
udp 10000-20000 -i wg0 -s 10.66.66.0/24           (softphone RTP, VPN only)
icmp          -i wg0 -s 10.66.66.0/24             (VPN ping/diagnostics)
udp 5060      from the 3 Telnyx US addresses      (trunk)
udp 10000-20000 from the 16 Telnyx media CIDRs    (trunk media)
tcp 22                                            (SSH)
everything else                                   REJECT
```

Note the softphone rules are bound to **both** `-i wg0` *and*
`-s 10.66.66.0/24`. Source-matching alone would let a spoofed
`10.66.66.x` packet arriving on the public interface through; requiring
the interface as well closes that.

**SIP 5060 is not reachable from the general internet.** Its only
permitted sources are the WireGuard interface and the three Telnyx
addresses.

Externally verified after the change: 80, 443, 8080, 4569 all blocked;
22 reachable. (UDP cannot be probed by TCP connect, so 5060/51820 were
verified by rule inspection instead.)

Applied behind a verified systemd rollback timer, with a fresh
no-reuse SSH session validated before the timer was cancelled, then
persisted.

## Asterisk

| Item | State |
|---|---|
| `101-aor` max_contacts | **2** (laptop + mobile) |
| `102-aor` max_contacts | **2** (laptop + mobile) |
| SIP passwords | separate, unique, 28 chars each, generated server-side. Placeholder count now **0** |
| Codec order | `ulaw, alaw` on 101, 102 and the trunk — preserved exactly |
| Caller ID 101 | `"SYMATEQ Support" <+14077511755>` — preserved |
| Caller ID 102 | `"SYMATEQ Outreach" <+14077511178>` — preserved |
| Reload | clean, service active |

Caller ID remains enforced by the dialplan on every outbound call, so a
softphone cannot present anything other than its own assigned DID.

## Verification results

| Check | Result |
|---|---|
| Two peers, unique keys and IPs | **PASS** — `10.66.66.2`, `10.66.66.3`, distinct key pairs |
| No secrets printed or committed | **PASS** — generated under `umask 077`, never echoed; `.gitignore` added; delivery was file-to-file |
| UDP 51820 open on NSG + host | **PASS** — one rule each |
| SIP 5060 blocked from general internet | **PASS** — sources are wg0 + 3 Telnyx addresses only |
| Telnyx access preserved | **PASS** — 3 signalling + 16 media rules unchanged; trunk still `Avail`, RTT 314 ms |
| Softphone SIP/RTP via VPN only | **PASS** — interface- and source-matched |
| 101 / 102 support two contacts | **PASS** — max_contacts 2 on both |
| Separate strong SIP passwords | **PASS** — 28 chars each, distinct |
| Codec order ulaw, alaw | **PASS** — all three endpoints |
| Caller-ID mappings | **PASS** — both preserved |
| Windows .conf produced | **PASS** — delivered, structure validated |
| Android QR produced | **PASS** — valid PNG 231×231, delivered |
| SIP settings prepared | **PASS** — server `10.66.66.1`, port 5060, UDP, per-extension credentials |
| Asterisk reload | **PASS** — clean |
| Registration capacity | **PASS** — 4 total (2 per extension); 0 registered, correct, nothing has connected yet |
| Production untouched | **PASS** — shared Security List still 6 rules, production `nsg_ids` empty, all three sites live |
| No PSTN call placed | **CONFIRMED** |

## Current state

Extensions show `Unavailable` and contacts show 0 — correct, because no
softphone has imported the config and registered yet. That is the next
step, and it is yours: see
[softphone-runbook.md](softphone-runbook.md).

Suggested first action after import is extension **600** (echo test) —
it proves two-way audio through the VPN without involving Telnyx and
without any call cost.

## Stopped

Client import instructions provided, redacted verification report
complete. No PSTN test call placed, inbound or outbound.

---

## Addendum — registration failure diagnosed and fixed (2026-09-30)

MicroSIP on the laptop showed **Not Found** (SIP 404) when registering
extension 101. Diagnosed read-only first.

**Everything except the final step was working.** The log pinpointed it:

```
WARNING res_pjsip_registrar.c: AOR '' not found for endpoint '101' (10.66.66.2:59000)
```

- WireGuard peer had handshaked, 2.80 KiB transferred
- Firewall counter showed the REGISTER arriving: 1 packet / 585 bytes on
  `wg0 -> udp 5060`
- **Endpoint `101` was identified successfully** — username, auth and
  identification were all correct
- Only the AOR lookup failed

**Cause — server-side, my error.** The AORs were named `101-aor` /
`102-aor`, but PJSIP's registrar resolves the AOR by the user part of the
registration URI, so it requires an AOR named literally `101`. The
mismatch produced a 404 regardless of what the client sent.

**Fix.** Backed up `pjsip.conf`, renamed the AOR objects to `101` / `102`,
updated the endpoints' `aors=` references, reloaded PJSIP. Endpoint and
AOR now share a name, which is Asterisk's canonical pattern — sorcery
keys objects by type, so the duplicate section name is correct and loaded
without error.

**Verified:**

```
Contact:  101/sip:101@10.66.66.2:59000   registered
Endpoint: 101/+14077511755               Not in use   (was Unavailable)
```

No registrar errors since. Auth, codecs (`ulaw|alaw`), both caller-ID
mappings, `max_contacts=2` and the Telnyx trunk (`Avail`, 311 ms) all
unaffected.

**A hypothesis of mine that proved wrong:** the empty AOR name in the log
led me to suggest MicroSIP might also be sending a registration URI with
no user part, needing a client-side field change. The registered contact
URI is `sip:101@10.66.66.2`, so MicroSIP was sending a correct user part
all along. The empty string was Asterisk reporting the failed lookup, not
a malformed client request. **No MicroSIP change was needed** — the
server-side rename was the complete fix.

### Open item, not changed

AOR `101` has `qualify_frequency = 0`, so its contact shows `NonQual`.
Not an error — it means Asterisk does not actively probe the softphone.
The consequence is that a contact which disappears ungracefully (laptop
sleeps, VPN drops) stays listed until the registration expires, so an
inbound call could ring a dead contact. Enabling qualify on 101/102 is a
small change and worth doing before live use; left alone here pending
approval.

No PSTN call placed. No password or digest authorisation data exposed —
the PJSIP logger was enabled briefly, captured nothing (MicroSIP had
stopped retrying after the 404), and was switched off again.
