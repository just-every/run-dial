import { Link } from "@tanstack/react-router";
import { Card } from "../../../app/ui/primitives";
import type { ReportTile, SchedulingReport } from "../../reports/client";
import { drillSearch, formatFigure } from "./report-format";

/** One figure with its definition, its breakdown and a drill-through to the bookings it counts. */
export function ReportTileCard({ tile, report }: { tile: ReportTile; report: SchedulingReport }) {
  const drill = (bucket?: string) => drillSearch({ tile: tile.key, bucket, fromDate: report.period.fromDate, throughDate: report.period.throughDate, eventTypeId: report.eventTypeId });
  return <Card className="min-w-0 p-5 sm:p-6"><section aria-label={tile.title}>
    <div className="flex flex-wrap items-baseline justify-between gap-3">
      <h2 className="text-[19px] font-[750] leading-[1.25] tracking-[-.01em] text-ink">{tile.title}</h2>
      <p className="text-[30px] font-extrabold leading-none tracking-[-.02em] text-ink" data-tile-count={tile.key}>{tile.count.toLocaleString()}</p>
    </div>
    <p className="mt-3 text-sm leading-6 text-soft">{tile.definition}</p>
    {tile.imported ? <p className="mt-2 text-sm font-semibold text-ink">Imported: {tile.imported.toLocaleString()}</p> : null}
    {tile.figures.length ? <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">{tile.figures.map(figure => <div key={figure.key} className="min-w-0"><dt className="text-[13px] font-[650] text-muted">{figure.label}</dt><dd className="mt-1 text-[15px] text-ink" data-figure={`${tile.key}.${figure.key}`}>{formatFigure(figure)}</dd></div>)}</dl> : null}
    {tile.groups.map(group => <div key={group.title} className="mt-4"><h3 className="text-[13px] font-[650] text-muted">{group.title}</h3>
      <ul className="mt-2 divide-y divide-line-soft">{group.rows.map(row => <li key={row.bucket} className="flex items-center justify-between gap-3 py-2 text-[15px] text-ink"><span className="min-w-0 break-words">{row.label}</span>
        <Link to="/app/bookings" search={() => drill(row.bucket)} className="shrink-0 font-semibold underline underline-offset-4" aria-label={`${row.count} ${row.label}: list these bookings`} data-bucket={row.bucket}>{row.count.toLocaleString()}</Link></li>)}</ul></div>)}
    {tile.count ? <p className="mt-4"><Link to="/app/bookings" search={() => drill()} className="text-sm font-semibold underline underline-offset-4">List the {tile.count.toLocaleString()} {tile.count === 1 ? "booking" : "bookings"} counted</Link></p> : null}
  </section></Card>;
}
