import { getActiveWindow } from "../src/core/WinWindow";
import fs from "fs";
import path from "path";

(async () => {
  const settingsPath = path.resolve(__dirname, "../settings.json");
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  const match = settings.actions?.windowMatch || {};
  const aw = await getActiveWindow();
  const res = {
    active: aw,
    match,
    checks: {
      titleRegex: match.titleRegex ? new RegExp(match.titleRegex).test(aw.title || "") : true,
      titleEquals: match.titleEquals ? (aw.title || "") === match.titleEquals : true,
      classNameEquals: match.classNameEquals ? (aw.className || "") === match.classNameEquals : true,
      processFileExact: match.processFileExact ? (aw.processFile || "") === match.processFileExact : true,
      processNameEquals: match.processNameEquals ? (aw.processName || "") === match.processNameEquals : true,
    }
  } as any;
  res.ok = Object.values(res.checks).every(Boolean);
  console.log(JSON.stringify(res, null, 2));
})();
