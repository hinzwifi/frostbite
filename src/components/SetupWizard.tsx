import { useState } from 'react';
import { ArrowRight, Check, Moon, Server, ShieldCheck, Snowflake, Sun } from 'lucide-react';
import { completeFirstTimeSetup, getPocketBaseUrl } from '../lib/pocketbase';

interface Props {
  dark: boolean;
  onToggleDark: () => void;
  onComplete: (businessName: string) => void;
  onSwitchToLogin: () => void;
}

export function SetupWizard({ dark, onToggleDark, onComplete, onSwitchToLogin }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [serverUrl, setServerUrl] = useState(getPocketBaseUrl());
  const [showServer, setShowServer] = useState(false);

  const [businessName, setBusinessName] = useState('Frostbite');
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [defaultStoreCut, setDefaultStoreCut] = useState('5');
  const [warn30, setWarn30] = useState('30');
  const [warn14, setWarn14] = useState('14');
  const [critical7, setCritical7] = useState('7');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleNext = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 10) {
      setError('Admin password must be at least 10 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setStep(2);
  };

  const handleFinish = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await completeFirstTimeSetup({
        serverUrl,
        businessName: businessName.trim() || 'Frostbite',
        ownerName: ownerName.trim() || 'Owner',
        email: email.trim(),
        password,
        defaultStoreCut: Number(defaultStoreCut) || 5,
        expiryThresholds: {
          warn30: Number(warn30) || 30,
          warn14: Number(warn14) || 14,
          critical7: Number(critical7) || 7,
        },
      });
      onComplete(businessName.trim() || 'Frostbite');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to complete setup';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[var(--bg)] p-6">
      <button
        type="button"
        onClick={onToggleDark}
        className="absolute right-5 top-5 inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)] transition-colors"
      >
        {dark ? <Sun className="h-3.5 w-3.5" strokeWidth={1.5} /> : <Moon className="h-3.5 w-3.5" strokeWidth={1.5} />}
        {dark ? 'Light mode' : 'Dark mode'}
      </button>

      <div className="w-full max-w-md rounded-2xl border border-[var(--border-strong)] bg-[var(--surface)] p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)] text-white">
              <Snowflake className="h-4 w-4" strokeWidth={1.75} />
            </div>
            <div>
              <h1 className="text-base font-semibold text-[var(--text-primary)]">First-time setup</h1>
              <p className="text-xs text-[var(--text-secondary)]">
                Create the first admin account on your PocketBase server
              </p>
            </div>
          </div>
          <span className="font-mono-num text-xs text-[var(--text-muted)]">Step {step} of 2</span>
        </div>

        {/* Quiet 2-step indicator bar */}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <div
            className={`h-1 rounded-full ${step >= 1 ? 'bg-[var(--accent)]' : 'bg-[var(--surface-subtle)]'}`}
          />
          <div
            className={`h-1 rounded-full ${step >= 2 ? 'bg-[var(--accent)]' : 'bg-[var(--surface-subtle)]'}`}
          />
        </div>

        {step === 1 ? (
          <form onSubmit={handleNext} className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)]">
                Business name
              </label>
              <input
                required
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="Frostbite"
                className="mt-1.5 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)]">
                Admin name
              </label>
              <input
                required
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                placeholder="Your name"
                className="mt-1.5 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
              />
            </div>

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
                className="mt-1.5 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)]">
                  Password (min 10 chars)
                </label>
                <input
                  type="password"
                  required
                  minLength={10}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)]">
                  Confirm password
                </label>
                <input
                  type="password"
                  required
                  minLength={10}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
                />
              </div>
            </div>

            <div>
              <button
                type="button"
                onClick={() => setShowServer((v) => !v)}
                className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
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
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] transition-colors"
            >
              Continue to defaults
              <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </form>
        ) : (
          <form onSubmit={handleFinish} className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)]">
                Default partner store commission cut (₱ per unit)
              </label>
              <input
                type="number"
                step="0.5"
                min="0"
                value={defaultStoreCut}
                onChange={(e) => setDefaultStoreCut(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono-num text-sm text-[var(--text-primary)]"
              />
            </div>

            <div>
              <div className="text-xs font-medium text-[var(--text-secondary)]">
                FEFO expiry alert thresholds (days)
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[11px] text-[var(--text-muted)]">Watch</label>
                  <input
                    type="number"
                    min="1"
                    value={warn30}
                    onChange={(e) => setWarn30(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-1.5 font-mono-num text-sm text-[var(--text-primary)]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[var(--text-muted)]">Promo</label>
                  <input
                    type="number"
                    min="1"
                    value={warn14}
                    onChange={(e) => setWarn14(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-1.5 font-mono-num text-sm text-[var(--text-primary)]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[var(--text-muted)]">Critical</label>
                  <input
                    type="number"
                    min="1"
                    value={critical7}
                    onChange={(e) => setCritical7(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-1.5 font-mono-num text-sm text-[var(--text-primary)]"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2.5 text-xs">
              <span className="text-[var(--text-secondary)]">Interface theme</span>
              <button
                type="button"
                onClick={onToggleDark}
                className="inline-flex items-center gap-1.5 font-medium text-[var(--text-primary)]"
              >
                {dark ? <Moon className="h-3.5 w-3.5" strokeWidth={1.5} /> : <Sun className="h-3.5 w-3.5" strokeWidth={1.5} />}
                {dark ? 'Dark' : 'Light'}
              </button>
            </div>

            <div className="flex items-start gap-2 rounded-lg bg-[var(--accent-subtle)] px-3 py-2.5 text-xs text-[var(--text-secondary)]">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" strokeWidth={1.5} />
              <span>
                Creating <span className="font-medium text-[var(--text-primary)]">{email}</span> as the first admin account.
              </span>
            </div>

            {error && (
              <div className="rounded-lg bg-[var(--danger-subtle)] px-3 py-2 text-xs text-[var(--danger)]">
                {error}
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="rounded-lg border border-[var(--border-strong)] px-4 py-2.5 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={loading}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60 transition-colors"
              >
                <Check className="h-4 w-4" strokeWidth={1.5} />
                {loading ? 'Creating admin account' : 'Complete setup'}
              </button>
            </div>
          </form>
        )}

        <div className="mt-5 border-t border-[var(--border)] pt-4 text-center">
          <button
            type="button"
            onClick={onSwitchToLogin}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            Already have a PocketBase account? Sign in
          </button>
        </div>
      </div>
    </div>
  );
}
