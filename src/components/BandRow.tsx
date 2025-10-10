import { useState, useMemo } from 'react';
import type { Band } from '../types';

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

export const BandRow = ({
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

  // メンバーのサジェスト候補をフィルタリング（最大10件）
  const memberSuggestions = useMemo(() => {
    if (!memberInput.trim()) return [];
    return allMembers
      .filter(
        member =>
          member.toLowerCase().includes(memberInput.toLowerCase()) &&
          !band.members.includes(member)
      )
      .slice(0, 10); // 最大10件まで表示
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
                setTimeout(() => setShowMemberSuggestions(false), 300);
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
                    onMouseDown={(e) => {
                      e.preventDefault(); // onBlurより先に実行されるようにする
                      handleAddMember(member);
                    }}
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
            ? `設定済み (${band.availableTimeSlots.reduce((sum, slot) => sum + slot.timeRanges.length, 0)}範囲)`
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
