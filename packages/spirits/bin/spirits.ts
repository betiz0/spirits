/**
 * Entry point of the launcher.
 *
 * `bootstrap.ts` classifies the arguments and starts the verified managed host, so this file imports
 * no host code and the compiled binary carries no Pi sources. The host and the spirits extension
 * bundle come from the managed set on disk.
 */

import { runLauncher } from "./bootstrap.ts";

process.exit(await runLauncher());
