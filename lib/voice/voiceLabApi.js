import api from '@/lib/api';

export async function voiceLabRequest(path, body, options = {}) {
  // Shared API supplies current authenticated-session handling. The lab only
  // transmits fixed fixture keys and bounded controls, never user-entered text.
  const response = await api.request({ url: `/voice-lab${path}`, method: body === undefined ? 'GET' : 'POST',
    data: body, signal: options.signal, timeout: 10000 });
  return response.data;
}
