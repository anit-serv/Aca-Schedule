import { useEffect, useMemo, useRef, useState } from 'react';
import type { Band, EventSettings, Timetable } from '../types';
import { getPublicSequenceValue } from '../utils/publicCustomFields';
import { getShiftSlotAt, getShiftSlots } from '../utils/customShift';
import { calculateBandNumbers } from '../utils/calculateBandNumbers';
import { buildScheduleCools, nextProgressBoundaryTime, shiftTime, toMinutes, validateProgressAdjustment, type ProgressAdjustmentError, type ScheduleCool, type ScheduleRow, type ScheduleType } from '../utils/stakeholderSchedule';
import { stakeholderProgressService, type StakeholderProgress } from '../services/stakeholderProgress';
import './StakeholderProgress.css';

type ViewState = 'input' | 'review' | 'applied';
const emptyProgress: StakeholderProgress = { version: 0, records: {}, history: [] };
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const icon = (name: string) => `/stakeholder-assets/${name}.svg`;
const Icon = ({ name }: { name: string }) => <img className="ui-icon" src={icon(name)} alt="" />;
const dateLabel = (value: string) => { const date = new Date(`${value}T12:00:00`); return `${date.getMonth() + 1}月${date.getDate()}日（${'日月火水木金土'[date.getDay()]}）`; };
const deltaLabel = (delta: number) => delta > 0 ? `+${delta}分` : delta < 0 ? `${delta}分` : '±0分';
const adjustmentErrorMessage = (code: ProgressAdjustmentError, earlyLimit: number) => {
  switch (code) {
    case 'EARLY_START_LIMIT': return `開始時刻の前倒しは転換時間の範囲（最大${earlyLimit}分）までです。`;
    case 'EARLY_END_LIMIT': return `終了時刻の前倒しは演奏時間の範囲（最大${earlyLimit}分）までです。`;
    case 'COOL_BOUNDARY': return 'この調整ではクールの最後が次のクール開始時刻に達します。責任者にタイムテーブル全体の変更を依頼してください。';
    case 'ENTRY_OVERLAP': return '前後の出演と時刻が重なります。調整量を小さくしてください。';
    case 'INVALID_TIME_ORDER': return '終了時刻は開始時刻以降にしてください。';
    default: return '出演枠が見つかりません。再読み込みしてください。';
  }
};

function CurrentClock() {
  const [currentTime, setCurrentTime] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setCurrentTime(new Date());
    const timer = window.setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, []);
  const label = currentTime.toLocaleTimeString('ja-JP', {
    timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  return <time className="current-clock" dateTime={currentTime.toISOString()} aria-label={`現在時刻 ${label} JST`}>{label}<small>JST</small></time>;
}

interface Props {
  eventId: string;
  password: string;
  settings: EventSettings;
  bands: Band[];
  performanceTimetable: Timetable | null;
  rehearsalTimetable: Timetable | null;
}

function statusFor(row: ScheduleRow, selected: boolean, preview: boolean, date: string, today: string, nowMinutes: number) {
  if (preview && row.affected) return `変更対象 ${deltaLabel(row.deltaMinutes)}`;
  if (row.affected) return `調整済 ${deltaLabel(row.deltaMinutes)}`;
  if (date === today) {
    if (toMinutes(row.predictedEnd) <= nowMinutes) return '時刻経過';
    if (toMinutes(row.predictedStart) <= nowMinutes) return '進行時間帯';
  }
  return selected ? '調整対象' : '予定どおり';
}

function ProgressTable({ cool, type, selectedId, preview, date, today, nowMinutes, bandNumbers, customColumns, customValue, onSelect }: {
  cool: ScheduleCool;
  type: ScheduleType;
  selectedId: string | undefined;
  preview: boolean;
  date: string;
  today: string;
  nowMinutes: number;
  bandNumbers: Map<string, number>;
  customColumns: NonNullable<EventSettings['customFields']>['performance']['columns'];
  customValue: (type: ScheduleType, coolIndex: number, row: ScheduleRow, columnId: string, bindingType: 'sequence' | 'entity') => string;
  onSelect: (type: ScheduleType, coolId: string, row: ScheduleRow) => void;
}) {
  const typeLabel = type === 'performance' ? '本番' : 'リハーサル';
  return <section className="table-card">
    <div className="cool-title"><h3>第{cool.number}クール・{typeLabel}</h3><span>{cool.startTime}開始 / {cool.rows.length}組{cool.boundaryWarning ? ' / 次クールの固定開始時刻を超過' : ''}</span></div>
    <div className="desktop-table desktop-scroll"><table style={{ minWidth: 790 + customColumns.length * 160 }}><thead><tr>
      <th>#</th><th>状態</th><th>バンド名</th>
      <th>{typeLabel}予定（固定）<small>開始 終了</small></th>
      <th className={preview ? 'preview-cell' : ''}>{preview ? '適用プレビュー' : '調整後見込み'}<small>開始 終了</small></th>
      <th>予定比</th>
      {customColumns.map(column => <th key={column.id}>{column.name}</th>)}
    </tr></thead><tbody>{cool.rows.map(row => {
      const selected = selectedId === row.id;
      return <tr key={row.id} id={`progress-desktop-${type}-${row.id}`} className={selected ? 'current-row' : ''} onClick={() => onSelect(type, cool.id, row)}>
        <td>{row.entry.type === 'band' ? bandNumbers.get(row.id) ?? '—' : '—'}</td>
        <td className={row.affected ? 'changed' : ''}>{statusFor(row, selected, preview, date, today, nowMinutes)}</td>
        <td><b>{row.name}</b></td>
        <td>{row.plannedStart} {row.plannedEnd}</td>
        <td className={preview && row.affected ? 'preview-cell' : ''}>{row.predictedStart} {row.predictedEnd}</td>
        <td>{row.affected ? deltaLabel(row.deltaMinutes) : '—'}</td>
        {customColumns.map(column => <td key={column.id}>{customValue(type, row.coolIndex, row, column.id, column.bindingType)}</td>)}
      </tr>;
    })}</tbody></table></div>
    <div className="mobile-table"><div className="split-head" style={{ width: 328 + customColumns.length * 120, gridTemplateColumns: `158px 170px ${customColumns.map(() => '120px').join(' ')}` }}><div>番号 / バンド / 状態</div><div>{typeLabel}予定 / 見込み</div>{customColumns.map(column => <div key={column.id}>{column.name}</div>)}</div>
      {cool.rows.map(row => {
        const selected = selectedId === row.id;
        return <div key={row.id} id={`progress-mobile-${type}-${row.id}`} className={`split-row ${selected ? 'current-row' : ''}`} style={{ width: 328 + customColumns.length * 120 }} onClick={() => onSelect(type, cool.id, row)}>
          <div className="fixed-columns"><div className="band-state"><b>{row.entry.type === 'band' ? `${bandNumbers.get(row.id) ?? '—'} · ` : ''}{row.name}</b><span className={row.affected ? 'changed' : ''}>{statusFor(row, selected, preview, date, today, nowMinutes)}</span></div>
            <div><span>予定 {row.plannedStart}–{row.plannedEnd}</span><b className={preview && row.affected ? 'preview-cell' : ''}>見込 {row.predictedStart}–{row.predictedEnd}</b><small>予定比 {row.affected ? deltaLabel(row.deltaMinutes) : '—'}{preview && row.affected ? ' · 未適用' : ''}</small></div></div>
          <div className="extra-columns" style={{ gridTemplateColumns: `repeat(${customColumns.length}, 120px)`, flexBasis: customColumns.length * 120 }}>{customColumns.map(column => <span key={column.id}>{customValue(type, row.coolIndex, row, column.id, column.bindingType)}</span>)}</div>
        </div>;
      })}{customColumns.length > 0 && <div className="scroll-indicator"><i /></div>}
    </div>
  </section>;
}

export function StakeholderProgressPage({ eventId, password, settings, bands, performanceTimetable, rehearsalTimetable }: Props) {
  const [progress, setProgress] = useState<StakeholderProgress>(emptyProgress);
  const [progressReady, setProgressReady] = useState(false);
  const [selectedDate, setSelectedDate] = useState(settings.performanceDates[0] || settings.rehearsalDates?.[0] || '');
  const [selectedType, setSelectedType] = useState<ScheduleType>('performance');
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [viewState, setViewState] = useState<ViewState>('input');
  const [field, setField] = useState<'start' | 'end'>('start');
  const [offsetInput, setOffsetInput] = useState<{ direction: 'late' | 'early'; minutes: number } | null>(null);
  const [query, setQuery] = useState('');
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => new Date());
  const initialRead = useRef(false);
  const viewStateRef = useRef(viewState);
  useEffect(() => { viewStateRef.current = viewState; }, [viewState]);

  useEffect(() => {
    let active = true;
    const read = async () => {
      try {
        const next = await stakeholderProgressService.read(eventId, password);
        if (active) { setProgress(currentProgress => next.version >= currentProgress.version ? next : currentProgress); setProgressReady(true); initialRead.current = true; }
      } catch (reason) { if (active) setError(reason instanceof Error ? reason.message : '進行状況を読み込めませんでした'); }
    };
    void read();
    const interval = window.setInterval(() => { if (initialRead.current && viewStateRef.current !== 'review') void read(); }, 15000);
    return () => { active = false; window.clearInterval(interval); };
  }, [eventId, password]);
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 30000); return () => window.clearInterval(timer); }, []);

  const dates = selectedType === 'rehearsal' && settings.rehearsalType === 'rehearsal-day'
    ? settings.rehearsalDates || [] : settings.performanceDates;
  const dayFor = (type: ScheduleType) => (type === 'performance' ? performanceTimetable : rehearsalTimetable)?.dailyTimetables.find(day => day.date === selectedDate);
  const savedSchedules = useMemo(() => {
    const make = (type: ScheduleType) => {
      const day = (type === 'performance' ? performanceTimetable : rehearsalTimetable)?.dailyTimetables.find(item => item.date === selectedDate);
      return day ? buildScheduleCools({ day, type, bands, rehearsalDuration: settings.rehearsalDuration || 0, records: progress.records }) : [];
    };
    return { performance: make('performance'), rehearsal: make('rehearsal') };
  }, [performanceTimetable, rehearsalTimetable, selectedDate, bands, settings.rehearsalDuration, progress.records]);
  const allSelectedRows = savedSchedules[selectedType].flatMap(cool => cool.rows.map(row => ({ type: selectedType, coolId: cool.id, row })));
  const today = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
  const nowParts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const nowMinutes = Number(nowParts.find(part => part.type === 'hour')?.value || 0) * 60 + Number(nowParts.find(part => part.type === 'minute')?.value || 0);
  const current = (selectedEntryId && allSelectedRows.find(item => item.row.id === selectedEntryId))
    || (selectedDate === today && allSelectedRows.find(item => toMinutes(item.row.predictedStart) <= nowMinutes && nowMinutes < toMinutes(item.row.predictedEnd)))
    || (selectedDate === today && allSelectedRows.find(item => toMinutes(item.row.predictedStart) > nowMinutes))
    || (selectedDate === today ? allSelectedRows.at(-1) : allSelectedRows[0]);
  const baseTime = current ? (field === 'start' ? current.row.plannedStart : current.row.plannedEnd) : '';
  const currentTime = current ? (field === 'start' ? current.row.predictedStart : current.row.predictedEnd) : '';
  const savedOffset = baseTime && currentTime ? toMinutes(currentTime) - toMinutes(baseTime) : 0;
  const offsetDirection = offsetInput?.direction || (savedOffset < 0 ? 'early' : 'late');
  const offset = offsetInput?.minutes ?? Math.abs(savedOffset);
  const candidateMinutes = baseTime ? toMinutes(baseTime) + (offsetDirection === 'late' ? offset : -offset) : -1;
  const candidateTime = candidateMinutes >= 0 && candidateMinutes < 1440 ? shiftTime('00:00', candidateMinutes) : '';
  const selectedCool = savedSchedules[selectedType].find(cool => cool.id === current?.coolId);
  const precedingPlannedEnd = current && selectedCool && current.row.order > 0
    ? selectedCool.rows[current.row.order - 1]?.plannedEnd : selectedCool?.startTime;
  const earlyLimit = current ? field === 'start'
    ? Math.max(0, toMinutes(current.row.plannedStart) - toMinutes(precedingPlannedEnd || current.row.plannedStart))
    : Math.max(0, toMinutes(current.row.plannedEnd) - toMinutes(current.row.plannedStart)) : 0;
  const candidate = current && timePattern.test(candidateTime) ? { entryId: current.row.id, field, actualTime: candidateTime } : undefined;
  const previewSchedules = useMemo(() => {
    if (viewState !== 'review' || !candidate) return savedSchedules;
    const day = dayFor(selectedType);
    if (!day) return savedSchedules;
    return { ...savedSchedules, [selectedType]: buildScheduleCools({ day, type: selectedType, bands, rehearsalDuration: settings.rehearsalDuration || 0, records: progress.records, candidate }) };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewState, candidateTime, field, current?.row.id, selectedType, savedSchedules, bands, settings.rehearsalDuration, progress.records]);
  const previewCurrent = current && previewSchedules[selectedType].flatMap(cool => cool.rows).find(row => row.id === current.row.id);
  const displayedSchedules = viewState === 'review' ? previewSchedules : savedSchedules;
  const coolPre = settings.rehearsalType === 'cool-pre-rehearsal';
  const displayGroups = coolPre ? Array.from({ length: Math.max(displayedSchedules.performance.length, displayedSchedules.rehearsal.length) }, (_, index) => [
    { type: 'rehearsal' as const, cool: displayedSchedules.rehearsal[index] },
    { type: 'performance' as const, cool: displayedSchedules.performance[index] },
  ]).flat().filter(item => item.cool) : displayedSchedules[selectedType].map(cool => ({ type: selectedType, cool }));
  const filteredGroups = displayGroups.map(item => ({ ...item, cool: { ...item.cool, rows: item.cool.rows.filter(row => row.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())) } }));
  const customColumns = (type: ScheduleType) => settings.customFields?.[type]?.columns?.slice().sort((a, b) => a.order - b.order) || [];
  const bandNumbers = useMemo(() => ({ performance: calculateBandNumbers(performanceTimetable), rehearsal: calculateBandNumbers(rehearsalTimetable) }), [performanceTimetable, rehearsalTimetable]);
  const customValue = (type: ScheduleType, coolIndex: number, row: ScheduleRow, columnId: string, bindingType: 'sequence' | 'entity') => {
    const column = settings.customFields?.[type]?.columns.find(item => item.id === columnId);
    const cool = savedSchedules[type][coolIndex];
    if (column?.shift && cool) {
      const index = cool.rows.findIndex(item => item.id === row.id);
      return getShiftSlotAt(getShiftSlots(column, selectedDate, cool.id, cool.rows.length), index)?.slot.assignee || '';
    }
    const daily = settings.customFields?.[type]?.dailyData?.[selectedDate];
    if (bindingType === 'entity') return daily?.byEntity?.[row.id]?.[columnId]?.value || '';
    const sequence = savedSchedules[type].slice(0, coolIndex).reduce((sum, cool) => sum + cool.rows.length, 0) + row.order + 1;
    return getPublicSequenceValue(daily, sequence, columnId);
  };
  const selectRow = (type: ScheduleType, _coolId: string, row: ScheduleRow) => {
    setSelectedType(type); setSelectedEntryId(row.id); setOffsetInput(null); setViewState('input'); setError('');
  };
  const changeType = (type: ScheduleType) => {
    setSelectedType(type); setSelectedEntryId(null); setOffsetInput(null); setField('start'); setViewState('input'); setError('');
    const nextDates = type === 'rehearsal' && settings.rehearsalType === 'rehearsal-day' ? settings.rehearsalDates || [] : settings.performanceDates;
    if (!nextDates.includes(selectedDate)) setSelectedDate(nextDates[0] || '');
  };
  const validateCandidate = () => {
    if (!progressReady) { setError('進行状況を読み込み中です。しばらくしてから再度お試しください。'); return false; }
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1439) { setError('ずれは0〜1439分で入力してください。'); return false; }
    if (!current || !candidate) { setError('調整する出演と同日内の時刻を指定してください。'); return false; }
    if (candidateTime === (field === 'start' ? current.row.predictedStart : current.row.predictedEnd)) { setError('見込みが変わらない場合、入力は不要です。'); return false; }
    if (field === 'end' && current.row.actualStart && candidateTime < current.row.actualStart) { setError('終了時刻は開始時刻より後にしてください。'); return false; }
    if (field === 'start' && current.row.actualEnd && candidateTime > current.row.actualEnd) { setError('開始時刻は終了時刻より前にしてください。'); return false; }
    const day = dayFor(selectedType);
    if (!day) { setError('タイムテーブルを読み込めませんでした。'); return false; }
    const linkedDay = dayFor(selectedType === 'performance' ? 'rehearsal' : 'performance');
    const constraint = validateProgressAdjustment({
      day, type: selectedType, bands, rehearsalDuration: settings.rehearsalDuration || 0,
      records: progress.records, coolId: current.coolId, entryId: current.row.id, field,
      actualTime: candidateTime,
      nextBoundaryTime: nextProgressBoundaryTime(day, selectedType, current.coolId, settings.rehearsalType, linkedDay),
    });
    if (constraint) { setError(adjustmentErrorMessage(constraint, earlyLimit)); return false; }
    setError(''); return true;
  };
  const apply = async () => {
    if (!validateCandidate() || !current) return;
    setBusy(true); setError('');
    try {
      const next = await stakeholderProgressService.apply({ eventId, password, timetableType: selectedType, date: selectedDate, coolId: current.coolId, entryId: current.row.id, field, actualTime: candidateTime, expectedVersion: progress.version });
      setProgress(next); setViewState('applied');
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : '';
      setError(code === 'STALE_PROGRESS' ? '他の関係者が更新しました。内容を再読み込みして確認してください。' :
        ['EARLY_START_LIMIT', 'EARLY_END_LIMIT', 'COOL_BOUNDARY', 'ENTRY_OVERLAP', 'INVALID_TIME_ORDER', 'ENTRY_NOT_FOUND'].includes(code)
          ? adjustmentErrorMessage(code as ProgressAdjustmentError, earlyLimit) : '保存に失敗しました。もう一度お試しください。');
      if (code === 'STALE_PROGRESS') { try { setProgress(await stakeholderProgressService.read(eventId, password)); } catch { /* 再試行時に表示 */ } setViewState('input'); }
    } finally { setBusy(false); }
  };
  const returnToCurrent = () => {
    if (!current) return;
    document.getElementById(`${window.innerWidth < 760 ? 'progress-mobile' : 'progress-desktop'}-${selectedType}-${current.row.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const activeCool = current && displayedSchedules[selectedType].find(cool => cool.id === current.coolId);
  const impactedRows = viewState === 'review' && activeCool ? activeCool.rows.filter(row => {
    const saved = savedSchedules[selectedType].flatMap(cool => cool.rows).find(item => item.id === row.id);
    return saved && (saved.predictedStart !== row.predictedStart || saved.predictedEnd !== row.predictedEnd);
  }) : [];

  return <div className="stakeholder-progress"><div className="app">
    <header className="site-header"><div className="brand-row"><div className="brand"><img src="/app-icon.svg" alt="" /><strong>Aca-Schedule</strong><span>関係者用</span></div><div className="account">閲覧・進行操作</div></div>
      <div className="event-row"><h1>{settings.name}</h1><div className="event-meta"><span className="venue">{settings.venue}</span><CurrentClock /></div></div>
      <div className="filters"><label><span className="sr-only">日付</span><select value={selectedDate} onChange={event => { setSelectedDate(event.target.value); setSelectedEntryId(null); setOffsetInput(null); setField('start'); setViewState('input'); }}>{dates.map(date => <option key={date} value={date}>{dateLabel(date)}</option>)}</select></label>
        <label><span className="sr-only">本番・リハーサル</span><select value={selectedType} onChange={event => changeType(event.target.value as ScheduleType)}><option value="performance">本番</option>{settings.rehearsalType !== 'none' && <option value="rehearsal">リハーサル</option>}</select></label><span>選択日の全クールを表示</span></div>
    </header>
    <main><div className="page-heading"><div><h2>現場進行管理</h2><span>{viewState === 'input' ? '入力前' : viewState === 'review' ? '調整内容の確認中' : '適用後'}</span></div><p>ずれがあった場合だけ入力してください。予定は固定し、見込みを更新します。</p></div>
      <div className="mobile-operation">{renderOperation()}</div>
      <div className="layout"><div className="timetable"><div className="table-heading"><div><h2>{selectedDate ? dateLabel(selectedDate) : ''} タイムテーブル</h2><span>{coolPre ? 'クール直前リハと本番' : selectedType === 'performance' ? '本番' : 'リハーサル'} / 全{displayGroups.length}セクション</span></div><b>{viewState === 'review' ? '適用プレビュー・未適用' : viewState === 'applied' ? '見込み更新済み' : '保存済みの時刻を表示'}</b></div>
        <div className="search-row"><input type="search" placeholder="バンド名で検索" value={query} onChange={event => setQuery(event.target.value)} /><button type="button" onClick={returnToCurrent}>現在の出演へ戻る</button><span>追加列は管理者のカスタム列を表示</span></div>
        {filteredGroups.map(({ type, cool }) => <ProgressTable key={`${type}-${cool.id}`} cool={cool} type={type} selectedId={selectedType === type ? current?.row.id : undefined} preview={viewState === 'review' && selectedType === type} date={selectedDate} today={today} nowMinutes={nowMinutes} bandNumbers={bandNumbers[type]} customColumns={customColumns(type)} customValue={customValue} onSelect={selectRow} />)}
        {filteredGroups.length === 0 && <div className="table-card" style={{ padding: 24 }}>この日付の配置はありません。</div>}
        <div className="legend"><span>進行時間帯：見込み時刻に基づく目安</span><span>変更対象：見込みを調整する出演</span><span>補正がなければ予定どおりとして表示</span></div>
        <p className="footnote">予定列は上書きしません。一般公開ページには適用済みの見込み時刻を表示します。</p>
      </div><div className="desktop-operation">{renderOperation()}</div></div>
    </main><footer>関係者限定・進行操作を履歴に記録</footer>
  </div></div>;

  function renderOperation() {
    return <aside className={`operation ${viewState}`}><div className="operation-title"><h2>進行操作</h2><span>{viewState === 'input' ? '未保存' : viewState === 'review' ? '未適用' : '保存済み'}</span></div>
      <div className="progress">{[['1', '入力'], ['2', '影響確認'], ['3', '適用']].map(([number, label], index) => <div key={number} className={viewState === (['input', 'review', 'applied'] as const)[index] ? 'active' : ''}><b>{number}</b><span>{label}</span>{index < 2 && <Icon name="6ae5f" />}</div>)}</div>
      {current ? <><div className="now-label"><Icon name="fe4f9" />{selectedType === 'performance' ? '本番' : 'リハ'}・第{savedSchedules[selectedType].find(cool => cool.id === current.coolId)?.number}クール</div><h3>{current.row.name}</h3>
        <div className="summary-grid"><span>区分</span><b>開始</b><b>終了</b><span>予定（固定）</span><strong>{current.row.plannedStart}</strong><strong>{current.row.plannedEnd}</strong><span>{viewState === 'review' ? '適用プレビュー' : '見込み（予測）'}</span><strong>{previewCurrent?.predictedStart || current.row.predictedStart}</strong><strong>{previewCurrent?.predictedEnd || current.row.predictedEnd}</strong></div>
        <div className="delay-line"><span>{field === 'start' ? '開始' : '終了'}時刻の補正候補</span><b>{viewState === 'input' && offset === 0 ? '入力なし' : deltaLabel(candidateTime ? toMinutes(candidateTime) - toMinutes(baseTime) : 0)}</b></div><hr />
        {viewState === 'input' && <><div className="radio-row"><button type="button" className={field === 'start' ? 'selected' : ''} onClick={() => { setField('start'); setOffsetInput(null); }}>開始時刻のずれ</button><button type="button" className={field === 'end' ? 'selected' : ''} onClick={() => { setField('end'); setOffsetInput(null); }}>終了時刻のずれ</button></div>
          <div className="field"><span>予定からのずれ</span><div className="offset-input"><select aria-label="ずれの方向" value={offsetDirection} onChange={event => setOffsetInput({ direction: event.target.value as 'late' | 'early', minutes: offset })}><option value="late">遅れ</option><option value="early">早まり</option></select><input aria-label="予定からのずれ（分）" type="number" min="0" max={offsetDirection === 'early' ? earlyLimit : 1439} value={offset} onChange={event => setOffsetInput({ direction: offsetDirection, minutes: Number(event.target.value) })} /><small>分</small></div><span>予定 {baseTime} {offsetDirection === 'late' ? '+' : '−'} {offset}分 = {candidateTime || '設定不可'}</span></div>
          <div className="info"><Icon name="b456c" />{offsetDirection === 'early' ? `前倒しは最大${earlyLimit}分までです。` : '次クール開始時刻までに最後の出演が終わる範囲で調整できます。'}超える場合は責任者にタイムテーブル全体の変更を依頼してください。</div>
          <div className="scope"><b>調整範囲</b><span>{dateLabel(selectedDate)} / {selectedType === 'performance' ? '本番' : 'リハ'} / 第{savedSchedules[selectedType].find(cool => cool.id === current.coolId)?.number}クールのみ</span><span>同じクールの未開始行の見込みを再計算</span></div>
          <button type="button" className="primary" disabled={!progressReady} onClick={() => { if (validateCandidate()) setViewState('review'); }}><Icon name="8c8d1" />影響を確認する</button><small className="panel-note">この段階では、入力候補は表に反映されていません。</small></>}
        {viewState === 'review' && <><h4>{field === 'start' ? '開始' : '終了'}時刻を {deltaLabel(toMinutes(candidateTime) - toMinutes(baseTime))} 補正</h4><div className="warning"><Icon name="f5cc6" />未適用です。表の「適用プレビュー」は保存前の見込みです。</div>
          <div className="impact-list">{impactedRows.map(row => <div key={row.id}><p>{row.name}・見込み</p><b>{savedSchedules[selectedType].flatMap(cool => cool.rows).find(item => item.id === row.id)?.predictedStart}–{savedSchedules[selectedType].flatMap(cool => cool.rows).find(item => item.id === row.id)?.predictedEnd} → {row.predictedStart}–{row.predictedEnd}</b></div>)}</div>
          <div className="impact-count"><span>変更対象</span><b>{impactedRows.length}組</b></div>
          {activeCool?.boundaryWarning && <div className="warning">次クールの固定開始時刻を超えます。内容を確認してください。</div>}
          <div className="scope"><b>保持する条件・対象外</b><span>演奏時間・転換時間を保持</span><span>別日・他クール・{selectedType === 'performance' ? 'リハ' : '本番'}は変更しません</span></div>
          <button type="button" className="primary" onClick={() => void apply()} disabled={busy}><Icon name="520af" />{busy ? '保存中…' : 'この内容を適用'}</button><button type="button" className="secondary" onClick={() => setViewState('input')}><Icon name="a0560" />戻って修正</button></>}
        {viewState === 'applied' && <><div className="success"><Icon name="641e7" />ずれを反映し、同じクールの見込みを更新しました。予定時刻は変更していません。</div><h4>適用済みの内容</h4><div className="applied-copy">{field === 'start' ? '開始' : '終了'}時刻 {candidateTime} / 予定比 {deltaLabel(toMinutes(candidateTime) - toMinutes(baseTime))}<br />{dateLabel(selectedDate)} / {selectedType === 'performance' ? '本番' : 'リハ'} / 第{savedSchedules[selectedType].find(cool => cool.id === current.coolId)?.number}クール</div>
          <div className="info"><Icon name="b456c" />補正のない出演は入力不要です。</div><button type="button" className="primary" onClick={() => { setViewState('input'); setSelectedEntryId(null); setOffsetInput(null); }}><Icon name="c9a5d" />別のずれを入力</button></>}
        <div className="history"><b>変更履歴</b>{progress.history.slice(0, showAllHistory ? undefined : 3).map((item, index) => <p key={`${item.at}-${index}`}>{new Date(item.at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}・{item.field === 'start' ? '開始' : '終了'}時刻 {item.actualTime}</p>)}{progress.history.length > 3 && <button type="button" onClick={() => setShowAllHistory(value => !value)}>{showAllHistory ? '閉じる' : '履歴をすべて見る →'}</button>}</div>
        {error && <div className="warning" role="alert">{error}</div>}
      </> : <p>出演枠がありません。</p>}</aside>;
  }
}
