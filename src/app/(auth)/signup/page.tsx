"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  isDuplicateSignupUser,
  signupDestination,
  signupEmailRedirectTo,
} from "@/lib/auth/callback";
import { persistProfileWhatsApp } from "@/lib/auth/persist-whatsapp";
import { composeWhatsAppNumber, DEFAULT_COUNTRY_ISO2 } from "@/lib/geo/dial-codes";
import { WhatsAppNumberField } from "@/components/auth/whatsapp-number-field";
import { ArrowLeft, Eye, EyeOff, CheckCircle } from "lucide-react";

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
  const t = useTranslations("SignupPage");

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [whatsappCountry, setWhatsappCountry] = useState(DEFAULT_COUNTRY_ISO2);
  const [whatsappNational, setWhatsappNational] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const supabase = createClient();

  const loginHref = inviteToken
    ? `/login?invite=${encodeURIComponent(inviteToken)}`
    : "/login";

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError(t("mismatch"));
      return;
    }

    if (password.length < 6) {
      setError(t("tooShort"));
      return;
    }

    const parsedWhatsapp = composeWhatsAppNumber(
      whatsappCountry,
      whatsappNational,
    );
    if (!parsedWhatsapp) {
      setError(t("invalidWhatsapp"));
      return;
    }

    if (!isSupabaseConfigured()) {
      setError(t("notConfigured"));
      return;
    }

    setLoading(true);

    try {
      const emailRedirectTo = signupEmailRedirectTo(
        window.location.origin,
        inviteToken,
      );

      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            whatsapp_number: parsedWhatsapp,
          },
          emailRedirectTo,
        },
      });

      if (signUpError) {
        setError(signUpError.message);
        setLoading(false);
        return;
      }

      if (isDuplicateSignupUser(data.user)) {
        setError(t("alreadyRegistered"));
        setLoading(false);
        return;
      }

      if (data.session) {
        if (data.user?.id) {
          await persistProfileWhatsApp(
            supabase,
            data.user.id,
            parsedWhatsapp,
            { onlyIfEmpty: false },
          );
        }
        const {
          data: { user },
        } = await supabase.auth.getUser();
        window.location.href = signupDestination({
          inviteToken,
          isPlatformAdmin: user?.app_metadata?.is_platform_admin === true,
        });
        return;
      }

      setSuccess(true);
      setLoading(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("networkError");
      setError(msg);
      setLoading(false);
    }
  };

  const handleGoogleSignUp = async () => {
    if (!isSupabaseConfigured()) {
      setError(t("notConfigured"));
      return;
    }

    try {
      setError(null);
      setGoogleLoading(true);
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback${
            inviteToken ? `?invite=${encodeURIComponent(inviteToken)}` : ""
          }`,
        },
      });
      if (oauthError) {
        setError(oauthError.message);
        setGoogleLoading(false);
      }
    } catch {
      setError(t("networkError"));
      setGoogleLoading(false);
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
            {t("checkEmailTitle")}
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-muted-foreground leading-relaxed">
            {t("checkEmailBody", { email })}
          </p>
          <div className="mt-6">
            <Link href={loginHref}>
              <button
                type="button"
                className="h-12 w-full rounded-lg bg-[#00794c] hover:bg-[#006841] text-white text-sm font-semibold transition-all shadow-sm cursor-pointer"
              >
                {t("backToSignIn")}
              </button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fbfbfb] dark:bg-background px-4 py-8">
      <div className="w-full max-w-[420px]">
        <Link
          href="/"
          className="mb-3.5 inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition-colors group cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          <span>{t("backToHome")}</span>
        </Link>

        <div className="rounded-2xl border border-slate-100 dark:border-border bg-white dark:bg-card p-8 sm:p-10 shadow-sm sm:shadow-md">
          <div className="text-center">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-foreground">
              {inviteToken ? t("titleInvite") : t("title")}
            </h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-muted-foreground">
              {inviteToken ? t("descInvite") : t("desc")}
            </p>
          </div>

          {error && (
            <div className="mt-5 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          <form onSubmit={handleSignup} className="mt-6 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="fullName"
                className="text-sm font-medium text-slate-700 dark:text-slate-300 text-left"
              >
                {t("fullNameLabel")}
              </label>
              <input
                id="fullName"
                type="text"
                placeholder={t("fullNamePlaceholder")}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                className="h-12 w-full rounded-lg border border-slate-200 dark:border-border bg-white dark:bg-muted/40 px-3.5 text-sm text-slate-900 dark:text-foreground placeholder:text-slate-400 focus:border-[#00794c] focus:outline-none focus:ring-2 focus:ring-[#00794c]/20 transition-all"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="email"
                className="text-sm font-medium text-slate-700 dark:text-slate-300 text-left"
              >
                {t("emailLabel")}
              </label>
              <input
                id="email"
                type="email"
                placeholder={t("emailPlaceholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-12 w-full rounded-lg border border-slate-200 dark:border-border bg-white dark:bg-muted/40 px-3.5 text-sm text-slate-900 dark:text-foreground placeholder:text-slate-400 focus:border-[#00794c] focus:outline-none focus:ring-2 focus:ring-[#00794c]/20 transition-all"
              />
            </div>

            <WhatsAppNumberField
              id="whatsappNumber"
              iso2={whatsappCountry}
              national={whatsappNational}
              onIso2Change={setWhatsappCountry}
              onNationalChange={setWhatsappNational}
              autoDetect
              required
              countryLabel={t("whatsappCountryLabel")}
              numberLabel={t("whatsappLabel")}
              nationalPlaceholder={t("whatsappPlaceholder")}
              hint={t("whatsappHint")}
            />

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="password"
                className="text-sm font-medium text-slate-700 dark:text-slate-300 text-left"
              >
                {t("passwordLabel")}
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder={t("passwordPlaceholder")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-12 w-full rounded-lg border border-slate-200 dark:border-border bg-white dark:bg-muted/40 px-3.5 pr-10 text-sm text-slate-900 dark:text-foreground placeholder:text-slate-400 focus:border-[#00794c] focus:outline-none focus:ring-2 focus:ring-[#00794c]/20 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? t("hidePassword") : t("showPassword")}
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

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="confirmPassword"
                className="text-sm font-medium text-slate-700 dark:text-slate-300 text-left"
              >
                {t("confirmPasswordLabel")}
              </label>
              <div className="relative">
                <input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder={t("confirmPasswordPlaceholder")}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="h-12 w-full rounded-lg border border-slate-200 dark:border-border bg-white dark:bg-muted/40 px-3.5 pr-10 text-sm text-slate-900 dark:text-foreground placeholder:text-slate-400 focus:border-[#00794c] focus:outline-none focus:ring-2 focus:ring-[#00794c]/20 transition-all"
                />
                <button
                  type="button"
                  onClick={() =>
                    setShowConfirmPassword((visible) => !visible)
                  }
                  aria-label={
                    showConfirmPassword ? t("hidePassword") : t("showPassword")
                  }
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

            <button
              type="submit"
              disabled={loading}
              className="mt-2 h-12 w-full rounded-lg bg-[#00794c] hover:bg-[#006841] active:scale-[0.99] text-white text-sm font-semibold transition-all disabled:opacity-50 shadow-sm cursor-pointer"
            >
              {loading ? t("creating") : t("submit")}
            </button>

            <button
              type="button"
              onClick={handleGoogleSignUp}
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
                {googleLoading ? t("googleConnecting") : t("google")}
              </span>
            </button>
          </form>

          <p className="mt-8 text-center text-sm text-slate-600 dark:text-muted-foreground">
            {t("hasAccount")}{" "}
            <Link
              href={loginHref}
              className="font-semibold text-[#00794c] hover:text-[#006841] transition-colors"
            >
              {t("signIn")}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
