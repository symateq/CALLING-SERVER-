# Telnyx portal checklist — do these steps yourself

The server side is fully prepared and waiting. These steps must be done
in the Telnyx portal, which I cannot access. **Do not paste any API key,
SIP password, card detail or login password into chat** — nothing here
requires it.

Everything below is IP-authenticated, so there is no SIP password to
create or transfer anywhere.

---

## Before you start — confirm the numbers

Go to **Numbers → My Numbers** and confirm both appear and are active:

| Purpose | Number |
|---|---|
| Primary / support | **+1 407 751 1755** |
| Outreach | **+1 407 751 1178** |

If either is missing, stop — the rest depends on them.

---

## Step 1 — Create the SIP Connection

**Voice → SIP Trunking → Create SIP Connection**

| Field | Value |
|---|---|
| Connection Name | `SYMATEQ-ASTERISK` |
| Connection Type | **IP Authentication** (not Credentials) |

Then open the connection and set:

| Field | Value |
|---|---|
| IP Address | `80.225.229.192` |
| Port | `5060` |
| Transport | `UDP` |

Why IP authentication: this server has a permanent reserved public IP,
which is exactly the case Telnyx recommends it for. It also means no SIP
password exists to be leaked, reused or rotated.

---

## Step 2 — Connection settings

Inside `SYMATEQ-ASTERISK`:

| Setting | Value | Why |
|---|---|---|
| Codecs | **G711U (PCMU)** and **G722** only | Matches the server exactly; avoids transcoding |
| DTMF Type | **RFC 2833** | Standard for softphones |
| Encrypted Media (SRTP) | **Off** for now | Server is on plain UDP 5060 initially; revisit with TLS later |
| Encrypted Transport (TLS) | **Off** for now | Same as above |
| **Emergency calling** | **Disabled** | Explicitly required — this is not a 911-capable service |

---

## Step 3 — Create the Outbound Voice Profile

**Voice → Outbound Voice Profiles → Create**

| Field | Value |
|---|---|
| Name | `SYMATEQ-US-OUTBOUND` |
| Traffic Type | Conversational |
| Service Plan | US / domestic |

**Destinations — allow United States ONLY.** Deselect every other
country. Do not leave a region enabled "just in case".

**Limits — set these conservatively to start:**

| Setting | Value |
|---|---|
| Concurrent Call Limit | **1** |
| Daily spend limit | Set a low cap (e.g. **$5**) |
| Usage / rate limit alerts | Enable, to your email |

The concurrent limit of 1 is deliberate and matches the server-side
dialplan, which also refuses a second simultaneous outbound call.

---

## Step 4 — Attach the profile to the connection

In `SYMATEQ-ASTERISK` → **Outbound** tab → set **Outbound Voice
Profile** to `SYMATEQ-US-OUTBOUND`.

---

## Step 5 — Assign both numbers to the connection

**Numbers → My Numbers**, for **each** of the two numbers:

- Set **Connection / Routing** to `SYMATEQ-ASTERISK`
- Leave **Messaging Profile** unassigned (SMS is a separate, separately
  compliant project — 10DLC registration is required and is not in scope)

---

## Step 6 — Caller ID restriction

Confirm the connection is permitted to present **only** these two owned
numbers as caller ID:

- +14077511755
- +14077511178

The server enforces this too — extension 101 can only present the
primary number and 102 only the outreach number, and the dialplan
overwrites caller ID on every outbound call rather than trusting what
the softphone sends.

---

## Step 7 — Account-level spend protection

**Account → Billing**: set a low account-wide auto-recharge cap and
balance alerts. This is the backstop if anything else is misconfigured.

---

## When you are done

Tell me, and I will:

1. Check the trunk registers / qualifies from the Asterisk side
   (`pjsip show endpoint telnyx` should move off `Unavailable`).
2. Watch for inbound SIP arriving from Telnyx's US addresses.
3. Run the inbound and outbound call tests.

I will **not** place any test call until you confirm the portal side is
set up and you are ready.

---

## What is already done on the server (no action needed)

- Trunk configured for IP authentication — no credentials anywhere.
- Firewall permits SIP only from Telnyx's US signalling addresses and
  RTP only from Telnyx's published media ranges. Everything else denied.
- Inbound: +14077511755 rings extension 101, +14077511178 rings
  extension 102, both with voicemail fallback.
- Outbound: US-only, with premium (900/976/700) and non-US NANP
  (Caribbean) destinations explicitly blocked.
- One concurrent outbound call, 60-minute hard call cap, every attempt
  written to CDR including blocked ones.
