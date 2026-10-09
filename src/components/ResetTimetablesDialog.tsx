import { createPortal } from 'react-dom';

interface ResetTimetablesDialogProps {
  scope?: 'both' | 'performance' | 'rehearsal';
  bandEntries: number;
  customEntries: number;
  isResetting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const ResetTimetablesDialog = ({ scope = 'both', bandEntries, customEntries, isResetting, onCancel, onConfirm }: ResetTimetablesDialogProps) =>
  createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4" role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="reset-timetables-title" className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h2 id="reset-timetables-title" className="text-lg font-bold text-gray-900">{scope === 'rehearsal' ? 'リハーサル全日程の配置をリセット' : scope === 'performance' ? '本番全日程の配置をリセット' : '本番と連動リハの配置をリセット'}</h2>
        <p className="mt-3 text-sm text-gray-700">
          {scope === 'rehearsal' ? 'リハーサル' : scope === 'performance' ? '本番' : '本番・クール直前リハ'}のバンド出演枠 <strong>{bandEntries}件</strong>とカスタムイベント枠 <strong>{customEntries}件</strong>をタイムテーブルから外します。
        </p>
        {scope === 'both' && <p className="mt-2 text-sm text-amber-700">クール直前リハは本番の同一クールに連動するため、本番をリセットするとリハの配置も外れます。</p>}
        <p className="mt-2 text-sm text-gray-700">行に入力したカスタム項目の値も削除されます。</p>
        <p className="mt-2 text-xs text-gray-500">バンド情報、カスタムイベントの定義、クール、開始時刻、カスタム列の設定は残ります。</p>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onCancel} disabled={isResetting} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 disabled:opacity-50">キャンセル</button>
          <button type="button" onClick={onConfirm} disabled={isResetting} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {isResetting ? 'リセット中…' : '配置をリセット'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
