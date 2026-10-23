import { useEffect, useState } from "react";
import type { BookingRecord } from "../types";
import { bookingListQuery, bookingPageSize, type BookingFilters } from "./booking-filters";
import { errorMessage } from "../../../api/client";
/** Calendar and list use the same filtered public operator door, including its pagination. */
export function useCalendarBookings(filters: BookingFilters, revision: number) {
  const query = new URLSearchParams(bookingListQuery(filters)).toString();
  const key=query+":"+revision;
  const [state, setState] = useState<{key:string;records?:BookingRecord[];error?:string}>({key:""});
  useEffect(() => { const abort = new AbortController();
    void (async () => { const records: BookingRecord[] = []; let page=1, total=Infinity;
      while (records.length < total) { const response=await fetch('/api/app/bookings?'+new URLSearchParams({...Object.fromEntries(new URLSearchParams(query)),offset:String((page-1)*bookingPageSize)}),{signal:abort.signal});
        if (!response.ok) throw new Error(await errorMessage(response));
        const batch=await response.json() as BookingRecord[], count=Number(response.headers.get('X-Total-Count'));
        if (!Number.isSafeInteger(count) || count<0 || (Number.isFinite(total)&&count!==total) || batch.some(b=>records.some(r=>r.id===b.id))) throw new Error('Bookings changed while loading. Refresh to load the calendar again.');
        total=count;records.push(...batch);
        if (!batch.length && records.length<total) throw new Error('The calendar changed while loading. Refresh to load it again.'); page++;
      }
      if (!abort.signal.aborted) setState({key,records});
    })().catch(error=>{if(!abort.signal.aborted)setState({key,error:error instanceof Error?error.message:'Calendar could not be loaded.'});});
    return ()=>abort.abort();
  },[query,revision,key]);
  return state.key===key?state:{key};
}
