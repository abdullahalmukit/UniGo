import { createContext, useContext, useEffect, useState } from 'react';
import { request, saveToken, getToken, clearToken } from '../api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true); // true while we check for a saved login

  // When the site opens, see if a saved token still works
  useEffect(() => {
    async function restoreSession() {
      try {
        if (getToken()) {
          const data = await request('/api/auth/me', { auth: true });
          setUser(data.user);
        }
      } catch (error) {
        // Only forget the token if the server said it is invalid
        if (error.status === 401) clearToken();
      } finally {
        setLoading(false);
      }
    }
    restoreSession();
  }, []);

  function finishLogin(data) {
    saveToken(data.token);
    setUser(data.user);
  }

  const login = async (email, password) =>
    finishLogin(await request('/api/auth/login', { method: 'POST', body: { email, password } }));

  const register = async (form) =>
    finishLogin(await request('/api/auth/register', { method: 'POST', body: form }));

  const loginWithGoogle = async (idToken) =>
    finishLogin(await request('/api/auth/google', { method: 'POST', body: { idToken } }));

  async function logout() {
    try {
      await request('/api/auth/logout', { method: 'POST', auth: true });
    } catch (error) {
      // Even if the server is unreachable, we still log out in this browser
    }
    clearToken();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, loginWithGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
