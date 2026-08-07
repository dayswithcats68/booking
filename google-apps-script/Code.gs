const CONFIG = Object.freeze({
  spreadsheetId: "1EM9yFt-zHo84abbOVvr10vb2GNm5XR1X2xBLMejlMoE",
  bookingSheet: "住宿預約",
  catSheet: "貓咪資料",
  timezone: "Asia/Taipei",
  source: "網站預約表單",
});

const EMAIL_CONFIG = Object.freeze({
  recipientsProperty: "BOOKING_NOTIFICATION_EMAILS",
  senderName: "貓家日子預約系統",
  spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${CONFIG.spreadsheetId}/edit`,
});

const ROOM_TYPES = Object.freeze({
  small: { name: "貓家小貓房", baseRate: 850, maxCats: 4 },
  family: { name: "探險家庭房", baseRate: 1300, maxCats: 6 },
});

const MEAL_PLANS = Object.freeze({
  none: { name: "不加購", dailyRatePerCat: 0 },
  dry: { name: "乾飼料", dailyRatePerCat: 50 },
  canned: { name: "罐頭", canRate: 30 },
  combo: { name: "套組方案（早晚各一罐＋乾飼料）", dailyRatePerCat: 100 },
});

const EXTRA_CAT_RATE = 200;
const DAYCARE_RATE = 0.5;
const MAX_CANS_PER_CAT_PER_DAY = 20;
const ALLOWED_EMAIL_STATUSES = Object.freeze(["準備寄送", "已寄送", "寄送失敗"]);
const MEAL_HEADERS = Object.freeze([
  "伙食方案",
  "每貓每日罐數",
  "每貓每日伙食費",
  "伙食計費日數",
  "伙食小計",
]);

function doGet() {
  const properties = PropertiesService.getScriptProperties();
  return jsonResponse_({
    ok: true,
    service: "days-with-cats-booking",
    emailNotificationConfigured: Boolean(
      properties.getProperty(EMAIL_CONFIG.recipientsProperty)
    ),
    timestamp: new Date().toISOString(),
  });
}

function doPost(event) {
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(15000);
    const payload = parsePayload_(event);
    const result = payload.action === "updateEmailStatus"
      ? updateEmailStatus_(payload)
      : saveBooking_(payload);
    return jsonResponse_({ ok: true, ...result });
  } catch (error) {
    console.error(error);
    return jsonResponse_({
      ok: false,
      error: error && error.message ? error.message : "無法處理預約資料",
    });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function parsePayload_(event) {
  if (!event || !event.postData || !event.postData.contents) {
    throw new Error("缺少預約資料");
  }

  let payload;
  try {
    payload = JSON.parse(event.postData.contents);
  } catch (error) {
    throw new Error("預約資料格式錯誤");
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("預約資料格式錯誤");
  }

  if (payload.website) throw new Error("無法接受此筆資料");
  return payload;
}

function saveBooking_(payload) {
  const reservationId = requiredText_(payload.reservationId, "預約編號", 80);
  const owner = payload.owner || {};
  const booking = payload.booking || {};
  const cats = Array.isArray(payload.cats) ? payload.cats : [];

  const ownerName = requiredText_(owner.name, "飼主姓名", 50);
  const ownerPhone = requiredText_(owner.phone, "聯絡電話", 30);
  const emergencyName = requiredText_(owner.emergencyName, "緊急聯絡人", 50);
  const emergencyPhone = requiredText_(owner.emergencyPhone, "緊急聯絡電話", 30);
  const emergencyRelation = optionalText_(owner.emergencyRelation, 30);
  const arrivalTime = requiredTime_(booking.arrivalTime, "入住時間");
  const departureTime = requiredTime_(booking.departureTime, "退宿時間");
  const quote = calculateQuote_(booking);

  if (cats.length !== quote.cats) {
    throw new Error("貓咪資料數量與預約數量不一致");
  }

  const normalizedCats = cats.map((cat, index) => normalizeCat_(cat, index + 1));
  const spreadsheet = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const bookingSheet = spreadsheet.getSheetByName(CONFIG.bookingSheet);
  const catSheet = spreadsheet.getSheetByName(CONFIG.catSheet);
  if (!bookingSheet || !catSheet) throw new Error("找不到預約資料工作表");

  const existingRow = findReservationRow_(bookingSheet, reservationId);
  if (existingRow) {
    return { reservationId, duplicate: true };
  }

  const submittedAt = new Date();
  const emailStatus = ALLOWED_EMAIL_STATUSES.includes(payload.emailStatus)
    ? payload.emailStatus
    : "準備寄送";
  const additionalNotes = optionalText_(payload.additionalNotes, 300);
  bookingSheet.getRange(1, 27, 1, MEAL_HEADERS.length).setValues([MEAL_HEADERS]);
  const bookingRow = [
    safeText_(reservationId),
    submittedAt,
    "新預約",
    safeText_(ownerName),
    safeText_(ownerPhone),
    safeText_(emergencyName),
    safeText_(emergencyPhone),
    safeText_(emergencyRelation),
    quote.room.name,
    parseDate_(quote.checkIn, "入住日期"),
    safeText_(arrivalTime),
    parseDate_(quote.checkOut, "退宿日期"),
    safeText_(departureTime),
    quote.nights,
    quote.cats,
    quote.nightlyRate,
    quote.staySubtotal,
    quote.discountName,
    quote.discountAmount,
    quote.discountedStaySubtotal,
    quote.daycareFee,
    quote.total,
    quote.isLate ? "是" : "否",
    safeText_(additionalNotes),
    emailStatus,
    CONFIG.source,
    safeText_(quote.mealPlan.name),
    quote.cansPerCatPerDay,
    quote.mealDailyRatePerCat,
    quote.nights,
    quote.mealSubtotal,
  ];

  const bookingRowNumber = bookingSheet.getLastRow() + 1;
  bookingSheet.getRange(bookingRowNumber, 5).setNumberFormat("@");
  bookingSheet.getRange(bookingRowNumber, 7).setNumberFormat("@");
  bookingSheet.getRange(bookingRowNumber, 1, 1, bookingRow.length).setValues([bookingRow]);
  bookingSheet.getRange(bookingRowNumber, 2).setNumberFormat("yyyy/mm/dd hh:mm:ss");
  bookingSheet.getRange(bookingRowNumber, 10).setNumberFormat("yyyy/mm/dd");
  bookingSheet.getRange(bookingRowNumber, 12).setNumberFormat("yyyy/mm/dd");
  bookingSheet.getRange(bookingRowNumber, 16, 1, 7).setNumberFormat("#,##0");
  bookingSheet.getRange(bookingRowNumber, 28, 1, 4).setNumberFormat("#,##0");
  bookingSheet.getRange(bookingRowNumber, 1, 1, bookingRow.length).setWrap(true);

  const catRows = normalizedCats.map((cat, index) => [
    safeText_(reservationId),
    submittedAt,
    safeText_(ownerName),
    parseDate_(quote.checkIn, "入住日期"),
    parseDate_(quote.checkOut, "退宿日期"),
    index + 1,
    safeText_(cat.name),
    safeText_(cat.sex),
    cat.age,
    safeText_(cat.neutered),
    safeText_(cat.litter),
    safeText_(cat.diet),
    safeText_(cat.health),
    safeText_(cat.special),
  ]);

  const firstCatRow = catSheet.getLastRow() + 1;
  catSheet.getRange(firstCatRow, 1, catRows.length, catRows[0].length).setValues(catRows);
  catSheet.getRange(firstCatRow, 2, catRows.length, 1).setNumberFormat("yyyy/mm/dd hh:mm:ss");
  catSheet.getRange(firstCatRow, 4, catRows.length, 2).setNumberFormat("yyyy/mm/dd");
  catSheet.getRange(firstCatRow, 1, catRows.length, catRows[0].length).setWrap(true);

  const notificationStatus = sendEmailNotificationSafely_({
    reservationId,
    submittedAt,
    owner: {
      name: ownerName,
      phone: ownerPhone,
      emergencyName,
      emergencyPhone,
      emergencyRelation,
    },
    arrivalTime,
    departureTime,
    quote,
    cats: normalizedCats,
    additionalNotes,
  });
  bookingSheet.getRange(bookingRowNumber, 25).setValue(notificationStatus);

  return { reservationId, duplicate: false, notificationStatus };
}

function sendEmailNotificationSafely_(booking) {
  try {
    const recipients = getNotificationEmails_();
    if (!recipients.length) {
      console.warn("Email notification is not configured");
      return "寄送失敗";
    }

    const subject = [
      `【新預約】${booking.owner.name}`,
      `${booking.quote.checkIn}–${booking.quote.checkOut}`,
      `${booking.quote.cats} 隻貓`,
    ].join("｜");
    const body = createDetailedEmailBody_(booking);

    MailApp.sendEmail({
      to: recipients.join(","),
      subject,
      body,
      name: EMAIL_CONFIG.senderName,
    });
    return "已寄送";
  } catch (error) {
    console.error(error);
    return "寄送失敗";
  }
}

function createDetailedEmailBody_(booking) {
  const quote = booking.quote;
  const owner = booking.owner;
  const discountLine = quote.discountAmount
    ? `${quote.discountName}（−NT$${formatInteger_(quote.discountAmount)}）`
    : "無折扣";
  const mealLine = quote.mealPlanKey === "none"
    ? "不加購"
    : quote.mealPlanKey === "canned"
      ? `${quote.mealPlan.name}｜每隻每日 ${quote.cansPerCatPerDay} 罐｜每隻每日 NT$${formatInteger_(quote.mealDailyRatePerCat)}`
      : `${quote.mealPlan.name}｜每隻每日 NT$${formatInteger_(quote.mealDailyRatePerCat)}`;
  const catSections = booking.cats.flatMap((cat, index) => [
    `第 ${index + 1} 隻｜${cat.name}`,
    `性別：${cat.sex}`,
    `年齡：${cat.age} 歲`,
    `結紮：${cat.neutered}`,
    `貓砂：${cat.litter}`,
    `飲食習慣與餵食方式：${cat.diet}`,
    `健康狀況、過敏或慢性病：${cat.health}`,
    `特殊需求與照護提醒：${cat.special}`,
    "",
  ]);

  return [
    "貓家日子收到一筆新的住宿預約。",
    "",
    "【預約資訊】",
    `預約編號：${booking.reservationId}`,
    `送出時間：${formatTaipeiDateTime_(booking.submittedAt)}`,
    `房型：${quote.room.name}`,
    `入住：${quote.checkIn} ${booking.arrivalTime}`,
    `退宿：${quote.checkOut} ${booking.departureTime}`,
    `住宿晚數：${quote.nights} 晚`,
    `退宿時段：${quote.isLate ? "超過 15:00" : "15:00（含）以前"}`,
    `貓咪數量：${quote.cats} 隻`,
    `伙食加購：${mealLine}`,
    "",
    "【費用明細】",
    `單晚房價：NT$${formatInteger_(quote.nightlyRate)}`,
    `住宿原價：NT$${formatInteger_(quote.staySubtotal)}`,
    `長住優惠：${discountLine}`,
    `折扣後住宿費：NT$${formatInteger_(quote.discountedStaySubtotal)}`,
    `超時安親費：NT$${formatInteger_(quote.daycareFee)}`,
    `伙食加購：NT$${formatInteger_(quote.mealSubtotal)}`,
    `預估總額：NT$${formatInteger_(quote.total)}`,
    "",
    "【飼主與緊急聯絡】",
    `飼主姓名：${owner.name}`,
    `聯絡電話：${owner.phone}`,
    `緊急聯絡人：${owner.emergencyName}`,
    `緊急聯絡電話：${owner.emergencyPhone}`,
    `與飼主關係：${owner.emergencyRelation || "未填"}`,
    "",
    "【入住貓咪資料】",
    ...catSections,
    "【其他補充】",
    booking.additionalNotes || "無",
    "",
    `查看預約資料表：${EMAIL_CONFIG.spreadsheetUrl}`,
  ].join("\n");
}

function getNotificationEmails_() {
  const properties = PropertiesService.getScriptProperties();
  const rawRecipients = String(
    properties.getProperty(EMAIL_CONFIG.recipientsProperty) || ""
  ).trim();
  if (!rawRecipients) return [];

  const recipients = [...new Set(
    rawRecipients
      .split(/[\s,;]+/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  )];
  if (recipients.some((email) => !isValidEmail_(email))) {
    throw new Error("Email 通知收件地址格式不正確");
  }
  return recipients;
}

function isValidEmail_(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function formatInteger_(value) {
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatTaipeiDateTime_(value) {
  return Utilities.formatDate(new Date(value), CONFIG.timezone, "yyyy/MM/dd HH:mm:ss");
}

function updateEmailStatus_(payload) {
  const reservationId = requiredText_(payload.reservationId, "預約編號", 80);
  const emailStatus = requiredText_(payload.emailStatus, "Email 通知狀態", 20);
  if (!ALLOWED_EMAIL_STATUSES.includes(emailStatus)) {
    throw new Error("Email 通知狀態不正確");
  }

  const spreadsheet = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const bookingSheet = spreadsheet.getSheetByName(CONFIG.bookingSheet);
  if (!bookingSheet) throw new Error("找不到住宿預約工作表");

  const row = findReservationRow_(bookingSheet, reservationId);
  if (!row) throw new Error("找不到預約編號");
  bookingSheet.getRange(row, 25).setValue(emailStatus);
  return { reservationId, emailStatus };
}

function findReservationRow_(sheet, reservationId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const match = sheet
    .getRange(2, 1, lastRow - 1, 1)
    .createTextFinder(reservationId)
    .matchEntireCell(true)
    .findNext();
  return match ? match.getRow() : 0;
}

function calculateQuote_(booking) {
  const roomKey = requiredText_(booking.roomKey, "房型", 20);
  const room = ROOM_TYPES[roomKey];
  if (!room) throw new Error("房型不正確");

  const cats = Number(booking.cats);
  if (!Number.isInteger(cats) || cats < 1 || cats > room.maxCats) {
    throw new Error(`${room.name}的貓咪數量不正確`);
  }

  const checkIn = requiredDateText_(booking.checkIn, "入住日期");
  const checkOut = requiredDateText_(booking.checkOut, "退宿日期");
  const nights = daysBetween_(checkIn, checkOut);
  if (!Number.isInteger(nights) || nights < 1 || nights > 365) {
    throw new Error("住宿日期不正確");
  }

  const isLate = booking.isLate === true;
  const mealPlanKey = optionalText_(booking.mealPlanKey, 20) || "none";
  const mealPlan = MEAL_PLANS[mealPlanKey];
  if (!mealPlan) throw new Error("伙食方案不正確");
  let cansPerCatPerDay = 0;
  if (mealPlanKey === "canned") {
    cansPerCatPerDay = Number(booking.cansPerCatPerDay);
    if (
      !Number.isInteger(cansPerCatPerDay) ||
      cansPerCatPerDay < 1 ||
      cansPerCatPerDay > MAX_CANS_PER_CAT_PER_DAY
    ) {
      throw new Error("每隻貓每日罐頭數量不正確");
    }
  }
  const mealDailyRatePerCat = mealPlanKey === "canned"
    ? mealPlan.canRate * cansPerCatPerDay
    : mealPlan.dailyRatePerCat;
  const mealDailyRate = mealDailyRatePerCat * cats;
  const mealSubtotal = mealDailyRate * nights;
  const nightlyRate = room.baseRate + EXTRA_CAT_RATE * Math.max(0, cats - 1);
  const staySubtotal = nightlyRate * nights;
  const discountMultiplier = nights >= 14 ? 0.9 : nights >= 7 ? 0.95 : 1;
  const discountName = nights >= 14 ? "9 折" : nights >= 7 ? "95 折" : "無折扣";
  const discountedStaySubtotal = Math.round(staySubtotal * discountMultiplier);
  const discountAmount = staySubtotal - discountedStaySubtotal;
  const daycareFee = isLate ? nightlyRate * DAYCARE_RATE : 0;

  return {
    room,
    checkIn,
    checkOut,
    nights,
    cats,
    isLate,
    mealPlan,
    mealPlanKey,
    cansPerCatPerDay,
    mealDailyRatePerCat,
    mealDailyRate,
    mealSubtotal,
    nightlyRate,
    staySubtotal,
    discountName,
    discountAmount,
    discountedStaySubtotal,
    daycareFee,
    total: discountedStaySubtotal + daycareFee + mealSubtotal,
  };
}

function normalizeCat_(cat, index) {
  if (!cat || typeof cat !== "object") throw new Error(`第 ${index} 隻貓咪資料不完整`);
  const age = Number(cat.age);
  if (!Number.isFinite(age) || age < 0 || age > 30) {
    throw new Error(`第 ${index} 隻貓咪年齡不正確`);
  }

  return {
    name: requiredText_(cat.name, `第 ${index} 隻貓咪姓名`, 40),
    sex: requiredText_(cat.sex, `第 ${index} 隻貓咪性別`, 10),
    age,
    neutered: requiredText_(cat.neutered, `第 ${index} 隻貓咪結紮狀態`, 10),
    litter: requiredText_(cat.litter, `第 ${index} 隻貓砂種類`, 40),
    diet: requiredText_(cat.diet, `第 ${index} 隻飲食資料`, 220),
    health: requiredText_(cat.health, `第 ${index} 隻健康資料`, 220),
    special: requiredText_(cat.special, `第 ${index} 隻特殊需求`, 220),
  };
}

function daysBetween_(checkIn, checkOut) {
  const start = Date.parse(`${checkIn}T00:00:00Z`);
  const end = Date.parse(`${checkOut}T00:00:00Z`);
  return Math.round((end - start) / 86400000);
}

function parseDate_(value, label) {
  const normalized = requiredDateText_(value, label);
  const parts = normalized.split("-").map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function requiredDateText_(value, label) {
  const text = requiredText_(value, label, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new Error(`${label}格式不正確`);
  }
  return text;
}

function requiredTime_(value, label) {
  const text = requiredText_(value, label, 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) throw new Error(`${label}格式不正確`);
  return text;
}

function requiredText_(value, label, maxLength) {
  const text = String(value == null ? "" : value).trim();
  if (!text) throw new Error(`${label}未填寫`);
  if (text.length > maxLength) throw new Error(`${label}內容過長`);
  return text;
}

function optionalText_(value, maxLength) {
  const text = String(value == null ? "" : value).trim();
  return text.slice(0, maxLength);
}

function safeText_(value) {
  const text = String(value == null ? "" : value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function jsonResponse_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
