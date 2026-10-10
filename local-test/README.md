# Local Asterisk test harness

Reproduces the exact live-server Asterisk package
(`1:20.6.0~dfsg+~cs6.13.40431414-2build5`, Ubuntu 24.04) in a disposable
Docker container, to validate config changes before they ever touch the
live server. Used to validate `docs/stage3-webrtc-change-package.md`.

## Run it

```bash
cd local-test
docker build -t symateq-local-asterisk-test .
docker run -d --name symateq-local-asterisk-test \
  -p 127.0.0.1:18088:8088 \
  -p 127.0.0.1:20000-20010:20000-20010/udp \
  symateq-local-asterisk-test

docker exec symateq-local-asterisk-test asterisk -rx "pjsip show transports"
docker exec symateq-local-asterisk-test asterisk -rx "http show status"
```

## Run the signaling + real two-way-audio test

The test client runs in its own container, on the **same Docker network**
as Asterisk — not from the Windows host. This matters: an earlier attempt
running the browser on the host hit Docker's bridge NAT (Asterisk advertised
its container-internal address, `172.17.0.2`, which the host couldn't
reach — ICE stayed stuck in `checking`, 0 packets, even with the RTP port
range published and a public STUN server configured). Putting both
containers on one user-defined network removes that NAT boundary entirely.

```bash
docker network create symateq-local-test-net

docker run -d --name symateq-local-asterisk-test --network symateq-local-test-net \
  symateq-local-asterisk-test   # built from local-test/ as above

cd webclient
docker build -t symateq-local-webclient-test .
docker run --rm --network symateq-local-test-net \
  -e WS_SERVER=ws://symateq-local-asterisk-test:8088/ws \
  symateq-local-webclient-test
```

Uses SIP.js (MIT) in headless Chromium (via the official
`mcr.microsoft.com/playwright` image) with `--use-fake-device-for-media-stream`
so no real microphone/speaker is needed. `run-test.mjs` confirms REGISTER,
INVITE, answer and BYE, then reads the browser's own
`RTCPeerConnection.getStats()` to confirm real bidirectional RTP
(`inbound-rtp`/`outbound-rtp` packet counts, not just that the call
"answered"). Cross-check independently from Asterisk's side with
`pjsip show channelstats` mid-call.

`run-reload-safety-test.mjs` holds a call, snapshots packet counts, applies
the real `module reload`/`pjsip reload`/`dialplan reload` sequence from
`docs/stage3-webrtc-change-package.md` **while that call is still active**
(run the three `docker exec ... asterisk -rx ...` commands from the host,
timed a few seconds into the script's run), then confirms the call stayed
`connected` with packets still growing, and that a fresh second call placed
immediately after also works.
