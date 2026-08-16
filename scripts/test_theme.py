"""Theme E2E: the dialog palette follows the GUI light/dark appearance.
Written in the exact style of the verified control script (single-line
evaluate strings, direct reads) to avoid the flaky variants."""
from playwright.sync_api import sync_playwright

BODY = open("lib/client.js", encoding="utf-8").read()
start = BODY.index("    var lastRowSessionId = null")
end = BODY.index("    /* ------------------------------------------------------------ */\n    /* plugin wiring")
BODY = BODY[start:end]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.set_content("<!doctype html><html><body></body></html>")
    page.add_script_tag(content=BODY)
    page.evaluate(
        "document.body.style.background = 'rgb(21, 21, 23)'; "
        "installThemeWatcher(); "
        "window.__rafN = 0; function loop() { window.__rafN += 1; requestAnimationFrame(loop); } "
        "requestAnimationFrame(loop); 'ok'"
    )
    page.wait_for_timeout(200)
    dark = page.evaluate(
        "() => ({ bg: getComputedStyle(document.documentElement).getPropertyValue('--dsh-ms-bg').trim(), "
        "text: getComputedStyle(document.documentElement).getPropertyValue('--dsh-ms-text').trim(), "
        "primary: getComputedStyle(document.documentElement).getPropertyValue('--dsh-ms-primary').trim() })"
    )
    print("== dark palette:", dark)
    assert dark["bg"] == "#1f1f23", "dark mode should use the dark palette"

    page.evaluate("document.body.style.background = 'rgb(250, 250, 252)'")
    page.wait_for_timeout(400)
    light = page.evaluate(
        "() => ({ bg: getComputedStyle(document.documentElement).getPropertyValue('--dsh-ms-bg').trim(), "
        "text: getComputedStyle(document.documentElement).getPropertyValue('--dsh-ms-text').trim() })"
    )
    print("== light palette:", light)
    assert light["bg"] == "#ffffff", "light mode should use the light palette"

    ok = page.evaluate(
        "() => { const dispose = installThemeWatcher(); dispose(); return true; }"
    )
    print("== disposer ok:", ok)
    print("== THEME E2E PASSED")
    browser.close()
