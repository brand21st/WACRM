# VaChat (Flutter)

Official agent app for WACRM. Talks to the same Supabase project and Next.js CRM as the web dashboard (`https://cloud.vachat.in`).

Do **not** put `wacrm_live_*` API keys or the Supabase service-role key in this app. Auth is a user JWT.

## Run

This project ships Android, iOS, and **Windows**. On a Windows PC with no phone or emulator, run the desktop build:

```bash
cd mobile
cp .env.example .env
flutter pub get
flutter run -d windows --dart-define-from-file=.env
```

Windows plugin builds need NTFS symlinks. If you see `Building with plugins requires symlink support`, either turn on **Developer Mode** (`start ms-settings:developers`) or create directory junctions (no admin):

```powershell
powershell -ExecutionPolicy Bypass -File tool/windows_plugin_junctions.ps1
flutter run -d windows --dart-define-from-file=.env
```

Windows also needs Visual Studio’s **Desktop development with C++** workload (MSVC, CMake, Windows SDK). `flutter doctor` will list anything missing. Prefer an Android emulator when that workload is not installed:

```bash
flutter emulators --launch Pixel_8a
flutter run -d android --dart-define-from-file=.env
```

Blank `SUPABASE_ANON_KEY` in `.env` is fine — the app falls back to the same public VaChat key as the old Expo client.

Phone/emulator (when connected):

```bash
flutter run -d android --dart-define-from-file=.env
```

Do **not** use Chrome/Edge (`-d chrome`). Flutter web is not a target; the CRM API does not send CORS headers for it.

Without `--dart-define-from-file`, production VaChat defaults are used.

Local Next.js from Windows desktop: `API_URL=http://127.0.0.1:3000`. Android emulator: `API_URL=http://10.0.2.2:3000`.

## Login

`/login` uses `supabase.auth.signInWithPassword` then `GET /api/account`. Google uses PKCE with `vachatapp://auth/callback`. Sign-up and password reset stay on the CRM web app.

Add `vachatapp://auth/callback` to Supabase Auth → Redirect URLs. Do **not** change Site URL (`https://cloud.vachat.in`) or web `/login` will break.

## Push

Inbound WhatsApp push uses FCM. Register `google-services.json` / `GoogleService-Info.plist` when you have a Firebase project, and set `FCM_*` on the Next.js host. The app still runs without Firebase; push is skipped.
