import type { Timetable, Band } from '../types';

/**
 * タイムテーブルをCSV形式に変換する
 */
export const timetableToCSV = (
  timetable: Timetable,
  bands: Band[],
  eventName: string
): string => {
  const lines: string[] = [];

  // ヘッダー行
  lines.push(`${eventName}のタイムテーブル（${timetable.type === 'performance' ? '本番' : 'リハーサル'}）`);
  lines.push('');

  // 日付ごとのタイムテーブルを処理
  timetable.dailyTimetables.forEach((dailyTimetable) => {
    const dateObj = new Date(dailyTimetable.date);
    const dateStr = dateObj.toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    lines.push(`${dateStr}（開始時刻: ${dailyTimetable.startTime}）`);
    lines.push('');

    // クール構造の場合
    if (dailyTimetable.cools && dailyTimetable.cools.length > 0) {
      dailyTimetable.cools.forEach((cool) => {
        lines.push(`第${cool.number}クール`);
        lines.push('時間,バンド名,メンバー');

        cool.entries.forEach((entry) => {
          const timeRange = entry.startTime && entry.endTime 
            ? `${entry.startTime}～${entry.endTime}`
            : '-';
          
          if (entry.type === 'band' && entry.bandId) {
            const band = bands.find(b => b.id === entry.bandId);
            const bandName = band?.name || '不明なバンド';
            const members = band?.members?.join(';') || '';
            lines.push(`"${timeRange}","${bandName}","${members}"`);
          } else if (entry.type === 'custom' && entry.customEvent) {
            lines.push(`"${timeRange}","${entry.customEvent.name}",""`);
          }
        });

        lines.push('');
      });
    } else {
      // フラット構造の場合
      lines.push('時間,バンド名,メンバー');

      dailyTimetable.entries.forEach((entry) => {
        const timeRange = entry.startTime && entry.endTime 
          ? `${entry.startTime}～${entry.endTime}`
          : '-';
        
        if (entry.type === 'band' && entry.bandId) {
          const band = bands.find(b => b.id === entry.bandId);
          const bandName = band?.name || '不明なバンド';
          const members = band?.members?.join(';') || '';
          lines.push(`"${timeRange}","${bandName}","${members}"`);
        } else if (entry.type === 'custom' && entry.customEvent) {
          lines.push(`"${timeRange}","${entry.customEvent.name}",""`);
        }
      });

      lines.push('');
    }
  });

  return lines.join('\n');
};

/**
 * CSVをダウンロードする
 */
export const downloadCSV = (csvContent: string, filename: string) => {
  // BOM付きUTF-8でエンコード
  const bom = '\uFEFF';
  const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
