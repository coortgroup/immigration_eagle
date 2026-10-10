import { createAiHandler } from './handler.mjs';

Deno.serve(createAiHandler({ env: (name: string) => Deno.env.get(name) }));
