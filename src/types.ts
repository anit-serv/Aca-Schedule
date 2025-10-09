// イベント全体の設定情報
export interface EventSettings {
  id: string;
  name: string;
  year: number;
  venue: string;
  goal: string;
  performanceDates: string[]; // ISO 8601形式の日付文字列配列
  rehearsalType: 'rehearsal-day' | 'same-day-rehearsal' | 'none';
  rehearsalDates?: string[]; // リハーサル日形式の場合のみ使用
  rehearsalDuration?: number; // 全バンド共通のリハーサル時間（分）
  presetDurations: number[]; // よく使う演奏時間のプリセット（分）
}

// 出演可能時間帯
export interface AvailableTimeSlot {
  date: string; // ISO 8601形式の日付文字列
  startTime: string; // HH:mm形式
  endTime: string; // HH:mm形式
}

// バンド情報
export interface Band {
  id: string;
  name: string;
  performanceDuration: number; // 演奏時間（分）
  performanceCount: number; // 出演回数
  members: string[]; // 出演メンバー名の配列
  availableTimeSlots: AvailableTimeSlot[]; // 出演可能時間帯
  createdAt: Date;
  updatedAt: Date;
}

// バンド作成・更新用の入力型（IDや日時を除く）
export type BandInput = Omit<Band, 'id' | 'createdAt' | 'updatedAt'>;
