"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { ArrowLeft, Eye, EyeOff, Mail } from "lucide-react";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite");
  const t = useTranslations("LoginPage");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const supabase = createClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (!isSupabaseConfigured()) {
      setError(
        "Supabase is not configured yet. Please add your NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local."
      );
      setLoading(false);
      return;
    }

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user?.app_metadata?.is_platform_admin === true) {
        window.location.href = "/super-admin";
        return;
      }

      const accountRes = await fetch("/api/account");
      if (accountRes.status === 403) {
        const payload = (await accountRes.json().catch(() => null)) as {
          code?: string;
          error?: string;
        } | null;
        if (payload?.code === "account_suspended") {
          await supabase.auth.signOut();
          setError(payload.error || "This account has been suspended");
          setLoading(false);
          return;
        }
      }

      const destination = inviteToken
        ? `/join/${encodeURIComponent(inviteToken)}`
        : "/dashboard";
      window.location.href = destination;
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : "Failed to connect to authentication server. Please check your network and Supabase configuration.";
      setError(msg);
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (!isSupabaseConfigured()) {
      setError(
        "Supabase is not configured yet. Please add your NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local."
      );
      return;
    }

    try {
      setError(null);
      setGoogleLoading(true);
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback${
            inviteToken ? `?invite=${encodeURIComponent(inviteToken)}` : ""
          }`,
        },
      });
      if (error) {
        setError(error.message);
        setGoogleLoading(false);
      }
    } catch {
      setError("Failed to initialize Google sign-in. Please check your network and Supabase OAuth configuration.");
      setGoogleLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fbfbfb] dark:bg-background px-4 py-8">
      <div className="w-full max-w-[420px]">
        {/* Back to Home Button */}
        <Link
          href="/"
          className="mb-3.5 inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition-colors group cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          <span>Back to home</span>
        </Link>

        <div className="rounded-2xl border border-slate-100 dark:border-border bg-white dark:bg-card p-8 sm:p-10 shadow-sm sm:shadow-md">
          {/* Header */}
          <div className="text-left">
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-foreground">
              {inviteToken ? t("titleAccept") : "Log in"}
            </h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-muted-foreground">
              {inviteToken
                ? t("descAccept")
                : "Welcome back! Please enter your email."}
            </p>
          </div>

        {/* Error Alert */}
        {error && (
          <div className="mt-5 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleLogin} className="mt-6 flex flex-col gap-4">
          {/* Email Field */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="email"
              className="text-sm font-medium text-slate-700 dark:text-slate-300"
            >
              Email
            </label>
            <div className="relative">
              <input
                id="email"
                type="email"
                placeholder="Your Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-12 w-full rounded-lg border border-slate-200 dark:border-border bg-white dark:bg-muted/40 px-3.5 pr-10 text-sm text-slate-900 dark:text-foreground placeholder:text-slate-400 focus:border-[#007a4d] focus:outline-none focus:ring-2 focus:ring-[#007a4d]/20 transition-all"
              />
              <div className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                <Mail className="h-5 w-5" strokeWidth={1.75} />
              </div>
            </div>
          </div>

          {/* Password Field */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="password"
              className="text-sm font-medium text-slate-700 dark:text-slate-300"
            >
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="h-12 w-full rounded-lg border border-slate-200 dark:border-border bg-white dark:bg-muted/40 px-3.5 pr-10 text-sm text-slate-900 dark:text-foreground placeholder:text-slate-400 focus:border-[#007a4d] focus:outline-none focus:ring-2 focus:ring-[#007a4d]/20 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
              >
                {showPassword ? (
                  <EyeOff className="h-5 w-5" strokeWidth={1.75} />
                ) : (
                  <Eye className="h-5 w-5" strokeWidth={1.75} />
                )}
              </button>
            </div>

            {/* Forgot Password Link */}
            <div className="flex justify-end mt-1">
              <Link
                href="/forgot-password"
                className="text-xs sm:text-sm font-normal text-[#ff4d4f] hover:text-[#e0383a] transition-colors"
              >
                Forgot password?
              </Link>
            </div>
          </div>

          {/* LOGIN CTA */}
          <button
            type="submit"
            disabled={loading}
            className="mt-4 h-12 w-full rounded-lg bg-[#007a4d] hover:bg-[#006841] active:scale-[0.99] text-white text-sm font-bold tracking-wider transition-all disabled:opacity-50 shadow-sm cursor-pointer"
          >
            {loading ? "LOGGING IN..." : "LOGIN"}
          </button>

          {/* Sign in with Google */}
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={googleLoading}
            className="h-12 w-full rounded-lg border border-slate-200 dark:border-border bg-white dark:bg-card hover:bg-slate-50 dark:hover:bg-muted text-slate-700 dark:text-foreground text-sm font-medium flex items-center justify-center gap-3 transition-colors shadow-sm cursor-pointer disabled:opacity-50"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                fill="#EA4335"
              />
            </svg>
            <span>
              {googleLoading ? "Connecting..." : "Sign in with Google"}
            </span>
          </button>
        </form>

        {/* Footer */}
        <p className="mt-8 text-center text-sm text-slate-600 dark:text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link
            href={
              inviteToken
                ? `/signup?invite=${encodeURIComponent(inviteToken)}`
                : "/signup"
            }
            className="font-semibold text-[#007a4d] hover:text-[#006841] transition-colors"
          >
            Sign up
          </Link>
        </p>
      </div>
    </div>
  </div>
  );
}
