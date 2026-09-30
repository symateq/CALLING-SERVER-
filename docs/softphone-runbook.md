# Softphone runbook — WireGuard + SIP client import

**Your files are on your laptop at:**

```
C:\oci\symateq-calling-secrets\
    symateq-laptop.conf        <- Windows WireGuard config
    symateq-mobile.conf        <- Android WireGuard config (backup to the QR)
    symateq-mobile-qr.png      <- Android: scan this
    sip-credentials.txt        <- SIP usernames/passwords for 101 and 102
```

That folder is deliberately **outside** this Git repository, and the repo's
`.gitignore` blocks these filenames from ever being committed. Nothing in
this document contains a private key or password.

> **Golden rule:** the VPN must be connected *before* the softphone will
> register. The SIP server address is `10.66.66.1` — a private VPN
> address. It is unreachable from the public internet by design.

---

## Part 1 — Windows laptop

### 1a. Install and import WireGuard

1. Install WireGuard for Windows from **wireguard.com/install**
2. Open it → **Add Tunnel** → **Import tunnel(s) from file**
3. Select `C:\oci\symateq-calling-secrets\symateq-laptop.conf`
4. Click **Activate**

It should show **Active**, with a handshake appearing within a few
seconds. If "Latest handshake" stays blank, the tunnel is not up — see
troubleshooting below.

### 1b. Confirm the tunnel works

Open PowerShell and run:

```
ping 10.66.66.1
```

Replies mean the VPN is working. No replies means stop here — the
softphone will not register either.

### 1c. Install and configure the softphone

Use **MicroSIP** (lightweight, Windows) or **Zoiper**. Settings, from
`sip-credentials.txt`:

| Field | Value |
|---|---|
| SIP server / domain | `10.66.66.1` |
| Port | `5060` |
| Transport | `UDP` |
| Username / Auth ID | `101` (or `102`) |
| Password | see `sip-credentials.txt` |
| Codecs | enable **G711u (PCMU)** and **G711a (PCMA)** only — disable everything else |
| DTMF | RFC 2833 |

---

## Part 2 — Android phone

### 2a. Import the VPN

1. Install **WireGuard** from the Play Store
2. Tap **+** → **Scan from QR code**
3. Scan `symateq-mobile-qr.png` (open it on your laptop screen)
4. Name it `symateq` and toggle it **on**

If the QR will not scan, copy `symateq-mobile.conf` to the phone and use
**Import from file** instead.

### 2b. Install and configure the softphone

Use **Linphone** or **Zoiper** from the Play Store. Same settings as the
laptop, but use the **other extension** if you want laptop and phone on
separate lines — or the *same* extension on both, which is supported
(each extension accepts two simultaneous registrations).

---

## Part 3 — Using it

| Action | Dial |
|---|---|
| Call the other extension | `101` or `102` |
| Voicemail | `*97` |
| Echo test (checks your audio both ways) | `600` |
| US outbound | `+1XXXXXXXXXX`, `1XXXXXXXXXX` or `XXXXXXXXXX` |
| Force the outreach caller ID from either extension | prefix `*2` |

**Caller ID is set by the server, not your softphone.** Extension 101
always presents +1 407 751 1755; extension 102 always presents
+1 407 751 1178. Whatever the softphone claims is overwritten.

**Start with extension `600`** (echo test) once registered — it confirms
two-way audio through the VPN without involving Telnyx or costing
anything.

---

## Troubleshooting

**VPN activates but `ping 10.66.66.1` fails**
Check the tunnel shows a recent handshake. On mobile data, some carriers
interfere with UDP — try wifi to isolate. `PersistentKeepalive = 25` is
already set, which handles most NAT timeouts.

**VPN works but the softphone will not register**
- Confirm the SIP server is `10.66.66.1`, **not** the public IP. Using the
  public IP will always fail — SIP is firewalled to the VPN and Telnyx only.
- Check username/password against `sip-credentials.txt` exactly.
- Confirm transport is UDP, port 5060.

**Registers, but no audio on calls**
Almost always a codec mismatch. Enable **only** G711u and G711a in the
softphone and disable the rest.

**Both devices on one extension — only one rings**
Both register fine (capacity is 2), but ring behaviour depends on the
dialplan. Currently a call rings the extension, which reaches whichever
contacts are registered. If you want strict simultaneous ring on both,
that is a small dialplan change — ask.

---

## Security notes

- The VPN uses **split tunnelling**: only `10.66.66.0/24` is routed over
  it. Normal browsing and app traffic is untouched.
- UDP 51820 is open to the internet by necessity — your devices roam
  between wifi and mobile data, so their source address is not
  predictable. Security comes from WireGuard's cryptographic handshake:
  unauthenticated packets are discarded silently and the port does not
  respond to scanners.
- SIP (5060) is **not** open to the internet. It accepts traffic only
  from the WireGuard interface and from Telnyx's three US addresses.
- Treat `C:\oci\symateq-calling-secrets\` as sensitive. Do not email
  those files, put them in the repo, or paste their contents into chat.
- If a device is lost, tell me — its peer can be revoked server-side
  without affecting the other device.
