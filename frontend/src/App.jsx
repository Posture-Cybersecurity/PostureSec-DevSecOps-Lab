import { Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import IncidentBanner from './components/IncidentBanner';
import Home from './pages/Home';
import PostDetail from './pages/PostDetail';
import CreatePost from './pages/CreatePost';
import EditPost from './pages/EditPost';
import Login from './pages/Login';
import IncidentPage from './pages/IncidentPage';
import { AuthProvider } from './context/AuthContext';

function App() {
  return (
    <AuthProvider>
      <div className="app">
        <div className="gradient-bg" />
        {/* Hidden until the backend reports an active incident. */}
        <IncidentBanner />
        <Navbar />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/post/:id" element={<PostDetail />} />
            <Route path="/create" element={<CreatePost />} />
            <Route path="/edit/:id" element={<EditPost />} />
            <Route path="/login" element={<Login />} />
            <Route path="/incident" element={<IncidentPage />} />
          </Routes>
        </main>
      </div>
    </AuthProvider>
  );
}

export default App;
