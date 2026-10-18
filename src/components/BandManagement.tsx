import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Band, BandUndoMeta, EventSettings, Timetable } from '../types';
import { useBandManagement } from '../hooks/useBandManagement';
import { BandAvailabilityModal } from './BandAvailabilityModal';
import { BandImportCSV } from './BandImportCSV';
import { Icon } from './Icon';

interface BandManagementProps {
  initialScrollPosition?: { top: number; left: number };
  onScrollPositionChange?: (position: { top: number; left: number }) => void;
  bands: Band[];
  eventSettings: EventSettings;
  performanceTimetable: Timetable | null;
  rehearsalTimetable: Timetable | null;
  onBandsChange: (bands: Band[]) => void;
  onUndoRecord?: (meta: BandUndoMeta) => void;
}

const inputClass = 'mt-2 w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-emerald-500 focus:outline-none';
const normalizeSearch = (value: string) => value.toLocaleLowerCase().replace(/[\u3041-\u3096]/g, char => String.fromCharCode(char.charCodeAt(0) + 0x60));

export const BandManagement = ({ initialScrollPosition, onScrollPositionChange, bands, eventSettings, performanceTimetable, rehearsalTimetable, onBandsChange, onUndoRecord }: BandManagementProps) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [memberInput, setMemberInput] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [showMemberSuggestions, setShowMemberSuggestions] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const [showAvailability, setShowAvailability] = useState(false);
  const [focusNewId, setFocusNewId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const restoredRef = useRef(false);
  const { handleAddBand, handleDeleteBand, handleUpdateBand, allMembers } = useBandManagement(bands, eventSettings, onBandsChange, onUndoRecord);
  const band = bands.find(item => item.id === selectedId) ?? bands[0] ?? null;
  const filtered = useMemo(() => bands.filter(item => `${item.name} ${item.members.join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [bands, query]);
  const memberChoices = useMemo(() => [...new Set([...allMembers, ...(eventSettings.customFields?.members ?? [])])].sort((a, b) => a.localeCompare(b, 'ja')), [allMembers, eventSettings.customFields?.members]);
  const memberSuggestions = useMemo(() => {
    const search = normalizeSearch(memberInput.trim());
    if (!search) return [];
    return memberChoices.filter(name => !band?.members.includes(name) && normalizeSearch(name).includes(search))
      .sort((a, b) => Number(normalizeSearch(b).startsWith(search)) - Number(normalizeSearch(a).startsWith(search)))
      .slice(0, 8);
  }, [memberChoices, band?.members, memberInput]);

  useLayoutEffect(() => {
    if (restoredRef.current || !scrollRef.current) return;
    if ((initialScrollPosition?.top ?? 0) > 0 && bands.length === 0) return;
    scrollRef.current.scrollTop = initialScrollPosition?.top ?? 0;
    scrollRef.current.scrollLeft = initialScrollPosition?.left ?? 0;
    restoredRef.current = true;
  }, [bands.length, initialScrollPosition]);
  useEffect(() => {
    if (focusNewId !== band?.id || !nameRef.current) return;
    nameRef.current.focus();
    nameRef.current.select();
    setFocusNewId(null);
  }, [focusNewId, band?.id]);
  useEffect(() => {
    if (!editingTitle) return;
    titleRef.current?.focus();
    titleRef.current?.select();
  }, [editingTitle]);
  const addBand = useCallback(async () => {
    const id = await handleAddBand();
    if (id) { setSelectedId(id); setFocusNewId(id); setEditingTitle(false); setQuery(''); setMemberInput(''); }
  }, [handleAddBand]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.key.toLowerCase() !== 'n') return;
      const target = event.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
      event.preventDefault();
      void addBand();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [addBand]);
  const update = (changes: Partial<Band>) => { if (band) void handleUpdateBand(band.id, changes); };
  const addMember = (candidate?: string) => {
    if (!band) return;
    const name = (candidate ?? memberInput).trim();
    if (name && !band.members.includes(name)) update({ members: [...band.members, name] });
    setMemberInput('');
    setShowMemberSuggestions(false);
    setSuggestionIndex(-1);
  };
  const deleteBand = () => {
    if (!band || !confirm(`「${band.name || '名称未設定のバンド'}」を削除しますか？`)) return;
    setSelectedId(bands.find(item => item.id !== band.id)?.id ?? null);
    void handleDeleteBand(band.id);
  };
  const commitTitle = () => {
    if (band && titleDraft !== band.name) update({ name: titleDraft });
    setEditingTitle(false);
  };

  return <div ref={scrollRef} onScroll={event => {
    if (restoredRef.current) onScrollPositionChange?.({ top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft });
  }} className="h-full overflow-y-auto bg-gray-50 p-3 pb-24 text-gray-900 sm:p-6 sm:pb-6">
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-xl font-bold">バンド管理</h2><p className="mt-1 text-sm text-gray-600">バンドを選び、出演情報やメンバー、出演可能時間を編集できます。</p></div>
        <div className="flex flex-wrap items-center gap-2"><BandImportCSV eventSettings={eventSettings} onImportComplete={() => {}} /><details className="relative text-sm"><summary aria-label="CSVインポートの注意点" className="cursor-pointer list-none rounded p-2 text-gray-500 hover:bg-gray-100"><Icon name="info" className="text-xl" /></summary><div className="absolute right-0 top-full z-30 mt-1 w-72 rounded border border-gray-200 bg-white p-3 text-xs text-gray-600 shadow-lg">CSVはUTF-8形式で保存してください。テンプレートのヘッダーを使い、複数のメンバーはセミコロン（;）で区切ります。</div></details></div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
          <button type="button" onClick={() => void addBand()} className="mb-3 w-full rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700">+ バンドを追加</button>
          <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="バンド名・メンバー名で検索" aria-label="バンドを検索" className={inputClass} />
          <p className="mt-2 text-xs text-gray-500">{filtered.length}組</p>
          <div className="mt-2 max-h-64 space-y-1 overflow-y-auto lg:max-h-[calc(100vh-310px)]">
            {filtered.map(item => <button type="button" key={item.id} onClick={() => { setSelectedId(item.id); setMemberInput(''); setEditingTitle(false); }} className={`flex w-full items-center justify-between gap-2 rounded px-3 py-2 text-left text-sm ${band?.id === item.id ? 'bg-emerald-100 text-emerald-800' : 'hover:bg-gray-100'}`}><span className="min-w-0 truncate">{item.name || '名称未設定のバンド'}</span><span className="shrink-0 text-xs text-gray-500">{item.performanceDuration}分 · {item.performanceCount || 1}回</span></button>)}
            {!filtered.length && <p className="p-2 text-xs text-gray-500">該当するバンドがありません</p>}
          </div>
        </aside>
        <section className="min-w-0 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
          {!band ? <p className="text-sm text-gray-500">バンドがありません。左のボタンから追加してください。</p> : <>
            <div className="flex flex-wrap items-center justify-between gap-2"><div className="min-w-0 flex-1">{editingTitle ? <input ref={titleRef} value={titleDraft} onChange={event => setTitleDraft(event.target.value)} onBlur={commitTitle} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); else if (event.key === 'Escape') setEditingTitle(false); }} aria-label="表示中のバンド名を編集" className="w-full max-w-lg rounded border border-emerald-400 px-2 py-1 text-lg font-semibold outline-none" /> : <button type="button" onClick={() => { setTitleDraft(band.name); setEditingTitle(true); }} aria-label="バンド名を直接編集" className="group flex max-w-full items-center gap-2 rounded text-left text-lg font-semibold hover:text-emerald-700"><span className="truncate">{band.name || '名称未設定のバンド'}</span><Icon name="edit" className="text-base text-gray-400 group-hover:text-emerald-600" /></button>}<p className="text-xs text-gray-500">{band.members.length}人 · {band.performanceCount || 1}回出演</p></div><button type="button" onClick={deleteBand} aria-label={`${band.name || '名称未設定のバンド'}を削除`} className="inline-flex items-center gap-1 rounded px-2 py-1 text-sm text-red-600 hover:bg-red-50"><Icon name="delete" />削除</button></div>
            <div className="mt-5 grid gap-4 border-t pt-4 sm:grid-cols-2">
              <label className="text-sm font-semibold">バンド名<input ref={nameRef} type="text" value={band.name} onChange={event => update({ name: event.target.value })} placeholder="バンド名を入力" className={inputClass} /></label>
              <label className="text-sm font-semibold">バンドマスター<input type="text" value={band.bandMaster ?? ''} onChange={event => update({ bandMaster: event.target.value })} maxLength={100} className={inputClass} /></label>
              <div><label htmlFor="band-duration" className="text-sm font-semibold">演奏時間</label><div className="flex items-center gap-2"><input id="band-duration" type="number" min="0" value={band.performanceDuration} onChange={event => update({ performanceDuration: parseInt(event.target.value, 10) || 0 })} className={`${inputClass} max-w-28`} /><span className="mt-2 text-sm text-gray-500">分</span></div><div className="mt-2 flex flex-wrap gap-1">{eventSettings.presetDurations.map(value => <button type="button" key={value} onClick={() => update({ performanceDuration: value })} className={`rounded px-2 py-1 text-xs ${band.performanceDuration === value ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}>{value}分</button>)}</div></div>
              <label className="block text-sm font-semibold">出演回数<input type="number" min="1" value={band.performanceCount || 1} onChange={event => update({ performanceCount: parseInt(event.target.value, 10) || 1 })} className={`${inputClass} block max-w-28`} /></label>
              <div><div className="flex items-center gap-1"><label htmlFor="band-tori-priority" className="text-sm font-semibold">トリ優先度</label><div className="group relative"><button type="button" aria-label="トリ優先度の説明" aria-describedby="band-tori-priority-help" className="flex rounded text-gray-500 hover:text-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500"><Icon name="info" className="text-base" /></button><div id="band-tori-priority-help" role="tooltip" className="pointer-events-none absolute bottom-full left-0 z-30 mb-2 hidden w-72 rounded-lg border border-gray-200 bg-white p-3 text-xs font-normal leading-relaxed text-gray-700 shadow-lg group-hover:block group-focus-within:block"><p>自動配置での出演順の希望です。</p><p className="mt-1">1：指定なし（初期値）</p><p>2：いずれかのクールの最後を優先</p><p>3：最終日の最後のクールを優先</p></div></div></div><select id="band-tori-priority" value={band.toriPriority ?? 1} onChange={event => update({ toriPriority: Number(event.target.value) as 1 | 2 | 3 })} className={inputClass}><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></div>
              <label className="mt-2 flex items-center gap-2 self-end rounded bg-gray-50 px-3 py-2 text-sm font-semibold"><input type="checkbox" checked={band.costume ?? false} onChange={event => update({ costume: event.target.checked })} className="h-4 w-4 accent-emerald-600" />衣装あり</label>
            </div>
            <div className="mt-5 border-t pt-4"><h4 className="text-sm font-semibold">メンバー（{band.members.length}人）</h4><div className="mt-2 flex flex-wrap gap-1">{band.members.map(member => <span key={member} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs text-emerald-800">{member}<button type="button" onClick={() => update({ members: band.members.filter(name => name !== member) })} aria-label={`${member}を削除`} className="text-emerald-500 hover:text-red-600">×</button></span>)}</div>
              <div className="mt-3 flex max-w-md items-start gap-2">
                <div className="relative min-w-0 flex-1">
                  <input type="text" value={memberInput} onChange={event => { setMemberInput(event.target.value); setShowMemberSuggestions(true); setSuggestionIndex(-1); }} onFocus={() => setShowMemberSuggestions(true)} onBlur={() => setShowMemberSuggestions(false)} onKeyDown={event => {
                    if (event.key === 'ArrowDown' && memberSuggestions.length) { event.preventDefault(); setSuggestionIndex(index => (index + 1) % memberSuggestions.length); }
                    else if (event.key === 'ArrowUp' && memberSuggestions.length) { event.preventDefault(); setSuggestionIndex(index => index <= 0 ? memberSuggestions.length - 1 : index - 1); }
                    else if (event.key === 'Enter') { event.preventDefault(); addMember(suggestionIndex >= 0 ? memberSuggestions[suggestionIndex] : undefined); }
                    else if (event.key === 'Escape') { setShowMemberSuggestions(false); setSuggestionIndex(-1); }
                  }} role="combobox" aria-autocomplete="list" aria-expanded={showMemberSuggestions && memberSuggestions.length > 0} aria-controls="band-member-suggestions" placeholder="メンバー名を入力" aria-label="追加するメンバー名" className={`${inputClass} mt-0`} />
                  {showMemberSuggestions && memberSuggestions.length > 0 && <div id="band-member-suggestions" role="listbox" aria-label="メンバー候補" className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                    {memberSuggestions.map((name, index) => <button type="button" role="option" aria-selected={suggestionIndex === index} key={name} onMouseDown={event => event.preventDefault()} onClick={() => addMember(name)} className={`block w-full px-3 py-2 text-left text-sm ${suggestionIndex === index ? 'bg-emerald-100 text-emerald-900' : 'text-gray-800 hover:bg-emerald-50'}`}>{name}</button>)}
                  </div>}
                </div>
                <button type="button" onClick={() => addMember()} disabled={!memberInput.trim()} className="shrink-0 rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-700 disabled:opacity-40">追加</button>
              </div>
            </div>
            <div className="mt-5 border-t pt-4"><h4 className="text-sm font-semibold">出演可能時間帯</h4><p className="mt-1 text-xs text-gray-500">未選択の日は出演不可です。</p><button type="button" onClick={() => setShowAvailability(true)} className="mt-3 rounded border border-emerald-300 px-3 py-2 text-sm text-emerald-700 hover:bg-emerald-50">時間帯を編集</button><p className="mt-2 text-xs text-gray-600">通常 {band.availableTimeSlots.reduce((sum, day) => sum + day.timeRanges.length, 0)}範囲 · 予備リハ {(band.backupRehearsalTimeSlots ?? []).reduce((sum, day) => sum + day.timeRanges.length, 0)}範囲</p></div>
          </>}
        </section>
      </div>
    </div>
    {showAvailability && band && <BandAvailabilityModal key={band.id} band={band} eventSettings={eventSettings} performanceTimetable={performanceTimetable} rehearsalTimetable={rehearsalTimetable} onClose={() => setShowAvailability(false)} onUpdate={(availableTimeSlots, backupRehearsalTimeSlots) => { update({ availableTimeSlots, backupRehearsalTimeSlots }); setShowAvailability(false); }} />}
  </div>;
};
