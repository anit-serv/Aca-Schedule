import { useState, useRef, useEffect } from 'react';
import Papa from 'papaparse';
import type { Band, EventSettings } from '../types';
import { bandService } from '../services/firestore';

interface BandImportCSVProps {
  eventSettings: EventSettings;
  onImportComplete: () => void;
}

interface CSVRow {
  bandName: string;
  performanceTime: string;
  performanceCount?: string;
  members?: string;
}

export const BandImportCSV = ({ eventSettings, onImportComplete }: BandImportCSVProps) => {
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 成功メッセージを3秒後に自動的に消す
  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => {
        setSuccess(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    setSuccess(null);
    setIsImporting(true);

    Papa.parse<CSVRow>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header: string) => {
        // 日本語ヘッダーを英語キーに変換
        const headerMap: { [key: string]: string } = {
          'バンド名': 'bandName',
          '演奏時間': 'performanceTime',
          '出演回数': 'performanceCount',
          'メンバー': 'members',
        };
        return headerMap[header] || header;
      },
      complete: async (results: Papa.ParseResult<CSVRow>) => {
        try {
          await processCSVData(results.data);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'インポートに失敗しました');
        } finally {
          setIsImporting(false);
          // ファイル入力をリセット
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }
        }
      },
      error: (error: Error) => {
        setError(`CSVファイルの読み込みに失敗しました: ${error.message}`);
        setIsImporting(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      },
    });
  };

  const processCSVData = async (data: CSVRow[]) => {
    // バリデーション
    const errors: string[] = [];
    const validBands: Band[] = [];

    data.forEach((row, index) => {
      const rowNumber = index + 2; // ヘッダー行を除くため+2

      // 必須フィールドのチェック
      if (!row.bandName || row.bandName.trim() === '') {
        errors.push(`${rowNumber}行目: バンド名が入力されていません`);
        return;
      }

      if (!row.performanceTime || row.performanceTime.trim() === '') {
        errors.push(`${rowNumber}行目: 演奏時間が入力されていません`);
        return;
      }

      const performanceDuration = parseInt(row.performanceTime, 10);
      if (isNaN(performanceDuration) || performanceDuration <= 0) {
        errors.push(`${rowNumber}行目: 演奏時間は正の数値である必要があります`);
        return;
      }

      // オプションフィールドの処理
      let performanceCount = 1;
      if (row.performanceCount && row.performanceCount.trim() !== '') {
        performanceCount = parseInt(row.performanceCount, 10);
        if (isNaN(performanceCount) || performanceCount <= 0) {
          errors.push(`${rowNumber}行目: 出演回数は正の数値である必要があります`);
          return;
        }
      }

      // メンバーの処理（セミコロン区切り）
      let members: string[] = [];
      if (row.members && row.members.trim() !== '') {
        members = row.members
          .split(';')
          .map((m: string) => m.trim())
          .filter((m: string) => m !== '');
      }

      // バンドオブジェクトを作成
      const band: Band = {
        id: crypto.randomUUID(),
        name: row.bandName.trim(),
        performanceDuration,
        performanceCount,
        members,
        availableTimeSlots: [], // インポート後に手動設定
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      validBands.push(band);
    });

    // エラーがある場合は処理を中止
    if (errors.length > 0) {
      throw new Error(`以下のエラーがあります:\n${errors.join('\n')}`);
    }

    // バンドが1件もない場合
    if (validBands.length === 0) {
      throw new Error('インポート可能なバンドが見つかりませんでした');
    }

    // Firestoreに一括登録
    try {
      for (const band of validBands) {
        await bandService.addBand(band, eventSettings.id);
      }
      setSuccess(`${validBands.length}件のバンドをインポートしました`);
      onImportComplete();
    } catch {
      throw new Error('データベースへの保存に失敗しました');
    }
  };

  const handleDownloadTemplate = () => {
    const headers = ['バンド名', '演奏時間', '出演回数', 'メンバー'];
    const csvContent = headers.join(',') + '\n';
    // BOM(Byte Order Mark)を追加してExcelで正しく開けるようにする
    const bom = '\uFEFF';
    const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', 'band_template.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <>
      <div className="flex gap-2">
        <label
          htmlFor="csv-import"
          className={`px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md font-medium transition-colors cursor-pointer text-sm ${
            isImporting ? 'opacity-50 cursor-not-allowed' : ''
          }`}
        >
          {isImporting ? 'インポート中...' : 'CSVインポート'}
        </label>
        <input
          ref={fileInputRef}
          id="csv-import"
          type="file"
          accept=".csv"
          onChange={handleFileSelect}
          disabled={isImporting}
          className="hidden"
        />
        
        <button
          onClick={handleDownloadTemplate}
          disabled={isImporting}
          className="px-3 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
          テンプレートダウンロード
        </button>
      </div>

      {/* メッセージ表示（固定位置） */}
      {(error || success) && (
        <div className="fixed top-20 right-6 max-w-md z-50 animate-fade-in">
          {error && (
            <div className="bg-red-900/95 border border-red-500 text-red-200 px-4 py-3 rounded-lg shadow-lg text-sm whitespace-pre-line">
              <div className="flex items-start gap-2">
                <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>{error}</div>
              </div>
            </div>
          )}
          
          {success && (
            <div className="bg-green-900/95 border border-green-500 text-green-200 px-4 py-3 rounded-lg shadow-lg text-sm">
              <div className="flex items-start gap-2">
                <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>{success}</div>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
};
