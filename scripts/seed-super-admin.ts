/**
 * Create or promote the platform Super Admin user.
 *
 * Reads SUPER_ADMIN_EMAIL + SUPER_ADMIN_PASSWORD from the environment
 * (or .env.local). Never hardcode the password in source.
 *
 *   npx tsx scripts/seed-super-admin.ts
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnvLocal() {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // .env.local is optional when the vars are already in the environment.
  }
}

loadEnvLocal();

const email = (process.env.SUPER_ADMIN_EMAIL ?? "").trim().toLowerCase();
const password = process.env.SUPER_ADMIN_PASSWORD ?? "";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!email || !password) {
  console.error(
    "Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD in .env.local",
  );
  process.exit(1);
}
if (!url || !serviceKey) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const { data: listed, error: listErr } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (listErr) {
    console.error("Failed to list users:", listErr.message);
    process.exit(1);
  }

  const existing = listed.users.find(
    (u) => (u.email ?? "").toLowerCase() === email,
  );

  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      app_metadata: {
        ...existing.app_metadata,
        is_platform_admin: true,
      },
    });
    if (error) {
      console.error("Failed to promote Super Admin:", error.message);
      process.exit(1);
    }
    console.log(`Promoted existing user ${email} to platform admin`);
    return;
  }

  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { is_platform_admin: true },
  });
  if (error) {
    console.error("Failed to create Super Admin:", error.message);
    process.exit(1);
  }
  console.log(`Created platform admin ${email}`);
}

void main();
