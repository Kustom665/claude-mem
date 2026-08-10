import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client.ts';
import { useAuth } from '../state/auth.tsx';
import { AddressSearch } from '../components/AddressSearch.tsx';
import { ErrorNote, Field } from '../components/ui.tsx';

export function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      navigate('/dashboard');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-12">
      <h1 className="text-2xl font-bold text-zinc-100">Welcome back</h1>
      <form className="mt-6 space-y-4" onSubmit={submit}>
        {error ? <ErrorNote message={error} /> : null}

        <Field label="Email">
          <input
            className="field"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </Field>

        <Field label="Password">
          <input
            className="field"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </Field>

        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-zinc-500">
        New here?{' '}
        <Link to="/register" className="text-copper-300 hover:underline">
          Create an account
        </Link>
      </p>

      <div className="card mt-8 p-3 text-xs text-zinc-500">
        <p className="font-medium text-zinc-400">Demo accounts</p>
        <p className="mt-1">
          Try <code className="text-copper-300">dana@example.com</code> (homeowner) or{' '}
          <code className="text-copper-300">marcus@example.com</code> (scrapper), password{' '}
          <code className="text-copper-300">scrapmap-demo-2026</code>.
        </p>
      </div>
    </div>
  );
}

export function Register() {
  const { signUp } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<'homeowner' | 'scrapper' | 'both'>('both');
  const [home, setHome] = useState<{ lat: number; lon: number; city?: string; region?: string; postalCode?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await signUp({
        email,
        password,
        displayName,
        role,
        ...(home
          ? {
              homeLat: home.lat,
              homeLon: home.lon,
              city: home.city,
              region: home.region,
              postalCode: home.postalCode,
            }
          : {}),
      });
      navigate('/');
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        if (caught.fields) setFields(caught.fields);
      } else {
        setError('Could not create that account.');
      }
    } finally {
      setBusy(false);
    }
  }

  const ROLES = [
    {
      value: 'homeowner' as const,
      title: 'I have scrap',
      body: 'Post metal sitting around your place and let someone haul it.',
    },
    {
      value: 'scrapper' as const,
      title: 'I collect scrap',
      body: 'Get alerts for metal near you and claim pickups.',
    },
    { value: 'both' as const, title: 'Both', body: 'Post what you have, grab what you can use.' },
  ];

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-2xl font-bold text-zinc-100">Join ScrapMap</h1>
      <p className="mt-1 text-sm text-zinc-500">Free, and no card ever.</p>

      <form className="mt-6 space-y-4" onSubmit={submit}>
        {error ? <ErrorNote message={error} /> : null}

        <fieldset>
          <legend className="field-label">What brings you here?</legend>
          <div className="grid gap-2">
            {ROLES.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setRole(option.value)}
                className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  role === option.value
                    ? 'border-copper-600 bg-copper-950/40'
                    : 'border-zinc-700 bg-ink-850 hover:border-zinc-600'
                }`}
              >
                <span className="block text-sm font-medium text-zinc-200">{option.title}</span>
                <span className="mt-0.5 block text-xs text-zinc-500">{option.body}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <Field label="Name" required error={fields.displayName}>
          <input
            className="field"
            value={displayName}
            placeholder="How neighbors will see you"
            onChange={(event) => setDisplayName(event.target.value)}
            required
          />
        </Field>

        <Field label="Email" required error={fields.email}>
          <input
            className="field"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </Field>

        <Field
          label="Password"
          required
          hint="At least 10 characters."
          error={fields.password}
        >
          <input
            className="field"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </Field>

        <Field
          label="Your area"
          hint="Used to sort listings by distance and to alert you about scrap nearby. Never shown publicly."
        >
          <AddressSearch
            placeholder="Town or ZIP is enough"
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
          {home ? (
            <p className="mt-1 text-xs text-emerald-400">
              Home base set{home.city ? ` to ${home.city}` : ''}.
            </p>
          ) : null}
        </Field>

        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-zinc-500">
        Already a member?{' '}
        <Link to="/login" className="text-copper-300 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
