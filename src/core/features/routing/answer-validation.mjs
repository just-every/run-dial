import { z } from "zod";
import { parsePhoneNumberFromString } from "libphonenumber-js/min";
const normalizePhoneNumber = value => { const phone = parsePhoneNumberFromString(value.trim(), { defaultCountry: "US", extract: false }); return phone?.isValid() && !phone.ext ? phone.number : undefined; };
const choices = new Set(["single_choice", "multiple_choice", "dropdown"]), numeric = new Set(["number", "company_size"]);
const numberText = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const isNumeric = value => numberText.test(value) && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= Number.MAX_SAFE_INTEGER;
// ISO 3166-1 alpha-2 codes; English display names are also accepted and normalized.
const countries = "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" ");
const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
const countryLookup = new Map(countries.flatMap(code => [[code.toLowerCase(), code], [(countryNames.of(code) ?? code).toLowerCase(), code]]));
countryLookup.set("usa", "US");
countryLookup.set("united states of america", "US");
countryLookup.set("uk", "GB");
const stateNames = "AL:Alabama|AK:Alaska|AZ:Arizona|AR:Arkansas|CA:California|CO:Colorado|CT:Connecticut|DE:Delaware|DC:District of Columbia|FL:Florida|GA:Georgia|HI:Hawaii|ID:Idaho|IL:Illinois|IN:Indiana|IA:Iowa|KS:Kansas|KY:Kentucky|LA:Louisiana|ME:Maine|MD:Maryland|MA:Massachusetts|MI:Michigan|MN:Minnesota|MS:Mississippi|MO:Missouri|MT:Montana|NE:Nebraska|NV:Nevada|NH:New Hampshire|NJ:New Jersey|NM:New Mexico|NY:New York|NC:North Carolina|ND:North Dakota|OH:Ohio|OK:Oklahoma|OR:Oregon|PA:Pennsylvania|RI:Rhode Island|SC:South Carolina|SD:South Dakota|TN:Tennessee|TX:Texas|UT:Utah|VT:Vermont|VA:Virginia|WA:Washington|WV:West Virginia|WI:Wisconsin|WY:Wyoming|AS:American Samoa|GU:Guam|MP:Northern Mariana Islands|PR:Puerto Rico|VI:US Virgin Islands";
const stateLookup = new Map(stateNames.split("|").flatMap(entry => { const [code, name] = entry.split(":"); return [[code.toLowerCase(), code], [name.toLowerCase(), code]]; }));
/** Unknown fields are refused; hidden answers are accepted only for declared questions. */
export function validateRoutingAnswers(questions, input) {
    if (!input || typeof input !== "object" || Array.isArray(input))
        return { ok: false, fields: ["Answers"] };
    const supplied = input;
    const answers = {};
    const fields = [];
    const known = new Set(questions.map(question => question.key));
    if (Object.keys(supplied).some(key => !known.has(key)))
        fields.push("Answers");
    for (const question of questions) {
        const value = Object.hasOwn(supplied, question.key) ? supplied[question.key] : undefined;
        if (value === undefined) {
            if (question.required)
                fields.push(question.label);
            continue;
        }
        if (question.kind === "multiple_choice") {
            if (!Array.isArray(value) || value.length > 100 || value.some(item => typeof item !== "string" || !question.options?.includes(item)) || new Set(value).size !== value.length || (question.required && !value.length)) {
                fields.push(question.label);
                continue;
            }
            answers[question.key] = value;
            continue;
        }
        if (typeof value !== "string" || value.length > 4000) {
            fields.push(question.label);
            continue;
        }
        let normalized = value.trim();
        if (!normalized) {
            if (question.required)
                fields.push(question.label);
            else
                answers[question.key] = "";
            continue;
        }
        if (choices.has(question.kind) && !question.options?.includes(normalized)) {
            fields.push(question.label);
            continue;
        }
        if (numeric.has(question.kind)) {
            if (!isNumeric(normalized) || (question.kind === "company_size" && (!Number.isSafeInteger(Number(normalized)) || Number(normalized) < 0))) {
                fields.push(question.label);
                continue;
            }
            normalized = String(Number(normalized));
        }
        if (question.kind === "email" && !z.email().max(254).safeParse(normalized).success) {
            fields.push(question.label);
            continue;
        }
        if (question.kind === "phone") {
            const phone = normalizePhoneNumber(normalized);
            if (!phone) {
                fields.push(question.label);
                continue;
            }
            normalized = phone;
        }
        if (question.kind === "country" || question.kind === "us_state") {
            const location = (question.kind === "country" ? countryLookup : stateLookup).get(normalized.toLowerCase());
            if (!location) {
                fields.push(question.label);
                continue;
            }
            normalized = location;
        }
        answers[question.key] = normalized;
    }
    return fields.length ? { ok: false, fields: [...new Set(fields)] } : { ok: true, answers };
}
