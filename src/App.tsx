import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { EventCreationWizard } from './components/EventCreationWizard';
import { EventEditorPage } from './pages/EventEditorPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<EventCreationWizard />} />
        <Route path="/events/:eventId" element={<EventEditorPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
