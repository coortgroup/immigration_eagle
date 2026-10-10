import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
// GitHub Pages returns an empty base path when a custom domain serves the root.
const base=(process.env.PAGES_BASE_PATH ?? '/immigration_eagle').replace(/\/$/,'');
const result=spawnSync(process.execPath,['node_modules/expo/bin/cli','export','--platform','web','--output-dir','dist-web'],{stdio:'inherit',env:{...process.env,EXPO_BASE_URL:`${base}/app`}});
if (result.error || result.signal || result.status !== 0 || !existsSync('dist-web/index.html')) {
  console.error('Web export did not produce a complete app. The website build has been stopped.');
  process.exit(result.status || 1);
}
