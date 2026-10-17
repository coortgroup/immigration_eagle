import { createSupportInboxHandler } from './handler.mjs';

Deno.serve(createSupportInboxHandler({ env: (name: string) => Deno.env.get(name) }));
