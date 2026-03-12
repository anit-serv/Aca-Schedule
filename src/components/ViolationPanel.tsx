import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { ConstraintViolation } from '../types';

interface ViolationPanelProps {
  violations: ConstraintViolation[];
  isOpen: boolean;
  onToggle: () => void;
  onViolationClick?: (violation: ConstraintViolation) => void;
}

export const ViolationPanel = ({ violations, isOpen, onToggle, onViolationClick }: ViolationPanelProps) => {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['performance', 'rehearsal']));

  if (violations.length === 0) return null;

  // 一意の違反のみを抽出する関数
  const getUniqueViolations = () => {
    const uniqueViolations = new Map<string, ConstraintViolation>();
    violations.forEach(v => {
      if (v.type === 'duplicate-in-cool') {
        const baseId = v.id.replace(/-ref-.*$/, '');
        if (!v.id.includes('-ref-')) {
          uniqueViolations.set(baseId, v);
        }
      } else if (v.type === 'consecutive-performance') {
        const baseId = v.id.replace(/-ref$/, '');
        if (!v.id.includes('-ref')) {
          uniqueViolations.set(baseId, v);
        }
      } else {
        uniqueViolations.set(v.id, v);
      }
    });
    return uniqueViolations;
  };

  const uniqueViolations = getUniqueViolations();
  const uniqueCount = uniqueViolations.size;
  const uniqueList = Array.from(uniqueViolations.values());

  // 本番・リハに分類
  const performanceViolations = uniqueList.filter(v => v.message.startsWith('[本番'));
  const rehearsalViolations = uniqueList.filter(v => v.message.startsWith('[リハ'));

  // 最も重大な違反を判定
  const getMostSeverity = (list: ConstraintViolation[]): 'high' | 'medium' | 'low' | null => {
    if (list.some(v => v.severity === 'high')) return 'high';
    if (list.some(v => v.severity === 'medium')) return 'medium';
    if (list.some(v => v.severity === 'low')) return 'low';
    return null;
  };

  const overallSeverity = getMostSeverity(uniqueList);
  const performanceSeverity = getMostSeverity(performanceViolations);
  const rehearsalSeverity = getMostSeverity(rehearsalViolations);

  // 重大度ごとの色・記号
  const severityConfig = {
    high: { icon: '🚫', bg: 'bg-rose-100', border: 'border-rose-300', text: 'text-rose-600', hoverBg: 'hover:bg-rose-200' },
    medium: { icon: '⚠️', bg: 'bg-amber-100', border: 'border-amber-300', text: 'text-amber-600', hoverBg: 'hover:bg-amber-200' },
    low: { icon: 'ℹ️', bg: 'bg-sky-100', border: 'border-sky-300', text: 'text-sky-600', hoverBg: 'hover:bg-sky-200' },
  };

  const buttonConfig = overallSeverity ? severityConfig[overallSeverity] : severityConfig.medium;

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  // 重大度でソートしたviolationsを返す
  const sortByPriority = (list: ConstraintViolation[]) => {
    const priority = { high: 0, medium: 1, low: 2 };
    return [...list].sort((a, b) => priority[a.severity] - priority[b.severity]);
  };

  // セクションのレンダリング
  const renderSection = (
    title: string,
    sectionKey: string,
    sectionViolations: ConstraintViolation[],
    severity: 'high' | 'medium' | 'low' | null
  ) => {
    if (sectionViolations.length === 0) return null;

    const config = severity ? severityConfig[severity] : severityConfig.medium;
    const isExpanded = expandedSections.has(sectionKey);
    const sorted = sortByPriority(sectionViolations);
    const highCount = sectionViolations.filter(v => v.severity === 'high').length;
    const mediumCount = sectionViolations.filter(v => v.severity === 'medium').length;
    const lowCount = sectionViolations.filter(v => v.severity === 'low').length;

    return (
      <div className="mb-3">
        <button
          onClick={() => toggleSection(sectionKey)}
          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg ${config.bg} ${config.border} border ${config.hoverBg} transition-colors`}
        >
          <div className="flex items-center gap-2">
            <span>{config.icon}</span>
            <span className={`font-bold ${config.text}`}>{title}</span>
            <span className="text-xs text-gray-500">
              ({sectionViolations.length}件)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex gap-1 text-[10px]">
              {highCount > 0 && <span className="text-rose-600">🚫{highCount}</span>}
              {mediumCount > 0 && <span className="text-amber-600">⚠️{mediumCount}</span>}
              {lowCount > 0 && <span className="text-sky-600">ℹ️{lowCount}</span>}
            </div>
            <motion.span
              animate={{ rotate: isExpanded ? 180 : 0 }}
              transition={{ duration: 0.2 }}
              className="text-sm"
            >▼</motion.span>
          </div>
        </button>
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              <div className="mt-2 space-y-1 pl-2">
                {sorted.map((v, idx) => {
                  const itemConfig = severityConfig[v.severity];
                  return (
                    <div
                      key={idx}
                      className={`text-xs px-2 py-1.5 rounded cursor-pointer transition-colors ${
                        v.severity === 'high' ? 'bg-rose-50 hover:bg-rose-100 text-rose-700' :
                        v.severity === 'medium' ? 'bg-amber-50 hover:bg-amber-100 text-amber-700' :
                        'bg-sky-50 hover:bg-sky-100 text-sky-700'
                      }`}
                      onClick={() => onViolationClick?.(v)}
                      title="クリックして該当箇所へ移動"
                    >
                      {itemConfig.icon} {v.message}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <>
      {/* スライドパネル */}
      <div
        className={`fixed left-0 bg-white rounded-r-lg p-4 overflow-y-auto shadow-xl border-r border-t border-b border-gray-200 transition-transform duration-300 ease-in-out z-30 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{
          width: '360px',
          top: '8.5rem',
          height: 'calc(100vh - 8.5rem - 1.5rem)',
        }}
      >
        <h3 className="text-lg font-bold mb-3 flex items-center gap-2 whitespace-nowrap text-gray-900">
          <span>{buttonConfig.icon}</span>
          制約違反 ({uniqueCount}件)
        </h3>
        <div>
          {renderSection('本番', 'performance', performanceViolations, performanceSeverity)}
          {renderSection('リハーサル', 'rehearsal', rehearsalViolations, rehearsalSeverity)}
        </div>
      </div>

      {/* 取っ手部分 - 最も重大な違反の色・記号に合わせる */}
      <button
        onClick={onToggle}
        className={`fixed ${buttonConfig.bg} ${buttonConfig.hoverBg} transition-all duration-300 ease-in-out rounded-r-lg shadow-lg border-r-2 border-t-2 border-b-2 ${buttonConfig.border} z-30 ${
          isOpen ? 'left-[360px]' : 'left-0'
        }`}
        style={{
          top: '9rem',
        }}
        title={isOpen ? '制約違反を閉じる' : '制約違反を表示'}
      >
        <div className="px-1.5 py-2 flex flex-col items-center gap-1">
          <span className="text-base">{buttonConfig.icon}</span>
          <span className={`text-[10px] font-bold ${buttonConfig.text}`}>{uniqueCount}</span>
        </div>
      </button>
    </>
  );
};
