import { useState, useRef, useMemo } from 'react';
import type { Band } from '../types';
import { getTimetableSearchSuggestions } from '../utils/timetableSearch';
import { Icon } from './Icon';

interface TimetableSearchProps {
  bands: Band[];
  searchQuery: string;
  matchCount: number;
  matchNumber: number;
  onSearchChange: (query: string) => void;
  onSelectBand: (bandId: string) => void;
  onSelectMember: (memberName: string) => void;
  onNextMatch: () => void;
  onPreviousMatch: () => void;
}

export const TimetableSearch = ({ bands, searchQuery, matchCount, matchNumber, onSearchChange, onSelectBand, onSelectMember, onNextMatch, onPreviousMatch }: TimetableSearchProps) => {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 検索候補を生成
  const suggestions = useMemo(() => getTimetableSearchSuggestions(bands, searchQuery), [bands, searchQuery]);

  return (
    <div className="relative w-[256px] flex-none">
      <div className={`flex items-center gap-1 bg-white border rounded-lg px-2 py-1.5 transition-colors ${
        showSuggestions ? 'border-emerald-400 ring-1 ring-emerald-200' : 'border-gray-300'
      }`}>
        {/* 検索アイコン */}
        <Icon name="search" className="text-base text-gray-400 flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => {
            onSearchChange(e.target.value);
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              onSearchChange('');
              setShowSuggestions(false);
              inputRef.current?.blur();
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (e.shiftKey) onPreviousMatch();
              else onNextMatch();
              setShowSuggestions(false);
            }
          }}
          placeholder="バンド名・メンバー名で検索"
          className="min-w-0 w-0 flex-1 bg-transparent outline-none text-sm text-gray-900 placeholder-gray-400"
        />
        {searchQuery && (
          <>
            <span className="flex-shrink-0 whitespace-nowrap text-xs tabular-nums text-gray-600" aria-live="polite">{matchNumber} / {matchCount}</span>
            <span className="h-6 w-px flex-shrink-0 bg-gray-200" aria-hidden="true" />
            <button type="button" aria-label="前の検索結果" title="前の検索結果 (Shift+Enter)" disabled={matchCount === 0} onMouseDown={e => e.preventDefault()} onClick={() => { onPreviousMatch(); setShowSuggestions(false); }} className="flex-shrink-0 rounded p-0.5 text-gray-600 hover:bg-gray-100 disabled:opacity-40"><Icon name="keyboard_arrow_up" className="text-xl" /></button>
            <button type="button" aria-label="次の検索結果" title="次の検索結果 (Enter)" disabled={matchCount === 0} onMouseDown={e => e.preventDefault()} onClick={() => { onNextMatch(); setShowSuggestions(false); }} className="flex-shrink-0 rounded p-0.5 text-gray-600 hover:bg-gray-100 disabled:opacity-40"><Icon name="keyboard_arrow_down" className="text-xl" /></button>
            <button type="button" aria-label="検索を閉じる" onMouseDown={e => e.preventDefault()} onClick={() => { onSearchChange(''); setShowSuggestions(false); inputRef.current?.blur(); }} className="flex-shrink-0 rounded p-0.5 text-gray-600 hover:bg-gray-100"><Icon name="close" className="text-xl" /></button>
          </>
        )}
      </div>

      {/* サジェスト */}
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute top-full left-0 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto">
          {suggestions.map((s, idx) => (
            <button
              key={idx}
              className="w-full text-left px-3 py-2 text-sm hover:bg-emerald-50 transition-colors flex items-center gap-2"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (s.type === 'member') onSelectMember(s.label);
                else onSelectBand(s.bandId);
                setShowSuggestions(false);
              }}
            >
              <span className={`text-xs px-1.5 py-0.5 rounded ${
                s.type === 'band'
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-gray-100 text-gray-600'
              }`}>
                {s.type === 'band' ? 'バンド' : 'メンバー'}
              </span>
              <span className="text-gray-900">{s.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
