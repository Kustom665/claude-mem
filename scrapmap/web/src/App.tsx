import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './state/auth.tsx';
import { Layout } from './components/Layout.tsx';
import { Spinner } from './components/ui.tsx';
import { Browse } from './pages/Browse.tsx';
import { ListingDetail } from './pages/ListingDetail.tsx';
import { PostListing } from './pages/PostListing.tsx';
import { Login, Register } from './pages/Auth.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { Messages } from './pages/Messages.tsx';
import { CommunityDetail, CommunityList } from './pages/Communities.tsx';
import { Prices } from './pages/Prices.tsx';
import { Yards } from './pages/Yards.tsx';
import { Impact } from './pages/Impact.tsx';
import { Profile } from './pages/Profile.tsx';
import { Settings } from './pages/Settings.tsx';

/** Sends signed-out visitors to the login page, remembering where they were. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Spinner label="Checking your session" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Browse />} />
            <Route path="listing/:id" element={<ListingDetail />} />
            <Route path="prices" element={<Prices />} />
            <Route path="yards" element={<Yards />} />
            <Route path="impact" element={<Impact />} />
            <Route path="communities" element={<CommunityList />} />
            <Route path="communities/:slug" element={<CommunityDetail />} />
            <Route path="profile/:id" element={<Profile />} />
            <Route path="login" element={<Login />} />
            <Route path="register" element={<Register />} />

            <Route
              path="post"
              element={
                <RequireAuth>
                  <PostListing />
                </RequireAuth>
              }
            />
            <Route
              path="dashboard"
              element={
                <RequireAuth>
                  <Dashboard />
                </RequireAuth>
              }
            />
            <Route
              path="messages"
              element={
                <RequireAuth>
                  <Messages />
                </RequireAuth>
              }
            />
            <Route
              path="settings"
              element={
                <RequireAuth>
                  <Settings />
                </RequireAuth>
              }
            />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
