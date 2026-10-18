import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AutoScheduleJob } from '../services/autoScheduleJob';
import type { AutoScheduleRange } from '../utils/autoSchedule';

interface Props {
  type: 'performance' | 'rehearsal';
  bandCount: number;
  onCancel: () => void;
  onPrepare: (range?: AutoScheduleRange) => Promise<AutoScheduleJob>;
  onReadPreparation: () => Promise<AutoScheduleJob>;
  onConfirm: (runId: Promise<string>, range?: AutoScheduleRange) => void;
}

export const AutoScheduleDialog = ({ type, bandCount, onCancel, onPrepare, onReadPreparation, onConfirm }: Props) => {
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [range, setRange] = useState<AutoScheduleRange | null>(null);
  const [startNumber, setStartNumber] = useState(1);
  const [endNumber, setEndNumber] = useState(bandCount);
  const validRange = Number.isSafeInteger(startNumber) && Number.isSafeInteger(endNumber)
    && startNumber >= 1 && endNumber <= bandCount && startNumber < endNumber;
  const label = type === 'performance' ? '本番' : 'リハ';
  const preparationTaskRef = useRef<Promise<string> | null>(null);
  const prepareQueueRef = useRef<Promise<void>>(Promise.resolve());
  const confirmedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    // Only the request that creates a run is serialized. A changed range cancels its old poll.
    const startedTask = prepareQueueRef.current.then(() => {
      if (cancelled) throw new Error('計算条件が変更されました。');
      return onPrepare(range || undefined);
    });
    prepareQueueRef.current = startedTask.then(() => undefined, () => undefined);
    const task = startedTask.then(async started => {
      if (!started.runId) throw new Error('計算を開始できませんでした。');
      while (!cancelled) {
        const job = await onReadPreparation();
        if (cancelled) break;
        if (job.runId !== started.runId) throw new Error('計算条件が更新されました。画面を開き直してください。');
        if (job.status === 'prepared') return started.runId;
        if (job.status === 'failed') throw new Error(job.error || '計算に失敗しました。');
        if (job.status !== 'preparing' && job.status !== 'previewing') {
          throw new Error('計算結果が利用できません。画面を開き直してください。');
        }
        await new Promise(resolve => window.setTimeout(resolve, 1000));
      }
      throw new Error('計算がキャンセルされました。');
    });
    preparationTaskRef.current = task;
    // Handle rejections even when the dialog is cancelled before the user starts.
    void task.catch(() => undefined);
    return () => { if (!confirmedRef.current) cancelled = true; };
  }, [onPrepare, onReadPreparation, range]);

  return createPortal(
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/55 px-4" role="presentation">
      {optionsOpen ? <div role="dialog" aria-modal="true" aria-labelledby="auto-schedule-options-title" className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h2 id="auto-schedule-options-title" className="text-lg font-bold text-gray-900">出演番号の範囲を指定</h2>
        <p className="mt-3 text-sm text-gray-700">現在配置済みの{label}バンドのうち、指定した出演番号の範囲内だけを並び替えます。番号は全日程を通したバンドの連番です。</p>
        <p className="mt-2 text-sm text-gray-700">範囲外のカードと時刻、カスタムイベント、時刻固定カードは動かしません。未配置バンドの追加も行いません。</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <label className="text-sm font-medium text-gray-700">開始番号
            <input type="number" min={1} max={bandCount} value={startNumber} onChange={event => setStartNumber(Number(event.target.value))}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900" />
          </label>
          <label className="text-sm font-medium text-gray-700">終了番号
            <input type="number" min={1} max={bandCount} value={endNumber} onChange={event => setEndNumber(Number(event.target.value))}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900" />
          </label>
        </div>
        {!validRange && <p role="alert" className="mt-2 text-sm text-red-700">1〜{bandCount}の範囲で、開始番号より大きい終了番号を指定してください。</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={() => setOptionsOpen(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700">戻る</button>
          <button type="button" disabled={!validRange} onClick={() => { setRange({ startNumber, endNumber }); setOptionsOpen(false); }}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">この範囲を選択</button>
        </div>
      </div> : <div role="dialog" aria-modal="true" aria-labelledby="auto-schedule-title" className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h2 id="auto-schedule-title" className="text-lg font-bold text-gray-900">{label}の自動配置を実行しますか？</h2>
        {range ? <p className="mt-3 text-sm text-gray-700">出演番号 <strong>{range.startNumber}〜{range.endNumber}</strong> の配置済みバンドだけを並び替えます。</p>
          : <p className="mt-3 text-sm text-gray-700">{label}の全日程で、未配置の出演枠を出演可能時間内に追加します。既存カードの順序とクール、時刻固定カードは維持します。</p>}
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-gray-700">
          <li>出演可能時間、クール開始時刻、日ごとの終了時刻を守ります。条件を満たせない出演枠は未配置のまま残る場合があります。</li>
          <li>開始すると完了までタイムテーブルとバンド管理を編集できません。</li>
          <li>完了後は「元に戻す」で取り消せます。</li>
        </ul>
        <p className="mt-3 text-xs text-gray-500">{range ? '範囲外のカードと時刻は変更しません。' : '配置済みカードの時刻は、固定されていない場合に調整されることがあります。'}</p>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <button type="button" disabled={bandCount < 2} onClick={() => setOptionsOpen(true)} className="rounded-lg border border-emerald-300 px-4 py-2 text-sm font-medium text-emerald-700 disabled:opacity-50">オプション</button>
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700">キャンセル</button>
            <button type="button" onClick={() => {
              confirmedRef.current = true;
              onConfirm(preparationTaskRef.current || Promise.reject(new Error('計算を開始できませんでした。')), range || undefined);
            }} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white">{range ? '範囲内を並び替える' : '全日程を自動配置'}</button>
          </div>
        </div>
        {range && <button type="button" onClick={() => setRange(null)} className="mt-3 text-xs text-emerald-700 underline">範囲指定を解除</button>}
      </div>}
    </div>, document.body,
  );
};
