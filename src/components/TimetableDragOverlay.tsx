import { DragOverlay, defaultDropAnimationSideEffects } from '@dnd-kit/core';
import type { Band, CustomEvent, TimetableEntry } from '../types';

interface TimetableDragOverlayProps {
  activeBand: Band | null | undefined;
  activeCustomEvent: CustomEvent | null | undefined;
  activeEntry: TimetableEntry | null | undefined;
  bands: Band[];
  dropSucceeded: boolean;
}

export const TimetableDragOverlay = ({
  activeBand,
  activeCustomEvent,
  activeEntry,
  bands,
  dropSucceeded,
}: TimetableDragOverlayProps) => {
  return (
    <DragOverlay
      dropAnimation={
        dropSucceeded
          ? null // ドロップ成功時はアニメーションなし
          : {
              duration: 250,
              easing: 'ease',
              sideEffects: defaultDropAnimationSideEffects({
                styles: {
                  active: {
                    opacity: '0.5',
                  },
                },
              }),
            }
      }
    >
      {activeBand && (
        <div className="bg-blue-600 text-white px-4 py-3 rounded shadow-lg">
          <div className="font-semibold">{activeBand.name}</div>
          <div className="text-sm">{activeBand.performanceDuration}分</div>
        </div>
      )}
      {activeCustomEvent && (
        <div className="bg-purple-600 text-white px-4 py-3 rounded shadow-lg">
          <div className="font-semibold">{activeCustomEvent.name}</div>
          <div className="text-sm">{activeCustomEvent.duration}分</div>
        </div>
      )}
      {activeEntry && (
        <div className="bg-gray-700 text-white px-4 py-3 rounded shadow-lg min-w-[300px]">
          {activeEntry.type === 'band' && activeEntry.bandId ? (
            <>
              <div className="font-semibold">
                {bands.find((b) => b.id === activeEntry.bandId)?.name || '(不明)'}
              </div>
              <div className="text-sm text-gray-300">
                {bands.find((b) => b.id === activeEntry.bandId)?.performanceDuration || 0}分
              </div>
            </>
          ) : activeEntry.type === 'custom' && activeEntry.customEvent ? (
            <>
              <div className="font-semibold text-purple-300">
                {activeEntry.customEvent.name}
              </div>
              <div className="text-sm text-gray-300">
                {activeEntry.customEvent.duration}分
              </div>
            </>
          ) : (
            <div className="font-semibold">(不明)</div>
          )}
        </div>
      )}
    </DragOverlay>
  );
};
