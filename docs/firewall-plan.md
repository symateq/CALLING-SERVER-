# Firewall plan — Phase 2 (not yet applied)

Status as of 2026-09-29: **planned only**. The NSG below is created and
attached but still has zero rules. Nothing in this document has been
applied to any firewall yet — this is the plan for when Phase 2 is
explicitly approved.

## Network isolation model

Per correction from the user: a dedicated OCI **Network Security Group**
(NSG) is attached to the calling instance's VNIC, not the shared subnet
Security List. The two stack additively (OCI allows traffic permitted by
*either*), so:
- SSH (port 22) keeps working via the existing shared Security List —
  untouched.
- Every calling-specific rule goes into the NSG only, scoped to this one
  instance. The website server sharing the subnet is never affected by
  anything added here.

NSG: `symateq-calling-server-nsg`
(`ocid1.networksecuritygroup.oc1.ap-mumbai-1.aaaaaaaalmum27diim46zndi2nwbsv2gnp3bmc6a2jnvlaw4utnkvg7ts5yq`)
— currently 0 rules.

## Rules planned for Phase 2, in the handover's specified order

1. **SSH** — already covered by the shared Security List; no NSG rule
   needed.
2. **WireGuard**: `UDP 51820` from `0.0.0.0/0` (a VPN's whole point is
   being reachable from anywhere the user might be — India Wi-Fi, mobile
   data, etc. Security comes from WireGuard's own crypto handshake, not
   from restricting the source IP.)
3. **Softphone SIP**: not a public rule at all — extensions register at
   Asterisk's WireGuard address (10.66.66.1), reachable only once already
   inside the VPN. No NSG rule needed for this specifically; it rides on
   the VPN subnet already being able to reach the box once WireGuard is
   open.
4. **Telnyx SIP signaling**: `UDP 5060` (and `5061` if TLS is used) from
   Telnyx's *currently published* SIP signaling IP ranges only — must be
   fetched fresh from Telnyx's own docs/portal at Phase 2 implementation
   time (URL + fetch date recorded here when done), never guessed or
   reused from an old list.
5. **Telnyx RTP (call audio)**: a defined UDP port range (handover
   suggests aligning with `10000-20000/udp`, adjustable to whatever range
   Asterisk's `rtp.conf` actually uses) from Telnyx's published RTP
   ranges **and** the WireGuard subnet (`10.66.66.0/24`) — call audio
   flows through Asterisk from both directions (trunk side and softphone
   side).
6. **Explicitly NOT exposed**: AMI, ARI, any HTTP admin interface,
   database ports, or raw SIP registration from the public internet.
   `5060/udp` is never opened to `0.0.0.0/0` — only to Telnyx's specific
   ranges.
7. Outbound (egress) stays open for DNS, NTP, HTTPS and Telnyx traffic —
   OCI NSGs default-allow all egress unless a rule restricts it, so no
   explicit egress rules are needed unless tightening is wanted later.

## Not done yet, on purpose

- Telnyx's IP ranges haven't been fetched (no Telnyx account work has
  started — Phase 4).
- The exact RTP port range should be confirmed against `/etc/asterisk/rtp.conf`
  (not yet customized from its default) before locking the NSG rule to a
  specific range.
- `51820/udp` is the only rule that could safely be added right now
  without any external dependency — held back anyway per the approval to
  "keep it empty or deny-by-default... do not expose SIP/RTP publicly yet."
