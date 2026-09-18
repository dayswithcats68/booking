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
assert.match(code, /const RELEASE_ID = "cny-2027-production-r4";/);
assert.doesNotMatch(code, /integration-preview/);
const mailCalls = [];
const calendarEvents = new Map();
const calendarInsertCalls = [];
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
        if (name === "BOOKING_NOTIFICATION_EMAILS") return "ops@example.com";
        if (name === "BOOKING_CALENDAR_ID") return "booking-calendar@example.com";
        return "";
      },
    }),
  },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({ getUrl: () => "https://docs.google.com/spreadsheets/d/test/edit" }),
  },
  Utilities: {
    formatDate: (value) => new Date(value).toISOString().replace("T", " ").slice(0, 19),
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
assert.equal(springSmall.regularNights, 0);
assert.equal(springSmall.holidayNightlyRate, 1300);
assert.equal(springSmall.discountedStaySubtotal, 6500);
assert.equal(springSmall.depositAmount, 3250);
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
assert.equal(springJump.holidayNightlyRate, 2250);
assert.equal(springJump.total, 11250);

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
assert.equal(springFamily.holidayNightlyRate, 2950);
assert.equal(springFamily.total, 14750);

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
assert.equal(mixedSpring.discountedStaySubtotal, Math.round(850 * 7 * 0.95) + 1300 * 5);

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
assert.equal(lateAfterHoliday.total, 22005);

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
assert.equal(lateOnFebruary12.daycareFee, 425);

for (const source of [
  `calculateQuote_({ rooms: [{ roomKey: "small", roomCount: 1 }], roomCount: 1, cats: 1, checkIn: "2027-02-01", checkOut: "2027-02-06", isLate: false, mealPlanKey: "none", pricingVersion: PRICING_VERSION })`,
  `calculateQuote_({ rooms: [{ roomKey: "small", roomCount: 1 }], roomCount: 1, cats: 1, checkIn: "2027-02-03", checkOut: "2027-02-08", isLate: false, mealPlanKey: "none" })`,
  `calculateQuote_({ rooms: [{ roomKey: "small", roomCount: 1 }], roomCount: 1, cats: 1, checkIn: "2027-02-03", checkOut: "2027-02-08", isLate: true, mealPlanKey: "none", pricingVersion: PRICING_VERSION })`,
]) {
  assert.throws(() => vm.runInContext(source, context));
}

const booking = {
  reservationId: "DWC-20260901-TEST",
  owner: { name: "王小明", phone: "0912-345-678" },
  arrivalTime: "15:00",
  departureTime: "15:00",
  quote,
  cats: [{
    name: "咪咪",
    sex: "女",
    age: 3,
    neutered: "已結紮",
    litter: "礦砂",
    diet: "正常",
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
  "https://www.googleapis.com/auth/script.external_request",
]) {
  assert.ok(!manifest.oauthScopes.includes(scope), `Manifest must not include unused scope: ${scope}`);
}

const advancedServices = manifest.dependencies?.enabledAdvancedServices || [];
assert.ok(
  !advancedServices.some((service) => service.userSymbol === "Drive"),
  "Manifest must not enable the unused Drive service",
);

assert.doesNotMatch(code, /DocumentApp|UrlFetchApp|MimeType\.PDF|createContractPdf_/);
assert.match(html, /正式契約由店家確認後另行製作/);
assert.match(html, /2026 年 12 月 31 日（含）前/);
assert.match(html, /2027 年 1 月 1 日至 1 月 23 日（含）/);
assert.match(html, /2027 年 1 月 24 日（含）起/);

console.log("contract smoke tests passed");
