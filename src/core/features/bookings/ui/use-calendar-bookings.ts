import { useEffect, useState } from "react";
import type { BookingRecord } from "../types";
import { bookingListQuery, bookingPageSize, type BookingFilters } from "./booking-filters";
import { errorMessage } from "../../../api/client";
import { workspaceFetch } from "../../../app/workspace-reads";
/** Calendar and list use the same filtered public operator door, including its pagination. A reload keeps the range on screen. */
export function useCalendarBookings(filters: BookingFilters, revision: number) {
  const query = new URLSearchParams(bookingListQuery(filters)).toString();
  const key=query+":"+revision;
  const [state, setState] = useState<{key:string;query?:string;records?:BookingRecord[];error?:string}>({key:""});
  useEffect(() => { const abort = new AbortController();
    void (async () => { const records: BookingRecord[] = []; let page=1, total=Infinity;
      while (records.length < total) { const response=await workspaceFetch('/api/app/bookings?'+new URLSearchParams({...Object.fromEntries(new URLSearchParams(query)),offset:String((page-1)*bookingPageSize)}),{signal:abort.signal});
        if (!response.ok) throw new Error(await errorMessage(response));
        const batch=await response.json() as BookingRecord[], count=Number(response.headers.get('X-Total-Count'));
        if (!Number.isSafeInteger(count) || count<0 || (Number.isFinite(total)&&count!==total) || batch.some(b=>records.some(r=>r.id===b.id))) throw new Error('Bookings changed while loading. Refresh to load the calendar again.');
        total=count;records.push(...batch);
        if (!batch.length && records.length<total) throw new Error('The calendar changed while loading. Refresh to load it again.'); page++;
      }
      if (!abort.signal.aborted) setState({key,query,records});
    })().catch(error=>{if(!abort.signal.aborted)setState({key,query,error:error instanceof Error?error.message:'Calendar could not be loaded.'});});
    return ()=>abort.abort();
  },[query,revision,key]);
  // The same range reloading after a change keeps its days drawn, so a booking beside it never loses its index (U9).
  return state.key===key?state:state.query===query&&state.records?{key,records:state.records}:{key};
}
