import { apiGet } from "./client";

export type FeedPublication = {
  author_id: string;
  author_username: string;
  author_display_name: string | null;
  author_avatar_url: string | null;
  caption: string | null;
  image_url: string;
};

export async function listFeed(token: string): Promise<FeedPublication[]> {
  return apiGet<FeedPublication[]>("/api/feed", { token });
}
