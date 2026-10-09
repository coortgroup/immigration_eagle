import { spawnSync } from 'node:child_process';
const base=(process.env.PAGES_BASE_PATH || '/immigration_eagle').replace(/\/$/,'');
const result=spawnSync(process.execPath,['node_modules/expo/bin/cli','export','--platform','web','--output-dir','dist-web'],{stdio:'inherit',env:{...process.env,EXPO_BASE_URL:`${base}/app`}});
process.exit(result.status ?? 1);
