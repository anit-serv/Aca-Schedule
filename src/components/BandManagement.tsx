import { useState } from 'react';
import type { Band, EventSettings } from '../types';
import { useBandManagement } from '../hooks/useBandManagement';
import { BandRow } from './BandRow';
import { BandAvailabilityModal } from './BandAvailabilityModal';
import { BandImportCSV } from './BandImportCSV';

interface BandManagementProps {
  bands: Band[];
  eventSettings: EventSettings;
  onBandsChange: (bands: Band[]) => void;
}

export const BandManagement = ({ bands, eventSettings, onBandsChange }: BandManagementProps) => {
  const [selectedBandId, setSelectedBandId] = useState<string | null>(null);
  const [showAvailabilityModal, setShowAvailabilityModal] = useState(false);
  const [showImportInfo, setShowImportInfo] = useState(false);

  const {
    handleAddBand,
    handleDeleteBand,
    handleUpdateBand,
    allMembers,
  } = useBandManagement(bands, eventSettings, onBandsChange);

  return (
    <div className="p-6 h-full flex flex-col overflow-hidden">
      <div className="flex justify-between items-center mb-6 flex-shrink-0">
        <h2 className="text-2xl font-bold">バンド管理</h2>
        <div className="flex items-center gap-3">
          {/* CSVインポート機能 */}
          <BandImportCSV 
            eventSettings={eventSettings}
            onImportComplete={() => {
              // インポート完了後、必要に応じて追加処理
            }}
          />
          
          {/* 情報アイコン */}
          <div className="relative">
            <button
              onMouseEnter={() => setShowImportInfo(true)}
              onMouseLeave={() => setShowImportInfo(false)}
              className="p-2 text-gray-400 hover:text-gray-200 transition-colors"
              aria-label="CSVインポートの注意点"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
            
            {/* ツールチップ */}
            {showImportInfo && (
              <div className="absolute right-0 top-full mt-2 w-80 bg-gray-700 border border-gray-600 rounded-lg shadow-xl p-4 z-50 text-sm">
                <h4 className="font-semibold mb-2 text-white">CSVファイルの注意点</h4>
                <ul className="space-y-1 text-gray-300">
                  <li>• ファイルはUTF-8エンコーディングで保存してください</li>
                  <li>• ヘッダー行は必須です（バンド名,演奏時間,出演回数,メンバー）</li>
                  <li>• バンド名と演奏時間は必須項目です</li>
                  <li>• 出演回数を省略した場合、デフォルトで1回になります</li>
                  <li>• メンバーは複数の場合、セミコロン(;)で区切ってください</li>
                  <li className="mt-2 pt-2 border-t border-gray-600">例: 田中太郎;山田花子;佐藤次郎</li>
                </ul>
              </div>
            )}
          </div>

          {/* バンド追加ボタン */}
          <button
            onClick={handleAddBand}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium transition-colors"
          >
            + バンドを追加
          </button>
        </div>
      </div>

      {/* CSVインポート機能は上部に移動したため削除 */}

      <div className="bg-gray-800 rounded-lg shadow-xl overflow-hidden flex-1 flex flex-col min-h-0">
        <div className="overflow-x-auto overflow-y-auto flex-1">
          <table className="w-full">
            <thead className="bg-gray-700 sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-200 w-8">#</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-200 min-w-[200px]">バンド名</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-200 w-32">演奏時間</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-200 w-24">出演回数</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-200 min-w-[300px]">メンバー</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-200 w-44 whitespace-nowrap">出演可能時間帯</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-200 w-24">操作</th>
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
