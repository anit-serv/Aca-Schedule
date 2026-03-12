import { useState, useMemo } from 'react';
import type { CustomFieldsSettings, CustomColumn, CustomColumnBindingType } from '../types';
import { generateUUID } from '../utils/generateUUID';
import {
  getTypeData,
  addColumn,
  removeColumn,
  renameColumn,
  reorderColumns,
  createEmptyCustomFieldsSettings,
} from '../utils/customFieldsUtils';

interface CustomColumnManagerProps {
  customFields: CustomFieldsSettings | undefined;
  timetableType: 'performance' | 'rehearsal';
  onCustomFieldsChange: (customFields: CustomFieldsSettings) => void;
  /** trueの場合、操作をperformanceとrehearsal両方に適用 */
  applyToBoth?: boolean;
  /** モバイル表示用（全幅、ボーダー/シャドウなし） */
  mobile?: boolean;
}

export const CustomColumnManager = ({
  customFields,
  timetableType,
  onCustomFieldsChange,
  applyToBoth = false,
  mobile = false,
}: CustomColumnManagerProps) => {
  const [isAdding, setIsAdding] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');
  const [newColumnType, setNewColumnType] = useState<CustomColumnBindingType>('sequence');
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const typeData = getTypeData(customFields, timetableType);
  const columns = useMemo(
    () => [...typeData.columns].sort((a, b) => a.order - b.order),
    [typeData.columns]
  );

  // 列追加
  const handleAddColumn = () => {
    if (!newColumnName.trim()) return;

    const settings = customFields || createEmptyCustomFieldsSettings();
    const columnId = generateUUID();
    const columnData = {
      id: columnId,
      name: newColumnName.trim(),
      bindingType: newColumnType,
    };
    
    let updated = addColumn(settings, timetableType, columnData);
    // applyToBothがtrueの場合、もう一方のタイプにも追加
    if (applyToBoth) {
      const otherType = timetableType === 'performance' ? 'rehearsal' : 'performance';
      updated = addColumn(updated, otherType, columnData);
    }

    onCustomFieldsChange(updated);
    setNewColumnName('');
    setNewColumnType('sequence');
    setIsAdding(false);
  };

  // 列削除
  const handleRemoveColumn = (columnId: string) => {
    if (!customFields) return;
    if (!confirm('この列を削除しますか？データも全て削除されます。')) return;
    let updated = removeColumn(customFields, timetableType, columnId);
    if (applyToBoth) {
      const otherType = timetableType === 'performance' ? 'rehearsal' : 'performance';
      updated = removeColumn(updated, otherType, columnId);
    }
    onCustomFieldsChange(updated);
  };

  // 列名変更開始
  const handleStartRename = (col: CustomColumn) => {
    setEditingColumnId(col.id);
    setEditingName(col.name);
  };

  // 列名変更確定
  const handleRenameConfirm = () => {
    if (!customFields || !editingColumnId || !editingName.trim()) {
      setEditingColumnId(null);
      return;
    }
    let updated = renameColumn(customFields, timetableType, editingColumnId, editingName.trim());
    if (applyToBoth) {
      const otherType = timetableType === 'performance' ? 'rehearsal' : 'performance';
      updated = renameColumn(updated, otherType, editingColumnId, editingName.trim());
    }
    onCustomFieldsChange(updated);
    setEditingColumnId(null);
  };

  // 列の移動（上下）
  const handleMoveUp = (index: number) => {
    if (!customFields || index === 0) return;
    let updated = reorderColumns(customFields, timetableType, index, index - 1);
    if (applyToBoth) {
      const otherType = timetableType === 'performance' ? 'rehearsal' : 'performance';
      updated = reorderColumns(updated, otherType, index, index - 1);
    }
    onCustomFieldsChange(updated);
  };

  const handleMoveDown = (index: number) => {
    if (!customFields || index >= columns.length - 1) return;
    let updated = reorderColumns(customFields, timetableType, index, index + 1);
    if (applyToBoth) {
      const otherType = timetableType === 'performance' ? 'rehearsal' : 'performance';
      updated = reorderColumns(updated, otherType, index, index + 1);
    }
    onCustomFieldsChange(updated);
  };

  return (
    <div className={mobile ? 'w-full flex flex-col h-full overflow-hidden' : 'w-72 bg-white rounded-lg border border-gray-200 flex flex-col h-full overflow-hidden shadow'}>
      {/* ヘッダー */}
      <div className={mobile ? 'px-4 py-2 flex-shrink-0' : 'px-4 py-3 border-b border-gray-200 flex-shrink-0'}>
        {!mobile && <h3 className="text-sm font-semibold text-gray-700">列管理</h3>}
        <p className="text-xs text-gray-500">
          {applyToBoth ? '本番+リハ共通' : (timetableType === 'performance' ? '本番用' : 'リハ用')} · {columns.length}列
        </p>
      </div>

      {/* 列リスト */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {columns.length === 0 && !isAdding && (
          <p className="text-xs text-gray-400 text-center py-4">
            カスタム列がありません。<br />「列を追加」から作成してください。
          </p>
        )}

        {columns.map((col, index) => (
          <div
            key={col.id}
            className="bg-gray-50 rounded-lg p-2 group"
          >
            {editingColumnId === col.id ? (
              <div className="flex items-center gap-1">
                <input
                  autoFocus
                  type="text"
                  value={editingName}
                  onChange={e => setEditingName(e.target.value)}
                  onBlur={handleRenameConfirm}
                  onKeyDown={e => { if (e.key === 'Enter') handleRenameConfirm(); if (e.key === 'Escape') setEditingColumnId(null); }}
                  className="flex-1 bg-white border border-emerald-500 rounded px-2 py-0.5 text-sm text-gray-900"
                  maxLength={20}
                />
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs" title={col.bindingType === 'sequence' ? '位置固定' : 'エントリー追従'}>
                  {col.bindingType === 'sequence' ? '📍' : '🎵'}
                </span>
                <span
                  className="flex-1 text-sm text-gray-700 cursor-pointer hover:text-emerald-600 truncate"
                  onClick={() => handleStartRename(col)}
                  title="クリックで名前変更"
                >
                  {col.name}
                </span>

                {/* 操作ボタン */}
                <div className="hidden group-hover:flex items-center gap-0.5">
                  <button
                    onClick={() => handleMoveUp(index)}
                    disabled={index === 0}
                    className="text-gray-500 hover:text-gray-900 disabled:opacity-30 p-0.5"
                    title="上へ移動"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleMoveDown(index)}
                    disabled={index >= columns.length - 1}
                    className="text-gray-500 hover:text-gray-900 disabled:opacity-30 p-0.5"
                    title="下へ移動"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleRemoveColumn(col.id)}
                    className="text-red-400 hover:text-red-300 p-0.5"
                    title="列を削除"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            )}

            <div className="mt-0.5">
              <span className="text-xs text-gray-400">
                {col.bindingType === 'sequence' ? '位置固定 · 結合可能' : 'エントリー追従'}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* 列追加フォーム */}
      <div className="border-t border-gray-200 p-3 flex-shrink-0">
        {isAdding ? (
          <div className="space-y-2">
            <input
              autoFocus
              type="text"
              placeholder="列名を入力"
              value={newColumnName}
              onChange={e => setNewColumnName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAddColumn(); if (e.key === 'Escape') setIsAdding(false); }}
              className="w-full bg-white border border-gray-300 rounded px-2 py-1.5 text-sm text-gray-900 placeholder:text-gray-400"
              maxLength={20}
            />

            {/* 紐付けタイプ選択 */}
            <div className="space-y-1">
              <label className="flex items-start gap-2 p-1.5 rounded hover:bg-gray-100 cursor-pointer">
                <input
                  type="radio"
                  name="bindingType"
                  value="sequence"
                  checked={newColumnType === 'sequence'}
                  onChange={() => setNewColumnType('sequence')}
                  className="mt-0.5"
                />
                <div>
                  <div className="text-xs text-gray-700 font-medium">📍 位置固定</div>
                  <div className="text-xs text-gray-400">番号に紐付け。結合可能</div>
                </div>
              </label>
              <label className="flex items-start gap-2 p-1.5 rounded hover:bg-gray-100 cursor-pointer">
                <input
                  type="radio"
                  name="bindingType"
                  value="entity"
                  checked={newColumnType === 'entity'}
                  onChange={() => setNewColumnType('entity')}
                  className="mt-0.5"
                />
                <div>
                  <div className="text-xs text-gray-700 font-medium">🎵 エントリー追従</div>
                  <div className="text-xs text-gray-400">移動時にデータも追従</div>
                </div>
              </label>
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleAddColumn}
                disabled={!newColumnName.trim()}
                className="flex-1 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded"
              >
                追加
              </button>
              <button
                onClick={() => { setIsAdding(false); setNewColumnName(''); }}
                className="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm rounded"
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setIsAdding(true)}
            className="w-full px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-sm rounded-lg border border-dashed border-emerald-300 transition-colors"
          >
            + 列を追加
          </button>
        )}
      </div>
    </div>
  );
};
