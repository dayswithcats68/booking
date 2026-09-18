(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SeasonalPricing = api;
})(typeof window === "object" ? window : this, function () {
  "use strict";

  const DAY = 86400000;
  const DEFAULT_SEASON = Object.freeze({
    key: "cny-2027",
    label: "2027 春節",
    pricingVersion: "cny-2027-v1",
    start: "2027-02-03",
    lastNight: "2027-02-11",
    holidayBaseRates: Object.freeze({ small: 1300, jump: 1650, family: 1950 }),
    extraCatRate: 200,
    minimumHolidayNights: 5,
    depositRate: 0.5,
    depositDueDays: 3,
  });

  function dayNumber(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) throw new Error("請填寫有效日期。");
    const stamp = Date.parse(`${value}T00:00:00Z`);
    if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== value) {
      throw new Error("請填寫有效日期。");
    }
    return stamp / DAY;
  }

  function splitNights(checkIn, checkOut, season = DEFAULT_SEASON) {
    const start = dayNumber(checkIn);
    const end = dayNumber(checkOut);
    const first = dayNumber(season.start);
    const last = dayNumber(season.lastNight);
    if (last < first) throw new Error("春節最後計價夜不可早於起日。");
    const nights = end - start;
    if (nights < 1 || nights > 365) throw new Error("住宿須介於 1 至 365 晚。");
    const holidayNights = Math.max(0, Math.min(end, last + 1) - Math.max(start, first));
    return { nights, holidayNights, regularNights: nights - holidayNights };
  }

  function apply(quote, season = DEFAULT_SEASON) {
    const periods = splitNights(quote.checkIn, quote.checkOut, season);
    const holidayBaseRate = quote.rooms.reduce(
      (sum, room) => sum
        + room.count * (season.holidayBaseRates[room.roomKey] ?? room.baseRate),
      0,
    );
    const extraCatFeePerNight = Math.max(0, quote.cats - quote.roomCount) * season.extraCatRate;
    const regularNightlyRate = quote.baseRoomFeePerNight + extraCatFeePerNight;
    const holidayNightlyRate = holidayBaseRate + extraCatFeePerNight;
    const regularSubtotal = regularNightlyRate * periods.regularNights;
    const holidaySubtotal = holidayNightlyRate * periods.holidayNights;
    const hasHoliday = periods.holidayNights > 0;
    const checkoutDuringHoliday = quote.checkOut >= season.start && quote.checkOut <= season.lastNight;
    const lateCheckoutUnavailable = hasHoliday || checkoutDuringHoliday;
    const requiresManualQuote = periods.nights >= 30;
    const eligibleNights = hasHoliday ? periods.regularNights : periods.nights;
    const discountMultiplier = requiresManualQuote
      ? 1
      : eligibleNights >= 14
        ? 0.9
        : eligibleNights >= 7
          ? 0.95
          : 1;
    const regularAfterDiscount = Math.round(regularSubtotal * discountMultiplier);
    const discountAmount = regularSubtotal - regularAfterDiscount;
    const discountedStaySubtotal = regularAfterDiscount + holidaySubtotal;
    const daycareFee = quote.isLate && !lateCheckoutUnavailable ? regularNightlyRate * 0.5 : 0;
    const discountName = requiresManualQuote
      ? "長住專案（待專屬報價）"
      : discountMultiplier === 0.9
        ? "9 折"
        : discountMultiplier === 0.95
          ? "95 折"
          : "無折扣";

    return {
      ...quote,
      ...periods,
      pricingVersion: season.pricingVersion,
      seasonKey: hasHoliday || checkoutDuringHoliday ? season.key : "",
      seasonLabel: hasHoliday || checkoutDuringHoliday ? season.label : "",
      hasHoliday,
      checkoutDuringHoliday,
      lateCheckoutUnavailable,
      meetsMinimumStay: !hasHoliday || periods.holidayNights >= season.minimumHolidayNights,
      regularNightlyRate,
      holidayNightlyRate,
      regularSubtotal,
      holidaySubtotal,
      regularAfterDiscount,
      nightlyRate: hasHoliday && !periods.regularNights ? holidayNightlyRate : regularNightlyRate,
      staySubtotal: regularSubtotal + holidaySubtotal,
      discountRate: 1 - discountMultiplier,
      discountMultiplier,
      discountAmount,
      discountName,
      discountDescription: hasHoliday
        ? `平日 ${periods.regularNights} 晚${discountAmount ? `・${discountName}` : "・無折扣"}；春節不折扣`
        : `${eligibleNights} 晚・${discountName}`,
      discountedStaySubtotal,
      requiresManualQuote,
      daycareFee,
      depositAmount: hasHoliday && !requiresManualQuote
        ? Math.round(discountedStaySubtotal * season.depositRate)
        : hasHoliday
          ? null
          : 500,
      depositDueDays: hasHoliday ? season.depositDueDays : 7,
      isLate: quote.isLate && !lateCheckoutUnavailable,
      total: discountedStaySubtotal + daycareFee + quote.mealSubtotal,
    };
  }

  return Object.freeze({ DEFAULT_SEASON, splitNights, apply });
});
