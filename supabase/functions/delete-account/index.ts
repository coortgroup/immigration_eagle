import { createDeleteAccountHandler } from './handler.mjs';

Deno.serve(createDeleteAccountHandler({ env: (name: string) => Deno.env.get(name) }));
