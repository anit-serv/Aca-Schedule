import { useState, type Dispatch, type SetStateAction } from 'react';
import { Icon } from './Icon';
import { copyToClipboard } from '../utils/copyToClipboard';
import { eventService } from '../services/firestore';
import { Link } from 'react-router-dom';
import type { AppUser, EventSettings } from '../types';

interface MobileSharePanelProps {
  eventSettings: EventSettings;
  currentUser: AppUser | null;
  setEventSettings: Dispatch<SetStateAction<EventSettings | null>>;
  shareUrlCopied: boolean;
  setShareUrlCopied: Dispatch<SetStateAction<boolean>>;
  setShowSharePanel: Dispatch<SetStateAction<boolean>>;
  setShowCollaboratorDetail: Dispatch<SetStateAction<boolean>>;
}

/**
 * モバイル用の共有設定ボトムシート。
 * 公開トグル・共有URL・共同編集者数（タップで詳細モーダルを開く）を表示する。
 */
export const MobileSharePanel = ({
  eventSettings,
  currentUser,
  setEventSettings,
  shareUrlCopied,
  setShareUrlCopied,
  setShowSharePanel,
  setShowCollaboratorDetail,
}: MobileSharePanelProps) => {
  const [copyError, setCopyError] = useState(false);

  const handleCopy = async () => {
    const copied = await copyToClipboard(`${window.location.origin}/share/${eventSettings.id}`);
    setCopyError(!copied);
    if (!copied) return;
    setShareUrlCopied(true);
    setTimeout(() => setShareUrlCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50" onClick={() => setShowSharePanel(false)}>
      <div
        className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h3 className="text-base font-bold text-gray-900">共有設定</h3>
          <button
            onClick={() => setShowSharePanel(false)}
            className="p-1 rounded-full hover:bg-gray-100 text-gray-400"
          >
            <Icon name="close" className="text-xl" />
          </button>
        </div>
        <div className="px-4 pb-6 space-y-4">
          {/* 公開トグル */}
          {currentUser && eventSettings.ownerId === currentUser.uid && (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-700">一般公開ページを公開</p>
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
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
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

          {/* URL表示・コピー */}
          {eventSettings.isPublic && (
            <div>
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
                  type="button"
                  onClick={() => { void handleCopy(); }}
                  className="px-3 py-1.5 rounded text-xs font-medium bg-emerald-500 text-white"
                >
                  {shareUrlCopied ? <><Icon name="check" className="text-sm align-middle mr-0.5" />コピー済</> : 'コピー'}
                </button>
              </div>
              {copyError && <p role="alert" className="mt-1 text-xs text-red-600">コピーできませんでした。URL欄を長押ししてコピーしてください。</p>}
            </div>
          )}

          {currentUser && eventSettings.ownerId === currentUser.uid && (
            <Link to={`/events/${eventSettings.id}/stakeholder-settings`} className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm font-medium text-emerald-800">
              関係者ページのパスワード設定
              <Icon name="chevron_right" className="text-lg" />
            </Link>
          )}

          {/* 共同編集者数 */}
          {((eventSettings.collaboratorEmails?.length ?? 0) + (eventSettings.pendingCollaboratorEmails?.length ?? 0)) > 0 && (
            <button
              onClick={() => { setShowSharePanel(false); setShowCollaboratorDetail(true); }}
              className="w-full flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2.5"
            >
              <span className="text-sm text-gray-700">
                共同編集者 ({(eventSettings.collaboratorEmails?.length ?? 0) + (eventSettings.pendingCollaboratorEmails?.length ?? 0)}人)
              </span>
              <Icon name="chevron_right" className="text-base text-gray-400" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
