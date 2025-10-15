import type { Timetable } from '../types';

/**
 * バンド番号を計算する
 * 本番/リハごとに、日付をまたいで連番を付ける
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
