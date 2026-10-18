import { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { Band, Timetable, CustomFieldsSettings, CustomColumn, CustomColumnBindingType, CustomFieldsUndoMeta } from '../types';
import { generateUUID } from '../utils/generateUUID';
import { Icon } from './Icon';
import { ShiftSetupDialog } from './ShiftSetupDialog';
import { ShiftAutoAssignDialog } from './ShiftAutoAssignDialog';
import { createShift, uniquePeople } from '../utils/customShift';
import {
  getTypeData,
  getSharedColumnId,
  addColumn,
  removeColumn,
  renameColumn,
  setColumnPublic,
  setColumnShared,
  reorderColumns,
  setColumnShift,
  synchronizeSharedColumnShifts,
  normalizeShiftPositionBindings,
  createEmptyCustomFieldsSettings,
} from '../utils/customFieldsUtils';

interface CustomColumnManagerProps {
  customFields: CustomFieldsSettings | undefined;
  timetableType: 'performance' | 'rehearsal';
  onCustomFieldsChange: (customFields: CustomFieldsSettings) => void;
  onUndoRecord?: (meta: CustomFieldsUndoMeta) => void;
  /** trueの場合、操作をperformanceとrehearsal両方に適用 */
  applyToBoth?: boolean;
  /** モバイル表示用（全幅、ボーダー/シャドウなし） */
  mobile?: boolean;
  bands?: Band[];
  timetable?: Timetable | null;
  counterpartTimetable?: Timetable | null;
}

export const CustomColumnManager = ({
  customFields,
  timetableType,
  onCustomFieldsChange,
  onUndoRecord,
  applyToBoth = false,
  mobile = false,
  bands = [],
  timetable = null,
  counterpartTimetable = null,
}: CustomColumnManagerProps) => {
  const [isAdding, setIsAdding] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');
  const [newColumnType, setNewColumnType] = useState<CustomColumnBindingType>('sequence');
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [menu, setMenu] = useState<{ columnId: string; left: number; top: number; submenuSide: 'left' | 'right' } | null>(null);
  const [activeSubmenu, setActiveSubmenu] = useState<{ kind: 'visibility' | 'shared'; top: number } | null>(null);
  const [pendingShare, setPendingShare] = useState<{ columnId: string; counterpartId: string; name: string; addColumn?: { id: string; name: string; bindingType: CustomColumnBindingType } } | null>(null);
  const [menuError, setMenuError] = useState('');
  const [shiftColumnId, setShiftColumnId] = useState<string | null>(null);
  const [autoAssignOpen, setAutoAssignOpen] = useState(false);

  const otherType = timetableType === 'performance' ? 'rehearsal' : 'performance';

  const typeData = getTypeData(customFields, timetableType);
  const columns = useMemo(
    () => [...typeData.columns].sort((a, b) => a.order - b.order),
    [typeData.columns]
  );

  useEffect(() => {
    if (!customFields) return;
    const synchronized = synchronizeSharedColumnShifts(customFields,
      timetableType === 'performance' ? timetable : counterpartTimetable,
      timetableType === 'rehearsal' ? timetable : counterpartTimetable);
    const normalized = normalizeShiftPositionBindings(synchronized,
      timetableType === 'performance' ? timetable : counterpartTimetable,
      timetableType === 'rehearsal' ? timetable : counterpartTimetable);
    if (normalized !== customFields) onCustomFieldsChange(normalized);
  }, [customFields, timetableType, timetable, counterpartTimetable, onCustomFieldsChange]);

  useEffect(() => {
    if (!menu) return;
    const closeOutside = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest('[data-column-menu]')) setMenu(null);
    };
    document.addEventListener('mousedown', closeOutside);
    return () => document.removeEventListener('mousedown', closeOutside);
  }, [menu]);

  const openMenu = (event: React.MouseEvent<HTMLButtonElement>, columnId: string) => {
    if (menu?.columnId === columnId) { setMenu(null); return; }
    const rect = event.currentTarget.getBoundingClientRect();
    const width = 192;
    const submenuWidth = 152;
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    const menuHeight = (columns.find(column => column.id === columnId)?.shift ? 4 : 3) * 40 + 8;
    const top = Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - menuHeight - 8));
    const rightSpace = window.innerWidth - (left + width);
    const leftSpace = left;
    setMenu({ columnId, left, top, submenuSide: rightSpace >= submenuWidth || rightSpace >= leftSpace ? 'right' : 'left' });
    setActiveSubmenu(null);
    setMenuError('');
  };

  const openSubmenu = (kind: 'visibility' | 'shared', button: HTMLButtonElement) => {
    setActiveSubmenu({ kind, top: button.offsetTop });
  };

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

    const counterpart = applyToBoth ? getTypeData(settings, otherType).columns.find(column => column.name === columnData.name) : undefined;
    if (counterpart) {
      setPendingShare({ columnId, counterpartId: counterpart.id, name: columnData.name, addColumn: columnData });
      return;
    }
    let updated = addColumn(settings, timetableType, columnData);
    if (applyToBoth) updated = setColumnShared(updated, timetableType, columnId, true, undefined, columnId, timetable, counterpartTimetable);
    onUndoRecord?.({ targetId: `column:${columnId}`, opType: 'customColumn:add', before: settings, after: updated });
    onCustomFieldsChange(updated);
    setNewColumnName('');
    setNewColumnType('sequence');
    setIsAdding(false);
  };

  // 列削除
  const handleRemoveColumn = (columnId: string) => {
    if (!customFields) return;
    const column = columns.find(item => item.id === columnId);
    const linked = column && getSharedColumnId(customFields, timetableType, column);
    if (!confirm(linked ? '共通列を本番とリハの両方から削除しますか？両方の入力データも削除されます。' : 'この列を削除しますか？データも全て削除されます。')) return;
    const updated = removeColumn(customFields, timetableType, columnId);
    onUndoRecord?.({ targetId: `column:${columnId}`, opType: 'customColumn:delete', before: customFields, after: updated });
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
    const trimmedName = editingName.trim();
    const currentColumn = columns.find(c => c.id === editingColumnId);
    if (currentColumn && currentColumn.name === trimmedName) {
      setEditingColumnId(null);
      return;
    }
    const updated = renameColumn(customFields, timetableType, editingColumnId, trimmedName);
    onUndoRecord?.({ targetId: `column:${editingColumnId}`, opType: 'customColumn:rename', before: customFields, after: updated });
    onCustomFieldsChange(updated);
    setEditingColumnId(null);
  };

  const handleVisibilityChange = (columnId: string, isPublic: boolean) => {
    if (!customFields) return;
    const updated = setColumnPublic(customFields, timetableType, columnId, isPublic);
    onUndoRecord?.({ targetId: `column:${columnId}`, opType: 'customColumn:visibility', before: customFields, after: updated });
    onCustomFieldsChange(updated);
  };

  // 列の移動（上下）
  const handleMoveUp = (index: number) => {
    if (!customFields || index === 0) return;
    const columnId = columns[index].id;
    const updated = reorderColumns(customFields, timetableType, index, index - 1);
    onUndoRecord?.({ targetId: `column:${columnId}`, opType: 'customColumn:reorder', before: customFields, after: updated });
    onCustomFieldsChange(updated);
  };

  const handleMoveDown = (index: number) => {
    if (!customFields || index >= columns.length - 1) return;
    const columnId = columns[index].id;
    const updated = reorderColumns(customFields, timetableType, index, index + 1);
    onUndoRecord?.({ targetId: `column:${columnId}`, opType: 'customColumn:reorder', before: customFields, after: updated });
    onCustomFieldsChange(updated);
  };

  const applySharedChange = (columnId: string, shared: boolean, counterpartId?: string) => {
    if (!customFields) return;
    try {
      const updated = setColumnShared(customFields, timetableType, columnId, shared, counterpartId, generateUUID(), timetable, counterpartTimetable);
      onUndoRecord?.({ targetId: `column:${columnId}`, opType: 'customColumn:shared', before: customFields, after: updated });
      onCustomFieldsChange(updated);
      setMenuError('');
    } catch (error) {
      setMenuError(error instanceof Error ? error.message : '共通列にできませんでした。');
    }
    setMenu(null);
  };

  const handleSharedChange = (column: CustomColumn) => {
    if (getSharedColumnId(customFields, timetableType, column)) { applySharedChange(column.id, false); return; }
    const counterpart = getTypeData(customFields, otherType).columns.find(other => other.name === column.name);
    if (counterpart) {
      setPendingShare({ columnId: column.id, counterpartId: counterpart.id, name: column.name });
      setMenu(null);
      return;
    }
    applySharedChange(column.id, true);
  };

  const confirmShare = () => {
    if (!pendingShare) return;
    const settings = customFields || createEmptyCustomFieldsSettings();
    try {
      const before = settings;
      const source = pendingShare.addColumn
        ? addColumn(settings, timetableType, pendingShare.addColumn)
        : settings;
      const updated = setColumnShared(source, timetableType, pendingShare.columnId, true, pendingShare.counterpartId, undefined, timetable, counterpartTimetable);
      onUndoRecord?.({ targetId: `column:${pendingShare.columnId}`, opType: pendingShare.addColumn ? 'customColumn:add' : 'customColumn:shared', before, after: updated });
      onCustomFieldsChange(updated);
      if (pendingShare.addColumn) {
        setNewColumnName('');
        setNewColumnType('sequence');
        setIsAdding(false);
      }
      setMenuError('');
    } catch (error) {
      setMenuError(error instanceof Error ? error.message : '共通列にできませんでした。');
    }
    setPendingShare(null);
  };

  const menuColumn = columns.find(column => column.id === menu?.columnId);
  const shiftColumn = columns.find(column => column.id === shiftColumnId);

  const saveShift = (candidates: string[], split: NonNullable<CustomColumn['shift']>['split']) => {
    if (!customFields || !shiftColumn) return;
    const previous = shiftColumn.shift;
    const linked = getTypeData(customFields, otherType).columns.find(column => column.id === getSharedColumnId(customFields, timetableType, shiftColumn));
    const removed = uniquePeople([...(previous?.candidates ?? []), ...(linked?.shift?.candidates ?? [])]).filter(name => !candidates.includes(name));
    if (removed.length) {
      const assigned = [previous, linked?.shift].flatMap(shift => Object.values(shift?.slotsByDate ?? {}).flatMap(day => Object.values(day).flat())).filter(slot => slot.assignee && removed.includes(slot.assignee));
      if (assigned.length && !confirm(`${assigned.length}枠で担当中の候補を削除します。担当者は未割当に戻しますか？`)) return;
    }
    const sameSplit = previous?.split.mode === split.mode && previous.split.value === split.value;
    const linkedSplitChanged = linked?.shift && (linked.shift.split.mode !== split.mode || linked.shift.split.value !== split.value);
    if (((previous && !sameSplit) || linkedSplitChanged) && !confirm('分け方を変更すると本番・リハ両方の既存の枠と担当者を作り直します。続けますか？')) return;
    const next = sameSplit && previous
      ? { ...previous, candidates: uniquePeople(candidates), slotsByDate: structuredClone(previous.slotsByDate) }
      : createShift(candidates, split, timetable);
    if (removed.length) {
      for (const day of Object.values(next.slotsByDate)) for (const slots of Object.values(day)) for (const slot of slots) {
        if (slot.assignee && removed.includes(slot.assignee)) delete slot.assignee;
      }
    }
    const updated = setColumnShift(customFields, timetableType, shiftColumn.id, next, counterpartTimetable, timetable);
    onUndoRecord?.({ targetId: `column:${shiftColumn.id}`, opType: 'customColumn:shift', before: customFields, after: updated });
    onCustomFieldsChange(updated);
    setShiftColumnId(null);
  };

  const disableShift = (column: CustomColumn) => {
    if (!customFields || !confirm(getSharedColumnId(customFields, timetableType, column)
      ? '本番・リハ両方のシフト枠と担当者を削除しますか？通常のセル入力は残ります。'
      : 'この列のシフト枠と担当者を削除しますか？通常のセル入力は残ります。')) return;
    const updated = setColumnShift(customFields, timetableType, column.id);
    onUndoRecord?.({ targetId: `column:${column.id}`, opType: 'customColumn:shift', before: customFields, after: updated });
    onCustomFieldsChange(updated);
    setMenu(null);
  };

  return (
    <div className={mobile ? 'w-full flex flex-col h-full overflow-hidden' : 'w-80 bg-white rounded-lg border border-gray-200 flex flex-col h-full overflow-hidden shadow'}>
      {/* ヘッダー */}
      <div className={mobile ? 'px-4 py-2 flex-shrink-0' : 'px-4 py-3 border-b border-gray-200 flex-shrink-0'}>
        {!mobile && <h3 className="text-sm font-semibold text-gray-700">列管理</h3>}
        <p className="text-xs text-gray-500">
          {timetableType === 'performance' ? '本番用' : 'リハ用'} · {columns.length}列
        </p>
        {(customFields?.performance.columns.some(column => column.shift) || customFields?.rehearsal.columns.some(column => column.shift)) &&
          <button type="button" onClick={() => setAutoAssignOpen(true)} className="mt-2 w-full rounded bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100">シフトを自動割り振り</button>}
        {menuError && <p role="alert" className="mt-1 text-xs text-red-600">{menuError}</p>}
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
                  <Icon name={col.bindingType === 'sequence' ? 'push_pin' : 'music_note'} className="text-sm align-middle" />
                </span>
                <span
                  className="flex-1 text-sm text-gray-700 cursor-pointer hover:text-emerald-600 truncate"
                  onClick={() => handleStartRename(col)}
                  title="クリックで名前変更"
                >
                  {col.name}
                </span>

                {/* 移動先がない端のボタンは常に無効表示 */}
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => handleMoveUp(index)}
                    disabled={index === 0}
                    className="text-gray-500 hover:text-gray-900 disabled:text-gray-300 disabled:cursor-not-allowed p-0.5"
                    title="上へ移動"
                    aria-label={`${col.name}を上へ移動`}
                  >
                    <Icon name="expand_less" className="text-sm" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMoveDown(index)}
                    disabled={index >= columns.length - 1}
                    className="text-gray-500 hover:text-gray-900 disabled:text-gray-300 disabled:cursor-not-allowed p-0.5"
                    title="下へ移動"
                    aria-label={`${col.name}を下へ移動`}
                  >
                    <Icon name="expand_more" className="text-sm" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveColumn(col.id)}
                    className="text-red-400 hover:text-red-300 p-0.5"
                    title="列を削除"
                    aria-label={`${col.name}を削除`}
                  >
                    <Icon name="close" className="text-sm" />
                  </button>
                  <button type="button" data-column-menu onClick={event => openMenu(event, col.id)}
                    className="rounded p-0.5 text-gray-600 hover:bg-gray-200 hover:text-gray-900"
                    aria-label={`${col.name}の設定`} aria-haspopup="menu" aria-expanded={menu?.columnId === col.id}>
                    <Icon name="more_vert" className="text-sm" />
                  </button>
                </div>
              </div>
            )}

            <div className="mt-0.5">
              <span className="text-xs text-gray-400">
                {col.bindingType === 'sequence' ? '位置固定 · 結合可能' : 'エントリー追従'}
                {getSharedColumnId(customFields, timetableType, col) ? ' · 本番・リハ共通' : ''}
                {col.isPublic ? ' · 一般公開中' : ''}
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
                  <div className="text-xs text-gray-700 font-medium"><Icon name="push_pin" className="text-sm align-middle mr-0.5" />位置固定</div>
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
                  <div className="text-xs text-gray-700 font-medium"><Icon name="music_note" className="text-sm align-middle mr-0.5" />エントリー追従</div>
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
      {menu && menuColumn && createPortal(
        <div data-column-menu role="menu" aria-label={`${menuColumn.name}の設定`}
          className="fixed z-[220] w-48 rounded-lg border border-gray-200 bg-white p-1 shadow-xl"
          style={{ left: menu.left, top: menu.top }} onMouseLeave={() => setMenu(null)}>
          <button type="button" role="menuitem" onMouseEnter={() => setActiveSubmenu(null)}
            onClick={() => { setShiftColumnId(menuColumn.id); setMenu(null); }}
            className="w-full rounded px-2 py-2 text-left text-sm text-gray-700 hover:bg-gray-100">
            {menuColumn.shift ? 'シフト設定を編集' : 'シフトモードを作成'}
          </button>
          {menuColumn.shift && <button type="button" role="menuitem" onMouseEnter={() => setActiveSubmenu(null)}
            onClick={() => disableShift(menuColumn)}
            className="w-full rounded px-2 py-2 text-left text-sm text-red-600 hover:bg-red-50">シフトモードを解除</button>}
          <button type="button" role="menuitem" onMouseEnter={event => openSubmenu('visibility', event.currentTarget)}
            onFocus={event => openSubmenu('visibility', event.currentTarget)} onClick={event => openSubmenu('visibility', event.currentTarget)}
            className="flex w-full items-center justify-between rounded px-2 py-2 text-left text-sm text-gray-700 hover:bg-gray-100">
            <span>一般公開 <span className="text-xs text-gray-400">{menuColumn.isPublic ? 'オン' : 'オフ'}</span></span>
            <Icon name={menu.submenuSide === 'right' ? 'chevron_right' : 'chevron_left'} className="text-base" />
          </button>
          <button type="button" role="menuitem" onMouseEnter={event => openSubmenu('shared', event.currentTarget)}
            onFocus={event => openSubmenu('shared', event.currentTarget)} onClick={event => openSubmenu('shared', event.currentTarget)}
            className="flex w-full items-center justify-between rounded px-2 py-2 text-left text-sm text-gray-700 hover:bg-gray-100">
            <span>本番・リハ共通 <span className="text-xs text-gray-400">{getSharedColumnId(customFields, timetableType, menuColumn) ? 'オン' : 'オフ'}</span></span>
            <Icon name={menu.submenuSide === 'right' ? 'chevron_right' : 'chevron_left'} className="text-base" />
          </button>
          {activeSubmenu && <div role="menu" aria-label={`${activeSubmenu.kind === 'visibility' ? '一般公開' : '本番・リハ共通'}の操作`}
            className="absolute w-[152px] rounded-lg border border-gray-200 bg-white p-1 shadow-xl"
            style={{
              left: menu.submenuSide === 'right'
                ? Math.min(191, window.innerWidth - menu.left - 160)
                : Math.max(-152, 8 - menu.left),
              top: activeSubmenu.top,
            }}>
            <button type="button" role="menuitem" className="w-full rounded px-3 py-2 text-left text-sm text-gray-700 hover:bg-emerald-50 hover:text-emerald-700"
              onClick={() => {
                if (activeSubmenu.kind === 'visibility') handleVisibilityChange(menuColumn.id, !menuColumn.isPublic);
                else handleSharedChange(menuColumn);
                setMenu(null);
              }}>
              {activeSubmenu.kind === 'visibility'
                ? menuColumn.isPublic ? 'オフにする' : 'オンにする'
                : getSharedColumnId(customFields, timetableType, menuColumn) ? '共通を解除' : '共通にする'}
            </button>
          </div>}
        </div>, document.body,
      )}
      {pendingShare && createPortal(
        <div className="fixed inset-0 z-[230] flex items-center justify-center bg-black/50 p-4" role="presentation">
          <div role="dialog" aria-modal="true" aria-labelledby="shared-column-confirm-title" className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <h3 id="shared-column-confirm-title" className="text-lg font-bold text-gray-900">同名の列を共通にしますか？</h3>
            <p className="mt-3 text-sm text-gray-700">{otherType === 'performance' ? '本番' : 'リハ'}側に「{pendingShare.name}」があります。この列を共通列として連携します。両方の入力済みデータは残ります。</p>
            <p className="mt-2 text-xs text-gray-500">列名・一般公開設定・シフトモード・担当候補・枠数設定は両方に反映されます。枠の境界と担当者はそれぞれ保持します。共通を解除しても、どちらの列も残ります。</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setPendingShare(null)} className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-700">キャンセル</button>
              <button type="button" onClick={confirmShare} className="rounded bg-emerald-600 px-3 py-2 text-sm text-white">共通列にする</button>
            </div>
          </div>
        </div>, document.body,
      )}
      {shiftColumn && <ShiftSetupDialog
        columnName={shiftColumn.name}
        bands={bands}
        registeredMembers={customFields?.members}
        initial={shiftColumn.shift}
        shared={!!getSharedColumnId(customFields, timetableType, shiftColumn)}
        seedCandidates={getTypeData(customFields, otherType).columns.find(column => column.id === getSharedColumnId(customFields, timetableType, shiftColumn))?.shift?.candidates}
        onCancel={() => setShiftColumnId(null)}
        onSave={saveShift}
      />}
      {autoAssignOpen && customFields && <ShiftAutoAssignDialog
        settings={customFields}
        performance={timetableType === 'performance' ? timetable : counterpartTimetable}
        rehearsal={timetableType === 'rehearsal' ? timetable : counterpartTimetable}
        bands={bands}
        onCancel={() => setAutoAssignOpen(false)}
        onApply={updated => {
          onUndoRecord?.({ targetId: 'shift:auto', opType: 'customColumn:shift', before: customFields, after: updated });
          onCustomFieldsChange(updated);
          setAutoAssignOpen(false);
        }}
      />}
    </div>
  );
};
