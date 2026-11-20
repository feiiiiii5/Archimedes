# Start a new session with an empty composer

Both production Electron builds used the same 1,180 × 900 Charcoal viewport.
Type an unsent prompt in the Optics notebook, switch to the Spectroscopy
notebook and type a second draft, then return to Optics. The Optics draft
returns during ordinary navigation. Open the session menu and choose
**New session**.

| Before (`ffb20f5`) | After (`5ff5813`) |
| --- | --- |
| ![The old Optics draft reappears in the new session](explicit-new-session-before.png) | ![The new session has an empty composer](explicit-new-session-after.png) |

Returning to Spectroscopy restores its own draft in both builds. A separate
run on the fixed build confirmed that typing a follow-up and attaching a
file during the first streamed reply still preserves that work when the
conversation is saved.
