import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
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
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const memberInputRef = useRef<HTMLInputElement>(null);
  const searchQueryRef = useRef(''); // Tab選択中も元の検索文字列を保持
  const [suggestionsStyle, setSuggestionsStyle] = useState<{ top?: number; bottom?: number; left: number; width: number }>({ left: 0, width: 0 });

  // サジェストの位置を計算
  const updateSuggestionsPosition = useCallback(() => {
    if (memberInputRef.current) {
      const rect = memberInputRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      // 下に十分なスペースがない場合は上に表示
      if (spaceBelow < 200) {
        setSuggestionsStyle({
          bottom: window.innerHeight - rect.top + 4,
          left: rect.left,
          width: rect.width,
        });
      } else {
        setSuggestionsStyle({
          top: rect.bottom + 4,
          left: rect.left,
          width: rect.width,
        });
      }
    }
  }, []);

  // ひらがな⇔カタカナ変換ヘルパー
  const toKatakana = (str: string) => str.replace(/[\u3041-\u3096]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0x60));
  const toHiragana = (str: string) => str.replace(/[\u30A1-\u30F6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));

  // メンバーのサジェスト候補をフィルタリング（最大10件）
  // ひらがな・カタカナ両方でマッチ
  const memberSuggestions = useMemo(() => {
    const query = searchQueryRef.current || memberInput;
    if (!query.trim()) return [];
    const inputLower = query.toLowerCase();
    const inputKata = toKatakana(inputLower);
    const inputHira = toHiragana(inputLower);
    return allMembers
      .filter(member => {
        if (band.members.includes(member)) return false;
        const memberLower = member.toLowerCase();
        const memberKata = toKatakana(memberLower);
        const memberHira = toHiragana(memberLower);
        return memberLower.includes(inputLower)
          || memberKata.includes(inputKata)
          || memberHira.includes(inputHira);
      })
      .slice(0, 10);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberInput, allMembers, band.members]);

  // スクロール時にサジェスト位置を更新
  useEffect(() => {
    if (!showMemberSuggestions || memberSuggestions.length === 0) return;
    const handleScrollOrResize = () => updateSuggestionsPosition();
    // 親のスクロールコンテナとwindow両方を監視
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [showMemberSuggestions, memberSuggestions.length, updateSuggestionsPosition]);

  // メンバーを追加
  const handleAddMember = (memberName: string) => {
    if (memberName.trim() && !band.members.includes(memberName.trim())) {
      onUpdate({ members: [...band.members, memberName.trim()] });
      setMemberInput('');
      searchQueryRef.current = '';
      setShowMemberSuggestions(false);
      setSelectedSuggestionIndex(-1);
    }
  };

  // メンバーを削除
  const handleRemoveMember = (memberName: string) => {
    onUpdate({ members: band.members.filter(m => m !== memberName) });
  };

  return (
    <tr className="hover:bg-emerald-50 transition-colors">
      <td className="px-4 py-3 text-sm text-gray-500">{index + 1}</td>
      
      {/* バンド名 */}
      <td className="px-4 py-3">
        <input
          type="text"
          value={band.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          placeholder="バンド名を入力"
          className="w-full bg-white text-gray-900 px-3 py-2 rounded border border-gray-300 focus:border-emerald-500 focus:outline-none"
        />
      </td>

      {/* 演奏時間 */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={band.performanceDuration}
            onChange={(e) => onUpdate({ performanceDuration: parseInt(e.target.value) || 0 })}
            className="w-20 bg-white text-gray-900 px-3 py-2 rounded border border-gray-300 focus:border-emerald-500 focus:outline-none"
            min="0"
          />
          <span className="text-gray-500 text-sm">分</span>
        </div>
        {/* プリセットボタン */}
        <div className="flex gap-1 mt-2">
          {presetDurations.map(duration => (
            <button
              key={duration}
              onClick={() => onUpdate({ performanceDuration: duration })}
              className="px-2 py-1 text-xs bg-emerald-100 hover:bg-emerald-200 text-emerald-700 rounded transition-colors"
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
          className="w-16 bg-white text-gray-900 px-3 py-2 rounded border border-gray-300 focus:border-emerald-500 focus:outline-none"
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
                className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-500 text-white text-sm rounded"
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
              ref={memberInputRef}
              type="text"
              value={memberInput}
              onChange={(e) => {
                setMemberInput(e.target.value);
                searchQueryRef.current = e.target.value;
                setShowMemberSuggestions(true);
                setSelectedSuggestionIndex(-1);
                updateSuggestionsPosition();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Tab' && !e.shiftKey && showMemberSuggestions && memberSuggestions.length > 0) {
                  e.preventDefault();
                  setSelectedSuggestionIndex(prev => {
                    const next = (prev + 1) % memberSuggestions.length;
                    setMemberInput(memberSuggestions[next]);
                    return next;
                  });
                } else if (e.key === 'Tab' && e.shiftKey && showMemberSuggestions && memberSuggestions.length > 0) {
                  e.preventDefault();
                  setSelectedSuggestionIndex(prev => {
                    const next = prev > 0 ? prev - 1 : memberSuggestions.length - 1;
                    setMemberInput(memberSuggestions[next]);
                    return next;
                  });
                } else if (e.key === 'ArrowDown' && showMemberSuggestions && memberSuggestions.length > 0) {
                  e.preventDefault();
                  setSelectedSuggestionIndex(prev => {
                    const next = prev < memberSuggestions.length - 1 ? prev + 1 : 0;
                    setMemberInput(memberSuggestions[next]);
                    return next;
                  });
                } else if (e.key === 'ArrowUp' && showMemberSuggestions && memberSuggestions.length > 0) {
                  e.preventDefault();
                  setSelectedSuggestionIndex(prev => {
                    const next = prev > 0 ? prev - 1 : memberSuggestions.length - 1;
                    setMemberInput(memberSuggestions[next]);
                    return next;
                  });
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddMember(memberInput);
                } else if (e.key === 'Escape') {
                  setShowMemberSuggestions(false);
                  setSelectedSuggestionIndex(-1);
                }
              }}
              onBlur={() => {
                // 少し遅延させてクリックイベントを拾えるようにする
                setTimeout(() => setShowMemberSuggestions(false), 300);
              }}
              onFocus={() => {
                setShowMemberSuggestions(true);
                setSelectedSuggestionIndex(-1);
                updateSuggestionsPosition();
              }}
              placeholder="メンバーを追加..."
              className="w-full bg-white text-gray-900 px-3 py-2 rounded border border-gray-300 focus:border-emerald-500 focus:outline-none text-sm"
            />
            {/* サジェスト候補 */}
            {showMemberSuggestions && memberSuggestions.length > 0 && (
              <div
                className="fixed z-50 bg-white border border-gray-300 rounded shadow-lg max-h-40 overflow-y-auto"
                style={{
                  ...(suggestionsStyle.top !== undefined ? { top: suggestionsStyle.top } : {}),
                  ...(suggestionsStyle.bottom !== undefined ? { bottom: suggestionsStyle.bottom } : {}),
                  left: suggestionsStyle.left,
                  width: suggestionsStyle.width,
                }}
              >
                {memberSuggestions.map((member, idx) => (
                  <button
                    key={member}
                    ref={el => {
                      if (idx === selectedSuggestionIndex && el) {
                        el.scrollIntoView({ block: 'nearest' });
                      }
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault(); // onBlurより先に実行されるようにする
                      handleAddMember(member);
                    }}
                    className={`w-full text-left px-3 py-2 text-gray-900 text-sm transition-colors ${
                      idx === selectedSuggestionIndex ? 'bg-emerald-500 text-white' : 'hover:bg-gray-100'
                    }`}
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
          className="px-3 py-2 bg-emerald-100 hover:bg-emerald-200 text-emerald-700 text-sm rounded transition-colors whitespace-nowrap"
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
          className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded transition-colors whitespace-nowrap"
        >
          削除
        </button>
      </td>
    </tr>
  );
};
