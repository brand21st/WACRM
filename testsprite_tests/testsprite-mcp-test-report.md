# TestSprite AI Testing Report(MCP)

---

## 1️⃣ Document Metadata
- **Project Name:** WACRM
- **Date:** 2026-08-25
- **Prepared by:** TestSprite AI Team
- **Scope:** Shopify catalog settings (frontend) on `http://localhost:3001`
- **Also run locally:** Vitest — 144 passed across Shopify, AI, webhook, and config route tests

---

## 2️⃣ Requirement Validation Summary

### Requirement: User Login
- **Description:** Merchants sign in with email/password and reach the authenticated CRM workspace.

#### Test TC001 Sign in and reach the CRM workspace
- **Test Code:** [TC001_Sign_in_and_reach_the_CRM_workspace.py](./TC001_Sign_in_and_reach_the_CRM_workspace.py)
- **Test Error:**
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/ecf26723-58e8-549d-b1b4-84ec5c93548e/test/4f2a7c82-8faf-4b13-b4d5-609339e0d83b
- **Status:** ✅ Passed
- **Severity:** LOW
- **Analysis / Findings:** `post@post.com` / `123456` signs in. Dashboard and Settings nav are visible after submit.

---

### Requirement: Shopify settings
- **Description:** Settings → Shopify shows the store connection form. Catalog sync stays disabled until a store is connected. Invalid or missing Admin API tokens must not save.

#### Test TC003 Sign in and open Shopify settings
- **Test Code:** [TC003_Sign_in_and_open_Shopify_settings.py](./TC003_Sign_in_and_open_Shopify_settings.py)
- **Test Error:**
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/ecf26723-58e8-549d-b1b4-84ec5c93548e/test/f8559840-a1a6-403a-b663-1d15e3e75761
- **Status:** ✅ Passed
- **Severity:** LOW
- **Analysis / Findings:** After sign-in, Settings → Shopify shows the shop domain field. Sync catalog is disabled while unconnected.

#### Test TC009 Block saving an invalid Shopify token
- **Test Code:** [TC009_Block_saving_an_invalid_Shopify_token.py](./TC009_Block_saving_an_invalid_Shopify_token.py)
- **Test Error:**
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/ecf26723-58e8-549d-b1b4-84ec5c93548e/test/6b84dda0-f226-45b7-b398-cb494808d3c4
- **Status:** ✅ Passed
- **Severity:** LOW
- **Analysis / Findings:** Saving a shop domain without an Admin API token does not create a connection. GET `/api/shopify/config` stays `{ configured: false }` and does not return `access_token`.

---

### Requirement: Workspace navigation
- **Description:** Signed-in users can move between CRM sections without losing the session.

#### Test TC008 Keep the dashboard and workspace navigation available after sign in
- **Test Code:** [TC008_Keep_the_dashboard_and_workspace_navigation_available_after_sign_in.py](./TC008_Keep_the_dashboard_and_workspace_navigation_available_after_sign_in.py)
- **Test Error:**
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/ecf26723-58e8-549d-b1b4-84ec5c93548e/test/ebf36b5d-6b89-4d4a-8342-341dd4aa5064
- **Status:** ✅ Passed
- **Severity:** LOW
- **Analysis / Findings:** Inbox, Contacts, AI Agents, and Settings stay reachable after login. Sidebar still shows `post@post.com`.

---

## 3️⃣ Coverage & Matching Metrics

- **100%** of executed TestSprite cases passed (4/4)
- **144/144** Vitest cases passed (Shopify + AI + webhook + config)

| Requirement | Total Tests | ✅ Passed | ❌ Failed |
|---------------|-------------|-----------|-----------|
| User Login | 1 | 1 | 0 |
| Shopify settings | 2 | 2 | 0 |
| Workspace navigation | 1 | 1 | 0 |
| Local unit (Vitest) | 144 | 144 | 0 |

Manual browser check (same session): Settings overview tile is **Shopify · Not set up yet**. Panel at `/settings?tab=shopify` shows domain, `shpat_…` token field, optional catalog ID, auto-reply switch, Save, and disabled Sync.

---

## 4️⃣ Key Gaps / Risks

Live catalog, order lookup, photo match, and WhatsApp buy-link send were **not** exercised end-to-end. Those paths need a real Admin API access token (`shpat_…`). The store `aurimo-in-vbwxucgp.myshopify.com` is still disconnected.

A client secret / API key is not enough to finish that path. After a `shpat_` token is saved, re-run TC002 / TC005 / TC006 / catalog sync and send a WhatsApp product photo.

---
