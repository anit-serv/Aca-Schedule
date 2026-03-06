import { useState, useEffect } from 'react';

const MOBILE_BREAKPOINT = 768;

/**
 * モバイルデバイス検出フック
 * ウィンドウ幅が768px未満の場合にtrueを返す
 */
export const useMobileDetect = (): boolean => {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < MOBILE_BREAKPOINT;
  });

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    
    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile(e.matches);
    };

    // 初回チェック
    handleChange(mql);

    // イベントリスナー登録
    mql.addEventListener('change', handleChange as (e: MediaQueryListEvent) => void);
    return () => {
      mql.removeEventListener('change', handleChange as (e: MediaQueryListEvent) => void);
    };
  }, []);

  return isMobile;
};
