import React, { createContext, useEffect, useState, useCallback } from 'react';
import authService, {
  User,
  LoginRequest,
  RegisterRequest,
  OtpRequest,
} from '../services/auth.service';
import { session } from '../services/session';

export interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (credentials: LoginRequest) => Promise<void>;
  register: (details: RegisterRequest) => Promise<void>;
  verifyOtp: (otpData: OtpRequest) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void loadStoredUser();
    return session.onExpired(() => setUser(null));
  }, []);

  const loadStoredUser = async () => {
    try {
      const token = await session.getAccessToken();
      if (token) {
        const storedUser = await authService.getStoredUser();
        if (storedUser) {
          setUser(storedUser);
        }
        // Try to refresh user data in background
        try {
          const freshUser = await authService.getCurrentUser();
          setUser(freshUser);
        } catch {
          await session.clear();
          setUser(null);
        }
      }
    } catch (error) {
      console.warn('Failed to load stored user:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const login = useCallback(async (credentials: LoginRequest) => {
    const response = await authService.login(credentials);
    setUser(response.user);
  }, []);

  const register = useCallback(async (details: RegisterRequest) => {
    const response = await authService.register(details);
    setUser(response.user);
  }, []);

  const verifyOtp = useCallback(async (otpData: OtpRequest) => {
    const response = await authService.verifyOtp(otpData);
    setUser(response.user);
  }, []);

  const logout = useCallback(async () => {
    await authService.logout();
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const freshUser = await authService.getCurrentUser();
    setUser(freshUser);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        register,
        verifyOtp,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
