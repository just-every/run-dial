type Holiday = { date: string; name: string };

function utcDate(year: number, month: number, day: number): Date {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

function nthWeekday(year: number, month: number, weekday: number, occurrence: number): Date {
  const first = utcDate(year, month, 1);
  return utcDate(year, month, 1 + (weekday - first.getUTCDay() + 7) % 7 + (occurrence - 1) * 7);
}

/**
 * Current nationwide federal holiday rules, applied to the requested calendar year.
 * Includes actual dates and separate observed dates, restricted to that year;
 * December 31 can therefore observe the following year's New Year's Day.
 * Historical rule changes, local holidays and one-off closures are not included.
 * Rules: https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/
 */
export function usFederalHolidays(year: number): Holiday[] {
  if (!Number.isInteger(year) || year < 1 || year > 9999) {
    throw new RangeError("Holiday year must be an integer from 1 to 9999");
  }

  const holidays: Holiday[] = [];
  const add = (date: Date, name: string) => {
    if (date.getUTCFullYear() === year) {
      holidays.push({ date: date.toISOString().slice(0, 10), name });
    }
  };
  const fixed = (holidayYear: number, month: number, day: number, name: string) => {
    const date = utcDate(holidayYear, month, day);
    add(date, name);
    const weekday = date.getUTCDay();
    if (weekday === 6 || weekday === 0) {
      date.setUTCDate(date.getUTCDate() + (weekday === 6 ? -1 : 1));
      add(date, `${name} (observed)`);
    }
  };

  fixed(year, 1, 1, "New Year's Day");
  add(nthWeekday(year, 1, 1, 3), "Birthday of Martin Luther King, Jr.");
  add(nthWeekday(year, 2, 1, 3), "Washington's Birthday");
  const memorialDay = utcDate(year, 5, 31);
  memorialDay.setUTCDate(31 - (memorialDay.getUTCDay() + 6) % 7);
  add(memorialDay, "Memorial Day");
  fixed(year, 6, 19, "Juneteenth National Independence Day");
  fixed(year, 7, 4, "Independence Day");
  add(nthWeekday(year, 9, 1, 1), "Labor Day");
  add(nthWeekday(year, 10, 1, 2), "Columbus Day");
  fixed(year, 11, 11, "Veterans Day");
  add(nthWeekday(year, 11, 4, 4), "Thanksgiving Day");
  fixed(year, 12, 25, "Christmas Day");
  fixed(year + 1, 1, 1, "New Year's Day");

  return holidays.sort((a, b) => a.date.localeCompare(b.date));
}
