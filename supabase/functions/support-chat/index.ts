import { createSupportChatHandler } from './handler.mjs';

Deno.serve(createSupportChatHandler({ env: (name: string) => Deno.env.get(name) }));
