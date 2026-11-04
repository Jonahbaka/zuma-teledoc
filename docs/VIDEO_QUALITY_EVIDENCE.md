# Measured call quality

The appointment call hook and direct-mesh conference hook use `lib/rtcConnectionQuality.cjs`. This is a browser-local UX indicator, not clinical validation, a guarantee of intelligible audio, a bandwidth estimate, or proof that production TURN/SFU infrastructure works. Existing authorization, consent, coverage, signaling and media lifecycle boundaries are unchanged.

## Measurements

- Audio and video incoming loss use the difference between consecutive packet counters for the same report/source. The first sample, no new packets, reset counters and stale timestamps do not supply a loss estimate. Corrected negative cumulative loss does not become negative interval loss.
- Remote receiver reports supply their already-normalized loss fraction and RTT when fresh. RTT is converted from seconds to milliseconds.
- Candidate-pair RTT uses the transport's selected candidate reference. A unique successful legacy selected/nominated pair is a compatibility fallback only when transport references are absent. Ambiguous or broken references do not invent latency.
- The highest measured loss/latency is used, so a healthy stream or participant cannot average away another failing leg. Observed but incomplete loss evidence prevents an overall good result. Missing statistics remain unknown; failures and stalled statistics do not become a healthy result.
- Current UX thresholds are fair at 180 ms RTT or 2% loss, and poor at 420 ms RTT or 5% loss. Both measured metrics are required for good. These are UI heuristics, not validated clinical safety thresholds.

A poor measurement displays a camera-off suggestion and asks the participant to reconnect or arrange another visit if audio remains unclear. The app does not automatically mute the microphone, change media routes or end the consultation.

## Lifecycle and privacy

Polling waits for each read to settle, with a 2.5-second stats timeout, before scheduling another read. Account/room/peer changes, cleanup and reconnection invalidate prior results. A call that has ended cannot be resurrected by a late quality report. Samples are held in a WeakMap keyed by the browser peer connection. Stored values contain only report timestamps/source counters needed for the next sample; no raw RTCStatsReport, IP address, candidate detail, patient text, credential or SDP is retained or exported.

The LiveKit-managed room path continues to use its SDK's quality signal; this change targets direct WebRTC calls. Dormant diagnostics components are not evidence of active integration.

## Verification boundaries

Synthetic parser tests exercise missing/partial/malformed/cached data, selected-pair selection, counter/source reset, current loss, audio-only stats, aggregate worst-leg quality and timeouts. Actual hook/effect tests cover error/unknown displays, teardown and same-peer reconnect races; badge tests exercise rendered component output and recovery text. These tests are not real browser media, packet impairment, physical-device, live relay, accessibility scanner or clinical acceptance evidence. Run the exact integrated build and actual browser media gates before release.

Standards reference: https://www.w3.org/TR/webrtc-stats/ (RTCReceivedRtpStreamStats, RTCRemoteInboundRtpStreamStats, RTCTransportStats and RTCIceCandidatePairStats). Only field semantics come from this specification; the UX thresholds and conservative completeness policy are application decisions.
