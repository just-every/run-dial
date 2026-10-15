import type { PickerAvailability } from "./day-picker-model";

type RankedSlot = Extract<PickerAvailability, { state: "available" }>["rankedSlots"][number];

/** Rank only verified offers; the device zone stays in the browser on arrival. */
export function inviteeRecommendations(slots: RankedSlot[], inviteeZone: string, hostZone: string) {
  const formatters = [...new Set([inviteeZone, hostZone])].map(timeZone => new Intl.DateTimeFormat("en-US", {
    timeZone, hour: "numeric", minute: "numeric", hourCycle: "h23",
  }));
  const inWorkingDay = (slot: RankedSlot) => formatters.every(formatter => {
    // Check the entire interval, including any clock transition inside it.
    for (let instant = Date.parse(slot.startAt); instant < Date.parse(slot.endAt); instant += 60_000) {
      const hour = Number(formatter.formatToParts(instant).find(part => part.type === "hour")?.value);
      if (hour < 9 || hour >= 17) return false;
    }
    return true;
  });
  return slots.map(slot => ({ slot, working: inWorkingDay(slot) }))
    .sort((a, b) => Number(b.working) - Number(a.working) || a.slot.freeTimeRank - b.slot.freeTimeRank)
    .slice(0, 5).map(({ slot, working }) => ({ ...slot, reason: working ? "Inside both working days" : slot.hasFreeTime ? "More uninterrupted free time" : "Earliest available time" }));
}
