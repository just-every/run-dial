import { installPublicOrigin } from "../../shared/public-origin";
import { markTypes, publicLookFrom, publicLookStatement, type Palette } from "../site-look";

/** Public workspace brand values resolved before a confirmation's provider bytes are frozen. */
export type MailBrand = { name: string | null; markUrl: string | null; colours: Palette };

export class MailBrandReader {
  private readonly origin: string;

  constructor(private readonly binding: D1Database, appUrl: string) {
    this.origin = installPublicOrigin(appUrl);
  }

  async read(): Promise<MailBrand | undefined> {
    const look = publicLookFrom(await publicLookStatement(this.binding).all());
    if (look.kind === "plain") return undefined;
    return {
      name: look.name,
      // publicLook admits only stored brand keys; never use the source site's mark URL.
      markUrl: look.mark && markTypes.includes(look.mark.contentType) ? new URL(look.mark.url, this.origin).href : null,
      colours: { ...look.colours },
    };
  }
}
