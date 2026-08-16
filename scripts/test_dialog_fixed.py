"""Verify the pkg-10 fixes with real React: force functional update + default keep."""
import re
from playwright.sync_api import sync_playwright

# reuse the test page scaffolding from test_dialog.py, but patch the two fixes
src = open("scripts/test_dialog.py", encoding="utf-8").read()
m = re.search(r"COMPONENT_JS = r\"\"\"(.*?)\"\"\"", src, re.S)
COMPONENT_JS = m.group(1)

# apply the SAME fixes as pkg-10: functional force update + default keep
COMPONENT_JS = COMPONENT_JS.replace(
    "for (var i = 0; i < listeners.length; i++) listeners[i]();",
    "for (var i = 0; i < listeners.length; i++) listeners[i](function (n) { return n + 1; });",
)
COMPONENT_JS = COMPONENT_JS.replace(
    "var modeState = React.useState('archive');",
    "var modeState = React.useState('keep');",
)
COMPONENT_JS = COMPONENT_JS.replace(
    "if (dialog.open) { setTargetId(null); setMode('archive'); }",
    "if (dialog.open) { setTargetId(null); setMode('keep'); }",
)
# keep option first in the list
COMPONENT_JS = COMPONENT_JS.replace(
    "      modeOption('archive', t('dialog.archive'), t('dialog.archiveHint')),\n      modeOption('keep', t('dialog.keep'), t('dialog.keepHint'))",
    "      modeOption('keep', t('dialog.keep'), t('dialog.keepHint')),\n      modeOption('archive', t('dialog.archive'), t('dialog.archiveHint'))",
)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.set_content('<!doctype html><html><body><div id="button-host"></div><div id="dialog-host"></div></body></html>')
    page.add_script_tag(path=r"~\.dsh\profiles\node_modules\react\umd\react.production.min.js")
    page.add_script_tag(path=r"~\.dsh\profiles\node_modules\react-dom\umd\react-dom.production.min.js")
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
    browser.close()
