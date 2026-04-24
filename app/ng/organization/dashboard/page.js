'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Users, CreditCard, BarChart3, Settings, Plus, ArrowRight,
  CheckCircle, AlertCircle, Download, Upload, Mail, Phone,
  Shield, TrendingUp, Building2, ChevronRight, Search, X,
  UserPlus, Activity
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FeatureGate } from '../../components/FeatureGate';
import NgNav from '../../components/NgNav';
import { formatNaira } from '../../lib/ngUtils';

const ROLE_LABELS = { owner: 'Owner', admin: 'Admin', hr: 'HR', billing_manager: 'Billing', member: 'Member' };
const STATUS_COLORS = {
  active: 'bg-green-500/10 text-green-600 border-green-500/20',
  invited: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  inactive: 'bg-muted text-muted-foreground border-border',
  removed: 'bg-red-500/10 text-red-600 border-red-500/20',
};

export default function OrgDashboard() {
  const [org, setOrg] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState({ full_name: '', email: '', phone: '', department: '', role: 'member' });
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState('');
  const [activeTab, setActiveTab] = useState('members');

  const orgId = typeof window !== 'undefined' ? localStorage.getItem('ng_org_id') : null;
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;

  useEffect(() => {
    if (!orgId || !token) { setLoading(false); return; }
    Promise.all([
      fetch(`/api/ng/organizations/${orgId}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
      fetch(`/api/ng/organizations/${orgId}/members?limit=100`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
    ]).then(([o, m]) => {
      setOrg(o.organization);
      setMembers(m.members || []);
    }).catch(() => {})
      .finally(() => setLoading(false));
  }, [orgId, token]);

  const handleInvite = async (e) => {
    e.preventDefault();
    setInviting(true);
    setInviteMsg('');
    try {
      const res = await fetch(`/api/ng/organizations/${orgId}/members/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(inviteForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invite failed');
      setInviteMsg('Invitation sent!');
      setInviteForm({ full_name: '', email: '', phone: '', department: '', role: 'member' });
      setMembers(m => [...m, { ...inviteForm, status: 'invited', id: data.member?.id }]);
    } catch (err) {
      setInviteMsg(`Error: ${err.message}`);
    } finally {
      setInviting(false);
    }
  };

  const handleRemoveMember = async (memberId) => {
    if (!confirm('Remove this member? They will lose access immediately.')) return;
    await fetch(`/api/ng/organizations/${orgId}/members/${memberId}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    });
    setMembers(m => m.filter(x => x.id !== memberId));
  };

  const filtered = members.filter(m =>
    !search || m.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    m.invite_email?.toLowerCase().includes(search.toLowerCase()) ||
    m.department?.toLowerCase().includes(search.toLowerCase())
  );

  const planLabel = org?.plan_key?.replace('org_', '')?.charAt(0)?.toUpperCase() + org?.plan_key?.replace('org_', '')?.slice(1);
  const activeCount = members.filter(m => m.status === 'active').length;
  const invitedCount = members.filter(m => m.status === 'invited').length;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <NgNav />
      <div className="pt-14">
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-900/40 via-slate-900 to-purple-900/30 border-b border-border px-6 py-8">
          <div className="max-w-5xl mx-auto flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
                <span>Organisation</span>
                {org && <><ChevronRight size={14} /><span className="font-medium text-foreground">{org.name}</span></>}
              </div>
              <h1 className="text-3xl font-bold text-foreground">{org?.name || 'Organisation Dashboard'}</h1>
              {org && (
                <div className="flex items-center gap-3 mt-2">
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                    org.status === 'active' ? 'bg-green-500/10 text-green-600 border-green-500/20' :
                    'bg-amber-500/10 text-amber-600 border-amber-500/20'
                  } capitalize`}>{org.status}</span>
                  <span className="text-muted-foreground text-sm capitalize">{planLabel} Plan</span>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button onClick={() => setShowInvite(true)} className="bg-indigo-600 hover:bg-indigo-500 text-white">
                <UserPlus size={16} className="mr-1.5" /> Invite Member
              </Button>
            </div>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
          {/* Verification notice */}
          {org?.status === 'pending_review' && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 flex items-start gap-3">
              <AlertCircle size={18} className="text-amber-500 shrink-0 mt-0.5" />
              <div className="text-sm">
                <strong className="text-foreground">Organisation verification pending.</strong>{' '}
                <span className="text-muted-foreground">We're reviewing your registration. You can still add members while we complete verification.</span>
              </div>
            </div>
          )}

          {/* Stats */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Total Members', value: members.length.toString(), icon: Users, color: 'text-indigo-500', bg: 'bg-indigo-500/10' },
              { label: 'Active', value: activeCount.toString(), icon: CheckCircle, color: 'text-green-500', bg: 'bg-green-500/10' },
              { label: 'Invited', value: invitedCount.toString(), icon: Mail, color: 'text-blue-500', bg: 'bg-blue-500/10' },
              { label: 'Member Limit', value: org?.member_limit?.toString() || '25', icon: Shield, color: 'text-purple-500', bg: 'bg-purple-500/10' },
            ].map((stat) => {
              const Icon = stat.icon;
              return (
                <div key={stat.label} className="bg-card border border-border rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-muted-foreground">{stat.label}</span>
                    <div className={`w-9 h-9 rounded-xl ${stat.bg} flex items-center justify-center`}>
                      <Icon size={16} className={stat.color} />
                    </div>
                  </div>
                  <div className="text-2xl font-bold text-foreground">{stat.value}</div>
                </div>
              );
            })}
          </div>

          {/* Tabs */}
          <div className="flex gap-1 bg-card border border-border rounded-2xl p-1">
            {[
              { key: 'members', label: 'Members', icon: Users },
              { key: 'billing', label: 'Billing', icon: CreditCard },
              { key: 'analytics', label: 'Analytics', icon: BarChart3 },
            ].map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-2 flex-1 justify-center px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    activeTab === tab.key ? 'bg-indigo-600 text-white' : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                  }`}
                >
                  <Icon size={15} />{tab.label}
                </button>
              );
            })}
          </div>

          {/* Members tab */}
          {activeTab === 'members' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2 bg-card border border-border rounded-xl px-4 py-2.5 flex-1 min-w-[200px]">
                  <Search size={16} className="text-muted-foreground shrink-0" />
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search members…" className="bg-transparent text-sm text-foreground outline-none flex-1 placeholder:text-muted-foreground" />
                </div>
                <Button variant="outline" size="sm" className="gap-2 rounded-xl">
                  <Download size={15} /> Export CSV
                </Button>
                <Button variant="outline" size="sm" className="gap-2 rounded-xl" onClick={() => setShowInvite(true)}>
                  <Upload size={15} /> Bulk Import
                </Button>
              </div>

              {filtered.length === 0 ? (
                <div className="bg-card border border-border rounded-2xl p-12 text-center text-muted-foreground">
                  <Users size={40} className="mx-auto mb-4 opacity-30" />
                  <p className="font-medium">No members yet.</p>
                  <p className="text-sm mt-1">Invite your first member to get started.</p>
                  <Button onClick={() => setShowInvite(true)} className="mt-4 bg-indigo-600 text-white hover:bg-indigo-500">
                    <UserPlus size={16} className="mr-2" /> Invite Member
                  </Button>
                </div>
              ) : (
                <div className="bg-card border border-border rounded-2xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40">
                        <th className="text-left px-5 py-3 text-muted-foreground font-medium">Name</th>
                        <th className="text-left px-5 py-3 text-muted-foreground font-medium hidden md:table-cell">Department</th>
                        <th className="text-left px-5 py-3 text-muted-foreground font-medium">Role</th>
                        <th className="text-left px-5 py-3 text-muted-foreground font-medium">Status</th>
                        <th className="px-5 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((m) => (
                        <tr key={m.id} className="border-b border-border last:border-0 hover:bg-accent/30 transition-colors">
                          <td className="px-5 py-4">
                            <div className="font-medium text-foreground">{m.full_name || '—'}</div>
                            <div className="text-xs text-muted-foreground">{m.invite_email || m.user_email || m.invite_phone || ''}</div>
                          </td>
                          <td className="px-5 py-4 text-muted-foreground hidden md:table-cell">{m.department || '—'}</td>
                          <td className="px-5 py-4">
                            <span className="text-xs font-medium text-muted-foreground">{ROLE_LABELS[m.role] || m.role}</span>
                          </td>
                          <td className="px-5 py-4">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${STATUS_COLORS[m.status] || STATUS_COLORS.inactive} capitalize`}>
                              {m.status}
                            </span>
                          </td>
                          <td className="px-5 py-4 text-right">
                            <button onClick={() => handleRemoveMember(m.id)} className="text-red-500 hover:text-red-600 text-xs font-medium">Remove</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Billing tab */}
          {activeTab === 'billing' && (
            <div className="space-y-6">
              <div className="bg-card border border-border rounded-2xl p-6 flex items-start gap-4 flex-wrap justify-between">
                <div>
                  <div className="text-sm text-muted-foreground mb-1">Current Plan</div>
                  <div className="text-2xl font-bold text-foreground">{planLabel || 'Starter'} Plan</div>
                  <div className="text-sm text-muted-foreground mt-1">{org?.member_limit || 25} members · Monthly billing</div>
                </div>
                <Link href="/ng/pricing#organisations">
                  <Button className="bg-indigo-600 hover:bg-indigo-500 text-white">Upgrade Plan</Button>
                </Link>
              </div>
              <Link href="/ng/organization/billing">
                <div className="bg-card border border-border rounded-2xl p-5 hover:border-indigo-500/30 transition-all flex items-center justify-between">
                  <div>
                    <div className="font-bold text-foreground">Full Billing Dashboard</div>
                    <div className="text-sm text-muted-foreground mt-1">Invoices, payment history & plan management</div>
                  </div>
                  <ArrowRight size={18} className="text-muted-foreground" />
                </div>
              </Link>
            </div>
          )}

          {/* Analytics tab */}
          {activeTab === 'analytics' && (
            <FeatureGate type="plan_restricted" available={false}>
              <div />
            </FeatureGate>
          )}
        </div>
      </div>

      {/* Invite modal */}
      {showInvite && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className="bg-background border border-border rounded-3xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-foreground">Invite Member</h3>
              <button onClick={() => { setShowInvite(false); setInviteMsg(''); }} className="text-muted-foreground hover:text-foreground p-1">✕</button>
            </div>

            {inviteMsg && (
              <div className={`rounded-xl p-3 text-sm border ${inviteMsg.startsWith('Error') ? 'bg-red-500/10 border-red-500/20 text-red-600' : 'bg-green-500/10 border-green-500/20 text-green-700'}`}>
                {inviteMsg}
              </div>
            )}

            <form onSubmit={handleInvite} className="space-y-3">
              {[
                { name: 'full_name', label: 'Full Name', placeholder: 'Jane Doe' },
                { name: 'email', label: 'Email', placeholder: 'jane@email.com', type: 'email' },
                { name: 'phone', label: 'Phone (optional)', placeholder: '080XXXXXXXX', type: 'tel' },
                { name: 'department', label: 'Department (optional)', placeholder: 'e.g., Finance' },
              ].map(f => (
                <label key={f.name} className="block">
                  <span className="text-xs font-medium text-muted-foreground block mb-1">{f.label}</span>
                  <input
                    name={f.name}
                    type={f.type || 'text'}
                    value={inviteForm[f.name]}
                    onChange={e => setInviteForm(x => ({ ...x, [e.target.name]: e.target.value }))}
                    placeholder={f.placeholder}
                    className="w-full bg-card border border-border rounded-xl px-4 py-2.5 text-foreground text-sm outline-none"
                  />
                </label>
              ))}
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground block mb-1">Role</span>
                <select name="role" value={inviteForm.role} onChange={e => setInviteForm(x => ({ ...x, role: e.target.value }))} className="w-full bg-card border border-border rounded-xl px-4 py-2.5 text-foreground text-sm outline-none">
                  {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <Button type="submit" disabled={inviting} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl">
                {inviting ? 'Sending…' : 'Send Invitation'}
              </Button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
