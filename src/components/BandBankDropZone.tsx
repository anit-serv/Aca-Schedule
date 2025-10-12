import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { BandBankItem } from './BandBankItem';
import { CustomEventBankItem } from './CustomEventBankItem';
import type { Band, CustomEvent } from '../types';

interface BandBankDropZoneProps {
  unplacedBands: (Band & { placedCount: number })[];
  timetableType?: 'performance' | 'rehearsal';
  rehearsalDuration?: number;
  customEvents: CustomEvent[];
  onAddCustomEvent: (customEvent: Omit<CustomEvent, 'id'>) => void;
  onDeleteCustomEvent: (id: string) => void;
}

export const BandBankDropZone = ({ 
  unplacedBands, 
  timetableType = 'performance',
  rehearsalDuration = 0,
  customEvents,
  onAddCustomEvent,
  onDeleteCustomEvent
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
    <div ref={setNodeRef} className="w-80 bg-gray-800 rounded-lg p-4 overflow-y-auto">
      {/* カスタムイベント追加ボタン */}
      <button
        onClick={() => setShowModal(true)}
        className="w-full mb-4 bg-purple-600 hover:bg-purple-700 text-white py-2 px-4 rounded-lg transition-colors"
      >
        + カスタムイベントを追加
      </button>

      {/* カスタムイベント作成モーダル */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 w-96">
            <h4 className="text-lg font-bold mb-4">カスタムイベントを作成</h4>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">イベント名</label>
                <input
                  type="text"
                  value={eventName}
                  onChange={(e) => setEventName(e.target.value)}
                  placeholder="例: 休憩、MC、セットチェンジ"
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">時間（分）</label>
                <input
                  type="number"
                  value={eventDuration}
                  onChange={(e) => setEventDuration(Number(e.target.value))}
                  min="1"
                  max="60"
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2"
                />
              </div>
              
              <div className="flex gap-2 justify-end mt-6">
                <button
                  onClick={() => {
                    setShowModal(false);
                    setEventName('');
                    setEventDuration(10);
                  }}
                  className="px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded transition-colors"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleAddCustomEvent}
                  disabled={!eventName.trim()}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
          <h4 className="text-sm font-semibold text-purple-300 mb-2">カスタムイベント</h4>
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
      
      <div className="text-sm text-gray-400 mb-4">
        未配置バンド: {unplacedBands.length}
      </div>

      <div className="space-y-2">
        {unplacedBands.length === 0 ? (
          <div className="text-center text-gray-400 py-8">
            すべてのバンドが配置されました
          </div>
        ) : (
          unplacedBands.map((band) => (
            <BandBankItem
              key={`band-${band.id}`}
              id={`band-${band.id}`}
              band={band}
              placedCount={band.placedCount}
              timetableType={timetableType}
              rehearsalDuration={rehearsalDuration}
            />
          ))
        )}
      </div>
    </div>
  );
};
