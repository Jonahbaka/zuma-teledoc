'use strict';

// Deliberately no native media, image bytes, persistence, network or model dependency.
const SCENES = Object.freeze([
  Object.freeze({ id: 'fictional-blue-notebook', label: 'Blue notebook', color: '#60a5fa', shape: 'book' }),
  Object.freeze({ id: 'fictional-green-cup', label: 'Green cup', color: '#4ade80', shape: 'cup' }),
  Object.freeze({ id: 'fictional-yellow-card', label: 'Yellow card', color: '#fde047', shape: 'card' }),
]);
const NOTICE_VERSION = 'local-fictional-frames-v1';
const MAX_SESSION_MS = 180000;
const LANGUAGES = ['ha', 'ig', 'yo'];
const ROLES = ['provider', 'admin', 'super_admin'];

function createFictionalCamera() {
  let pending = null; const resources = new Set();
  return {
    kind: 'fictional-camera',
    open() {
      if (pending) return Promise.reject(new Error('FICTIONAL_PERMISSION_PENDING'));
      return new Promise((resolve, reject) => { pending = { resolve, reject }; });
    },
    answerPermission(allowed) {
      const request = pending; pending = null; if (!request) return;
      if (allowed !== true) { request.reject(new Error('FICTIONAL_PERMISSION_DENIED')); return; }
      let closed = false; let index = 0; let ended = () => {};
      const resource = {
        kind: 'fictional-camera-resource',
        currentFrame: () => closed ? null : SCENES[index].id,
        nextFrame: () => { if (!closed) index = (index + 1) % SCENES.length; return resource.currentFrame(); },
        selectFrame: async () => resource.currentFrame(),
        onEnded: callback => { ended = callback; return () => { ended = () => {}; }; },
        close: () => { closed = true; resources.delete(resource); },
        disconnect: () => { if (closed) return; resource.close(); ended(); },
      };
      resources.add(resource); request.resolve(resource);
    },
    cancelPermission() { const request = pending; pending = null; request?.reject(new Error('FICTIONAL_PERMISSION_CANCELLED')); },
    disconnect() { for (const resource of [...resources]) resource.disconnect(); },
    activeCount: () => resources.size,
  };
}

function createSyntheticCameraPreview({ camera, userId, role, language, onChange = () => {}, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  if (camera?.kind !== 'fictional-camera') throw new Error('Only fictional camera adapters are permitted.');
  const validScope = typeof userId === 'string' && userId.length > 0 && ROLES.includes(role) && LANGUAGES.includes(language);
  let disposed = false, generation = 0, resource = null, unsubscribe = null, timer = null, selectionPending = false, selectionVersion = 0;
  let state = { status: 'off', consent: false, noticeVersion: NOTICE_VERSION, language, previewFrameId: null, selected: [], reason: null, expiresAt: null };
  const snapshot = () => ({ ...state, selected: state.selected.map(frame => ({ ...frame })), selectionPending });
  const emit = () => { if (!disposed) onChange(snapshot()); };
  const validFrame = id => SCENES.some(frame => frame.id === id);
  function clear(reason = 'stopped') {
    generation++; selectionVersion++; clearTimer(timer); timer = null; unsubscribe?.(); unsubscribe = null;
    const old = resource; resource = null; old?.close(); camera.cancelPermission?.(); selectionPending = false;
    state = { ...state, status: 'off', consent: false, previewFrameId: null, selected: [], reason, expiresAt: null }; emit();
  }
  function stillCurrent(token, owned) {
    return !disposed && token === generation && state.consent && (!owned || resource === owned) && state.expiresAt > now();
  }
  function expireIfNeeded() {
    if (state.expiresAt !== null && now() >= state.expiresAt) { clear('expired'); return true; } return false;
  }
  return {
    getSnapshot: snapshot,
    setConsent(value) {
      if (disposed || !validScope) return false;
      if (value !== true) { clear('consent_withdrawn'); return true; }
      state = { ...state, consent: true, reason: null }; emit(); return true;
    },
    async start() {
      if (disposed || !validScope || !state.consent || !['off', 'failed'].includes(state.status)) return false;
      const token = ++generation;
      state = { ...state, status: 'requesting_permission', reason: null, expiresAt: now() + MAX_SESSION_MS }; emit();
      timer = setTimer(() => { if (token === generation) clear('expired'); }, MAX_SESSION_MS); timer?.unref?.();
      let acquired;
      try {
        acquired = await camera.open();
        if (!stillCurrent(token)) { acquired?.close(); if (token === generation) expireIfNeeded(); return false; }
        if (acquired?.kind !== 'fictional-camera-resource' || !validFrame(acquired.currentFrame())) throw new Error('FICTIONAL_FRAME_INVALID');
        resource = acquired;
        unsubscribe = resource.onEnded(() => { if (token === generation && resource === acquired) clear('device_lost'); });
        state = { ...state, status: 'previewing', previewFrameId: resource.currentFrame() }; emit(); return true;
      } catch {
        acquired?.close(); if (token !== generation || disposed) return false;
        clear('permission_failed'); state = { ...state, status: 'failed' }; emit(); return false;
      }
    },
    nextFrame() {
      if (disposed || expireIfNeeded() || state.status !== 'previewing' || selectionPending) return false;
      const frameId = resource.nextFrame(); if (!validFrame(frameId)) { clear('invalid_frame'); return false; }
      state = { ...state, previewFrameId: frameId }; emit(); return true;
    },
    async selectFrame() {
      if (disposed || expireIfNeeded() || state.status !== 'previewing' || !state.consent || selectionPending || state.selected.length >= SCENES.length) return false;
      const token = generation, owned = resource, action = selectionVersion; selectionPending = true; emit();
      try {
        const frameId = await owned.selectFrame();
        if (!stillCurrent(token, owned)) { if (token === generation) expireIfNeeded(); return false; }
        if (action !== selectionVersion) return false;
        if (!validFrame(frameId)) { clear('invalid_frame'); return false; }
        if (!state.selected.some(frame => frame.id === frameId)) state = { ...state, selected: [...state.selected, { id: frameId, language, selectedAt: now(), source: 'fictional_local_selection', noticeVersion: NOTICE_VERSION }] };
        return true;
      } catch { if (token === generation) clear('frame_failed'); return false; }
      finally { if (token === generation) { selectionPending = false; emit(); } }
    },
    removeFrame(frameId) {
      if (disposed || expireIfNeeded()) return;
      selectionVersion++; state = { ...state, selected: state.selected.filter(frame => frame.id !== frameId) }; emit();
    },
    stop: clear,
    dispose() { if (disposed) return; clear('disposed'); disposed = true; },
  };
}

module.exports = { SCENES, NOTICE_VERSION, MAX_SESSION_MS, createFictionalCamera, createSyntheticCameraPreview };
