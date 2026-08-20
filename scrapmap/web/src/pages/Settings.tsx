import { useState } from 'react';
import { api, ApiError, setToken } from '../api/client.ts';
import { useAuth } from '../state/auth.tsx';
import { AddressSearch } from '../components/AddressSearch.tsx';
import { ErrorNote, Field } from '../components/ui.tsx';

export function Settings() {
  const { user, patchUser, signOut } = useAuth();

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [role, setRole] = useState(user?.role ?? 'both');
  const [radius, setRadius] = useState(user?.searchRadiusMiles ?? 25);
  const [home, setHome] = useState<{ lat: number; lon: number; city?: string; region?: string; postalCode?: string } | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const { user: updated } = await api.updateProfile({
        displayName,
        bio,
        phone: phone || null,
        role,
        searchRadiusMiles: radius,
        ...(home
          ? {
              homeLat: home.lat,
              homeLon: home.lon,
              city: home.city ?? null,
              region: home.region ?? null,
              postalCode: home.postalCode ?? null,
            }
          : {}),
      });
      patchUser(updated);
      setStatus('Saved.');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      // The server rotates every session; keep this tab signed in with the new token.
      const { token } = await api.changePassword(currentPassword, newPassword);
      setToken(token);
      setCurrentPassword('');
      setNewPassword('');
      setStatus('Password changed. Any other devices have been signed out.');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not change the password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-2xl font-bold text-zinc-100">Settings</h1>

      {error ? <div className="mt-4"><ErrorNote message={error} /></div> : null}
      {status ? (
        <p className="mt-4 rounded-lg border border-emerald-900/60 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
          {status}
        </p>
      ) : null}

      <form className="card mt-5 space-y-4 p-4" onSubmit={saveProfile}>
        <h2 className="text-sm font-semibold text-zinc-300">Profile</h2>

        <Field label="Display name">
          <input
            className="field"
            value={displayName}
            maxLength={60}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </Field>

        <Field label="About you" hint="Shown on your public profile.">
          <textarea
            className="field min-h-20"
            value={bio}
            maxLength={600}
            onChange={(event) => setBio(event.target.value)}
          />
        </Field>

        <Field label="Phone" hint="Optional. Never shown publicly — only shared if you send it.">
          <input
            className="field"
            value={phone ?? ''}
            maxLength={32}
            onChange={(event) => setPhone(event.target.value)}
          />
        </Field>

        <Field label="I mostly">
          <select
            className="field"
            value={role}
            onChange={(event) => setRole(event.target.value as typeof role)}
          >
            <option value="homeowner">Post scrap</option>
            <option value="scrapper">Collect scrap</option>
            <option value="both">Both</option>
          </select>
        </Field>

        <Field
          label="Home base"
          hint={
            user.homeLat != null
              ? `Currently ${user.city ?? 'set'}. Search to move it.`
              : 'Not set — listings will not be sorted by distance until you set one.'
          }
        >
          <AddressSearch
            placeholder="Town or ZIP"
            onSelect={(result) =>
              setHome({
                lat: result.lat,
                lon: result.lon,
                city: result.city ?? undefined,
                region: result.region ?? undefined,
                postalCode: result.postalCode ?? undefined,
              })
            }
          />
        </Field>

        <Field
          label={`Alert me about scrap within ${radius} miles`}
          hint="You get a notification when something is posted inside this radius."
        >
          <input
            type="range"
            min="1"
            max="100"
            value={radius}
            className="w-full accent-copper-500"
            onChange={(event) => setRadius(Number(event.target.value))}
          />
        </Field>

        <button type="submit" className="btn-primary" disabled={busy}>
          Save profile
        </button>
      </form>

      <form className="card mt-4 space-y-4 p-4" onSubmit={changePassword}>
        <h2 className="text-sm font-semibold text-zinc-300">Change password</h2>

        <Field label="Current password">
          <input
            className="field"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
          />
        </Field>

        <Field label="New password" hint="At least 10 characters.">
          <input
            className="field"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
          />
        </Field>

        <button type="submit" className="btn-secondary" disabled={busy}>
          Change password
        </button>
      </form>

      <div className="mt-4">
        <button type="button" className="btn-ghost" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </div>
  );
}
