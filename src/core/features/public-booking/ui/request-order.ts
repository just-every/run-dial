/** A request is current only until a newer read or route invalidation starts. */
export class RequestOrder {
  private revision = 0;
  begin() { const revision = ++this.revision; return () => revision === this.revision; }
  invalidate() { this.revision += 1; }
}
