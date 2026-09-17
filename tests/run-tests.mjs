/* รันด้วย: node tests/run-tests.mjs
   ดึงบล็อก <script id="pb-core"> ออกจาก index.html มา eval แล้วทดสอบ
   (ไฟล์ที่ deploy ยังเป็นไฟล์เดียวจริงๆ) */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const m = html.match(/<script id="pb-core">([\s\S]*?)<\/script>/);
if (!m) throw new Error("หาบล็อก pb-core ใน index.html ไม่เจอ");
new Function(m[1]).call(globalThis);
const P = globalThis.PB;
assert.ok(P, "pb-core ไม่ได้ export PB");

/* ---------- test harness ---------- */
let pass = 0, fail = 0;
const results = [];
function test(name, fn) {
  try { fn(); pass++; results.push(["✓", name, ""]); }
  catch (e) { fail++; results.push(["✗", name, e.message.split("\n")[0]]); }
}
const near = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg || ""} ได้ ${a} คาดว่า ${b} (คลาด ${Math.abs(a - b)} > ${tol})`);
const relNear = (a, b, rel, msg) =>
  assert.ok(Math.abs(a - b) <= Math.abs(b) * rel + 1e-12, `${msg || ""} ได้ ${a} คาดว่า ${b} (คลาด ${(Math.abs(a - b) / Math.abs(b) * 100).toFixed(4)}% > ${rel * 100}%)`);

const NOW = 1_700_000_000_000;
const DAY = 86400000;
const cfg = P.defaultConfig();
const S0 = 80000;

const leg = o => Object.assign({
  id: 1, kind: "inv_opt", instrument: null, side: 1, optType: "call",
  strike: S0, expiryTs: NOW + 30 * DAY, qty: 1, entryPrice: 0, iv: 50,
  mark: null, markOffset: 0, enabled: true,
}, o);

/* ==================== Black-76 ==================== */
test("ncdf ตรงกับค่ามาตรฐาน", () => {
  near(P.ncdf(0), 0.5, 1e-9);
  near(P.ncdf(1.96), 0.975, 1e-4);
  near(P.ncdf(-1.96), 0.025, 1e-4);
});

test("Black-76: T=0 คืนค่า intrinsic", () => {
  near(P.black76Usd(100, 90, 0, 0.5, true), 10, 1e-12);
  near(P.black76Usd(100, 110, 0, 0.5, true), 0, 1e-12);
  near(P.black76Usd(100, 110, 0, 0.5, false), 10, 1e-12);
});

test("Black-76: put-call parity (r=0 → C − P = F − K)", () => {
  const F = S0, K = 85000, T = 0.25, s = 0.55;
  const c = P.black76Usd(F, K, T, s, true), p = P.black76Usd(F, K, T, s, false);
  near(c - p, F - K, 1e-6);
});

test("Black-76: ATM call ≈ 0.4 × F × σ√T", () => {
  const T = 0.25, s = 0.5;
  const c = P.black76Usd(S0, S0, T, s, true);
  relNear(c, 0.4 * S0 * s * Math.sqrt(T), 0.02);
});

test("markBtc = ราคา USD / underlying", () => {
  const v = P.black76Usd(S0, 90000, 0.1, 0.6, true);
  near(P.markBtc(S0, 90000, 0.1, 0.6, true), v / S0, 1e-15);
});

/* ==================== PnL รายขา ==================== */
test("inverse perp long: PnL(BTC) = N × (1/entry − 1/exit)", () => {
  const l = leg({ kind: "inv_fut", expiryTs: null, side: 1, qty: 10000, entryPrice: 80000 });
  // ราคาขึ้นไป 100k → PnL = 10000 × (1/80000 − 1/100000) = 0.025 BTC
  near(P.legPnlUsd(l, 100000, null) / 100000, 0.025, 1e-12);
  // long กำไรเมื่อราคาขึ้น
  assert.ok(P.legPnlUsd(l, 100000, null) > 0);
  assert.ok(P.legPnlUsd(l, 60000, null) < 0);
});

test("inverse perp short: เครื่องหมายกลับด้าน", () => {
  const lo = leg({ kind: "inv_fut", expiryTs: null, side: 1, qty: 10000, entryPrice: 80000 });
  const sh = { ...lo, side: -1 };
  near(P.legPnlUsd(sh, 123456, null), -P.legPnlUsd(lo, 123456, null), 1e-9);
});

test("linear perp long: PnL(USD) = qty × (exit − entry)", () => {
  const l = leg({ kind: "lin_fut", expiryTs: null, side: 1, qty: 0.5, entryPrice: 80000 });
  near(P.legPnlUsd(l, 90000, null), 0.5 * 10000, 1e-9);
});

test("inverse option long call ตอนหมดอายุ: PnL(BTC) = max(S−K,0)/S − premium", () => {
  const l = leg({ kind: "inv_opt", optType: "call", strike: 80000, qty: 2, entryPrice: 0.03 });
  const S = 100000;
  const expect = 2 * ((100000 - 80000) / S - 0.03);       // BTC
  near(P.legPnlUsd(l, S, 0) / S, expect, 1e-12);
  // OTM → เสีย premium ทั้งหมด
  near(P.legPnlUsd(l, 70000, 0) / 70000, -2 * 0.03, 1e-12);
});

test("linear option short put ตอนหมดอายุ", () => {
  const l = leg({ kind: "lin_opt", optType: "put", side: -1, strike: 80000, qty: 1, entryPrice: 2000 });
  near(P.legPnlUsd(l, 90000, 0), 2000, 1e-9);            // หมดอายุ OTM → เก็บ premium
  near(P.legPnlUsd(l, 70000, 0), 2000 - 10000, 1e-9);
});

test("markOffset เลื่อนเส้นโมเดลให้ผ่าน mark จริง", () => {
  const base = leg({ kind: "inv_opt", strike: 85000, iv: 60, qty: 1, entryPrice: 0.02 });
  const T = P.tYears(base, NOW, 0);
  const model = P.optUnitValue({ ...base, markOffset: 0 }, S0, T, 1);
  const l = { ...base, mark: model + 0.005, markOffset: 0.005 };
  near(P.optUnitValue(l, S0, T, 1), model + 0.005, 1e-12);
});

/* ==================== forward / basis ==================== */
test("fwdRatioAt สลายเป็นเส้นตรงเข้าหา 1 ตอนหมดอายุ", () => {
  const T0 = 0.5;
  const l = leg({ fwdRatio: 1.04, fwdT0: T0 });
  near(P.fwdRatioAt(l, T0), 1.04, 1e-12);         // ตอนที่ดึงข้อมูลมา
  near(P.fwdRatioAt(l, T0 / 2), 1.02, 1e-12);     // เหลือครึ่งเวลา
  near(P.fwdRatioAt(l, 0), 1, 0);                 // หมดอายุ → forward = index
  near(P.fwdRatioAt(l, null), 1, 0);              // perpetual
  near(P.fwdRatioAt(leg({}), 0.3), 1, 0);         // ขาที่กรอกเอง
});

test("option ราคาไกลใช้ forward ตรงกับ Black-76 บน F ไม่ใช่ index", () => {
  const T = 0.83, K = 80000, iv = 0.43, ratio = 1.0396;
  const l = leg({ kind: "lin_opt", optType: "call", strike: K, iv: iv * 100, qty: 1,
                  entryPrice: 0, expiryTs: NOW + T * P.YEAR_MS, fwdRatio: ratio, fwdT0: T });
  const v = P.optUnitValue(l, S0, T, 1);
  near(v, P.black76Usd(S0 * ratio, K, T, iv, true), 1e-9);
  // ต่างจากการใช้ index ตรงๆ อย่างมีนัยสำคัญ (basis ~4%)
  const naive = P.black76Usd(S0, K, T, iv, true);
  assert.ok(Math.abs(v / naive - 1) > 0.03, `ควรต่างจากแบบไม่คิด basis ได้ ${(v / naive - 1) * 100}%`);
});

test("inverse option quote เป็น BTC โดยหารด้วย forward ไม่ใช่ index", () => {
  // ตรวจกับ mark จริงของ BTC-25JUN27-80000-C: หารด้วย index เพี้ยน ~4% เท่ากับ basis พอดี
  const T = 0.825, K = 80000, iv = 0.431, ratio = 1.0395;
  const l = leg({ kind: "inv_opt", optType: "call", strike: K, iv: iv * 100, qty: 1,
                  entryPrice: 0, expiryTs: NOW + T * P.YEAR_MS, fwdRatio: ratio, fwdT0: T });
  const F = S0 * ratio;
  near(P.optUnitValue(l, S0, T, 1), P.black76Usd(F, K, T, iv, true) / F, 1e-12);
  // ถ้าหารด้วย index จะเพี้ยนไปเท่ากับ basis
  const wrong = P.black76Usd(F, K, T, iv, true) / S0;
  relNear(wrong / P.optUnitValue(l, S0, T, 1), ratio, 1e-9);
});

test("เส้นหมดอายุไม่สนใจ forward (settle ที่ index)", () => {
  const l = leg({ kind: "inv_opt", optType: "call", strike: 80000, qty: 1, entryPrice: 0.03,
                  fwdRatio: 1.05, fwdT0: 0.8, expiryTs: NOW + 0.8 * P.YEAR_MS });
  const S = 100000;
  near(P.portfolioPnlUsd([l], S, NOW, 0, { expiry: true }) / S, (100000 - 80000) / S - 0.03, 1e-12);
});

test("dated inverse future ใช้ forward ด้วย และลู่เข้าหา index", () => {
  const T = 0.5;
  const l = leg({ kind: "inv_fut", expiryTs: NOW + T * P.YEAR_MS, qty: 80000,
                  entryPrice: 82000, fwdRatio: 1.025, fwdT0: T });
  const nowPnl = P.legPnlUsd(l, S0, T, 1);
  near(nowPnl, 80000 * (1 / 82000 - 1 / (S0 * 1.025)) * S0, 1e-9);
  // ตอนหมดอายุใช้ index ตรงๆ
  near(P.legPnlUsd(l, S0, 0, 1), 80000 * (1 / 82000 - 1 / S0) * S0, 1e-9);
});

/* ==================== เส้นโมเดล → เส้นหมดอายุ ==================== */
test("เส้นโมเดลลู่เข้าหาเส้นหมดอายุเมื่อ T → 0", () => {
  const legs = [leg({ kind: "inv_opt", strike: 85000, qty: 1, entryPrice: 0.02, iv: 60 })];
  for (const S of [70000, 85000, 110000]) {
    const exp = P.portfolioPnlUsd(legs, S, NOW, 0, { expiry: true });
    // time value ยุบลงเรื่อยๆ เมื่อเข้าใกล้หมดอายุ
    const far = P.portfolioPnlUsd(legs, S, NOW + 30 * DAY - 3600000, 0, {});   // เหลือ 1 ชม.
    const near1 = P.portfolioPnlUsd(legs, S, NOW + 30 * DAY - 1000, 0, {});    // เหลือ 1 วินาที
    assert.ok(Math.abs(near1 - exp) <= Math.abs(far - exp) + 1e-9, `time value ต้องยุบลงที่ S=${S}`);
    relNear(near1, exp, 0.01, `ที่ S=${S}`);
  }
});

/* ==================== breakeven / max P&L ==================== */
test("long call (USD): BE = K + premium×S₀, ขาดทุนจำกัด กำไรไม่จำกัด", () => {
  const prem = 0.03;                                       // BTC/สัญญา
  const legs = [leg({ kind: "inv_opt", optType: "call", strike: 80000, qty: 1, entryPrice: prem })];
  const f = S => P.portfolioPnlUsd(legs, S, NOW, 0, { expiry: true });
  const st = P.curveStats(f, 20000, 200000, 800);
  assert.equal(st.breakevens.length, 1);
  // ตอนหมดอายุ: (S−K)/S − prem = 0 → S = K/(1−prem)
  near(st.breakevens[0], 80000 / (1 - prem), 1);
  assert.equal(st.unboundedUp, true, "กำไรควรไม่จำกัดในหน่วย USD");
  assert.equal(st.unboundedDown, false);
  // เฉพาะ inverse option: premium ที่จ่ายเป็น BTC → ขาดทุนสูงสุดเป็น USD อยู่ที่ใต้ strike พอดี
  // ไม่ใช่ที่ขอบล่างของกราฟ (เพราะ premium×S เล็กลงเมื่อ S ต่ำ)
  relNear(st.maxLoss, -prem * 80000, 3e-3);      // grid หยาบกว่า kink เล็กน้อย
  assert.ok(st.maxLossAt <= 80000 && st.maxLossAt > 79000, `ขาดทุนสูงสุดต้องอยู่ใต้ strike ได้ ${st.maxLossAt}`);
});

test("long call ในหน่วย BTC: กำไรจำกัด (ลู่เข้าหา (1 − premium) × qty)", () => {
  const prem = 0.03;
  const legs = [leg({ kind: "inv_opt", optType: "call", strike: 80000, qty: 1, entryPrice: prem })];
  const fBtc = S => P.portfolioPnlUsd(legs, S, NOW, 0, { expiry: true }) / S;
  const st = P.curveStats(fBtc, 20000, 200000, 800);
  assert.equal(st.unboundedUp, false, "ในหน่วย BTC กำไรต้องจำกัด");
  // สูงสุดในช่วงที่แสดง = (1 − K/hi) − prem ; ลู่เข้าหา 1 − prem เมื่อ S → ∞
  relNear(st.maxProfit, (1 - 80000 / 200000) - prem, 1e-3);
  assert.ok(fBtc(1e9) < 1 - prem && fBtc(1e9) > 0.99 * (1 - prem), "asymptote ที่ 1 − premium");
});

test("inverse perp long: BE = ราคาเข้า, ขาดทุนไม่จำกัดใน BTC", () => {
  const legs = [leg({ kind: "inv_fut", expiryTs: null, qty: 10000, entryPrice: 80000 })];
  const fBtc = S => P.portfolioPnlUsd(legs, S, NOW, 0, {}) / S;
  const st = P.curveStats(fBtc, 8000, 200000, 800);
  assert.equal(st.breakevens.length, 1);
  near(st.breakevens[0], 80000, 1);
  assert.equal(st.unboundedDown, true, "long inverse ขาดทุน BTC ไม่จำกัดเมื่อ S→0");
  assert.equal(st.unboundedUp, false, "กำไร BTC จำกัดที่ N/entry");
});

test("bull call spread: กำไร/ขาดทุนจำกัดทั้งสองด้าน", () => {
  const legs = [
    leg({ id: 1, kind: "lin_opt", optType: "call", side: 1, strike: 80000, qty: 1, entryPrice: 5000 }),
    leg({ id: 2, kind: "lin_opt", optType: "call", side: -1, strike: 90000, qty: 1, entryPrice: 2000 }),
  ];
  const f = S => P.portfolioPnlUsd(legs, S, NOW, 0, { expiry: true });
  const st = P.curveStats(f, 40000, 140000, 800);
  assert.equal(st.unboundedUp, false);
  assert.equal(st.unboundedDown, false);
  near(st.maxProfit, 10000 - 3000, 1);      // ส่วนต่าง strike − net debit
  near(st.maxLoss, -3000, 1);
  assert.equal(st.breakevens.length, 1);
  near(st.breakevens[0], 83000, 1);
});

test("short straddle: BE สองจุด", () => {
  const legs = [
    leg({ id: 1, kind: "lin_opt", optType: "call", side: -1, strike: 80000, qty: 1, entryPrice: 4000 }),
    leg({ id: 2, kind: "lin_opt", optType: "put", side: -1, strike: 80000, qty: 1, entryPrice: 4000 }),
  ];
  const f = S => P.portfolioPnlUsd(legs, S, NOW, 0, { expiry: true });
  const st = P.curveStats(f, 40000, 140000, 1200);
  assert.equal(st.breakevens.length, 2);
  near(st.breakevens[0], 72000, 60);
  near(st.breakevens[1], 88000, 60);
  near(st.maxProfit, 8000, 20);
});

/* ==================== Greeks ==================== */
test("delta ของ long call เทียบสูตร N(d1)", () => {
  const K = 85000, T = 0.25, iv = 0.6;
  const legs = [leg({ kind: "lin_opt", optType: "call", strike: K, iv: iv * 100, qty: 1, entryPrice: 0, expiryTs: NOW + T * P.YEAR_MS })];
  const g = P.portfolioGreeks(legs, S0, NOW, 0);
  const d1 = (Math.log(S0 / K) + 0.5 * iv * iv * T) / (iv * Math.sqrt(T));
  relNear(g.delta, P.ncdf(d1), 1e-4);
});

test("delta ของ long inverse perp ≈ ขนาด BTC ที่ราคาเข้า", () => {
  const legs = [leg({ kind: "inv_fut", expiryTs: null, qty: 8000, entryPrice: 80000 })];
  const g = P.portfolioGreeks(legs, S0, NOW, 0);
  relNear(g.delta, 8000 / 80000, 1e-6);      // = 0.1 BTC
});

test("theta ของ long option ติดลบ, short option เป็นบวก", () => {
  const l = leg({ kind: "lin_opt", optType: "call", strike: 85000, qty: 1, entryPrice: 3000, iv: 60 });
  assert.ok(P.portfolioGreeks([l], S0, NOW, 0).theta < 0);
  assert.ok(P.portfolioGreeks([{ ...l, side: -1 }], S0, NOW, 0).theta > 0);
});

test("gamma เทียบสูตร Black-76 (Δ ที่เปลี่ยนเมื่อราคา +1%)", () => {
  const K = 80000, T = 0.25, iv = 0.5;
  const legs = [leg({ kind: "lin_opt", optType: "call", strike: K, iv: iv * 100, qty: 1, entryPrice: 0, expiryTs: NOW + T * P.YEAR_MS })];
  const g = P.portfolioGreeks(legs, S0, NOW, 0);
  const sq = iv * Math.sqrt(T);
  const d1 = (Math.log(S0 / K) + 0.5 * iv * iv * T) / sq;
  const pdf = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);
  const gammaBs = pdf / (S0 * sq);                        // ต่อ $1²
  relNear(g.gammaPer1Pct, gammaBs * S0 / 100, 1e-3);      // ≈ 0.02–0.03 ไม่ใช่หลักพัน
  assert.ok(Math.abs(g.gammaPer1Pct) < 1, `gamma ต้องอยู่หลักทศนิยม ได้ ${g.gammaPer1Pct}`);
});

test("vega เทียบสูตร Black-76 (ต่อ IV 1 จุด)", () => {
  const K = 80000, T = 0.25, iv = 0.5;
  const legs = [leg({ kind: "lin_opt", optType: "call", strike: K, iv: iv * 100, qty: 1, entryPrice: 0, expiryTs: NOW + T * P.YEAR_MS })];
  const g = P.portfolioGreeks(legs, S0, NOW, 0);
  const sq = iv * Math.sqrt(T);
  const d1 = (Math.log(S0 / K) + 0.5 * iv * iv * T) / sq;
  const pdf = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);
  relNear(g.vega, S0 * pdf * Math.sqrt(T) * 0.01, 1e-3);  // ×0.01 = ต่อ 1 vol point
});

test("vega ของ long option เป็นบวก, gamma ของ short เป็นลบ", () => {
  const l = leg({ kind: "inv_opt", optType: "call", strike: 80000, qty: 1, entryPrice: 0.03, iv: 60 });
  assert.ok(P.portfolioGreeks([l], S0, NOW, 0).vega > 0);
  assert.ok(P.portfolioGreeks([{ ...l, side: -1 }], S0, NOW, 0).gammaPer1Pct < 0);
});

/* ==================== Standard Margin ==================== */
test("SM inverse perp: MM = (1% + 0.5%×BTC/100) × ขนาด BTC", () => {
  const qtyUsd = 80000;                       // = 1 BTC ที่ราคา 80k
  const l = leg({ kind: "inv_fut", expiryTs: null, qty: qtyUsd, entryPrice: 80000 });
  const r = P.smMargin([l], S0, NOW, 0, cfg);
  const sizeBtc = 1, add = 0.005 * (sizeBtc / 100);
  near(r.btc.mm, (0.01 + add) * sizeBtc, 1e-12);
  near(r.btc.im, (0.02 + add) * sizeBtc, 1e-12);
  near(r.mmUsd, r.btc.mm * S0, 1e-9);
});

test("SM: long option ไม่กินมาร์จิ้น (จ่าย premium ไปแล้ว)", () => {
  const l = leg({ kind: "inv_opt", side: 1, strike: 90000, qty: 3, entryPrice: 0.02 });
  const r = P.smMargin([l], S0, NOW, 0, cfg);
  near(r.btc.im, 0, 0); near(r.btc.mm, 0, 0);
});

test("SM short inverse call: IM = max(0.15 − otm, 0.10) + mark", () => {
  const l = leg({ kind: "inv_opt", optType: "call", side: -1, strike: 88000, qty: 2, entryPrice: 0.01, iv: 55 });
  const T = P.tYears(l, NOW, 0);
  const mk = P.optUnitValue(l, S0, T, 1);
  const otmFrac = (88000 - S0) / S0;           // 0.10
  const r = P.smMargin([l], S0, NOW, 0, cfg);
  near(r.btc.im, (Math.max(0.15 - otmFrac, 0.10) + mk) * 2, 1e-12);
  near(r.btc.mm, (0.075 + mk) * 2, 1e-12);
});

test("SM short inverse put ใช้ max(0.075, 0.075×mark)", () => {
  const l = leg({ kind: "inv_opt", optType: "put", side: -1, strike: 70000, qty: 1, entryPrice: 0.01, iv: 55 });
  const T = P.tYears(l, NOW, 0);
  const mk = P.optUnitValue(l, S0, T, 1);
  const r = P.smMargin([l], S0, NOW, 0, cfg);
  near(r.btc.mm, Math.max(0.075, 0.075 * mk) + mk, 1e-12);
});

test("SM แยกสกุล: inverse → BTC, linear → USDC", () => {
  const inv = leg({ id: 1, kind: "inv_fut", expiryTs: null, qty: 80000, entryPrice: 80000 });
  const lin = leg({ id: 2, kind: "lin_fut", expiryTs: null, qty: 1, entryPrice: 80000 });
  const r = P.smMargin([inv, lin], S0, NOW, 0, cfg);
  assert.ok(r.btc.mm > 0 && r.usdc.mm > 0);
  near(r.mmUsd, r.btc.mm * S0 + r.usdc.mm, 1e-6);
  // สองขาขนาดเท่ากัน (1 BTC) → MM ในหน่วย USD ควรใกล้กัน
  relNear(r.usdc.mm, r.btc.mm * S0, 1e-9);
});

/* ==================== Portfolio Margin ==================== */
test("ivShockMult: ที่ 30 วัน = 1 ± volRange พอดี", () => {
  near(P.ivShockMult(30, 1, cfg.pm), 1.45, 1e-12);
  near(P.ivShockMult(30, -1, cfg.pm), 0.70, 1e-12);
  near(P.ivShockMult(30, 0, cfg.pm), 1, 0);
});

test("ivShockMult: อายุสั้นถูกช็อกแรงกว่า อายุยาวเบากว่า", () => {
  assert.ok(P.ivShockMult(7, 1, cfg.pm) > P.ivShockMult(30, 1, cfg.pm));
  assert.ok(P.ivShockMult(180, 1, cfg.pm) < P.ivShockMult(30, 1, cfg.pm));
  // ตัวอย่างในเอกสาร: vol 60 กับ vol up 45% → 87 (ที่ 30 วัน)
  near(60 * P.ivShockMult(30, 1, cfg.pm), 87, 1e-9);
});

test("pmPriceShocks: 11 ขั้นจาก −15% ถึง +15% และมี 0 ตรงกลาง", () => {
  const s = P.pmPriceShocks(cfg.pm);
  assert.equal(s.length, 11);
  near(s[0], -0.15, 1e-12); near(s[10], 0.15, 1e-12);
  near(s[5], 0, 1e-12);
  near(s[1] - s[0], 0.03, 1e-12);
});

test("PM futures contingency = 0.6% ของขนาดรวม (absolute)", () => {
  const a = leg({ id: 1, kind: "inv_fut", expiryTs: null, side: 1, qty: 80000, entryPrice: 80000 });
  const b = leg({ id: 2, kind: "inv_fut", expiryTs: NOW + 60 * DAY, side: -1, qty: 80000, entryPrice: 80000 });
  // long 1 BTC + short 1 BTC → absolute รวม 2 BTC → 0.6% × 2 = 0.012 BTC (ตามตัวอย่างในเอกสาร)
  near(P.futuresContingencyBtc([a, b], S0, cfg.pm), 0.012, 1e-12);
});

test("PM options contingency: ตัวอย่างจากเอกสาร Deribit ได้ 2.1 BTC", () => {
  // underlying 10,000 · ATM range 10%
  const mk = (id, strike, optType, pos) => leg({
    id, kind: "inv_opt", optType, strike,
    side: Math.sign(pos), qty: Math.abs(pos), entryPrice: 0.01, expiryTs: NOW + 30 * DAY,
  });
  const legs = [
    mk(1, 10500, "call", 40), mk(2, 10500, "put", 160),    // strike position +200 (อยู่ในช่วง ATM → ปรับเป็น 100)
    mk(3, 12000, "call", -90), mk(4, 12000, "put", 40),    // −50
    mk(5, 14000, "put", -60),                              // −60
    mk(6, 15000, "call", -200),                            // −200
    mk(7, 16000, "call", 100),                             // +100
    mk(8, 18000, "call", -10),                             // −10
  ];
  // roll ขึ้นจาก ATM: 10500(+100) → 12000 net +50 → 14000 net −10 → 15000 net −200
  //                 → 16000 net +100 → 18000 net +90 ;  short รวม = −210 → ×0.01 = 2.1 BTC
  near(P.optionContingencyBtc(legs, 10000, cfg.pm), 2.1, 1e-9);
});

test("PM: worst case ของ short call คือราคาขึ้น + vol ขึ้น", () => {
  const l = leg({ kind: "inv_opt", optType: "call", side: -1, strike: 88000, qty: 5, entryPrice: 0.02, iv: 55 });
  const r = P.pmMargin([l], S0, NOW, 0, cfg);
  assert.equal(r.worst.shock, 0.15);
  assert.equal(r.worst.volDir, 1);
  assert.ok(r.worstLossUsd < 0);
  near(r.imUsd, r.mmUsd * cfg.pm.imFactor, 1e-9);
});

test("PM: ช่อง (0%, vol เท่าเดิม) ต้องเป็น 0 พอดี (วัดเทียบมูลค่าปัจจุบัน)", () => {
  const legs = [
    leg({ id: 1, kind: "inv_fut", expiryTs: null, qty: 50000, entryPrice: 77000 }),
    leg({ id: 2, kind: "inv_opt", optType: "put", side: -1, strike: 70000, qty: 2, entryPrice: 0.015, iv: 62 }),
  ];
  const r = P.pmMargin(legs, S0, NOW, 0, cfg);
  const zero = r.grid.find(g => Math.abs(g.shock) < 1e-12).cells.find(c => c.volDir === 0);
  near(zero.pnl, 0, 1e-6);
});

test("PM ถูกกว่า SM เมื่อพอร์ตมี hedge (short call + long perp)", () => {
  const legs = [
    leg({ id: 1, kind: "inv_opt", optType: "call", side: -1, strike: 85000, qty: 1, entryPrice: 0.025, iv: 55 }),
    leg({ id: 2, kind: "inv_fut", expiryTs: null, side: 1, qty: 40000, entryPrice: 80000 }),
  ];
  const sm = P.smMargin(legs, S0, NOW, 0, cfg);
  const pm = P.pmMargin(legs, S0, NOW, 0, cfg);
  assert.ok(pm.mmUsd < sm.mmUsd, `PM ${pm.mmUsd.toFixed(0)} ควรน้อยกว่า SM ${sm.mmUsd.toFixed(0)}`);
});

test("PM: เปิด extended scenario แล้ว margin ต้องไม่ลดลง", () => {
  const legs = [leg({ kind: "inv_opt", optType: "put", side: -1, strike: 70000, qty: 3, entryPrice: 0.012, iv: 60 })];
  const base = P.pmMargin(legs, S0, NOW, 0, cfg);
  const ext = P.pmMargin(legs, S0, NOW, 0, { ...cfg, pm: { ...cfg.pm, extended: true } });
  assert.ok(ext.mmUsd >= base.mmUsd - 1e-9);
  assert.ok(ext.grid.length > base.grid.length);
});

/* ==================== equity / liquidation ==================== */
const acct = (btc, usdc, hb, hu) => ({ btcBalance: btc, usdcBalance: usdc, haircutBtc: hb || 0, haircutUsdc: hu || 0 });

test("equity รวม BTC + USDC พร้อม haircut และ PnL", () => {
  const legs = [leg({ kind: "inv_fut", expiryTs: null, qty: 80000, entryPrice: 80000 })];
  const a = acct(0.5, 10000, 0.1, 0);
  const eq = P.marginEquityUsd(a, legs, S0, NOW, 0);
  near(eq, 0.5 * S0 * 0.9 + 10000 + 0, 1e-6);
});

test("regression: liq ของ long inverse perp ตรงกับสูตร Deribit เดิม", () => {
  // long 1 BTC notional ที่ 80,000 · equity 0.1 BTC · MM = 1% + 0.5%×(1/100)
  const notional = 80000, entry = 80000, E = 0.1;
  const legs = [leg({ kind: "inv_fut", expiryTs: null, side: 1, qty: notional, entryPrice: entry })];
  const a = acct(E, 0, 0, 0);
  const r = P.liqCurve(legs, a, S0, NOW, 0, cfg, "SM", 20000, 200000, 400);
  assert.equal(r.crossings.length, 1);
  // สูตรอ้างอิง: equity(P) = E + N/entry − N/P ; MM(P) = (0.01 + 0.005×(N/P)/100) × N/P
  const f = Pp => {
    const sizeBtc = notional / Pp;
    const eq = E + notional / entry - notional / Pp;
    return eq - (0.01 + 0.005 * (sizeBtc / 100)) * sizeBtc;
  };
  const ref = P.bisect(f, 1000, 200000, 200);
  relNear(r.crossings[0], ref, 1e-4, "จุด liquidation");
});

test("regression: short inverse ที่ equity ≥ ขนาด position ไม่มี liquidation", () => {
  // short 1 BTC notional, equity 2 BTC → ราคาขึ้นเท่าไรก็ไม่ liq (PnL ขาดทุนสูงสุดจำกัดที่ N/entry)
  const legs = [leg({ kind: "inv_fut", expiryTs: null, side: -1, qty: 80000, entryPrice: 80000 })];
  const r = P.liqCurve(legs, acct(2, 0, 0, 0), S0, NOW, 0, cfg, "SM", 20000, 2000000, 400);
  assert.equal(r.crossings.length, 0, "ไม่ควรมีจุดตัด");
});

test("USD ค้ำ inverse perp: liq ขยับตามยอด USDC ที่เติม", () => {
  const legs = [leg({ kind: "inv_fut", expiryTs: null, side: 1, qty: 80000, entryPrice: 80000 })];
  const thin = P.liqCurve(legs, acct(0, 8000, 0, 0), S0, NOW, 0, cfg, "SM", 5000, 200000, 500);
  const fat = P.liqCurve(legs, acct(0, 24000, 0, 0), S0, NOW, 0, cfg, "SM", 5000, 200000, 500);
  assert.equal(thin.crossings.length, 1);
  assert.equal(fat.crossings.length, 1);
  assert.ok(fat.crossings[0] < thin.crossings[0], "เติม USDC มากขึ้น liq ต้องต่ำลง");
});

test("liqCurve ใช้ได้ทั้งโหมด SM และ PM", () => {
  const legs = [
    leg({ id: 1, kind: "inv_opt", optType: "put", side: -1, strike: 72000, qty: 2, entryPrice: 0.015, iv: 60 }),
    leg({ id: 2, kind: "inv_fut", expiryTs: null, side: 1, qty: 40000, entryPrice: 80000 }),
  ];
  const a = acct(0.3, 0, 0, 0);
  const sm = P.liqCurve(legs, a, S0, NOW, 0, cfg, "SM", 20000, 200000, 121);
  const pm = P.liqCurve(legs, a, S0, NOW, 0, cfg, "PM", 20000, 200000, 121);
  assert.ok(sm.pts.every(p => isFinite(p.eq) && isFinite(p.mm)));
  assert.ok(pm.pts.every(p => isFinite(p.eq) && isFinite(p.mm)));
  assert.ok(sm.crossings.length && pm.crossings.length);
  // PM ไม่ได้ผ่อนกว่าเสมอ: พอร์ตที่ short option เปล่าๆ โดน stress ±15% + vol ขึ้น
  // อาจกินมาร์จิ้นมากกว่า SM ที่คิดแบบสูตรตายตัว — ตรวจแค่ว่าได้ค่าที่ใช้งานได้
  assert.ok(sm.crossings.every(c => c > 0) && pm.crossings.every(c => c > 0));
});

/* ==================== ผสมหลายสกุล ==================== */
test("พอร์ตผสม 4 ประเภทคำนวณได้ครบไม่มี NaN", () => {
  const legs = [
    leg({ id: 1, kind: "inv_opt", optType: "call", side: -1, strike: 90000, qty: 1, entryPrice: 0.02, iv: 55 }),
    leg({ id: 2, kind: "lin_opt", optType: "put", side: 1, strike: 70000, qty: 1, entryPrice: 1800, iv: 62 }),
    leg({ id: 3, kind: "inv_fut", expiryTs: null, side: 1, qty: 25000, entryPrice: 79000 }),
    leg({ id: 4, kind: "lin_fut", expiryTs: null, side: -1, qty: 0.2, entryPrice: 80500 }),
  ];
  for (const S of [40000, 80000, 160000]) {
    assert.ok(isFinite(P.portfolioPnlUsd(legs, S, NOW, 0, {})), `model ที่ ${S}`);
    assert.ok(isFinite(P.portfolioPnlUsd(legs, S, NOW, 0, { expiry: true })), `expiry ที่ ${S}`);
  }
  const g = P.portfolioGreeks(legs, S0, NOW, 0);
  assert.ok(["delta", "gammaPer1Pct", "vega", "theta"].every(k => isFinite(g[k])));
  const sm = P.smMargin(legs, S0, NOW, 0, cfg);
  assert.ok(isFinite(sm.mmUsd) && isFinite(sm.imUsd) && sm.mmUsd > 0);
  const pm = P.pmMargin(legs, S0, NOW, 0, cfg);
  assert.ok(isFinite(pm.mmUsd) && pm.mmUsd > 0);
});

test("ขาที่ปิดใช้งานไม่ถูกนับ", () => {
  const on = leg({ id: 1, kind: "inv_fut", expiryTs: null, qty: 80000, entryPrice: 80000 });
  const off = leg({ id: 2, kind: "inv_fut", expiryTs: null, qty: 80000, entryPrice: 80000, enabled: false });
  near(P.portfolioPnlUsd([on, off], 90000, NOW, 0, {}), P.portfolioPnlUsd([on], 90000, NOW, 0, {}), 1e-9);
  near(P.smMargin([on, off], S0, NOW, 0, cfg).mmUsd, P.smMargin([on], S0, NOW, 0, cfg).mmUsd, 1e-9);
});

test("findRoots ไม่คืนรากซ้ำและเรียงจากน้อยไปมาก", () => {
  const f = x => (x - 30000) * (x - 90000) * (x - 150000);
  const r = P.findRoots(f, 10000, 200000, 800);
  assert.equal(r.length, 3);
  near(r[0], 30000, 1); near(r[1], 90000, 1); near(r[2], 150000, 1);
});

/* ---------- สรุป ---------- */
const w = Math.max(...results.map(r => r[1].length));
for (const [mark, name, err] of results)
  console.log(`${mark} ${name.padEnd(w)}${err ? "  → " + err : ""}`);
console.log(`\n${pass} ผ่าน, ${fail} ไม่ผ่าน (รวม ${pass + fail})`);
process.exit(fail ? 1 : 0);
