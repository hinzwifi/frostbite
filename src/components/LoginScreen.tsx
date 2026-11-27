import { useState } from 'react';
import { ArrowRight, Eye, EyeOff, Moon, Server, Snowflake, Sun } from 'lucide-react';
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
  const [showPassword, setShowPassword] = useState(false);
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
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(10);
      }
      onSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to sign in';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-[100dvh] flex-col items-center justify-center bg-[var(--bg)] px-5 py-10">
      {/* Top-right Apple-style floating theme capsule */}
      <button
        type="button"
        onClick={onToggleDark}
        aria-label="Toggle color theme"
        className="apple-glass safe-top absolute right-4 top-4 inline-flex min-h-[38px] items-center gap-1.5 rounded-full border border-[var(--border)] px-3.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] shadow-[var(--shadow-sm)]"
      >
        {dark ? <Sun className="h-3.5 w-3.5" strokeWidth={1.75} /> : <Moon className="h-3.5 w-3.5" strokeWidth={1.75} />}
        <span>{dark ? 'Light' : 'Dark'}</span>
      </button>

      <div className="w-full max-w-[380px]">
        {/* Brand mark & optical heading */}
        <div className="flex flex-col items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-[16px] bg-[var(--accent)] text-white shadow-[0_8px_20px_rgba(0,122,255,0.28)]">
            <Snowflake className="h-7 w-7" strokeWidth={1.75} />
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
            {businessName}
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Sign in to your cold-chain ledger
          </p>
        </div>

        {/* Apple translucent card */}
        <form
          onSubmit={handleSubmit}
          className="apple-glass mt-7 rounded-[22px] border border-[var(--border)] p-5 shadow-[var(--shadow-sm)]"
        >
          {/* Grouped inset fields (Apple Settings/Sign-In pattern) */}
          <div className="overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--surface)]">
            <div className="border-b border-[var(--border)] px-3.5 py-2.5">
              <label
                htmlFor="login-email"
                className="block text-[11px] font-medium text-[var(--text-muted)]"
              >
                Admin email
              </label>
              <input
                id="login-email"
                type="email"
                required
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                enterKeyHint="next"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="owner@example.com"
                className="mt-0.5 w-full bg-transparent text-[15px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
              />
            </div>

            <div className="flex items-center px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <label
                  htmlFor="login-password"
                  className="block text-[11px] font-medium text-[var(--text-muted)]"
                >
                  Password
                </label>
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  enterKeyHint="go"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  className="mt-0.5 w-full bg-transparent text-[15px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="ml-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--surface-subtle)]"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" strokeWidth={1.75} />
                ) : (
                  <Eye className="h-4 w-4" strokeWidth={1.75} />
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="mt-3 rounded-xl bg-[var(--danger-subtle)] px-3.5 py-2.5 text-xs font-medium text-[var(--danger)]">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-4 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] px-4 py-3 text-[15px] font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
          >
            <span>{loading ? 'Signing in' : 'Sign in'}</span>
            {!loading && <ArrowRight className="h-4 w-4" strokeWidth={2} />}
          </button>

          {/* Collapsible server selector */}
          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={() => setShowServer((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] text-[var(--text-muted)] hover:bg-[var(--surface-subtle)]"
            >
              <Server className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span className="max-w-[240px] truncate font-mono-num">{serverUrl}</span>
            </button>
            {showServer && (
              <input
                type="url"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="https://your-frostbite-domain"
                autoCapitalize="none"
                autoCorrect="off"
                className="mt-2 min-h-[40px] w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono-num text-xs text-[var(--text-primary)]"
              />
            )}
          </div>
        </form>

        {canRunSetup && (
          <div className="mt-5 text-center">
            <button
              type="button"
              onClick={onSwitchToSetup}
              className="text-xs font-medium text-[var(--accent)] hover:underline"
            >
              No admin account yet? Run first-time setup
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
