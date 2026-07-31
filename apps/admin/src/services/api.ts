import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:3001/api/v1",
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  const tokens = localStorage.getItem("altar_admin_tokens");
  if (tokens) {
    const { accessToken } = JSON.parse(tokens);
    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("altar_admin_tokens");
      localStorage.removeItem("altar_admin_user");
      window.location.href = "/login";
    }
    return Promise.reject(error);
  },
);

export async function get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  const response: AxiosResponse<T> = await api.get(url, config);
  return response.data;
}

export async function post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const response: AxiosResponse<T> = await api.post(url, data, config);
  return response.data;
}

export async function put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const response: AxiosResponse<T> = await api.put(url, data, config);
  return response.data;
}

export async function patch<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const response: AxiosResponse<T> = await api.patch(url, data, config);
  return response.data;
}

export async function del<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  const response: AxiosResponse<T> = await api.delete(url, config);
  return response.data;
}

export default api;
