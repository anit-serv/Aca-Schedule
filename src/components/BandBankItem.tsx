import { useDraggable } from '@dnd-kit/core';
import type { Band } from '../types';
import { BandCard } from './BandCard';
import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

interface BandBankItemProps {
  id: string;
  band: Band & { placedCount: number };
  placedCount: number;
  timetableType?: 'performance' | 'rehearsal';
  rehearsalDuration?: number;
  onAddFixed?: (bandId: string) => void;
}

export const BandBankItem = ({ 
  id, 
  band, 
  placedCount, 
  timetableType = 'performance',
  rehearsalDuration = 0,
  onAddFixed,
}: BandBankItemProps) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [menuOpen]);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
  });

  return (
    <div
      ref={setNodeRef}
      className={`relative transition-opacity ${isDragging ? 'opacity-30' : ''}`}
    >
      <div {...listeners} {...attributes} className="cursor-grab active:cursor-grabbing"><BandCard band={band} mode="bank" duration={timetableType === 'rehearsal' ? rehearsalDuration : band.performanceDuration} placedCount={placedCount} showPlacedCount={timetableType === 'performance'} hasBankMenu={Boolean(onAddFixed)} /></div>
      {onAddFixed && <div ref={menuRef} className="absolute top-1 right-1 z-20">
        <button type="button" aria-label={`${band.name}のメニュー`} aria-expanded={menuOpen} title="メニュー" onClick={() => setMenuOpen(!menuOpen)} className="rounded bg-white p-1 text-gray-600 hover:bg-gray-100"><Icon name="more_vert" /></button>
        {menuOpen && <div className="absolute top-8 right-0 z-30 min-w-48 rounded border bg-white p-1 shadow-lg"><button type="button" onClick={() => { setMenuOpen(false); onAddFixed(band.id); }} className="w-full rounded px-2 py-2 text-left text-sm hover:bg-emerald-50"><Icon name="lock_clock" className="mr-1" />時刻を固定して追加</button></div>}
      </div>}
    </div>
  );
};
