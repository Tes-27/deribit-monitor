/* รันด้วย: node tests/payoff-map.test.mjs
   ดึงบล็อก <script id="pb-core"> และ <script id="payoff-map"> ออกจาก index.html มา eval
   แล้วทดสอบการแปลง position → leg ด้วย fixture ที่เหมือนของจริง */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const grab = id => {
  const m = html.match(new RegExp(`<script id="${id}">([\\s\\S]*?)<\\/script>`));
  if (!m) throw new Error(`หาบล็อก ${id} ใน index.html ไม่เจอ`);
  return m[1];
};
new Function(grab("pb-core")).call(globalThis);
new Function(grab("payoff-map")).call(globalThis);
const P = globalThis.PB, M = globalThis.PayoffMap;
assert.ok(P, "pb-core ไม่ได้ export PB");
assert.ok(M, "payoff-map ไม่ได้ export PayoffMap");

/* ---------- harness ---------- */
let pass = 0, fail = 0;
const results = [];
function test(name, fn) {
  try { fn(); pass++; results.push(["✓", name, ""]); }
  catch (e) { fail++; results.push(["✗", name, e.message.split("\n")[0]]); }
}
const near = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg || ""} ได้ ${a} คาดว่า ${b} (คลาด ${Math.abs(a - b)} > ${tol})`);

const NOW = Date.UTC(2026, 8, 17, 3, 0, 0);     // 2026-09-17 03:00 UTC
const SPOT = 78000;
const YEAR_MS = 365 * 24 * 3600 * 1000;

/* ---------- fixtures: รูปร่างเดียวกับ acc.positions ที่ normalize แล้ว ---------- */
const pos = o => Object.assign({
  symbol: "BTC-PERPETUAL", cat: "inverse", dirBuy: true,
  size: 1000, entry: 78000, mark: 78010, liq: null, index: SPOT,
}, o);

const EXP_SEP26 = Date.UTC(2026, 8, 25, 8, 0, 0, 0);
const EXP_DEC26 = Date.UTC(2026, 11, 25, 8, 0, 0, 0);
const T_DEC26 = (EXP_DEC26 - NOW) / YEAR_MS;
const FWD_DEC26 = 80600;
// mark ของจริงมาจากโมเดลเดียวกับที่เราใช้ (Deribit ให้ mark_iv ที่ reproduce mark ได้)
// ปัดตาม tick จริง → markOffset เหลือค่าเล็กๆ เหมือนข้อมูลจริง
const r4 = x => Math.round(x * 1e4) / 1e4;
const r5 = x => Math.round(x / 5) * 5;
const MK_C_INV = r4(P.black76Usd(FWD_DEC26, 100000, T_DEC26, 0.462, true) / FWD_DEC26);
const MK_P_INV = r4(P.black76Usd(FWD_DEC26, 60000, T_DEC26, 0.528, false) / FWD_DEC26);
const MK_C_LIN = r5(P.black76Usd(FWD_DEC26, 100000, T_DEC26, 0.460, true));

const DBT = {                                    // พอร์ท Deribit
  idx: 0, name: "Main", exchange: "deribit", positions: [
    pos({ symbol: "BTC-PERPETUAL", cat: "inverse", dirBuy: false, size: 23000, entry: 78100, liq: 91000 }),
    pos({ symbol: "BTC-25SEP26", cat: "inverse", dirBuy: true, size: 1000, entry: 77977.8, mark: 80100 }),
    pos({ symbol: "BTC_USDC-PERPETUAL", cat: "future", dirBuy: true, size: 0.4, entry: 77500, mark: 78020 }),
    pos({ symbol: "BTC-25DEC26-100000-C", cat: "option", dirBuy: true, size: 3, entry: 0.042, mark: MK_C_INV }),
    pos({ symbol: "BTC-25DEC26-60000-P", cat: "option", dirBuy: false, size: 2, entry: 0.018, mark: MK_P_INV }),
    pos({ symbol: "BTC_USDC-25DEC26-100000-C", cat: "option", dirBuy: true, size: 1, entry: 3200, mark: MK_C_LIN }),
    pos({ symbol: "ETH-PERPETUAL", cat: "inverse", dirBuy: true, size: 500, entry: 3000 }),
  ],
};
const BYB = {                                    // พอร์ท Bybit
  idx: 1, name: "ไบบิท", exchange: "bybit", positions: [
    pos({ symbol: "BTCUSD", cat: "inverse", dirBuy: false, size: 5000, entry: 79000, liq: 95000 }),
    pos({ symbol: "BTC-31OCT26-110000-C", cat: "option", dirBuy: true, size: 1, entry: 1500 }),
    pos({ symbol: "ETHUSDT", cat: "future", dirBuy: true, size: 2, entry: 3000 }),
  ],
};
const PHX = {                                    // พอร์ท Phemex
  idx: 2, name: "Phemex", exchange: "phemex", positions: [
    pos({ symbol: "BTCUSDT", cat: "future", dirBuy: true, size: 0.25, entry: 76500, liq: 61000 }),
    pos({ symbol: "sBTCUSDT", cat: "spot", dirBuy: true, size: 0.1, entry: 70000 }),
  ],
};

const TICKERS = {
  "BTC-25SEP26":               { mark_price: 80100, index_price: 78000 },
  "BTC-25DEC26-100000-C":      { mark_price: MK_C_INV, mark_iv: 46.2, underlying_price: FWD_DEC26, index_price: 78000 },
  "BTC-25DEC26-60000-P":       { mark_price: MK_P_INV, mark_iv: 52.8, underlying_price: FWD_DEC26, index_price: 78000 },
  "BTC_USDC-25DEC26-100000-C": { mark_price: MK_C_LIN, mark_iv: 46.0, underlying_price: FWD_DEC26, index_price: 78000 },
};
const run = (accs, over) => M.positionsToLegs(accs, Object.assign(
  { now: NOW, spot: SPOT, tickers: TICKERS, PB: P }, over || {}));
const byName = (r, s) => r.legs.find(l => l.symbol === s);

/* ==================== การอ่านชื่อสัญญา ==================== */
test("deribitExpiryTs: 25SEP26 → 08:00 UTC ของวันนั้น", () => {
  assert.equal(M.deribitExpiryTs("25SEP26"), EXP_SEP26);
  assert.equal(new Date(EXP_SEP26).toISOString(), "2026-09-25T08:00:00.000Z");
  assert.equal(M.deribitExpiryTs("1JAN27"), Date.UTC(2027, 0, 1, 8));
  assert.equal(M.deribitExpiryTs("PERPETUAL"), null);
  assert.equal(M.deribitExpiryTs("25XXX26"), null);
});

test("parseDeribit แยก base/settle/strike/optType ถูก", () => {
  assert.deepEqual(M.parseDeribit("BTC-PERPETUAL"),
    { base: "BTC", settle: null, perp: true, expiryTs: null, strike: null, optType: null });
  const o = M.parseDeribit("BTC_USDC-25DEC26-100000-C");
  assert.equal(o.base, "BTC"); assert.equal(o.settle, "USDC");
  assert.equal(o.strike, 100000); assert.equal(o.optType, "call");
  assert.equal(o.expiryTs, EXP_DEC26);
  assert.equal(M.parseDeribit("BTC-25DEC26-60000-P").optType, "put");
  assert.equal(M.parseDeribit("ETH-PERPETUAL").base, "ETH");
});

test("isBtcSymbol กรอง underlying", () => {
  assert.equal(M.isBtcSymbol("deribit", "BTC_USDC-PERPETUAL"), true);
  assert.equal(M.isBtcSymbol("deribit", "ETH-PERPETUAL"), false);
  assert.equal(M.isBtcSymbol("bybit", "BTCUSDT"), true);
  assert.equal(M.isBtcSymbol("bybit", "ETHUSDT"), false);
  assert.equal(M.isBtcSymbol("phemex", "BTCUSD"), true);
});

/* ==================== Deribit ==================== */
test("inverse perp short → inv_fut, perpetual, side −1, qty เป็น USD", () => {
  const l = byName(run([DBT]), "BTC-PERPETUAL");
  assert.equal(l.kind, "inv_fut");
  assert.equal(l.expiryTs, null);
  assert.equal(l.side, -1);
  assert.equal(l.qty, 23000);
  assert.equal(l.entryPrice, 78100);
  assert.equal(l.fwdRatio, 1);
  assert.equal(l.liq, 91000);
});

test("dated inverse future long: expiry 08:00 UTC + fwdRatio = mark/index", () => {
  const l = byName(run([DBT]), "BTC-25SEP26");
  assert.equal(l.kind, "inv_fut");
  assert.equal(l.side, 1);
  assert.equal(l.qty, 1000);
  assert.equal(l.entryPrice, 77977.8);
  assert.equal(l.expiryTs, EXP_SEP26);
  near(l.fwdRatio, 80100 / 78000, 1e-12);
  near(l.fwdT0, (EXP_SEP26 - NOW) / YEAR_MS, 1e-12);
  // basis สลายเป็นเส้นตรง: ที่ T0 = ค่าเต็ม, ตอนหมดอายุ = 1
  near(P.fwdRatioAt(l, l.fwdT0), 80100 / 78000, 1e-12);
  near(P.fwdRatioAt(l, 0), 1, 0);
});

test("linear perp → lin_fut, qty เป็น BTC", () => {
  const l = byName(run([DBT]), "BTC_USDC-PERPETUAL");
  assert.equal(l.kind, "lin_fut");
  assert.equal(l.qty, 0.4);
  assert.equal(l.expiryTs, null);
});

test("BTC-settled call → inv_opt พร้อม strike/optType/expiry/IV", () => {
  const l = byName(run([DBT]), "BTC-25DEC26-100000-C");
  assert.equal(l.kind, "inv_opt");
  assert.equal(l.optType, "call");
  assert.equal(l.strike, 100000);
  assert.equal(l.expiryTs, EXP_DEC26);
  assert.equal(l.side, 1);
  assert.equal(l.qty, 3);
  assert.equal(l.entryPrice, 0.042);            // BTC/สัญญา
  assert.equal(l.iv, 46.2);
  near(l.fwdRatio, 80600 / 78000, 1e-12);
});

test("BTC-settled put short → inv_opt put, side −1", () => {
  const l = byName(run([DBT]), "BTC-25DEC26-60000-P");
  assert.equal(l.kind, "inv_opt");
  assert.equal(l.optType, "put");
  assert.equal(l.side, -1);
  assert.equal(l.qty, 2);
  assert.equal(l.entryPrice, 0.018);
  assert.equal(l.iv, 52.8);
});

test("USDC-settled option → lin_opt (entry เป็น USDC)", () => {
  const l = byName(run([DBT]), "BTC_USDC-25DEC26-100000-C");
  assert.equal(l.kind, "lin_opt");
  assert.equal(l.strike, 100000);
  assert.equal(l.entryPrice, 3200);
});

test("markOffset ถูกคาลิเบรตให้ค่าโมเดล = mark จริง (และเล็กเมื่อ IV สอดคล้องกัน)", () => {
  const r = run([DBT]);
  for (const name of ["BTC-25DEC26-100000-C", "BTC-25DEC26-60000-P"]) {
    const l = byName(r, name);
    const T = (l.expiryTs - NOW) / YEAR_MS;
    near(P.optUnitValue(l, SPOT, T, 1), TICKERS[name].mark_price, 1e-12, name);
    // ปัดตาม tick เท่านั้น → offset ต้องอยู่ระดับ tick ไม่ใช่หลักเปอร์เซ็นต์
    assert.ok(Math.abs(l.markOffset) <= 1e-4 + 1e-12, `${name} offset ${l.markOffset} ใหญ่เกินไป`);
  }
  const lin = byName(r, "BTC_USDC-25DEC26-100000-C");
  near(P.optUnitValue(lin, SPOT, (lin.expiryTs - NOW) / YEAR_MS, 1), MK_C_LIN, 1e-9);
});

test("ไม่มี ticker → ใช้ mark จาก position แทน และ fwdRatio = 1", () => {
  const l = byName(run([DBT], { tickers: {} }), "BTC-25DEC26-100000-C");
  assert.equal(l.iv, 50);                       // ค่า default เมื่อไม่รู้ IV
  assert.equal(l.fwdRatio, 1);
  const T = (l.expiryTs - NOW) / YEAR_MS;
  near(P.optUnitValue(l, SPOT, T, 1), MK_C_INV, 1e-12);   // mark จาก position
});

/* ==================== Bybit / Phemex ==================== */
test("Bybit inverse → inv_fut · Phemex linear → lin_fut", () => {
  const r = run([BYB, PHX]);
  const b = byName(r, "BTCUSD");
  assert.equal(b.kind, "inv_fut");
  assert.equal(b.side, -1);
  assert.equal(b.qty, 5000);
  assert.equal(b.exchange, "bybit");
  const p = byName(r, "BTCUSDT");
  assert.equal(p.kind, "lin_fut");
  assert.equal(p.qty, 0.25);
  assert.equal(p.exchange, "phemex");
  assert.equal(p.liq, 61000);
});

/* ==================== การคัดออก ==================== */
test("คัด Bybit option / non-BTC / spot ออกพร้อมเหตุผล", () => {
  const r = run([DBT, BYB, PHX]);
  const ex = r.excluded.map(x => x.symbol);
  assert.deepEqual(ex.sort(), ["BTC-31OCT26-110000-C", "ETH-PERPETUAL", "ETHUSDT", "sBTCUSDT"]);
  assert.ok(!r.legs.some(l => ex.includes(l.symbol)));
  const opt = r.excluded.find(x => x.symbol === "BTC-31OCT26-110000-C");
  assert.equal(opt.accName, "ไบบิท");
  assert.ok(/bybit/.test(opt.reason), "เหตุผลควรบอกว่าเป็น option ของ bybit");
});

test("position ที่ไม่มีขนาด/ราคาเข้าถูกคัดออก", () => {
  const a = { idx: 9, name: "ว่าง", exchange: "deribit", positions: [
    pos({ symbol: "BTC-PERPETUAL", size: 0 }),
    pos({ symbol: "BTC-25SEP26", entry: 0 }),
  ] };
  const r = run([a]);
  assert.equal(r.legs.length, 0);
  assert.equal(r.excluded.length, 2);
});

/* ==================== legKey / enabled ==================== */
test("legKey = accIdx|exchange|symbol และ disabled ปิดขาได้", () => {
  const k = M.legKeyOf(0, "deribit", "BTC-PERPETUAL");
  assert.equal(k, "0|deribit|BTC-PERPETUAL");
  const r = run([DBT, BYB], { disabled: [k] });
  assert.equal(byName(r, "BTC-PERPETUAL").enabled, false);
  assert.equal(byName(r, "BTC-25SEP26").enabled, true);
  assert.equal(byName(r, "BTCUSD").legKey, "1|bybit|BTCUSD");
});

test("id ของขาไม่ซ้ำและเรียงต่อเนื่อง", () => {
  const r = run([DBT, BYB, PHX]);
  assert.deepEqual(r.legs.map(l => l.id), r.legs.map((_, i) => i + 1));
});

/* ==================== end-to-end ผ่าน PB ==================== */
test("end-to-end: short 23,000 USD inverse perp @ 78,100 → PnL ที่ S=70,000", () => {
  const acc = { idx: 0, name: "Main", exchange: "deribit", positions: [
    pos({ symbol: "BTC-PERPETUAL", cat: "inverse", dirBuy: false, size: 23000, entry: 78100 }),
  ] };
  const { legs } = run([acc]);
  assert.equal(legs.length, 1);
  const expect = 23000 * (1 / 70000 - 1 / 78100) * 70000;   // = +2385.40 USD (short กำไรเมื่อราคาลง)
  near(expect, 2385.4033, 1e-3);
  assert.ok(expect > 0, "short ต้องกำไรเมื่อราคาลง");
  near(P.legPnlUsd(legs[0], 70000, null, 1), expect, 1e-9);
  near(P.portfolioPnlUsd(legs, 70000, NOW, 0, {}), expect, 1e-9);
  // ราคาขึ้น → ขาดทุน, breakeven ที่ราคาเข้า
  assert.ok(P.portfolioPnlUsd(legs, 90000, NOW, 0, {}) < 0);
  const st = P.curveStats(s => P.portfolioPnlUsd(legs, s, NOW, 0, {}), 40000, 160000, 800);
  assert.equal(st.breakevens.length, 1);
  near(st.breakevens[0], 78100, 1);
});

test("end-to-end: พอร์ตผสมทุก exchange คำนวณเส้น payoff ได้ครบไม่มี NaN", () => {
  const { legs } = run([DBT, BYB, PHX]);
  assert.equal(legs.length, 8);
  for (const S of [45000, 78000, 130000]) {
    assert.ok(isFinite(P.portfolioPnlUsd(legs, S, NOW, 0, {})), "model ที่ " + S);
    assert.ok(isFinite(P.portfolioPnlUsd(legs, S, NOW, 0, { expiry: true })), "expiry ที่ " + S);
  }
  const g = P.portfolioGreeks(legs, SPOT, NOW, 0);
  assert.ok(["delta", "gammaPer1Pct", "vega", "theta"].every(k => isFinite(g[k])));
  const st = P.curveStats(s => P.portfolioPnlUsd(legs, s, NOW, 0, { expiry: true }),
    SPOT * 0.65, SPOT * 1.35, 600);
  assert.ok(Array.isArray(st.breakevens));
});

test("end-to-end: long call ตอนหมดอายุได้ intrinsic/S − premium ตามสัญญา inverse", () => {
  // ไม่ใส่ mark/ticker → markOffset = 0 จึงเทียบกับสูตร intrinsic ตรงๆ ได้
  const acc = { idx: 0, name: "Main", exchange: "deribit", positions: [
    pos({ symbol: "BTC-25DEC26-100000-C", cat: "option", dirBuy: true, size: 3, entry: 0.042, mark: null }),
  ] };
  const { legs } = run([acc], { tickers: {} });
  assert.equal(legs[0].markOffset, 0);
  const S = 130000;
  const expect = 3 * ((S - 100000) / S - 0.042) * S;        // USD
  near(P.portfolioPnlUsd(legs, S, NOW, 0, { expiry: true }), expect, 1e-9);
  // OTM ตอนหมดอายุ → เสีย premium ทั้งหมด (คิดเป็น USD ที่ราคานั้น)
  near(P.portfolioPnlUsd(legs, 60000, NOW, 0, { expiry: true }), -3 * 0.042 * 60000, 1e-9);
});

/* ---------- สรุป ---------- */
const w = Math.max(...results.map(r => r[1].length));
for (const [mark, name, err] of results)
  console.log(`${mark} ${name.padEnd(w)}${err ? "  → " + err : ""}`);
console.log(`\n${pass} ผ่าน, ${fail} ไม่ผ่าน (รวม ${pass + fail})`);
process.exit(fail ? 1 : 0);
