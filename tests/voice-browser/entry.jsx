'use strict';
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import LiveVoicePrototype from '../../components/voice/LiveVoicePrototype';
import CameraPreviewPrototype from '../../components/voice/CameraPreviewPrototype';
import { installFakeMedia } from './fake-media.cjs';
import { request } from './fixture-api.cjs';
const media = installFakeMedia();
function Fixture() {
  const [language, setLanguage] = useState('ha'), [visible, setVisible] = useState(true);
  const [stats, setStats] = useState({}), [server, setServer] = useState({}), [failure, setFailure] = useState('');
  useEffect(() => {
    let active = true;
    const update = async () => { try { const value = await request('/__voice_fixture/state'); if (active) { setStats(media.snapshot()); setServer(value); } } catch { if (active) setFailure('Fixture status failed.'); } };
    void update(); const timer = setInterval(update, 100); return () => { active = false; clearInterval(timer); };
  }, []);
  async function revoke(kind) { try { await request('/__voice_fixture/revoke', { kind }); } catch { setFailure('Fixture revoke failed.'); } }
  async function caption(speaker) { try { const value = await request('/__voice_fixture/caption', { speaker, language }); media.emit(value.event); } catch { setFailure('Fixture caption failed.'); } }
  return <main>
    <h1>Synthetic voice browser QA</h1>
    <p>No real microphone, speaker, provider, patient data or clinical records. Identity and approvals are fictional test injections.</p>
    <label>Conversation language <select value={language} onChange={event => setLanguage(event.target.value)}><option value="ha">Hausa</option><option value="ig">Igbo</option><option value="yo">Yoruba</option></select></label>
    {visible && <><LiveVoicePrototype userId="fictional-browser-evaluator" role="provider" language={language} /><CameraPreviewPrototype userId="fictional-browser-evaluator" role="provider" language={language} /></>}
    <section aria-label="Fictional test controls">
      <h2>Fictional test controls</h2>
      <label>Fake permission response <select defaultValue="prompt" onChange={event => media.setPermission(event.target.value)}><option value="prompt">Hold for explicit response</option><option value="allow">Allow fake microphone</option><option value="deny">Deny fake microphone</option></select></label>
      <button onClick={() => media.allowPending()}>Allow pending fake permission</button>
      <button onClick={() => media.denyPending()}>Deny pending fake permission</button>
      <button onClick={() => media.disconnect()}>Disconnect fake microphone</button>
      <button onClick={() => caption('assistant')}>Emit fictional assistant caption</button>
      <button onClick={() => caption('patient')}>Emit fictional patient interruption</button>
      <button onClick={() => revoke('consent')}>Revoke fictional consent</button>
      <button onClick={() => revoke('processor')}>Revoke fictional processor approval</button>
      <button onClick={() => revoke('role')}>Remove fictional evaluator role</button>
      <button onClick={() => setVisible(false)}>Unmount live panel</button>
    </section>
    <section aria-label="Fixture diagnostics">
      <h2>Fixture diagnostics</h2>
      <p data-testid="permission-requests">Permission requests: {stats.requests || 0}</p><p data-testid="pending-permissions">Pending permissions: {stats.pending || 0}</p>
      <p data-testid="active-tracks">Active fake tracks: {stats.activeTracks || 0}</p><p data-testid="speaker-state">Fake speaker: {stats.playing ? 'playing' : 'stopped'}</p>
      <p data-testid="provider-creates">Fake provider creates: {server.creates || 0}</p><p data-testid="provider-closes">Fake provider closes: {server.closes || 0}</p>
      <p data-testid="evidence-count">Provisional evidence: {server.evidenceCount || 0}</p><p data-testid="open-peers">Open fake peers: {stats.openPeers || 0}</p>
    </section>
    {failure && <p role="alert">{failure}</p>}
  </main>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
