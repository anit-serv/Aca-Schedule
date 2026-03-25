import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { userApiTokenService } from '../services/userApiTokens';
import type { EventSettings, UserApiTokenSummary } from '../types';

interface EventSettingsModalProps {
  eventSettings: EventSettings;
  onClose: () => void;
  onSave: (settings: EventSettings) => void;
}

export const EventSettingsModal = ({
  eventSettings,
  onClose,
  onSave,
}: EventSettingsModalProps) => {
  const { firebaseUser } = useAuth();
  const [editedSettings, setEditedSettings] = useState<EventSettings>(eventSettings);
  const [tokens, setTokens] = useState<UserApiTokenSummary[]>([]);
  const [isLoadingTokens, setIsLoadingTokens] = useState(false);
  const [isCreatingToken, setIsCreatingToken] = useState(false);
  const [isRevokingTokenId, setIsRevokingTokenId] = useState<string | null>(null);
  const [isUpdatingTokenId, setIsUpdatingTokenId] = useState<string | null>(null);
  const [editingTokenId, setEditingTokenId] = useState<string | null>(null);
  const [editTokenName, setEditTokenName] = useState('');
  const [editTokenEventIdsText, setEditTokenEventIdsText] = useState('');
  const [editTokenExpiresInDays, setEditTokenExpiresInDays] = useState(90);
  const [tokenName, setTokenName] = useState('');
  const [tokenEventIdsText, setTokenEventIdsText] = useState(eventSettings.id);
  const [tokenExpiresInDays, setTokenExpiresInDays] = useState(90);
  const [newlyIssuedToken, setNewlyIssuedToken] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);

  useEffect(() => {
    setEditedSettings(eventSettings);
    setTokenEventIdsText(eventSettings.id);
  }, [eventSettings]);

  useEffect(() => {
    const loadTokens = async () => {
      if (!firebaseUser) {
        setTokens([]);
        return;
      }

      try {
        setIsLoadingTokens(true);
        setTokenError(null);
        const loaded = await userApiTokenService.list(firebaseUser);
        setTokens(loaded);
      } catch (error) {
        console.error('[EventSettingsModal] APIトークン一覧の取得に失敗:', error);
        setTokenError('APIトークン一覧の取得に失敗しました。');
      } finally {
        setIsLoadingTokens(false);
      }
    };

    void loadTokens();
  }, [firebaseUser]);

  const handleSave = () => {
    onSave(editedSettings);
    onClose();
  };

  const handlePresetDurationAdd = () => {
    const newDuration = 5; // デフォルト5分
    setEditedSettings({
      ...editedSettings,
      presetDurations: [...editedSettings.presetDurations, newDuration],
    });
  };

  const handlePresetDurationChange = (index: number, value: number) => {
    const updated = [...editedSettings.presetDurations];
    updated[index] = value;
    setEditedSettings({
      ...editedSettings,
      presetDurations: updated,
    });
  };

  const handlePresetDurationRemove = (index: number) => {
    setEditedSettings({
      ...editedSettings,
      presetDurations: editedSettings.presetDurations.filter((_, i) => i !== index),
    });
  };

  const handleRehearsalDurationChange = (value: number) => {
    setEditedSettings({
      ...editedSettings,
      rehearsalDuration: value,
    });
  };

  const parseAllowedEventIds = () => {
    return [...new Set(
      tokenEventIdsText
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    )];
  };

  const handleCreateToken = async () => {
    if (!firebaseUser) {
      setTokenError('ログイン情報が見つかりません。再ログインしてください。');
      return;
    }

    const allowedEventIds = parseAllowedEventIds();
    if (!tokenName.trim()) {
      setTokenError('トークン名を入力してください。');
      return;
    }
    if (allowedEventIds.length === 0) {
      setTokenError('対象eventIdを1つ以上入力してください。');
      return;
    }

    try {
      setIsCreatingToken(true);
      setTokenError(null);
      setNewlyIssuedToken(null);

      const created = await userApiTokenService.create(firebaseUser, {
        name: tokenName.trim(),
        allowedEventIds,
        expiresInDays: tokenExpiresInDays,
      });

      setNewlyIssuedToken(created.token);
      setTokenName('');
      setTokens((prev) => [created.metadata, ...prev]);
    } catch (error) {
      console.error('[EventSettingsModal] APIトークン作成に失敗:', error);
      setTokenError(error instanceof Error ? error.message : 'APIトークン作成に失敗しました。');
    } finally {
      setIsCreatingToken(false);
    }
  };

  const handleRevokeToken = async (tokenId: string) => {
    if (!firebaseUser) {
      setTokenError('ログイン情報が見つかりません。再ログインしてください。');
      return;
    }

    if (!window.confirm('このトークンを失効しますか？ 失効後はAPIで利用できません。')) {
      return;
    }

    try {
      setIsRevokingTokenId(tokenId);
      setTokenError(null);
      await userApiTokenService.revoke(firebaseUser, tokenId);
      setTokens((prev) => prev.map((token) => (
        token.id === tokenId
          ? { ...token, status: 'revoked' }
          : token
      )));
    } catch (error) {
      console.error('[EventSettingsModal] APIトークン失効に失敗:', error);
      setTokenError(error instanceof Error ? error.message : 'APIトークン失効に失敗しました。');
    } finally {
      setIsRevokingTokenId(null);
    }
  };

  const startEditToken = (token: UserApiTokenSummary) => {
    setEditingTokenId(token.id);
    setEditTokenName(token.name);
    setEditTokenEventIdsText(token.allowedEventIds.join(','));
    if (token.expiresAt) {
      const diffMs = token.expiresAt.getTime() - Date.now();
      const days = Math.max(1, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
      setEditTokenExpiresInDays(days);
    } else {
      setEditTokenExpiresInDays(90);
    }
  };

  const cancelEditToken = () => {
    setEditingTokenId(null);
    setEditTokenName('');
    setEditTokenEventIdsText('');
    setEditTokenExpiresInDays(90);
  };

  const handleUpdateToken = async (tokenId: string) => {
    if (!firebaseUser) {
      setTokenError('ログイン情報が見つかりません。再ログインしてください。');
      return;
    }

    const allowedEventIds = [...new Set(
      editTokenEventIdsText
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    )];

    if (!editTokenName.trim()) {
      setTokenError('トークン名を入力してください。');
      return;
    }

    if (allowedEventIds.length === 0) {
      setTokenError('対象eventIdを1つ以上入力してください。');
      return;
    }

    try {
      setIsUpdatingTokenId(tokenId);
      setTokenError(null);
      const updated = await userApiTokenService.update(firebaseUser, tokenId, {
        name: editTokenName.trim(),
        allowedEventIds,
        expiresInDays: editTokenExpiresInDays,
      });

      setTokens((prev) => prev.map((token) => (token.id === tokenId ? updated : token)));
      cancelEditToken();
    } catch (error) {
      console.error('[EventSettingsModal] APIトークン更新に失敗:', error);
      setTokenError(error instanceof Error ? error.message : 'APIトークン更新に失敗しました。');
    } finally {
      setIsUpdatingTokenId(null);
    }
  };

  const formatDate = (value: Date | null) => {
    if (!value) {
      return '-';
    }
    return value.toLocaleString('ja-JP');
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900">イベント設定</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-900 text-2xl"
          >
            ×
          </button>
        </div>

        <div className="space-y-6">
          {/* 基本情報 */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">イベント名</label>
              <input
                type="text"
                value={editedSettings.name}
                onChange={(e) => setEditedSettings({ ...editedSettings, name: e.target.value })}
                className="w-full bg-white border border-gray-300 rounded px-3 py-2 text-gray-900"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">開催年</label>
                <input
                  type="number"
                  value={editedSettings.year}
                  onChange={(e) => setEditedSettings({ ...editedSettings, year: Number(e.target.value) })}
                  className="w-full bg-white border border-gray-300 rounded px-3 py-2 text-gray-900"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">会場</label>
                <input
                  type="text"
                  value={editedSettings.venue}
                  onChange={(e) => setEditedSettings({ ...editedSettings, venue: e.target.value })}
                  className="w-full bg-white border border-gray-300 rounded px-3 py-2 text-gray-900"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">目標</label>
              <textarea
                value={editedSettings.goal}
                onChange={(e) => setEditedSettings({ ...editedSettings, goal: e.target.value })}
                rows={2}
                className="w-full bg-white border border-gray-300 rounded px-3 py-2 text-gray-900 resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">本番開催日</label>
              <div className="space-y-2">
                {editedSettings.performanceDates.map((date, index) => (
                  <input
                    key={index}
                    type="date"
                    value={date}
                    onChange={(e) => {
                      const updatedDates = [...editedSettings.performanceDates];
                      updatedDates[index] = e.target.value;
                      setEditedSettings({ ...editedSettings, performanceDates: updatedDates });
                    }}
                    className="w-full bg-white border border-gray-300 rounded px-3 py-2 text-gray-900"
                  />
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                日付の追加・削除はできません
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">リハーサル形式</label>
              <input
                type="text"
                value={
                  editedSettings.rehearsalType === 'rehearsal-day' ? '別日リハーサル' :
                  editedSettings.rehearsalType === 'cool-pre-rehearsal' ? 'クール直前リハーサル' :
                  editedSettings.rehearsalType === 'day-start-rehearsal' ? '当日一括リハーサル' :
                  'リハーサルなし'
                }
                disabled
                className="w-full bg-gray-100 border border-gray-200 rounded px-3 py-2 text-gray-500 cursor-not-allowed"
              />
            </div>

            {editedSettings.rehearsalType === 'rehearsal-day' && editedSettings.rehearsalDates && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">リハーサル日</label>
                <div className="space-y-2">
                  {editedSettings.rehearsalDates.map((date, index) => (
                    <input
                      key={index}
                      type="date"
                      value={date}
                      onChange={(e) => {
                        const updatedDates = [...(editedSettings.rehearsalDates || [])];
                        updatedDates[index] = e.target.value;
                        setEditedSettings({ ...editedSettings, rehearsalDates: updatedDates });
                      }}
                      className="w-full bg-white border border-gray-300 rounded px-3 py-2 text-gray-900"
                    />
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  日付の追加・削除はできません
                </p>
              </div>
            )}
          </div>

          <div className="border-t border-gray-200 pt-6">
            {/* リハーサル時間 */}
            {editedSettings.rehearsalType !== 'none' && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  リハーサル時間（分）
                </label>
                <input
                  type="number"
                  value={editedSettings.rehearsalDuration || 0}
                  onChange={(e) => handleRehearsalDurationChange(Number(e.target.value))}
                  min="1"
                  max="120"
                  className="w-full bg-white border border-gray-300 rounded px-3 py-2 text-gray-900"
                />
                <p className="text-xs text-gray-500 mt-1">
                  全バンド共通のリハーサル時間を設定します
                </p>
              </div>
            )}

            {/* プリセット演奏時間 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                演奏時間プリセット（分）
              </label>
              <div className="space-y-2">
                {editedSettings.presetDurations.map((duration, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="number"
                      value={duration}
                      onChange={(e) => handlePresetDurationChange(index, Number(e.target.value))}
                      min="1"
                      max="60"
                      className="flex-1 bg-white border border-gray-300 rounded px-3 py-2 text-gray-900"
                    />
                    <button
                      onClick={() => handlePresetDurationRemove(index)}
                      className="px-3 py-2 bg-red-600 hover:bg-red-700 rounded text-white transition-colors"
                      title="削除"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  onClick={handlePresetDurationAdd}
                  className="w-full py-2 bg-emerald-500 hover:bg-emerald-600 rounded text-white transition-colors"
                >
                  + プリセットを追加
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                バンド管理モードで演奏時間を設定する際のプリセット値です
              </p>
            </div>
          </div>

          <div className="border-t border-gray-200 pt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">APIトークン管理</h3>
            <p className="text-xs text-gray-500 mb-4">
              スクリプト自動登録向けのトークンです。平文トークンは作成時に1回だけ表示されます。
            </p>

            {newlyIssuedToken && (
              <div className="mb-4 rounded border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs text-amber-800 mb-1">新規トークン（この画面でのみ表示）</p>
                <code className="block text-xs break-all text-amber-900">{newlyIssuedToken}</code>
              </div>
            )}

            {tokenError && (
              <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                {tokenError}
              </div>
            )}

            <div className="space-y-3 mb-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">トークン名</label>
                <input
                  type="text"
                  value={tokenName}
                  onChange={(e) => setTokenName(e.target.value)}
                  placeholder="例: Python自動追加"
                  className="w-full bg-white border border-gray-300 rounded px-3 py-2 text-gray-900"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">許可eventId（カンマ区切り）</label>
                <input
                  type="text"
                  value={tokenEventIdsText}
                  onChange={(e) => setTokenEventIdsText(e.target.value)}
                  placeholder="event-1,event-2"
                  className="w-full bg-white border border-gray-300 rounded px-3 py-2 text-gray-900"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">有効期限（日）</label>
                <input
                  type="number"
                  value={tokenExpiresInDays}
                  min={1}
                  max={365}
                  onChange={(e) => setTokenExpiresInDays(Number(e.target.value))}
                  className="w-full bg-white border border-gray-300 rounded px-3 py-2 text-gray-900"
                />
              </div>

              <button
                onClick={() => void handleCreateToken()}
                disabled={isCreatingToken}
                className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 rounded text-white transition-colors"
              >
                {isCreatingToken ? '作成中...' : 'APIトークンを発行'}
              </button>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-gray-800 mb-2">発行済みトークン</h4>
              {isLoadingTokens ? (
                <p className="text-sm text-gray-500">読み込み中...</p>
              ) : tokens.length === 0 ? (
                <p className="text-sm text-gray-500">発行済みトークンはありません。</p>
              ) : (
                <div className="space-y-2">
                  {tokens.map((token) => (
                    <div key={token.id} className="border border-gray-200 rounded p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{token.name}</p>
                          <p className="text-xs text-gray-500">prefix: {token.tokenPrefix}</p>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded ${token.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-600'}`}>
                          {token.status === 'active' ? 'active' : 'revoked'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-600 mt-1 break-all">eventIds: {token.allowedEventIds.join(', ') || '-'}</p>
                      <p className="text-xs text-gray-500 mt-1">有効期限: {formatDate(token.expiresAt)}</p>
                      <p className="text-xs text-gray-500">最終使用: {formatDate(token.lastUsedAt)}</p>

                      <div className="mt-2 flex justify-end">
                        {token.status === 'active' && (
                          <button
                            onClick={() => startEditToken(token)}
                            className="px-3 py-1.5 text-xs rounded bg-gray-700 hover:bg-gray-800 text-white mr-2"
                          >
                            編集
                          </button>
                        )}
                        <button
                          onClick={() => void handleRevokeToken(token.id)}
                          disabled={token.status !== 'active' || isRevokingTokenId === token.id}
                          className="px-3 py-1.5 text-xs rounded bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white"
                        >
                          {isRevokingTokenId === token.id ? '失効中...' : '失効'}
                        </button>
                      </div>

                      {editingTokenId === token.id && (
                        <div className="mt-3 border-t border-gray-200 pt-3 space-y-2">
                          <input
                            type="text"
                            value={editTokenName}
                            onChange={(e) => setEditTokenName(e.target.value)}
                            className="w-full bg-white border border-gray-300 rounded px-2 py-1.5 text-sm text-gray-900"
                            placeholder="トークン名"
                          />
                          <input
                            type="text"
                            value={editTokenEventIdsText}
                            onChange={(e) => setEditTokenEventIdsText(e.target.value)}
                            className="w-full bg-white border border-gray-300 rounded px-2 py-1.5 text-sm text-gray-900"
                            placeholder="event-1,event-2"
                          />
                          <input
                            type="number"
                            value={editTokenExpiresInDays}
                            min={1}
                            max={365}
                            onChange={(e) => setEditTokenExpiresInDays(Number(e.target.value))}
                            className="w-full bg-white border border-gray-300 rounded px-2 py-1.5 text-sm text-gray-900"
                          />
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={cancelEditToken}
                              className="px-3 py-1.5 text-xs rounded bg-gray-200 hover:bg-gray-300 text-gray-700"
                            >
                              キャンセル
                            </button>
                            <button
                              onClick={() => void handleUpdateToken(token.id)}
                              disabled={isUpdatingTokenId === token.id}
                              className="px-3 py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white"
                            >
                              {isUpdatingTokenId === token.id ? '保存中...' : '保存'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* アクションボタン */}
          <div className="flex gap-3 justify-end pt-4 border-t border-gray-200">
            <button
              onClick={onClose}
              className="px-6 py-2 bg-gray-200 hover:bg-gray-300 rounded transition-colors text-gray-700"
            >
              キャンセル
            </button>
            <button
              onClick={handleSave}
              className="px-6 py-2 bg-emerald-500 hover:bg-emerald-600 rounded transition-colors text-white"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
