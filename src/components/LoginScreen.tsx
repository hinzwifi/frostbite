import { useState } from 'react';
import { Lock, Moon, Server, Snowflake, Sun } from 'lucide-react';
import { getPocketBaseUrl, loginOwner, setPocketBaseUrl } from '../lib/pocketbase';

interface Props {
  businessName: string;
  dark: boolean;
  canRunSetup: boolean;
  onToggleDark: () => void;
  onSuccess: () => void;
  onSwitchToSetup: () => void;
}

export function LoginScreen({
  businessName,
  dark,
  canRunSetup,
  onToggleDark,
  onSuccess,
  onSwitchToSetup,
}: Props) {
  const [serverUrl, setServerUrl] = useState(getPocketBaseUrl());
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showServer, setShowServer] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      setPocketBaseUrl(serverUrl);
      await loginOwner(email.trim(), password);
      onSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to sign in';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center bg-[var(--bg)] p-6">
      <button
        type="button"
        onClick={onToggleDark}
        className="absolute right-5 top-5 inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)] transition-colors"
      >
        {dark ? <Sun className="h-3.5 w-3.5" strokeWidth={1.5} /> : <Moon className="h-3.5 w-3.5" strokeWidth={1.5} />}
        {dark ? 'Light mode' : 'Dark mode'}
      </button>

      <div className="w-full max-w-sm rounded-2xl border border-[var(--border-strong)] bg-[var(--surface)] p-6 shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)] text-white">
            <Snowflake className="h-4 w-4" strokeWidth={1.75} />
          </div>
          <div>
            <h1 className="text-base font-semibold text-[var(--text-primary)]">{businessName}</h1>
            <p className="text-xs text-[var(--text-secondary)]">Cold-chain inventory &amp; consignment</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)]">
              Admin email
            </label>
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="owner@example.com"
              className="mt-1.5 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)]">
              Password
            </label>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />
          </div>

          <div>
            <button
              type="button"
              onClick={() => setShowServer((v) => !v)}
              className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
            >
              <Server className="h-3.5 w-3.5" strokeWidth={1.5} />
              PocketBase server: <span className="font-mono-num">{serverUrl}</span>
            </button>
            {showServer && (
              <input
                type="url"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="http://100.78.96.84:8090"
                className="mt-2 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-1.5 font-mono-num text-xs text-[var(--text-primary)]"
              />
            )}
          </div>

          {error && (
            <div className="rounded-lg bg-[var(--danger-subtle)] px-3 py-2 text-xs text-[var(--danger)]">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60 transition-colors"
          >
            <Lock className="h-4 w-4" strokeWidth={1.5} />
            {loading ? 'Connecting' : 'Sign in'}
          </button>
        </form>

        {canRunSetup && (
          <div className="mt-5 border-t border-[var(--border)] pt-4 text-center">
            <button
              type="button"
              onClick={onSwitchToSetup}
              className="text-xs font-medium text-[var(--accent)] hover:underline"
            >
              No account yet? Run first-time admin setup
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
