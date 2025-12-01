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
      // Not authenticated - this is fine
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password, mfaCode = null) => {
    try {
      setError(null);
      // Only include mfaCode if it has a value
      const payload = { email, password };
      if (mfaCode) {
        payload.mfaCode = mfaCode;
      }
      const response = await api.post('/auth/login', payload);
      
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
        
        // Redirect based on role
        const redirectPath = getRedirectPath(response.data.user.role);
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
        
        // Redirect based on role
        const redirectPath = getRedirectPath(response.data.user.role);
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

  const getRedirectPath = (role) => {
    switch (role) {
      case 'admin':
      case 'super_admin':
        return '/admin/dashboard';
      case 'provider':
        return '/provider/dashboard';
      case 'patient':
      default:
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

