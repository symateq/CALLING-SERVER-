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

## Run the signaling test

```bash
cd webclient
npm install
npx playwright install chromium
npm test
```

Uses SIP.js (MIT) in headless Chromium with `--use-fake-device-for-media-stream`
so no real microphone/speaker is needed. Confirms REGISTER, INVITE, answer,
and BYE against the echo extension (999).

## Known limitation: this does not prove two-way audio

Asterisk's ICE candidates reflect the container's internal Docker bridge
address (`172.17.0.2`), which the host-side browser cannot reach — even with
the RTP port range published and a public STUN server configured, the
connection stays in `ICE checking`. This is a NAT artifact of testing a
containerized Asterisk from the host, not a defect in the config itself; see
`docs/stage3-webrtc-change-package.md` section 6 for why the live server
(real public IP, no Docker NAT) isn't expected to hit the same wall.

If a future session wants to close this gap locally rather than on the live
server, the most direct paths are: running the test browser inside the same
Docker network namespace as Asterisk (another container, not the Windows
host), or using `docker network create` with a macvlan/ipvlan driver so the
container gets a real LAN-routable address instead of bridge-NAT'd one.
Neither was attempted here.
