const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const code = fs.readFileSync(path.join(projectRoot, "google-apps-script", "Code.gs"), "utf8");
const html = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");
const manifest = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "google-apps-script", "appsscript.json"), "utf8"),
);

assert.ok(!/spreadsheetId\s*:\s*["']/.test(code), "Spreadsheet ID must not be committed in backend code");
assert.ok(!/\b\d{14}\b/.test(html), "Bank account number must not be committed in frontend code");
assert.match(code, /const RELEASE_ID = "cny-2027-production-r8";/);
assert.match(code, /const PRICING_VERSION = "cny-2027-v2";/);
assert.doesNotMatch(code, /integration-preview/);
assert.match(html, /name="bookingLitter"/);
assert.ok(
  html.indexOf('id="catForms"') < html.indexOf('id="bookingLitter"'),
  "Reservation litter field must follow the per-cat details",
);
assert.doesNotMatch(html, /整筆預約只需填寫一次/);
assert.doesNotMatch(html, /name="cat\$\{index\}Litter"/);
assert.doesNotMatch(html, /name="cat\$\{index\}Diet"/);
assert.match(html, /placeholder="例如：3歲、5個月"/);
assert.match(html, /除夕（2027\/2\/5）最晚 17:00/);
const mailCalls = [];
const calendarEvents = new Map();
const calendarInsertCalls = [];
const urlFetchCalls = [];
const scriptProperties = {
  BOOKING_NOTIFICATION_EMAILS: "ops@example.com",
  BOOKING_CALENDAR_ID: "booking-calendar@example.com",
  TURNSTILE_SECRET_KEY: "",
  TURNSTILE_ALLOWED_HOSTNAMES: "",
};
let turnstileResponse = {
  responseCode: 200,
  body: {
    success: true,
    hostname: "dayswithcats68.github.io",
    action: "booking_submit",
  },
};
const scriptConsole = { log() {}, warn() {}, error() {} };
const context = vm.createContext({
  Calendar: {
    Events: {
      get(calendarId, eventId) {
        if (!calendarEvents.has(eventId)) throw new Error("404 Not Found");
        return calendarEvents.get(eventId);
      },
      insert(resource, calendarId, options) {
        const event = {
          ...resource,
          id: `generated-${calendarInsertCalls.length + 1}`,
          status: "confirmed",
        };
        calendarInsertCalls.push({ resource, calendarId, options });
        calendarEvents.set(event.id, event);
        return event;
      },
      list(calendarId, options) {
        const reservationId = String(options.privateExtendedProperty || "")
          .replace(/^reservationId=/, "");
        return {
          items: [...calendarEvents.values()].filter(
            (event) => event.extendedProperties?.private?.reservationId === reservationId,
          ),
        };
      },
    },
  },
  console: scriptConsole,
  MailApp: {
    sendEmail(message) {
      mailCalls.push(message);
    },
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty(name) {
        return scriptProperties[name] || "";
      },
    }),
  },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({ getUrl: () => "https://docs.google.com/spreadsheets/d/test/edit" }),
  },
  Utilities: {
    formatDate: (value) => new Date(value).toISOString().replace("T", " ").slice(0, 19),
    newBlob: (value) => ({ getBytes: () => [...Buffer.from(String(value), "utf8")] }),
  },
  UrlFetchApp: {
    fetch(url, options) {
      urlFetchCalls.push({ url, options });
      return {
        getResponseCode: () => turnstileResponse.responseCode,
        getContentText: () => JSON.stringify(turnstileResponse.body),
      };
    },
  },
});

new vm.Script(code, { filename: "Code.gs" }).runInContext(context);

const quote = vm.runInContext(`calculateQuote_({
  rooms: [{ roomKey: "small", roomCount: 1 }],
  roomCount: 1,
  cats: 2,
  checkIn: "2026-09-01",
  checkOut: "2026-09-04",
  isLate: false,
  mealPlanKey: "none"
})`, context);

vm.runInContext('Date.now = () => Date.parse("2026-09-27T03:59:59Z")', context);
assert.throws(
  () => vm.runInContext(`calculateQuote_({
    rooms: [{ roomKey: "small", roomCount: 1 }],
    roomCount: 1,
    cats: 1,
    checkIn: "2027-02-03",
    checkOut: "2027-02-08",
    isLate: false,
    mealPlanKey: "none",
    pricingVersion: PRICING_VERSION
  })`, context),
  /2026\/9\/27 12:00 起開放預約/,
);
vm.runInContext('Date.now = () => Date.parse("2026-09-27T04:00:00Z")', context);

const springSmall = vm.runInContext(`calculateQuote_({
  rooms: [{ roomKey: "small", roomCount: 1 }],
  roomCount: 1,
  cats: 1,
  checkIn: "2027-02-03",
  checkOut: "2027-02-08",
  isLate: false,
  mealPlanKey: "none",
  pricingVersion: PRICING_VERSION
})`, context);
assert.equal(springSmall.holidayNights, 5);
assert.equal(springSmall.bookingOpen, true);
assert.equal(springSmall.regularNights, 0);
assert.equal(springSmall.holidayNightlyRate, 1450);
assert.equal(springSmall.discountedStaySubtotal, 7250);
assert.equal(springSmall.depositAmount, 3625);
assert.equal(springSmall.depositDueDays, 3);

const springJump = vm.runInContext(`calculateQuote_({
  rooms: [{ roomKey: "jump", roomCount: 1 }],
  roomCount: 1,
  cats: 4,
  checkIn: "2027-02-03",
  checkOut: "2027-02-08",
  isLate: false,
  mealPlanKey: "none",
  pricingVersion: PRICING_VERSION
})`, context);
assert.equal(springJump.holidayNightlyRate, 2400);
assert.equal(springJump.total, 12000);

const springFamily = vm.runInContext(`calculateQuote_({
  rooms: [{ roomKey: "family", roomCount: 1 }],
  roomCount: 1,
  cats: 6,
  checkIn: "2027-02-07",
  checkOut: "2027-02-12",
  isLate: false,
  mealPlanKey: "none",
  pricingVersion: PRICING_VERSION
})`, context);
assert.equal(springFamily.holidayNights, 5);
assert.equal(springFamily.holidayNightlyRate, 3200);
assert.equal(springFamily.total, 16000);

const mixedSpring = vm.runInContext(`calculateQuote_({
  rooms: [{ roomKey: "small", roomCount: 1 }],
  roomCount: 1,
  cats: 1,
  checkIn: "2027-01-27",
  checkOut: "2027-02-08",
  isLate: false,
  mealPlanKey: "none",
  pricingVersion: PRICING_VERSION
})`, context);
assert.equal(mixedSpring.regularNights, 7);
assert.equal(mixedSpring.holidayNights, 5);
assert.equal(mixedSpring.discountName, "95 折");
assert.equal(mixedSpring.discountedStaySubtotal, Math.round(850 * 7 * 0.95) + 1450 * 5);

const lateAfterHoliday = vm.runInContext(`calculateQuote_({
  rooms: [{ roomKey: "small", roomCount: 1 }],
  roomCount: 1,
  cats: 2,
  checkIn: "2027-02-01",
  checkOut: "2027-02-18",
  isLate: true,
  mealPlanKey: "none",
  pricingVersion: PRICING_VERSION
})`, context);
assert.equal(lateAfterHoliday.extraCatFeePerNight, 200);
assert.equal(lateAfterHoliday.regularNightlyRate, 1050);
assert.equal(lateAfterHoliday.lateCheckoutUnavailable, false);
assert.equal(lateAfterHoliday.isLate, true);
assert.equal(lateAfterHoliday.daycareFee, 525);
assert.equal(lateAfterHoliday.daycareNightlyRate, 1050);
assert.equal(lateAfterHoliday.total, 23355);

const lateOnFebruary12 = vm.runInContext(`calculateQuote_({
  rooms: [{ roomKey: "small", roomCount: 1 }],
  roomCount: 1,
  cats: 1,
  checkIn: "2027-02-07",
  checkOut: "2027-02-12",
  isLate: true,
  mealPlanKey: "none",
  pricingVersion: PRICING_VERSION
})`, context);
assert.equal(lateOnFebruary12.checkoutDuringHoliday, false);
assert.equal(lateOnFebruary12.lateCheckoutUnavailable, false);
assert.equal(lateOnFebruary12.isLate, true);
assert.equal(lateOnFebruary12.daycareNightlyRate, 850);
assert.equal(lateOnFebruary12.daycareFee, 425);

const lateOnFebruary9 = vm.runInContext(`calculateQuote_({
  rooms: [{ roomKey: "small", roomCount: 1 }],
  roomCount: 1,
  cats: 1,
  checkIn: "2027-02-04",
  checkOut: "2027-02-09",
  isLate: true,
  mealPlanKey: "none",
  pricingVersion: PRICING_VERSION
})`, context);
assert.equal(lateOnFebruary9.checkoutDuringHoliday, true);
assert.equal(lateOnFebruary9.lateCheckoutUnavailable, false);
assert.equal(lateOnFebruary9.daycareNightlyRate, 1450);
assert.equal(lateOnFebruary9.daycareFee, 725);

assert.throws(
  () => vm.runInContext(`calculateQuote_({
    rooms: [{ roomKey: "small", roomCount: 1 }],
    roomCount: 1,
    cats: 1,
    checkIn: "2027-02-03",
    checkOut: "2027-02-08",
    isLate: true,
    mealPlanKey: "none",
    pricingVersion: PRICING_VERSION
  })`, context),
  /2\/9 起才提供/,
);

for (const source of [
  `calculateQuote_({ rooms: [{ roomKey: "small", roomCount: 1 }], roomCount: 1, cats: 1, checkIn: "2027-02-01", checkOut: "2027-02-06", isLate: false, mealPlanKey: "none", pricingVersion: PRICING_VERSION })`,
  `calculateQuote_({ rooms: [{ roomKey: "small", roomCount: 1 }], roomCount: 1, cats: 1, checkIn: "2027-02-03", checkOut: "2027-02-08", isLate: false, mealPlanKey: "none" })`,
  `calculateQuote_({ rooms: [{ roomKey: "small", roomCount: 1 }], roomCount: 1, cats: 1, checkIn: "2027-02-03", checkOut: "2027-02-08", isLate: true, mealPlanKey: "none", pricingVersion: PRICING_VERSION })`,
]) {
  assert.throws(() => vm.runInContext(source, context));
}

assert.equal(
  vm.runInContext('requiredDateText_("2027-02-28", "入住日期")', context),
  "2027-02-28",
);
assert.throws(
  () => vm.runInContext('requiredDateText_("2027-02-31", "入住日期")', context),
  /入住日期格式不正確/,
);
assert.equal(
  vm.runInContext('requiredPhone_("0912-345-678", "聯絡電話")', context),
  "0912-345-678",
);
assert.throws(
  () => vm.runInContext('requiredPhone_("not-a-phone", "聯絡電話")', context),
  /聯絡電話格式不正確/,
);
assert.equal(
  vm.runInContext(
    'requiredReservationId_("DWC-20260918-161809-0123456789ABCDEF0123456789ABCDEF")',
    context,
  ),
  "DWC-20260918-161809-0123456789ABCDEF0123456789ABCDEF",
);
assert.throws(
  () => vm.runInContext('requiredReservationId_("DWC-20260918-161809-AB12")', context),
  /頁面版本已更新/,
);
assert.equal(vm.runInContext('safeText_(" =2+2")', context), "' =2+2");

context.testCat = {
  name: "咪咪",
  sex: "母",
  age: "3歲、5個月",
  neutered: "已結紮",
  health: "無",
  special: "無",
};
assert.equal(vm.runInContext("normalizeCat_(testCat, 1).sex", context), "母");
assert.equal(vm.runInContext("normalizeCat_(testCat, 1).age", context), "3歲、5個月");
context.testCat.sex = "女";
assert.throws(
  () => vm.runInContext("normalizeCat_(testCat, 1)", context),
  /性別不正確/,
);
assert.equal(
  vm.runInContext('requiredOption_("礦砂", "貓砂種類", CAT_LITTER_OPTIONS)', context),
  "礦砂",
);
assert.throws(
  () => vm.runInContext('requiredOption_("其他", "貓砂種類", CAT_LITTER_OPTIONS)', context),
  /貓砂種類不正確/,
);

vm.runInContext(
  'validateBookingTimes_("17:00", "15:00", false, "2027-02-05")',
  context,
);
assert.throws(
  () => vm.runInContext(
    'validateBookingTimes_("17:01", "15:00", false, "2027-02-05")',
    context,
  ),
  /除夕入住時間不可晚於 17:00/,
);
vm.runInContext(
  'validateBookingTimes_("17:01", "15:00", false, "2027-02-04")',
  context,
);
vm.runInContext(
  'validateBookingTimes_("17:01", "15:00", false, "2027-02-06")',
  context,
);

context.testEvent = {
  postData: {
    contents: JSON.stringify({ action: "createBooking", website: "" }),
  },
};
assert.equal(vm.runInContext("parsePayload_(testEvent).action", context), "createBooking");
context.testEvent.postData.contents = JSON.stringify({ action: "updateEmailStatus" });
assert.throws(
  () => vm.runInContext("parsePayload_(testEvent)", context),
  /預約動作不正確/,
);
context.testEvent.postData.contents = JSON.stringify({
  action: "createBooking",
  notes: "x".repeat(64 * 1024),
});
assert.throws(
  () => vm.runInContext("parsePayload_(testEvent)", context),
  /預約資料內容過長/,
);

vm.runInContext('verifyTurnstile_("")', context);
assert.equal(urlFetchCalls.length, 0);
scriptProperties.TURNSTILE_SECRET_KEY = "test-secret";
scriptProperties.TURNSTILE_ALLOWED_HOSTNAMES = "dayswithcats68.github.io, booking.example.com";
assert.throws(
  () => vm.runInContext('verifyTurnstile_("")', context),
  /請先完成人機驗證/,
);
vm.runInContext('verifyTurnstile_("valid-test-token")', context);
assert.equal(urlFetchCalls.length, 1);
assert.equal(urlFetchCalls[0].url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
turnstileResponse = {
  responseCode: 200,
  body: { success: true, hostname: "attacker.example", action: "booking_submit" },
};
assert.throws(
  () => vm.runInContext('verifyTurnstile_("wrong-host-token")', context),
  /人機驗證失敗/,
);
scriptProperties.TURNSTILE_SECRET_KEY = "";
scriptProperties.TURNSTILE_ALLOWED_HOSTNAMES = "";

const booking = {
  reservationId: "DWC-20260901-100000-0123456789ABCDEF0123456789ABCDEF",
  owner: { name: "王小明", phone: "0912-345-678" },
  arrivalTime: "15:00",
  departureTime: "15:00",
  litter: "礦砂",
  quote,
  cats: [{
    name: "咪咪",
    sex: "母",
    age: "3歲、5個月",
    neutered: "已結紮",
    health: "無",
    special: "無",
  }],
  additionalNotes: "",
  submittedAt: new Date("2026-08-18T10:00:00Z"),
};
context.testBooking = booking;

const emailBody = vm.runInContext("createDetailedEmailBody_(testBooking)", context);
assert.match(emailBody, /契約請依預約資料另行製作/);
assert.doesNotMatch(emailBody, /PDF|附件/);
assert.match(emailBody, /貓砂種類：礦砂/);
assert.match(emailBody, /年齡：3歲、5個月/);
assert.doesNotMatch(emailBody, /飲食習慣與餵食方式/);

const notification = vm.runInContext(
  "sendEmailNotificationSafely_(testBooking)",
  context,
);
assert.equal(notification.status, "已寄送");
assert.equal(notification.note, "");
assert.equal(mailCalls.length, 1);
assert.equal(mailCalls[0].attachments, undefined);
assert.match(mailCalls[0].body, /契約請依預約資料另行製作/);

let calendarStatus = "";
let calendarNote = "";
let storedCalendarEventId = "missing-event";
context.testBookingSheet = {
  getRange(row, column) {
    if (column === 36) {
      return {
        setValue(value) { calendarStatus = value; return this; },
        setNote(value) { calendarNote = value; return this; },
      };
    }
    if (column === 37) {
      return {
        getDisplayValue() { return storedCalendarEventId; },
        setValue(value) { storedCalendarEventId = value; return this; },
        clearContent() { storedCalendarEventId = ""; return this; },
      };
    }
    throw new Error(`Unexpected calendar column ${column}`);
  },
};
const calendarResult = vm.runInContext(
  "ensureCalendarEventSafely_(testBookingSheet, 7, testBooking)",
  context,
);
assert.equal(calendarResult.status, "已建立");
assert.equal(calendarStatus, "已建立");
assert.equal(calendarNote, "");
assert.equal(storedCalendarEventId, "generated-1");
assert.equal(calendarInsertCalls.length, 1);
assert.equal(calendarInsertCalls[0].resource.id, undefined);
assert.equal(calendarInsertCalls[0].calendarId, "booking-calendar@example.com");

const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1])
  .filter((script) => script.trim());
assert.ok(inlineScripts.length > 0, "Expected at least one inline script");
inlineScripts.forEach((script, index) => {
  new vm.Script(script, { filename: `index-inline-${index + 1}.js` });
});

for (const id of [
  "contractPreview",
  "contractReservationId",
  "contractOwnerName",
  "contractStayPeriod",
  "contractRoomSummary",
  "contractCatCount",
  "contractStayFee",
]) {
  assert.equal((html.match(new RegExp(`id=["']${id}["']`, "g")) || []).length, 1, `${id} must be unique`);
}

for (const text of [
  "吉立動物醫院",
  "提前退宿，已支付之住宿費不予退還",
  "Facebook、Instagram",
  "一式二份",
]) {
  assert.ok(html.includes(text), `Frontend contract is missing: ${text}`);
}

for (const scope of [
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive.file",
]) {
  assert.ok(!manifest.oauthScopes.includes(scope), `Manifest must not include unused scope: ${scope}`);
}
assert.ok(
  manifest.oauthScopes.includes("https://www.googleapis.com/auth/script.external_request"),
  "Manifest must allow server-side Turnstile verification",
);

const advancedServices = manifest.dependencies?.enabledAdvancedServices || [];
assert.ok(
  !advancedServices.some((service) => service.userSymbol === "Drive"),
  "Manifest must not enable the unused Drive service",
);

assert.doesNotMatch(code, /DocumentApp|MimeType\.PDF|createContractPdf_/);
assert.doesNotMatch(code, /function updateEmailStatus_|payload\.action === "updateEmailStatus"/);
assert.doesNotMatch(html, /emailStatus:\s*"準備寄送"/);
assert.match(html, /window\.crypto\.randomUUID/);
assert.match(html, /new Uint8Array\(16\)/);
assert.doesNotMatch(html, /Math\.random/);
assert.match(html, /正式契約由店家確認後另行製作/);
assert.match(html, /2026 年 12 月 31 日（含）前/);
assert.match(html, /2027 年 1 月 1 日至 1 月 23 日（含）/);
assert.match(html, /2027 年 1 月 24 日（含）起/);

console.log("contract smoke tests passed");
