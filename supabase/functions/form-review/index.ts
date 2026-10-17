import { createFormReviewHandler } from './handler.mjs';

Deno.serve(createFormReviewHandler({ env: (name: string) => Deno.env.get(name) }));
