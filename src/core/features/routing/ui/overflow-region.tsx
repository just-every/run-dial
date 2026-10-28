import {useEffect,useRef,useState,type ReactNode} from 'react';

/** A table enters the tab order only while its viewport needs keyboard scrolling. */
export function OverflowRegion({children,label}:{children:ReactNode;label:string}) {
 const element=useRef<HTMLDivElement>(null),[scrollable,setScrollable]=useState(false);
 useEffect(()=>{
  const viewport=element.current;if(!viewport)return;
  const update=()=>setScrollable(viewport.scrollWidth>viewport.clientWidth);
  const observer=new ResizeObserver(update);
  observer.observe(viewport);
  if(viewport.firstElementChild)observer.observe(viewport.firstElementChild);
  update();return()=>observer.disconnect();
 },[]);
 return <div ref={element} className="overflow-x-auto" role="region" aria-label={label} tabIndex={scrollable?0:undefined}>{children}</div>;
}
