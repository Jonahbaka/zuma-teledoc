'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { getProviderLoginPath, toProviderPortalPath } from '@/lib/providerPortal';

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
  const isNigeriaPath = pathname.startsWith('/ng');

  switch (role) {
    case 'admin':
    case 'super_admin':
      return '/secure/admin';
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

  // Check auth status on mount
  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      // Skip auth check if no token exists (user is definitely not logged in)
      if (typeof window !== 'undefined') {
        const token = localStorage.getItem('accessToken');
        if (!token) {
          setLoading(false);
          return;
        }
      }
      
      const response = await api.get('/auth/me');
      if (response.data.success) {
        setUser(response.data.user);
      }
    } catch (err) {
      // 401 is expected when user is not logged in - don't log it
      if (err.response?.status === 401) {
        // Silently clear tokens and return - this is expected
        if (typeof window !== 'undefined') {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          localStorage.removeItem('user');
        }
        setLoading(false);
        return;
      }
      
      // Handle 431 error - clear corrupted tokens
      if (err.response?.status === 431) {
        console.warn('431 error during auth check - clearing corrupted tokens');
        if (typeof window !== 'undefined') {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
        }
      }
      // Not authenticated - this is fine
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password, mfaCode = null, role = null) => {
    try {
      setError(null);
      // Avoid sending stale/oversized auth headers on login
      if (typeof window !== 'undefined') {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
      }
      // Only include mfaCode if it has a value
      const payload = { email, password };
      if (mfaCode) {
        payload.mfaCode = mfaCode;
      }
      if (role) {
        payload.role = role;
      }
      const response = await api.post('/auth/login', payload, { skipAuth: true });
      
      if (response.data.mfaRequired) {
        return { mfaRequired: true };
      }
      
      if (response.data.success) {
        setUser(response.data.user);
        
        // Store tokens in localStorage for API client
        if (response.data.accessToken) {
          localStorage.setItem('accessToken', response.data.accessToken);
        }
        if (response.data.refreshToken) {
          localStorage.setItem('refreshToken', response.data.refreshToken);
        }
        
        // Redirect based on role + access level
        const redirectPath = getRedirectPath(response.data.user);
        router.push(redirectPath);
        
        return { success: true };
      }
    } catch (err) {
      const message = err.response?.data?.error || 'Login failed';
      setError(message);
      return { error: message };
    }
  };

  const register = async (userData) => {
    try {
      setError(null);
      const response = await api.post('/auth/register', userData);
      
      if (response.data.success) {
        setUser(response.data.user);
        
        // Store tokens
        if (response.data.accessToken) {
          localStorage.setItem('accessToken', response.data.accessToken);
        }
        if (response.data.refreshToken) {
          localStorage.setItem('refreshToken', response.data.refreshToken);
        }
        
        // Redirect based on role + access level
        const redirectPath = getRedirectPath(response.data.user);
        router.push(redirectPath);
        
        return { success: true, message: response.data.message };
      }
    } catch (err) {
      const message = err.response?.data?.error || 'Registration failed';
      const errors = err.response?.data?.errors;
      setError(message);
      return { error: message, errors };
    }
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch (err) {
      // Continue with logout even if API call fails
    } finally {
      const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
      const logoutPath = getCountryAwareLoginPath(user?.role, pathname);
      setUser(null);
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      router.push(logoutPath);
    }
  };

  const refreshToken = async () => {
    try {
      const response = await api.post('/auth/refresh');
      if (response.data.success && response.data.accessToken) {
        localStorage.setItem('accessToken', response.data.accessToken);
        if (response.data.refreshToken) {
          localStorage.setItem('refreshToken', response.data.refreshToken);
        }
        return true;
      }
    } catch (err) {
      return false;
    }
  };

  const updateUser = (updates) => {
    setUser(prev => ({ ...prev, ...updates }));
  };

  const getRedirectPath = (u) => {
    const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
    const role = u?.role;

    if (u?.mustChangePassword) {
      return getRequiredPasswordChangePath(role, pathname);
    }

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
      return localStorage.getItem('accessToken');
    }
    return null;
  }, []);

  const value = {
    user,
    loading,
    error,
    isAuthenticated: !!user,
    token: typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null,
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

