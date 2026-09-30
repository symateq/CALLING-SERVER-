# Phase 2 report — Telnyx trunk preparation

Completed: 2026-09-29. **Stopped before any Telnyx portal action or test
call.** No WireGuard peers created.

## 1. Telnyx network data — retrieved, not assumed

Retrieved **2026-09-29** from Telnyx's own sources:

| Source | URL |
|---|---|
| Machine-readable feed (authoritative) | https://sip.telnyx.com/voice.json |
| Human-readable page | https://sip.telnyx.com/ |
| IP whitelisting doc | https://developers.telnyx.com/docs/voice/sip-trunking/network-configuration/ip-whitelisting |
| Connection types doc | https://support.telnyx.com/en/articles/4245868-sip-connection-types |

The JSON feed carries **version `2026-05-25T00:00:00Z`**.

**Discrepancy found and handled:** the HTML page lists **14** media
CIDRs; the JSON feed lists **16**, adding `64.16.246.96/27` and
`64.16.246.128/26`. The JSON superset was used — a missing media range
does not fail loudly, it produces one-way audio on a subset of calls,
which is far harder to diagnose later.

### SIP signalling — US region only

| Purpose | Address |
|---|---|
| US signalling primary (sip.telnyx.com) | `192.76.120.10` |
| US signalling secondary | `64.16.250.10` |
| US UAC (inbound call origination) | `192.76.120.14` |

The UAC address matters: Telnyx originates **inbound** calls from it.
Allowing only the two signalling addresses would have let outbound work
while inbound INVITEs were silently dropped.

EU/AU/CA/ME/AP signalling addresses were deliberately **not** allowed —
this is a US-only deployment.

### Media / RTP CIDRs (all 16, per the JSON feed)

```
36.255.198.128/25   50.114.136.128/25   50.114.144.0/21    64.16.226.0/24
64.16.227.0/24      64.16.228.0/24      64.16.229.0/24     64.16.230.0/24
64.16.246.96/27     64.16.246.128/26    64.16.248.0/24     64.16.249.0/24
103.115.244.128/25  103.115.247.0/24    185.246.41.128/25  185.246.42.128/28
```

Telnyx publishes these as one **global** list with no regional
attribution. Rather than guess which subset serves US calls, all 16 are
allowed. Narrowing further would require Telnyx to confirm regional
attribution — guessing here would cause intermittent one-way audio.

Telnyx's own RTP range is 16384–32768; ours is 10000–20000 (what we
listen on). These are independent and both correct.

## 2. Authentication choice — IP, no deviation

IP authentication against the reserved public IP `80.225.229.192`, as
instructed. Telnyx's own guidance is that IP authentication suits static
deployments and credentials suit dynamic IPs; this server has a
permanent reserved IP, so IP auth is both the recommended and the more
secure option — there is no SIP password in existence to leak, rotate or
commit by accident. **No deviation was needed and none was made.**

## 3. Portal configuration — prepared, awaiting your action

Full click-by-click steps are in
[telnyx-portal-checklist.md](telnyx-portal-checklist.md), containing no
secrets. Values prepared: connection `SYMATEQ-ASTERISK`, IP auth to
`80.225.229.192:5060`, profile `SYMATEQ-US-OUTBOUND`, US-only
destinations, concurrent limit 1, conservative spend caps, emergency
calling disabled, both DIDs bound to the connection, messaging left
unassigned.

## 4. Firewall — narrow, on both layers

**Dedicated NSG** (`symateq-calling-server-nsg`), 19 ingress rules:
3 × UDP 5060 from the US signalling/UAC addresses, 16 × UDP 10000–20000
from the media CIDRs. Nothing from `0.0.0.0/0` or `::/0`.

**Host firewall**, mirrored: 23 ACCEPT rules + terminal REJECT, policy
`INPUT DROP` on both IPv4 and IPv6.

Applied behind a verified systemd rollback timer, with a fresh
no-reuse SSH session validated before the timer was cancelled, then
persisted.

Verified externally from outside the cloud:

```
80.225.229.192:80   -> blocked      :4569 -> blocked
80.225.229.192:443  -> blocked      :22   -> reachable (correct)
80.225.229.192:8080 -> blocked
```

WireGuard's 51820 remains **closed** — it opens only in the approved
softphone phase. IPv6 has no SIP/RTP rules at all and stays default-deny.

## 5. Asterisk trunk configuration

- Transport declares `external_media_address` / `external_signaling_address`
  = `80.225.229.192`. Necessary: OCI uses 1:1 NAT, so the OS only sees
  `10.0.0.160` and would otherwise advertise an unroutable address in SDP
  and receive no audio. `local_net` covers the VCN and WireGuard subnets
  so those are not rewritten.
- Trunk endpoint `telnyx`: no auth section at all (IP authenticated),
  codecs **ulaw + g722**, `direct_media=no`, `rtp_symmetric=yes`,
  `force_rport=yes`, `rewrite_contact=yes`. `strictrtp=yes` set globally.
- `telnyx-identify` matches exactly the three US Telnyx addresses.
- Inbound: `+14077511755` → extension 101, `+14077511178` → extension 102,
  each matched in `+1…`, `1…` and bare 10-digit form because Telnyx may
  present any of them. Unknown DIDs rejected.
- Outbound caller ID is **overwritten by the dialplan** on every call
  rather than trusted from the softphone: 101 presents +14077511755,
  102 presents +14077511178.
- `from-telnyx` includes no outbound context, so the trunk cannot be
  used as an inbound-to-outbound relay.

## 6. Safety controls

- **One concurrent outbound call** — enforced by `GROUP_COUNT` in the
  dialplan, matching the portal-side limit of 1.
- **60-minute hard cap** per call via `L(${MAXCALLMS})`.
- **Do-not-call** check before every outbound dial, backed by astdb
  (`database put dnc +1XXXXXXXXXX 1` to suppress a number).
- **CDR for every attempt**, including blocked and rejected ones — each
  path stamps `CDR(userfield)` (`OUT_MAIN`, `IN_OUTREACH`,
  `BLOCKED_DNC`, `REJECTED_AREACODE_900`, …).
- **No automatic dialling and no automatic retries** anywhere.

### Defect found and fixed: CDR was silently not recording

`cdr_sqlite3_custom` had been **declining to load since Phase 1** —
the Phase 1 config used an invented `field => value` syntax instead of
the module's actual `columns =>` / `values =>` format, so Asterisk
logged "Column names not specified. Module not loaded." and no CDR was
written at all. Rewritten correctly; the module is now **Running** and
registered as a backend.

Second, smaller trap hit while fixing it: pre-creating the `cdr` table
by hand causes the module to abort with "table cdr already exists" — it
creates its own table and treats a pre-existing one as fatal. The table
was dropped and the module now owns it.

## 7. WireGuard peers — not created

No client peers exist and no private key has been printed, committed or
transmitted. Peer generation happens after the trunk test, per
instruction, using a procedure where each device's private key is
generated on the device or on the server and delivered out-of-band,
never through chat or Git.

## 8. Verification results

| Check | Result |
|---|---|
| Asterisk config validation | **PASS** — `dialplan reload` clean, no errors |
| PJSIP endpoint / AOR / identify | **PASS** — 101, 102, telnyx present; identify matches the 3 US addresses; AOR contact `sip:sip.telnyx.com:5060` |
| Firewall source restrictions | **PASS** — NSG 19 rules, host 23, none from 0.0.0.0/0 or ::/0 |
| No legacy chan_sip / IAX2 | **PASS** — both report 0 modules loaded |
| No unexpected listeners | **PASS** — 5060 (PJSIP), 51820 (WireGuard, firewalled), 22 (SSH), 111 (rpcbind, firewalled), 127.0.0.1:5038 (AMI, loopback only), Asterisk ephemeral RTP. No 4569 |
| Inbound DID routing | **PASS** — both DIDs in 3 formats → correct extensions; unknown DIDs rejected |
| Outbound caller-ID | **PASS** — set per-extension at both endpoint and dialplan level |
| US-only rejection | **PASS with a real gap found and closed** — see below |
| Production + shared Security List unchanged | **PASS** — production `nsg_ids` empty, shared list still exactly 6 rules, 0 telephony rules leaked; all three sites live (200/307/200) |

### Serious gap found during the US-only tests

The original `_+1NXXNXXXXXX` pattern is **not** sufficient for "United
States only", and testing proved it:

- `+19005551234` — a **1-900 premium** number — matched the ordinary US
  pattern and would have been dialled. `NXX` accepts `9`, so area code
  900 passes straight through.
- `+14079765551` — a **976 premium exchange** — likewise passed.
- The same hole admits **non-US NANP** destinations. Caribbean countries
  share the North American numbering plan, so `+1809…` (Dominican
  Republic), `+1876…` (Jamaica), `+1649…` (Turks & Caicos) are
  indistinguishable from US numbers by pattern alone while billing at
  international premium rates. This is the single most exploited
  toll-fraud route and would have directly violated "United States only".

Closed by routing every outbound call through a new `outbound-validate`
choke point that extracts the area code and exchange and checks both
against blocklists in astdb (`blockedac/`, `blockedex/`).

Blocked: premium/non-geographic `900, 976, 700, 500, 521–529, 533, 544,
566, 577, 588`; non-US NANP `242, 246, 264, 268, 284, 345, 441, 473,
649, 658, 664, 721, 758, 767, 784, 809, 829, 849, 868, 869, 876`.

Deliberately **not** blocked, because they are the United States:
`787`/`939` Puerto Rico, `340` US Virgin Islands, `671` Guam, `670`
Northern Mariana Islands, `684` American Samoa. Verified allowed.

Verified after the fix: 900/976/700/809/876/649/868 → blocked;
408/212/407/787/939/340/671 → allowed; `011…`, `911`, `+44…` → rejected
before normalisation.

## Stopped here

No Telnyx portal changes made, no test call placed, no WireGuard peers
created, no credentials anywhere. Awaiting portal configuration.

---

# Phase 2 — post-portal server-side verification

Run: 2026-09-30, after the Telnyx portal was configured.
**No PSTN test call placed. No WireGuard peers created.**

## Headline result: the trunk is live at the SIP layer

```
Contact: telnyx-aor/sip:sip.telnyx.com:5060   Avail   RTT 322-324 ms
```

This is real bidirectional confirmation — our OPTIONS reach Telnyx and
Telnyx answers. It proves the IP authentication, the portal-side
connection, the reserved IP and the firewall rules all line up. Before
the portal was configured this contact sat at `NonQual`.

## Checklist results

| # | Check | Result |
|---|---|---|
| 1 | Back up Asterisk + firewall config | **DONE** — `/root/config-backups/20260930-031922-pre-telnyx-test/` holds pjsip, extensions, rtp, modules, cdr, voicemail, jail.local, both iptables rulesets and an astdb dump |
| 2 | Telnyx endpoint / AOR / identify | **PASS** — endpoint `telnyx`, context `from-telnyx`, no auth section (IP authenticated), `direct_media=false`, `rtp_symmetric=true`, `force_rport=true`, `rewrite_contact=true`; AOR contact `Avail`; identify matches exactly the 3 US addresses |
| 3 | Telnyx sources match firewall | **PASS** — feed re-fetched, still version `2026-05-25`, unchanged. All 3 signalling/UAC addresses and all 16 media CIDRs present; 3 signalling + 16 media rules installed; no rule permits `0.0.0.0/0` or `::/0` |
| 4 | Inbound DID routing | **PASS** — `+14077511755`/`14077511755`/`4077511755` → `inbound-main` → extension 101; `+14077511178`/`14077511178`/`4077511178` → `inbound-outreach` → extension 102; both with voicemail fallback; unknown DIDs rejected |
| 5 | Ext 101 outbound caller ID | **PASS** — endpoint `"SYMATEQ Support" <+14077511755>`, and the dialplan re-sets `CALLERID(num)=${MAIN_DID}` on every outbound call rather than trusting the softphone |
| 6 | Ext 102 outbound caller ID | **PASS** — endpoint `"SYMATEQ Outreach" <+14077511178>`, dialplan sets `CALLERID(num)=${OUTREACH_DID}` |
| 7 | G711U/G711A codec compatibility | **MISMATCH FOUND AND FIXED** — see below |
| 8 | International / Caribbean / 900 / 976 blocked | **PASS** — verified at runtime, see table below |
| 9 | CDR + Fail2ban active | **PASS** — `cdr_sqlite3_custom` Running and registered, `master.db` present (0 rows, correct — no calls yet); Fail2ban active with both `asterisk` and `sshd` jails, 0 failed, 0 banned |
| 10 | Config reloads without errors | **PASS** — `core reload` clean; nothing but benign unconfigured-module notices (LDAP, phoneprov, ARI) |
| 11 | Report and stop before PSTN test | **This document. Stopped.** |
| 12 | No WireGuard peers / softphone ports | **CONFIRMED** — no peers exist, 51820 still blocked externally |

## Item 7 — codec mismatch found and corrected

The portal was configured with **G711U + G711A**. The server was still
carrying the earlier spec, **ulaw + G722**. The only overlap was ulaw.

Two concrete problems with leaving it:

- **G722 was dead weight on the trunk.** Telnyx has it disabled, so
  every outbound SDP would offer a codec the far end always rejects.
- **G711A (alaw) was missing on our side.** Calls worked on ulaw, but
  with no fallback — if Telnyx ever needed alaw, the call would fail
  with `488 Not Acceptable Here` rather than degrade gracefully.

Corrected: trunk **and** both extensions are now `ulaw, alaw`, with ulaw
first. This matches the portal exactly, keeps ulaw as the preferred US
codec, and means PSTN calls negotiate ulaw end to end with **no
transcoding** — which matters on a 1-OCPU box.

G722 was dropped rather than kept alongside. It only had value for
internal 101↔102 calls, and keeping it would have reintroduced
transcoding on any call that bridged to the PSTN leg.

Trunk re-verified after the change: still `Avail`, RTT 322 ms.

## Item 8 — blocked-route verification (runtime, not just config)

Verified by evaluating the live lookups the dialplan actually performs:

```
DB(blockedac/900) -> "premium-or-nongeographic"   (non-empty => blocked)
DB(blockedac/408) -> ""                            (empty     => allowed)
DB(blockedex/976) -> "premium-exchange"            (non-empty => blocked)
```

| Destination | Type | Result |
|---|---|---|
| +1 900 555 1234 | premium 900 | BLOCKED (area code) |
| +1 407 976 5551 | premium 976 exchange | BLOCKED (exchange) |
| +1 700 555 1234 | carrier-specific 700 | BLOCKED (area code) |
| +1 809 555 1234 | Caribbean NANP — Dominican Republic | BLOCKED |
| +1 876 555 1234 | Caribbean NANP — Jamaica | BLOCKED |
| +1 649 555 1234 | Caribbean NANP — Turks & Caicos | BLOCKED |
| +1 868 555 1234 | Caribbean NANP — Trinidad | BLOCKED |
| +1 408 555 1234 | US mainland | allowed |
| +1 787 555 1234 | US territory — Puerto Rico | allowed |
| +1 340 555 1234 | US territory — US Virgin Islands | allowed |
| 011 44 20 7123 4567 | international dial-out prefix | rejected pre-normalisation |
| 911 | emergency | rejected pre-normalisation |
| +44 1234 567890 | non-NANP E.164 | no match — rejected |
| 00 44 1234 | international prefix | rejected pre-normalisation |

Emergency calling is disabled portal-side as well, so 911 is refused at
both layers. This service must not be relied on for emergencies.

## Note on firewall hit counters

The Telnyx-specific firewall rules currently show **zero packet hits**,
which is correct and not a fault. Our OPTIONS go outbound, and Telnyx's
replies return on an existing conntrack flow, so they match the
`RELATED,ESTABLISHED` rule first. The Telnyx source rules will only
register hits when Telnyx *initiates* a flow toward us — i.e. the first
inbound call, which has not happened yet. They are correctly positioned
for that.

## Note on historical log errors

`messages.log` contains `Function premium-exchange not registered`
errors timestamped Sep 29 18:53. These are artifacts of a verification
command of mine whose shell escaping was mangled, so Asterisk received a
literal string where a function reference was intended. They are not a
dialplan defect. Errors strictly after the most recent reload are clean.

## Current state

| Item | State |
|---|---|
| Trunk | `Avail`, RTT ~322 ms, idle (`Not in use`) |
| Extensions 101 / 102 | `Unavailable` — correct, no softphone registered yet (Phase 5) |
| Codecs | ulaw, alaw — matching the portal exactly |
| Concurrency | 1 outbound call, enforced both server-side and portal-side |
| Call cap | 60 minutes hard limit |
| CDR | Recording enabled, 0 rows (no calls yet) |
| Firewall | 19 NSG rules + 23 host rules, all source-restricted; 80/443/8080/4569/51820 confirmed blocked externally; 22 reachable |
| IPv4 / IPv6 policy | Both `DROP` |
| Production isolation | `symateq-a1` untouched, `nsg_ids` empty, shared Security List still exactly 6 rules; all three sites live (200 / 307 / 200) |

## Stopped

No inbound or outbound PSTN test call placed. No WireGuard peers
created. No softphone registration ports exposed. Awaiting approval to
proceed to call testing.
