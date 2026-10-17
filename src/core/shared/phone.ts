import { parsePhoneNumberFromString } from "libphonenumber-js/min";

/** US national numbers and explicit international numbers share one stored E.164 form. */
export function normalizePhoneNumber(value: string): string | undefined {
  const phone = parsePhoneNumberFromString(value.trim(), { defaultCountry: "US", extract: false });
  return phone?.isValid() && !phone.ext ? phone.number : undefined;
}
