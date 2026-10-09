import { useState, useRef, useEffect } from 'react';
import Papa from 'papaparse';
import type { EventSettings } from '../types';
import { bandService } from '../services/firestore';
import { importDateColumns, parseBandCsvRows } from '../utils/bandCsvImport';
import { Icon } from './Icon';

interface BandImportCSVProps {
  eventSettings: EventSettings;
  onImportComplete: () => void;
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

    Papa.parse<string[]>(file, {
      skipEmptyLines: 'greedy',
      complete: async (results: Papa.ParseResult<string[]>) => {
        try {
          if (results.errors.length) {
            throw new Error(`CSVの解析に失敗しました: ${results.errors[0].message}`);
          }
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

  const processCSVData = async (data: string[][]) => {
    const validBands = parseBandCsvRows(data, eventSettings);

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
    const headers = ['バンド名', '出演時間(分)', '出演回数', '衣装', 'メンバー',
      ...importDateColumns(eventSettings).map(({ date, label }) => `${label}（${date}）`)];
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
          className="px-3 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
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
                <Icon name="error" className="text-xl flex-shrink-0" />
                <div>{error}</div>
              </div>
            </div>
          )}
          
          {success && (
            <div className="bg-green-900/95 border border-green-500 text-green-200 px-4 py-3 rounded-lg shadow-lg text-sm">
              <div className="flex items-start gap-2">
                <Icon name="check_circle" className="text-xl flex-shrink-0" />
                <div>{success}</div>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
};
