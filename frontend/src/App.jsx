import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import HomePage from './pages/HomePage.jsx';

// Only logged-in users can open this page
function PrivatePage({ children }) {
  const { user } = useAuth();
  return user ? children : <Navigate to="/login" replace />;
}

// Logged-in users do not need the login/register pages
function PublicPage({ children }) {
  const { user } = useAuth();
  return user ? <Navigate to="/" replace /> : children;
}

export default function App() {
  const { loading } = useAuth();

  if (loading) {
    return (
      <div className="splash">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<PrivatePage><HomePage /></PrivatePage>} />
      <Route path="/login" element={<PublicPage><LoginPage /></PublicPage>} />
      <Route path="/register" element={<PublicPage><RegisterPage /></PublicPage>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
