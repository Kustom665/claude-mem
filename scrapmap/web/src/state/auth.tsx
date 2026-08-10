import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, getToken, setToken } from '../api/client.ts';
import type { User } from '../api/types.ts';

interface AuthState {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: Parameters<typeof api.register>[0]) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  patchUser: (updates: Partial<User>) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const { user: me } = await api.me();
      setUser(me);
    } catch {
      // A rejected token is a signed-out user, not an error worth surfacing.
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { token, user: me } = await api.login(email, password);
    setToken(token);
    setUser(me);
  }, []);

  const signUp = useCallback(async (input: Parameters<typeof api.register>[0]) => {
    const { token, user: me } = await api.register(input);
    setToken(token);
    setUser(me);
  }, []);

  const signOut = useCallback(async () => {
    // Clear locally even if the network call fails; the token is what matters.
    await api.logout().catch(() => undefined);
    setToken(null);
    setUser(null);
  }, []);

  const patchUser = useCallback((updates: Partial<User>) => {
    setUser((current) => (current ? { ...current, ...updates } : current));
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, loading, signIn, signUp, signOut, refresh, patchUser }),
    [user, loading, signIn, signUp, signOut, refresh, patchUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
