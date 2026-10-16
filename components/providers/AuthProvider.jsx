'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { getProviderLoginPath, toProviderPortalPath } from '@/lib/providerPortal';
import { isCareOpsSurface, careOpsLoginPath, careOpsPasswordPath, careOpsReturnPath } from '@/lib/careopsProfile';
import { authSessionGeneration, beginAuthSessionTransition, authTokenOwnerHint, subscribeAuthSession, confirmAuthSessionOwner, writeAuthSessionTokens, assertAuthSessionConfirmed } from '@/lib/authSession';

const AuthContext = createContext({});

function getCountryAwarePortalPath(role, pathname = '') {
  const isNigeriaPath = pathname.startsWith('/ng');

  switch (role) {
    case 'admin':
    case 'super_admin':
      return isNigeriaPath ? '/ng/admin' : '/admin/dashboard';
    case 'provider':
      return toProviderPortalPath('/dashboard', { pathname });
    case 'pharmacy':
      return isNigeriaPath ? '/ng/pharmacy/dashboard' : '/pharmacy/dashboard';
    case 'patient':
    default:
      return isNigeriaPath ? '/ng/patient' : '/patient/dashboard';
  }
}

function getCountryAwareLoginPath(role, pathname = '') {
  if (isCareOpsSurface(pathname)) return careOpsLoginPath(pathname);
  const isNigeriaPath = pathname.startsWith('/ng');

  switch (role) {
    case 'admin':
    case 'super_admin':
      return isNigeriaPath ? '/ng/admin/login' : '/secure/admin';
    case 'provider':
      return getProviderLoginPath({ pathname });
    case 'pharmacy':
      return isNigeriaPath ? '/ng/pharmacy/login' : '/pharmacy/login';
    case 'patient':
    default:
      return isNigeriaPath ? '/ng/patient/login' : '/patient/login';
  }
}

function getRequiredPasswordChangePath(role, pathname = '') {
  if (isCareOpsSurface(pathname)) return careOpsPasswordPath(pathname);
  const isNigeriaPath = pathname.startsWith('/ng');

  if (role === 'provider') {
    return isNigeriaPath ? '/ng/provider/create-password' : '/provider/create-password';
  }

  if (role === 'pharmacy') {
    return isNigeriaPath ? '/ng/pharmacy/create-password' : '/pharmacy/create-password';
  }

  return isNigeriaPath ? '/ng/auth/login' : '/login';
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const router = useRouter();
  const authRequestId = useRef(0);
  const currentUser = useRef(user); currentUser.current = user;

  // Check auth status on mount
  useEffect(() => {
    checkAuth();
    return subscribeAuthSession(() => { authRequestId.current++; currentUser.current = null; setUser(null); setLoading(true); checkAuth(); });
  }, []);

  const checkAuth = async () => {
    const requestId = ++authRequestId.current;
    const generation = authSessionGeneration();

    const isCurrentRequest = () => requestId === authRequestId.current && generation === authSessionGeneration();

    try {
      // Skip auth check if no token exists (user is definitely not logged in)
      if (typeof window !== 'undefined') {
        const token = localStorage.getItem('accessToken');
        if (!token) {
          if (isCurrentRequest()) {
            confirmAuthSessionOwner(null);
            setUser(null);
            setLoading(false);
          }
          return;
        }
      }
      
      const response = await api.get('/auth/me', { authGeneration: generation });
      if (isCurrentRequest() && response.data.success) {
        const expectedOwner = authTokenOwnerHint(localStorage.getItem('accessToken'));
        if (expectedOwner && response.data.user?.id !== expectedOwner) throw new Error('Account session could not be confirmed.');
        confirmAuthSessionOwner(response.data.user.id);
        const previous = currentUser.current;
        if (previous && (previous.id !== response.data.user.id || previous.role !== response.data.user.role || previous.marketScope !== response.data.user.marketScope)) beginAuthSessionTransition();
        setUser(response.data.user);
      }
    } catch (err) {
      // 401 is expected when user is not logged in - don't log it
      if (err.response?.status === 401) {
        if (!isCurrentRequest()) return;
        // Silently clear tokens and return - this is expected
        if (typeof window !== 'undefined') {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          localStorage.removeItem('user');
        }
        if (isCurrentRequest()) {
          setUser(null);
          setLoading(false);
        }
        return;
      }
      
      // Handle 431 error - clear corrupted tokens
      if (err.response?.status === 431) {
        if (!isCurrentRequest()) return;
        console.warn('431 error during auth check - clearing corrupted tokens');
        if (typeof window !== 'undefined') {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
        }
      }
      // Not authenticated - this is fine
      if (isCurrentRequest()) {
        setUser(null);
      }
    } finally {
      if (isCurrentRequest()) {
        setLoading(false);
      }
    }
  };

  const login = async (email, password, mfaCode = null, role = null, options = {}) => {
    const requestId = ++authRequestId.current;
    const generation = beginAuthSessionTransition();
    const current = () => requestId === authRequestId.current && generation === authSessionGeneration();

    try {
      setError(null);
      setLoading(true);
      setUser(null); currentUser.current = null;
      // Avoid sending stale/oversized auth headers on login
      if (typeof window !== 'undefined') {
        writeAuthSessionTokens(null, null);
        localStorage.removeItem('user');
      }
      // Only include mfaCode if it has a value
      const payload = { email, password };
      if (mfaCode) {
        payload.mfaCode = mfaCode;
      }
      if (role) {
        payload.role = role;
      }
      const response = await api.post('/auth/login', payload, { skipAuth: true, authGeneration: generation });
      if (!current()) return { error: 'A newer sign-in request is already in progress' };
      
      if (response.data.mfaRequired) {
        if (requestId === authRequestId.current) {
          setLoading(false);
        }
        return { mfaRequired: true };
      }
      
      if (response.data.success) {
        const expectedOwner = authTokenOwnerHint(response.data.accessToken);
        if (!response.data.user?.id || expectedOwner && expectedOwner !== response.data.user.id) throw new Error('Account session could not be confirmed.');
        // Store tokens in localStorage for API client
        writeAuthSessionTokens(response.data.accessToken, response.data.refreshToken);

        if (requestId !== authRequestId.current) {
          return { error: 'A newer sign-in request is already in progress' };
        }

        setUser(response.data.user);
        setLoading(false);
        
        // Redirect based on role + access level
        const redirectPath = getRedirectPath(response.data.user);
        if (options.redirect !== false) router.replace(redirectPath);
        
        return { success: true, redirectPath };
      }

      if (requestId === authRequestId.current) {
        setLoading(false);
      }
      return { error: 'Login failed' };
    } catch (err) {
      if (!current()) return { error: 'The account session changed.' };
      const message = err.response?.data?.error || (err.code === 'AUTH_COORDINATION_UNAVAILABLE' ? err.message : 'Login failed');
      setError(message);
      if (requestId === authRequestId.current) {
        setUser(null);
        setLoading(false);
      }
      return { error: message };
    }
  };

  const register = async (userData) => {
    const requestId = ++authRequestId.current; const generation = beginAuthSessionTransition();
    const current = () => requestId === authRequestId.current && generation === authSessionGeneration();
    try {
      setError(null);
      setLoading(true);
      setUser(null); currentUser.current = null; writeAuthSessionTokens(null, null);
      const response = await api.post('/auth/register', userData, { authGeneration: generation, skipAuth: true });
      if (!current()) return { error: 'The account session changed.' };
      
      if (response.data.success) {
        const expectedOwner = authTokenOwnerHint(response.data.accessToken);
        if (!response.data.user?.id || expectedOwner && expectedOwner !== response.data.user.id) throw new Error('Account session could not be confirmed.');
        // Store tokens
        writeAuthSessionTokens(response.data.accessToken, response.data.refreshToken);

        setUser(response.data.user);
        setLoading(false);
        
        // Redirect based on role + access level
        const redirectPath = getRedirectPath(response.data.user);
        router.replace(redirectPath);
        
        return { success: true, message: response.data.message, redirectPath };
      }

      setLoading(false);
      return { error: 'Registration failed' };
    } catch (err) {
      if (!current()) return { error: 'The account session changed.' };
      const message = err.response?.data?.error || (err.code === 'AUTH_COORDINATION_UNAVAILABLE' ? err.message : 'Registration failed');
      const errors = err.response?.data?.errors;
      setError(message);
      setLoading(false);
      return { error: message, errors };
    }
  };

  const logout = async () => {
    const requestId = ++authRequestId.current; const generation = beginAuthSessionTransition();
    const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
    const logoutPath = getCountryAwareLoginPath(user?.role, pathname);
    const accessToken = localStorage.getItem('accessToken');
    const refreshToken = localStorage.getItem('refreshToken');
    setUser(null); currentUser.current = null; writeAuthSessionTokens(null, null); localStorage.removeItem('user');
    router.push(logoutPath);
    try {
      await api.post('/auth/logout', { refreshToken }, { authGeneration: generation, skipAuth: true, headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} });
    } catch (err) {
      // Continue with logout even if API call fails
    } finally {
      if (requestId !== authRequestId.current || generation !== authSessionGeneration()) return;
      setUser(null);
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      router.push(logoutPath);
    }
  };

  const refreshToken = async () => {
    const requestId = authRequestId.current; const generation = authSessionGeneration();
    try {
      const response = await api.post('/auth/refresh', { refreshToken: localStorage.getItem('refreshToken') }, { authGeneration: generation });
      if (requestId !== authRequestId.current || generation !== authSessionGeneration()) return false;
      if (response.data.success && response.data.accessToken) {
        const expectedOwner = authTokenOwnerHint(localStorage.getItem('accessToken'));
        const nextOwner = authTokenOwnerHint(response.data.accessToken);
        if (expectedOwner && expectedOwner !== nextOwner) return false;
        writeAuthSessionTokens(response.data.accessToken, response.data.refreshToken || localStorage.getItem('refreshToken'));
        return true;
      }
    } catch (err) {
      return false;
    }
  };

  const updateUser = (updates) => {
    const previous = currentUser.current;
    if (!previous || updates.id && updates.id !== previous.id) return;
    if (updates.role && updates.role !== previous.role || updates.marketScope && updates.marketScope !== previous.marketScope) beginAuthSessionTransition();
    setUser(prev => ({ ...prev, ...updates }));
  };

  const getRedirectPath = (u) => {
    const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
    const role = u?.role;

    if (u?.mustChangePassword) {
      return getRequiredPasswordChangePath(role, pathname);
    }
    if (isCareOpsSurface(pathname)) return careOpsReturnPath(pathname);

    switch (role) {
      case 'admin':
      case 'super_admin':
        return getCountryAwarePortalPath(role, pathname);
      case 'provider':
        return toProviderPortalPath('/dashboard', {
          user: u,
          pathname,
        });
      case 'pharmacy':
        return getCountryAwarePortalPath(role, pathname);
      case 'patient':
      default:
        // If patient isn't paid up, route them to subscription first.
        // Access control middleware will block booking/prescriptions without paid access.
        if (!u?.accessLevel || u.accessLevel === 'read_only') {
          if (pathname.startsWith('/ng')) {
            return '/ng/patient';
          }
          return '/patient/subscription';
        }
        return getCountryAwarePortalPath(role, pathname);
    }
  };

  // Get token from localStorage for socket connection
  const getToken = useCallback(() => {
    if (typeof window !== 'undefined') {
      try {
        assertAuthSessionConfirmed();
        const token = localStorage.getItem('accessToken');
        return authTokenOwnerHint(token) === currentUser.current?.id ? token : null;
      } catch { return null; }
    }
    return null;
  }, []);

  const value = {
    user,
    loading,
    error,
    isAuthenticated: !!user,
    getToken,
    login,
    register,
    logout,
    refreshToken,
    refreshUser: checkAuth,
    updateUser,
    checkAuth
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default AuthContext;

