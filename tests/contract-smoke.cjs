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

class FakeText {
  setBold() { return this; }
  setFontSize() { return this; }
  setFontFamily() { return this; }
}

class FakeParagraph {
  constructor(text) { this.text = text; }
  setAlignment() { return this; }
  setSpacingAfter() { return this; }
  setSpacingBefore() { return this; }
  setLineSpacing() { return this; }
  editAsText() { return new FakeText(); }
}

class FakeCell {
  setBackgroundColor() { return this; }
}

class FakeRow {
  constructor(columnCount) {
    this.cells = Array.from({ length: columnCount }, () => new FakeCell());
  }
  getCell(index) { return this.cells[index]; }
}

class FakeTable {
  constructor(rows) {
    this.rows = rows.map((row) => new FakeRow(row.length));
  }
  setBorderWidth() { return this; }
  getRow(index) { return this.rows[index]; }
}

class FakeBody {
  clear() { return this; }
  setMarginTop() { return this; }
  setMarginBottom() { return this; }
  setMarginLeft() { return this; }
  setMarginRight() { return this; }
  appendParagraph(text) { return new FakeParagraph(text); }
  appendTable(rows) { return new FakeTable(rows); }
  editAsText() { return new FakeText(); }
}

const fetchCalls = [];
const fakeBlob = {
  name: "",
  setName(name) {
    this.name = name;
    return this;
  },
};
const context = vm.createContext({
  console,
  DocumentApp: {
    HorizontalAlignment: { CENTER: "CENTER" },
    create() {
      return {
        getId: () => "temporary-document-id",
        getBody: () => new FakeBody(),
        saveAndClose() {},
      };
    },
  },
  MimeType: { PDF: "application/pdf" },
  ScriptApp: { getOAuthToken: () => "test-token" },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({ getUrl: () => "https://docs.google.com/spreadsheets/d/test/edit" }),
  },
  Utilities: {
    formatDate: (value) => new Date(value).toISOString().replace("T", " ").slice(0, 19),
  },
  UrlFetchApp: {
    fetch(url, options) {
      fetchCalls.push({ url, options });
      return {
        getResponseCode: () => 200,
        getBlob: () => fakeBlob,
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
assert.match(emailBody, /已附上依預約資料產生的貓咪住宿服務契約 PDF/);

const pdfBlob = vm.runInContext("createContractPdf_(testBooking)", context);
assert.equal(pdfBlob.name, "貓家日子_寄養服務契約_DWC-20260901-TEST.pdf");
assert.equal(fetchCalls.length, 2);
assert.match(fetchCalls[0].url, /\/export\?mimeType=application%2Fpdf$/);
assert.equal(fetchCalls[1].options.method, "delete");

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
  assert.ok(code.includes(text), `Backend contract is missing: ${text}`);
  assert.ok(html.includes(text), `Frontend contract is missing: ${text}`);
}

for (const scope of [
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/script.external_request",
]) {
  assert.ok(manifest.oauthScopes.includes(scope), `Manifest is missing scope: ${scope}`);
}

console.log("contract smoke tests passed");
