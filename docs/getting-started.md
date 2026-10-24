# Getting started

Dial runs on your own computer first, without any provider account. Open a terminal (on a Mac, Terminal in Applications → Utilities; on Windows, your WSL2 distribution), copy this line into it and press Enter:

```bash
curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-dial
```

Git is required; rer brings Node and pnpm. Already have Node 22 or later? `npx -y @runeditrun/rer dev just-every/run-dial` does the same.

The line installs `rer`, the Run Edit Run command, clones Dial into a `run-dial` folder, installs everything and prepares a local owner. When it is ready it prints `RER_READY` and `RER_OPEN`: open the `RER_OPEN` address on the same computer to start signed in at the local `/setup` workspace. It carries this copy's development key, so keep it private. This free copy runs only on your computer: it sends no email, and nobody else can open it.

If the installer prints a line that puts `rer` on your PATH, run that line too. To start Dial again later, run the same line from the same folder, or `cd run-dial && rer dev`. `rer dev --stop` stops it.

Next: [Install](install.md) covers a chosen owner address, the tagged release and deploying Dial to your own Cloudflare account.
