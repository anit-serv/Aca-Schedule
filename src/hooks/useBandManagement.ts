import { useMemo } from 'react';
import type { Band, EventSettings } from '../types';
import { bandService } from '../services/firestore';

export const useBandManagement = (
  bands: Band[],
  eventSettings: EventSettings,
  onBandsChange: (bands: Band[]) => void
) => {
  // 新しいバンドを追加
  const handleAddBand = async () => {
    const newBand: Band = {
      id: crypto.randomUUID(),
      name: '',
      performanceDuration: eventSettings.presetDurations[0] || 10,
      performanceCount: 1,
      members: [],
      availableTimeSlots: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    // Firestoreに追加
    try {
      await bandService.addBand(newBand, eventSettings.id);
      // onBandsChangeは自動的にFirestoreのリスナーから呼ばれる
    } catch (error) {
      console.error('バンド追加エラー:', error);
      alert('バンドの追加に失敗しました。');
    }
  };

  // バンドを削除
  const handleDeleteBand = async (id: string) => {
    if (confirm('このバンドを削除しますか?')) {
      try {
        await bandService.deleteBand(id);
        // onBandsChangeは自動的にFirestoreのリスナーから呼ばれる
      } catch (error) {
        console.error('バンド削除エラー:', error);
        alert('バンドの削除に失敗しました。');
      }
    }
  };

  // バンド情報を更新
  const handleUpdateBand = async (id: string, updates: Partial<Band>) => {
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
