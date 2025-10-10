import { useState, useEffect } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableTimetableRow } from './SortableTimetableRow';
import type { Cool, Band } from '../types';

interface CoolSectionProps {
  cool: Cool;
  coolIndex: number;
  totalCools: number;
  bands: Band[];
  overEntryId: string | null;
  onRemoveEntry: (entryId: string) => void;
  onDeleteCool: (coolIndex: number) => void;
  onMoveCoolUp: (coolIndex: number) => void;
  onMoveCoolDown: (coolIndex: number) => void;
  isReadOnly?: boolean; // クール直前リハーサルなどで編集を制限
  onTransitionTimeChange?: (entryId: string, transitionTime: number) => void;
}

export const CoolSection = ({ 
  cool, 
  coolIndex, 
  totalCools,
  bands, 
  overEntryId, 
  onRemoveEntry,
  onDeleteCool,
  onMoveCoolUp,
  onMoveCoolDown,
  isReadOnly = false,
  onTransitionTimeChange,
}: CoolSectionProps) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const { setNodeRef } = useDroppable({
    id: `cool-droppable-${coolIndex}`,
  });

  // メニュー外をクリックしたときに閉じる
  useEffect(() => {
    if (!isMenuOpen) return;
    
    const handleClickOutside = () => setIsMenuOpen(false);
    document.addEventListener('click', handleClickOutside);
    
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [isMenuOpen]);

  const handleDeleteClick = () => {
    onDeleteCool(coolIndex);
    setIsMenuOpen(false);
  };

  const handleMoveUp = () => {
    onMoveCoolUp(coolIndex);
    setIsMenuOpen(false);
  };

  const handleMoveDown = () => {
    onMoveCoolDown(coolIndex);
    setIsMenuOpen(false);
  };

  const handleMenuToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsMenuOpen(!isMenuOpen);
  };

  return (
    <div className="bg-gray-700 rounded-lg overflow-hidden">
      {totalCools > 1 && !isReadOnly && (
        <div className="bg-gray-600 px-4 py-2 flex justify-between items-center">
          <div className="font-semibold">第{cool.number}クール</div>
          <div className="relative">
            <button
              onClick={handleMenuToggle}
              className="px-2 py-1 text-white hover:bg-gray-500 rounded transition-colors"
              title="メニュー"
            >
              ⋮
            </button>
            
            {isMenuOpen && (
              <div className="absolute right-0 mt-1 w-40 bg-gray-800 border border-gray-600 rounded shadow-lg z-10">
                <button
                  onClick={handleMoveUp}
                  disabled={coolIndex === 0}
                  className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-700 ${
                    coolIndex === 0 ? 'text-gray-500 cursor-not-allowed' : 'text-white'
                  }`}
                >
                  ↑ 上に移動
                </button>
                <button
                  onClick={handleMoveDown}
                  disabled={coolIndex === totalCools - 1}
                  className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-700 ${
                    coolIndex === totalCools - 1 ? 'text-gray-500 cursor-not-allowed' : 'text-white'
                  }`}
                >
                  ↓ 下に移動
                </button>
                <div className="border-t border-gray-600"></div>
                <button
                  onClick={handleDeleteClick}
                  className="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-gray-700 transition-colors"
                >
                  🗑 削除
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      <div ref={setNodeRef} className="min-h-[100px]">
        <table className="w-full">
          <thead className="bg-gray-650">
            <tr>
              <th className="px-4 py-2 text-left text-sm font-semibold w-24">開始</th>
              <th className="px-4 py-2 text-left text-sm font-semibold w-24">終了</th>
              <th className="px-4 py-2 text-left text-sm font-semibold w-20">時間</th>
              <th className="px-4 py-2 text-left text-sm font-semibold">バンド名</th>
              <th className="px-4 py-2 text-left text-sm font-semibold w-20">操作</th>
            </tr>
          </thead>
          <tbody>
            {cool.entries.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  バンドをドラッグ＆ドロップで配置
                </td>
              </tr>
            ) : (
              <>
                {cool.entries.map((entry) => {
                  const band = entry.bandId ? bands.find((b) => b.id === entry.bandId) : null;
                  const entryId = `entry-${entry.id}`;
                  const isDropTarget = overEntryId === entryId;
                  // バンド情報が更新されたときに確実に再レンダリングするため、keyにバンド情報を含める
                  const rowKey = band 
                    ? `${entry.id}-${band.name}-${band.performanceDuration}-${band.updatedAt.getTime()}`
                    : entry.id;
                  
                  return (
                    <SortableTimetableRow
                      key={rowKey}
                      id={entryId}
                      entry={entry}
                      band={band}
                      isDropTarget={isDropTarget}
                      onRemove={() => onRemoveEntry(entry.id)}
                      isReadOnly={isReadOnly}
                      onTransitionTimeChange={onTransitionTimeChange}
                    />
                  );
                })}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
