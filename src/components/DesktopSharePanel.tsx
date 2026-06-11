import type { Dispatch, SetStateAction } from 'react';
import { Icon } from './Icon';
import { CollaboratorDetailModal } from './CollaboratorDetailModal';
import { eventService, collaboratorService } from '../services/firestore';
import type { AppUser, EventSettings } from '../types';

interface DesktopSharePanelProps {
  eventSettings: EventSettings;
  currentUser: AppUser | null;
  setEventSettings: Dispatch<SetStateAction<EventSettings | null>>;
  shareUrlCopied: boolean;
  setShareUrlCopied: Dispatch<SetStateAction<boolean>>;
  collaboratorEmail: string;
  setCollaboratorEmail: Dispatch<SetStateAction<string>>;
  collaboratorError: string;
  setCollaboratorError: Dispatch<SetStateAction<string>>;
  isCollaboratorProcessing: boolean;
  setIsCollaboratorProcessing: Dispatch<SetStateAction<boolean>>;
  setShowSharePanel: Dispatch<SetStateAction<boolean>>;
  showCollaboratorDetail: boolean;
  setShowCollaboratorDetail: Dispatch<SetStateAction<boolean>>;
  showTransferConfirm: boolean;
  setShowTransferConfirm: Dispatch<SetStateAction<boolean>>;
}

/**
 * デスクトップ用の共有設定ドロップダウンパネル。
 * 公開トグル・共有URL・共同編集者の追加/一覧（オーナー向け）と、
 * 公開状態の表示/辞退（共同編集者向け）を表示する。
 */
export const DesktopSharePanel = ({
  eventSettings,
  currentUser,
  setEventSettings,
  shareUrlCopied,
  setShareUrlCopied,
  collaboratorEmail,
  setCollaboratorEmail,
  collaboratorError,
  setCollaboratorError,
  isCollaboratorProcessing,
  setIsCollaboratorProcessing,
  setShowSharePanel,
  showCollaboratorDetail,
  setShowCollaboratorDetail,
  showTransferConfirm,
  setShowTransferConfirm,
}: DesktopSharePanelProps) => {
  return (
    <>
      {/* 共有パネル */}
      <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-lg border border-gray-200 z-50 p-4">
        <h3 className="text-sm font-bold text-gray-900 mb-3">共有設定</h3>

        {/* 公開トグル（オーナーのみ） */}
        {currentUser && eventSettings.ownerId === currentUser.uid && (
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm text-gray-700">閲覧用ページを公開</p>
            <p className="text-xs text-gray-400 mt-0.5">リンクを知っている人が閲覧できます</p>
          </div>
          <button
            onClick={async () => {
              const newValue = !eventSettings.isPublic;
              try {
                await eventService.updateEvent(eventSettings.id, { isPublic: newValue });
                setEventSettings(prev => prev ? { ...prev, isPublic: newValue } : null);
              } catch (error) {
                console.error('共有設定の更新に失敗:', error);
                alert('共有設定の更新に失敗しました。');
              }
            }}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
              eventSettings.isPublic ? 'bg-emerald-500' : 'bg-gray-300'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow ${
                eventSettings.isPublic ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
        )}

        {/* 注意書き */}
        {eventSettings.isPublic && (
          <div className="bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mb-3">
            <p className="text-xs text-amber-700">
              <Icon name="warning" className="text-sm align-middle mr-1" />バンド名を含むタイムテーブル情報が公開されます
            </p>
          </div>
        )}

        {/* URL表示・コピー */}
        {eventSettings.isPublic && (
          <div className="mb-3">
            <p className="text-xs text-gray-500 mb-1.5">共有URL</p>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={`${window.location.origin}/share/${eventSettings.id}`}
                className="flex-1 bg-gray-50 border border-gray-200 rounded px-2 py-1.5 text-xs text-gray-700 font-mono truncate"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(`${window.location.origin}/share/${eventSettings.id}`);
                  setShareUrlCopied(true);
                  setTimeout(() => setShareUrlCopied(false), 2000);
                }}
                className="px-3 py-1.5 rounded text-xs font-medium bg-emerald-500 hover:bg-emerald-600 text-white transition-colors whitespace-nowrap"
              >
                {shareUrlCopied ? <><Icon name="check" className="text-sm align-middle mr-0.5" />コピー済</> : 'コピー'}
              </button>
            </div>
          </div>
        )}

        {/* 共同編集者の追加（オーナーのみ） */}
        {currentUser && eventSettings.ownerId === currentUser.uid && (
          <div className="border-t border-gray-200 pt-3 mt-1">
            <h4 className="text-sm font-bold text-gray-900 mb-2">共同編集者を追加</h4>

            {/* 招待フォーム */}
            <div className="flex gap-2 mb-2">
              <input
                type="email"
                value={collaboratorEmail}
                onChange={(e) => { setCollaboratorEmail(e.target.value); setCollaboratorError(''); }}
                placeholder="example@email.com"
                className="flex-1 bg-gray-50 border border-gray-200 rounded px-2 py-1.5 text-xs text-gray-700 placeholder-gray-400"
                disabled={isCollaboratorProcessing}
              />
              <button
                onClick={async () => {
                  const email = collaboratorEmail.trim().toLowerCase();
                  if (!email) return;
                  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                    setCollaboratorError('有効なメールアドレスを入力してください');
                    return;
                  }
                  if (currentUser.email && email === currentUser.email.toLowerCase()) {
                    setCollaboratorError('自分自身は追加できません');
                    return;
                  }
                  if (eventSettings.collaboratorEmails?.includes(email) || eventSettings.pendingCollaboratorEmails?.includes(email)) {
                    setCollaboratorError('既に追加されています');
                    return;
                  }
                  setIsCollaboratorProcessing(true);
                  try {
                    await collaboratorService.addCollaborator(eventSettings.id, email);
                    setEventSettings(prev => prev ? {
                      ...prev,
                      pendingCollaboratorEmails: [...(prev.pendingCollaboratorEmails || []), email],
                    } : null);
                    setCollaboratorEmail('');
                    setCollaboratorError('');
                  } catch (error) {
                    console.error('共同編集者の追加に失敗:', error);
                    setCollaboratorError('追加に失敗しました');
                  } finally {
                    setIsCollaboratorProcessing(false);
                  }
                }}
                className="px-3 py-1.5 rounded text-xs font-medium bg-emerald-500 hover:bg-emerald-600 text-white transition-colors whitespace-nowrap disabled:opacity-50"
                disabled={isCollaboratorProcessing || !collaboratorEmail.trim()}
              >
                追加
              </button>
            </div>
            {collaboratorError && (
              <p className="text-xs text-red-500 mb-2">{collaboratorError}</p>
            )}

            {/* 共同編集者一覧（承認済み + 招待中） */}
            {((eventSettings.collaboratorEmails?.length ?? 0) + (eventSettings.pendingCollaboratorEmails?.length ?? 0)) > 0 && (
              <div className="space-y-1.5 mb-3">
                {eventSettings.collaboratorEmails?.map((email) => (
                  <div key={email} className="flex items-center gap-2 bg-gray-50 rounded px-2 py-1.5">
                    <span className="text-xs text-gray-700 truncate flex-1">{email}</span>
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-700 flex-shrink-0">
                      承認済み
                    </span>
                  </div>
                ))}
                {eventSettings.pendingCollaboratorEmails?.map((email) => (
                  <div key={email} className="flex items-center gap-2 bg-gray-50 rounded px-2 py-1.5">
                    <span className="text-xs text-gray-700 truncate flex-1">{email}</span>
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 flex-shrink-0">
                      招待中
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* 詳細リンク */}
            <button
              onClick={() => { setShowSharePanel(false); setShowCollaboratorDetail(true); }}
              className="flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-700 transition-colors"
            >
              <Icon name="group" className="text-sm" />
              <span className="underline">
                {((eventSettings.collaboratorEmails?.length ?? 0) + (eventSettings.pendingCollaboratorEmails?.length ?? 0)) > 0
                  ? `${(eventSettings.collaboratorEmails?.length ?? 0) + (eventSettings.pendingCollaboratorEmails?.length ?? 0)}人の共同編集者を管理`
                  : '共同編集者の管理'}
              </span>
            </button>
          </div>
        )}

        {/* 共同編集者向けの表示（オーナー以外） */}
        {currentUser && eventSettings.ownerId !== currentUser.uid && (
          <div>
            {/* 公開状態の表示（読み取り専用） */}
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm text-gray-700">閲覧用ページ</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {eventSettings.isPublic ? '公開中' : '非公開'}
                </p>
              </div>
              <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                eventSettings.isPublic ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
              }`}>
                {eventSettings.isPublic ? '公開' : '非公開'}
              </span>
            </div>

            {/* 公開URLの表示 */}
            {eventSettings.isPublic && (
              <div className="mb-3">
                <p className="text-xs text-gray-500 mb-1.5">共有URL</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={`${window.location.origin}/share/${eventSettings.id}`}
                    className="flex-1 bg-gray-50 border border-gray-200 rounded px-2 py-1.5 text-xs text-gray-700 font-mono truncate"
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/share/${eventSettings.id}`);
                      setShareUrlCopied(true);
                      setTimeout(() => setShareUrlCopied(false), 2000);
                    }}
                    className="px-3 py-1.5 rounded text-xs font-medium bg-emerald-500 hover:bg-emerald-600 text-white transition-colors whitespace-nowrap"
                  >
                    {shareUrlCopied ? <><Icon name="check" className="text-sm align-middle mr-0.5" />コピー済</> : 'コピー'}
                  </button>
                </div>
              </div>
            )}

            {/* 共同編集者一覧（読み取り専用） */}
            {((eventSettings.collaboratorEmails?.length ?? 0) + (eventSettings.pendingCollaboratorEmails?.length ?? 0)) > 0 && (
              <div className="border-t border-gray-200 pt-3 mt-1 mb-3">
                <h4 className="text-sm font-bold text-gray-900 mb-2">共同編集者</h4>
                <div className="space-y-1.5">
                  {eventSettings.collaboratorEmails?.map((email) => (
                    <div key={email} className="flex items-center gap-2 bg-gray-50 rounded px-2 py-1.5">
                      <span className="text-xs text-gray-700 truncate flex-1">{email}</span>
                      {currentUser.email && email.toLowerCase() === currentUser.email.toLowerCase() && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700 flex-shrink-0">
                          あなた
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 共同編集を辞退 */}
            <div className="border-t border-gray-200 pt-3 mt-1">
              <button
                onClick={async () => {
                  if (!currentUser?.email) return;
                  if (!confirm('このイベントの共同編集を辞退しますか？')) return;
                  setIsCollaboratorProcessing(true);
                  try {
                    await collaboratorService.declineCollaboration(eventSettings.id, currentUser.email);
                    // ホーム画面に戻る
                    window.location.href = '/';
                  } catch (error) {
                    console.error('共同編集の辞退に失敗:', error);
                    alert('辞退に失敗しました');
                  } finally {
                    setIsCollaboratorProcessing(false);
                  }
                }}
                className="text-xs text-gray-500 hover:text-red-500 transition-colors underline"
                disabled={isCollaboratorProcessing}
              >
                共同編集を辞退する
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 共同編集者詳細モーダル */}
      {showCollaboratorDetail && (
        <CollaboratorDetailModal
          eventSettings={eventSettings}
          currentUser={currentUser}
          setEventSettings={setEventSettings}
          isCollaboratorProcessing={isCollaboratorProcessing}
          setIsCollaboratorProcessing={setIsCollaboratorProcessing}
          showTransferConfirm={showTransferConfirm}
          setShowTransferConfirm={setShowTransferConfirm}
          setShowCollaboratorDetail={setShowCollaboratorDetail}
        />
      )}
    </>
  );
};
