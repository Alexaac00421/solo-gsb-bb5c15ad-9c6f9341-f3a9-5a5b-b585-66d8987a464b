import type { Cue, ValidationResult } from '@cue-sheet/shared';

export interface SceneSummary {
  id: number;
  name: string;
  created_at: number;
  latest_version: number | null;
}

export interface DraftResponse {
  rev: number;
  cues: Cue[];
  updatedAt: number;
  validation: ValidationResult;
}

export interface PublishedResponse {
  published: boolean;
  version?: number;
  publishedAt?: number;
  cues?: Cue[];
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: any) {
    super(body?.error ?? `请求失败（${status}）`);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export const api = {
  listScenes: () => request<{ scenes: SceneSummary[] }>('/api/scenes'),

  createScene: (name: string) =>
    request<{ scene: SceneSummary }>('/api/scenes', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  getDraft: (id: number) => request<DraftResponse>(`/api/scenes/${id}/draft`),

  saveDraft: (id: number, baseRev: number, cues: Cue[]) =>
    request<{ rev: number; updatedAt: number; validation: ValidationResult }>(
      `/api/scenes/${id}/draft`,
      { method: 'PUT', body: JSON.stringify({ baseRev, cues }) },
    ),

  publish: (id: number) =>
    request<{ version: number; rev: number }>(`/api/scenes/${id}/publish`, {
      method: 'POST',
    }),

  getLatestPublished: (id: number) =>
    request<PublishedResponse>(`/api/scenes/${id}/published/latest`),
};
