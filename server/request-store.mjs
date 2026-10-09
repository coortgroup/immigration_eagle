import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

/** One server process serializes all writes; a failed write never resets the inbox. */
export function createRequestStore(filename) {
  let pending = Promise.resolve();

  async function read() {
    let content;
    try { content = await readFile(filename, 'utf8'); }
    catch (error) {
      if (error.code === 'ENOENT') return { schemaVersion: 1, requests: [] };
      throw error;
    }
    const data = JSON.parse(content);
    if (data.schemaVersion !== 1 || !Array.isArray(data.requests)) {
      throw new Error('Unsupported local inbox data.');
    }
    return data;
  }

  async function save(data) {
    const directory = path.dirname(filename);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${filename}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(data, null, 2)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, filename);
    } finally {
      if (handle) await handle.close().catch(() => {});
      await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }

  return {
    async list() {
      await pending;
      return (await read()).requests;
    },
    add(payload) {
      const operation = pending.then(async () => {
        const data = await read();
        const record = {
          id: randomUUID(),
          createdAt: new Date().toISOString(),
          ...payload,
          delivery: 'local-inbox',
          externalNotification: false,
        };
        data.requests.push(record);
        await save(data);
        return record;
      });
      pending = operation.then(() => undefined, () => undefined);
      return operation;
    },
  };
}
