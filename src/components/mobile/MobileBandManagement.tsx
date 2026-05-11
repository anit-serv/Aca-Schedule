import { useState, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Papa from 'papaparse';
import type { Band, EventSettings } from '../../types';
import { useBandManagement } from '../../hooks/useBandManagement';
import { BandAvailabilityModal } from '../BandAvailabilityModal';
import { bandService } from '../../services/firestore';
import { generateUUID } from '../../utils/generateUUID';

interface MobileBandManagementProps {
  bands: Band[];
  eventSettings: EventSettings;
  onBandsChange: (bands: Band[]) => void;
  isLoading?: boolean;
}

export const MobileBandManagement = ({ bands, eventSettings, onBandsChange, isLoading = false }: MobileBandManagementProps) => {
  const [selectedBandId, setSelectedBandId] = useState<string | null>(null);
  const [showAvailabilityModal, setShowAvailabilityModal] = useState(false);
  const [expandedBandId, setExpandedBandId] = useState<string | null>(null);
  const [editingBandId, setEditingBandId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [memberInput, setMemberInput] = useState('');
  const [showImportPanel, setShowImportPanel] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    handleAddBand,
    handleDeleteBand,
    handleUpdateBand,
    allMembers,
  } = useBandManagement(bands, eventSettings, onBandsChange);

  const toggleExpand = (bandId: string) => {
    setExpandedBandId(expandedBandId === bandId ? null : bandId);
    setEditingBandId(null);
  };

  const startEditing = (band: Band) => {
    setEditingBandId(band.id);
    setEditName(band.name);
  };

  const saveEdit = (bandId: string) => {
    if (editName.trim()) {
      handleUpdateBand(bandId, { name: editName.trim() });
    }
    setEditingBandId(null);
  };

  const addMember = (bandId: string) => {
    const name = memberInput.trim();
    if (!name) return;
    const band = bands.find(b => b.id === bandId);
    if (!band) return;
    if (band.members.includes(name)) {
      setMemberInput('');
      return;
    }
    handleUpdateBand(bandId, { members: [...band.members, name] });
    setMemberInput('');
  };

  const removeMember = (bandId: string, member: string) => {
    const band = bands.find(b => b.id === bandId);
    if (!band) return;
    handleUpdateBand(bandId, { members: band.members.filter(m => m !== member) });
  };

  const handleDownloadTemplate = useCallback(() => {
    const headers = ['バンド名', '演奏時間', '出演回数', 'メンバー'];
    const csvContent = headers.join(',') + '\n';
    const bom = '\uFEFF';
    const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'band_template.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportMessage(null);
    setIsImporting(true);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header: string) => {
        const headerMap: Record<string, string> = {
          'バンド名': 'bandName',
          '演奏時間': 'performanceTime',
          '出演回数': 'performanceCount',
          'メンバー': 'members',
        };
        return headerMap[header] || header;
      },
      complete: async (results) => {
        try {
          const data = results.data as Array<Record<string, string>>;
          const errors: string[] = [];
          const validBands: Band[] = [];

          data.forEach((row, index) => {
            const rowNumber = index + 2;
            if (!row.bandName || row.bandName.trim() === '') {
              errors.push(`${rowNumber}行目: バンド名が未入力`);
              return;
            }
            if (!row.performanceTime || row.performanceTime.trim() === '') {
              errors.push(`${rowNumber}行目: 演奏時間が未入力`);
              return;
            }
            const performanceDuration = parseInt(row.performanceTime, 10);
            if (isNaN(performanceDuration) || performanceDuration <= 0) {
              errors.push(`${rowNumber}行目: 演奏時間が不正`);
              return;
            }
            let performanceCount = 1;
            if (row.performanceCount && row.performanceCount.trim() !== '') {
              performanceCount = parseInt(row.performanceCount, 10);
              if (isNaN(performanceCount) || performanceCount <= 0) {
                errors.push(`${rowNumber}行目: 出演回数が不正`);
                return;
              }
            }
            let members: string[] = [];
            if (row.members && row.members.trim() !== '') {
              members = row.members.split(';').map(m => m.trim()).filter(m => m !== '');
            }
            validBands.push({
              id: generateUUID(),
              name: row.bandName.trim(),
              performanceDuration,
              performanceCount,
              members,
              availableTimeSlots: [],
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          });

          if (errors.length > 0) {
            setImportMessage({ type: 'error', text: errors.join('\n') });
            return;
          }
          if (validBands.length === 0) {
            setImportMessage({ type: 'error', text: 'インポート可能なバンドが見つかりません' });
            return;
          }
          for (const band of validBands) {
            await bandService.addBand(band, eventSettings.id);
          }
          setImportMessage({ type: 'success', text: `${validBands.length}件のバンドをインポートしました` });
          setTimeout(() => {
            setShowImportPanel(false);
            setImportMessage(null);
          }, 2000);
        } catch {
          setImportMessage({ type: 'error', text: 'インポートに失敗しました' });
        } finally {
          setIsImporting(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      },
      error: () => {
        setImportMessage({ type: 'error', text: 'CSVファイルの読み込みに失敗しました' });
        setIsImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      },
    });
  }, [eventSettings.id]);

  return (
    <div className="flex flex-col h-full">
      {/* ヘッダー */}
      <div className="flex justify-between items-center px-4 py-3 flex-shrink-0">
        <h2 className="text-lg font-bold text-gray-900">バンド管理</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setShowImportPanel(!showImportPanel); setImportMessage(null); }}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              showImportPanel
                ? 'bg-gray-200 text-gray-700'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <span className="flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              インポート
            </span>
          </button>
          <button
            onClick={() => {
              handleAddBand().then((newId) => {
                if (newId) {
                  setExpandedBandId(newId);
                  setEditingBandId(newId);
                  setEditName('');
                  // スクロールを最下部に移動
                  requestAnimationFrame(() => {
                    const list = document.querySelector('[data-band-list]');
                    if (list) list.scrollTop = list.scrollHeight;
                  });
                }
              });
            }}
            className="px-3 py-1.5 bg-emerald-500 active:bg-emerald-600 text-white rounded-md text-sm font-medium transition-colors"
          >
            + 追加
          </button>
        </div>
      </div>

      {/* インポートパネル */}
      <AnimatePresence>
        {showImportPanel && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden flex-shrink-0"
          >
            <div className="mx-4 mb-3 p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
              <div className="flex gap-2">
                <label
                  htmlFor="mobile-csv-import"
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                    isImporting
                      ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      : 'bg-emerald-500 text-white active:bg-emerald-600'
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  {isImporting ? 'インポート中...' : 'CSVファイルを選択'}
                </label>
                <input
                  ref={fileInputRef}
                  id="mobile-csv-import"
                  type="file"
                  accept=".csv"
                  onChange={handleFileSelect}
                  disabled={isImporting}
                  className="hidden"
                />
                <button
                  onClick={handleDownloadTemplate}
                  disabled={isImporting}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 active:bg-gray-100 disabled:opacity-50"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  テンプレート
                </button>
              </div>
              <p className="text-[11px] text-gray-400 text-center">※ CSV形式: バンド名, 演奏時間, 出演回数, メンバー(セミコロン区切り)</p>

              {importMessage && (
                <div className={`text-xs px-3 py-2 rounded-lg whitespace-pre-line ${
                  importMessage.type === 'success'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}>
                  {importMessage.text}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* バンドリスト */}
      <div className="flex-1 overflow-y-auto px-4 pb-20" data-band-list>
        {isLoading ? (
          <div className="text-center py-12">
            <div className="animate-spin w-8 h-8 border-3 border-emerald-500 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-gray-400 text-sm">読み込み中...</p>
          </div>
        ) : bands.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">🎸</div>
            <p className="text-gray-400 text-sm">バンドが登録されていません</p>
            <p className="text-gray-400 text-xs mt-1">「+ 追加」から登録してください</p>
          </div>
        ) : (
          <div className="space-y-2">
            {bands.map((band, index) => (
              <div
                key={band.id}
                className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden"
              >
                {/* バンドヘッダー（常に表示） */}
                <button
                  onClick={() => toggleExpand(band.id)}
                  className="w-full flex items-center gap-3 px-3 py-3 text-left"
                >
                  <span className="text-xs font-bold text-gray-400 w-5 text-center flex-shrink-0">
                    {index + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{band.name}</p>
                    <p className="text-xs text-gray-500">
                      {band.performanceDuration}分 · {band.members.length}人 · {band.performanceCount || 1}回出演
                    </p>
                  </div>
                  <motion.svg
                    animate={{ rotate: expandedBandId === band.id ? 180 : 0 }}
                    transition={{ duration: 0.2, ease: 'easeInOut' }}
                    className="w-4 h-4 text-gray-400 flex-shrink-0"
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </motion.svg>
                </button>

                {/* 展開時の詳細 */}
                <AnimatePresence initial={false}>
                {expandedBandId === band.id && (
                  <motion.div
                    key="detail"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: 'easeInOut' }}
                    className="overflow-hidden"
                  >
                  <div className="px-3 pb-3 border-t border-gray-100 pt-3 space-y-3">
                    {/* バンド名 */}
                    <div>
                      <label className="text-xs font-medium text-gray-500 block mb-1">バンド名</label>
                      {editingBandId === band.id ? (
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="flex-1 bg-gray-50 border border-gray-200 rounded px-2 py-1.5 text-sm"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveEdit(band.id);
                              if (e.key === 'Escape') setEditingBandId(null);
                            }}
                          />
                          <button
                            onClick={() => saveEdit(band.id)}
                            className="px-2 py-1.5 bg-emerald-500 text-white rounded text-xs"
                          >
                            保存
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => startEditing(band)}
                          className="w-full text-left bg-gray-50 border border-gray-200 rounded px-2 py-1.5 text-sm text-gray-700"
                        >
                          {band.name}
                        </button>
                      )}
                    </div>

                    {/* 演奏時間 */}
                    <div>
                      <label className="text-xs font-medium text-gray-500 block mb-1">演奏時間</label>
                      <div className="flex flex-wrap gap-1.5">
                        {eventSettings.presetDurations.map((d) => (
                          <button
                            key={d}
                            onClick={() => handleUpdateBand(band.id, { performanceDuration: d })}
                            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                              band.performanceDuration === d
                                ? 'bg-emerald-500 text-white'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                          >
                            {d}分
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* 出演回数 */}
                    <div>
                      <label className="text-xs font-medium text-gray-500 block mb-1">出演回数</label>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleUpdateBand(band.id, {
                            performanceCount: Math.max(1, (band.performanceCount || 1) - 1)
                          })}
                          className="w-8 h-8 rounded-md bg-gray-100 text-gray-600 flex items-center justify-center text-lg"
                          disabled={(band.performanceCount || 1) <= 1}
                        >
                          −
                        </button>
                        <span className="text-sm font-medium w-8 text-center">{band.performanceCount || 1}</span>
                        <button
                          onClick={() => handleUpdateBand(band.id, {
                            performanceCount: (band.performanceCount || 1) + 1
                          })}
                          className="w-8 h-8 rounded-md bg-gray-100 text-gray-600 flex items-center justify-center text-lg"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    {/* メンバー */}
                    <div>
                      <label className="text-xs font-medium text-gray-500 block mb-1">
                        メンバー ({band.members.length}人)
                      </label>
                      {band.members.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {band.members.map((member) => (
                            <span
                              key={member}
                              className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 rounded-full px-2.5 py-0.5 text-xs"
                            >
                              {member}
                              <button
                                onClick={() => removeMember(band.id, member)}
                                className="text-emerald-400 hover:text-red-500"
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={expandedBandId === band.id ? memberInput : ''}
                          onChange={(e) => setMemberInput(e.target.value)}
                          placeholder="メンバー名"
                          className="flex-1 bg-gray-50 border border-gray-200 rounded px-2 py-1.5 text-sm"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') addMember(band.id);
                          }}
                          list={`members-${band.id}`}
                        />
                        <button
                          onClick={() => addMember(band.id)}
                          className="px-2 py-1.5 bg-emerald-100 text-emerald-700 rounded text-xs font-medium"
                          disabled={!memberInput.trim()}
                        >
                          追加
                        </button>
                        {/* メンバーサジェスト */}
                        <datalist id={`members-${band.id}`}>
                          {allMembers
                            .filter(m => !band.members.includes(m))
                            .slice(0, 10)
                            .map(m => <option key={m} value={m} />)
                          }
                        </datalist>
                      </div>
                    </div>

                    {/* 出演可能時間帯 */}
                    <div>
                      <button
                        onClick={() => {
                          setSelectedBandId(band.id);
                          setShowAvailabilityModal(true);
                        }}
                        className="w-full flex items-center justify-between bg-gray-50 border border-gray-200 rounded px-3 py-2 text-sm text-gray-700"
                      >
                        <span>出演可能時間帯</span>
                        <div className="flex items-center gap-1 text-gray-400">
                          {band.availableTimeSlots && band.availableTimeSlots.length > 0 ? (
                            <span className="text-xs text-emerald-600">{band.availableTimeSlots.length}件設定済み</span>
                          ) : (
                            <span className="text-xs">未設定</span>
                          )}
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                      </button>
                    </div>

                    {/* 操作ボタン */}
                    <div className="flex justify-end pt-2 border-t border-gray-100">
                      <button
                        onClick={() => {
                          if (confirm(`「${band.name}」を削除しますか？`)) {
                            handleDeleteBand(band.id);
                            setExpandedBandId(null);
                          }
                        }}
                        className="flex items-center gap-1 px-3 py-1.5 text-red-500 hover:bg-red-50 rounded text-xs transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        削除
                      </button>
                    </div>
                  </div>
                  </motion.div>
                )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 出演可能時間帯モーダル */}
      {showAvailabilityModal && selectedBandId && (
        <BandAvailabilityModal
          band={bands.find(b => b.id === selectedBandId)!}
          eventSettings={eventSettings}
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
