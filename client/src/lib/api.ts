import axios from 'axios';
import { useAuthStore } from '../store/authStore';
import { Platform } from 'react-native';

const getBaseUrl = () => {
  if (process.env.EXPO_PUBLIC_API_URL) {
    const url = process.env.EXPO_PUBLIC_API_URL;
    return url.endsWith('/api') ? url : `${url.replace(/\/$/, '')}/api`;
  }
  
  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:3000/api';
  }
  
  return 'http://localhost:3000/api';
};

export const api = axios.create({
  baseURL: getBaseUrl(),
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use(async (config) => {
  const session = useAuthStore.getState().session;
  if (session?.access_token) {
    config.headers.Authorization = `Bearer ${session.access_token}`;
  }
  return config;
});

import { supabase } from './supabase';

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      try {
        const { data: { session }, error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError) throw refreshError;
        
        if (session) {
          useAuthStore.getState().setSession(session);
          error.config.headers.Authorization = `Bearer ${session.access_token}`;
          return api.request(error.config);
        }
      } catch (refreshError) {
        // Clear session if refresh fails
        useAuthStore.getState().setSession(null);
      }
    }
    return Promise.reject(error);
  }
);
