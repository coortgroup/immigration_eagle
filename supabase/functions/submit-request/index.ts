import { createSubmitRequestHandler } from './handler.mjs';

Deno.serve(createSubmitRequestHandler({ env: (name: string) => Deno.env.get(name) }));
