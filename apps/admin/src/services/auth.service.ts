import { post, get } from "./api";

interface LoginPayload {
  email: string;
  password: string;
}

interface AuthResponse {
  success: boolean;
  data: {
    user: {
      id: string;
      email: string;
      name: string;
      role: string;
      avatarUrl?: string;
    };
    tokens: {
      accessToken: string;
      refreshToken: string;
    };
  };
}

interface MeResponse {
  success: boolean;
  data: {
    id: string;
    email: string;
    name: string;
    role: string;
    avatarUrl?: string;
  };
}

const AuthService = {
  async login(payload: LoginPayload): Promise<AuthResponse> {
    return post<AuthResponse>("/auth/login", {
      ...payload,
      method: "EMAIL",
    });
  },

  async getMe(): Promise<MeResponse> {
    return get<MeResponse>("/auth/me");
  },
};

export default AuthService;
