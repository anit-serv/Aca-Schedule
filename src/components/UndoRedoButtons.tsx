interface UndoRedoButtonsProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export const UndoRedoButtons = ({ canUndo, canRedo, onUndo, onRedo }: UndoRedoButtonsProps) => {
  return (
    <div className="flex items-center gap-0.5">
      <button
        onClick={onUndo}
        disabled={!canUndo}
        title="元に戻す (Ctrl+Z)"
        className="p-2 rounded-md text-gray-500 hover:text-gray-800 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
        </svg>
      </button>
      <button
        onClick={onRedo}
        disabled={!canRedo}
        title="やり直す (Ctrl+Shift+Z)"
        className="p-2 rounded-md text-gray-500 hover:text-gray-800 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3" />
        </svg>
      </button>
    </div>
  );
};
