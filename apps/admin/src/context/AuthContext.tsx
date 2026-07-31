import {
  createContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import AuthService from "@/services/auth.service";

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  avatarUrl?: string;
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthContextValue {
  user: User | null;
  tokens: Tokens | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (payload: { email: string; password: string }) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

const TOKENS_KEY = "altar_admin_tokens";
const USER_KEY = "altar_admin_user";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [tokens, setTokens] = useState<Tokens | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const persistAuth = useCallback((u: User, t: Tokens) => {
    setUser(u);
    setTokens(t);
    localStorage.setItem(TOKENS_KEY, JSON.stringify(t));
    localStorage.setItem(USER_KEY, JSON.stringify(u));
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setTokens(null);
    localStorage.removeItem(TOKENS_KEY);
    localStorage.removeItem(USER_KEY);
  }, []);

  useEffect(() => {
    const storedTokens = localStorage.getItem(TOKENS_KEY);
    const storedUser = localStorage.getItem(USER_KEY);
    if (storedTokens && storedUser) {
      setTokens(JSON.parse(storedTokens));
      setUser(JSON.parse(storedUser));
    }
    setIsLoading(false);
  }, []);

  const login = useCallback(
    async (payload: { email: string; password: string }) => {
      const res = await AuthService.login(payload);
      const u = res.data.user;

      if (u.role !== "SUPER_ADMIN") {
        throw new Error("Access denied. Super admin credentials required.");
      }

      persistAuth(u, res.data.tokens);
    },
    [persistAuth],
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        tokens,
        isAuthenticated: !!user,
        isLoading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
