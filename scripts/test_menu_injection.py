"""E2E via add_script_tag (real <script> execution path, like the actual bundle).
Covers:
  1. idle session row menu  -> injected item enabled, click opens the dialog
  2. running session row    -> injected item disabled (like the header button)
  3. workspace row menu     -> NOT injected
"""
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
// idle session row: fiber carries node.id + running:false
var idleRow = document.createElement('div');
idleRow.setAttribute('role', 'treeitem');
idleRow['__reactFiber$f'] = { memoizedProps: {}, return: { memoizedProps: {}, return: { memoizedProps: { node: { id: 'session-idle-1', running: false } } } } };
idleRow.innerHTML = '<button type="button" aria-label="会话\u201c空闲会话\u201d的操作">\u2026</button>';
document.body.appendChild(idleRow);
// running session row
var runRow = document.createElement('div');
runRow.setAttribute('role', 'treeitem');
runRow['__reactFiber$r'] = { memoizedProps: {}, return: { memoizedProps: {}, return: { memoizedProps: { node: { id: 'session-run-1', running: true } } } } };
runRow.innerHTML = '<button type="button" aria-label="会话\u201c运行中会话\u201d的操作">\u2026</button>';
document.body.appendChild(runRow);
// workspace row: fiber carries no node.id
var wsRow = document.createElement('div');
wsRow.setAttribute('role', 'treeitem');
wsRow['__reactFiber$w'] = { memoizedProps: {}, return: { memoizedProps: { workspace: { id: 'ws-1', title: 'WS1' } } } };
wsRow.innerHTML = '<button type="button" aria-label="工作区\u201cWS1\u201d的操作">\u2026</button>';
document.body.appendChild(wsRow);
installRowMenuInjection();
"""

SESSION_MENU = """var menu = document.createElement('div');
menu.setAttribute('role', 'menu');
menu.innerHTML = '<div role="presentation"><div><button role="menuitem">重命名</button></div><div><button role="menuitem">分叉会话</button></div><div><button role="menuitem">归档会话</button></div></div>';
document.body.appendChild(menu);
window.__lastMenu = menu;
"""


def open_menu(page):
    page.evaluate(SESSION_MENU)
    page.wait_for_timeout(400)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.set_content("<!doctype html><html><body></body></html>")
    page.add_script_tag(content=SETUP + BODY)

    # ---- 1. idle session row: injected item enabled + opens dialog ----
    page.locator('button[aria-label^="会话\u201c空闲会话"]').dispatch_event("click")
    page.wait_for_timeout(200)
    print("== idle row:", page.evaluate("() => ({ id: lastRowSessionId, running: lastRowRunning, isSession: lastRowIsSession })"))
    open_menu(page)
    injected = page.locator('[data-dsh-ms-menu-item] [role="menuitem"]')
    print("== idle: injected present:", injected.count() > 0, "| disabled:", injected.first.is_disabled() if injected.count() else None)
    injected.first.dispatch_event("click")
    page.wait_for_timeout(300)
    print("== idle: dialog opened:", page.evaluate("() => window.__opened"), "| escape:", page.evaluate("() => window.__escapes"))

    # ---- 2. running session row: injected item disabled ----
    page.locator('button[aria-label^="会话\u201c运行中会话"]').dispatch_event("click")
    page.wait_for_timeout(200)
    print("== running row:", page.evaluate("() => ({ id: lastRowSessionId, running: lastRowRunning, isSession: lastRowIsSession })"))
    open_menu(page)
    injected = page.locator('[data-dsh-ms-menu-item] [role="menuitem"]')
    print("== running: injected items total:", injected.count(), "| last disabled:", injected.last.is_disabled() if injected.count() else None)
    print("== running: last title hint:", repr(injected.last.get_attribute("title")) if injected.count() else None)

    # ---- 3. workspace row menu must NOT be injected ----
    page.locator('button[aria-label^="工作区\u201c"]').dispatch_event("click")
    page.wait_for_timeout(200)
    print("== ws row:", page.evaluate("() => ({ id: lastRowSessionId, running: lastRowRunning, isSession: lastRowIsSession })"))
    page.evaluate(
        """var wsMenu = document.createElement('div');
        wsMenu.setAttribute('role', 'menu');
        wsMenu.innerHTML = '<div role="presentation"><div><button role="menuitem">重命名工作区</button></div><div><button role="menuitem">删除工作区</button></div></div>';
        document.body.appendChild(wsMenu);"""
    )
    page.wait_for_timeout(400)
    ws_menus = page.locator('[role="menu"]')
    ws_injected = page.locator('[data-dsh-ms-menu-item] [role="menuitem"]')
    print("== ws menus:", ws_menus.count(), "| injected items total:", ws_injected.count(), "(expect 2: idle + running)")
    print("== ws menu NOT injected:", ws_injected.count() == 2)
    browser.close()
