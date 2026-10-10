# WebRTC echo-test change package — prepared, not applied

Prepared 11 October 2026. This is the exact, reviewed change for adding an
internal, free, WebRTC echo-test path to the live calling server. **It has
not been applied.** Applying it requires either an explicit permission grant
for remote writes in this session, or someone applying it directly. Every
command below was validated on a local Asterisk instance running the exact
same package version (`1:20.6.0~dfsg+~cs6.13.40431414-2build5` on Ubuntu
24.04), not assumed.

## What changed from the first draft, and why

The first draft of this change (committed in `stage2-live-audit-2026-10-10.md`'s
sibling discussion) was wrong in one respect: it omitted `bind=` on the new
WS transport. Asterisk's sample config comment ("TLS config for the
Websocket transport is in http.conf") reads as if nothing else needs
configuring, but `bind=` is still required — without it, the entire
`res_pjsip_transport_websocket` module failed to load, not just that one
transport object. **This was caught by testing locally first, before it
ever reached the live server.** The diffs below include the fix.

## 1. Required modules — already satisfied, nothing to install

| Module | Status on live server |
|---|---|
| `res_http_websocket.so` | Loaded, Running |
| `res_pjsip_transport_websocket.so` | Loaded, Running |
| `chan_sip.so` (legacy, would otherwise conflict on the WS `sip` subprotocol) | **Already excluded** via `noload => chan_sip.so` in `/etc/asterisk/modules.conf` — confirmed by reading it |

No module installation or modules.conf change is needed. (On a fresh local
container without that `noload` line, this conflict is real: the legacy
driver intercepts the WebSocket handshake and returns a generic "wrong
password" rejection having nothing to do with the real credentials. Confirmed
by reproducing it locally, then confirming the live server already avoids it.)

## 2. Exact diffs

### `/etc/asterisk/http.conf`

```diff
- ;enabled=yes
+ enabled=yes
  bindaddr=127.0.0.1
- ;bindport=8088
+ bindport=8088
```

`bindaddr=127.0.0.1` is already active on the live file — nothing to change
there. Binding to loopback only means this is reachable solely via an SSH
tunnel (`ssh -L 8088:127.0.0.1:8088 website`) or a command run on the server
itself — never from the public Internet, with no firewall/NSG change needed
or made.

### `/etc/asterisk/pjsip.conf` — append only

```ini
; ---------------------------------------------------------------------------
; Stage 3 prototype only. Internal WebRTC echo-test transport + endpoint.
; Rides on the HTTP server from http.conf (127.0.0.1 only). Does not modify
; transport-udp, 101, 102 or telnyx-* above it.
[transport-ws]
type=transport
protocol=ws
bind=127.0.0.1:8088

[webrtc-test]
type=aor
max_contacts=1

[webrtc-test-auth]
type=auth
auth_type=userpass
username=webrtc-test
password=<GENERATE A NEW RANDOM VALUE — do not reuse the one from local testing>

[webrtc-test]
type=endpoint
context=webrtc-test
disallow=all
allow=opus
allow=ulaw
webrtc=yes
aors=webrtc-test
auth=webrtc-test-auth
```

### `/etc/asterisk/extensions.conf` — append only

```ini
; ---------------------------------------------------------------------------
; Stage 3 prototype only. Free internal echo test, no Telnyx/PSTN cost.
[webrtc-test]
exten => 999,1,NoOp(WebRTC echo test - Stage 3 prototype)
 same => n,Answer()
 same => n,Echo()
 same => n,Hangup()
```

## 3. Activation commands, in order

```bash
sudo mkdir -p /opt/symateq-calling/pre-webrtc-test-backup-$(date +%Y%m%d-%H%M%S)
sudo cp /etc/asterisk/{http,pjsip,extensions}.conf <that backup dir>/
# then apply the three diffs above, then:

sudo asterisk -rx "module reload"      # picks up http.conf's enabled=yes
sudo asterisk -rx "pjsip reload"       # creates transport-ws, the new aor/auth/endpoint
sudo asterisk -rx "dialplan reload"    # loads the webrtc-test context
```

**Verified locally, not assumed:** `module reload` enables the previously-disabled
HTTP server with the Asterisk process's uptime unchanged (confirmed via `core
show uptime` showing `System uptime` older than `Last reload` — if it had
restarted, those would be equal). Existing PJSIP objects (the transport-ws
object itself, once created) survived the same reload untouched. Reversing
it (disabling `enabled=yes` again) was also tested and is equally
non-disruptive.

**One caveat found locally, relevant to future edits (not this change):**
`transport-udp` has no `allow_reload` set, so it defaults to `no` — Asterisk
itself refuses to hot-reload changes to an *existing* transport unless that
option is explicitly `yes`, specifically to avoid dropped calls. This change
only *creates* `transport-ws`, a new object, so that protection doesn't apply
here — but it means if `transport-ws`'s own settings ever need changing
later, that may need a restart, not just a reload.

## 4. Verification commands (run immediately after, and again a few minutes later)

```bash
sudo asterisk -rx "http show status"              # expect: Server Enabled and Bound to 127.0.0.1:8088
sudo asterisk -rx "pjsip show transports"         # expect: transport-udp AND transport-ws both listed
sudo asterisk -rx "pjsip show endpoint webrtc-test"  # expect: object exists, Unavailable (no contact yet)
sudo asterisk -rx "dialplan show webrtc-test"     # expect: exten 999 listed

# Then re-run the full original health check to prove nothing existing moved:
sudo asterisk -rx "pjsip show contacts"           # expect: 101's laptop contact still there, unchanged
sudo asterisk -rx "pjsip show registrations"      # expect: telnyx-aor still Avail
sudo systemctl show asterisk -p NRestarts,ActiveEnterTimestamp  # expect: unchanged from before this change
sudo sqlite3 /var/log/asterisk/master.db "SELECT start_time,disposition FROM cdr ORDER BY start_time DESC LIMIT 1;"
                                                    # expect: no new failure-type rows caused by this change
```

## 5. Rollback

```bash
sudo cp <backup-dir>/http.conf /etc/asterisk/http.conf
sudo cp <backup-dir>/pjsip.conf /etc/asterisk/pjsip.conf
sudo cp <backup-dir>/extensions.conf /etc/asterisk/extensions.conf
sudo asterisk -rx "module reload"
sudo asterisk -rx "pjsip reload"
sudo asterisk -rx "dialplan reload"
# then re-run the verification commands above and confirm they match the
# pre-change baseline again.
```

Rollback was tested in both directions locally (enable, then disable again
via reload) — both non-disruptive, no restart, on this exact Asterisk build.

## 6. What this does NOT yet prove

Local testing (see `local-asterisk-test/` and `symateq-connect-prototypes/
local-asterisk-webclient/`) proved full SIP signaling end-to-end against
this exact config: REGISTER succeeds, INVITE to the echo extension is
answered, BYE tears down cleanly — all against a real, unmodified copy of
this diff running the identical Asterisk package version.

**It did not prove actual two-way audio**, because the local test runs this
Asterisk instance inside a Docker container reachable from the test browser
only through Docker's bridge NAT, and Asterisk's ICE candidates reflect its
own container-internal address (`172.17.0.2`), which the browser cannot
reach — connections stayed in `ICE checking`, confirmed via the browser's
own `RTCPeerConnection.getStats()`. This is a NAT artifact of the test
topology, not a defect in the Asterisk config: the live server has a single
real public IP, already set as `external_media_address` on the existing
`transport-udp`, with no such NAT layer in between. The same setup is
expected to let ICE connect normally there — but that is an expectation to
verify on the live server itself (or from a machine with a direct, non-NAT'd
path to it), not something this local test can establish.
