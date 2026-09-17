/* รันด้วย: node tests/syntax-check.mjs
   ดึงทุกบล็อก <script> ที่เป็น inline ออกจาก index.html แล้วให้ node --check ตรวจไวยากรณ์ */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const file = join(here, "..", "index.html");
const html = readFileSync(file, "utf8");

const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
const dir = mkdtempSync(join(tmpdir(), "monitor-syntax-"));
let n = 0, bad = 0, m;
while ((m = re.exec(html))) {
  const attrs = m[1];
  if (/\bsrc=/.test(attrs)) continue;           // external script — ไม่มี body
  const id = (/id="([^"]+)"/.exec(attrs) || [, "inline" + n])[1];
  const p = join(dir, `${n}-${id}.js`);
  writeFileSync(p, m[2]);
  try {
    execFileSync(process.execPath, ["--check", p], { stdio: "pipe" });
    console.log(`✓ <script id="${id}"> (${m[2].length} bytes)`);
  } catch (e) {
    bad++;
    console.log(`✗ <script id="${id}"> → ${String(e.stderr || e.message).split("\n").slice(0, 3).join(" ")}`);
  }
  n++;
}
console.log(`\n${n - bad} ผ่าน, ${bad} ไม่ผ่าน (รวม ${n} บล็อก)`);
process.exit(bad ? 1 : 0);
