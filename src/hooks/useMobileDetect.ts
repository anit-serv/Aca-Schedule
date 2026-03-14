import { useState, useEffect } from 'react';

const MOBILE_BREAKPOINT = 1024;
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

/**
 * モバイルデバイス検出フック
 * ウィンドウ幅が1024px未満の場合にtrueを返す（タブレット含む）
 */
export const useMobileDetect = (): boolean => {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(MOBILE_QUERY).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);

    const update = () => {
      setIsMobile(mql.matches);
    };

    // 初回チェック
    update();

    // イベントリスナー登録
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', update);
    } else {
      mql.addListener(update);
    }
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    window.visualViewport?.addEventListener('resize', update);

    return () => {
      if (typeof mql.removeEventListener === 'function') {
        mql.removeEventListener('change', update);
      } else {
        mql.removeListener(update);
      }
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, []);

  return isMobile;
};
