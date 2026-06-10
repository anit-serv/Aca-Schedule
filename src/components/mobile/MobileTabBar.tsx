import { Icon } from '../Icon';

type Mode = 'band-management' | 'timetable-editing';

interface MobileTabBarProps {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
}

export const MobileTabBar = ({ mode, onModeChange }: MobileTabBarProps) => {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85 border-t border-gray-200 z-40 safe-area-bottom shadow-[0_-6px_20px_rgba(15,23,42,0.08)]">
      <div className="flex">
        <button
          onClick={() => onModeChange('band-management')}
          className={`relative flex-1 flex flex-col items-center gap-0.5 py-2.5 transition-colors ${
            mode === 'band-management'
              ? 'text-emerald-600'
              : 'text-gray-400'
          }`}
        >
          {/* バンドアイコン */}
          <Icon name="group" filled={mode === 'band-management'} className="text-xl" />
          <span className={`text-[10px] font-medium ${
            mode === 'band-management' ? 'text-emerald-600' : 'text-gray-400'
          }`}>
            バンド管理
          </span>
          {mode === 'band-management' && (
            <div className="absolute top-0 h-0.5 w-16 bg-emerald-500 rounded-b" />
          )}
        </button>
        
        <button
          onClick={() => onModeChange('timetable-editing')}
          className={`relative flex-1 flex flex-col items-center gap-0.5 py-2.5 transition-colors ${
            mode === 'timetable-editing'
              ? 'text-emerald-600'
              : 'text-gray-400'
          }`}
        >
          {/* タイムテーブルアイコン */}
          <Icon name="calendar_view_week" filled={mode === 'timetable-editing'} className="text-xl" />
          <span className={`text-[10px] font-medium ${
            mode === 'timetable-editing' ? 'text-emerald-600' : 'text-gray-400'
          }`}>
            タイムテーブル
          </span>
          {mode === 'timetable-editing' && (
            <div className="absolute top-0 h-0.5 w-16 bg-emerald-500 rounded-b" />
          )}
        </button>
      </div>
      {/* iOSセーフエリア用パディング */}
      <div className="h-[env(safe-area-inset-bottom,0px)]" />
    </div>
  );
};
