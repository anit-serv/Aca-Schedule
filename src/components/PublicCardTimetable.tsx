import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon as MaterialIcon } from './Icon';
import type { Band, Cool, DailyTimetable, EventSettings, TimetableEntry } from '../types';
import { getPublicSequenceValue } from '../utils/publicCustomFields';
import { getShiftSlotAt, getShiftSlots } from '../utils/customShift';
import { buildScheduleCools } from '../utils/stakeholderSchedule';
import type { ProgressRecord } from '../services/stakeholderProgress';
import './PublicCardTimetable.css';

type CardEntry = { id: string; name: string; members: string[]; start: string; end: string; adjusted: boolean; startDelta: number; endDelta: number; duration: number; order: number; details: { name: string; value: string }[] };
type CardCool = { id: string; name: string; start: string; end: string; entries: CardEntry[] };
type CardDay = { id: string; label: string; short: string; weekday: string; cools: CardCool[] };
type PublicDetail = CardEntry['details'][number];
const icons = { search: 'search', searchDark: 'search', map: 'location_on', calendar: 'calendar_month', info: 'info', infoDark: 'info', clock: 'schedule', audio: 'graphic_eq', arrow: 'arrow_forward', check: 'check', circleCheck: 'check_circle', radio: 'radio_button_checked', alert: 'warning', coffee: 'coffee', close: 'close', searchEmpty: 'search_off' };
const Icon = ({ name, size = 16 }: { name: keyof typeof icons; size?: number }) => <span className="icon" style={{ fontSize: size, width: size, height: size }}><MaterialIcon name={icons[name]} filled={name === 'radio' || name === 'circleCheck'} /></span>;
const minutes = (time: string) => { const [hour, minute] = time.split(':').map(Number); return hour * 60 + minute; };
const timeString = (value: number) => `${String(Math.floor(value / 60) % 24).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const dateParts = (value: string) => { const date = new Date(`${value}T12:00:00`); return { short: `${date.getMonth() + 1}月${date.getDate()}日`, weekday: '日月火水木金土'[date.getDay()], label: `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日` }; };
const shiftLabel = (delta: number) => `${Math.abs(delta)}分${delta > 0 ? '遅れ' : '早まり'}`;

function PublicTimingShift({ entry }: { entry: CardEntry }) {
  if (!entry.adjusted || entry.startDelta === 0 && entry.endDelta === 0) return null;
  const sameShift = entry.startDelta !== 0 && entry.startDelta === entry.endDelta;
  return <div className="timing-shifts" aria-label="予定時刻との差">
    {sameShift ? <span>{shiftLabel(entry.startDelta)}</span> : <>
      {entry.startDelta !== 0 && <span>開始 {shiftLabel(entry.startDelta)}</span>}
      {entry.endDelta !== 0 && <span>終了 {shiftLabel(entry.endDelta)}</span>}
    </>}
  </div>;
}

function PublicCardDetails({ details, current }: { details: PublicDetail[]; current: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const hasMore = details.length > 2 || details.some(detail => detail.value.length > 90);
  const visible = current || expanded ? details : details.slice(0, 2);
  if (!details.length) return null;
  return <div className="public-card-details">
    {visible.map(detail => <p className={`public-note${!current && !expanded ? ' compact' : ''}`} key={detail.name}><Icon name={current ? 'infoDark' : 'info'} size={15} /><span><strong>{detail.name}</strong><span>{detail.value}</span></span></p>)}
    {!current && hasMore && <button className="public-detail-toggle" type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? '閉じる' : '詳細を見る'}</button>}
  </div>;
}

function buildDays(settings: EventSettings, bands: Band[], dailyTimetables: DailyTimetable[], progressRecords: Record<string, ProgressRecord>): CardDay[] {
  const bandMap = new Map(bands.map(band => [band.id, band]));
  const columns = (settings.customFields?.performance.columns || []).filter(column => column.isPublic === true).sort((a, b) => a.order - b.order);
  return settings.performanceDates.map(date => {
    const daily = dailyTimetables.find(item => item.date === date);
    const normalizedCools: Cool[] = daily ? daily.cools.length > 0 ? daily.cools : [{ id: `day-${date}`, number: 1, entries: daily.entries, startTime: daily.startTime }] : [];
    const predicted = daily ? new Map(buildScheduleCools({ day: daily, type: 'performance', bands, rehearsalDuration: 0, records: progressRecords })
      .flatMap(cool => cool.rows.map(row => [row.id, row] as const))) : new Map();
    let order = 0;
    const cools = normalizedCools.map(cool => {
      const visibleEntries = cool.entries.filter(entry => entry.type === 'band' || entry.type === 'custom');
      const entries = visibleEntries.map((entry: TimetableEntry, entryIndex: number) => {
        const band = entry.bandId ? bandMap.get(entry.bandId) : undefined;
        const projection = predicted.get(entry.id);
        const start = projection?.predictedStart || entry.startTime || cool.startTime || daily?.startTime || '00:00';
        const duration = band?.performanceDuration || entry.customEvent?.duration || Math.max(0, minutes(entry.endTime || start) - minutes(start));
        const end = projection?.predictedEnd || entry.endTime || timeString(minutes(start) + duration);
        order += 1;
        const customData = settings.customFields?.performance.dailyData?.[date];
        const details = columns.map(column => ({ name: column.name, value: column.shift
          ? getShiftSlotAt(getShiftSlots(column, date, cool.id, visibleEntries.length), entryIndex)?.slot.assignee || ''
          : column.bindingType === 'entity' ? customData?.byEntity?.[entry.id]?.[column.id]?.value || '' : getPublicSequenceValue(customData, order, column.id) })).filter(detail => detail.value.trim());
        return { id: entry.id, name: band?.name || entry.customEvent?.name || '出演者未設定', members: band?.members || [], start, end,
          adjusted: projection?.affected || false,
          startDelta: projection ? minutes(projection.predictedStart) - minutes(projection.plannedStart) : 0,
          endDelta: projection ? minutes(projection.predictedEnd) - minutes(projection.plannedEnd) : 0,
          duration, order, details };
      });
      return { id: cool.id, name: `第${cool.number}クール`, start: entries[0]?.start || cool.startTime || daily?.startTime || '', end: entries.at(-1)?.end || '', entries };
    });
    return { id: date, ...dateParts(date), cools };
  });
}

function getSchedule(day: CardDay, now: Date) {
  const all = day.cools.flatMap(cool => cool.entries.map(entry => ({ cool, entry })));
  if (!all.length) return { state: 'unpublished' as const };
  if (day.id > dateKey(now)) return { state: 'before' as const, next: all[0] };
  if (day.id < dateKey(now)) return { state: 'ended' as const };
  const currentMinute = now.getHours() * 60 + now.getMinutes();
  const current = all.find(({ entry }) => currentMinute >= minutes(entry.start) && currentMinute < minutes(entry.end));
  if (current) return { state: 'live' as const, current };
  const next = all.find(({ entry }) => minutes(entry.start) > currentMinute);
  if (!next) return { state: 'ended' as const };
  if (currentMinute < minutes(all[0].entry.start)) return { state: 'before' as const, next };
  return { state: 'break' as const, next };
}

export function PublicCardTimetable({ settings, bands, dailyTimetables, progressRecords, eventId }: { settings: EventSettings; bands: Band[]; dailyTimetables: DailyTimetable[]; progressRecords: Record<string, ProgressRecord>; eventId: string }) {
  const days = useMemo(() => buildDays(settings, bands, dailyTimetables, progressRecords), [settings, bands, dailyTimetables, progressRecords]);
  const [selectedDate, setSelectedDate] = useState(() => days.some(day => day.id === dateKey(new Date())) ? dateKey(new Date()) : days[0]?.id || '');
  const [now, setNow] = useState(() => new Date());
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [showReturn, setShowReturn] = useState(false);
  const [targetId, setTargetId] = useState<string | null>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const initialScrollDone = useRef(false);
  const day = days.find(item => item.id === selectedDate) || days[0];
  const schedule = day ? getSchedule(day, now) : { state: 'unpublished' as const };
  const currentEntryId = 'current' in schedule ? schedule.current?.entry.id : undefined;
  const results = query.trim() ? days.flatMap(item => item.cools.flatMap(cool => cool.entries.filter(entry => `${entry.name} ${entry.members.join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map(entry => ({ day: item, cool, entry })))) : [];

  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 30_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    if (initialScrollDone.current || !currentEntryId || !activeRef.current) return;
    initialScrollDone.current = true;
    const timer = window.setTimeout(() => activeRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' }), 100);
    return () => window.clearTimeout(timer);
  }, [currentEntryId, selectedDate]);
  useEffect(() => {
    if (!targetId || searching) return;
    const timer = window.setTimeout(() => { document.getElementById(`public-card-${targetId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); setTargetId(null); }, 50);
    return () => window.clearTimeout(timer);
  }, [targetId, searching, selectedDate]);
  useEffect(() => {
    const update = () => { if (activeRef.current) { const rect = activeRef.current.getBoundingClientRect(); setShowReturn(rect.bottom < 130 || rect.top > window.innerHeight); } else setShowReturn(false); };
    window.addEventListener('scroll', update, { passive: true }); update(); return () => window.removeEventListener('scroll', update);
  }, [selectedDate, schedule.state]);

  const dateSwitch = <div className="date-switch" aria-label="開催日を切り替える">{days.map(item => <button key={item.id} type="button" className={item.id === day?.id ? 'active' : ''} onClick={() => { setSelectedDate(item.id); initialScrollDone.current = true; }}>{item.short} <small>（{item.weekday}）</small></button>)}</div>;
  const eventControls = <div className="event-controls"><div className="event-summary"><span>EVENT INFORMATION</span><h2>{settings.name}</h2><p><Icon name="map" size={15} />{settings.venue}</p><p><Icon name="calendar" size={15} />{days.map(item => item.short).join('・')}</p></div>{dateSwitch}</div>;

  return <div className="public-viewer"><div className="app-shell">
    <header className="app-header"><div className="identity"><img className="logo" src="/app-icon.svg" alt="" /><span className="identity-copy"><small>Aca-Schedule</small><strong>{settings.name}</strong></span></div><div className="header-actions"><span className="desktop-only">{days.map(item => item.short).join('・')} / {settings.venue}</span><button className="icon-button" type="button" aria-label="出演者を検索" onClick={() => setSearching(!searching)}><Icon name="search" size={20} /></button></div></header>
    {searching ? <main className="search-view"><div className="search-context"><span>{day?.short}（{day?.weekday}）</span></div><div className="search-content"><h1>出演者を検索</h1><p className="search-lead">バンド名から出演枠へ移動できます。</p><label className="search-input"><Icon name="searchDark" size={20} /><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="バンド名を検索" />{query && <button type="button" aria-label="検索語を消去" onClick={() => setQuery('')}><Icon name="close" size={18} /></button>}</label>{!query ? <button className="close-search" onClick={() => setSearching(false)}>タイムテーブルへ戻る</button> : results.length === 0 ? <><section className="zero-results"><span><Icon name="searchEmpty" size={27} /></span><h2>0件でした</h2><p>「{query}」に一致する出演者は見つかりませんでした。</p></section><div className="search-tips"><b>検索のヒント</b><p>表記を短くして検索してください。</p></div></> : <><div className="result-summary"><span>「{query}」の検索結果</span><b>{results.length}件</b></div><div className="result-list">{results.map(({ day: resultDay, cool, entry }) => <button key={`${resultDay.id}-${entry.id}`} onClick={() => { setSelectedDate(resultDay.id); setTargetId(entry.id); setSearching(false); }}><span><strong>{entry.name}</strong><small>{entry.members.join(' / ')}</small></span><i>↗</i><em>{resultDay.short}（{resultDay.weekday}）</em><em>{cool.name}</em><em className="mint">{entry.start} 開始</em></button>)}</div><p className="search-guidance"><Icon name="info" size={17} />結果を選ぶと、出演カードへ移動します。</p></>}</div></main> : <><div className="desktop-context"><span><i />LIVE・{day?.short}（{day?.weekday}）</span><time>現在 {timeString(now.getHours() * 60 + now.getMinutes())} / {'current' in schedule && schedule.current?.cool.name || 'next' in schedule && schedule.next?.cool.name || (schedule.state === 'ended' ? '公演終了' : '開演前')}</time></div><main className="desktop-grid"><aside className="left-sidebar">{eventControls}<button className="sidebar-search" onClick={() => setSearching(true)}><Icon name="searchDark" size={18} />バンド名を検索</button><div className="legend"><b>表示の見かた</b><span><Icon name="audio" />演奏中<small>ミントの太枠</small></span><span><Icon name="arrow" />次の出演<small>濃緑の枠</small></span><span><Icon name="circleCheck" />終了<small>抑えた背景</small></span></div><Link className="stakeholder-link" to={`/stakeholder/${eventId}`}>関係者の方はこちら</Link></aside><section className="main-column"><div className="mobile-controls">{eventControls}<Link className="stakeholder-link" to={`/stakeholder/${eventId}`}>関係者の方はこちら</Link></div><div className="schedule-title"><span>TODAY'S TIMETABLE</span><h1>本日のタイムテーブル</h1><time>{day?.label}（{day?.weekday}）</time></div>
      {day?.cools.some(cool => cool.entries.some(entry => entry.adjusted)) && <p className="progress-updated" role="status">関係者による進行時刻の調整を反映しています。表示時刻は見込みです。</p>}
      {schedule.state === 'unpublished' ? <section className="unpublished"><div className="empty-icon"><Icon name="calendar" size={32} /></div><h1>出演情報はまだ公開されていません</h1><p>タイムテーブルが公開されると、出演順・開始時刻をここで確認できます。</p></section> : <>
        {schedule.state === 'before' && <section className="state-banner before-banner"><span className="state-icon"><Icon name="clock" size={23} /></span><h1>開演まで あと{day?.id === dateKey(now) && 'next' in schedule && schedule.next ? Math.max(0, minutes(schedule.next.entry.start) - now.getHours() * 60 - now.getMinutes()) : '—'}分</h1><p>{'next' in schedule && schedule.next?.cool.name}は{'next' in schedule && schedule.next?.entry.start}開始予定です。</p></section>}
        {schedule.state === 'break' && <div className="break-wrap"><section className="state-banner break-banner"><span className="state-icon"><Icon name="coffee" size={23} /></span><h1>クール間休憩中</h1><p>次の出演は{'next' in schedule && schedule.next?.entry.start}開始予定です。</p></section></div>}
        {schedule.state === 'ended' && <section className="state-banner ended-banner"><span className="state-icon"><Icon name="check" size={23} /></span><h1>本日の公演は終了しました</h1><p>ご来場ありがとうございました。</p></section>}
        <div className="schedule-list">{day?.cools.map(cool => <section className="cool-section" key={cool.id}><div className="cool-heading"><div className="cool-title"><i /><span>{day.short}</span><strong>{cool.name}</strong></div><time>{cool.start}{cool.end && `–${cool.end}`}</time></div><div className="timeline">{cool.entries.map((entry, index) => { const current = 'current' in schedule && schedule.current?.entry.id === entry.id; const next = 'next' in schedule && schedule.next?.entry.id === entry.id; const past = day.id < dateKey(now) || day.id === dateKey(now) && minutes(entry.end) <= now.getHours() * 60 + now.getMinutes(); const remaining = minutes(entry.start) - now.getHours() * 60 - now.getMinutes(); return <div className="timeline-item" key={entry.id}><div id={`public-card-${entry.id}`} ref={current ? activeRef : undefined} className={`band-card${current ? ' current' : ''}${next ? ' next' : ''}${past ? ' past' : ''}`}><div className="card-status"><span className="order"><b>{past ? <Icon name="check" size={14} /> : entry.order}</b>演奏 {entry.duration}分</span>{current ? <span className="status-pill live-pill"><Icon name="audio" size={14} />演奏中</span> : past ? <span className="status-pill"><Icon name="circleCheck" size={14} />終了</span> : next ? <span className="status-pill next-pill"><Icon name="arrow" size={14} />次の出演</span> : <span className="status-pill"><Icon name="clock" size={14} />{day.id === dateKey(now) && remaining > 0 ? `あと${remaining}分` : `${entry.start} 開演`}</span>}</div><div className="primary-info"><time>{entry.start}</time><div><h3>{entry.name}</h3><PublicTimingShift entry={entry} />{current && entry.members.length > 0 && <p className="members">{entry.members.join(' / ')}</p>}</div></div>{current && <div className="live-time"><span>残り目安<strong>約{Math.max(1, minutes(entry.end) - now.getHours() * 60 - now.getMinutes())}分</strong></span><span>終了予定<strong>{entry.end}</strong></span></div>}<PublicCardDetails key={entry.id} details={entry.details} current={Boolean(current)} /></div>{index < cool.entries.length - 1 && <div className="connector" />}</div>; })}</div></section>)}</div></>}
      <footer>時刻は進行状況により前後する場合があります</footer></section><aside className="right-sidebar">{'current' in schedule && schedule.current && <div className="now-panel"><span><Icon name="radio" size={18} />NOW PLAYING</span><strong>{schedule.current.entry.name}</strong><p>{schedule.current.entry.start}–{schedule.current.entry.end}<b>残り約{Math.max(1, minutes(schedule.current.entry.end) - now.getHours() * 60 - now.getMinutes())}分</b></p></div>}<div className="notice-panel"><Icon name="alert" size={20} /><strong>ご来場の方へ</strong><p>時刻は進行状況により前後する場合があります。</p></div></aside></main>{showReturn && 'current' in schedule && schedule.current && <button className="return-current" onClick={() => activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>◎ 現在の演奏へ戻る ↓</button>}</>}
  </div></div>;
}
