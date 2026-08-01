import axios, { AxiosRequestConfig, AxiosResponse } from "axios";

const api = axios.create({
  // The Go gateway is the single origin. It serves auth, members and finance
  // directly and forwards everything not yet ported to the legacy TypeScript
  // API, so this app never needs to know which domains have moved.
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:8080/api/v1",
  headers: {
    "Content-Type": "application/json",
  },
});

api.interceptors.request.use(
  (config) => {
    const tokens = localStorage.getItem("altar_tokens");
    if (tokens) {
      const { accessToken } = JSON.parse(tokens);
      if (accessToken) {
        config.headers.Authorization = `Bearer ${accessToken}`;
      }
    }
    return config;
  },
  (error) => Promise.reject(error),
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("altar_tokens");
      localStorage.removeItem("altar_user");
      window.location.href = "/login";
    }
    return Promise.reject(error);
  },
);

/**
 * The API wraps every response in `{ success, data, message }` (the
 * ApiResponse contract in @altar-os/shared-types). These helpers return the
 * `data` payload so call sites work with the thing they asked for.
 *
 * This is not cosmetic. The helpers previously returned the whole envelope
 * while their type parameter described the payload — so `AuthService.login()`
 * typechecked as `{ user, tokens }`, returned `{ success, data }`, and every
 * caller read `response.user` as undefined. TypeScript cannot catch that: the
 * type was a claim about the wire format, and the claim was wrong.
 *
 * A `success: false` body now throws rather than resolving with undefined,
 * because an error that arrives as missing data surfaces three screens later
 * as a blank page instead of at the call that failed.
 */
function unwrap<T>(response: AxiosResponse<ApiEnvelope<T>>): T {
  const body = response.data;
  if (body && typeof body === "object" && "success" in body) {
    if (!body.success) {
      throw new ApiError(body.message ?? "The request failed.", response.status);
    }
    return body.data as T;
  }
  // Not enveloped — return it as-is rather than losing the response.
  return body as unknown as T;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
}

/** An error the API reported in its response body rather than by status. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function get<T>(
  url: string,
  config?: AxiosRequestConfig,
): Promise<T> {
  return unwrap<T>(await api.get(url, config));
}

export async function post<T>(
  url: string,
  data?: unknown,
  config?: AxiosRequestConfig,
): Promise<T> {
  return unwrap<T>(await api.post(url, data, config));
}

export async function put<T>(
  url: string,
  data?: unknown,
  config?: AxiosRequestConfig,
): Promise<T> {
  return unwrap<T>(await api.put(url, data, config));
}

export async function patch<T>(
  url: string,
  data?: unknown,
  config?: AxiosRequestConfig,
): Promise<T> {
  return unwrap<T>(await api.patch(url, data, config));
}

export async function del<T>(
  url: string,
  config?: AxiosRequestConfig,
): Promise<T> {
  return unwrap<T>(await api.delete(url, config));
}

export default api;
