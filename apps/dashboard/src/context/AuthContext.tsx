import {
  createContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import AuthService, {
  type User,
  type AuthTokens,
  type LoginPayload,
  type RegisterPayload,
} from "@/services/auth.service";

export interface AuthContextValue {
  user: User | null;
  tokens: AuthTokens | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (payload: LoginPayload) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | undefined>(
  undefined,
);

const TOKENS_KEY = "altar_tokens";
const USER_KEY = "altar_user";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [tokens, setTokens] = useState<AuthTokens | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const persistAuth = useCallback((user: User, tokens: AuthTokens) => {
    setUser(user);
    setTokens(tokens);
    localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }, []);

  const clearAuth = useCallback(() => {
    setUser(null);
    setTokens(null);
    localStorage.removeItem(TOKENS_KEY);
    localStorage.removeItem(USER_KEY);
  }, []);

  useEffect(() => {
    const loadUser = async () => {
      try {
        const storedTokens = localStorage.getItem(TOKENS_KEY);
        if (!storedTokens) {
          setIsLoading(false);
          return;
        }

        const parsedTokens: AuthTokens = JSON.parse(storedTokens);
        setTokens(parsedTokens);

        const currentUser = await AuthService.getCurrentUser();
        setUser(currentUser);
      } catch {
        clearAuth();
      } finally {
        setIsLoading(false);
      }
    };

    loadUser();
  }, [clearAuth]);

  const login = useCallback(
    async (payload: LoginPayload) => {
      const response = await AuthService.login(payload);
      persistAuth(response.user, response.tokens);
    },
    [persistAuth],
  );

  const register = useCallback(
    async (payload: RegisterPayload) => {
      const response = await AuthService.register(payload);
      persistAuth(response.user, response.tokens);
    },
    [persistAuth],
  );

  const logout = useCallback(() => {
    clearAuth();
  }, [clearAuth]);

  const value: AuthContextValue = {
    user,
    tokens,
    isAuthenticated: !!user && !!tokens,
    isLoading,
    login,
    register,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
