#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { captureScheduler } from '../../src/core/features/move-in/providers/api-download.ts';

const args = process.argv.slice(2);
try {
 if (args.length !== 4 || args[0] !== '--provider' || !['calcom', 'savvycal'].includes(args[1]) || args[2] !== '--output' || !args[3]) throw new Error('Usage: node --experimental-strip-types ./scripts/move-in/download-scheduler.mjs --provider calcom --output ./exports/scheduler-capture');
 const provider = args[1];
 const tokenName = provider === 'calcom' ? 'CALCOM_TOKEN' : 'SAVVYCAL_TOKEN';
 const token = process.env[tokenName];
 if (!token) throw new Error(`Set ${tokenName} in your environment before running the capture.`);
 const capture = await captureScheduler(provider, token);
 const directory = resolve(args[3]);
 await mkdir(directory, { recursive: true, mode: 0o700 });
 const filename = join(directory, `${provider}-capture-${new Date().toISOString().replace(/[:.]/gu, '-')}.json`);
 await writeFile(filename, JSON.stringify(capture), { flag: 'wx', mode: 0o600 });
 process.stdout.write('Scheduler capture saved in the chosen directory. Upload its JSON file in Move in.\n');
} catch (error) {
 // Only errors authored by this command or its capture helper are safe to display.
 const message = error instanceof Error && !('code' in error) ? error.message : 'Capture could not be saved. Check the output directory and try again.';
 process.stderr.write(`${message}\n`); process.exitCode = 1;
}
