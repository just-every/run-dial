// The public-door DST journey targets the next real year. Freeze only this
// isolated fixture runtime at its January 1: even in October the next November
// otherwise lies beyond the product's maximum 365-day availability lookahead.
const RealDate = Date;
const january = RealDate.UTC(new RealDate().getUTCFullYear() + 1, 0, 1);
globalThis.Date = new Proxy(RealDate, {
  construct(target, args) { return Reflect.construct(target, args.length ? args : [january]); },
  apply() { return new RealDate(january).toString(); },
  get(target, property, receiver) {
    return property === "now" ? () => january : Reflect.get(target, property, receiver);
  },
});
export { default, BookingCoordinator } from "../review/worker";
