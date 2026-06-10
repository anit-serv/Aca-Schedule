import type { Dispatch, SetStateAction } from 'react';
import { Icon } from './Icon';
import { collaboratorService } from '../services/firestore';
import type { AppUser, EventSettings } from '../types';

interface CollaboratorDetailModalProps {
  eventSettings: EventSettings;
  currentUser: AppUser | null;
  setEventSettings: Dispatch<SetStateAction<EventSettings | null>>;
  isCollaboratorProcessing: boolean;
  setIsCollaboratorProcessing: Dispatch<SetStateAction<boolean>>;
  showTransferConfirm: boolean;
  setShowTransferConfirm: Dispatch<SetStateAction<boolean>>;
  setShowCollaboratorDetail: Dispatch<SetStateAction<boolean>>;
}

/**
 * 共同編集者の管理（一覧・削除・招待取り消し・オーナー権限移譲）を行う詳細モーダル。
 * デスクトップの共有パネルから開かれる。
 */
export const CollaboratorDetailModal = ({
  eventSettings,
  currentUser,
  setEventSettings,
  isCollaboratorProcessing,
  setIsCollaboratorProcessing,
  showTransferConfirm,
  setShowTransferConfirm,
  setShowCollaboratorDetail,
}: CollaboratorDetailModalProps) => {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100]" onClick={() => setShowCollaboratorDetail(false)}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-gray-900">共同編集者の管理</h3>
          <button
            onClick={() => setShowCollaboratorDetail(false)}
            className="p-1 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <Icon name="close" className="text-xl" />
          </button>
        </div>

        {/* オーナー権限移譲の保留通知（移譲先ユーザーに表示） */}
        {eventSettings.pendingOwnerEmail
          && currentUser?.email
          && eventSettings.pendingOwnerEmail.toLowerCase() === currentUser.email.toLowerCase()
          && eventSettings.ownerId !== currentUser.uid && (
          <div className="bg-blue-50 border border-blue-200 rounded-md px-3 py-3 mb-4">
            <p className="text-sm font-bold text-blue-800 mb-2"><Icon name="mail" className="text-base align-middle mr-1" />オーナー権限の移譲リクエスト</p>
            <p className="text-xs text-blue-700 mb-3">このイベントのオーナー権限があなたに移譲されようとしています。</p>
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  if (!currentUser?.email) return;
                  setIsCollaboratorProcessing(true);
                  try {
                    await collaboratorService.acceptOwnerTransfer(
                      eventSettings.id,
                      currentUser.uid,
                      currentUser.email
                    );
                    window.location.reload();
                  } catch (error) {
                    console.error('オーナー権限の承認に失敗:', error);
                    alert('オーナー権限の承認に失敗しました。');
                  } finally {
                    setIsCollaboratorProcessing(false);
                  }
                }}
                className="px-3 py-1.5 rounded text-xs font-medium bg-blue-500 hover:bg-blue-600 text-white transition-colors"
                disabled={isCollaboratorProcessing}
              >
                承認する
              </button>
              <button
                onClick={async () => {
                  setIsCollaboratorProcessing(true);
                  try {
                    await collaboratorService.declineOwnerTransfer(eventSettings.id);
                    setEventSettings(prev => prev ? { ...prev, pendingOwnerEmail: undefined } : null);
                  } catch (error) {
                    console.error('オーナー権限の拒否に失敗:', error);
                    alert('オーナー権限の拒否に失敗しました。');
                  } finally {
                    setIsCollaboratorProcessing(false);
                  }
                }}
                className="px-3 py-1.5 rounded text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
                disabled={isCollaboratorProcessing}
              >
                拒否する
              </button>
            </div>
          </div>
        )}

        {/* 共同編集者一覧 */}
        <div className="mb-4">
          <p className="text-sm text-gray-500 mb-2">承認済みの共同編集者</p>
          {(eventSettings.collaboratorEmails?.length ?? 0) > 0 ? (
            <div className="space-y-2">
              {eventSettings.collaboratorEmails!.map((email) => (
                <div key={email} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                      {email[0].toUpperCase()}
                    </div>
                    <span className="text-sm text-gray-700 truncate">{email}</span>
                  </div>
                  {currentUser && eventSettings.ownerId === currentUser.uid && (
                    <button
                      onClick={async () => {
                        if (!confirm(`${email} を共同編集者から削除しますか？`)) return;
                        setIsCollaboratorProcessing(true);
                        try {
                          await collaboratorService.removeCollaborator(eventSettings.id, email);
                          setEventSettings(prev => prev ? {
                            ...prev,
                            collaboratorEmails: (prev.collaboratorEmails || []).filter(e => e !== email),
                          } : null);
                        } catch (error) {
                          console.error('共同編集者の削除に失敗:', error);
                          alert('削除に失敗しました');
                        } finally {
                          setIsCollaboratorProcessing(false);
                        }
                      }}
                      className="ml-2 p-1 rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                      disabled={isCollaboratorProcessing}
                      title="削除"
                    >
                      <Icon name="close" className="text-base" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400">承認済みの共同編集者はいません</p>
          )}
        </div>

        {/* 招待中の共同編集者一覧 */}
        {(eventSettings.pendingCollaboratorEmails?.length ?? 0) > 0 && (
          <div className="mb-4">
            <p className="text-sm text-gray-500 mb-2">招待中</p>
            <div className="space-y-2">
              {eventSettings.pendingCollaboratorEmails!.map((email) => (
                <div key={email} className="flex items-center justify-between bg-amber-50 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-7 h-7 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                      {email[0].toUpperCase()}
                    </div>
                    <span className="text-sm text-gray-700 truncate">{email}</span>
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 flex-shrink-0">
                      招待中
                    </span>
                  </div>
                  {currentUser && eventSettings.ownerId === currentUser.uid && (
                    <button
                      onClick={async () => {
                        if (!confirm(`${email} への招待を取り消しますか？`)) return;
                        setIsCollaboratorProcessing(true);
                        try {
                          await collaboratorService.removeCollaborator(eventSettings.id, email);
                          setEventSettings(prev => prev ? {
                            ...prev,
                            pendingCollaboratorEmails: (prev.pendingCollaboratorEmails || []).filter(e => e !== email),
                          } : null);
                        } catch (error) {
                          console.error('招待の取り消しに失敗:', error);
                          alert('取り消しに失敗しました');
                        } finally {
                          setIsCollaboratorProcessing(false);
                        }
                      }}
                      className="ml-2 p-1 rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                      disabled={isCollaboratorProcessing}
                      title="招待取り消し"
                    >
                      <Icon name="close" className="text-base" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* オーナー権限移譲（オーナーのみ） */}
        {currentUser && eventSettings.ownerId === currentUser.uid && (
          <div className="border-t border-gray-200 pt-4">
            <h4 className="text-sm font-bold text-gray-900 mb-2">オーナー権限の移譲</h4>
            {(eventSettings.collaboratorEmails?.length ?? 0) === 0 ? (
              <p className="text-xs text-gray-400">承認済みの共同編集者がいると、オーナー権限を移譲できます。</p>
            ) : eventSettings.pendingOwnerEmail ? (
              <div className="bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                <p className="text-xs text-amber-700 mb-2">
                  <span className="font-bold">{eventSettings.pendingOwnerEmail}</span> に移譲リクエスト中
                </p>
                <button
                  onClick={async () => {
                    setIsCollaboratorProcessing(true);
                    try {
                      await collaboratorService.cancelOwnerTransfer(eventSettings.id);
                      setEventSettings(prev => prev ? { ...prev, pendingOwnerEmail: undefined } : null);
                    } catch (error) {
                      console.error('移譲キャンセルに失敗:', error);
                      alert('キャンセルに失敗しました');
                    } finally {
                      setIsCollaboratorProcessing(false);
                    }
                  }}
                  className="px-3 py-1.5 rounded text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
                  disabled={isCollaboratorProcessing}
                >
                  キャンセル
                </button>
              </div>
            ) : showTransferConfirm ? (
              <div>
                <p className="text-xs text-gray-400 mb-2">移譲先の共同編集者を選択してください。相手が承認すると、あなたは共同編集者になります。</p>
                <div className="space-y-1.5 mb-3">
                  {eventSettings.collaboratorEmails!.map((email) => (
                    <button
                      key={email}
                      onClick={async () => {
                        if (!confirm(`${email} にオーナー権限を移譲しますか？\n相手が承認すると、あなたは共同編集者になります。`)) return;
                        setIsCollaboratorProcessing(true);
                        try {
                          await collaboratorService.initiateOwnerTransfer(eventSettings.id, email, currentUser.email!);
                          setEventSettings(prev => prev ? { ...prev, pendingOwnerEmail: email } : null);
                          setShowTransferConfirm(false);
                        } catch (error) {
                          console.error('移譲リクエストに失敗:', error);
                          alert('移譲リクエストに失敗しました');
                        } finally {
                          setIsCollaboratorProcessing(false);
                        }
                      }}
                      className="w-full flex items-center gap-2 bg-gray-50 hover:bg-amber-50 hover:border-amber-300 border border-gray-200 rounded-lg px-3 py-2 text-left transition-colors"
                      disabled={isCollaboratorProcessing}
                    >
                      <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                        {email[0].toUpperCase()}
                      </div>
                      <span className="text-sm text-gray-700 truncate">{email}</span>
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setShowTransferConfirm(false)}
                  className="px-3 py-1.5 rounded text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
                >
                  やめる
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowTransferConfirm(true)}
                className="text-xs text-gray-500 hover:text-amber-600 transition-colors underline"
              >
                共同編集者にオーナー権限を移譲
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
