import { z } from 'zod';

export const demoChainContractSchema = z
  .object({
    occ: z.string().min(1),
    expiration: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    strike: z.number().positive(),
    daysToExpiration: z.number().int(),
    bid: z.string().min(1),
    ask: z.string().min(1),
    delta: z.string().nullable(),
    gamma: z.string().nullable(),
    theta: z.string().nullable(),
    vega: z.string().nullable(),
    iv: z.string().nullable(),
    simulated: z.literal(true),
  })
  .strict();

export const demoChainSchema = z
  .object({
    underlying: z.literal('DEMO'),
    spot: z.string().min(1),
    asOf: z.string().min(1),
    simulated: z.literal(true),
    disclaimer: z.string().min(1),
    contracts: z.array(demoChainContractSchema),
  })
  .strict();

export type DemoChainContract = z.infer<typeof demoChainContractSchema>;
export type DemoChain = z.infer<typeof demoChainSchema>;
