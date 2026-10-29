// Disposable local SQLite/R2 adapter only. No credentials, LINE or remote writes.
import {spawnSync} from 'node:child_process';
const result=spawnSync(process.execPath,['--test','tests/media-packaging.test.mjs','tests/media-packaging-flow.test.mjs','tests/media-ui.test.mjs','tests/media-review.test.mjs'],{stdio:'inherit'});
process.exitCode=result.status??1;
