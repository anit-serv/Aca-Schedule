import { useMemo } from 'react';
import type { Band, Timetable } from '../../types';

interface MobileBandBankProps {
  bands: Band[];
  timetableType: 'performance' | 'rehearsal';
  performanceTimetable: Timetable | null;
  rehearsalTimetable: Timetable | null;
}

export const MobileBandBank = ({
  bands,
  timetableType,
  performanceTimetable,
  rehearsalTimetable,
}: MobileBandBankProps) => {
  const timetable = timetableType === 'performance' ? performanceTimetable : rehearsalTimetable;

  // 未配置バンドを計算
  const unplacedBands = useMemo(() => {
    if (!timetable) return bands;

    const placedBandIds = new Set<string>();
    timetable.dailyTimetables.forEach(dt => {
      // クール構造
      dt.cools?.forEach(cool => {
        cool.entries.forEach(entry => {
          if (entry.type === 'band' && entry.bandId) {
            placedBandIds.add(entry.bandId);
          }
        });
      });
      // フラット構造
      dt.entries?.forEach(entry => {
        if (entry.type === 'band' && entry.bandId) {
          placedBandIds.add(entry.bandId);
        }
      });
    });

    return bands.filter(band => !placedBandIds.has(band.id));
  }, [bands, timetable]);

  const placedCount = bands.length - unplacedBands.length;

  return (
    <div className="space-y-3">
      {/* ステータス表示 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-500">
            未配置: <span className="text-emerald-600 font-bold">{unplacedBands.length}</span>
          </span>
          <span className="text-gray-300">|</span>
          <span className="text-xs font-medium text-gray-500">
            配置済み: <span className="text-gray-600 font-bold">{placedCount}</span>
          </span>
        </div>
      </div>

      {/* 未配置バンドリスト */}
      {unplacedBands.length === 0 ? (
        <div className="text-center py-6">
          <p className="text-xs text-gray-400">全てのバンドが配置されています</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {unplacedBands.map((band) => (
            <div
              key={band.id}
              className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5 active:bg-emerald-100 transition-colors"
            >
              <div className="w-7 h-7 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
                {band.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{band.name}</p>
                <p className="text-[10px] text-gray-500">
                  {band.performanceDuration}分 · {band.members.length}人
                </p>
              </div>
              <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
            </div>
          ))}
        </div>
      )}

      {/* 配置済みバンド（折りたたみ） */}
      {placedCount > 0 && (
        <details className="group">
          <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600 transition-colors list-none flex items-center gap-1">
            <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            配置済みバンド ({placedCount})
          </summary>
          <div className="mt-2 space-y-1">
            {bands
              .filter(b => !unplacedBands.includes(b))
              .map((band) => (
                <div
                  key={band.id}
                  className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 opacity-60"
                >
                  <div className="w-6 h-6 rounded-full bg-gray-300 text-white flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                    {band.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-600 truncate">{band.name}</p>
                  </div>
                  <span className="text-[10px] text-gray-400">配置済み</span>
                </div>
              ))}
          </div>
        </details>
      )}
    </div>
  );
};
