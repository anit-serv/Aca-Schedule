import { useState, useRef, useEffect, useMemo } from 'react';
import type { Band } from '../types';

interface TimetableSearchProps {
  bands: Band[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export const TimetableSearch = ({ bands, searchQuery, onSearchChange }: TimetableSearchProps) => {
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 検索候補を生成
  const suggestions = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    const results: { type: 'band' | 'member'; label: string; bandName?: string }[] = [];

    bands.forEach((band) => {
      // バンド名マッチ
      if (band.name.toLowerCase().includes(query)) {
        results.push({ type: 'band', label: band.name });
      }
      // メンバー名マッチ
      band.members.forEach((member) => {
        if (member.toLowerCase().includes(query)) {
          results.push({ type: 'member', label: member, bandName: band.name });
        }
      });
    });

    // 重複除去
    const seen = new Set<string>();
    return results.filter((r) => {
      const key = `${r.type}-${r.label}-${r.bandName || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 8);
  }, [searchQuery, bands]);

  // Escキーでクリア
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && searchQuery) {
        onSearchChange('');
        inputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchQuery, onSearchChange]);

  return (
    <div className="relative">
      <div className={`flex items-center gap-2 bg-white border rounded-lg px-3 py-1.5 transition-colors ${
        isFocused ? 'border-emerald-400 ring-1 ring-emerald-200' : 'border-gray-300'
      }`}>
        {/* 検索アイコン */}
        <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setTimeout(() => setIsFocused(false), 200)}
          placeholder="バンド名・メンバー名で検索"
          className="bg-transparent outline-none text-sm text-gray-900 placeholder-gray-400 w-full sm:w-40"
        />
        {searchQuery && (
          <button
            onClick={() => onSearchChange('')}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* サジェスト */}
      {isFocused && suggestions.length > 0 && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto">
          {suggestions.map((s, idx) => (
            <button
              key={idx}
              className="w-full text-left px-3 py-2 text-sm hover:bg-emerald-50 transition-colors flex items-center gap-2"
              onMouseDown={(e) => {
                e.preventDefault();
                onSearchChange(s.label);
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
              {s.bandName && (
                <span className="text-xs text-gray-400 ml-auto">{s.bandName}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
