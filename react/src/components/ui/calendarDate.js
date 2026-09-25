/** A calendar date is not an instant. Never pass it through Date/timezone conversion. */
export function parseCalendarDate(value) {
  if (
    typeof value !== "string" ||
    value.length !== 10 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  )
    return null;
  const [year, month, day] = value.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const limit =
    [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ??
    0;
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= limit
    ? { year, month, day }
    : null;
}
export function formatCalendarDate(value) {
  const date = parseCalendarDate(value);
  if (!date) return "";
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return `${months[date.month - 1]} ${date.day}, ${String(date.year).padStart(4, "0")}`;
}
