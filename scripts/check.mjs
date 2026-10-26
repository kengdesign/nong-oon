import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
for (const dir of ['src','public','scripts']) {
  for (const file of readdirSync(dir).filter(f=>f.endsWith('.mjs'))) {
    const result=spawnSync(process.execPath,['--check',join(dir,file)],{stdio:'inherit'});
    if(result.status!==0) process.exit(result.status??1);
  }
}
