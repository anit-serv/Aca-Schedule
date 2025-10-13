import { useState } from 'react';
import type { Band, EventSettings } from '../types';
import { useBandManagement } from '../hooks/useBandManagement';
import { BandRow } from './BandRow';
import { BandAvailabilityModal } from './BandAvailabilityModal';

interface BandManagementProps {
  bands: Band[];
  eventSettings: EventSettings;
  onBandsChange: (bands: Band[]) => void;
}

export const BandManagement = ({ bands, eventSettings, onBandsChange }: BandManagementProps) => {
  const [selectedBandId, setSelectedBandId] = useState<string | null>(null);
  const [showAvailabilityModal, setShowAvailabilityModal] = useState(false);

  const {
    handleAddBand,
    handleDeleteBand,
    handleUpdateBand,
    allMembers,
  } = useBandManagement(bands, eventSettings, onBandsChange);

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
