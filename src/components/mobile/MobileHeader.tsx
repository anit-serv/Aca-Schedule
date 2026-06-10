import { Icon } from '../Icon';
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
    <header className="bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 shadow-sm border-b border-gray-200 flex-shrink-0">
      <div className="px-3 py-2.5 flex justify-between items-center">
        {/* 左側: 戻るボタン + タイトル */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            onClick={onBack}
            className="text-gray-400 hover:text-gray-700 transition-colors text-sm flex-shrink-0 p-2 -ml-1"
            title="マイイベントに戻る"
          >
            <Icon name="arrow_back" className="text-xl" />
          </button>
          <div className="min-w-0">
            <h1 className="text-[15px] font-bold text-gray-900 truncate">{eventSettings.name}</h1>
            <p className="text-xs text-gray-500 truncate">{eventSettings.year}年 @ {eventSettings.venue}</p>
          </div>
        </div>

        {/* 右側: 共有 + 設定ボタン */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={onShareToggle}
            className={`p-2.5 rounded-lg transition-colors duration-200 ${
              isPublic
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-gray-100 text-gray-600'
            }`}
            title="共有設定"
          >
            <Icon name="share" className="text-xl" />
          </button>
          <button
            onClick={onSettingsToggle}
            className="p-2.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors duration-200"
            title="設定"
          >
            <Icon name="settings" className="text-xl" />
          </button>
        </div>
      </div>
    </header>
  );
};
