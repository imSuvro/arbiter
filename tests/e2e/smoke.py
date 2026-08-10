import os
import re
from pathlib import Path

from playwright.sync_api import Page, TimeoutError as PlaywrightTimeoutError, expect, sync_playwright


WEB_URL = os.environ.get("WEB_URL", "http://localhost:3000")
EMAIL = os.environ.get("ARBITER_OPERATOR_EMAIL", "operator@arbiter.local")
PASSWORD = os.environ.get("ARBITER_OPERATOR_PASSWORD", "local-password-123")
ARTIFACTS = Path("test-results")


def login(page: Page) -> None:
    page.goto(f"{WEB_URL}/login", wait_until="domcontentloaded")
    settle(page)
    page.get_by_label("Email address").fill(EMAIL)
    page.get_by_label("Password").fill(PASSWORD)
    page.get_by_role("button", name="Sign in to Arbiter").click()
    page.wait_for_url(re.compile(r"/console$"))


def settle(page: Page) -> None:
    try:
        page.wait_for_load_state("networkidle", timeout=10_000)
    except PlaywrightTimeoutError:
        # Next development HMR keeps a connection open; DOM readiness is still
        # deterministic, and the console workflow below waits on its own UI state.
        pass


def run() -> None:
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    console_errors: list[str] = []
    page_errors: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = context.new_page()
        page.set_default_timeout(30_000)
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        try:
            page.goto(WEB_URL, wait_until="domcontentloaded")
            settle(page)
            expect(page.get_by_role("heading", name=re.compile("Turn agent behavior"))).to_be_visible()
            login(page)
            expect(page.get_by_role("heading", name="Good experiments leave a trail.")).to_be_visible()
            page.get_by_role("link", name=re.compile("Author a task")).click()
            page.wait_for_url(re.compile(r"/console/tasks/new$"))
            page.get_by_label("Task title").fill("Webhook receipt audit")
            page.get_by_label("Stable slug").fill("webhook-receipt-audit")
            page.get_by_label("Summary").fill("Verify that webhook receipts preserve identity across repeated delivery attempts.")
            page.get_by_label("Candidate instructions").fill("Implement a deterministic receipt normalizer and preserve the event identity when the same webhook is delivered more than once.")
            page.get_by_label("Verifier-only files").fill("check.mjs=console.log(JSON.stringify({ status: 'passed', score: 100, message: 'Contract accepted.' }))")
            page.get_by_role("button", name=re.compile("Create draft version")).click()
            page.wait_for_url(re.compile(r"/console/tasks/[^/]+$"))
            expect(page.get_by_role("heading", name="Webhook receipt audit")).to_be_visible()
            page.get_by_role("button", name=re.compile("Publish version")).click()
            expect(page.get_by_text("Published").first).to_be_visible()
            page.get_by_role("button", name=re.compile("Run evaluation")).click()
            page.wait_for_url(re.compile(r"/console/runs/[^/]+$"))
            expect(page.get_by_role("heading", name="Deterministic CI fixture")).to_be_visible()
            expect(page.get_by_text("100 / 100")).to_be_visible(timeout=15_000)
            page.get_by_role("link", name="Compare runs").last.click()
            page.wait_for_url(re.compile(r"/console/compare$"))
            expect(page.get_by_role("heading", name="Put verdicts side by side.")).to_be_visible()
            page.screenshot(path=str(ARTIFACTS / "arbiter-console.png"), full_page=True)
        except Exception:
            try:
                page.screenshot(path=str(ARTIFACTS / "arbiter-failure.png"), full_page=True, timeout=5_000)
            except PlaywrightTimeoutError:
                pass
            raise
        finally:
            if console_errors or page_errors:
                raise AssertionError(f"Browser errors: console={console_errors}, page={page_errors}")
            context.close()
            browser.close()


if __name__ == "__main__":
    run()
