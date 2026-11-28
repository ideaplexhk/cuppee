import Constants from 'expo-constants';
import { tNow } from './lib/i18n/core';

// Set EXPO_PUBLIC_API_URL (e.g. http://192.168.1.20:8787 — your computer's LAN IP, so a phone can reach it),
// or change extra.apiUrl in app.json.
export const API_URL: string =
  process.env.EXPO_PUBLIC_API_URL ?? (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ?? 'http://localhost:8787';

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; token?: string | null } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method: opts.method ?? (opts.body ? 'POST' : 'GET'),
      headers: {
        'content-type': 'application/json',
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiError(0, 'offline', tNow('error.offline'));
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'error', data?.message ?? data?.error ?? tNow('error.generic'));
  return data as T;
}

// ---- response shapes used by the screens

export type StampCard = { cafeId: string; name: string; goal: number; reward: string; stamps: number; lastVisit: number | null };
export type Summary = {
  member: { id: string; phone: string; displayName: string | null; preferences: Record<string, any> };
  beans: number;
  stampCards: StampCard[];
  recentVisits: { id: string; cafeId: string; cafeName: string; source: string; at: number }[];
};
export type Cup = { id: string; uid: string; tagType: string; colourway: string | null; nickname: string | null; linkedAt: number };
export type Cafe = {
  id: string;
  name: string;
  nameZh: string | null;
  district: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  locationConfirmed: boolean;
  hours: string | null;
  description: string | null;
  stampGoal: number;
  stampReward: string;
  beansPerVisit: number;
  menu: { name: string; priceHkd: number | null }[];
};
export type Reward = { id: string; title: string; description: string | null; costBeans: number; cafeId: string | null; cafeName: string | null };
export type FeedEvent = {
  id: string;
  status: 'pending' | 'unknown_cup' | 'unlinked_cup' | 'rejected';
  readAt: number;
  rejectReason: string | null;
  uid: string | null;
  cup?: { id: string; nickname: string | null; colourway: string | null };
  member: null | {
    id: string;
    name: string | null;
    preferences: Record<string, any>;
    stamps: number;
    stampGoal: number;
    stampCardReady: boolean;
    lastVisitAt: number | null;
    recentVisit: boolean;
  };
};
export type VisitResult = {
  visitId: string;
  awarded: { stamps: number; beans: number };
  cooldown: boolean;
  balances: { beans: number; stamps: number; stampGoal: number; stampCardReady: boolean };
};
