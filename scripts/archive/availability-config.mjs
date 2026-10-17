const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
export function validateAvailabilityConfig(name, row) {
  if (name === 'availability_schedules') {
    const windows = JSON.parse(row.windows_json), reopened = JSON.parse(row.reopened_holidays_json), off = JSON.parse(row.time_off_json);
    if (typeof row.name !== 'string' || !row.name.trim() || row.name.length > 120 || ![0, 1].includes(row.block_us_holidays) || !Array.isArray(windows) || windows.length > 1000 || windows.some(w => !w || !Number.isInteger(w.weekday) || w.weekday < 0 || w.weekday > 6 || !Number.isInteger(w.startMinute) || !Number.isInteger(w.endMinute) || w.startMinute < 0 || w.endMinute > 1440 || w.startMinute >= w.endMinute)) throw new Error('archive-invalid-availability-schedule');
    for (let day = 0; day < 7; day++) {
      const ordered = windows.filter(w => w.weekday === day).sort((a, b) => a.startMinute - b.startMinute);
      if (ordered.some((w, i) => i > 0 && ordered[i - 1].endMinute > w.startMinute)) throw new Error('archive-overlapping-schedule');
    }
    if (!Array.isArray(reopened) || reopened.length > 1000 || reopened.some(value => !date(value)) || !Array.isArray(off) || off.length > 100 || off.some(range => !range || !date(range.startDate) || !date(range.endDate) || range.startDate > range.endDate)) throw new Error('archive-invalid-schedule-closures');
  }
  if (name === 'booking_limit_policies') {
    const limits = JSON.parse(row.limits_json), keys = ['dayCount', 'weekCount', 'monthCount', 'dayMinutes', 'weekMinutes', 'monthMinutes', 'inviteeGapMinutes'];
    if (!limits || typeof limits !== 'object' || JSON.stringify(Object.keys(limits).sort()) !== JSON.stringify([...keys].sort()) || keys.some(key => !(key !== 'inviteeGapMinutes' && limits[key] === null) && (!Number.isSafeInteger(limits[key]) || limits[key] < 0)) || !(row.scope === 'host' || typeof row.scope === 'string' && row.scope.length === 26)) throw new Error('archive-invalid-booking-limits');
  }
}

export function validateAvailabilityReferences(db) {
  if (db.prepare("SELECT scope FROM booking_limit_policies WHERE scope<>'host' AND NOT EXISTS (SELECT 1 FROM event_types WHERE id=scope)").get()) throw new Error('archive-orphaned-booking-limits');
  const order = windows => windows.map(({ weekday, startMinute, endMinute }) => [weekday, startMinute, endMinute]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const binding of db.prepare('SELECT b.event_type_id,s.windows_json FROM event_schedule_bindings b JOIN availability_schedules s ON s.id=b.schedule_id').all()) {
    const stored = db.prepare('SELECT weekday,start_minute AS startMinute,end_minute AS endMinute FROM recurring_availability_windows WHERE event_type_id=?').all(binding.event_type_id);
    if (JSON.stringify(order(stored)) !== JSON.stringify(order(JSON.parse(binding.windows_json)))) throw new Error('archive-inconsistent-schedule-binding');
  }
}
