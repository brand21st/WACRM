"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { ArrowLeft, Eye, EyeOff } from "lucide-react";

export default function ResetPasswordPage() {
  const t = useTranslations("ResetPasswordPage");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
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
    if (!isSupabaseConfigured()) {
      setError(t("notConfigured"));
      return;
    }

    setLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError(t("sessionExpired"));
        setLoading(false);
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });
      if (updateError) {
        setError(updateError.message);
        setLoading(false);
        return;
      }

      window.location.href = "/login";
    } catch {
      setError(t("networkError"));
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fbfbfb] dark:bg-background px-4 py-8">
      <div className="w-full max-w-[420px]">
        <Link
          href="/login"
          className="mb-3.5 inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition-colors group cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          <span>{t("backToSignIn")}</span>
        </Link>

        <div className="rounded-2xl border border-slate-100 dark:border-border bg-white dark:bg-card p-8 sm:p-10 shadow-sm sm:shadow-md">
          <div className="text-left">
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-foreground">
              {t("title")}
            </h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-muted-foreground">
              {t("desc")}
            </p>
          </div>

          {error && (
            <div className="mt-5 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="password"
                className="text-sm font-medium text-slate-700 dark:text-slate-300"
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
                className="text-sm font-medium text-slate-700 dark:text-slate-300"
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
              {loading ? t("saving") : t("submit")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
