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

// 時間範囲（30分単位）
export interface TimeRange {
  startTime: string; // HH:mm形式（例: "10:00", "10:30"）
  endTime: string; // HH:mm形式（例: "11:00", "11:30"）
}

// 出演可能時間帯（1日に複数の時間範囲を持てる）
export interface AvailableTimeSlot {
  date: string; // ISO 8601形式の日付文字列
  timeRanges: TimeRange[]; // 複数の時間範囲
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

// タイムテーブルエントリの種類
export type EntryType = 'band' | 'custom';

// カスタムイベント（休憩、MCなど）
export interface CustomEvent {
  id: string;
  name: string;
  duration: number; // 分単位
}

// タイムテーブルのエントリ
export interface TimetableEntry {
  id: string;
  type: EntryType;
  bandId?: string; // type が 'band' の場合
  customEvent?: CustomEvent; // type が 'custom' の場合
  startTime?: string; // HH:mm形式（自動計算される）
  endTime?: string; // HH:mm形式（自動計算される）
  order: number; // 並び順
}

// 日付ごとのタイムテーブル
export interface DailyTimetable {
  date: string; // ISO 8601形式
  startTime: string; // HH:mm形式（その日の開始時刻）
  entries: TimetableEntry[];
}

// イベント全体のタイムテーブル
export interface Timetable {
  id: string;
  eventId: string;
  type: 'performance' | 'rehearsal'; // 本番用かリハーサル用か
  dailyTimetables: DailyTimetable[];
  createdAt: Date;
  updatedAt: Date;
}
