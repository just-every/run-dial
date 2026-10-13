import { Burst } from "../../../../shared/drawing/Burst";
import { Icon } from "../../../../shared/drawing/icons";

/**
 * The alternative-request drawing: an invitee's request with the windows that would suit them and a note, then the booking the
 * host made from it, which reaches the invitee as an ordinary confirmation.
 */
export function RequestScene() {
  return <div className="scene request-scene" aria-hidden="true">
    <span className="request-sun" />
    <div className="paper-card request-card">
      <div className="request-head"><span className="request-avatar">TK</span><p><b>Taylor Kim</b><small>Request another time</small></p></div>
      <p className="picker-label">Preferred windows</p>
      <ul className="request-windows">
        <li><b>Mon, Oct 19</b>9:00 – 11:00 AM</li>
        <li><b>Tue, Oct 20</b>2:00 – 4:00 PM</li>
        <li><b>Wed, Oct 21</b>10:00 AM – 12:00 PM</li>
      </ul>
      <p className="request-note">“Mornings suit me best.”</p>
    </div>
    <div className="booked-card">
      <span className="booked-check"><Icon name="check" /></span>
      <p><b>Booked: Mon, Oct 19, 9:30 AM</b><small>Taylor gets the usual confirmation</small></p>
      <svg className="booked-burst" viewBox="0 0 80 80" focusable="false"><Burst cx={8} cy={72} radius={16} length={26} degrees={35} spread={24} /></svg>
    </div>
  </div>;
}
