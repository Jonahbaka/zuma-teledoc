import api from '@/lib/api';

export function formatNaira(amount) {
  return `NGN ${Number(amount || 0).toLocaleString()}`;
}

export function getNigeriaStatusTone(status) {
  const normalized = String(status || '').toLowerCase();

  if (['approved', 'available', 'delivered', 'completed', 'verified', 'valid'].includes(normalized)) {
    return 'bg-emerald-100 text-emerald-700';
  }

  if (['pending', 'pending_review', 'pending_pharmacy_confirmation', 'pharmacy_reviewing', 'documents_submitted', 'under_verification', 'preparing'].includes(normalized)) {
    return 'bg-amber-100 text-amber-700';
  }

  if (['confirmed', 'ready_for_pickup', 'in_transit', 'fulfilled', 'clarification_requested'].includes(normalized)) {
    return 'bg-sky-100 text-sky-700';
  }

  if (['cancelled', 'rejected', 'suspended', 'expired', 'invalid'].includes(normalized)) {
    return 'bg-rose-100 text-rose-700';
  }

  return 'bg-slate-100 text-slate-700';
}

export async function fetchNigeriaPharmacyWorkspace() {
  const response = await api.get('/ng/pharmacy/me');
  return response.data || null;
}

export async function fetchNigeriaPharmacyDashboard(pharmacyId) {
  const [statsRes, ordersRes, walletRes, alertsRes, complianceRes] = await Promise.all([
    api.get(`/ng/pharmacy/${pharmacyId}/inventory/stats`).catch(() => ({ data: {} })),
    api.get(`/ng/pharmacy/${pharmacyId}/orders`, { params: { limit: 10 } }).catch(() => ({ data: [] })),
    api.get(`/ng/pharmacy/${pharmacyId}/wallet`).catch(() => ({ data: {} })),
    api.get(`/ng/pharmacy/${pharmacyId}/inventory/alerts`).catch(() => ({ data: [] })),
    api.get(`/ng/pharmacy/${pharmacyId}/compliance`).catch(() => ({ data: {} })),
  ]);

  return {
    stats: statsRes.data || {},
    orders: Array.isArray(ordersRes.data) ? ordersRes.data : [],
    wallet: walletRes.data || {},
    alerts: Array.isArray(alertsRes.data) ? alertsRes.data : [],
    compliance: complianceRes.data || {},
  };
}
