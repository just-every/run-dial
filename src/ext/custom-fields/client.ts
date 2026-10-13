import { api, errorMessage } from "../../core/api/extensions";
export const fieldsApi = api.api.app["custom-fields"];
export async function readResponse<T>(response: {ok:boolean;json():Promise<unknown>}): Promise<T> {
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json() as Promise<T>;
}
