type Mode = 'band-management' | 'timetable-editing';

interface MobileTabBarProps {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
}

export const MobileTabBar = ({ mode, onModeChange }: MobileTabBarProps) => {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-40 safe-area-bottom">
      <div className="flex">
        <button
          onClick={() => onModeChange('band-management')}
          className={`flex-1 flex flex-col items-center gap-0.5 py-2 pt-2.5 transition-colors ${
            mode === 'band-management'
              ? 'text-emerald-600'
              : 'text-gray-400'
          }`}
        >
          {/* バンドアイコン */}
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={mode === 'band-management' ? 2.5 : 1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          <span className={`text-[10px] font-medium ${
            mode === 'band-management' ? 'text-emerald-600' : 'text-gray-400'
          }`}>
            バンド管理
          </span>
          {mode === 'band-management' && (
            <div className="absolute top-0 left-1/4 right-1/4 h-0.5 bg-emerald-500 rounded-b" style={{ width: '50%', left: '0%' }} />
          )}
        </button>
        
        <button
          onClick={() => onModeChange('timetable-editing')}
          className={`flex-1 flex flex-col items-center gap-0.5 py-2 pt-2.5 transition-colors ${
            mode === 'timetable-editing'
              ? 'text-emerald-600'
              : 'text-gray-400'
          }`}
        >
          {/* タイムテーブルアイコン */}
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={mode === 'timetable-editing' ? 2.5 : 1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <span className={`text-[10px] font-medium ${
            mode === 'timetable-editing' ? 'text-emerald-600' : 'text-gray-400'
          }`}>
            タイムテーブル
          </span>
        </button>
      </div>
      {/* iOSセーフエリア用パディング */}
      <div className="h-[env(safe-area-inset-bottom,0px)]" />
    </div>
  );
};
