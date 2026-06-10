import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { AuthGuard } from './components/AuthGuard';

const LoginPage = lazy(() => import('./pages/LoginPage').then(m => ({ default: m.LoginPage })));
const MyEventsPage = lazy(() => import('./pages/MyEventsPage').then(m => ({ default: m.MyEventsPage })));
const EventCreationWizard = lazy(() => import('./components/EventCreationWizard').then(m => ({ default: m.EventCreationWizard })));
const EventEditorPage = lazy(() => import('./pages/EventEditorPage').then(m => ({ default: m.EventEditorPage })));
const PublicTimetablePage = lazy(() => import('./pages/PublicTimetablePage').then(m => ({ default: m.PublicTimetablePage })));
const SetPasswordPage = lazy(() => import('./pages/SetPasswordPage').then(m => ({ default: m.SetPasswordPage })));

const PageLoadingFallback = () => (
  <div className="flex items-center justify-center min-h-screen">
    <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
  </div>
);

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<PageLoadingFallback />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/set-password" element={<SetPasswordPage />} />
            <Route path="/share/:eventId" element={<PublicTimetablePage />} />
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
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
