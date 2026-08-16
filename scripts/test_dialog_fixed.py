"""Dialog interaction tests with real React: force functional update, default
keep, unconditional close, reopen-after-cancel. The harness is a standalone
copy of the component logic (scripts/dialog_harness.js, kept in sync with
lib/client.js — see AGENTS.md rule 3)."""
from playwright.sync_api import sync_playwright
import os

with open("scripts/dialog_harness.js", encoding="utf-8") as f:
    COMPONENT_JS = f.read()

# React UMD builds live inside the dsh profile; resolve via ~ so the test
# never hard-codes a user-specific absolute path (see AGENTS.md rule 6).
PROFILE_NODE_MODULES = os.path.join(os.path.expanduser("~"), ".dsh", "profiles", "node_modules")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.set_content('<!doctype html><html><body><div id="button-host"></div><div id="dialog-host"></div></body></html>')
    page.add_script_tag(path=os.path.join(PROFILE_NODE_MODULES, "react", "umd", "react.production.min.js"))
    page.add_script_tag(path=os.path.join(PROFILE_NODE_MODULES, "react-dom", "umd", "react-dom.production.min.js"))
    page.add_script_tag(content=COMPONENT_JS)
    page.wait_for_timeout(500)

    # open -> default keep
    page.click(".dsh-ms-header-button")
    page.wait_for_timeout(300)
    print("1. open:", page.locator(".dsh-ms-card").count() > 0)
    print("   default mode checked keep:", page.evaluate("() => { const r = document.querySelectorAll('input[name=dsh-ms-mode]'); return r[0].checked; }"))

    # toggle modes back and forth several times -> dialog stays open
    for i in range(6):
        page.click("label.dsh-ms-mode >> nth=" + str(i % 2))
        page.wait_for_timeout(120)
    print("2. dialog open after 6 mode toggles:", page.locator(".dsh-ms-card").count() > 0)

    # cancel -> closes
    page.click(".dsh-ms-btn:has-text('\u53d6\u6d88')")
    page.wait_for_timeout(400)
    print("3. dialog visible after cancel:", page.locator(".dsh-ms-card").count() > 0)

    # reopen from the header button -> works again
    page.click(".dsh-ms-header-button")
    page.wait_for_timeout(300)
    print("4. dialog open after button again:", page.locator(".dsh-ms-card").count() > 0)

    # close via backdrop, reopen, cancel again (repeat to be sure)
    page.click(".dsh-ms-card")
    page.wait_for_timeout(300)
    print("5. dialog visible after card click (should stay open):", page.locator(".dsh-ms-card").count() > 0)
    page.click(".dsh-ms-backdrop", position={"x": 5, "y": 5})
    page.wait_for_timeout(400)
    print("6. dialog visible after backdrop corner click (should close):", page.locator(".dsh-ms-card").count() > 0)
    page.click(".dsh-ms-header-button")
    page.wait_for_timeout(300)
    page.click(".dsh-ms-btn:has-text('\u53d6\u6d88')")
    page.wait_for_timeout(400)
    print("7. dialog visible after cancel (2nd round):", page.locator(".dsh-ms-card").count() > 0)

    # keep-mode success panel: submit -> done panel -> open moved session
    # (regression: onClick previously cleared state before reading dialog.done.sessionId)
    page.evaluate("() => { window.__openCalls = []; }")
    page.click(".dsh-ms-header-button")
    page.wait_for_timeout(300)
    page.click(".dsh-ms-btn.primary")  # 迁移 (confirm, keep mode default)
    page.wait_for_timeout(400)
    print("8. success panel shown after keep submit:", page.locator(".dsh-ms-success").count() > 0)
    print("   openCalls before open button (keep mode must not auto-open):", page.evaluate("() => window.__openCalls"))
    page.click(".dsh-ms-btn.primary")  # open moved session
    page.wait_for_timeout(400)
    calls = page.evaluate("() => window.__openCalls")
    print("9. openCalls after open button:", calls)
    print("   moved session opened:", calls == ["new-1"])
    print("   dialog closed after open:", page.locator(".dsh-ms-card").count() == 0)
    browser.close()
