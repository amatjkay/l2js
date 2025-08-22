# Target Validation in TargetState

This document describes the immediate post-click validation of targets.

Overview
- Pre-click OCR: read expected title from a thin stripe directly above the selected bbox. The stripe is fixed above the bbox; it is not shifted.
- Click: cursor is moved by actions.clickOffsetY (default 35) to click slightly below the name, since clicking on the text itself won’t select the target reliably.
- Post-click OCR: read hpText from the HP bar ROI (cv.targetHpBar.roi) using OCR settings from cv.targetHpBar.ocr.
- Decision rules (in order):
  1) If hpText is in acceptList (case-insensitive) — always accept (never ignore).
  2) If expectedTitle is empty and hpText is non-empty — accept (header OCR may fail).
  3) If expectedTitle is in acceptList — accept.
  4) Otherwise require hpText to contain expectedTitle (substring). If not, ignore immediately.
  5) Ignore-by-text list is also respected.
- Ignore persistence: records are written to logs/ignore-list.json with coordinates, name and TTL; radius-based suppression prevents re-targeting nearby for the TTL duration.

Settings
- cv.lock.titleRoiPx: height of the pre-click OCR stripe above bbox (default 40 px).
- cv.lock.minNameLength: minimal valid name length to drop noise like "Te".
- cv.lock.ignoreRadiusPx: radius for spatial ignore (default 48 px).
- cv.lock.ignoreTtlMs: TTL for ignore entries (default 120000 ms).
- actions.clickOffsetY: cursor vertical shift before click (default 35). Positive values shift down.

Notes
- titleOffsetYPx is NOT used. The OCR stripe is fixed directly above the bbox.
- Diagnostics are saved to logs/tmp/title_<ts>.png and logs/tmp/hp_<ts>.png.
- When capture.debug=true and cv.ocr.enabled=true, bboxes.json contains an OCR section.
