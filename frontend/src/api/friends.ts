import { apiGet, apiPost } from "./client";
import type { UserPublic } from "./users";

export type FriendListResponse = {
  friends: UserPublic[];
};

export type FriendRequestResponse = {
  id: string;
  from_user: UserPublic;
  to_user: UserPublic;
  status: string;
  created_at: string;
  updated_at: string;
};

export type InviteCodeResponse = {
  code: string;
  max_uses: number;
  used_count: number;
  created_at: string;
};

export async function searchUsers(token: string, username: string): Promise<UserPublic[]> {
  const params = new URLSearchParams({ username });
  return apiGet<UserPublic[]>(`/api/users/search?${params.toString()}`, { token });
}

export async function listFriends(token: string): Promise<FriendListResponse> {
  return apiGet<FriendListResponse>("/api/friends", { token });
}

export async function sendFriendRequest(token: string, username: string): Promise<FriendRequestResponse> {
  return apiPost<FriendRequestResponse>("/api/friends/request", { username }, { token });
}

export async function createInviteCode(token: string, maxUses = 1): Promise<InviteCodeResponse> {
  return apiPost<InviteCodeResponse>("/api/friends/invite-code", { max_uses: maxUses }, { token });
}

export async function addFriendByCode(token: string, code: string): Promise<void> {
  await apiPost<void>("/api/friends/add-by-code", { code }, { token });
}
