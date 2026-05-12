import { useMemo } from 'react';
import type { Band, EventSettings, BandUndoMeta } from '../types';
import { bandService } from '../services/firestore';
import { generateUUID } from '../utils/generateUUID';

export const useBandManagement = (
  bands: Band[],
  eventSettings: EventSettings,
  onBandsChange: (bands: Band[]) => void,
  onUndoRecord?: (meta: BandUndoMeta) => void
) => {
  // 新しいバンドを追加
  const handleAddBand = (): Promise<string | null> => {
    const newBand: Band = {
      id: generateUUID(),
      name: '',
      performanceDuration: eventSettings.presetDurations[0] || 10,
      performanceCount: 1,
      members: [],
      availableTimeSlots: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    onUndoRecord?.({ opType: 'band:add', before: null, after: newBand });

    // 楽観的更新（UIを即座に更新）
    onBandsChange([...bands, newBand]);

    // Firestoreへの保存はバックグラウンドで実行
    void (async () => {
      try {
        await bandService.addBand(newBand, eventSettings.id);
      } catch (error) {
        console.error('バンド追加エラー:', error);
        // 失敗時はロールバック
        onBandsChange(bands);
        alert('バンドの追加に失敗しました。');
      }
    })();

    return Promise.resolve(newBand.id);
  };

  // バンドを削除（confirmは呼び出し元で行う）
  const handleDeleteBand = async (id: string) => {
    const band = bands.find(b => b.id === id) ?? null;
    onUndoRecord?.({ opType: 'band:delete', before: band, after: null });
    try {
      await bandService.deleteBand(id);
      // onBandsChangeは自動的にFirestoreのリスナーから呼ばれる
    } catch (error) {
      console.error('バンド削除エラー:', error);
      alert('バンドの削除に失敗しました。');
    }
  };

  // バンド情報を更新
  const handleUpdateBand = async (id: string, updates: Partial<Band>) => {
    const oldBand = bands.find(b => b.id === id) ?? null;
    const newBand = oldBand ? { ...oldBand, ...updates, updatedAt: new Date() } : null;
    onUndoRecord?.({ opType: 'band:update', before: oldBand, after: newBand });

    // 楽観的更新（UIを即座に更新）
    onBandsChange(
      bands.map(band =>
        band.id === id
          ? { ...band, ...updates, updatedAt: new Date() }
          : band
      )
    );

    // Firestoreに保存
    try {
      await bandService.updateBand(id, updates);
    } catch (error) {
      console.error('バンド更新エラー:', error);
      alert('バンドの更新に失敗しました。');
    }
  };

  // メンバー入力用の全メンバーリスト（サジェスト用）
  const allMembers = useMemo(() => {
    const memberSet = new Set<string>();
    bands.forEach(band => {
      band.members.forEach(member => memberSet.add(member));
    });
    return Array.from(memberSet).sort();
  }, [bands]);

  return {
    handleAddBand,
    handleDeleteBand,
    handleUpdateBand,
    allMembers,
  };
};
