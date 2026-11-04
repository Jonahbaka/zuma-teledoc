import api from '@/lib/api';
export const voicePcmApi = {
  async capabilities() {
    const response = await api.request({ url: '/voice-pcm-evaluation/capabilities', method: 'GET', timeout: 10000 });
    return response.data;
  },
};
