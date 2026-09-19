const CONFIG = Object.freeze({
  spreadsheetIdProperty: "BOOKING_SPREADSHEET_ID",
  paymentAccountNumberProperty: "PAYMENT_ACCOUNT_NUMBER",
  turnstileSecretProperty: "TURNSTILE_SECRET_KEY",
  turnstileHostnamesProperty: "TURNSTILE_ALLOWED_HOSTNAMES",
  bookingSheet: "住宿預約",
  catSheet: "貓咪資料",
  timezone: "Asia/Taipei",
  source: "網站預約表單",
});

const RELEASE_ID = "cny-2027-production-r8";
const PRICING_VERSION = "cny-2027-v2";
const REGULAR_DEPOSIT = 500;
const CREATE_BOOKING_ACTION = "createBooking";
const MAX_REQUEST_BYTES = 64 * 1024;
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_ACTION = "booking_submit";
const RESERVATION_ID_PATTERN = /^DWC-\d{8}-\d{6}-[0-9A-F]{32}$/;
const PHONE_PATTERN = /^(?=(?:\D*\d){8,15}\D*$)\+?[0-9() -]{8,20}$/;
const CAT_SEX_OPTIONS = Object.freeze(["公", "母", "不確定"]);
const CAT_NEUTERED_OPTIONS = Object.freeze(["已結紮", "未結紮"]);
const CAT_LITTER_OPTIONS = Object.freeze(["礦砂", "豆腐砂"]);
const LEGACY_CAT_LITTER_OPTIONS = Object.freeze(["礦砂", "豆腐砂", "其他"]);

const EMAIL_CONFIG = Object.freeze({
  recipientsProperty: "BOOKING_NOTIFICATION_EMAILS",
  senderName: "貓家日子預約系統",
});

const SEASONAL_CONFIG = Object.freeze({
  key: "cny-2027",
  label: "2027 春節",
  start: "2027-02-03",
  lastNight: "2027-02-11",
  bookingOpenAt: "2026-09-27T12:00:00+08:00",
  lateCheckoutStart: "2027-02-09",
  holidayBaseRates: Object.freeze({
    small: 1450,
    jump: 1800,
    family: 2200,
  }),
  minimumHolidayNights: 5,
  depositRate: 0.5,
  depositDueDays: 3,
  fullRefundThrough: "2026-12-31",
  halfRefundThrough: "2027-01-23",
  noRefundFrom: "2027-01-24",
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
  jump: {
    name: "眺跳家庭房",
    baseRate: 1100,
    maxCatsPerRoom: 4,
    maxRooms: 3,
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
const LUNAR_NEW_YEARS_EVE = "2027-02-05";
const LUNAR_NEW_YEARS_EVE_LATEST_ARRIVAL_TIME = "17:00";
const STANDARD_CHECKOUT_TIME = "15:00";
const LATEST_DEPARTURE_TIME = "20:30";
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
const PRICING_DETAIL_COLUMN = 38;
const PRICING_DETAIL_HEADERS = Object.freeze([
  "計價版本",
  "平日晚數",
  "平日每晚",
  "平日小計",
  "春節晚數",
  "春節每晚",
  "春節小計",
  "訂金金額",
]);

function doGet() {
  const properties = PropertiesService.getScriptProperties();
  return jsonResponse_({
    ok: true,
    service: "days-with-cats-booking",
    release: RELEASE_ID,
    pricingVersion: PRICING_VERSION,
    emailNotificationConfigured: Boolean(
      properties.getProperty(EMAIL_CONFIG.recipientsProperty)
    ),
    paymentAccountConfigured: Boolean(getPaymentAccountNumber_()),
    botProtectionConfigured: Boolean(
      getTurnstileSecret_() && getTurnstileAllowedHostnames_().length
    ),
    calendarTarget: properties.getProperty(CALENDAR_CONFIG.calendarIdProperty)
      ? "configured"
      : "primary",
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
  let lock = null;

  try {
    const payload = parsePayload_(event);
    verifyTurnstile_(payload.turnstileToken);
    lock = LockService.getScriptLock();
    lock.waitLock(15000);
    const result = saveBooking_(payload);
    return jsonResponse_({ ok: true, ...result });
  } catch (error) {
    console.error(error);
    return jsonResponse_({
      ok: false,
      error: error && error.message ? error.message : "無法處理預約資料",
    });
  } finally {
    if (lock && lock.hasLock()) lock.releaseLock();
  }
}

function parsePayload_(event) {
  if (!event || !event.postData || !event.postData.contents) {
    throw new Error("缺少預約資料");
  }

  const contentLength = Number(event.postData.length || event.contentLength || 0);
  const measuredLength = Utilities.newBlob(event.postData.contents).getBytes().length;
  if (Math.max(contentLength, measuredLength) > MAX_REQUEST_BYTES) {
    throw new Error("預約資料內容過長");
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
  if (payload.action !== CREATE_BOOKING_ACTION) {
    throw new Error("預約動作不正確");
  }
  return payload;
}

function verifyTurnstile_(tokenValue) {
  const secret = getTurnstileSecret_();
  if (!secret) return;

  const token = optionalText_(tokenValue, 2048);
  if (!token) throw new Error("請先完成人機驗證");

  const allowedHostnames = getTurnstileAllowedHostnames_();
  if (!allowedHostnames.length) {
    throw new Error("人機驗證尚未完成設定");
  }

  let response;
  let result;
  try {
    response = UrlFetchApp.fetch(TURNSTILE_VERIFY_URL, {
      method: "post",
      contentType: "application/x-www-form-urlencoded",
      payload: {
        secret,
        response: token,
      },
      muteHttpExceptions: true,
    });
    result = JSON.parse(response.getContentText());
  } catch (error) {
    console.error("Turnstile verification request failed");
    throw new Error("人機驗證服務暫時無法使用，請稍後再試");
  }

  const hostname = String(result && result.hostname || "").trim().toLowerCase();
  if (
    response.getResponseCode() !== 200
    || !result
    || result.success !== true
    || result.action !== TURNSTILE_ACTION
    || !allowedHostnames.includes(hostname)
  ) {
    throw new Error("人機驗證失敗，請重新驗證後再送出");
  }
}

function getTurnstileSecret_() {
  return String(
    PropertiesService
      .getScriptProperties()
      .getProperty(CONFIG.turnstileSecretProperty) || ""
  ).trim();
}

function getTurnstileAllowedHostnames_() {
  const rawHostnames = String(
    PropertiesService
      .getScriptProperties()
      .getProperty(CONFIG.turnstileHostnamesProperty) || ""
  );
  return [...new Set(
    rawHostnames
      .split(/[\s,;]+/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  )];
}

function saveBooking_(payload) {
  const reservationId = requiredReservationId_(payload.reservationId);
  const owner = payload.owner || {};
  const booking = payload.booking || {};
  const cats = Array.isArray(payload.cats) ? payload.cats : [];

  const ownerName = requiredSingleLineText_(owner.name, "飼主姓名", 50);
  const ownerPhone = requiredPhone_(owner.phone, "聯絡電話");
  const emergencyName = optionalSingleLineText_(owner.emergencyName, "緊急聯絡人姓名", 50);
  const emergencyPhone = optionalPhone_(owner.emergencyPhone, "緊急聯絡人電話");
  const emergencyRelation = optionalSingleLineText_(
    owner.emergencyRelation,
    "緊急聯絡人關係",
    30
  );
  const arrivalTime = requiredTime_(booking.arrivalTime, "入住時間");
  const departureTime = requiredTime_(booking.departureTime, "退宿時間");
  const quote = calculateQuote_(booking);
  validateBookingTimes_(arrivalTime, departureTime, quote.isLate, quote.checkIn);
  const additionalNotes = optionalText_(payload.additionalNotes, 300);

  if (cats.length !== quote.cats) {
    throw new Error("貓咪資料數量與預約數量不一致");
  }

  // Accept the former per-cat value during deployment so already-open browser tabs keep working.
  const legacyLitter = cats.length && cats[0] && cats[0].litter;
  const litter = requiredOption_(
    booking.litter || legacyLitter,
    "貓砂種類",
    booking.litter ? CAT_LITTER_OPTIONS : LEGACY_CAT_LITTER_OPTIONS
  );
  const normalizedCats = cats.map((cat, index) => normalizeCat_(cat, index + 1));
  const spreadsheet = getBookingSpreadsheet_();
  const bookingSheet = spreadsheet.getSheetByName(CONFIG.bookingSheet);
  const catSheet = spreadsheet.getSheetByName(CONFIG.catSheet);
  if (!bookingSheet || !catSheet) throw new Error("找不到預約資料工作表");

  bookingSheet.getRange(1, 27, 1, MEAL_HEADERS.length).setValues([MEAL_HEADERS]);
  bookingSheet.getRange(1, ROOM_COUNT_COLUMN).setValue(ROOM_COUNT_HEADER);
  bookingSheet
    .getRange(1, CALENDAR_CONFIG.statusColumn, 1, CALENDAR_HEADERS.length)
    .setValues([CALENDAR_HEADERS]);
  bookingSheet
    .getRange(1, PRICING_DETAIL_COLUMN, 1, PRICING_DETAIL_HEADERS.length)
    .setValues([PRICING_DETAIL_HEADERS]);

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
    litter,
    quote,
    cats: normalizedCats,
    additionalNotes,
  };

  const existingRow = findReservationRow_(bookingSheet, reservationId);
  if (existingRow) {
    let notificationStatus = String(
      bookingSheet.getRange(existingRow, 25).getDisplayValue() || ""
    ).trim();
    if (notificationStatus !== "已寄送") {
      const submittedAt = bookingSheet.getRange(existingRow, 2).getValue() || new Date();
      const notificationResult = sendEmailNotificationSafely_({
        ...bookingDetails,
        submittedAt,
      });
      notificationStatus = notificationResult.status;
      writeEmailNotificationStatus_(
        bookingSheet.getRange(existingRow, 25),
        notificationResult
      );
    }
    const calendarResult = ensureCalendarEventSafely_(
      bookingSheet,
      existingRow,
      bookingDetails
    );
    return {
      reservationId,
      duplicate: true,
      paymentAccountNumber: getPaymentAccountNumber_(),
      notificationStatus,
      calendarStatus: calendarResult.status,
      calendarEventId: calendarResult.eventId,
      quote: createPublicQuote_(quote),
    };
  }

  const submittedAt = new Date();
  const emailStatus = "準備寄送";
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
  const pricingDetailRow = [
    quote.pricingVersion,
    quote.regularNights,
    quote.regularNightlyRate,
    quote.regularSubtotal,
    quote.holidayNights,
    quote.holidayNightlyRate,
    quote.holidaySubtotal,
    quote.depositAmount,
  ];
  bookingSheet
    .getRange(bookingRowNumber, PRICING_DETAIL_COLUMN, 1, pricingDetailRow.length)
    .setValues([pricingDetailRow]);
  bookingSheet
    .getRange(bookingRowNumber, PRICING_DETAIL_COLUMN + 1, 1, pricingDetailRow.length - 1)
    .setNumberFormat("#,##0");

  const catRows = normalizedCats.map((cat, index) => [
    safeText_(reservationId),
    submittedAt,
    safeText_(ownerName),
    parseDate_(quote.checkIn, "入住日期"),
    parseDate_(quote.checkOut, "退宿日期"),
    index + 1,
    safeText_(cat.name),
    safeText_(cat.sex),
    safeText_(cat.age),
    safeText_(cat.neutered),
    safeText_(litter),
    "",
    safeText_(cat.health),
    safeText_(cat.special),
  ]);

  const firstCatRow = catSheet.getLastRow() + 1;
  catSheet.getRange(firstCatRow, 1, catRows.length, catRows[0].length).setValues(catRows);
  catSheet.getRange(firstCatRow, 2, catRows.length, 1).setNumberFormat("yyyy/mm/dd hh:mm:ss");
  catSheet.getRange(firstCatRow, 4, catRows.length, 2).setNumberFormat("yyyy/mm/dd");
  catSheet.getRange(firstCatRow, 1, catRows.length, catRows[0].length).setWrap(true);

  const notificationResult = sendEmailNotificationSafely_({
    ...bookingDetails,
    submittedAt,
  });
  const notificationStatus = notificationResult.status;
  writeEmailNotificationStatus_(
    bookingSheet.getRange(bookingRowNumber, 25),
    notificationResult
  );

  const calendarResult = ensureCalendarEventSafely_(
    bookingSheet,
    bookingRowNumber,
    bookingDetails
  );

  return {
    reservationId,
    duplicate: false,
    paymentAccountNumber: getPaymentAccountNumber_(),
    notificationStatus,
    calendarStatus: calendarResult.status,
    calendarEventId: calendarResult.eventId,
    quote: createPublicQuote_(quote),
  };
}

function createPublicQuote_(quote) {
  return {
    pricingVersion: quote.pricingVersion,
    seasonKey: quote.seasonKey,
    seasonLabel: quote.seasonLabel,
    hasHoliday: quote.hasHoliday,
    roomSummary: quote.roomSummary,
    roomCount: quote.roomCount,
    cats: quote.cats,
    checkIn: quote.checkIn,
    checkOut: quote.checkOut,
    nights: quote.nights,
    regularNights: quote.regularNights,
    holidayNights: quote.holidayNights,
    regularNightlyRate: quote.regularNightlyRate,
    holidayNightlyRate: quote.holidayNightlyRate,
    regularSubtotal: quote.regularSubtotal,
    holidaySubtotal: quote.holidaySubtotal,
    discountName: quote.discountName,
    discountAmount: quote.discountAmount,
    discountedStaySubtotal: quote.discountedStaySubtotal,
    daycareFee: quote.daycareFee,
    mealSubtotal: quote.mealSubtotal,
    total: quote.total,
    depositAmount: quote.depositAmount,
    depositDueDays: quote.depositDueDays,
    lateCheckoutUnavailable: quote.lateCheckoutUnavailable,
    requiresManualQuote: quote.requiresManualQuote,
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
    let event = storedEventId ? getCalendarEventById_(storedEventId) : null;
    if (!event) event = findCalendarEventByReservationId_(booking.reservationId);

    if (!event) {
      try {
        event = createCalendarEvent_(booking);
      } catch (error) {
        event = findCalendarEventByReservationId_(booking.reservationId);
        if (!event) throw error;
      }
    }

    event = getCalendarEventById_(event.id)
      || findCalendarEventByReservationId_(booking.reservationId);
    if (!event) throw new Error("Google Calendar 行程建立後無法驗證");

    statusRange.setValue("已建立");
    statusRange.setNote("");
    eventIdRange.setValue(event.id);
    return { status: "已建立", eventId: event.id };
  } catch (error) {
    console.error(error);
    try {
      statusRange.setValue("建立失敗");
      statusRange.setNote(`建立失敗：${getErrorMessage_(error)}`);
      eventIdRange.clearContent();
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

function getCalendarEventById_(eventId) {
  try {
    const event = Calendar.Events.get(getBookingCalendarId_(), eventId);
    return event && event.status !== "cancelled" ? event : null;
  } catch (error) {
    if (/\b404\b|not found/i.test(getErrorMessage_(error))) return null;
    throw error;
  }
}

function findCalendarEventByReservationId_(reservationId) {
  const result = Calendar.Events.list(getBookingCalendarId_(), {
    maxResults: 1,
    privateExtendedProperty: `reservationId=${reservationId}`,
    showDeleted: false,
  });
  return result.items && result.items.length ? result.items[0] : null;
}

function createCalendarEvent_(booking) {
  return Calendar.Events.insert(
    {
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
    `住宿計價：${createStayPeriodSummary_(quote)}`,
    `應付訂金：${createDepositSummary_(quote)}`,
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
    `查看預約資料表：${getBookingSpreadsheetUrl_()}`,
  ].join("\n");
}

function sendEmailNotificationSafely_(booking) {
  try {
    const recipients = getNotificationEmails_();
    if (!recipients.length) {
      console.warn("Email notification is not configured");
      return {
        status: "寄送失敗",
        note: "寄送失敗：尚未設定通知收件地址",
      };
    }

    const subject = [
      `【新預約】${booking.owner.name}`,
      `${booking.quote.checkIn}–${booking.quote.checkOut}`,
      `${booking.quote.roomCount} 間・${booking.quote.cats} 隻貓`,
    ].join("｜");
    MailApp.sendEmail({
      to: recipients.join(","),
      subject,
      body: createDetailedEmailBody_(booking),
      name: EMAIL_CONFIG.senderName,
    });
    return {
      status: "已寄送",
      note: "",
    };
  } catch (error) {
    console.error(error);
    return {
      status: "寄送失敗",
      note: `寄送失敗：${getErrorMessage_(error)}`,
    };
  }
}

function writeEmailNotificationStatus_(range, result) {
  range.setValue(result.status);
  range.setNote(result.note || "");
}

function getErrorMessage_(error) {
  return String(error && error.message ? error.message : error || "未知錯誤")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
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
    `年齡：${cat.age}`,
    `結紮：${cat.neutered}`,
    `健康狀況、過敏或慢性病：${cat.health}`,
    `特殊需求與照護提醒：${cat.special}`,
    "",
  ]);

  return [
    "貓家日子收到一筆新的住宿預約。",
    "契約請依預約資料另行製作。",
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
    `貓砂種類：${booking.litter}`,
    `伙食加購：${mealLine}`,
    "",
    "【費用明細】",
    `住宿明細：${createStayPeriodSummary_(quote)}`,
    `平日房間基本費：NT$${formatInteger_(quote.baseRoomFeePerNight)}／晚（${quote.roomRateFormula}）`,
    `加貓費：NT$${formatInteger_(quote.extraCatFeePerNight)}／晚（${quote.extraCatCount} 隻）`,
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
    `應付訂金：${createDepositSummary_(quote)}`,
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
    `查看預約資料表：${getBookingSpreadsheetUrl_()}`,
  ].join("\n");
}

function createStayPeriodSummary_(quote) {
  const parts = [];
  if (quote.regularNights) {
    parts.push(
      `平日 NT$${formatInteger_(quote.regularNightlyRate)}／晚 × ${quote.regularNights} 晚`
    );
  }
  if (quote.holidayNights) {
    parts.push(
      `春節 NT$${formatInteger_(quote.holidayNightlyRate)}／晚 × ${quote.holidayNights} 晚`
    );
  }
  return parts.join("；");
}

function createDepositSummary_(quote) {
  if (quote.depositAmount === null) {
    return "訂金於長住專案金額確認後另行通知";
  }
  return quote.hasHoliday
    ? `春節訂金 NT$${formatInteger_(quote.depositAmount)}（住宿費 50%，店家確認後 ${quote.depositDueDays} 日內支付）`
    : `訂金 NT$${formatInteger_(quote.depositAmount)}（${quote.depositDueDays} 日內支付）`;
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

function getBookingSpreadsheet_() {
  const boundSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (boundSpreadsheet) return boundSpreadsheet;

  const spreadsheetId = String(
    PropertiesService
      .getScriptProperties()
      .getProperty(CONFIG.spreadsheetIdProperty) || ""
  ).trim();
  if (!spreadsheetId) throw new Error("找不到綁定的預約試算表");
  return SpreadsheetApp.openById(spreadsheetId);
}

function getBookingSpreadsheetUrl_() {
  return getBookingSpreadsheet_().getUrl();
}

function getPaymentAccountNumber_() {
  const accountNumber = String(
    PropertiesService
      .getScriptProperties()
      .getProperty(CONFIG.paymentAccountNumberProperty) || ""
  ).replace(/\D/g, "");
  return accountNumber.length >= 10 && accountNumber.length <= 20
    ? accountNumber
    : "";
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
  const periods = splitSeasonNights_(checkIn, checkOut);
  const hasHoliday = periods.holidayNights > 0;
  const bookingOpen = Date.now() >= Date.parse(SEASONAL_CONFIG.bookingOpenAt);
  const checkoutDuringHoliday = checkOut >= SEASONAL_CONFIG.start
    && checkOut <= SEASONAL_CONFIG.lastNight;
  const lateCheckoutUnavailable = checkoutDuringHoliday
    && checkOut < SEASONAL_CONFIG.lateCheckoutStart;
  const clientPricingVersion = optionalText_(booking.pricingVersion, 40);

  if (hasHoliday && clientPricingVersion !== PRICING_VERSION) {
    throw new Error("春節價格已更新，請重新整理預約頁面後再送出");
  }
  if (hasHoliday && !bookingOpen) {
    throw new Error("春節住宿將於 2026/9/27 12:00 起開放預約");
  }
  if (hasHoliday && periods.holidayNights < SEASONAL_CONFIG.minimumHolidayNights) {
    throw new Error(`未滿 ${SEASONAL_CONFIG.minimumHolidayNights} 個春節計價晚的預約，開放時間另行公告`);
  }
  if (isLate && lateCheckoutUnavailable) {
    throw new Error("2027/2/9 起才提供 15:00 後退宿");
  }

  const regularNightlyRate = roomSelection.baseRoomFeePerNight + extraCatFeePerNight;
  const holidayBaseRoomFeePerNight = roomSelection.rooms.reduce(
    (total, room) => total
      + room.count * (SEASONAL_CONFIG.holidayBaseRates[room.roomKey] || room.baseRate),
    0
  );
  const holidayNightlyRate = holidayBaseRoomFeePerNight + extraCatFeePerNight;
  const regularSubtotal = regularNightlyRate * periods.regularNights;
  const holidaySubtotal = holidayNightlyRate * periods.holidayNights;
  const staySubtotal = regularSubtotal + holidaySubtotal;
  const requiresManualQuote = nights >= 30;
  const eligibleDiscountNights = hasHoliday ? periods.regularNights : nights;
  const discountMultiplier = requiresManualQuote
    ? 1
    : eligibleDiscountNights >= 14
      ? 0.9
      : eligibleDiscountNights >= 7
        ? 0.95
        : 1;
  const discountName = requiresManualQuote
    ? "長住專案（待專屬報價）"
    : eligibleDiscountNights >= 14
      ? "9 折"
      : eligibleDiscountNights >= 7
        ? "95 折"
        : "無折扣";
  const regularAfterDiscount = Math.round(regularSubtotal * discountMultiplier);
  const discountedStaySubtotal = regularAfterDiscount + holidaySubtotal;
  const discountAmount = staySubtotal - discountedStaySubtotal;
  const daycareNightlyRate = checkoutDuringHoliday
    ? holidayNightlyRate
    : regularNightlyRate;
  const daycareFee = isLate ? daycareNightlyRate * DAYCARE_RATE : 0;
  const depositAmount = hasHoliday
    ? requiresManualQuote
      ? null
      : Math.round(discountedStaySubtotal * SEASONAL_CONFIG.depositRate)
    : REGULAR_DEPOSIT;
  const nightlyRate = hasHoliday && !periods.regularNights
    ? holidayNightlyRate
    : regularNightlyRate;

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
    pricingVersion: PRICING_VERSION,
    seasonKey: hasHoliday || checkoutDuringHoliday ? SEASONAL_CONFIG.key : "",
    seasonLabel: hasHoliday || checkoutDuringHoliday ? SEASONAL_CONFIG.label : "",
    hasHoliday,
    checkoutDuringHoliday,
    lateCheckoutUnavailable,
    bookingOpen,
    regularNights: periods.regularNights,
    holidayNights: periods.holidayNights,
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
    regularNightlyRate,
    holidayNightlyRate,
    regularSubtotal,
    holidaySubtotal,
    regularAfterDiscount,
    nightlyRate,
    staySubtotal,
    discountName,
    requiresManualQuote,
    discountAmount,
    discountedStaySubtotal,
    daycareNightlyRate,
    daycareFee,
    depositAmount,
    depositDueDays: hasHoliday ? SEASONAL_CONFIG.depositDueDays : 7,
    total: discountedStaySubtotal + daycareFee + mealSubtotal,
  };
}

function splitSeasonNights_(checkIn, checkOut) {
  const start = dateNumber_(checkIn);
  const end = dateNumber_(checkOut);
  const firstHolidayNight = dateNumber_(SEASONAL_CONFIG.start);
  const lastHolidayNight = dateNumber_(SEASONAL_CONFIG.lastNight);
  const nights = end - start;
  const holidayNights = Math.max(
    0,
    Math.min(end, lastHolidayNight + 1) - Math.max(start, firstHolidayNight)
  );
  return {
    nights,
    holidayNights,
    regularNights: nights - holidayNights,
  };
}

function dateNumber_(isoDate) {
  return Date.parse(`${isoDate}T00:00:00Z`) / 86400000;
}

function normalizeCat_(cat, index) {
  if (!cat || typeof cat !== "object" || Array.isArray(cat)) {
    throw new Error(`第 ${index} 隻貓咪資料不完整`);
  }
  return {
    name: requiredSingleLineText_(cat.name, `第 ${index} 隻貓咪姓名`, 40),
    sex: requiredOption_(
      cat.sex,
      `第 ${index} 隻貓咪性別`,
      CAT_SEX_OPTIONS
    ),
    age: requiredSingleLineText_(cat.age, `第 ${index} 隻貓咪年齡`, 30),
    neutered: requiredOption_(
      cat.neutered,
      `第 ${index} 隻貓咪結紮狀態`,
      CAT_NEUTERED_OPTIONS
    ),
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
  const timestamp = Date.parse(`${text}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(text)
    || Number.isNaN(timestamp)
    || new Date(timestamp).toISOString().slice(0, 10) !== text
  ) {
    throw new Error(`${label}格式不正確`);
  }
  return text;
}

function requiredTime_(value, label) {
  const text = requiredText_(value, label, 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) throw new Error(`${label}格式不正確`);
  return text;
}

function validateBookingTimes_(arrivalTime, departureTime, isLate, checkIn) {
  if (arrivalTime < EARLIEST_ARRIVAL_TIME) {
    throw new Error(`入住時間不可早於 ${EARLIEST_ARRIVAL_TIME}`);
  }
  if (
    checkIn === LUNAR_NEW_YEARS_EVE
    && arrivalTime > LUNAR_NEW_YEARS_EVE_LATEST_ARRIVAL_TIME
  ) {
    throw new Error(
      `除夕入住時間不可晚於 ${LUNAR_NEW_YEARS_EVE_LATEST_ARRIVAL_TIME}`
    );
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

function requiredSingleLineText_(value, label, maxLength) {
  const text = requiredText_(value, label, maxLength);
  if (/[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/.test(text)) {
    throw new Error(`${label}格式不正確`);
  }
  return text;
}

function optionalSingleLineText_(value, label, maxLength) {
  const text = optionalText_(value, maxLength);
  if (/[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/.test(text)) {
    throw new Error(`${label}格式不正確`);
  }
  return text;
}

function requiredReservationId_(value) {
  const reservationId = requiredSingleLineText_(value, "預約編號", 60);
  if (!RESERVATION_ID_PATTERN.test(reservationId)) {
    throw new Error("頁面版本已更新，請重新整理後再送出");
  }
  return reservationId;
}

function requiredPhone_(value, label) {
  const phone = requiredSingleLineText_(value, label, 20);
  if (!PHONE_PATTERN.test(phone)) throw new Error(`${label}格式不正確`);
  return phone;
}

function optionalPhone_(value, label) {
  const phone = optionalSingleLineText_(value, label, 20);
  if (phone && !PHONE_PATTERN.test(phone)) throw new Error(`${label}格式不正確`);
  return phone;
}

function requiredOption_(value, label, allowedValues) {
  const text = requiredSingleLineText_(value, label, 40);
  if (!allowedValues.includes(text)) throw new Error(`${label}不正確`);
  return text;
}

function optionalText_(value, maxLength) {
  const text = String(value == null ? "" : value).trim();
  return text.slice(0, maxLength);
}

function safeText_(value) {
  const text = String(value == null ? "" : value);
  return /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
}

function jsonResponse_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
