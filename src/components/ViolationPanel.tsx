import type { ConstraintViolation } from '../types';

interface ViolationPanelProps {
  violations: ConstraintViolation[];
  isOpen: boolean;
  onToggle: () => void;
}

export const ViolationPanel = ({ violations, isOpen, onToggle }: ViolationPanelProps) => {
  if (violations.length === 0) return null;

  // 一意の違反のみを抽出する関数
  const getUniqueViolations = () => {
    const uniqueViolations = new Map<string, ConstraintViolation>();
    violations.forEach(v => {
      if (v.type === 'duplicate-in-cool') {
        const baseId = v.id.replace(/-ref-.*$/, '');
        if (!v.id.includes('-ref-')) {
          uniqueViolations.set(baseId, v);
        }
      } else if (v.type === 'consecutive-performance') {
        const baseId = v.id.replace(/-ref$/, '');
        if (!v.id.includes('-ref')) {
          uniqueViolations.set(baseId, v);
        }
      } else {
        uniqueViolations.set(v.id, v);
      }
    });
    return uniqueViolations;
  };

  const uniqueViolations = getUniqueViolations();
  const uniqueCount = uniqueViolations.size;
  const uniqueList = Array.from(uniqueViolations.values());
  const highViolations = uniqueList.filter(v => v.severity === 'high');
  const mediumViolations = uniqueList.filter(v => v.severity === 'medium');
  const lowViolations = uniqueList.filter(v => v.severity === 'low');

  return (
    <>
      {/* スライドパネル */}
      <div
        className={`fixed left-0 bg-gray-800 rounded-r-lg p-4 overflow-y-auto shadow-xl border-r border-t border-b border-gray-700 transition-transform duration-300 ease-in-out z-30 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{
          width: '320px',
          top: '8.5rem', // グローバルヘッダー(4rem) + コンテキストバー(約4.5rem)
          height: 'calc(100vh - 8.5rem - 1.5rem)', // 画面高さ - 上部 - 下部マージン
        }}
      >
        <h3 className="text-lg font-bold mb-3 flex items-center gap-2 whitespace-nowrap">
          <span className="text-yellow-400">⚠️</span>
          制約違反 ({uniqueCount}件)
        </h3>
        <div className="space-y-2">
          {highViolations.length > 0 && (
            <div className="bg-red-900/30 border border-red-700 rounded p-3">
              <div className="text-sm font-bold text-red-400 mb-2 flex items-center gap-1">
                <span>🚫</span> 重大 ({highViolations.length}件)
              </div>
              {highViolations.map((v, idx) => (
                <div key={idx} className="text-xs text-gray-300 mb-1">
                  • {v.message}
                </div>
              ))}
            </div>
          )}
          {mediumViolations.length > 0 && (
            <div className="bg-yellow-900/30 border border-yellow-700 rounded p-3">
              <div className="text-sm font-bold text-yellow-400 mb-2 flex items-center gap-1">
                <span>⚠️</span> 警告 ({mediumViolations.length}件)
              </div>
              {mediumViolations.map((v, idx) => (
                <div key={idx} className="text-xs text-gray-300 mb-1">
                  • {v.message}
                </div>
              ))}
            </div>
          )}
          {lowViolations.length > 0 && (
            <div className="bg-blue-900/30 border border-blue-700 rounded p-3">
              <div className="text-sm font-bold text-blue-400 mb-2 flex items-center gap-1">
                <span>ℹ️</span> 情報 ({lowViolations.length}件)
              </div>
              {lowViolations.map((v, idx) => (
                <div key={idx} className="text-xs text-gray-300 mb-1">
                  • {v.message}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 取っ手部分 - パネル右上に小さく配置 */}
      <button
        onClick={onToggle}
        className={`fixed bg-yellow-900/70 hover:bg-yellow-900/90 transition-all duration-300 ease-in-out rounded-r-lg shadow-lg border-r-2 border-t-2 border-b-2 border-yellow-700 z-30 ${
          isOpen ? 'left-[320px]' : 'left-0'
        }`}
        style={{
          top: '9rem', // グローバルヘッダー + コンテキストバー + 少しマージン
        }}
        title={isOpen ? '制約違反を閉じる' : '制約違反を表示'}
      >
        <div className="px-1.5 py-2 flex flex-col items-center gap-1">
          <span className="text-base">⚠️</span>
          <span className="text-[10px] font-bold text-yellow-400">{uniqueCount}</span>
        </div>
      </button>
    </>
  );
};
