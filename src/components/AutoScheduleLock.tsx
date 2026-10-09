export const AutoScheduleLock = () => (
  <div className="fixed inset-0 z-[300] flex items-center justify-center bg-gray-950/45 px-4" role="status" aria-live="polite">
    <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl">
      <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-emerald-100 border-t-emerald-500" />
      <h2 className="text-lg font-bold text-gray-900">自動配置中</h2>
      <p className="mt-2 text-sm text-gray-600">サーバーで計算しています。タイムテーブルとバンド管理は完了まで編集できません。</p>
      <p className="mt-3 text-xs text-gray-500">画面を再読み込みしても処理は続きます。</p>
    </div>
  </div>
);
