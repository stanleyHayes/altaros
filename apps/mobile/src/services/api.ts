import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_BASE_URL = __DEV__
  ? 'http://localhost:4000/api'
  : 'https://api.altar-os.com/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: attach JWT token
api.interceptors.request.use(
  async (config) => {
    try {
      const token = await AsyncStorage.getItem('accessToken');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch (error) {
      console.warn('Failed to retrieve token from AsyncStorage:', error);
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// Response interceptor: handle 401 and token refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const refreshToken = await AsyncStorage.getItem('refreshToken');
        if (!refreshToken) {
          await clearTokens();
          return Promise.reject(error);
        }

        const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, {
          refreshToken,
        });

        await AsyncStorage.setItem('accessToken', data.accessToken);
        if (data.refreshToken) {
          await AsyncStorage.setItem('refreshToken', data.refreshToken);
        }

        originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        await clearTokens();
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  },
);

async function clearTokens() {
  await Promise.all(['accessToken', 'refreshToken', 'user'].map((k) => AsyncStorage.removeItem(k)));
}

export { clearTokens };
export default api;
