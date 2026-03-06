import type { EventSettings } from '../../types';

type Mode = 'band-management' | 'timetable-editing';

interface MobileHeaderProps {
  eventSettings: EventSettings;
  mode: Mode;
  onBack: () => void;
  onShareToggle: () => void;
  onSettingsToggle: () => void;
  isPublic?: boolean;
}

export const MobileHeader = ({
  eventSettings,
  onBack,
  onShareToggle,
  onSettingsToggle,
  isPublic,
}: MobileHeaderProps) => {
  return (
    <header className="bg-white shadow-sm border-b border-gray-200 flex-shrink-0">
      <div className="px-3 py-2 flex justify-between items-center">
        {/* 左側: 戻るボタン + タイトル */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            onClick={onBack}
            className="text-gray-400 hover:text-gray-700 transition-colors text-sm flex-shrink-0 p-1"
            title="マイイベントに戻る"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="min-w-0">
            <h1 className="text-base font-bold text-gray-900 truncate">{eventSettings.name}</h1>
            <p className="text-xs text-gray-500 truncate">{eventSettings.year}年 @ {eventSettings.venue}</p>
          </div>
        </div>

        {/* 右側: 共有 + 設定ボタン */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={onShareToggle}
            className={`p-2 rounded-md transition-colors duration-200 ${
              isPublic
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-gray-100 text-gray-600'
            }`}
            title="共有設定"
          >
            <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
          </button>
          <button
            onClick={onSettingsToggle}
            className="p-2 rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors duration-200"
            title="設定"
          >
            <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
};
