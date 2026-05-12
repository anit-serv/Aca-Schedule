/**
 * クライアント側書き込みレート制限
 *
 * 通常の操作: 数回/分 程度
 * 警告閾値:   60回/分 (1回/秒)
 * 遮断閾値:  120回/分 (2回/秒) → 30秒のクールダウン
 *
 * ループバグ時: 300〜360回/分 → 確実に遮断される
 */

const WINDOW_MS = 60_000;       // カウントウィンドウ: 1分
const WARN_THRESHOLD = 60;      // 1分に60回で警告
const BLOCK_THRESHOLD = 120;    // 1分に120回で遮断
const COOLDOWN_MS = 30_000;     // 遮断後のクールダウン: 30秒

class WriteRateLimiter {
  private timestamps: number[] = [];
  private blockedUntil = 0;
  private hasWarnedThisWindow = false;

  /**
   * 書き込みを許可するかチェックし、許可する場合は記録する。
   * @returns 書き込み可能なら true、遮断中なら false
   */
  check(operation: string): boolean {
    const now = Date.now();

    // クールダウン中
    if (now < this.blockedUntil) {
      const remainingSec = Math.ceil((this.blockedUntil - now) / 1000);
      console.error(
        `[WriteRateLimiter] 書き込み遮断中 (残り ${remainingSec}秒) — operation: ${operation}`
      );
      return false;
    }

    // スライディングウィンドウ外のタイムスタンプを削除
    this.timestamps = this.timestamps.filter(t => now - t < WINDOW_MS);

    const count = this.timestamps.length;

    if (count >= BLOCK_THRESHOLD) {
      this.blockedUntil = now + COOLDOWN_MS;
      this.hasWarnedThisWindow = false;
      console.error(
        `[WriteRateLimiter] 書き込みが ${BLOCK_THRESHOLD}回/分を超えました。` +
        `${COOLDOWN_MS / 1000}秒間遮断します — operation: ${operation}`
      );
      return false;
    }

    if (count >= WARN_THRESHOLD && !this.hasWarnedThisWindow) {
      this.hasWarnedThisWindow = true;
      console.warn(
        `[WriteRateLimiter] 書き込みが ${WARN_THRESHOLD}回/分を超えています (現在 ${count}回) — operation: ${operation}`
      );
    }

    if (count < WARN_THRESHOLD) {
      this.hasWarnedThisWindow = false;
    }

    this.timestamps.push(now);
    return true;
  }

  /** 現在の書き込み数を返す（デバッグ用） */
  getCount(): number {
    const now = Date.now();
    return this.timestamps.filter(t => now - t < WINDOW_MS).length;
  }

  /** 状態をリセット（テスト用） */
  reset(): void {
    this.timestamps = [];
    this.blockedUntil = 0;
    this.hasWarnedThisWindow = false;
  }
}

export const writeRateLimiter = new WriteRateLimiter();
