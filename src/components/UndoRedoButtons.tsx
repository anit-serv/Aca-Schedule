import { Icon } from './Icon';

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
        <Icon name="undo" className="text-base" />
      </button>
      <button
        onClick={onRedo}
        disabled={!canRedo}
        title="やり直す (Ctrl+Shift+Z)"
        className="p-2 rounded-md text-gray-500 hover:text-gray-800 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <Icon name="redo" className="text-base" />
      </button>
    </div>
  );
};
