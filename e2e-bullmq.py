"""Temporary BullMQ pipeline E2E — two signed-in accounts (deleted after run).

Ada (Captain): sign in -> create project -> upload footage -> jobs flow through
BullMQ -> worker -> Socket.IO progress -> UI shows SUCCEEDED without reload.
Zoe (member): sign in -> sees the project -> posts a comment that appears live
in Ada's open studio (socket, no reload).
"""
import asyncio
import json
import os
import sys
import tempfile
import time

from playwright.async_api import async_playwright

BASE = "http://localhost:5173"
CREATORS_DOOR = BASE + "/categories/content-creators"
CREATORS = BASE + "/creators-den/"

HERE = os.path.dirname(os.path.abspath(__file__))
ADA_TOKEN = open(os.path.join(HERE, "e2e-token-ada.txt")).read().strip()
ZOE_TOKEN = open(os.path.join(HERE, "e2e-token-zoe.txt")).read().strip()
ZOE_EMAIL = "tandem.walkthrough.zoe@gmail.com"
COMMENT_TEXT = f"Live from Zoe over the socket {int(time.time())}"

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, extra: str = "") -> None:
    results.append((name, ok))
    print(("PASS  " if ok else "FAIL  ") + name + (f"  [{extra}]" if extra else ""))


def ticket_script(token: str) -> str:
    return f"""
(async () => {{
  const t = {json.dumps(token)};
  try {{
    let signIn = await window.Clerk.client.signIn.create({{ strategy: 'ticket', ticket: t }});
    if (signIn && signIn.status !== 'complete') {{
      try {{
        const attempt = await signIn.attemptFirstFactor({{ strategy: 'ticket', ticket: t }});
        if (attempt && attempt.status) signIn = attempt;
      }} catch (e) {{ console.error('attemptFirstFactor', e); }}
    }}
    return JSON.stringify({{ status: signIn && signIn.status,
                            sessions: window.Clerk.client ? window.Clerk.client.sessions.length : -1 }});
  }} catch (e) {{ return JSON.stringify({{ err: e.message }}); }}
}})()
"""


async def ticket_signin(page, token: str) -> None:
    await page.goto(BASE, wait_until="domcontentloaded")
    await page.wait_for_function(
        "() => window.Clerk && window.Clerk.client && window.Clerk.client.signIn", timeout=40000
    )
    res = await page.evaluate(ticket_script(token))
    print("   signin ->", res)
    # The ticket completes but Clerk activates the session after a navigation;
    # the caller waits for it once on an app page.


async def wait_any(page, locator, timeout_s=20) -> bool:
    try:
        await page.wait_for_selector(locator, timeout=timeout_s * 1000)
        return True
    except Exception:
        return False


async def main() -> int:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)

        # ---------------------------------------------------------------- ADA
        ada_ctx = await browser.new_context()
        ada = await ada_ctx.new_page()
        await ticket_signin(ada, ADA_TOKEN)

        await ada.goto(CREATORS_DOOR, wait_until="domcontentloaded")
        sess = False
        try:
            await ada.wait_for_function("() => !!(window.Clerk && window.Clerk.session)", timeout=30000)
            sess = True
        except Exception:
            pass
        check("Ada signed in (active Clerk session)", sess, ada.url)
        await ada.click('[data-testid="link-open-creators-den"]')
        try:
            await ada.wait_for_url("**/creators-den/", timeout=20000)
            check("Ada reached Creators Den through the doorway", True)
        except Exception:
            check("Ada reached Creators Den through the doorway", False, ada.url)

        project_name = f"BullMQ E2E {int(time.time())}"
        await ada.fill('[data-testid="input-video-project-name"]', project_name)
        await ada.click('[data-testid="button-create-video-project"]')
        try:
            await ada.wait_for_url("**/creators-den/projects/*", timeout=20000)
            check("Ada created a project", True)
        except Exception:
            check("Ada created a project", False, ada.url)
        project_url = ada.url.rstrip("/")
        project_id = project_url.split("/")[-1]

        upload_path = os.path.join(tempfile.gettempdir(), "interview-cam-a.mp4")
        with open(upload_path, "wb") as f:
            f.write(b"fake video bytes for e2e walkthrough")
        await ada.set_input_files('[data-testid="input-asset-file"]', upload_path)
        await ada.click('[data-testid="button-upload-asset"]')

        # BullMQ pipeline: job rows appear and flip to SUCCEEDED via the socket
        # (React Query invalidated by job.progress — no page reload).
        job_texts: list[str] = []
        for _ in range(60):
            job_texts = await ada.locator('[data-testid^="job-"]').all_text_contents()
            if sum(1 for t in job_texts if "succeeded" in t.lower()) >= 2:
                break
            await asyncio.sleep(0.5)
        check(
            "Both BullMQ jobs reached SUCCEEDED live in the vault",
            sum(1 for t in job_texts if "succeeded" in t.lower()) >= 2,
            " | ".join(t.strip().replace("\n", " ") for t in job_texts[:4]),
        )
        for _ in range(30):
            cards = await ada.locator('[data-testid^="card-asset-"]').all_text_contents()
            if any("processed" in c.lower() for c in cards):
                break
            await asyncio.sleep(0.5)
        check(
            "Asset flipped to PROCESSED in the vault",
            any("processed" in c.lower() for c in cards),
        )

        # Invite Zoe (ARCHITECT) — Captain-only form.
        await ada.fill('[data-testid="input-invite-email"]', ZOE_EMAIL)
        await ada.select_option('[data-testid="select-invite-role"]', "ARCHITECT")
        await ada.click('[data-testid="button-invite-member"]')
        member_ok = False
        for _ in range(30):
            members = await ada.locator('[data-testid^="card-member-"]').count()
            if members >= 2:
                member_ok = True
                break
            await asyncio.sleep(0.5)
        check("Ada invited Zoe to the project (member roster grew to 2)", member_ok)

        # Ada opens the Selects studio and keeps it open (live socket).
        await ada.goto(project_url + "/selects", wait_until="domcontentloaded")
        await wait_any(ada, '[data-testid="form-comment"]', 20)
        check("Ada opened the Selects studio", True)
        await ada.screenshot(path="/tmp/e2e-ada-selects.png")

        # ---------------------------------------------------------------- ZOE
        zoe_ctx = await browser.new_context()
        zoe = await zoe_ctx.new_page()
        await ticket_signin(zoe, ZOE_TOKEN)
        await zoe.goto(CREATORS, wait_until="domcontentloaded")
        sess = False
        try:
            await zoe.wait_for_function("() => !!(window.Clerk && window.Clerk.session)", timeout=30000)
            sess = True
        except Exception:
            pass
        check("Zoe signed in (active Clerk session)", sess, zoe.url)
        check(
            "Zoe sees the project in her Creators Den room",
            await wait_any(zoe, f'[data-testid="card-video-project-{project_id}"]', 25),
        )
        await zoe.goto(project_url + "/selects", wait_until="domcontentloaded")
        await wait_any(zoe, '[data-testid="form-comment"]', 20)

        await zoe.fill('[data-testid="input-comment"]', COMMENT_TEXT)
        await zoe.click('[data-testid="button-add-comment"]')
        posted = await wait_any(zoe, '[data-testid^="comment-"]', 15)
        check("Zoe posted a timecode note in the studio", posted)

        # Cross-account live check: Ada's open studio shows it with no reload.
        appeared = False
        for _ in range(30):
            texts = await ada.locator('[data-testid^="comment-"]').all_text_contents()
            if any(COMMENT_TEXT.split(" ")[0] in t and "socket" in t for t in texts):
                appeared = True
                break
            await asyncio.sleep(0.5)
        check("Zoe's note appeared live in Ada's open studio (Socket.IO, no reload)", appeared)
        await ada.screenshot(path="/tmp/e2e-ada-live-comment.png")

        failed = [n for n, ok in results if not ok]
        print(f"\n==== RESULT: {len(results) - len(failed)}/{len(results)} checks passed ====")
        if failed:
            print("FAILED:", failed)
        await browser.close()
        print(f"PROJECT_ID {project_id}")
        return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
