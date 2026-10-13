import { MiniDial } from "../../../../shared/drawing/MiniDial";

/** The closing drawing: the dial once more, settled on its golden time, resting on a soft shadow. */
export function ClosingArt() {
  return <div className="closing-art" aria-hidden="true">
    <MiniDial chosen={1} className="closing-dial" />
    <div className="closing-chip"><span className="card-dot-html" /><b>10:00 AM</b><small>Booked</small></div>
  </div>;
}
