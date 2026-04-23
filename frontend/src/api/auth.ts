import { apiPost } from "./client";

export type RegisterRequest = {
  email: string;
  username: string;
  password: string;
  cloud_password: string;
};

export type RegisterResponse = {
  status: string;
  email: string;
  dev_confirmation_code?: string | null;
};

export type LoginResponse = {
  access_token: string;
  token_type: string;
};

export async function register(payload: RegisterRequest): Promise<RegisterResponse> {
  return apiPost<RegisterResponse>("/api/auth/register", payload);
}

export async function confirmEmail(email: string, code: string): Promise<{ status: string }> {
  return apiPost<{ status: string }>("/api/auth/confirm-email", { email, code });
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  return apiPost<LoginResponse>("/api/auth/login", { email, password });
}
