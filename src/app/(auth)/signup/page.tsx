"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { Eye, EyeOff, CheckCircle } from "lucide-react";

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupPageInner />
    </Suspense>
  );
}

function SignupPageInner() {
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite");

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const supabase = createClient();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    if (!isSupabaseConfigured()) {
      setError(
        "Supabase is not configured yet. Please add your NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local."
      );
      return;
    }

    setLoading(true);

    try {
      const emailRedirectTo = inviteToken
        ? `${window.location.origin}/join/${encodeURIComponent(inviteToken)}`
        : undefined;

      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
          },
          ...(emailRedirectTo ? { emailRedirectTo } : {}),
        },
      });

      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }

      setSuccess(true);
      setLoading(false);
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : "Failed to connect to authentication server. Please check your network and Supabase configuration.";
      setError(msg);
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fbfbfb] dark:bg-background px-4 py-8">
        <div className="w-full max-w-[420px] rounded-2xl border border-slate-100 dark:border-border bg-white dark:bg-card p-8 sm:p-10 shadow-sm sm:shadow-md text-center">
          <div className="mb-4 mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-950/40">
            <CheckCircle className="h-6 w-6 text-[#00794c]" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-foreground">
            Check your email
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-muted-foreground leading-relaxed">
            We&apos;ve sent a confirmation link to{" "}
            <span className="font-medium text-slate-900 dark:text-foreground">{email}</span>.
            Please check your inbox and click the link to verify your account.
          </p>
          <div className="mt-6">
            <Link
              href={
                inviteToken
                  ? `/login?invite=${encodeURIComponent(inviteToken)}`
                  : "/login"
              }
            >
              <button
                type="button"
                className="h-12 w-full rounded-lg bg-[#00794c] hover:bg-[#006841] text-white text-sm font-semibold transition-all shadow-sm cursor-pointer"
              >
                Back to sign in
              </button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fbfbfb] dark:bg-background px-4 py-8">
      <div className="w-full max-w-[420px] rounded-2xl border border-slate-100 dark:border-border bg-white dark:bg-card p-8 sm:p-10 shadow-sm sm:shadow-md">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-foreground">
            {inviteToken ? "Create account & join" : "Create account"}
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-muted-foreground">
            {inviteToken
              ? "Verify your email, then accept the invitation to join your team."
              : "Get started with Vachat.in"}
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mt-5 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSignup} className="mt-6 flex flex-col gap-4">
          {/* Full name Field */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="fullName"
              className="text-sm font-medium text-slate-700 dark:text-slate-300 text-left"
            >
              Full name
            </label>
            <input
              id="fullName"
              type="text"
              placeholder="John Doe"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              className="h-12 w-full rounded-lg border border-slate-200 dark:border-border bg-white dark:bg-muted/40 px-3.5 text-sm text-slate-900 dark:text-foreground placeholder:text-slate-400 focus:border-[#00794c] focus:outline-none focus:ring-2 focus:ring-[#00794c]/20 transition-all"
            />
          </div>

          {/* Email Field */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="email"
              className="text-sm font-medium text-slate-700 dark:text-slate-300 text-left"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              placeholder="samanga@samanga.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="h-12 w-full rounded-lg border border-slate-200 dark:border-border bg-white dark:bg-muted/40 px-3.5 text-sm text-slate-900 dark:text-foreground placeholder:text-slate-400 focus:border-[#00794c] focus:outline-none focus:ring-2 focus:ring-[#00794c]/20 transition-all"
            />
          </div>

          {/* Password Field */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="password"
              className="text-sm font-medium text-slate-700 dark:text-slate-300 text-left"
            >
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="h-12 w-full rounded-lg border border-slate-200 dark:border-border bg-white dark:bg-muted/40 px-3.5 pr-10 text-sm text-slate-900 dark:text-foreground placeholder:text-slate-400 focus:border-[#00794c] focus:outline-none focus:ring-2 focus:ring-[#00794c]/20 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
              >
                {showPassword ? (
                  <EyeOff className="h-5 w-5" strokeWidth={1.75} />
                ) : (
                  <Eye className="h-5 w-5" strokeWidth={1.75} />
                )}
              </button>
            </div>
          </div>

          {/* Confirm Password Field */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="confirmPassword"
              className="text-sm font-medium text-slate-700 dark:text-slate-300 text-left"
            >
              Confirm password
            </label>
            <div className="relative">
              <input
                id="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                placeholder="Repeat your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="h-12 w-full rounded-lg border border-slate-200 dark:border-border bg-white dark:bg-muted/40 px-3.5 pr-10 text-sm text-slate-900 dark:text-foreground placeholder:text-slate-400 focus:border-[#00794c] focus:outline-none focus:ring-2 focus:ring-[#00794c]/20 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((visible) => !visible)}
                aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
              >
                {showConfirmPassword ? (
                  <EyeOff className="h-5 w-5" strokeWidth={1.75} />
                ) : (
                  <Eye className="h-5 w-5" strokeWidth={1.75} />
                )}
              </button>
            </div>
          </div>

          {/* Create Account CTA */}
          <button
            type="submit"
            disabled={loading}
            className="mt-2 h-12 w-full rounded-lg bg-[#00794c] hover:bg-[#006841] active:scale-[0.99] text-white text-sm font-semibold transition-all disabled:opacity-50 shadow-sm cursor-pointer"
          >
            {loading ? "Creating account..." : "Create account"}
          </button>
        </form>

        {/* Footer */}
        <p className="mt-8 text-center text-sm text-slate-600 dark:text-muted-foreground">
          Already have an account?{" "}
          <Link
            href={
              inviteToken
                ? `/login?invite=${encodeURIComponent(inviteToken)}`
                : "/login"
            }
            className="font-semibold text-[#00794c] hover:text-[#006841] transition-colors"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
