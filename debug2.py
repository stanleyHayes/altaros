from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    page = b.new_page()
    page.on("requestfailed", lambda r: print(f"FAILED {r.method} {r.url} -> {r.failure}"))
    page.on("response", lambda r: print(f"{r.status} {r.request.method} {r.url}") if "localhost:8080" in r.url or "/api" in r.url else None)
    page.goto("http://localhost:5173/login")
    page.wait_for_timeout(3000)
    page.fill('input[type="email"]', "pastor@grace-chapel.org")
    page.fill('input[type="password"]', "AltarOS2026!")
    page.click('button[type="submit"]')
    page.wait_for_timeout(4000)
    print("URL:", page.url)
    b.close()
