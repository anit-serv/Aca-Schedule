import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useDroppable } from '@dnd-kit/core';
import { BandBankItem } from './BandBankItem';
import { CustomEventBankItem } from './CustomEventBankItem';
import type { Band, CustomEvent } from '../types';

interface BandBankDropZoneProps {
  unplacedBands: (Band & { placedCount: number })[];
  timetableType?: 'performance' | 'rehearsal';
  unifiedCoolPre?: boolean;
  onTimetableTypeChange?: (type: 'performance' | 'rehearsal') => void;
  showAutomation?: boolean;
  rehearsalDuration?: number;
  customEvents: CustomEvent[];
  onAddCustomEvent: (customEvent: Omit<CustomEvent, 'id'>) => void;
  onDeleteCustomEvent: (id: string) => void;
  arrivalBandId?: string | null;
  onAutoSchedule: () => void;
  isAutoScheduling: boolean;
  autoScheduleMessage: string | null;
  onDismissAutoScheduleMessage: () => void;
  onResetAll: () => void;
  isResetting: boolean;
  resetEntryCount: number;
  onAddFixed?: (bandId: string) => void;
}

export const BandBankDropZone = ({ 
  unplacedBands, 
  timetableType = 'performance',
  unifiedCoolPre = false,
  onTimetableTypeChange,
  showAutomation = true,
  rehearsalDuration = 0,
  customEvents,
  onAddCustomEvent,
  onDeleteCustomEvent,
  arrivalBandId = null,
  onAutoSchedule,
  isAutoScheduling,
  autoScheduleMessage,
  onDismissAutoScheduleMessage,
  onResetAll,
  isResetting,
  resetEntryCount,
  onAddFixed,
}: BandBankDropZoneProps) => {
  const { setNodeRef } = useDroppable({
    id: 'band-bank-droppable',
  });

  const [showModal, setShowModal] = useState(false);
  const [eventName, setEventName] = useState('');
  const [eventDuration, setEventDuration] = useState(10);

  const handleAddCustomEvent = () => {
    if (eventName.trim()) {
      onAddCustomEvent({
        name: eventName.trim(),
        duration: eventDuration,
      });
      setEventName('');
      setEventDuration(10);
      setShowModal(false);
    }
  };

  return (
    <div ref={setNodeRef} data-band-bank-kind={timetableType} className="h-full w-80 overflow-x-hidden overflow-y-auto rounded-lg bg-white shadow">
      <div className="min-h-full p-4">
      {unifiedCoolPre && (
        <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-emerald-50 p-1" aria-label="バンドバンクの種類">
          {(['performance', 'rehearsal'] as const).map(type => (
            <button key={type} type="button" onClick={() => onTimetableTypeChange?.(type)}
              className={`rounded-md px-2 py-2 text-sm font-medium ${timetableType === type ? 'bg-emerald-600 text-white' : 'text-emerald-700'}`}>
              {type === 'performance' ? '本番バンク' : 'リハバンク'}
            </button>
          ))}
        </div>
      )}
      {(showAutomation || resetEntryCount > 0) && (
        <div className="mb-4 space-y-2">
          {showAutomation && <button
            type="button"
            onClick={onAutoSchedule}
            disabled={isAutoScheduling || isResetting}
            className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
          >
            {isAutoScheduling ? '配置中…' : `${timetableType === 'performance' ? '本番' : 'リハ'}の全日程を自動配置`}
          </button>}
          {resetEntryCount > 0 && (
            <button type="button" onClick={onResetAll} disabled={isAutoScheduling || isResetting}
              className="w-full rounded-lg border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50">
              {timetableType === 'rehearsal' ? 'リハの全日程をリセット' : unifiedCoolPre ? '本番と連動リハをリセット' : '本番の全日程をリセット'}
            </button>
          )}
          {autoScheduleMessage && (
            <div role="status" className="flex items-start justify-between gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              <span>{autoScheduleMessage}</span>
              <button type="button" onClick={onDismissAutoScheduleMessage} aria-label="通知を閉じる">×</button>
            </div>
          )}
        </div>
      )}
      {/* カスタムイベント追加ボタン */}
      <button
        onClick={() => setShowModal(true)}
        className="w-full mb-4 bg-emerald-500 hover:bg-emerald-600 text-white py-2 px-4 rounded-lg transition-colors"
      >
        + カスタムイベントを追加
      </button>

      {/* カスタムイベント作成モーダル */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96 shadow-xl">
            <h4 className="text-lg font-bold mb-4 text-gray-900">カスタムイベントを作成</h4>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700">イベント名</label>
                <input
                  type="text"
                  value={eventName}
                  onChange={(e) => setEventName(e.target.value)}
                  placeholder="例: 休憩、MC、セットチェンジ"
                  className="w-full bg-white border border-gray-300 rounded px-3 py-2 text-gray-900"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700">時間（分）</label>
                <input
                  type="number"
                  value={eventDuration}
                  onChange={(e) => setEventDuration(Number(e.target.value))}
                  min="1"
                  max="60"
                  className="w-full bg-white border border-gray-300 rounded px-3 py-2 text-gray-900"
                />
              </div>
              
              <div className="flex gap-2 justify-end mt-6">
                <button
                  onClick={() => {
                    setShowModal(false);
                    setEventName('');
                    setEventDuration(10);
                  }}
                  className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded transition-colors text-gray-700"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleAddCustomEvent}
                  disabled={!eventName.trim()}
                  className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-white"
                >
                  作成
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* カスタムイベント一覧 */}
      {customEvents.length > 0 && (
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-emerald-600 mb-2">カスタムイベント</h4>
          <div className="space-y-2">
            {customEvents.map((event) => (
              <CustomEventBankItem
                key={`custom-${event.id}`}
                id={`custom-${event.id}`}
                customEvent={event}
                onDelete={onDeleteCustomEvent}
              />
            ))}
          </div>
        </div>
      )}
      
      <div className="text-sm font-semibold text-emerald-700 mb-4 pb-2 border-b border-emerald-200">
        未配置バンド: {unplacedBands.length}
      </div>

      <div className="space-y-2">
        {unplacedBands.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            すべてのバンドが配置されました
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {unplacedBands.map((band) => (
              <motion.div
                key={`band-${band.id}`}
                initial={{ opacity: 0, x: 280, scale: 0.94 }}
                animate={arrivalBandId === band.id
                  ? { opacity: [0.4, 1], x: [280, -8, 0], scale: [0.94, 1.03, 1] }
                  : { opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.94 }}
                transition={{ duration: 0.36, ease: 'easeOut' }}
              >
                <BandBankItem
                  id={`band-${band.id}`}
                  band={band}
                  placedCount={band.placedCount}
                  timetableType={timetableType}
                  rehearsalDuration={rehearsalDuration}
                  onAddFixed={onAddFixed}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
      </div>
    </div>
  );
};
