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

test('provider room launcher defaults to immediate adaptive-media meetings', () => {
  const launcher = read('components/ng/conference/tabs/ScheduleRoomTab.jsx');
  const portal = read('components/ng/conference/ConferencePortal.jsx');

  assert.match(launcher, /max_participants: 10/);
  assert.match(launcher, /max_participants: 2/);
  assert.match(launcher, /label: '1:1 consult'/);
  assert.match(launcher, /label: '3-way consultation'/);
  assert.match(launcher, /label: '5-person case review'/);
  assert.match(launcher, /label: '10-person board'/);
  assert.match(launcher, /DEFAULT_ROOM_TITLE/);
  assert.match(launcher, /searchParams\.get\('preset'\)/);
  assert.match(launcher, /media_server: 'livekit'/);
  assert.match(launcher, /start_now: true/);
  assert.match(launcher, /require_media_ready: true/);
  assert.match(launcher, /conf\.startRoom\(created\.room\.id\)/);
  assert.match(launcher, /Adaptive clinical media/);
  assert.match(portal, /label: 'Start Meeting'/);
  assert.match(portal, /Clinical Video/);
});

test('provider dashboard exposes no-appointment clinical video without internal route-copy', () => {
  const dashboard = read('components/provider/PremiumProviderDashboard.jsx');
  const commandCenter = read('components/ng/provider/ProviderCommandCenter.jsx');
  const providerCall = read('app/ng/provider/call/page.js');

  assert.match(dashboard, /Start Secure Video Meeting/);
  assert.match(dashboard, /Clinical Video/);
  assert.match(commandCenter, /Clinical Video Rooms/);
  assert.match(commandCenter, /Start Meeting/);
  assert.doesNotMatch(dashboard, /Provider Dashboard ->/);
  assert.doesNotMatch(dashboard, /href="\/ng\/conference"/);
  assert.doesNotMatch(commandCenter, /Start LiveKit Room/);
  assert.doesNotMatch(commandCenter, /LiveKit Conference Rooms/);
  assert.match(providerCall, /import NGVideoCall/);
  assert.match(providerCall, /<NGVideoCall/);
});
