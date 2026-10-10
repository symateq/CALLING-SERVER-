import { Web } from "sip.js";

// Capture the real RTCPeerConnection SIP.js creates, rather than guessing its
// internal property layout -- robust regardless of library-internal naming.
const NativeRTCPeerConnection = window.RTCPeerConnection;
window.__pcInstances = [];
window.RTCPeerConnection = function (...args) {
  const pc = new NativeRTCPeerConnection(...args);
  window.__pcInstances.push(pc);
  return pc;
};
window.RTCPeerConnection.prototype = NativeRTCPeerConnection.prototype;

const SERVER = "ws://127.0.0.1:18088/ws";

const user = new Web.SimpleUser(SERVER, {
  aor: "sip:webrtc-test@127.0.0.1",
  userAgentOptions: {
    authorizationUsername: "webrtc-test",
    authorizationPassword: "local-test-only-not-a-real-secret",
    logLevel: "warn",
  },
  media: {
    constraints: { audio: true, video: false },
  },
});

const result = {
  connected: false,
  registered: false,
  callAnswered: false,
  callHungup: false,
  error: null,
};

window.__result = result;

user.delegate = {
  onServerConnect: () => {
    result.connected = true;
  },
  onRegistered: () => {
    result.registered = true;
  },
  onCallAnswered: () => {
    result.callAnswered = true;
  },
  onCallHangup: () => {
    result.callHungup = true;
  },
  onServerDisconnect: (err) => {
    if (err) result.error = `disconnected: ${err}`;
  },
};

window.__hangup = () => user.hangup();

(async () => {
  try {
    await user.connect();
    await user.register();
    await user.call("sip:999@127.0.0.1");
  } catch (e) {
    result.error = String((e && e.message) || e);
  }
})();
