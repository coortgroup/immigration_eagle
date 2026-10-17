import { createRevenueCatWebhookHandler } from './handler.mjs';
Deno.serve(createRevenueCatWebhookHandler({ env: (name: string) => Deno.env.get(name) }));
