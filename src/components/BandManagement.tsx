import { useState, useMemo } from 'react';
import type { Band, EventSettings } from '../types';
import { bandService } from '../services/firestore';

interface BandManagementProps {
  bands: Band[];
  eventSettings: EventSettings;
  onBandsChange: (bands: Band[]) => void;
}

export const BandManagement = ({ bands, eventSettings, onBandsChange }: BandManagementProps) => {
  const [selectedBandId, setSelectedBandId] = useState<string | null>(null);
  const [showAvailabilityModal, setShowAvailabilityModal] = useState(false);

  // 新しいバンドを追加
  const handleAddBand = async () => {
    const newBand: Band = {
      id: crypto.randomUUID(),
      name: '',
      performanceDuration: eventSettings.presetDurations[0] || 10,
      performanceCount: 1,
      members: [],
      availableTimeSlots: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    // Firestoreに追加
    try {
      await bandService.addBand(newBand, eventSettings.id);
      // onBandsChangeは自動的にFirestoreのリスナーから呼ばれる
    } catch (error) {
      console.error('バンド追加エラー:', error);
      alert('バンドの追加に失敗しました。');
    }
  };

  // バンドを削除
  const handleDeleteBand = async (id: string) => {
    if (confirm('このバンドを削除しますか?')) {
      try {
        await bandService.deleteBand(id);
        // onBandsChangeは自動的にFirestoreのリスナーから呼ばれる
      } catch (error) {
        console.error('バンド削除エラー:', error);
        alert('バンドの削除に失敗しました。');
      }
    }
  };

  // バンド情報を更新
  const handleUpdateBand = async (id: string, updates: Partial<Band>) => {
    // 楽観的更新（UIを即座に更新）
    onBandsChange(
      bands.map(band =>
        band.id === id
          ? { ...band, ...updates, updatedAt: new Date() }
          : band
      )
    );

    // Firestoreに保存
    try {
      await bandService.updateBand(id, updates);
    } catch (error) {
      console.error('バンド更新エラー:', error);
      alert('バンドの更新に失敗しました。');
    }
  };

  // メンバー入力用の全メンバーリスト（サジェスト用）
  const allMembers = useMemo(() => {
    const memberSet = new Set<string>();
    bands.forEach(band => {
      band.members.forEach(member => memberSet.add(member));
    });
    return Array.from(memberSet).sort();
  }, [bands]);

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">バンド管理</h2>
        <button
          onClick={handleAddBand}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium transition-colors"
        >
          + バンドを追加
        </button>
      </div>

      <div className="bg-gray-800 rounded-lg shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-700 sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-200 w-8">#</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-200 min-w-[200px]">バンド名</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-200 w-32">演奏時間</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-200 w-24">出演回数</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-200 min-w-[300px]">メンバー</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-200 w-32">出演可能時間帯</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-200 w-20">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {bands.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                    バンドが登録されていません。「+ バンドを追加」ボタンから登録してください。
                  </td>
                </tr>
              ) : (
                bands.map((band, index) => (
                  <BandRow
                    key={band.id}
                    band={band}
                    index={index}
                    presetDurations={eventSettings.presetDurations}
                    allMembers={allMembers}
                    performanceDates={eventSettings.performanceDates}
                    onUpdate={(updates) => handleUpdateBand(band.id, updates)}
                    onDelete={() => handleDeleteBand(band.id)}
                    onOpenAvailability={() => {
                      setSelectedBandId(band.id);
                      setShowAvailabilityModal(true);
                    }}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 出演可能時間帯設定モーダル */}
      {showAvailabilityModal && selectedBandId && (
        <AvailabilityModal
          band={bands.find(b => b.id === selectedBandId)!}
          performanceDates={eventSettings.performanceDates}
          onClose={() => {
            setShowAvailabilityModal(false);
            setSelectedBandId(null);
          }}
          onUpdate={(availableTimeSlots) => {
            handleUpdateBand(selectedBandId, { availableTimeSlots });
            setShowAvailabilityModal(false);
            setSelectedBandId(null);
          }}
        />
      )}
    </div>
  );
};

// バンドの1行を表すコンポーネント
interface BandRowProps {
  band: Band;
  index: number;
  presetDurations: number[];
  allMembers: string[];
  performanceDates: string[];
  onUpdate: (updates: Partial<Band>) => void;
  onDelete: () => void;
  onOpenAvailability: () => void;
}

const BandRow = ({
  band,
  index,
  presetDurations,
  allMembers,
  onUpdate,
  onDelete,
  onOpenAvailability,
}: BandRowProps) => {
  const [memberInput, setMemberInput] = useState('');
  const [showMemberSuggestions, setShowMemberSuggestions] = useState(false);

  // メンバーのサジェスト候補をフィルタリング
  const memberSuggestions = useMemo(() => {
    if (!memberInput.trim()) return [];
    return allMembers.filter(
      member =>
        member.toLowerCase().includes(memberInput.toLowerCase()) &&
        !band.members.includes(member)
    );
  }, [memberInput, allMembers, band.members]);

  // メンバーを追加
  const handleAddMember = (memberName: string) => {
    if (memberName.trim() && !band.members.includes(memberName.trim())) {
      onUpdate({ members: [...band.members, memberName.trim()] });
      setMemberInput('');
      setShowMemberSuggestions(false);
    }
  };

  // メンバーを削除
  const handleRemoveMember = (memberName: string) => {
    onUpdate({ members: band.members.filter(m => m !== memberName) });
  };

  return (
    <tr className="hover:bg-gray-750 transition-colors">
      <td className="px-4 py-3 text-sm text-gray-400">{index + 1}</td>
      
      {/* バンド名 */}
      <td className="px-4 py-3">
        <input
          type="text"
          value={band.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          placeholder="バンド名を入力"
          className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
        />
      </td>

      {/* 演奏時間 */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={band.performanceDuration}
            onChange={(e) => onUpdate({ performanceDuration: parseInt(e.target.value) || 0 })}
            className="w-20 bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
            min="0"
          />
          <span className="text-gray-400 text-sm">分</span>
        </div>
        {/* プリセットボタン */}
        <div className="flex gap-1 mt-2">
          {presetDurations.map(duration => (
            <button
              key={duration}
              onClick={() => onUpdate({ performanceDuration: duration })}
              className="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-500 text-gray-200 rounded transition-colors"
            >
              {duration}分
            </button>
          ))}
        </div>
      </td>

      {/* 出演回数 */}
      <td className="px-4 py-3">
        <input
          type="number"
          value={band.performanceCount}
          onChange={(e) => onUpdate({ performanceCount: parseInt(e.target.value) || 1 })}
          className="w-16 bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
          min="1"
        />
      </td>

      {/* メンバー */}
      <td className="px-4 py-3">
        <div className="space-y-2">
          {/* 既存メンバータグ */}
          <div className="flex flex-wrap gap-1">
            {band.members.map(member => (
              <span
                key={member}
                className="inline-flex items-center gap-1 px-2 py-1 bg-blue-600 text-white text-sm rounded"
              >
                {member}
                <button
                  onClick={() => handleRemoveMember(member)}
                  className="hover:text-red-300 transition-colors"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          {/* メンバー追加入力 */}
          <div className="relative">
            <input
              type="text"
              value={memberInput}
              onChange={(e) => {
                setMemberInput(e.target.value);
                setShowMemberSuggestions(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleAddMember(memberInput);
                }
              }}
              onBlur={() => {
                // 少し遅延させてクリックイベントを拾えるようにする
                setTimeout(() => setShowMemberSuggestions(false), 200);
              }}
              onFocus={() => setShowMemberSuggestions(true)}
              placeholder="メンバーを追加..."
              className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:border-blue-500 focus:outline-none text-sm"
            />
            {/* サジェスト候補 */}
            {showMemberSuggestions && memberSuggestions.length > 0 && (
              <div className="absolute z-20 w-full mt-1 bg-gray-700 border border-gray-600 rounded shadow-lg max-h-40 overflow-y-auto">
                {memberSuggestions.map(member => (
                  <button
                    key={member}
                    onClick={() => handleAddMember(member)}
                    className="w-full text-left px-3 py-2 hover:bg-gray-600 text-white text-sm transition-colors"
                  >
                    {member}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </td>

      {/* 出演可能時間帯 */}
      <td className="px-4 py-3">
        <button
          onClick={onOpenAvailability}
          className="px-3 py-2 bg-gray-600 hover:bg-gray-500 text-white text-sm rounded transition-colors"
        >
          {band.availableTimeSlots.length > 0
            ? `設定済み (${band.availableTimeSlots.length})`
            : '未設定'}
        </button>
      </td>

      {/* 操作 */}
      <td className="px-4 py-3">
        <button
          onClick={onDelete}
          className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded transition-colors"
        >
          削除
        </button>
      </td>
    </tr>
  );
};

// 出演可能時間帯設定モーダル
interface AvailabilityModalProps {
  band: Band;
  performanceDates: string[];
  onClose: () => void;
  onUpdate: (availableTimeSlots: Band['availableTimeSlots']) => void;
}

const AvailabilityModal = ({
  band,
  performanceDates,
  onClose,
  onUpdate,
}: AvailabilityModalProps) => {
  const [timeSlots, setTimeSlots] = useState(band.availableTimeSlots);

  // 日付ごとの時間帯を取得または初期化
  const getTimeSlotForDate = (date: string) => {
    return timeSlots.find(slot => slot.date === date) || {
      date,
      startTime: '10:00',
      endTime: '18:00',
    };
  };

  // 時間帯を更新
  const handleUpdateTimeSlot = (date: string, startTime: string, endTime: string) => {
    const existingIndex = timeSlots.findIndex(slot => slot.date === date);
    if (existingIndex >= 0) {
      const newSlots = [...timeSlots];
      newSlots[existingIndex] = { date, startTime, endTime };
      setTimeSlots(newSlots);
    } else {
      setTimeSlots([...timeSlots, { date, startTime, endTime }]);
    }
  };

  // 時間帯を削除（その日は出演不可にする）
  const handleRemoveTimeSlot = (date: string) => {
    setTimeSlots(timeSlots.filter(slot => slot.date !== date));
  };

  const handleSave = () => {
    onUpdate(timeSlots);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-gray-700">
          <h3 className="text-xl font-bold text-white">
            出演可能時間帯設定: {band.name || '(未設定)'}
          </h3>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1">
          <p className="text-gray-400 text-sm mb-4">
            各開催日について、このバンドが出演可能な時間帯を設定してください。
          </p>
          
          <div className="space-y-4">
            {performanceDates.map(date => {
              const dateObj = new Date(date);
              const formattedDate = `${dateObj.getMonth() + 1}/${dateObj.getDate()}`;
              const slot = getTimeSlotForDate(date);
              const isSet = timeSlots.some(s => s.date === date);

              return (
                <div key={date} className="bg-gray-700 p-4 rounded">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-semibold text-white">{formattedDate}</h4>
                    {isSet ? (
                      <button
                        onClick={() => handleRemoveTimeSlot(date)}
                        className="text-sm text-red-400 hover:text-red-300"
                      >
                        この日は出演不可にする
                      </button>
                    ) : (
                      <span className="text-sm text-gray-400">出演不可</span>
                    )}
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-gray-300">開始:</label>
                      <input
                        type="time"
                        value={slot.startTime}
                        onChange={(e) =>
                          handleUpdateTimeSlot(date, e.target.value, slot.endTime)
                        }
                        className="bg-gray-600 text-white px-3 py-2 rounded border border-gray-500 focus:border-blue-500 focus:outline-none"
                        disabled={!isSet}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-gray-300">終了:</label>
                      <input
                        type="time"
                        value={slot.endTime}
                        onChange={(e) =>
                          handleUpdateTimeSlot(date, slot.startTime, e.target.value)
                        }
                        className="bg-gray-600 text-white px-3 py-2 rounded border border-gray-500 focus:border-blue-500 focus:outline-none"
                        disabled={!isSet}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-700 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
};
