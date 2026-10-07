import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { HomePage } from './pages/HomePage.js';
import { EditorPage } from './pages/EditorPage.js';
import { RehearsalPage } from './pages/RehearsalPage.js';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/scenes/:id" element={<EditorPage />} />
        <Route path="/rehearsal/:id" element={<RehearsalPage />} />
      </Routes>
    </BrowserRouter>
  );
}
