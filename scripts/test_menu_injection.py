"""E2E via add_script_tag (real <script> execution path, like the actual bundle)."""
from playwright.sync_api import sync_playwright

BODY = open("lib/client.js", encoding="utf-8").read()
start = BODY.index("    var lastRowSessionId = null")
end = BODY.index("    /* ------------------------------------------------------------ */\n    /* plugin wiring")
BODY = BODY[start:end]

SETUP = r"""
var localeCtx = null;
var NS = 'move-session';
window.__opened = null;
window.__escapes = 0;
function setState(patch) { window.__opened = patch; }
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') window.__escapes += 1; });
var row = document.createElement('div');
row.setAttribute('role', 'treeitem');
row['__reactFiber$f'] = { memoizedProps: {}, return: { memoizedProps: {}, return: { memoizedProps: { node: { id: 'session-target-9' } } } } };
row.innerHTML = '<button type="button" aria-label="会话\u201c目标会话\u201d的操作">\u2026</button>';
document.body.appendChild(row);
installRowMenuInjection();
"""

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.set_content("<!doctype html><html><body></body></html>")
    page.add_script_tag(content=SETUP + BODY)

    # 1. observer injects into a newly opened session-row menu
    page.evaluate(
        """var menu = document.createElement('div');
        menu.setAttribute('role', 'menu');
        menu.innerHTML = '<div role="presentation"><div><button role="menuitem">重命名</button></div><div><button role="menuitem">分叉会话</button></div><div><button role="menuitem">归档会话</button></div></div>';
        document.body.appendChild(menu);"""
    )
    page.wait_for_timeout(400)
    print("== menu items total:", page.locator('[role="menu"] [role="menuitem"]').count())

    # 2. click ellipsis -> captures id
    page.locator('button[aria-label^="会话\u201c"]').dispatch_event("click")
    page.wait_for_timeout(200)
    print("== captured session id:", page.evaluate("() => lastRowSessionId"))

    # 3. click the injected item -> dialog opens with the captured id + Escape
    injected = page.locator('[data-dsh-ms-menu-item] [role="menuitem"]')
    print("== injected item present:", injected.count() > 0)
    if injected.count() > 0:
        print("   label:", repr(injected.first.inner_text()))
        injected.first.dispatch_event("click")
        page.wait_for_timeout(300)
        print("   dialog opened:", page.evaluate("() => window.__opened"))
        print("   escape dispatched:", page.evaluate("() => window.__escapes"))
    browser.close()
