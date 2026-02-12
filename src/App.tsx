import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { AuthGuard } from './components/AuthGuard';
import { LoginPage } from './pages/LoginPage';
import { MyEventsPage } from './pages/MyEventsPage';
import { EventCreationWizard } from './components/EventCreationWizard';
import { EventEditorPage } from './pages/EventEditorPage';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <AuthGuard>
                <MyEventsPage />
              </AuthGuard>
            }
          />
          <Route
            path="/events/new"
            element={
              <AuthGuard>
                <EventCreationWizard />
              </AuthGuard>
            }
          />
          <Route
            path="/events/:eventId"
            element={
              <AuthGuard>
                <EventEditorPage />
              </AuthGuard>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
