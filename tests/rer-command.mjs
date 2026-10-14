import { fileURLToPath } from 'node:url';

// Resolve the installed public launcher in the test checkout so it can install
// and dispatch the pin in fresh journey checkouts that have no dependencies yet.
export const rerEntry = fileURLToPath(import.meta.resolve('@runeditrun/rer/internal/global/rer.mjs'));
export const rerArguments = args => args[1] === 'dev' && !args.some(arg => ['--foreground', '--detach', '--stop', '--help'].includes(arg))
 ? [...args, '--foreground'] : args;
