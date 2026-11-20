import { createContext, useContext, useEffect, useState } from 'react';
import * as api from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // `loading` is true only until the first /auth/me settles. Without it the
  // navbar flashes "Sign in" for a moment on every reload for a signed-in user.
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Ask the server who we are. A 401 here is the ordinary answer for a
    // visitor with no session — it is not an error worth surfacing.
    api
      .me()
      .then((res) => setUser(res.data))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const signIn = async (email, password) => {
    const res = await api.login({ email, password });
    setUser(res.data);
    return res.data;
  };

  const signUp = async (email, password) => {
    await api.register({ email, password });
    // Registration does not create a session, so sign in straight after.
    return signIn(email, password);
  };

  const signOut = async () => {
    try {
      await api.logout();
    } finally {
      // Whatever the server said, this browser is done with the session.
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside an AuthProvider');
  return ctx;
}
