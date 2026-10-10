import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const PORT = 5757;

const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  const path = pathname === "/" ? "/index.html" : pathname;
  try {
    const body = await readFile(join(import.meta.dirname, path));
    const type = extname(path) === ".js" ? "text/javascript" : "text/html";
    res.writeHead(200, { "Content-Type": type });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(PORT, resolve));

const browser = await chromium.launch({
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--disable-gpu",
  ],
});
const page = await browser.newPage();
page.on("console", (msg) => console.log("[page]", msg.text()));

const wsServer = process.env.WS_SERVER || "ws://127.0.0.1:18088/ws";
await page.goto(`http://localhost:${PORT}/?ws=${encodeURIComponent(wsServer)}`);
console.log("Using WS server:", wsServer);

async function waitFor(predicate, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await page.evaluate(() => window.__result);
    if (!result) {
      await new Promise((r) => setTimeout(r, 300));
      continue;
    }
    if (result.error) {
      console.log(`FAILED before "${label}": ${result.error}`);
      return result;
    }
    if (predicate(result)) return result;
    await new Promise((r) => setTimeout(r, 300));
  }
  console.log(`TIMEOUT waiting for "${label}"`);
  return await page.evaluate(() => window.__result);
}

console.log("Waiting for WebSocket connect + REGISTER...");
let result = await waitFor((r) => r.registered, 15000, "registered");
console.log("After register:", result);

console.log("Waiting for call to be answered (999 Echo extension)...");
result = await waitFor((r) => r.callAnswered, 15000, "callAnswered");
console.log("After call answered:", result);

if (result.callAnswered) {
  console.log("Call answered. Holding for 12s so RTP actually flows...");
  await new Promise((r) => setTimeout(r, 12000));

  const stats = await page.evaluate(async () => {
    const pc = window.__pcInstances?.[window.__pcInstances.length - 1];
    if (!pc) return { error: "no peerConnection found" };

    const senders = pc.getSenders().map((s) => ({
      kind: s.track?.kind,
      trackEnabled: s.track?.enabled,
      trackMuted: s.track?.muted,
      trackReadyState: s.track?.readyState,
    }));

    const report = await pc.getStats();
    const rtp = [];
    const candidates = [];
    report.forEach((s) => {
      if (s.type === "outbound-rtp" || s.type === "inbound-rtp") {
        rtp.push({
          type: s.type, kind: s.kind,
          packetsSent: s.packetsSent, packetsReceived: s.packetsReceived,
          bytesSent: s.bytesSent, bytesReceived: s.bytesReceived,
        });
      }
      if (s.type === "candidate-pair" && s.state === "succeeded") {
        candidates.push({ state: s.state, bytesSent: s.bytesSent, bytesReceived: s.bytesReceived });
      }
    });

    const localCandidates = [];
    const remoteCandidates = [];
    report.forEach((s) => {
      if (s.type === "local-candidate") localCandidates.push(`${s.candidateType} ${s.ip ?? s.address}:${s.port} ${s.protocol}`);
      if (s.type === "remote-candidate") remoteCandidates.push(`${s.candidateType} ${s.ip ?? s.address}:${s.port} ${s.protocol}`);
    });

    return {
      connectionState: pc.connectionState,
      iceConnectionState: pc.iceConnectionState,
      signalingState: pc.signalingState,
      senders,
      rtp,
      succeededCandidatePairs: candidates,
      localCandidates,
      remoteCandidates,
    };
  });
  console.log("Browser-side PeerConnection RTP stats:", JSON.stringify(stats));

  await page.evaluate(() => window.__hangup());
  await new Promise((r) => setTimeout(r, 1000));
}

const final = await page.evaluate(() => window.__result);
console.log("FINAL RESULT:", JSON.stringify(final));

await browser.close();
server.close();

process.exit(final.registered && final.callAnswered && !final.error ? 0 : 1);
