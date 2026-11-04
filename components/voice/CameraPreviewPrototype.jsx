'use client';

import { useEffect, useRef, useState } from 'react';
import { SCENES, createFictionalCamera, createSyntheticCameraPreview } from '@/lib/voice/syntheticCameraPreview.cjs';

const buttonClass = 'min-h-12 rounded-lg border border-slate-500 px-4 py-3 text-sm disabled:opacity-40';
function FictionalFrame({ frameId }) {
  const scene = SCENES.find(frame => frame.id === frameId);
  if (!scene) return null;
  return <svg viewBox="0 0 320 180" role="img" aria-label={`Fictional frame: ${scene.label}`} className="w-full max-w-md rounded-xl bg-slate-800" style={{ width: '100%', maxWidth: 448, height: 'auto' }}>
    <title>{scene.label}, an illustrated test object, not a camera image</title>
    <rect x="0" y="0" width="320" height="180" fill="#1e293b" />
    {scene.shape === 'cup' ? <><rect x="108" y="46" width="84" height="90" rx="15" fill={scene.color} /><path d="M192 65 H220 V110 H192" fill="none" stroke={scene.color} strokeWidth="12" /></> : <rect x="95" y="40" width="130" height="100" rx={scene.shape === 'book' ? '4' : '12'} fill={scene.color} />}
    <text x="160" y="165" textAnchor="middle" fill="#f8fafc" fontSize="12">FICTIONAL PREVIEW</text>
  </svg>;
}

export default function CameraPreviewPrototype({ userId, role, language }) {
  const client = useRef(null), source = useRef(null);
  const [snapshot, setSnapshot] = useState(null);
  useEffect(() => {
    let active = true; const camera = createFictionalCamera(); source.current = camera;
    const current = createSyntheticCameraPreview({ camera, userId, role, language, onChange: next => { if (active) setSnapshot(next); } });
    client.current = current; setSnapshot(current.getSnapshot());
    const stop = () => current.stop('page_left');
    const hide = () => { if (document.visibilityState === 'hidden') stop(); };
    window.addEventListener('pagehide', stop); document.addEventListener('visibilitychange', hide);
    return () => { active = false; current.dispose(); if (client.current === current) { client.current = null; source.current = null; } window.removeEventListener('pagehide', stop); document.removeEventListener('visibilitychange', hide); };
  }, [userId, role, language]);
  if (!userId || !['provider', 'admin', 'super_admin'].includes(role) || !['ha', 'ig', 'yo'].includes(language)) return null;
  const status = snapshot?.status || 'off';
  return <section aria-label="AI pre-consultation assistant camera mock" className="space-y-4 rounded-2xl border border-indigo-700 bg-slate-900 p-5">
    <h2 className="text-xl font-semibold">AI pre-consultation assistant · optional visual context</h2>
    <p className="text-sm text-slate-300">Fictional interface test only. Your real camera stays off. This preview uses illustrated objects, with no photos, recording, upload, AI analysis or clinical record changes.</p>
    <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={snapshot?.consent || false} onChange={event => client.current?.setConsent(event.target.checked)} />I agree to try this local fictional camera preview. This is separate from audio consent and does not authorize sharing images.</label>
    <p role="status" aria-label="Fictional camera status" className="text-sm text-indigo-200">Fictional camera: {status.replaceAll('_', ' ')} · selected frames: {snapshot?.selected.length || 0}</p>
    <div className="flex flex-wrap gap-3"><button className={buttonClass} disabled={!snapshot?.consent || !['off', 'failed'].includes(status)} onClick={() => { void client.current?.start(); }}>Try fictional camera preview</button><button className={buttonClass} disabled={status === 'off' && !snapshot?.consent} onClick={() => client.current?.stop('user_stopped')}>Stop preview and clear frames</button></div>
    {status === 'requesting_permission' && <div className="space-y-3 rounded-xl border border-indigo-500 p-4" role="group" aria-label="Fictional camera permission">
      <p>This is a simulated permission request, not your browser camera prompt.</p><button className={buttonClass} onClick={() => source.current?.answerPermission(true)}>Allow fictional camera</button><button className={buttonClass} onClick={() => source.current?.answerPermission(false)}>Decline fictional camera</button>
    </div>}
    {status === 'previewing' && <><FictionalFrame frameId={snapshot.previewFrameId} /><div className="flex flex-wrap gap-3"><button className={buttonClass} disabled={snapshot.selectionPending} onClick={() => client.current?.nextFrame()}>Next fictional scene</button><button className={buttonClass} disabled={snapshot.selectionPending || snapshot.selected.length >= SCENES.length} onClick={() => { void client.current?.selectFrame(); }}>Select current fictional frame</button><button className={buttonClass} onClick={() => source.current?.disconnect()}>Simulate camera loss</button></div></>}
    {status === 'failed' && <p role="alert">Fictional permission was declined or the preview could not start. Nothing was shared.</p>}
    {snapshot?.selected.length > 0 && <div aria-label="Selected fictional frames" className="space-y-3"><h3 className="font-semibold">Selected locally, not sent</h3><ul className="grid gap-3 sm:grid-cols-3">{snapshot.selected.map(frame => <li key={frame.id} className="rounded-xl border border-slate-600 p-3"><FictionalFrame frameId={frame.id} /><p>{SCENES.find(scene => scene.id === frame.id).label}</p><p className="text-xs">Fictional source · {frame.language} · review required</p><button className={buttonClass} onClick={() => client.current?.removeFrame(frame.id)}>Remove {SCENES.find(scene => scene.id === frame.id).label}</button></li>)}</ul></div>}
    <p className="text-sm text-slate-300">Planned connection: live conversation plus a separately approved vision backend. No vision model has been selected or connected. These frames cannot be submitted, and no diagnosis or treatment is generated.</p>
  </section>;
}
