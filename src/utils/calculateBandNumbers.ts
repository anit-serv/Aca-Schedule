import type { Timetable } from '../types';

/**
 * バンド番号を計算する
 * 本番/リハごとに、日付をまたいで連番を付ける
 * type === 'band' のエントリーのみに番号を付与
 */
export const calculateBandNumbers = (timetable: Timetable | null): Map<string, number> => {
  const numbers = new Map<string, number>();
  
  if (!timetable) return numbers;
  
  let bandCounter = 1;
  
  // 全ての日付のタイムテーブルを順番に処理
  timetable.dailyTimetables
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach(dailyTimetable => {
      if (dailyTimetable.cools && dailyTimetable.cools.length > 0) {
        // クール構造の場合
        dailyTimetable.cools.forEach(cool => {
          cool.entries.forEach(entry => {
            if (entry.type === 'band') {
              numbers.set(entry.id, bandCounter++);
            }
          });
        });
      } else {
        // フラット構造の場合
        dailyTimetable.entries.forEach(entry => {
          if (entry.type === 'band') {
            numbers.set(entry.id, bandCounter++);
          }
        });
      }
    });
  
  return numbers;
};

/**
 * 全エントリー番号を計算する（カスタムフィールド用）
 * バンド・カスタムイベント両方に通し番号を付与
 * 日付ごとに1からリセット
 */
export const calculateEntryNumbers = (timetable: Timetable | null, date?: string): Map<string, number> => {
  const numbers = new Map<string, number>();
  
  if (!timetable) return numbers;
  
  const dailyTimetables = date
    ? timetable.dailyTimetables.filter(dt => dt.date === date)
    : [...timetable.dailyTimetables].sort((a, b) => a.date.localeCompare(b.date));

  dailyTimetables.forEach(dailyTimetable => {
    let counter = 1;
    
    if (dailyTimetable.cools && dailyTimetable.cools.length > 0) {
      dailyTimetable.cools.forEach(cool => {
        cool.entries.forEach(entry => {
          numbers.set(entry.id, counter++);
        });
      });
    } else {
      dailyTimetable.entries.forEach(entry => {
        numbers.set(entry.id, counter++);
      });
    }
  });
  
  return numbers;
};
