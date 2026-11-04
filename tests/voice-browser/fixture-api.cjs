'use strict';
// Replaces only the HTTP client in the standalone fixture bundle. The actual
// live panel/controller, API router, broker, provider adapter and policy run.
async function request(path, body) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'omit',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fictional-browser-fixture' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error('Synthetic fixture request rejected.'), { code: result.code });
  return result;
}
module.exports = {
  request,
  voiceLiveApi: {
    capabilities: () => request('/api/voice-live/capabilities'),
    reserve: input => request('/api/voice-live/permits', input),
    connect: (id, body) => request(`/api/voice-live/permits/${id}/connect`, body),
    stop: id => request(`/api/voice-live/permits/${id}/stop`, {}),
    lease: id => request(`/api/voice-live/permits/${id}/lease`, {}),
  },
};
