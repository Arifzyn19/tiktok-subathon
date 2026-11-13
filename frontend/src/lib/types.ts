export interface TimerState {
  remainingMs: number;
  status: "idle" | "running" | "paused";
  totalCoins: number;
  totalDonations: number;
  totalAddedMs: number;
  serverTime: number;
}

export interface Settings {
  tiktokUsername: string;
  tiktokCoinSeconds: number;
  saweriaMinimumRupiah: number;
  saweriaRupiahStep: number;
  saweriaMinutesPerStep: number;
}

export interface Activity {
  type: "gift" | "donation";
  id: string;
  senderName: string;
  description: string;
  amount: number;
  addedMs: number;
  createdAt: number;
}

export const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
