import { createPaymentHandler } from './handler.mjs';
Deno.serve(createPaymentHandler({ env: (name: string) => Deno.env.get(name) }));
