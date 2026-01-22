'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';

const AuthContext = createContext({});

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
      const response = await api.get('/auth/me');
      if (response.data.success) {
        setUser(response.data.user);
      }
    } catch (err) {
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
      setUser(null);
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      router.push('/login');
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
    const role = u?.role;
    switch (role) {
      case 'admin':
      case 'super_admin':
        return '/admin/dashboard';
      case 'provider':
        return '/provider/dashboard';
      case 'patient':
      default:
        // If patient isn't paid up, route them to subscription first.
        // Access control middleware will block booking/prescriptions without paid access.
        if (!u?.accessLevel || u.accessLevel === 'read_only') {
          return '/patient/subscription';
        }
        return '/patient/dashboard';
    }
  };

  const value = {
    user,
    loading,
    error,
    isAuthenticated: !!user,
    login,
    register,
    logout,
    refreshToken,
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

