import type { SkippedOpInfo, OperationType } from '../types';

const OP_LABELS: Record<OperationType, string> = {
  'entry:add': 'エントリー追加',
  'entry:delete': 'エントリー削除',
  'entry:reorder': 'エントリー並び替え',
  'cool:add': 'クール追加',
  'cool:delete': 'クール削除',
  'cool:startTime': 'クール開始時刻変更',
  'band:add': 'バンド追加',
  'band:delete': 'バンド削除',
  'band:update': 'バンド情報編集',
  'customCell:set': 'カスタムフィールド値変更',
  'customCell:merge': 'セル結合',
  'customCell:unmerge': 'セル結合解除',
  'customColumn:add': 'カスタム列追加',
  'customColumn:delete': 'カスタム列削除',
};

const REASON_LABELS: Record<SkippedOpInfo['reason'], string> = {
  external: '別のデバイスまたはユーザーによって変更されています',
  cascade: '関連する操作がスキップされたため無効化されました',
  hasData: '列にデータが存在するためUndoできません',
};

interface SkipNotificationDialogProps {
  skippedOps: SkippedOpInfo[];
  onClose: () => void;
}

export const SkipNotificationDialog = ({ skippedOps, onClose }: SkipNotificationDialogProps) => {
  if (skippedOps.length === 0) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[200]">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 p-5">
        <h3 className="text-sm font-bold text-gray-900 mb-3">
          {skippedOps.length === 1 ? '操作をスキップしました' : `${skippedOps.length}件の操作をスキップしました`}
        </h3>
        <div className="space-y-2 mb-4">
          {skippedOps.map((op, i) => (
            <div key={i} className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <p className="text-sm font-medium text-amber-800">{OP_LABELS[op.opType]}</p>
              <p className="text-xs text-amber-600 mt-0.5">{REASON_LABELS[op.reason]}</p>
            </div>
          ))}
        </div>
        <button
          onClick={onClose}
          className="w-full px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors"
        >
          OK
        </button>
      </div>
    </div>
  );
};
