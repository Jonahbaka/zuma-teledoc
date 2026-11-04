import api from '@/lib/api';
async function request(path, body, { signal } = {}) {
  const response = await api.request({ url: `/voice-live${path}`, method: body === undefined ? 'GET' : 'POST', data: body, timeout: 25000, signal });
  return response.data;
}
export const voiceLiveApi = {
  capabilities: () => request('/capabilities'),
  reserve: input => request('/permits', input),
  connect: (id, input) => request(`/permits/${id}/connect`, input),
  stop: id => request(`/permits/${id}/stop`, {}),
  lease: (id, options) => request(`/permits/${id}/lease`, {}, options),
};
