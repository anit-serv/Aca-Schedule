import { useState, useMemo } from 'react';
import type { CustomFieldsSettings, CustomColumn, CustomColumnBindingType } from '../types';
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
}

export const CustomColumnManager = ({
  customFields,
  timetableType,
  onCustomFieldsChange,
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
    const updated = addColumn(settings, timetableType, {
      id: crypto.randomUUID(),
      name: newColumnName.trim(),
      bindingType: newColumnType,
    });

    onCustomFieldsChange(updated);
    setNewColumnName('');
    setNewColumnType('sequence');
    setIsAdding(false);
  };

  // 列削除
  const handleRemoveColumn = (columnId: string) => {
    if (!customFields) return;
    if (!confirm('この列を削除しますか？データも全て削除されます。')) return;
    const updated = removeColumn(customFields, timetableType, columnId);
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
    const updated = renameColumn(customFields, timetableType, editingColumnId, editingName.trim());
    onCustomFieldsChange(updated);
    setEditingColumnId(null);
  };

  // 列の移動（上下）
  const handleMoveUp = (index: number) => {
    if (!customFields || index === 0) return;
    const updated = reorderColumns(customFields, timetableType, index, index - 1);
    onCustomFieldsChange(updated);
  };

  const handleMoveDown = (index: number) => {
    if (!customFields || index >= columns.length - 1) return;
    const updated = reorderColumns(customFields, timetableType, index, index + 1);
    onCustomFieldsChange(updated);
  };

  return (
    <div className="w-72 bg-gray-800 rounded-lg border border-gray-700 flex flex-col h-full overflow-hidden">
      {/* ヘッダー */}
      <div className="px-4 py-3 border-b border-gray-700 flex-shrink-0">
        <h3 className="text-sm font-semibold text-gray-200">列管理</h3>
        <p className="text-xs text-gray-400 mt-0.5">
          {timetableType === 'performance' ? '本番用' : 'リハ用'} · {columns.length}列
        </p>
      </div>

      {/* 列リスト */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {columns.length === 0 && !isAdding && (
          <p className="text-xs text-gray-500 text-center py-4">
            カスタム列がありません。<br />「列を追加」から作成してください。
          </p>
        )}

        {columns.map((col, index) => (
          <div
            key={col.id}
            className="bg-gray-700/50 rounded-lg p-2 group"
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
                  className="flex-1 bg-gray-600 border border-blue-500 rounded px-2 py-0.5 text-sm text-white"
                  maxLength={20}
                />
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs" title={col.bindingType === 'sequence' ? '位置固定' : 'エントリー追従'}>
                  {col.bindingType === 'sequence' ? '📍' : '🎵'}
                </span>
                <span
                  className="flex-1 text-sm text-gray-200 cursor-pointer hover:text-blue-300 truncate"
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
                    className="text-gray-400 hover:text-white disabled:opacity-30 p-0.5"
                    title="上へ移動"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleMoveDown(index)}
                    disabled={index >= columns.length - 1}
                    className="text-gray-400 hover:text-white disabled:opacity-30 p-0.5"
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
              <span className="text-xs text-gray-500">
                {col.bindingType === 'sequence' ? '位置固定 · 結合可能' : 'エントリー追従'}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* 列追加フォーム */}
      <div className="border-t border-gray-700 p-3 flex-shrink-0">
        {isAdding ? (
          <div className="space-y-2">
            <input
              autoFocus
              type="text"
              placeholder="列名を入力"
              value={newColumnName}
              onChange={e => setNewColumnName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAddColumn(); if (e.key === 'Escape') setIsAdding(false); }}
              className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-white placeholder:text-gray-500"
              maxLength={20}
            />

            {/* 紐付けタイプ選択 */}
            <div className="space-y-1">
              <label className="flex items-start gap-2 p-1.5 rounded hover:bg-gray-700/50 cursor-pointer">
                <input
                  type="radio"
                  name="bindingType"
                  value="sequence"
                  checked={newColumnType === 'sequence'}
                  onChange={() => setNewColumnType('sequence')}
                  className="mt-0.5"
                />
                <div>
                  <div className="text-xs text-gray-200 font-medium">📍 位置固定</div>
                  <div className="text-xs text-gray-500">番号に紐付け。結合可能</div>
                </div>
              </label>
              <label className="flex items-start gap-2 p-1.5 rounded hover:bg-gray-700/50 cursor-pointer">
                <input
                  type="radio"
                  name="bindingType"
                  value="entity"
                  checked={newColumnType === 'entity'}
                  onChange={() => setNewColumnType('entity')}
                  className="mt-0.5"
                />
                <div>
                  <div className="text-xs text-gray-200 font-medium">🎵 エントリー追従</div>
                  <div className="text-xs text-gray-500">移動時にデータも追従</div>
                </div>
              </label>
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleAddColumn}
                disabled={!newColumnName.trim()}
                className="flex-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded"
              >
                追加
              </button>
              <button
                onClick={() => { setIsAdding(false); setNewColumnName(''); }}
                className="px-3 py-1.5 bg-gray-600 hover:bg-gray-500 text-gray-200 text-sm rounded"
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setIsAdding(true)}
            className="w-full px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded-lg border border-dashed border-gray-600 transition-colors"
          >
            + 列を追加
          </button>
        )}
      </div>
    </div>
  );
};
