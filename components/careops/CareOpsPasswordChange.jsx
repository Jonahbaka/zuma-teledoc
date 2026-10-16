'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import { authAPI } from '@/lib/api';
import { careOpsReturnPath, careOpsLoginPath } from '@/lib/careopsProfile';
import { authSessionGeneration, writeAuthSessionTokens } from '@/lib/authSession';

export default function CareOpsPasswordChange() {
  const { user, loading, isAuthenticated, updateUser, refreshUser } = useAuth();
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const generation = useRef(0); const request = useRef(null);
  const owner = JSON.stringify([user?.id || null,user?.role || null,user?.marketScope || null]);
  const ready = Boolean(!loading && isAuthenticated && user?.id);
  const context = useRef({ owner, ready, generation: 0 });
  const mounted = useRef(false);
  if (context.current.owner !== owner || context.current.ready !== ready) context.current = { owner, ready, generation: context.current.generation + 1 };
  const contextGeneration = context.current.generation;
  const currentOwner = () => mounted.current && context.current.owner === owner && context.current.ready && context.current.generation === contextGeneration;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const invalidate = useCallback(() => { generation.current++; request.current?.abort(); }, []);
  useEffect(() => {
    invalidate(); setBusy(false); setError(''); setCurrentPassword(''); setNewPassword(''); setConfirmNewPassword('');
    return invalidate;
  }, [owner, ready, invalidate]);
  const target = () => careOpsReturnPath(typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('returnTo'));
  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) router.replace(careOpsLoginPath(target()));
    else if (!user?.mustChangePassword) router.replace(target());
  }, [loading, isAuthenticated, user?.mustChangePassword, router]);

  async function submit(event) {
    event.preventDefault(); if (busy || !currentOwner()) return;
    setError('');
    if (newPassword !== confirmNewPassword) { setError('The new passwords must match.'); return; }
    const epoch = generation.current; const sessionGeneration = authSessionGeneration(); const controller = new AbortController(); request.current = controller;
    const current = () => epoch === generation.current && !controller.signal.aborted && currentOwner() && sessionGeneration === authSessionGeneration();
    setBusy(true);
    try {
      const response = await authAPI.changePassword({ currentPassword, newPassword, confirmNewPassword }, { signal: controller.signal });
      if (!current()) return;
      if (response.data?.success !== true || !response.data.user || response.data.user.id !== user.id || response.data.user.mustChangePassword !== false)
        throw new Error('The password change could not be confirmed. Sign in again or contact your access administrator.');
      if (response.data.accessToken) writeAuthSessionTokens(response.data.accessToken, response.data.refreshToken || localStorage.getItem('refreshToken'));
      updateUser(response.data.user); await refreshUser();
      if (!current()) return;
      setCurrentPassword(''); setNewPassword(''); setConfirmNewPassword(''); router.replace(target());
    } catch (failure) { if (current()) setError(failure.response?.data?.error || failure.message || 'The password could not be changed.'); }
    finally { if (current()) setBusy(false); }
  }
  if (loading || !isAuthenticated) return <p role="status" className="p-8">Checking your secure session…</p>;
  return <main className="mx-auto max-w-xl px-5 py-10"><form onSubmit={submit} className="space-y-6 rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
    <div><p className="font-semibold text-blue-700">DoctaRx CareOps</p><h1 className="mt-3 text-3xl font-semibold">Set your own password</h1><p className="mt-3 leading-7 text-slate-600">Update your temporary password before opening your assigned workspace. Your institution’s access permissions remain in place.</p></div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-900">{error}</p>}
    {[['Current password',currentPassword,setCurrentPassword,'current-password'],['New password',newPassword,setNewPassword,'new-password'],['Confirm new password',confirmNewPassword,setConfirmNewPassword,'new-password']].map(([label,value,setValue,complete],index)=><label key={label} className="block space-y-2 font-medium" htmlFor={'careops-password-'+index}><span>{label}</span><input id={'careops-password-'+index} type="password" autoComplete={complete} required value={value} onChange={event=>setValue(event.target.value)} disabled={busy} className="min-h-12 w-full rounded-xl border border-slate-300 px-4 text-base" /></label>)}
    <p className="leading-7 text-slate-600">Use at least eight characters, including uppercase and lowercase letters, a number, and a symbol.</p>
    <button type="submit" disabled={busy} className="min-h-12 w-full rounded-xl bg-blue-700 px-5 py-3 font-semibold text-white disabled:opacity-60">{busy?'Updating password…':'Update password'}</button>
  </form></main>;
}
