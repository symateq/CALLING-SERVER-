# SYMATEQ Calling Server — Implementation Handover

Prepared: 29 September 2026

> **⚠️ BLOCKER — read before starting Phase 0.**
> This handover assumes the target server is a clean, dedicated box (see
> Gate 0: *"Verify this is not the production server hosting
> portal.symateq.com, calculate.symateq.com... If it is shared, stop and
> report; do not install."*).
>
> As of 2026-09-29, **no such clean server currently exists**:
> - The server originally intended as "the new server" (`144.24.119.32`,
>   Oracle A1, 4 OCPU/24GB) was migrated *today* to host the live
>   production stack — `calculate.symateq.com`, `portal.symateq.com`,
>   `personal.symateq.com` (Planvas), n8n, and both their Postgres
>   databases. It is no longer a spare box.
> - The old server (`130.210.46.95`, Oracle E2.1.Micro, 1 OCPU/1GB) is
>   kept running only as a fallback for that migration, and is far too
>   weak (1GB RAM total) for a telephony stack alongside anything else.
>
> **This must be resolved with the user before any Phase 0 discovery
> runs** — either provision a genuinely new/third server for calling, or
> get explicit sign-off to reuse one of the above and accept the
> shared-server risk the handover itself warns against. Do not proceed
> past Gate 0 without that decision recorded here.

---

## Mission
Configure the new Ubuntu server as a secure, low-cost SYMATEQ business calling platform using Telnyx Elastic SIP Trunking, Asterisk/PJSIP, VPN-connected softphones, call-detail records, and later n8n integration.

Do the work in controlled stages. Preserve SSH access. Do not modify or interrupt any unrelated SYMATEQ application, Company OS, calculator, website, PostgreSQL instance, reverse proxy, or existing container. Never print, commit, or paste API keys, SIP passwords, private keys, WireGuard private keys, or full sensitive configuration into chat or logs.

## Confirmed context
- Telnyx account/KYC is approved and the account is Verified.
- Two US local numbers are planned: one permanent business/support number and one outreach number.
- Current recommended available candidates are +1 214 935 5757 (permanent) and +1 469 581 3691 (outreach), but purchase is not confirmed. Treat numbers as variables until they appear under Telnyx My Numbers.
- The intended server is new and is reported ready. **Verify this before changing it — see blocker above.**
- Initial use is manual business calling and compliant, human-initiated B2B outreach. Do not build a predictive dialer, robodialer, prerecorded-message system, caller-ID rotation, or number spoofing.
- Asterisk/PJSIP is preferred. Do not install FreePBX initially.
- Softphones will be used from India on Android and/or Windows.
- n8n will orchestrate approved call tasks and CRM updates later; it must not carry live audio or store plaintext telephony credentials.

## Required final architecture
```
US PSTN
   |
Telnyx local numbers
   |
Telnyx SIP connection
   |
Asterisk/PJSIP on the new server
   |-- extension 101: main/permanent line
   |-- extension 102: outreach line
   |-- voicemail
   |
WireGuard VPN
   |
Android/Windows softphones

Asterisk CDR/events -> n8n webhook/worker -> SYMATEQ CRM + Teams notification
```

## Non-negotiable safety rules
1. Begin with read-only discovery and save the output locally with secrets redacted.
2. Verify this is not the production server hosting portal.symateq.com, calculate.symateq.com, or other live applications. If it is shared, stop and report; do not install.
3. Preserve the active SSH session. Identify the SSH port and existing OCI/VPS firewall rules before enabling UFW/nftables.
4. Take timestamped backups of every configuration file before modifying it.
5. Do not expose SIP extension registration to the public Internet. Extensions must register through WireGuard.
6. Telnyx-facing SIP and RTP must be permitted only from Telnyx's current officially published IP ranges. Fetch and record the source URL/date at implementation time; do not guess or use an old copied list.
7. Permit outbound calling initially only to ordinary US +1 destinations. Block international and premium destinations.
8. Use only Telnyx numbers owned by the account as outbound caller ID.
9. Configure a low Telnyx daily spend limit and account alerts in the portal; if Claude cannot access the portal, provide the exact user checklist.
10. No call recording by default. Leave it disabled until SYMATEQ defines consent, retention, access, and jurisdiction rules.
11. No automated SMS/MMS. SMS requires a messaging profile and applicable 10DLC registration. WhatsApp is a separate project.
12. Do not store secrets in Git, n8n workflow JSON, shell history, screenshots, or the handover report.

## Phase 0 — Read-only discovery
Run and report, redacting public IPs if the report leaves the secure work environment:
```sh
set -o pipefail
. /etc/os-release && printf 'OS=%s %s\n' "$ID" "$VERSION_ID"
uname -a
uname -m
nproc
free -h
df -hT
ip -brief address
sudo ss -lntup
sudo systemctl --type=service --state=running
command -v docker && docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'
command -v ufw && sudo ufw status verbose
sudo timedatectl status
```
Also determine:
- Cloud provider and region
- Whether the public IP is static/reserved
- OCI/VPS network security rules
- Existing DNS name, if any
- Existing backups/snapshots
- Whether ports 22, 5060, 5061, 10000-20000/udp, and 51820/udp are occupied
- Whether Asterisk, Kamailio, FreeSWITCH, WireGuard, Tailscale, Docker, nginx, Caddy, PostgreSQL, or n8n is already installed

### Gate 0
Proceed only if this is the intended new server, resources are healthy, SSH access is understood, and no port/service conflict exists. Otherwise stop and report the blocker.

## Phase 1 — Operating-system preparation
Prefer supported Ubuntu packages for the server architecture. Do not compile Asterisk from source unless the packaged version lacks a required supported feature; explain and obtain approval before compiling.
1. Update package metadata and install security updates without automatically rebooting.
2. Install the minimum required packages: Asterisk with PJSIP support, WireGuard, Fail2ban, UFW if no other firewall manager is active, SQLite utilities if CDR uses SQLite, log rotation utilities, and diagnostic tools.
3. Enable reliable time synchronization.
4. Create a configuration-backup directory readable only by root.
5. Confirm Asterisk runs as its dedicated unprivileged service account.
6. Do not install FreePBX, Apache/PHP, MySQL, GUI panels, DAHDI, fax services, recording packages, or unrelated modules unless specifically required.

Record installed package names and versions.

## Phase 2 — Network and security

### WireGuard
Create a private VPN for phone/laptop softphones:
- Server VPN subnet: choose an RFC1918 subnet that does not conflict with OCI/VPC or home/mobile networks.
- Peers: ujjawal-phone and ujjawal-windows initially.
- Listen port: 51820/udp, unless occupied.
- Generate peer configurations securely. Do not print private keys in the final report.
- Permit VPN clients to reach Asterisk SIP and RTP locally.
- Do not route all Internet traffic through the VPN unless necessary; use split tunneling.

### Host firewall
Build rules in this order to avoid SSH lockout:
1. Explicitly allow the existing SSH access path.
2. Allow WireGuard 51820/udp from the Internet.
3. Allow softphone SIP only from the WireGuard subnet.
4. Allow Telnyx SIP signaling only from currently published Telnyx IP ranges.
5. Allow Asterisk RTP range only from Telnyx IP ranges and the WireGuard subnet.
6. Deny public access to AMI, ARI, HTTP administration, database ports and extension-registration ports.
7. Keep outbound DNS, NTP, HTTPS and Telnyx traffic available.

Mirror necessary inbound rules in the OCI NSG/security list. If Claude cannot change OCI rules, stop before enabling the restrictive host firewall and provide a precise OCI rule table for the user.

Do not leave UDP/TCP 5060 open to 0.0.0.0/0.

### Fail2ban
Configure jails for SSH and Asterisk authentication failures. Confirm log paths match the installed Asterisk version. Use conservative bans and ensure the WireGuard administration path cannot be accidentally locked out.

## Phase 3 — Asterisk base configuration
Use chan_pjsip, not deprecated chan_sip.

Create clearly separated contexts:
- `from-telnyx`: inbound calls from the Telnyx trunk only; it must not access outbound dialing.
- `from-softphones`: authenticated VPN extensions; may call approved internal services and restricted US destinations.
- `internal`: extension-to-extension calls and voicemail.
- `outbound-outreach`: presents the owned outreach DID.
- `outbound-main`: presents the owned permanent DID, selected by an explicit controlled prefix or feature code.

Create:
- Extension 101: main user
- Extension 102: outreach user
- Strong random credentials stored in root-readable secrets or Asterisk auth files with minimum permissions
- Voicemail boxes for 101 and 102
- A test/echo extension for audio verification
- Ring timeout and voicemail fallback
- Business-hours placeholders using the US target timezone, but do not activate restrictive routing until the user confirms hours

NAT/media requirements:
- Set the actual external signaling/media address if the server is behind NAT.
- Declare actual local networks.
- Use `direct_media=no` initially.
- Prefer codecs ulaw/G.711u for US interoperability; optionally allow alaw. Avoid transcoding-heavy codec collections.
- Use a defined RTP range and align it with both firewalls.
- Enable symmetric RTP, rewrite-contact and force-rport where appropriate for NAT clients.

Logging:
- Enable security and operational logs with log rotation.
- Do not enable permanent verbose SIP packet logging after testing.
- Configure CDR storage with fields for call ID, direction, source extension, destination, selected DID, start/answer/end times, disposition and duration.
- Avoid storing unnecessary personal information.

## Phase 4 — Telnyx portal configuration
This phase requires user-controlled portal access. Never request that the user paste an API key, card, SIP password, or login password in chat.

Provide the user these portal steps and wait for confirmation where required:
1. Confirm both purchased DIDs appear under My Numbers.
2. Create a dedicated credential-based SIP Connection named `SYMATEQ-ASTERISK-PROD`.
3. Generate unique SIP credentials and enter them securely on the server.
4. Create an Outbound Voice Profile named `SYMATEQ-US-OUTBOUND`.
5. Permit only necessary US destinations initially.
6. Configure a low daily spending limit and alerts.
7. Associate the Outbound Voice Profile with the SIP Connection.
8. Assign both DIDs to the SIP Connection.
9. Confirm the Telnyx SIP registrar/proxy and transport from current official documentation.
10. Keep messaging profiles unassigned until a separate compliant messaging implementation.

Do not hardcode provisional numbers. Use variables such as:
```
MAIN_DID=+1XXXXXXXXXX
OUTREACH_DID=+1XXXXXXXXXX
TELNYX_SIP_USER=<secret>
TELNYX_SIP_PASSWORD=<secret>
TELNYX_SIP_HOST=<verified current host>
PUBLIC_IP=<actual static public IP>
VPN_SUBNET=<selected subnet>
```
Store secrets with restrictive permissions and ensure backups containing them are encrypted or root-only.

## Phase 5 — Softphone onboarding
Prepare configurations for one Android softphone and one Windows softphone. Linphone or Zoiper may be used initially.

The softphone must:
- Connect to WireGuard first
- Register to Asterisk's VPN address, not the public IP
- Use extension 101 or 102 with unique credentials
- Use DTMF RFC4733/RFC2833 as supported
- Prefer ulaw
- Not expose SIP credentials in screenshots or the final report

Create a short user runbook covering: connect VPN, open softphone, confirm registration, dial in E.164 format, choose the main-line route when required, access voicemail, and disconnect/troubleshoot.

## Phase 6 — Testing and acceptance
Do not publish the numbers until all tests pass.

### Security tests
- SSH remains accessible through the approved path.
- Public port scan shows only intentionally exposed services.
- SIP registration fails from the public Internet and succeeds over WireGuard.
- AMI/ARI/management ports are not public.
- Asterisk does not provide an inbound-to-outbound relay.
- International and premium outbound destinations are blocked.

### Functional tests
1. Register extension 101 through the VPN.
2. Register extension 102 through the VPN.
3. Call 101 to 102 and confirm two-way audio.
4. Call each US DID from an independent US number; verify the intended extension rings.
5. Reject or miss an inbound call; verify voicemail/CDR behavior.
6. Place an outbound US test call using the outreach caller ID.
7. Place an outbound US test call using the permanent caller ID route.
8. Verify the exact caller ID displayed on the receiving handset.
9. Test on Indian Wi-Fi and mobile data.
10. Measure one-way latency, jitter, packet loss, dropped audio and setup time.
11. Verify DTMF and voicemail.
12. Confirm Telnyx CDR and actual charges in the portal.
13. Reboot the server during a planned window and confirm Asterisk, WireGuard and firewall recover automatically.

### Acceptance targets
- Both extensions register only through VPN.
- Both DIDs receive calls with two-way audio.
- Approved US outbound calls work.
- Caller ID matches the selected owned DID.
- No unauthorized destination can be dialed.
- No unrelated services are changed.
- Call records are created correctly.
- Resource usage remains healthy.

## Phase 7 — n8n integration after calling passes
Do not integrate n8n until Phase 6 succeeds.

Implement a minimal event bridge that sends metadata only:
- missed call
- completed call
- inbound/outbound direction
- DID used
- prospect/contact reference when known
- start/end time and duration
- disposition entered by the user

Security requirements:
- Use an authenticated HTTPS webhook or a local private queue.
- Use a dedicated secret stored in the n8n credential store.
- Never expose AMI directly to the Internet.
- Never put SIP credentials or Telnyx API keys inside exported workflow JSON.
- Add retries, idempotency using call ID, and a dead-letter/error path.
- Begin with manual call tasks and human approval; do not auto-dial lists.

Expected n8n actions:
1. Create/update the CRM call activity.
2. Notify Teams of missed calls and interested outcomes.
3. Schedule approved follow-ups.
4. Enforce do-not-call and suppression records.
5. Maintain daily calling limits and US-local-time windows.

## Backup and rollback
Before each phase:
- Back up changed files with timestamps.
- Record package/service changes.
- Validate configuration before reload (asterisk configuration checks and service status).
- Prefer reload over restart where safe.

Rollback must restore:
- Previous firewall state
- Previous Asterisk configuration
- Previous WireGuard configuration
- Previous enabled/disabled service state

If SSH connectivity becomes uncertain, do not continue remotely without console access.

## Required deliverables
Create these server-local files without secrets:
```
/opt/symateq-calling/README.md
/opt/symateq-calling/inventory-redacted.txt
/opt/symateq-calling/firewall-plan.md
/opt/symateq-calling/telnyx-portal-checklist.md
/opt/symateq-calling/softphone-runbook.md
/opt/symateq-calling/test-report.md
/opt/symateq-calling/rollback.md
```
Keep working configurations in their normal protected system locations and provide redacted examples only.

Provide a final report containing:
- Server OS/architecture/resources
- Installed package versions
- Services enabled
- Ports and sources allowed
- Selected VPN subnet
- Extensions created
- Telnyx connection status without credentials
- DIDs attached
- Test results for every acceptance item
- Actual measured call quality
- Remaining blockers
- Exact next action for the user

## Execution protocol
1. Run Phase 0.
2. Report findings and any blockers.
3. If all safety conditions pass, continue through server-only Phases 1–3.
4. Stop for the user's Telnyx portal actions and secure credential entry.
5. Continue through Phases 5–6 after Telnyx is connected.
6. Only after successful calls, implement Phase 7.
7. Never mark the project complete merely because services are running; completion requires the acceptance tests and final report.

## Official documentation to use
- Telnyx SIP Trunking getting started: https://developers.telnyx.com/docs/voice/sip-trunking/get-started
- Telnyx Asterisk guide: https://developers.telnyx.com/docs/voice/sip-trunking/asterisk
- Telnyx authentication methods: https://developers.telnyx.com/docs/voice/sip-trunking/authentication/credential-types
- Telnyx outbound profiles: https://developers.telnyx.com/docs/voice/sip-trunking/configuration/outbound-voice-profiles
- Asterisk PJSIP configuration examples: https://docs.asterisk.org/Configuration/Channel-Drivers/SIP/Configuring-res_pjsip/res_pjsip-Configuration-Examples/
- Asterisk secure calling: https://docs.asterisk.org/Deployment/Secure-Calling/Secure-Calling-Tutorial/

Use current official documentation during implementation. If documentation conflicts with this handover, stop, describe the conflict, and use the safer supported approach after user approval.
