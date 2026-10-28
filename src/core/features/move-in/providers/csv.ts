/** RFC 4180 records, including quoted commas, escaped quotes and newlines. */
export function csvRecords(text:string):Record<string,string>[] {
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false,closed=false;
 const field=()=>{row.push(cell);cell='';closed=false;};
 const record=()=>{field();if(row.some(value=>value.length))rows.push(row);row=[];};
 for(let i=0;i<text.length;i++){
  const char=text[i];
  if(quoted){if(char==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=char;continue;}
  if(char==='"'){if(cell||closed)throw new Error('CSV has a misplaced quote.');quoted=true;}
  else if(char===',')field();
  else if(char==='\n'||char==='\r'){if(char==='\r'&&text[i+1]==='\n')i++;record();}
  else{if(closed)throw new Error('CSV has text after a closing quote.');cell+=char;}
 }
 if(quoted)throw new Error('CSV has an unclosed quote.');
 if(cell||row.length||closed)record();
 const headers=rows.shift();if(!headers?.length||headers.some(h=>!h||h.length>100)||new Set(headers).size!==headers.length)throw new Error('CSV needs distinct, nonempty column names.');
 return rows.map((values,index)=>{if(values.length!==headers.length)throw new Error(`CSV row ${index+2} has the wrong number of columns.`);return Object.fromEntries(headers.map((key,i)=>[key,values[i]]));});
}
