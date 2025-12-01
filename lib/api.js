/**
 * Axios API Client
 * Configured with interceptors for auth and error handling
 */

import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

const api = axios.create({
  baseURL: API_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  },
  withCredentials: true
});

// Request interceptor - add auth token
api.interceptors.request.use(
  (config) => {
    // Get token from localStorage
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('accessToken');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor - handle token refresh and errors
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    
    // Handle token expiration
    if (error.response?.status === 401 && 
        error.response?.data?.code === 'TOKEN_EXPIRED' && 
        !originalRequest._retry) {
      originalRequest._retry = true;
      
      try {
        // Try to refresh the token
        const refreshToken = localStorage.getItem('refreshToken');
        if (refreshToken) {
          const response = await axios.post(`${API_URL}/auth/refresh`, {
            refreshToken
          }, { withCredentials: true });
          
          if (response.data.success) {
            // Store new tokens
            localStorage.setItem('accessToken', response.data.accessToken);
            if (response.data.refreshToken) {
              localStorage.setItem('refreshToken', response.data.refreshToken);
            }
            
            // Retry original request with new token
            originalRequest.headers.Authorization = `Bearer ${response.data.accessToken}`;
            return api(originalRequest);
          }
        }
      } catch (refreshError) {
        // Refresh failed - clear tokens and redirect to login
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        
        if (typeof window !== 'undefined' && !window.location.pathname.includes('/login')) {
          window.location.href = '/login?session=expired';
        }
      }
    }
    
    // Handle other errors
    if (error.response?.status === 403) {
      // Access denied - possibly need MFA or account issues
      if (error.response?.data?.code === 'MFA_REQUIRED') {
        // MFA verification needed
        return Promise.reject(error);
      }
    }
    
    return Promise.reject(error);
  }
);

// API helper methods
export const authAPI = {
  login: (data) => api.post('/auth/login', data),
  register: (data) => api.post('/auth/register', data),
  logout: () => api.post('/auth/logout'),
  refresh: () => api.post('/auth/refresh'),
  me: () => api.get('/auth/me'),
  setupMfa: (data) => api.post('/auth/mfa/setup', data),
  verifyMfa: (data) => api.post('/auth/mfa/verify', data),
  disableMfa: (data) => api.post('/auth/mfa/disable', data),
  changePassword: (data) => api.post('/auth/password/change', data),
  requestPasswordReset: (data) => api.post('/auth/password/request-reset', data),
  resetPassword: (data) => api.post('/auth/password/reset', data),
  verifyEmail: (data) => api.post('/auth/verify-email', data),
  resendVerification: () => api.post('/auth/resend-verification')
};

export const usersAPI = {
  getProfile: () => api.get('/users/profile'),
  updateProfile: (data) => api.put('/users/profile', data),
  getUser: (id) => api.get(`/users/${id}`),
  deleteAccount: () => api.delete('/users/account')
};

export const appointmentsAPI = {
  create: (data) => api.post('/appointments', data),
  getAll: (params) => api.get('/appointments', { params }),
  getUpcoming: (limit) => api.get('/appointments/upcoming', { params: { limit } }),
  getById: (id) => api.get(`/appointments/${id}`),
  update: (id, data) => api.put(`/appointments/${id}`, data),
  cancel: (id, reason) => api.post(`/appointments/${id}/cancel`, { reason }),
  join: (id) => api.post(`/appointments/${id}/join`)
};

export const medicalRecordsAPI = {
  create: (data) => api.post('/medical-records', data),
  getByPatient: (patientId, params) => api.get(`/medical-records/patient/${patientId}`, { params }),
  getById: (id) => api.get(`/medical-records/${id}`),
  update: (id, data) => api.put(`/medical-records/${id}`, data),
  delete: (id) => api.delete(`/medical-records/${id}`),
  export: (patientId) => api.get(`/medical-records/export/${patientId}`)
};

export const messagesAPI = {
  send: (data) => api.post('/messages', data),
  getConversations: () => api.get('/messages/conversations'),
  getConversation: (recipientId, params) => api.get(`/messages/conversation/${recipientId}`, { params }),
  getUnreadCount: () => api.get('/messages/unread-count'),
  markRead: (id) => api.put(`/messages/${id}/read`),
  delete: (id) => api.delete(`/messages/${id}`)
};

export const notificationsAPI = {
  getAll: (params) => api.get('/notifications', { params }),
  getUnreadCount: () => api.get('/notifications/unread-count'),
  markRead: (id) => api.put(`/notifications/${id}/read`),
  markAllRead: () => api.put('/notifications/read-all'),
  delete: (id) => api.delete(`/notifications/${id}`),
  broadcast: (data) => api.post('/notifications/broadcast', data)
};

export const providersAPI = {
  getAll: (params) => api.get('/providers', { params }),
  getById: (id) => api.get(`/providers/${id}`),
  getAvailability: (id, date) => api.get(`/providers/${id}/availability`, { params: { date } }),
  getSchedule: () => api.get('/providers/me/schedule'),
  updateSchedule: (schedule) => api.put('/providers/me/schedule', { schedule }),
  getTimeOff: () => api.get('/providers/me/time-off'),
  addTimeOff: (data) => api.post('/providers/me/time-off', data),
  deleteTimeOff: (id) => api.delete(`/providers/me/time-off/${id}`),
  getPatients: (params) => api.get('/providers/me/patients', { params }),
  // getWaitingRoom removed - waiting room implementation deleted
};

export const visitsAPI = {
  create: (data) => api.post('/visits', data),
  getById: (id) => api.get(`/visits/${id}`),
  update: (id, data) => api.put(`/visits/${id}`, data),
  sign: (id) => api.post(`/visits/${id}/sign`),
  getByPatient: (patientId, params) => api.get(`/visits/patient/${patientId}`, { params }),
  getRecent: (limit) => api.get('/visits/provider/recent', { params: { limit } })
};

export const adminAPI = {
  getDashboard: () => api.get('/admin/dashboard'),
  getUsers: (params) => api.get('/admin/users', { params }),
  getUserById: (id) => api.get(`/admin/users/${id}`),
  updateUserStatus: (id, data) => api.put(`/admin/users/${id}/status`, data),
  getPendingProviders: () => api.get('/admin/providers/pending'),
  getAuditLogs: (params) => api.get('/admin/audit-logs', { params }),
  getAppointmentAnalytics: (params) => api.get('/admin/analytics/appointments', { params }),
  getRevenueAnalytics: () => api.get('/admin/analytics/revenue'),
  // Admin management (super_admin only)
  getAdmins: () => api.get('/admin/admins'),
  createAdmin: (data) => api.post('/admin/admins', data),
  updateAdminRole: (id, data) => api.put(`/admin/admins/${id}/role`, data),
  // Financial tools
  getForecast: (params) => api.get('/admin/forecast', { params }),
  getAccounting: (params) => api.get('/admin/accounting', { params })
};

// Subscriptions API
export const subscriptionsAPI = {
  getMySubscription: () => api.get('/subscriptions/me'),
  createSubscription: (data) => api.post('/subscriptions', data),
  updateSubscription: (data) => api.patch('/subscriptions/me', data),
  cancelSubscription: () => api.post('/subscriptions/me/cancel')
};

// Payments API
export const paymentsAPI = {
  getAppointmentPayment: (appointmentId) => api.get(`/payments/appointment/${appointmentId}`),
  payPerVisit: (data) => api.post('/payments/pay-per-visit', data),
  insuranceCopay: (data) => api.post('/payments/insurance-copay', data),
  getPaymentHistory: () => api.get('/payments/history')
};

// Prior Authorization API
export const priorAuthAPI = {
  getAll: () => api.get('/prior-auth'),
  getById: (id) => api.get(`/prior-auth/${id}`),
  create: (data) => api.post('/prior-auth', data),
  updateStatus: (id, data) => api.patch(`/prior-auth/${id}/status`, data)
};

// Claims API
export const claimsAPI = {
  getAll: (params) => api.get('/claims', { params }),
  getById: (id) => api.get(`/claims/${id}`),
  create: (data) => api.post('/claims', data),
  submit: (id) => api.post(`/claims/${id}/submit`),
  applyCorrections: (id, corrections) => api.patch(`/claims/${id}/correct`, { corrections }),
  updateRemittance: (id, data) => api.patch(`/claims/${id}/remittance`, data)
};

// Insurance Wallet API
export const insuranceAPI = {
  getWallet: () => api.get('/insurance/wallet'),
  getById: (id, reason) => api.get(`/insurance/${id}`, { params: { reason } }),
  uploadOCR: (formData) => api.post('/insurance/ocr', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  setPrimary: (id) => api.patch(`/insurance/${id}/primary`),
  verifyEligibility: (id) => api.post(`/insurance/${id}/verify`),
  updateStatus: (id, status) => api.patch(`/insurance/${id}/status`, { status }),
  captureConsent: (id, consentGiven) => api.post(`/insurance/${id}/consent`, { consentGiven }),
  exportProof: (id) => api.get(`/insurance/${id}/export`),
  getAuditLog: (id) => api.get(`/insurance/${id}/audit`)
};

// RTBC API
export const rtbcAPI = {
  check: (medicationName, ndcCode, insuranceId) => api.get('/rtbc/check', {
    params: { medicationName, ndcCode, insuranceId }
  }),
  comparePrices: (medicationName, ndcCode, hasGoldCard) => api.post('/rtbc/compare', {
    medicationName,
    ndcCode,
    hasGoldCard
  })
};

// Triage API
export const triageAPI = {
  store: (appointmentId, symptoms, triageResult) => api.post('/triage', {
    appointmentId,
    symptoms,
    triageResult
  }),
  getForAppointment: (appointmentId) => api.get(`/triage/appointment/${appointmentId}`),
  getProviderAppointments: () => api.get('/triage/provider/appointments')
};

export default api;

