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

const CALENDAR_CONFIG = Object.freeze({
  calendarIdProperty: "BOOKING_CALENDAR_ID",
  defaultCalendarId: "primary",
  statusColumn: 36,
  eventIdColumn: 37,
});

const ROOM_TYPES = Object.freeze({
  small: {
    name: "貓家小貓房",
    baseRate: 850,
    maxCatsPerRoom: 3,
    maxRooms: 10,
    legacyMaxCats: 4,
  },
  family: {
    name: "探險家庭房",
    baseRate: 1300,
    maxCatsPerRoom: 6,
    maxRooms: 1,
    legacyMaxCats: 6,
  },
});

const MEAL_PLANS = Object.freeze({
  none: { name: "不加購", quantityType: "none", unit: "", unitRatePerCat: 0 },
  dry: { name: "乾飼料", quantityType: "days", unit: "天", unitRatePerCat: 50 },
  canned: { name: "罐頭", quantityType: "meals", unit: "餐", unitRatePerCat: 40 },
  combo: {
    name: "套組方案（早晚各一罐＋乾飼料）",
    quantityType: "days",
    unit: "天",
    unitRatePerCat: 100,
  },
});

const EXTRA_CAT_RATE = 200;
const DAYCARE_RATE = 0.5;
const MAX_CANS_PER_CAT_PER_DAY = 20;
const EARLIEST_ARRIVAL_TIME = "10:00";
const STANDARD_CHECKOUT_TIME = "15:00";
const LATEST_DEPARTURE_TIME = "20:30";
const ALLOWED_EMAIL_STATUSES = Object.freeze(["準備寄送", "已寄送", "寄送失敗"]);
const MEAL_HEADERS = Object.freeze([
  "伙食方案",
  "每貓每日罐數",
  "每貓每日伙食費",
  "伙食計費日數",
  "伙食小計",
  "加購數量",
  "伙食計價單位",
  "單位價格",
]);
const ROOM_COUNT_COLUMN = 35;
const ROOM_COUNT_HEADER = "房間數量";
const CALENDAR_HEADERS = Object.freeze(["Google Calendar 狀態", "Google Calendar 行程 ID"]);

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

function authorizeCalendar() {
  Calendar.Events.list(getBookingCalendarId_(), {
    maxResults: 1,
    showDeleted: false,
  });
  return {
    authorized: true,
    calendarId: getBookingCalendarId_(),
  };
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
  const emergencyName = optionalText_(owner.emergencyName, 50);
  const emergencyPhone = optionalText_(owner.emergencyPhone, 30);
  const emergencyRelation = optionalText_(owner.emergencyRelation, 30);
  const arrivalTime = requiredTime_(booking.arrivalTime, "入住時間");
  const departureTime = requiredTime_(booking.departureTime, "退宿時間");
  const quote = calculateQuote_(booking);
  validateBookingTimes_(arrivalTime, departureTime, quote.isLate);
  const additionalNotes = optionalText_(payload.additionalNotes, 300);

  if (cats.length !== quote.cats) {
    throw new Error("貓咪資料數量與預約數量不一致");
  }

  const normalizedCats = cats.map((cat, index) => normalizeCat_(cat, index + 1));
  const spreadsheet = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const bookingSheet = spreadsheet.getSheetByName(CONFIG.bookingSheet);
  const catSheet = spreadsheet.getSheetByName(CONFIG.catSheet);
  if (!bookingSheet || !catSheet) throw new Error("找不到預約資料工作表");

  bookingSheet.getRange(1, 27, 1, MEAL_HEADERS.length).setValues([MEAL_HEADERS]);
  bookingSheet.getRange(1, ROOM_COUNT_COLUMN).setValue(ROOM_COUNT_HEADER);
  bookingSheet
    .getRange(1, CALENDAR_CONFIG.statusColumn, 1, CALENDAR_HEADERS.length)
    .setValues([CALENDAR_HEADERS]);

  const bookingDetails = {
    reservationId,
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
  };

  const existingRow = findReservationRow_(bookingSheet, reservationId);
  if (existingRow) {
    const calendarResult = ensureCalendarEventSafely_(
      bookingSheet,
      existingRow,
      bookingDetails
    );
    return {
      reservationId,
      duplicate: true,
      calendarStatus: calendarResult.status,
      calendarEventId: calendarResult.eventId,
    };
  }

  const submittedAt = new Date();
  const emailStatus = ALLOWED_EMAIL_STATUSES.includes(payload.emailStatus)
    ? payload.emailStatus
    : "準備寄送";
  const legacyCanned = quote.mealQuantitySource === "legacy" && quote.mealPlanKey === "canned";
  const legacyDailyPlan = quote.mealPlan.quantityType === "days";
  const bookingRow = [
    safeText_(reservationId),
    submittedAt,
    "新預約",
    safeText_(ownerName),
    safeText_(ownerPhone),
    safeText_(emergencyName),
    safeText_(emergencyPhone),
    safeText_(emergencyRelation),
    safeText_(quote.roomSummary),
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
    legacyCanned ? quote.legacyCansPerCatPerDay : "",
    legacyDailyPlan
      ? quote.mealUnitRatePerCat
      : legacyCanned
        ? quote.mealUnitRatePerCat * quote.legacyCansPerCatPerDay
        : "",
    legacyDailyPlan
      ? quote.mealQuantity
      : legacyCanned
        ? quote.nights
        : "",
    quote.mealSubtotal,
    quote.mealQuantity,
    safeText_(quote.mealUnit),
    quote.mealUnitRatePerCat,
    quote.roomCount,
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
  bookingSheet.getRange(bookingRowNumber, 32).setNumberFormat("#,##0");
  bookingSheet.getRange(bookingRowNumber, 34).setNumberFormat("#,##0");
  bookingSheet.getRange(bookingRowNumber, ROOM_COUNT_COLUMN).setNumberFormat("#,##0");
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
    ...bookingDetails,
    submittedAt,
  });
  bookingSheet.getRange(bookingRowNumber, 25).setValue(notificationStatus);

  const calendarResult = ensureCalendarEventSafely_(
    bookingSheet,
    bookingRowNumber,
    bookingDetails
  );

  return {
    reservationId,
    duplicate: false,
    notificationStatus,
    calendarStatus: calendarResult.status,
    calendarEventId: calendarResult.eventId,
  };
}

function ensureCalendarEventSafely_(bookingSheet, bookingRowNumber, booking) {
  const statusRange = bookingSheet.getRange(
    bookingRowNumber,
    CALENDAR_CONFIG.statusColumn
  );
  const eventIdRange = bookingSheet.getRange(
    bookingRowNumber,
    CALENDAR_CONFIG.eventIdColumn
  );

  try {
    const storedEventId = String(eventIdRange.getDisplayValue() || "").trim();
    const eventId = storedEventId || createCalendarEventId_(booking.reservationId);
    let event = findCalendarEventByReservationId_(booking.reservationId);

    if (!event) {
      try {
        event = createCalendarEvent_(eventId, booking);
      } catch (error) {
        event = findCalendarEventByReservationId_(booking.reservationId);
        if (!event) throw error;
      }
    }

    statusRange.setValue("已建立");
    eventIdRange.setValue(event.id);
    return { status: "已建立", eventId: event.id };
  } catch (error) {
    console.error(error);
    try {
      statusRange.setValue("建立失敗");
    } catch (statusError) {
      console.error(statusError);
    }
    return { status: "建立失敗", eventId: "" };
  }
}

function getBookingCalendarId_() {
  const properties = PropertiesService.getScriptProperties();
  return String(
    properties.getProperty(CALENDAR_CONFIG.calendarIdProperty) || ""
  ).trim() || CALENDAR_CONFIG.defaultCalendarId;
}

function createCalendarEventId_(reservationId) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    reservationId,
    Utilities.Charset.UTF_8
  );
  return `c${digest
    .map((byte) => (byte < 0 ? byte + 256 : byte).toString(16).padStart(2, "0"))
    .join("")}`;
}

function findCalendarEventByReservationId_(reservationId) {
  const result = Calendar.Events.list(getBookingCalendarId_(), {
    maxResults: 1,
    privateExtendedProperty: `reservationId=${reservationId}`,
    showDeleted: false,
  });
  return result.items && result.items.length ? result.items[0] : null;
}

function createCalendarEvent_(eventId, booking) {
  return Calendar.Events.insert(
    {
      id: eventId,
      summary: createCalendarEventTitle_(booking),
      description: createCalendarEventDescription_(booking),
      start: {
        dateTime: `${booking.quote.checkIn}T${booking.arrivalTime}:00+08:00`,
        timeZone: CONFIG.timezone,
      },
      end: {
        dateTime: `${booking.quote.checkOut}T${booking.departureTime}:00+08:00`,
        timeZone: CONFIG.timezone,
      },
      transparency: "opaque",
      reminders: { useDefault: true },
      extendedProperties: {
        private: { reservationId: booking.reservationId },
      },
    },
    getBookingCalendarId_(),
    { sendUpdates: "none" }
  );
}

function createCalendarEventTitle_(booking) {
  return [
    "【待確認】貓家日子住宿",
    booking.owner.name,
    `${booking.quote.cats} 隻`,
    booking.quote.roomSummary,
  ].join("｜");
}

function createCalendarEventDescription_(booking) {
  const quote = booking.quote;
  const emergencyContact = booking.owner.emergencyName
    ? `${booking.owner.emergencyName}（${booking.owner.emergencyRelation || "未填關係"}）`
    : "未填";
  const mealLine = quote.mealPlanKey === "none"
    ? "不加購"
    : quote.mealPlanKey === "canned"
      ? `${quote.mealPlan.name}｜整筆預約共 ${quote.mealQuantity} 罐｜每罐 NT$${formatInteger_(quote.mealUnitRatePerCat)}`
      : `${quote.mealPlan.name}｜每隻 ${quote.mealQuantity} 天｜每隻每日 NT$${formatInteger_(quote.mealUnitRatePerCat)}`;

  return [
    `預約編號：${booking.reservationId}`,
    "預約狀態：待訂金付款與店家確認",
    `入住：${quote.checkIn} ${booking.arrivalTime}`,
    `退宿：${quote.checkOut} ${booking.departureTime}`,
    `房型：${quote.roomSummary}`,
    `貓咪數量：${quote.cats} 隻`,
    `貓咪姓名：${booking.cats.map((cat) => cat.name).join("、")}`,
    `伙食加購：${mealLine}`,
    quote.requiresManualQuote
      ? `長住專案：待專屬報價（未套用專案折扣參考 NT$${formatInteger_(quote.total)}）`
      : `預估總額：NT$${formatInteger_(quote.total)}`,
    "",
    `飼主：${booking.owner.name}`,
    `聯絡電話：${booking.owner.phone}`,
    `緊急聯絡人：${emergencyContact}`,
    `緊急聯絡電話：${booking.owner.emergencyPhone || "未填"}`,
    "",
    `其他補充：${booking.additionalNotes || "無"}`,
    `查看預約資料表：${EMAIL_CONFIG.spreadsheetUrl}`,
  ].join("\n");
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
      `${booking.quote.roomCount} 間・${booking.quote.cats} 隻貓`,
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
  const discountLine = quote.requiresManualQuote
    ? "長住專案（待專屬報價）"
    : quote.discountAmount
      ? `${quote.discountName}（−NT$${formatInteger_(quote.discountAmount)}）`
      : "無折扣";
  const mealLine = quote.mealPlanKey === "none"
    ? "不加購"
    : quote.mealPlanKey === "canned"
      ? quote.mealQuantityScope === "booking"
        ? `${quote.mealPlan.name}｜整筆預約共 ${quote.mealQuantity} 罐｜每罐 NT$${formatInteger_(quote.mealUnitRatePerCat)}`
        : `${quote.mealPlan.name}｜每隻共 ${quote.mealQuantity} 餐（${quote.mealQuantity} 罐）｜每隻每餐 NT$${formatInteger_(quote.mealUnitRatePerCat)}`
      : `${quote.mealPlan.name}｜每隻 ${quote.mealQuantity} 天｜每隻每日 NT$${formatInteger_(quote.mealUnitRatePerCat)}`;
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
    `房型：${quote.roomSummary}`,
    `房間數量：${quote.roomCount} 間`,
    `入住：${quote.checkIn} ${booking.arrivalTime}`,
    `退宿：${quote.checkOut} ${booking.departureTime}`,
    `住宿晚數：${quote.nights} 晚`,
    `退宿時段：${quote.isLate ? "超過 15:00" : "15:00（含）以前"}`,
    `貓咪數量：${quote.cats} 隻`,
    `伙食加購：${mealLine}`,
    "",
    "【費用明細】",
    `房間基本費：NT$${formatInteger_(quote.baseRoomFeePerNight)}／晚（${quote.roomRateFormula}）`,
    `加貓費：NT$${formatInteger_(quote.extraCatFeePerNight)}／晚（${quote.extraCatCount} 隻）`,
    `單晚房價：NT$${formatInteger_(quote.nightlyRate)}`,
    `住宿原價：NT$${formatInteger_(quote.staySubtotal)}`,
    `長住優惠：${discountLine}`,
    quote.requiresManualQuote
      ? "折扣後住宿費：待專屬報價"
      : `折扣後住宿費：NT$${formatInteger_(quote.discountedStaySubtotal)}`,
    `超時安親費：NT$${formatInteger_(quote.daycareFee)}`,
    `伙食加購：NT$${formatInteger_(quote.mealSubtotal)}`,
    quote.requiresManualQuote
      ? `專案折扣前參考總額：NT$${formatInteger_(quote.total)}`
      : `預估總額：NT$${formatInteger_(quote.total)}`,
    "",
    "【飼主與緊急聯絡】",
    `飼主姓名：${owner.name}`,
    `聯絡電話：${owner.phone}`,
    `緊急聯絡人：${owner.emergencyName || "未填"}`,
    `緊急聯絡電話：${owner.emergencyPhone || "未填"}`,
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

function normalizeRoomSelection_(booking) {
  const hasRoomSelections = Array.isArray(booking.rooms);

  if (hasRoomSelections) {
    if (!booking.rooms.length || booking.rooms.length > Object.keys(ROOM_TYPES).length) {
      throw new Error("房型選擇不正確");
    }

    const seenRoomKeys = new Set();
    const rooms = booking.rooms.map((selection) => {
      if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
        throw new Error("房型選擇不正確");
      }
      const roomKey = requiredText_(selection.roomKey, "房型", 20);
      const room = ROOM_TYPES[roomKey];
      if (!room || seenRoomKeys.has(roomKey)) throw new Error("房型選擇不正確");
      seenRoomKeys.add(roomKey);

      const count = Number(selection.roomCount);
      if (!Number.isInteger(count) || count < 1 || count > room.maxRooms) {
        throw new Error(`${room.name}的房間數量不正確`);
      }
      return { roomKey, count, ...room };
    });

    const roomCount = rooms.reduce((total, room) => total + room.count, 0);
    const declaredRoomCount = booking.roomCount === undefined
      || booking.roomCount === null
      || String(booking.roomCount).trim() === ""
      ? roomCount
      : Number(booking.roomCount);
    if (!Number.isInteger(declaredRoomCount) || declaredRoomCount !== roomCount) {
      throw new Error("房間總數與房型明細不一致");
    }

    return {
      rooms,
      roomCount,
      roomQuantitySource: "rooms",
      maximumCats: rooms.reduce(
        (total, room) => total + room.maxCatsPerRoom * room.count,
        0
      ),
      baseRoomFeePerNight: rooms.reduce(
        (total, room) => total + room.baseRate * room.count,
        0
      ),
    };
  }

  const roomKey = requiredText_(booking.roomKey, "房型", 20);
  const room = ROOM_TYPES[roomKey];
  if (!room) throw new Error("房型不正確");
  const hasRoomCount = booking.roomCount !== undefined
    && booking.roomCount !== null
    && String(booking.roomCount).trim() !== "";
  const roomCount = hasRoomCount ? Number(booking.roomCount) : 1;
  if (!Number.isInteger(roomCount) || roomCount < 1 || roomCount > room.maxRooms) {
    throw new Error(`${room.name}的房間數量不正確`);
  }

  return {
    rooms: [{ roomKey, count: roomCount, ...room }],
    roomCount,
    roomQuantitySource: hasRoomCount ? "quantity" : "legacy",
    // 舊版快取頁面沒有 roomCount，部署交界期間仍沿用舊版單房容量。
    maximumCats: hasRoomCount ? room.maxCatsPerRoom * roomCount : room.legacyMaxCats,
    baseRoomFeePerNight: room.baseRate * roomCount,
  };
}

function calculateQuote_(booking) {
  const roomSelection = normalizeRoomSelection_(booking);
  const roomSummary = roomSelection.rooms
    .map((room) => `${room.name} ${room.count} 間`)
    .join("＋");
  const roomNames = roomSelection.rooms.map((room) => room.name).join("＋");
  const roomRateFormula = roomSelection.rooms
    .map((room) => `NT$${formatInteger_(room.baseRate)} × ${room.count} 間`)
    .join("＋");
  const cats = Number(booking.cats);
  if (!Number.isInteger(cats) || cats < 1 || cats > roomSelection.maximumCats) {
    throw new Error("所選房型的貓咪數量不正確");
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
  const hasNewMealQuantity = booking.mealQuantity !== undefined
    && booking.mealQuantity !== null
    && String(booking.mealQuantity).trim() !== "";
  const requestedMealQuantityScope = optionalText_(booking.mealQuantityScope, 20);
  let mealQuantity = 0;
  let mealQuantitySource = "none";
  let mealQuantityScope = "none";
  let legacyCansPerCatPerDay = 0;

  if (mealPlanKey !== "none") {
    if (mealPlanKey === "canned" && requestedMealQuantityScope === "booking") {
      mealQuantityScope = "booking";
    } else if (!requestedMealQuantityScope || requestedMealQuantityScope === "perCat") {
      mealQuantityScope = "perCat";
    } else {
      throw new Error("伙食計價方式不正確");
    }

    if (hasNewMealQuantity) {
      mealQuantity = Number(booking.mealQuantity);
      mealQuantitySource = "quantity";
    } else if (mealPlanKey === "canned") {
      legacyCansPerCatPerDay = Number(booking.cansPerCatPerDay);
      if (
        !Number.isInteger(legacyCansPerCatPerDay) ||
        legacyCansPerCatPerDay < 1 ||
        legacyCansPerCatPerDay > MAX_CANS_PER_CAT_PER_DAY
      ) {
        throw new Error("每隻貓每日罐頭數量不正確");
      }
      mealQuantity = legacyCansPerCatPerDay * nights;
      mealQuantitySource = "legacy";
    } else {
      mealQuantity = nights;
      mealQuantitySource = "legacy";
    }

    const maximumMealQuantity = mealPlan.quantityType === "days"
      ? nights
      : nights * MAX_CANS_PER_CAT_PER_DAY * (mealQuantityScope === "booking" ? cats : 1);
    if (
      !Number.isInteger(mealQuantity) ||
      mealQuantity < 1 ||
      mealQuantity > maximumMealQuantity
    ) {
      throw new Error(
        mealPlan.quantityType === "days"
          ? "伙食加購天數不正確"
          : mealQuantityScope === "booking"
            ? "罐頭總數不正確"
            : "罐頭加購餐數不正確"
      );
    }
  }

  const mealUnitRatePerCat = mealPlan.unitRatePerCat;
  const mealSubtotal = mealUnitRatePerCat
    * mealQuantity
    * (mealQuantityScope === "booking" ? 1 : cats);
  const extraCatCount = Math.max(0, cats - roomSelection.roomCount);
  const extraCatFeePerNight = EXTRA_CAT_RATE * extraCatCount;
  const nightlyRate = roomSelection.baseRoomFeePerNight + extraCatFeePerNight;
  const staySubtotal = nightlyRate * nights;
  const requiresManualQuote = nights >= 30;
  const discountMultiplier = requiresManualQuote ? 1 : nights >= 14 ? 0.9 : nights >= 7 ? 0.95 : 1;
  const discountName = requiresManualQuote
    ? "長住專案（待專屬報價）"
    : nights >= 14
      ? "9 折"
      : nights >= 7
        ? "95 折"
        : "無折扣";
  const discountedStaySubtotal = Math.round(staySubtotal * discountMultiplier);
  const discountAmount = staySubtotal - discountedStaySubtotal;
  const daycareFee = isLate ? nightlyRate * DAYCARE_RATE : 0;

  return {
    ...roomSelection,
    room: roomSelection.rooms.length === 1
      ? ROOM_TYPES[roomSelection.rooms[0].roomKey]
      : { name: roomNames, baseRate: roomSelection.baseRoomFeePerNight },
    roomSummary,
    roomNames,
    roomRateFormula,
    checkIn,
    checkOut,
    nights,
    cats,
    isLate,
    mealPlan,
    mealPlanKey,
    mealQuantity,
    mealQuantitySource,
    mealQuantityScope,
    mealUnit: mealPlanKey === "canned" && mealQuantityScope === "booking"
      ? "罐"
      : mealPlan.unit,
    mealUnitRatePerCat,
    legacyCansPerCatPerDay,
    mealSubtotal,
    extraCatCount,
    extraCatFeePerNight,
    nightlyRate,
    staySubtotal,
    discountName,
    requiresManualQuote,
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

function validateBookingTimes_(arrivalTime, departureTime, isLate) {
  if (arrivalTime < EARLIEST_ARRIVAL_TIME) {
    throw new Error(`入住時間不可早於 ${EARLIEST_ARRIVAL_TIME}`);
  }
  if (departureTime > LATEST_DEPARTURE_TIME) {
    throw new Error(`退宿時間不可晚於 ${LATEST_DEPARTURE_TIME}`);
  }
  if (isLate && departureTime <= STANDARD_CHECKOUT_TIME) {
    throw new Error("退宿時間與所選退宿區間不一致");
  }
  if (!isLate && departureTime > STANDARD_CHECKOUT_TIME) {
    throw new Error("退宿時間與所選退宿區間不一致");
  }
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
