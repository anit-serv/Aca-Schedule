import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { EventSettings } from '../types';
import { eventService } from '../services/firestore';
import { useAuth } from '../hooks/useAuth';

export const EventCreationWizard = () => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // フォームの状態管理
  const [formData, setFormData] = useState({
    name: '',
    year: new Date().getFullYear(),
    venue: '',
    goal: '',
    performanceDates: [''],
    rehearsalType: 'none' as EventSettings['rehearsalType'],
    rehearsalDates: [''],
    rehearsalDuration: 20,
    presetDurations: [10, 15, 20, 25],
  });

  // 本番日を追加
  const addPerformanceDate = () => {
    setFormData(prev => ({
      ...prev,
      performanceDates: [...prev.performanceDates, ''],
    }));
  };

  // 本番日を削除
  const removePerformanceDate = (index: number) => {
    setFormData(prev => ({
      ...prev,
      performanceDates: prev.performanceDates.filter((_, i) => i !== index),
    }));
  };

  // 本番日を更新
  const updatePerformanceDate = (index: number, value: string) => {
    setFormData(prev => ({
      ...prev,
      performanceDates: prev.performanceDates.map((date, i) => i === index ? value : date),
    }));
  };

  // リハーサル日を追加
  const addRehearsalDate = () => {
    setFormData(prev => ({
      ...prev,
      rehearsalDates: [...prev.rehearsalDates, ''],
    }));
  };

  // リハーサル日を削除
  const removeRehearsalDate = (index: number) => {
    setFormData(prev => ({
      ...prev,
      rehearsalDates: prev.rehearsalDates.filter((_, i) => i !== index),
    }));
  };

  // リハーサル日を更新
  const updateRehearsalDate = (index: number, value: string) => {
    setFormData(prev => ({
      ...prev,
      rehearsalDates: prev.rehearsalDates.map((date, i) => i === index ? value : date),
    }));
  };

  // イベント作成
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // 既に送信中の場合は何もしない
    if (isSubmitting) {
      console.log('[イベント作成] 既に送信中です');
      return;
    }
    
    // バリデーション
    if (!formData.name.trim()) {
      alert('イベント名を入力してください');
      return;
    }
    
    const validPerformanceDates = formData.performanceDates.filter(d => d.trim() !== '');
    if (validPerformanceDates.length === 0) {
      alert('本番日を少なくとも1つ設定してください');
      return;
    }
    
    if (formData.rehearsalType === 'rehearsal-day') {
      const validRehearsalDates = formData.rehearsalDates.filter(d => d.trim() !== '');
      if (validRehearsalDates.length === 0) {
        alert('リハーサル日を少なくとも1つ設定してください');
        return;
      }
    }
    
    setIsSubmitting(true);
    
    try {
      // EventSettings作成
      const eventData: Omit<EventSettings, 'id'> = {
        name: formData.name.trim(),
        year: formData.year,
        venue: formData.venue.trim(),
        goal: formData.goal.trim(),
        performanceDates: validPerformanceDates.sort(),
        rehearsalType: formData.rehearsalType,
        rehearsalDates: formData.rehearsalType === 'rehearsal-day' 
          ? formData.rehearsalDates.filter(d => d.trim() !== '').sort()
          : undefined,
        rehearsalDuration: formData.rehearsalType !== 'none' ? formData.rehearsalDuration : undefined,
        presetDurations: formData.presetDurations,
        ownerId: currentUser?.uid || '',
      };
      
      console.log('[イベント作成] 開始:', eventData);
      
      // Firestoreに保存
      const eventId = await eventService.createEvent(eventData);
      
      console.log('[イベント作成] 成功:', eventId);
      
      // イベント編集ページへリダイレクト
      navigate(`/events/${eventId}`, { replace: true });
    } catch (error) {
      console.error('[イベント作成] エラー:', error);
      alert('イベントの作成に失敗しました。もう一度お試しください。');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-gray-50 text-gray-900 min-h-screen font-sans">
      <header className="bg-white shadow-lg">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="text-gray-500 hover:text-gray-900 transition-colors"
          >
            ← 戻る
          </button>
          <h1 className="text-2xl font-bold">新規イベント作成</h1>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* 基本情報 */}
          <div className="bg-white rounded-lg p-6 shadow">
            <h2 className="text-xl font-bold mb-4">基本情報</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  イベント名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="例: 2025年春ライブ"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">開催年</label>
                  <input
                    type="number"
                    value={formData.year}
                    onChange={(e) => setFormData(prev => ({ ...prev, year: parseInt(e.target.value) }))}
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    min="2000"
                    max="2100"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">会場</label>
                  <input
                    type="text"
                    value={formData.venue}
                    onChange={(e) => setFormData(prev => ({ ...prev, venue: e.target.value }))}
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="例: 〇〇ホール"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">イベントの目標</label>
                <textarea
                  value={formData.goal}
                  onChange={(e) => setFormData(prev => ({ ...prev, goal: e.target.value }))}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  rows={3}
                  placeholder="例: 全バンドが楽しく演奏できるライブを作る"
                />
              </div>
            </div>
          </div>

          {/* 本番日程 */}
          <div className="bg-white rounded-lg p-6 shadow">
            <h2 className="text-xl font-bold mb-4">
              本番日程 <span className="text-red-500">*</span>
            </h2>
            
            <div className="space-y-3">
              {formData.performanceDates.map((date, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => updatePerformanceDate(index, e.target.value)}
                    className="flex-1 px-3 py-2 bg-white border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    required
                  />
                  {formData.performanceDates.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removePerformanceDate(index)}
                      className="px-3 py-2 bg-red-600 hover:bg-red-700 rounded-md transition-colors"
                    >
                      削除
                    </button>
                  )}
                </div>
              ))}
              
              <button
                type="button"
                onClick={addPerformanceDate}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 rounded-md transition-colors"
              >
                + 本番日を追加
              </button>
            </div>
          </div>

          {/* リハーサル設定 */}
          <div className="bg-white rounded-lg p-6 shadow">
            <h2 className="text-xl font-bold mb-4">リハーサル設定</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">リハーサル形式</label>
                <select
                  value={formData.rehearsalType}
                  onChange={(e) => setFormData(prev => ({ 
                    ...prev, 
                    rehearsalType: e.target.value as EventSettings['rehearsalType']
                  }))}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="none">リハーサルなし</option>
                  <option value="rehearsal-day">別日リハーサル</option>
                  <option value="cool-pre-rehearsal">クール直前リハーサル</option>
                  <option value="day-start-rehearsal">当日一括リハーサル</option>
                </select>
                <p className="text-sm text-gray-500 mt-1">
                  ※ この設定は後から変更できません
                </p>
              </div>

              {formData.rehearsalType === 'rehearsal-day' && (
                <div>
                  <label className="block text-sm font-medium mb-2">
                    リハーサル日 <span className="text-red-500">*</span>
                  </label>
                  <div className="space-y-3">
                    {formData.rehearsalDates.map((date, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <input
                          type="date"
                          value={date}
                          onChange={(e) => updateRehearsalDate(index, e.target.value)}
                          className="flex-1 px-3 py-2 bg-white border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          required
                        />
                        {formData.rehearsalDates.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeRehearsalDate(index)}
                            className="px-3 py-2 bg-red-600 hover:bg-red-700 rounded-md transition-colors"
                          >
                            削除
                          </button>
                        )}
                      </div>
                    ))}
                    
                    <button
                      type="button"
                      onClick={addRehearsalDate}
                      className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 rounded-md transition-colors"
                    >
                      + リハーサル日を追加
                    </button>
                  </div>
                </div>
              )}

              {formData.rehearsalType !== 'none' && (
                <div>
                  <label className="block text-sm font-medium mb-2">
                    リハーサル時間（分）
                  </label>
                  <input
                    type="number"
                    value={formData.rehearsalDuration}
                    onChange={(e) => setFormData(prev => ({ 
                      ...prev, 
                      rehearsalDuration: parseInt(e.target.value) 
                    }))}
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    min="1"
                    max="120"
                  />
                  <p className="text-sm text-gray-500 mt-1">
                    全バンド共通のリハーサル時間です
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* 送信ボタン */}
          <div className="flex justify-end gap-4">
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-3 bg-emerald-500 hover:bg-emerald-600 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-md font-medium transition-colors text-white"
            >
              {isSubmitting ? '作成中...' : 'イベントを作成'}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
};
