/** The open licences a face's own licence field can name. */
export type OpenLicence = "OFL" | "Apache-2.0";

const OFL = /SIL Open Font Licen[cs]e|Open Font Licen[cs]e|\bOFL\b|scripts\.sil\.org\/OFL|openfontlicense\.org/i;
const APACHE = /Apache Licen[cs]e|apache\.org\/licenses\/LICENSE-2\.0/i;

/** Which open licence the face's own licence description or URL names, or null when it names neither. */
export function openLicence(...fields: (string | null)[]): OpenLicence | null {
  const text = fields.filter(Boolean).join(" ");
  if (OFL.test(text)) return "OFL";
  if (APACHE.test(text)) return "Apache-2.0";
  return null;
}
