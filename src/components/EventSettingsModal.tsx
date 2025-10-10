import { useState, useEffect } from 'react';
import type { EventSettings } from '../types';

interface EventSettingsModalProps {
  eventSettings: EventSettings;
  onClose: () => void;
  onSave: (settings: EventSettings) => void;
}

export const EventSettingsModal = ({
  eventSettings,
  onClose,
  onSave,
}: EventSettingsModalProps) => {
  const [editedSettings, setEditedSettings] = useState<EventSettings>(eventSettings);

  useEffect(() => {
    setEditedSettings(eventSettings);
  }, [eventSettings]);

  const handleSave = () => {
    onSave(editedSettings);
    onClose();
  };

  const handlePresetDurationAdd = () => {
    const newDuration = 5; // デフォルト5分
    setEditedSettings({
      ...editedSettings,
      presetDurations: [...editedSettings.presetDurations, newDuration],
    });
  };

  const handlePresetDurationChange = (index: number, value: number) => {
    const updated = [...editedSettings.presetDurations];
    updated[index] = value;
    setEditedSettings({
      ...editedSettings,
      presetDurations: updated,
    });
  };

  const handlePresetDurationRemove = (index: number) => {
    setEditedSettings({
      ...editedSettings,
      presetDurations: editedSettings.presetDurations.filter((_, i) => i !== index),
    });
  };

  const handleRehearsalDurationChange = (value: number) => {
    setEditedSettings({
      ...editedSettings,
      rehearsalDuration: value,
    });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold">イベント設定</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-2xl"
          >
            ×
          </button>
        </div>

        <div className="space-y-6">
          {/* 基本情報 */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-white mb-1">イベント名</label>
              <input
                type="text"
                value={editedSettings.name}
                onChange={(e) => setEditedSettings({ ...editedSettings, name: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-white mb-1">開催年</label>
                <input
                  type="number"
                  value={editedSettings.year}
                  onChange={(e) => setEditedSettings({ ...editedSettings, year: Number(e.target.value) })}
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-white mb-1">会場</label>
                <input
                  type="text"
                  value={editedSettings.venue}
                  onChange={(e) => setEditedSettings({ ...editedSettings, venue: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-white mb-1">目標</label>
              <textarea
                value={editedSettings.goal}
                onChange={(e) => setEditedSettings({ ...editedSettings, goal: e.target.value })}
                rows={2}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-white mb-1">本番開催日</label>
              <div className="space-y-2">
                {editedSettings.performanceDates.map((date, index) => (
                  <input
                    key={index}
                    type="date"
                    value={date}
                    onChange={(e) => {
                      const updatedDates = [...editedSettings.performanceDates];
                      updatedDates[index] = e.target.value;
                      setEditedSettings({ ...editedSettings, performanceDates: updatedDates });
                    }}
                    className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
                  />
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-1">
                日付の追加・削除はできません
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-white mb-1">リハーサル形式</label>
              <input
                type="text"
                value={
                  editedSettings.rehearsalType === 'rehearsal-day' ? '別日リハーサル' :
                  editedSettings.rehearsalType === 'cool-pre-rehearsal' ? 'クール直前リハーサル' :
                  editedSettings.rehearsalType === 'day-start-rehearsal' ? '当日一括リハーサル' :
                  'リハーサルなし'
                }
                disabled
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-gray-500 cursor-not-allowed"
              />
            </div>

            {editedSettings.rehearsalType === 'rehearsal-day' && editedSettings.rehearsalDates && (
              <div>
                <label className="block text-sm font-medium text-white mb-1">リハーサル日</label>
                <div className="space-y-2">
                  {editedSettings.rehearsalDates.map((date, index) => (
                    <input
                      key={index}
                      type="date"
                      value={date}
                      onChange={(e) => {
                        const updatedDates = [...(editedSettings.rehearsalDates || [])];
                        updatedDates[index] = e.target.value;
                        setEditedSettings({ ...editedSettings, rehearsalDates: updatedDates });
                      }}
                      className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
                    />
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  日付の追加・削除はできません
                </p>
              </div>
            )}
          </div>

          <div className="border-t border-gray-700 pt-6">
            {/* リハーサル時間 */}
            {editedSettings.rehearsalType !== 'none' && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-white mb-2">
                  リハーサル時間（分）
                </label>
                <input
                  type="number"
                  value={editedSettings.rehearsalDuration || 0}
                  onChange={(e) => handleRehearsalDurationChange(Number(e.target.value))}
                  min="1"
                  max="120"
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
                />
                <p className="text-xs text-gray-400 mt-1">
                  全バンド共通のリハーサル時間を設定します
                </p>
              </div>
            )}

            {/* プリセット演奏時間 */}
            <div>
              <label className="block text-sm font-medium text-white mb-2">
                演奏時間プリセット（分）
              </label>
              <div className="space-y-2">
                {editedSettings.presetDurations.map((duration, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="number"
                      value={duration}
                      onChange={(e) => handlePresetDurationChange(index, Number(e.target.value))}
                      min="1"
                      max="60"
                      className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
                    />
                    <button
                      onClick={() => handlePresetDurationRemove(index)}
                      className="px-3 py-2 bg-red-600 hover:bg-red-700 rounded text-white transition-colors"
                      title="削除"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  onClick={handlePresetDurationAdd}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-700 rounded text-white transition-colors"
                >
                  + プリセットを追加
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                バンド管理モードで演奏時間を設定する際のプリセット値です
              </p>
            </div>
          </div>

          {/* アクションボタン */}
          <div className="flex gap-3 justify-end pt-4 border-t border-gray-700">
            <button
              onClick={onClose}
              className="px-6 py-2 bg-gray-600 hover:bg-gray-700 rounded transition-colors"
            >
              キャンセル
            </button>
            <button
              onClick={handleSave}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded transition-colors"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
