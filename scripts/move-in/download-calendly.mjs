import { download } from './download.mjs';
async function hiddenToken() {
  if (!process.stdin.isTTY) throw new Error('Set CALENDLY_TOKEN or use an interactive terminal.');
  process.stderr.write('Personal access token (hidden): ');
  process.stdin.setRawMode(true);process.stdin.resume();
  return new Promise((resolve,reject)=>{
    let value='';
    const cleanup=()=>{process.stdin.setRawMode(false);process.stdin.pause();process.stdin.off('data',read);process.stderr.write('\n');};
    function read(chunk) {for(const char of chunk.toString()) {
      if(char==='\u0003'){cleanup();reject(new Error('Cancelled.'));return;}
      if(char==='\r'||char==='\n'){cleanup();resolve(value);return;}
      if(char==='\u007f')value=value.slice(0,-1);else if(char>=' ')value+=char;
    }}
    process.stdin.on('data',read);
  });
}
try {
  const args=process.argv.slice(2);
  if(args.length!==2 || args[0]!=='--out' || !args[1] || args[1].startsWith('--'))throw new Error('Usage: pnpm move-in:download-calendly --out <new folder>');
  console.log(await download({out:args[1],token:process.env.CALENDLY_TOKEN || await hiddenToken()}));
} catch(error) {console.error(error.message);process.exitCode=1;}
