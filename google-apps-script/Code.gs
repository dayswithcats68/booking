const CONFIG = Object.freeze({
  spreadsheetId: "1EM9yFt-zHo84abbOVvr10vb2GNm5XR1X2xBLMejlMoE",
  bookingSheet: "住宿預約",
  catSheet: "貓咪資料",
  timezone: "Asia/Taipei",
  source: "網站預約表單",
});

const LINE_CONFIG = Object.freeze({
  channelAccessTokenProperty: "LINE_CHANNEL_ACCESS_TOKEN",
  notificationToProperty: "LINE_NOTIFICATION_TO",
  pushEndpoint: "https://api.line.me/v2/bot/message/push",
});

const ROOM_TYPES = Object.freeze({
  small: { name: "貓家小貓房", baseRate: 850, maxCats: 4 },
  family: { name: "探險家庭房", baseRate: 1300, maxCats: 6 },
});

const EXTRA_CAT_RATE = 200;
const DAYCARE_RATE = 0.5;
const ALLOWED_LINE_STATUSES = Object.freeze(["準備傳送", "已傳送", "傳送失敗"]);

function doGet() {
  const properties = PropertiesService.getScriptProperties();
  return jsonResponse_({
    ok: true,
    service: "days-with-cats-booking",
    lineNotificationConfigured: Boolean(
      properties.getProperty(LINE_CONFIG.channelAccessTokenProperty) &&
      properties.getProperty(LINE_CONFIG.notificationToProperty)
    ),
    timestamp: new Date().toISOString(),
  });
}

function doPost(event) {
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(15000);
    const payload = parsePayload_(event);
    const result = payload.action === "updateLineStatus"
      ? updateLineStatus_(payload)
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
  const lineStatus = ALLOWED_LINE_STATUSES.includes(payload.lineStatus)
    ? payload.lineStatus
    : "準備傳送";
  const additionalNotes = optionalText_(payload.additionalNotes, 300);
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
    lineStatus,
    CONFIG.source,
  ];

  const bookingRowNumber = bookingSheet.getLastRow() + 1;
  bookingSheet.getRange(bookingRowNumber, 1, 1, bookingRow.length).setValues([bookingRow]);
  bookingSheet.getRange(bookingRowNumber, 2).setNumberFormat("yyyy/mm/dd hh:mm:ss");
  bookingSheet.getRange(bookingRowNumber, 10).setNumberFormat("yyyy/mm/dd");
  bookingSheet.getRange(bookingRowNumber, 12).setNumberFormat("yyyy/mm/dd");
  bookingSheet.getRange(bookingRowNumber, 16, 1, 7).setNumberFormat("#,##0");
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

  const notificationStatus = sendLineNotificationSafely_(ownerName);
  bookingSheet.getRange(bookingRowNumber, 25).setValue(notificationStatus);

  return { reservationId, duplicate: false, notificationStatus };
}

function sendLineNotificationSafely_(ownerName) {
  try {
    const properties = PropertiesService.getScriptProperties();
    const channelAccessToken = String(
      properties.getProperty(LINE_CONFIG.channelAccessTokenProperty) || ""
    ).trim();
    const notificationTo = String(
      properties.getProperty(LINE_CONFIG.notificationToProperty) || ""
    ).trim();

    if (!channelAccessToken || !notificationTo) {
      console.warn("LINE notification is not configured");
      return "傳送失敗";
    }

    const response = UrlFetchApp.fetch(LINE_CONFIG.pushEndpoint, {
      method: "post",
      contentType: "application/json",
      headers: {
        Authorization: `Bearer ${channelAccessToken}`,
      },
      payload: JSON.stringify({
        to: notificationTo,
        messages: [{ type: "text", text: `${ownerName}已預約` }],
      }),
      muteHttpExceptions: true,
    });

    const statusCode = response.getResponseCode();
    if (statusCode >= 200 && statusCode < 300) return "已傳送";

    console.error(`LINE notification failed with status ${statusCode}`);
    return "傳送失敗";
  } catch (error) {
    console.error(error);
    return "傳送失敗";
  }
}

function updateLineStatus_(payload) {
  const reservationId = requiredText_(payload.reservationId, "預約編號", 80);
  const lineStatus = requiredText_(payload.lineStatus, "LINE 傳送狀態", 20);
  if (!ALLOWED_LINE_STATUSES.includes(lineStatus)) {
    throw new Error("LINE 傳送狀態不正確");
  }

  const spreadsheet = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const bookingSheet = spreadsheet.getSheetByName(CONFIG.bookingSheet);
  if (!bookingSheet) throw new Error("找不到住宿預約工作表");

  const row = findReservationRow_(bookingSheet, reservationId);
  if (!row) throw new Error("找不到預約編號");
  bookingSheet.getRange(row, 25).setValue(lineStatus);
  return { reservationId, lineStatus };
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
    nightlyRate,
    staySubtotal,
    discountName,
    discountAmount,
    discountedStaySubtotal,
    daycareFee,
    total: discountedStaySubtotal + daycareFee,
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
