# Live streaming: what is done, and what needs an account

Everything in this document is a thing I could not do without credentials,
hardware, or a store account. The code around each one is finished.

## 1. A TURN relay — required before any church uses this

**Why it is not optional here.** Ghanaian mobile networks put subscribers behind
carrier-grade NAT. Two phones on MTN cannot be made to talk directly however
much STUN they do, so without a relay a large share of a congregation never
connects. It works perfectly on office wifi, which is exactly what makes it easy
to ship broken: the failure arrives weeks later as "the app does not work on
MTN", with nothing in the logs to connect it to a missing relay.

The server already warns about this at startup:

```
WARN live streaming has NO TURN relay — viewers behind carrier-grade NAT
     (most Ghanaian mobile data) will not connect
```

**What to get.** Any managed TURN service. Three that work in this region:

| Provider | Notes |
|---|---|
| Cloudflare Calls | TURN priced per GB, no minimum, closest edge to Accra |
| Twilio Network Traversal | Per-GB, mature, easy credentials |
| Metered.ca | Cheapest at low volume, global |

**Where it goes** — `.env.production`:

```
LIVE_TURN_URLS=turn:relay.example.com:3478,turns:relay.example.com:5349
LIVE_TURN_USERNAME=<from the provider>
LIVE_TURN_CREDENTIAL=<from the provider>
```

Include the `turns:` (TLS, port 5349) URL as well as `turn:`. Some corporate and
hotel networks block everything except 443/TLS, and that entry is the one that
gets a member connected from a conference centre.

Credentials from these providers are short-lived by design. Nothing needs to
change in the app when they rotate — every grant hands the client a fresh ICE
list, which is why they are not baked into the build.

## 2. `react-native-webrtc` — the app cannot show video without it

The JavaScript is complete: signalling, renegotiation, the recording consent
gate, the give bar. What is missing is the native module.

It is installed (`react-native-webrtc@124`) but NOT wired into the native build.
The Expo config plugin that does the wiring
(`@config-plugins/react-native-webrtc`) does not yet declare support for Expo
SDK 57, so `npm install` refuses it. I did not force it: whether it produces a
working SDK 57 build is something only a native build proves, and I could not
run one.

**When you cut a build:**

```bash
cd apps/mobile
npm install @config-plugins/react-native-webrtc --legacy-peer-deps
```

then add to `app.json` under `expo.plugins`:

```json
[
  "@config-plugins/react-native-webrtc",
  {
    "cameraPermission": "ALTAR OS uses your camera only if you choose to appear on screen during a live service.",
    "microphonePermission": "ALTAR OS uses your microphone only if you choose to speak during a live service."
  }
]
```

The Android permissions are already in `app.json`. The iOS permission strings
come from the plugin — App Review rejects generic ones, and those two say what
the access is actually for.

Then `eas build --profile development` and test on a real device. **Expo Go will
never work for this** — it cannot load native modules. The app handles that
honestly today: the live screen says "Watching live needs the full app from the
App Store or Play Store" instead of crashing.

## 3. Where recordings are written

```
LIVE_RECORDING_DIR=/var/lib/altar-os/recordings
```

Empty means recording is off, and the retention sweeper says so at startup
rather than running silently over nothing.

**This volume holds sensitive personal data** under Act 843 s.1 — a recorded
service reveals the religious belief of everyone in it. It must be encrypted at
rest and must never be a public bucket or a directory a web server serves.
Recordings are erased automatically after a year (three-year ceiling), and the
sweeper deletes the files before marking the row.

Two files per service, IVF (video) and Ogg (audio). Muxing them into one
playable file is an ffmpeg job after the service; doing it live would mean
decoding and re-encoding, which is the difference between a server that carries
many services and one that carries two.

## 4. Keys already generated

`.env.production` has `LIVE_SIGNING_KEY` and `PAYMENT_ENCRYPTION_KEY` generated
and ready. Both are real secrets and the file is gitignored.

- **`LIVE_SIGNING_KEY`** signs room grants. Empty means streaming is OFF and the
  server refuses rooms, rather than issuing unsigned grants anyone could forge —
  which would look exactly like a working system.
- **`PAYMENT_ENCRYPTION_KEY`** encrypts saved payment authorizations for one-tap
  giving. Empty means saved methods are refused rather than stored in the clear.

Keep them separate from `WELFARE_ENCRYPTION_KEY`. One key for everything means a
compromise of pastoral notes is also a compromise of the congregation's cards.

## 5. Paystack

`apps/api/.env` holds **test** keys (`sk_test_` / `pk_test_`). They are not in
`.env.production` and must not be copied there. Live keys come from the Paystack
dashboard once the business is verified.

## What is finished

- SFU forwarding real media, verified with actual WebRTC connections and clean
  under `-race`
- WebSocket signalling with server-initiated renegotiation, so someone who opens
  the app before the service starts still gets the video
- Room grants: signed, three hours, one room, one role
- Tier gate on start, seat cap enforced atomically against a stampede
- Recording with a consent notice delivered before anything connects, and
  automatic erasure
- One-tap giving during a service, safe to press twice
- Appeals published to members, to a church's own site, and to the directory —
  three separate decisions
- Dashboard and mobile for all of it
