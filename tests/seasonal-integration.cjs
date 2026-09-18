const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const seasonalSource = fs.readFileSync(path.join(root, "seasonal-pricing.js"), "utf8");
const seasonal = require(path.join(root, "seasonal-pricing.js"));

new vm.Script(seasonalSource, { filename: "seasonal-pricing.js" });

const roomTypes = {
  small: { name: "貓家小貓房", baseRate: 850, maxCatsPerRoom: 3 },
  jump: { name: "眺跳家庭房", baseRate: 1100, maxCatsPerRoom: 4 },
  family: { name: "探險家庭房", baseRate: 1300, maxCatsPerRoom: 6 },
};

function quote({ roomKey = "small", cats = 1, checkIn = "2027-02-03", checkOut = "2027-02-08", isLate = false } = {}) {
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
  });
}

assert.equal(quote().holidayNightlyRate, 1300);
assert.equal(quote().depositAmount, 3250);
assert.equal(quote({ roomKey: "jump", cats: 4 }).holidayNightlyRate, 2250);
assert.equal(quote({ roomKey: "family", cats: 6 }).holidayNightlyRate, 2950);
assert.equal(quote({ checkIn: "2027-02-01", checkOut: "2027-02-06" }).meetsMinimumStay, false);
assert.equal(quote({ checkIn: "2027-02-01", checkOut: "2027-02-08" }).meetsMinimumStay, true);
assert.equal(quote({ checkIn: "2027-02-11", checkOut: "2027-02-12" }).holidayNights, 1);
assert.equal(quote({ checkIn: "2027-02-12", checkOut: "2027-02-13" }).holidayNights, 0);

const mixed = quote({ checkIn: "2027-01-27", checkOut: "2027-02-08" });
assert.equal(mixed.regularNights, 7);
assert.equal(mixed.holidayNights, 5);
assert.equal(mixed.discountedStaySubtotal, Math.round(850 * 7 * 0.95) + 1300 * 5);

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
