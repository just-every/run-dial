import { createFileRoute } from "@tanstack/react-router";
import { ParticipantPage } from "../core/features/polls/client";
export const Route=createFileRoute('/poll/$id')({validateSearch:(search:Record<string,unknown>)=>({token:typeof search.token==='string'?search.token:''}),component:PollRoute});
function PollRoute(){const {id}=Route.useParams();const {token}=Route.useSearch();return <ParticipantPage id={id} token={token}/>;}
