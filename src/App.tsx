import { useState } from 'react';

// === スタイル定義 ===
// CSS in JS の考え方で、スタイルをオブジェクトとして定義します

const viewStyle: React.CSSProperties = {
  padding: '32px',
};

const h2Style: React.CSSProperties = {
  fontSize: '24px',
  fontWeight: 'bold',
  marginBottom: '16px',
};

const appStyle: React.CSSProperties = {
  minHeight: '100vh',
  backgroundColor: '#111827', // bg-gray-900
  color: 'white',
  fontFamily: 'sans-serif',
};

const headerStyle: React.CSSProperties = {
  backgroundColor: '#1F2937', // bg-gray-800
  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
};

const navStyle: React.CSSProperties = {
  maxWidth: '1280px',
  margin: '0 auto',
  padding: '12px 24px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const buttonContainerStyle: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
};

const baseButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: '6px',
  fontSize: '14px',
  fontWeight: '500',
  transition: 'background-color 0.2s',
  border: 'none',
  cursor: 'pointer',
};

const activeButtonStyle: React.CSSProperties = {
  ...baseButtonStyle,
  backgroundColor: '#2563EB', // bg-blue-600
  color: 'white',
};

const inactiveButtonStyle: React.CSSProperties = {
  ...baseButtonStyle,
  backgroundColor: '#374151', // bg-gray-700
  color: '#D1D5DB', // text-gray-300
};


// === コンポーネント定義 ===

const BandManagementView = () => (
  <div style={viewStyle}>
    <h2 style={h2Style}>バンド管理モード</h2>
    <p>ここに、バンド情報を一覧で管理する画面を作成します。</p>
  </div>
);

const TimetableView = () => (
  <div style={viewStyle}>
    <h2 style={h2Style}>タイムテーブル編集モード</h2>
    <p>ここに、タイムテーブルを編集する画面を作成します。</p>
  </div>
);

type Mode = 'band-management' | 'timetable-editing';

function App() {
  const [mode, setMode] = useState<Mode>('band-management');

  return (
    <div style={appStyle}>
      <header style={headerStyle}>
        <nav style={navStyle}>
          <h1 style={{ fontSize: '20px', fontWeight: 'bold' }}>Aca-Schedule</h1>
          <div style={buttonContainerStyle}>
            <button
              onClick={() => setMode('band-management')}
              style={mode === 'band-management' ? activeButtonStyle : inactiveButtonStyle}
              onMouseOver={(e) => { if (mode !== 'band-management') e.currentTarget.style.backgroundColor = '#4B5563'; }}
              onMouseOut={(e) => { if (mode !== 'band-management') e.currentTarget.style.backgroundColor = inactiveButtonStyle.backgroundColor ?? '#374151'; }}
            >
              バンド管理
            </button>
            <button
              onClick={() => setMode('timetable-editing')}
              style={mode === 'timetable-editing' ? activeButtonStyle : inactiveButtonStyle}
              onMouseOver={(e) => { if (mode !== 'timetable-editing') e.currentTarget.style.backgroundColor = '#4B5563'; }}
              onMouseOut={(e) => { if (mode !== 'timetable-editing') e.currentTarget.style.backgroundColor = inactiveButtonStyle.backgroundColor ?? '#374151'; }}
            >
              タイムテーブル編集
            </button>
          </div>
        </nav>
      </header>

      <main>
        {mode === 'band-management' ? <BandManagementView /> : <TimetableView />}
      </main>
    </div>
  );
}

export default App;

