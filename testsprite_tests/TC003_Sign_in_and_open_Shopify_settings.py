import asyncio
import re
from playwright import async_api
from playwright.async_api import expect

async def run_test():
    pw = None
    browser = None
    context = None

    try:
        # Start a Playwright session in asynchronous mode
        pw = await async_api.async_playwright().start()

        # Launch a Chromium browser in headless mode with custom arguments
        browser = await pw.chromium.launch(
            headless=True,
            args=[
                "--window-size=1280,720",
                "--disable-dev-shm-usage",
                "--ipc=host",
                "--single-process"
            ],
        )

        # Create a new browser context (like an incognito window)
        context = await browser.new_context()
        # Wider default timeout to match the agent's DOM-stability budget;
        # auto-waiting Playwright APIs (expect, locator.wait_for) inherit this.
        context.set_default_timeout(15000)

        # Open a new page in the browser context
        page = await context.new_page()

        # Interact with the page elements to simulate user flow
        # -> navigate
        await page.goto("http://localhost:3001/settings")
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=5000)
        except Exception:
            pass
        
        # -> Fill the 'Email' field with 'post@post.com', fill the 'Password' field with '123456', and click the 'Sign in' button.
        # you@example.com email field
        elem = page.locator('[id="email"]')
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("post@post.com")
        
        # -> Fill the 'Email' field with 'post@post.com', fill the 'Password' field with '123456', and click the 'Sign in' button.
        # Enter your password password field
        elem = page.locator('[id="password"]')
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("123456")
        
        # -> Fill the 'Email' field with 'post@post.com', fill the 'Password' field with '123456', and click the 'Sign in' button.
        # Sign in button
        elem = page.get_by_role('button', name='Sign in', exact=True)
        await elem.click(timeout=10000)
        
        # -> Click the 'Settings' link in the left sidebar to open the Settings page.
        # Settings link
        elem = page.get_by_role('link', name='Settings', exact=True)
        await elem.click(timeout=10000)
        
        # -> Click the 'Shopify' button in the Workspace section to open the Shopify settings panel and verify its setup state.
        # Shopify button
        elem = page.get_by_role('button', name='Shopify', exact=True)
        await elem.click(timeout=10000)
        
        # --> Assertions to verify final state
        
        # --> The Shopify settings panel is displayed (Store connection inputs are visible).
        await page.locator("xpath=/html/body/div[2]/div/main/div/div[2]/div/div/div[2]/div[1]/div[2]/div[1]/input").nth(0).scroll_into_view_if_needed()
        # Assert-outcome: passed
        # Assert: Shop domain input is visible in the Shopify settings panel.
        await expect(page.locator("xpath=/html/body/div[2]/div/main/div/div[2]/div/div/div[2]/div[1]/div[2]/div[1]/input").nth(0)).to_be_visible(timeout=15000), "Shop domain input is visible in the Shopify settings panel."
        
        # --> The Shopify setup state shows sync is unavailable (catalog sync button is disabled and no products synced).
        # Assert-outcome: passed
        # Assert: Sync catalog button is disabled, indicating catalog sync is unavailable until a connection is made.
        await expect(page.locator("xpath=/html/body/div[2]/div/main/div/div[2]/div/div/div[2]/div[2]/div[2]/button").nth(0)).to_have_attribute("disabled", "true", timeout=15000), "Sync catalog button is disabled, indicating catalog sync is unavailable until a connection is made."
        await asyncio.sleep(5)

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())
    