# Manuscript slides handoff screenshots

These captures show the actual `PaperToSlidesView` component at the dependency base (`d077fe1`) and at this feature head. Both stages use the same 1440×1000 viewport, target workspace, selected `main.pdf` path, form values, paper/charcoal themes, and Electron 43 capture path. The "before" stage selects the same PDF manually through the existing chooser; the "after" stage receives the same PDF through a compiled manuscript request.

The setup result in the "after" images comes from a deterministic bridge fixture: required checks are ready and preview/QA tools are optional. It is not a claim that this machine's Python, npm or MinerU configuration is ready, and no PPTX was generated for these images.

| Theme | State | Before | After |
| --- | --- | --- | --- |
| Paper | Page and source receipt | `paper-form-before.png` | `paper-form-after.png` |
| Paper | Form, setup checks and readiness | `paper-setup-before.png` | `paper-setup-after.png` |
| Charcoal | Page and source receipt | `charcoal-form-before.png` | `charcoal-form-after.png` |
| Charcoal | Form, setup checks and readiness | `charcoal-setup-before.png` | `charcoal-setup-after.png` |

The "after" form shows the compiled source path, source version and PDF hash, the return-to-source action, the setup check controls and the fixture readiness state. The image harness lives outside the repository; no harness HTML/TSX is committed.

## Chinese setup diagnostics

`chinese-setup-before.png` and `chinese-setup-after.png` use the same
1440×1000 Charcoal content viewport in Electron, with Chinese selected and
the same fixture reporting a missing MinerU token and an optional font check.
The comparison starts at `99b66c4`. The updated form shows both instructions
in Chinese. The fixture supplies no token and does not start a presentation.
