import http from 'node:http';
import { readFile,stat } from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('site'),port=Number(process.env.PORT||4176),base=(process.env.PAGES_BASE_PATH??'/immigration_eagle').replace(/\/$/,'');
const types={'.html':'text/html','.css':'text/css','.js':'application/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ttf':'font/ttf','.woff2':'font/woff2','.ico':'image/x-icon'};
http.createServer(async(req,res)=>{
 try {
  let pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(pathname===base){res.writeHead(302,{Location:base+'/'});res.end();return;}
  if(pathname.startsWith(base+'/'))pathname=pathname.slice(base.length);
  let filename=path.resolve(root,'.'+pathname);
  if(filename!==root&&!filename.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  if((await stat(filename)).isDirectory())filename=path.join(filename,'index.html');
  const body=await readFile(filename);res.writeHead(200,{'Content-Type':types[path.extname(filename)]||'application/octet-stream'});res.end(body);
 } catch {res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log(`Local website: http://127.0.0.1:${port}${base}/`));
