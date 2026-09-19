const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const seasonalSource = fs.readFileSync(path.join(root, "seasonal-pricing.js"), "utf8");
const seasonalCss = fs.readFileSync(path.join(root, "seasonal.css"), "utf8");
const seasonal = require(path.join(root, "seasonal-pricing.js"));

new vm.Script(seasonalSource, { filename: "seasonal-pricing.js" });

const roomTypes = {
  small: { name: "貓家小貓房", baseRate: 850, maxCatsPerRoom: 3 },
  jump: { name: "眺跳家庭房", baseRate: 1100, maxCatsPerRoom: 4 },
  family: { name: "探險家庭房", baseRate: 1300, maxCatsPerRoom: 6 },
};
const bookingOpenAt = Date.parse("2026-09-27T12:00:00+08:00");

function quote({
  roomKey = "small",
  cats = 1,
  checkIn = "2027-02-03",
  checkOut = "2027-02-08",
  isLate = false,
  now = bookingOpenAt,
} = {}) {
  const room = roomTypes[roomKey];
  return seasonal.apply({
    rooms: [{ roomKey, count: 1, ...room }],
    roomCount: 1,
    roomSummary: `${room.name} 1 間`,
    baseRoomFeePerNight: room.baseRate,
    cats,
    checkIn,
    checkOut,
    isLate,
    mealSubtotal: 0,
  }, seasonal.DEFAULT_SEASON, now);
}

assert.equal(quote().holidayNightlyRate, 1450);
assert.equal(quote({ now: bookingOpenAt - 1 }).bookingOpen, false);
assert.equal(quote({ now: bookingOpenAt - 1 }).canSubmitSeasonal, false);
assert.equal(quote({ now: bookingOpenAt }).bookingOpen, true);
assert.equal(quote({ now: bookingOpenAt }).canSubmitSeasonal, true);
assert.equal(quote().depositAmount, 3625);
assert.equal(quote({ roomKey: "jump", cats: 4 }).holidayNightlyRate, 2400);
assert.equal(quote({ roomKey: "family", cats: 6 }).holidayNightlyRate, 3200);
assert.equal(quote({ checkIn: "2027-02-01", checkOut: "2027-02-06" }).meetsMinimumStay, false);
assert.equal(quote({ checkIn: "2027-02-01", checkOut: "2027-02-06" }).canSubmitSeasonal, false);
assert.equal(quote({ checkIn: "2027-02-01", checkOut: "2027-02-08" }).meetsMinimumStay, true);
assert.equal(quote({ checkIn: "2027-02-11", checkOut: "2027-02-12" }).holidayNights, 1);
assert.equal(quote({ checkIn: "2027-02-12", checkOut: "2027-02-13" }).holidayNights, 0);

const lateAfterHoliday = quote({
  cats: 2,
  checkIn: "2027-02-01",
  checkOut: "2027-02-18",
  isLate: true,
});
assert.equal(lateAfterHoliday.extraCatFeePerNight, 200);
assert.equal(lateAfterHoliday.regularNightlyRate, 1050);
assert.equal(lateAfterHoliday.lateCheckoutUnavailable, false);
assert.equal(lateAfterHoliday.isLate, true);
assert.equal(lateAfterHoliday.daycareFee, 525);
assert.equal(lateAfterHoliday.daycareNightlyRate, 1050);
assert.equal(lateAfterHoliday.total, 23355);

const lateOnFebruary12 = quote({
  checkIn: "2027-02-07",
  checkOut: "2027-02-12",
  isLate: true,
});
assert.equal(lateOnFebruary12.checkoutDuringHoliday, false);
assert.equal(lateOnFebruary12.lateCheckoutUnavailable, false);
assert.equal(lateOnFebruary12.isLate, true);
assert.equal(lateOnFebruary12.daycareNightlyRate, 850);

const lateOnFebruary9 = quote({
  checkIn: "2027-02-04",
  checkOut: "2027-02-09",
  isLate: true,
});
assert.equal(lateOnFebruary9.checkoutDuringHoliday, true);
assert.equal(lateOnFebruary9.lateCheckoutUnavailable, false);
assert.equal(lateOnFebruary9.isLate, true);
assert.equal(lateOnFebruary9.daycareNightlyRate, 1450);
assert.equal(lateOnFebruary9.daycareFee, 725);

const lateDuringHoliday = quote({
  checkIn: "2027-02-03",
  checkOut: "2027-02-08",
  isLate: true,
});
assert.equal(lateDuringHoliday.checkoutDuringHoliday, true);
assert.equal(lateDuringHoliday.lateCheckoutUnavailable, true);
assert.equal(lateDuringHoliday.isLate, false);
assert.equal(lateDuringHoliday.daycareFee, 0);

const mixed = quote({ checkIn: "2027-01-27", checkOut: "2027-02-08" });
assert.equal(mixed.regularNights, 7);
assert.equal(mixed.holidayNights, 5);
assert.equal(mixed.discountedStaySubtotal, Math.round(850 * 7 * 0.95) + 1450 * 5);

assert.match(html, /id="jumpRoomToggle"/);
assert.match(html, /id="jumpRoomCount"/);
assert.match(html, /pricingVersion: quote\.pricingVersion/);
assert.match(html, /2026\/12\/31（含）前取消/);
assert.match(html, /2027\/1\/1–1\/23（含）取消/);
assert.match(html, /2027\/1\/24（含）起取消/);
assert.doesNotMatch(html, /敬請於預約七日內匯款訂金500元/);
assert.match(html, />住宿明細</);
assert.doesNotMatch(html, /住宿分段明細/);
assert.match(html, />平日每晚</);
assert.match(html, />春節每晚</);
assert.match(html, /2\/9 起才開放 15:00 後退宿/);
assert.match(html, /2026\/9\/27 中午 12:00 起開放至少 5 個春節計價晚的預約/);
assert.match(html, /未滿 5 個春節計價晚的預約尚未開放，開放時間另行公告/);
assert.match(html, /scheduleSeasonalBookingOpen\(\)/);
assert.match(html, /NT\$ 1,450/);
assert.match(html, /NT\$ 1,800/);
assert.match(html, /NT\$ 2,200/);
assert.match(html, /if \(!Number\.isFinite\(numericAmount\)\) return "金額待確認"/);
assert.match(html, /本試算頁面之金額僅供預估參考，請各位家長們聯繫貓家日子 Line 官方帳號@days\.cat，進一步確認入住細節與實際金額。/);
assert.doesNotMatch(html, /查看春節價目、試算費用並送出預約資料。/);
assert.doesNotMatch(html, /const APP_VERSION = "2027 春節住宿"/);
assert.match(seasonalCss, /grid-template-columns:minmax\(0,1fr\) 116px/);
assert.match(seasonalCss, /\.choice-card \.choice-card-media \{[\s\S]*?width:100%;[\s\S]*?margin:0;/);
assert.match(seasonalCss, /@media\(max-width:340px\)/);
assert.doesNotMatch(html, /<meta\s+name=["']robots["'][^>]*noindex/i);
assert.doesNotMatch(html, /測試版|預覽版本|測試環境/);

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, "HTML IDs must be unique");
const idSet = new Set(ids);
for (const match of html.matchAll(/document\.getElementById\("([^"]+)"\)/g)) {
  assert.ok(idSet.has(match[1]), `Missing DOM element #${match[1]}`);
}

for (const match of html.matchAll(/(?:src|href)="(assets\/[^"?#]+|seasonal(?:-pricing)?\.css|seasonal-pricing\.js)"/g)) {
  assert.ok(fs.existsSync(path.join(root, match[1])), `Missing local asset ${match[1]}`);
}

console.log("seasonal integration tests passed");
