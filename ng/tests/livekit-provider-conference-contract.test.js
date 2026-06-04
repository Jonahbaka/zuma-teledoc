const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('LiveKit client dependency and media panel are present', () => {
  const pkg = JSON.parse(read('package.json'));
  const panel = read('components/ng/conference/LiveKitMediaPanel.jsx');

  assert.ok(pkg.dependencies['livekit-client'], 'livekit-client dependency is required');
  assert.match(panel, /import \{ Room, RoomEvent, Track \} from 'livekit-client'/);
  assert.match(panel, /conf\.getLiveKitToken\(room\.id, displayName\.trim\(\)\)/);
  assert.match(panel, /new Room\(/);
  assert.match(panel, /setScreenShareEnabled/);
  assert.match(panel, /window\.__doctarxLiveKitDebug/);
  assert.match(panel, /data-testid="livekit-media-panel"/);
});

test('MeetingRoom uses LiveKit for livekit rooms and preserves peer mesh for other rooms', () => {
  const meeting = read('components/ng/conference/MeetingRoom.jsx');

  assert.match(meeting, /import LiveKitMediaPanel from '\.\/LiveKitMediaPanel'/);
  assert.match(meeting, /isLiveKitRoom = String\(room\?\.media_server \|\| ''\)\.toLowerCase\(\) === 'livekit'/);
  assert.match(meeting, /phase === 'meeting' && !isLiveKitRoom/);
  assert.match(meeting, /<LiveKitMediaPanel/);
  assert.match(meeting, /<VideoGrid/);
  assert.doesNotMatch(meeting, /Joining will use peer-mesh/);
});

test('provider room launcher defaults to immediate LiveKit SFU meetings', () => {
  const launcher = read('components/ng/conference/tabs/ScheduleRoomTab.jsx');
  const portal = read('components/ng/conference/ConferencePortal.jsx');

  assert.match(launcher, /max_participants: 10/);
  assert.match(launcher, /max_participants: 2/);
  assert.match(launcher, /label: '1:1 consult'/);
  assert.match(launcher, /label: '3-way consultation'/);
  assert.match(launcher, /label: 'Case review'/);
  assert.match(launcher, /label: 'Hospital board'/);
  assert.match(launcher, /DEFAULT_ROOM_TITLE/);
  assert.match(launcher, /searchParams\.get\('preset'\)/);
  assert.match(launcher, /media_server: 'livekit'/);
  assert.match(launcher, /start_now: true/);
  assert.match(launcher, /require_media_ready: true/);
  assert.match(launcher, /conf\.startRoom\(created\.room\.id\)/);
  assert.match(launcher, /LiveKit SFU/);
  assert.match(portal, /label: 'Start Room'/);
});

test('provider dashboard exposes no-appointment conference hub without internal route-copy', () => {
  const dashboard = read('components/ng/provider/ProviderCommandCenter.jsx');
  const providerCall = read('app/ng/provider/call/page.js');

  assert.match(dashboard, /const conferencePath = providerPath\('\/call'\)/);
  assert.match(dashboard, /LiveKit Conference Rooms/);
  assert.match(dashboard, /Start LiveKit Room/);
  assert.match(dashboard, /label="Conferencing" route="\/call"/);
  assert.doesNotMatch(dashboard, /Provider Dashboard ->/);
  assert.doesNotMatch(dashboard, /href="\/ng\/conference"/);
  assert.match(providerCall, /import ConferencePortal/);
  assert.match(providerCall, /<ConferencePortal initialTab="schedule" \/>/);
});
