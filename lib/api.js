/**
 * Axios API Client
 * Configured with interceptors for auth and error handling
 */

import axios from 'axios';

// Detect environment and set appropriate API URL
// In browser: check if we're on localhost or production domain
// On server: use env vars
const getApiUrl = () => {
  // Server-side
  if (typeof window === 'undefined') {
    return process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || 'http://localhost:8080/api';
  }
  
  // Client-side - check actual hostname
  const hostname = window.location.hostname;
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
  
  if (isLocalhost) {
    // The Next.js development server is split from the API, while the
    // production server (including production-mode browser tests) serves both
    // from port 8080. Keep production-mode requests same-origin so CSP, auth
    // cookies, and localStorage bearer tokens all use the same host.
    const isCombinedProductionServer = window.location.port === '8080';
    return process.env.NEXT_PUBLIC_API_URL || (isCombinedProductionServer
      ? `${window.location.origin}/api`
      : 'http://localhost:8080/api');
  }
  
  // Production - use same origin or explicit env var
  return process.env.NEXT_PUBLIC_API_URL || `${window.location.origin}/api`;
};

const normalizeApiUrl = (url) => {
  const fallback = typeof window === 'undefined' ? 'http://localhost:8080/api' : `${window.location.origin}/api`;
  const raw = String(url || fallback).trim().replace(/\/+$/, '');
  // Production has previously been deployed with NEXT_PUBLIC_API_URL ending in
  // /api/api. Collapse duplicate API path segments so client calls such as
  // /ng/discovery/home resolve to /api/ng/discovery/home instead of 404ing.
  return raw.replace(/(\/api)(?:\/api)+$/i, '$1');
};

const API_URL = normalizeApiUrl(getApiUrl());

const getSessionExpiredLoginUrl = (path = '') => {
  if (path.includes('/ng/phc')) {
    return '/ng/provider/login?session=expired&returnTo=%2Fng%2Fphc';
  }

  if (path.includes('/ng/admin')) {
    return '/ng/admin/login?session=expired';
  }

  if (path.includes('/admin') || path.includes('/secure')) {
    return '/secure/admin?session=expired';
  }

  if (path.includes('/ng/provider')) {
    return '/ng/provider/login?session=expired';
  }

  if (path.includes('/ng/pharmacy')) {
    return '/ng/pharmacy/login?session=expired';
  }

  if (path.includes('/ng/patient') || path.includes('/ng/auth')) {
    return '/ng/auth/login?session=expired';
  }

  if (path.includes('/provider')) {
    return '/provider/login?session=expired';
  }

  if (path.includes('/pharmacy')) {
    return '/pharmacy/login?session=expired';
  }

  return '/patient/login?session=expired';
};

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
    if (typeof config.url === 'string') {
      config.url = config.url.replace(/^\/api(?=\/|$)/i, '');
    }

    // Skip auth header for login/registration or explicit opt-out
    if (config?.skipAuth) {
      return config;
    }
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
    
    // Handle 431 - Request Header Fields Too Large (corrupted/oversized tokens)
    if (error.response?.status === 431) {
      console.warn('431 error - clearing potentially corrupted tokens');
      if (typeof window !== 'undefined') {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
      }
      // For login requests, retry once after clearing
      if (!originalRequest._retry431 && originalRequest.url?.includes('/auth/login')) {
        originalRequest._retry431 = true;
        return api(originalRequest);
      }
      return Promise.reject(error);
    }
    
    // Handle 401 Unauthorized - token expired, invalid, or server secret changed
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      
      // Skip redirect for login/register requests
      const isAuthRequest = originalRequest.url?.includes('/auth/login') || 
                           originalRequest.url?.includes('/auth/register');
      if (isAuthRequest) {
        return Promise.reject(error);
      }
      
      try {
        // Try to refresh the token
        const refreshToken = typeof window !== 'undefined' ? localStorage.getItem('refreshToken') : null;
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
        // Refresh failed - fall through to clear tokens
      }
      
      // Clear tokens and redirect to appropriate login page
      if (typeof window !== 'undefined') {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('user');
        
        // Don't redirect if already on a login page
        const path = window.location.pathname;
        if (!path.includes('/login')) {
          window.location.href = getSessionExpiredLoginUrl(path);
        }
      }
    }
    
    // Handle other errors
    if (error.response?.status === 403) {
      if (error.response?.data?.code === 'PASSWORD_CHANGE_REQUIRED' && typeof window !== 'undefined') {
        const path = window.location.pathname;
        const target = path.startsWith('/ng/pharmacy')
          ? '/ng/pharmacy/create-password'
          : path.startsWith('/pharmacy')
          ? '/pharmacy/create-password'
          : path.startsWith('/ng/provider')
          ? '/ng/provider/create-password'
          : '/provider/create-password';

        if (path !== target) {
          window.location.href = target;
        }
      }

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
  login: (data) => api.post('/auth/login', data, { skipAuth: true }),
  register: (data) => api.post('/auth/register', data, { skipAuth: true }),
  registerProvider: (data) => api.post('/invitations/accept', data, { skipAuth: true }),
  validateInvite: (token) => api.get(`/invitations/validate/${token}`, { skipAuth: true }),
  logout: () => api.post('/auth/logout'),
  refresh: () => api.post('/auth/refresh', {}, { skipAuth: true }),
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
  getTestAccounts: (params = {}) => api.get('/admin/users', { params: { ...params, isTestAccount: true } }),
  createTestAccount: (data) => api.post('/admin/test-accounts', data),
  getUserById: (id) => api.get(`/admin/users/${id}`),
  updateUserStatus: (id, data) => api.put(`/admin/users/${id}/status`, data),
  unlockUser: (id) => api.post(`/admin/users/${id}/unlock`),
  deleteUser: (id) => api.delete(`/admin/users/${id}`),
  getPendingProviders: () => api.get('/admin/providers/pending'),
  getAuditLogs: (params) => api.get('/admin/audit-logs', { params }),
  getAppointmentAnalytics: (params) => api.get('/admin/analytics/appointments', { params }),
  getRevenueAnalytics: () => api.get('/admin/analytics/revenue'),
  getRealtimeOverview: () => api.get('/realtime-analytics/overview'),
  runRealtimeGrowthAction: () => api.post('/realtime-analytics/growth/act'),
  // Admin management (super_admin only)
  getAdmins: () => api.get('/admin/admins'),
  createAdmin: (data) => api.post('/admin/admins', data),
  updateAdminRole: (id, data) => api.put(`/admin/admins/${id}/role`, data),
  // Financial tools
  getForecast: (params) => api.get('/admin/forecast', { params }),
  getAccounting: (params) => api.get('/admin/accounting', { params }),
  // Admin communications
  sendMessage: (data) => api.post('/admin/messages', data),
  sendBulkMessage: (data) => api.post('/admin/messages/bulk', data),
  getCommunications: (params) => api.get('/admin/communications', { params }),
  // Invitations
  getInvites: (params) => api.get('/invitations', { params }),
  createInvite: (data) => api.post('/invitations', data),
  resendInvite: (id) => api.post(`/invitations/${id}/resend`),
  revokeInvite: (id) => api.delete(`/invitations/${id}`)
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
  // Provider/admin helpers (must be authorized to access patient)
  getPatientWallet: (patientId) => api.get(`/insurance/patient/${patientId}/wallet`),
  getPatientInsuranceById: (patientId, insuranceId, reason, includeImages = false) =>
    api.get(`/insurance/patient/${patientId}/${insuranceId}`, { params: { reason, includeImages } }),
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

// Enhanced Triage Queue API
export const triageQueueAPI = {
  // Patient endpoints
  createSession: (data) => api.post('/triage-queue/session', data),
  analyze: (data) => api.post('/triage-queue/analyze', data),
  getHistory: (params) => api.get('/triage-queue/history', { params }),
  getSession: (sessionId) => api.get(`/triage-queue/session/${sessionId}`),
  
  // Provider endpoints
  getQueue: (params) => api.get('/triage-queue', { params }),
  getStats: () => api.get('/triage-queue/stats'),
  claimCase: (queueId) => api.post(`/triage-queue/${queueId}/claim`),
  startConsultation: (queueId) => api.post(`/triage-queue/${queueId}/start`),
  completeConsultation: (queueId, data) => api.post(`/triage-queue/${queueId}/complete`, data),
  
  // Reference data
  getLevels: () => api.get('/triage-queue/levels')
};

// Prescription API
export const prescriptionAPI = {
  create: (data) => api.post('/prescriptions', data),
  getAll: (params) => api.get('/prescriptions', { params }),
  getById: (id) => api.get(`/prescriptions/${id}`),
  getHistory: (id) => api.get(`/prescriptions/${id}/history`),
  signAndSend: (id, data) => api.post(`/prescriptions/${id}/sign-and-send`, data),
  updatePharmacy: (id, pharmacy) => api.put(`/prescriptions/${id}/pharmacy`, pharmacy),
  cancel: (id, reason) => api.post(`/prescriptions/${id}/cancel`, { reason }),
  requestRefill: (id) => api.post(`/prescriptions/${id}/refill`),
  searchMedications: (query) => api.get('/prescriptions/medications/search', { params: { q: query } })
};

// Pharmacy API
export const pharmacyAPI = {
  findNearby: (latitude, longitude, radius) => api.get('/pharmacy/nearby', {
    params: { latitude, longitude, radius }
  }),
  search: (query, params) => api.get('/pharmacy/search', {
    params: { q: query, ...params }
  }),
  getPreferences: (patientId) => api.get('/pharmacy/preferences', {
    params: patientId ? { patientId } : undefined
  }),
  addPreference: (data) => api.post('/pharmacy/preferences', data),
  setPreferred: (pharmacyId) => api.put(`/pharmacy/preferences/${pharmacyId}/preferred`),
  removePreference: (pharmacyId) => api.delete(`/pharmacy/preferences/${pharmacyId}`),
  getByNpi: (npi) => api.get(`/pharmacy/${npi}`)
};

// Mini-EHR / Clinical Encounters API
export const clinicalEhrAPI = {
  // Encounters
  createEncounter: (data) => api.post('/clinical-encounters', data),
  getEncounter: (encounterId) => api.get(`/clinical-encounters/${encounterId}`),
  completeEncounter: (encounterId) => api.post(`/clinical-encounters/${encounterId}/complete`),
  getPatientEncounters: (patientId, params) => api.get(`/clinical-encounters/patient/${patientId}`, { params }),

  // Notes
  createNote: (encounterId, data) => api.post(`/clinical-encounters/${encounterId}/notes`, data),
  getEncounterNotes: (encounterId) => api.get(`/clinical-encounters/${encounterId}/notes`),
  updateNote: (noteId, data) => api.put(`/clinical-encounters/notes/${noteId}`, data),
  signNote: (noteId) => api.post(`/clinical-encounters/notes/${noteId}/sign`),
  amendNote: (noteId, data) => api.post(`/clinical-encounters/notes/${noteId}/amend`, data),
  getNoteHistory: (noteId) => api.get(`/clinical-encounters/notes/${noteId}/history`),

  // Patient clinical profile
  getProfile: (patientId) => api.get(`/clinical-encounters/patient/${patientId}/profile`),
  updateProfile: (patientId, data) => api.put(`/clinical-encounters/patient/${patientId}/profile`, data),
  verifyIdentity: (patientId, method) => api.post(`/clinical-encounters/patient/${patientId}/verify-identity`, { method }),
  getSummary: (patientId) => api.get(`/clinical-encounters/patient/${patientId}/summary`),

  // Allergies
  getAllergies: (patientId, params) => api.get(`/clinical-encounters/patient/${patientId}/allergies`, { params }),
  addAllergy: (patientId, data) => api.post(`/clinical-encounters/patient/${patientId}/allergies`, data),
  verifyAllergy: (allergyId) => api.post(`/clinical-encounters/allergies/${allergyId}/verify`),
  inactivateAllergy: (allergyId, reason) => api.delete(`/clinical-encounters/allergies/${allergyId}`, { data: { reason } }),

  // Problems
  getProblems: (patientId, params) => api.get(`/clinical-encounters/patient/${patientId}/problems`, { params }),
  addProblem: (patientId, data) => api.post(`/clinical-encounters/patient/${patientId}/problems`, data),
  updateProblem: (problemId, data) => api.put(`/clinical-encounters/problems/${problemId}`, data),

  // Medications
  getMedications: (patientId, params) => api.get(`/clinical-encounters/patient/${patientId}/medications`, { params }),
  addMedication: (patientId, data) => api.post(`/clinical-encounters/patient/${patientId}/medications`, data),
  discontinueMedication: (medicationId, reason) => api.delete(`/clinical-encounters/medications/${medicationId}`, { data: { reason } }),

  // Consent
  getConsentTemplate: (state) => api.get(`/clinical-encounters/consent/template`, { params: { state } }),
  captureConsent: (data) => api.post(`/clinical-encounters/consent`, data),
  checkConsent: (params) => api.get(`/clinical-encounters/consent/check`, { params }),
  getConsents: (patientId) => api.get(`/clinical-encounters/patient/${patientId}/consents`),
  revokeConsent: (consentId, patientId, reason) => api.post(`/clinical-encounters/consent/${consentId}/revoke`, { patientId, reason }),

  // External eRx (prescription intents + handoff)
  listPrescriptionIntents: (params) => api.get('/clinical-encounters/prescription-intents', { params }),
  createPrescriptionIntent: (data) => api.post('/clinical-encounters/prescription-intents', data),
  getEncounterPrescriptionIntents: (encounterId) => api.get(`/clinical-encounters/${encounterId}/prescription-intents`),
  initiateHandoff: (intentId, eRxSystem) => api.post(`/clinical-encounters/prescription-intents/${intentId}/handoff`, { eRxSystem })
};

// Provider API
export const providerAPI = {
  // Credentialing
  getCredentialing: () => api.get('/credentialing/me'),
  updatePersonalInfo: (data) => api.put('/credentialing/personal-info', data),
  updateProfessionalInfo: (data) => api.put('/credentialing/professional-info', data),
  updateLicense: (data) => api.put('/credentialing/license', data),
  updateDEA: (data) => api.put('/credentialing/dea', data),
  updateNPI: (data) => api.put('/credentialing/npi', data),
  updateEducation: (data) => api.put('/credentialing/education', data),
  updateBoardCertification: (data) => api.put('/credentialing/board-certification', data),
  updateMalpractice: (data) => api.put('/credentialing/malpractice', data),
  addWorkHistory: (data) => api.post('/credentialing/work-history', data),
  addReference: (data) => api.post('/credentialing/references', data),
  uploadDocument: (formData) => api.post('/credentialing/documents', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  consentBackgroundCheck: () => api.post('/credentialing/background-check/consent'),
  submitApplication: () => api.post('/credentialing/submit')
};

// Stripe Payment API
export const stripeAPI = {
  getPricing: () => api.get('/stripe/pricing'),
  createConsultationCheckout: (data) => api.post('/stripe/checkout/consultation', data),
  createSubscriptionCheckout: (data) => api.post('/stripe/checkout/subscription', data),
  createCredentialingCheckout: (data) => api.post('/stripe/checkout/credentialing', data),
  createProviderSubscriptionCheckout: (data) => api.post('/stripe/checkout/provider-subscription', data),
  getSubscriptionStatus: () => api.get('/stripe/subscription/status'),
  createBillingPortal: () => api.post('/stripe/billing-portal'),
  cancelSubscription: (immediately) => api.post('/stripe/subscription/cancel', { immediately })
};

// Membership API
export const membershipAPI = {
  getMe: () => api.get('/membership/me')
};

// Testing Links API (for demo/testing access)
export const testingLinksAPI = {
  list: (params) => api.get('/testing-links', { params }),
  create: (data) => api.post('/testing-links', data),
  get: (id) => api.get(`/testing-links/${id}`),
  update: (id, data) => api.patch(`/testing-links/${id}`, data),
  delete: (id) => api.delete(`/testing-links/${id}`),
  validate: (token) => api.post('/testing-links/validate', { token }),
  activate: (token) => api.post('/testing-links/activate', { token }),
  myStatus: () => api.get('/testing-links/my-status')
};

const phcContextConfig = (context, config = {}) => ({
  ...config,
  headers: {
    ...config.headers,
    'x-programme-id': context?.programmeId || context?.programme_id,
    'x-facility-id': context?.facilityId || context?.facility_id,
  },
});

// Nigeria PHC programme workspace. Every clinical and operational request is
// bound to an explicit programme/facility context on the server.
export const phcAPI = {
  getContexts: () => api.get('/ng/phc/contexts'),
  getConfiguration: (context) => api.get('/ng/phc/configuration', phcContextConfig(context)),
  searchPatients: (context, query, limit = 25) => api.get('/ng/phc/patients/search', phcContextConfig(context, {
    params: { q: query, limit },
  })),
  enrollPatient: (context, data) => api.post('/ng/phc/enrollments', data, phcContextConfig(context)),
  createEncounter: (context, data) => api.post('/ng/phc/encounters', data, phcContextConfig(context)),
  getEncounter: (context, encounterId) => api.get(`/ng/phc/encounters/${encounterId}`, phcContextConfig(context)),
  listObservations: (context, encounterId) => api.get(
    `/ng/phc/encounters/${encounterId}/observations`,
    phcContextConfig(context)
  ),
  createObservation: (context, data) => api.post('/ng/phc/observations', data, phcContextConfig(context)),
  listQueue: (context, params = {}) => api.get('/ng/phc/queue', phcContextConfig(context, { params })),
  enqueue: (context, data) => api.post('/ng/phc/queue', data, phcContextConfig(context)),
  claimQueueEntry: (context, queueEntryId = null) => api.post(
    '/ng/phc/queue/claim',
    { queueEntryId },
    phcContextConfig(context)
  ),
  transitionQueueEntry: (context, queueEntryId, data) => api.patch(
    `/ng/phc/queue/${queueEntryId}/status`,
    data,
    phcContextConfig(context)
  ),
  listFollowUps: (context, params = {}) => api.get(
    '/ng/phc/follow-ups',
    phcContextConfig(context, { params })
  ),
  createFollowUp: (context, data) => api.post('/ng/phc/follow-ups', data, phcContextConfig(context)),
  createReferral: (context, data) => api.post('/ng/phc/referrals', data, phcContextConfig(context)),
  listReferrals: (context, params = {}) => api.get('/ng/phc/referrals', phcContextConfig(context, { params })),
  transitionReferral: (context, referralId, data) => api.patch(
    `/ng/phc/referrals/${referralId}/status`,
    data,
    phcContextConfig(context)
  ),
  registerOfflineDevice: (context, data) => api.post('/ng/phc/sync/devices', data, phcContextConfig(context)),
  synchronizeOfflineOperations: (context, data) => api.post('/ng/phc/sync', data, phcContextConfig(context)),
  listClinicalDevices: (context) => api.get('/ng/phc/devices', phcContextConfig(context)),
  getDeviceCapabilities: (context) => api.get('/ng/phc/devices/capabilities', phcContextConfig(context)),
  registerClinicalDevice: (context, data) => api.post('/ng/phc/devices', data, phcContextConfig(context)),
  captureMockDevice: (context, data) => api.post('/ng/phc/devices/mock-capture', data, phcContextConfig(context)),
  previewReport: (context, period) => api.get('/ng/phc/reports/preview', phcContextConfig(context, { params: { period } })),
  generateReport: (context, data) => api.post('/ng/phc/reports', data, phcContextConfig(context)),
  listReports: (context, params = {}) => api.get('/ng/phc/reports', phcContextConfig(context, { params })),
  previewDhis2: (context, reportId) => api.post(
    `/ng/phc/reports/${reportId}/dhis2-preview`,
    {},
    phcContextConfig(context)
  ),
  createAiSuggestion: (context, data) => api.post('/ng/phc/ai/suggestions', data, phcContextConfig(context)),
  listAiSuggestions: (context, encounterId) => api.get(
    `/ng/phc/ai/encounters/${encounterId}/suggestions`,
    phcContextConfig(context)
  ),
  getAiSuggestion: (context, suggestionId) => api.get(
    `/ng/phc/ai/suggestions/${suggestionId}`,
    phcContextConfig(context)
  ),
  reviewAiSuggestion: (context, suggestionId, data) => api.post(
    `/ng/phc/ai/suggestions/${suggestionId}/review`,
    data,
    phcContextConfig(context)
  ),
};

// Hive API (Agent Hive OS)
export const hiveAPI = {
  createSession: (data) => api.post('/hive/session', data),
  createPublicSession: () => api.post('/hive/session/public', {}, { skipAuth: true }),
  sendMessage: (data) => api.post('/hive/message', data),
  getSession: (sessionId) => api.get(`/hive/session/${sessionId}`),
  bookFromTriage: (data) => api.post('/hive/triage/book', data),
  getOverwatch: () => api.get('/hive/overwatch'),
  getStatus: () => api.get('/hive/status'),
  kill: (scope) => api.post('/hive/kill', { scope }),
  pause: (paused) => api.post('/hive/pause', { paused }),
};

export default api;

