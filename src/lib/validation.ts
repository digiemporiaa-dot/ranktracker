import { z } from 'zod';

import { COUNTRY_CODES, LANGUAGE_CODES, MAX_DEPTH } from '@/config/serp';
import { normalizeDomain } from '@/lib/domain';

export const countrySchema = z.enum(COUNTRY_CODES as [string, ...string[]]);
export const languageSchema = z.enum(LANGUAGE_CODES as [string, ...string[]]);
export const deviceSchema = z.enum(['DESKTOP', 'MOBILE']);

export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Please enter your name').max(100),
  email: z.string().trim().toLowerCase().email('Please enter a valid email address').max(255),
  password: z
    .string()
    .min(10, 'Password must be at least 10 characters')
    .max(200, 'Password is too long'),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Please enter a valid email address').max(255),
  password: z.string().min(1, 'Please enter your password').max(200),
});

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, 'Please enter a project name').max(120),
  domain: z
    .string()
    .trim()
    .min(1, 'Please enter a website')
    .transform((value, ctx) => {
      const normalized = normalizeDomain(value);
      if (!normalized) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Please enter a valid website, for example https://example.com',
        });
        return z.NEVER;
      }
      return normalized;
    }),
  country: countrySchema.default('IN'),
  language: languageSchema.default('en'),
  device: deviceSchema.default('DESKTOP'),
});

const keywordEntrySchema = z.object({
  keyword: z.string().trim().min(1).max(255),
  targetUrl: z.string().trim().max(2048).nullish(),
});

export const addKeywordsSchema = z.object({
  /** Raw pasted text, one keyword per line. */
  text: z.string().max(1_000_000).optional(),
  /** Pre-parsed rows, used by the CSV import preview. */
  keywords: z.array(keywordEntrySchema).max(5000).optional(),
  country: countrySchema.optional(),
  language: languageSchema.optional(),
  device: deviceSchema.optional(),
});

export const importKeywordsSchema = z.object({
  csv: z.string().min(1, 'The file is empty').max(4_000_000),
  country: countrySchema.optional(),
  language: languageSchema.optional(),
  device: deviceSchema.optional(),
  /** When false, the server parses and returns a preview without saving. */
  commit: z.boolean().default(false),
});

export const rankCheckSchema = z.object({
  depth: z.number().int().min(10).max(MAX_DEPTH).optional(),
  /** Restrict the run to specific keywords; omit to check all active ones. */
  keywordIds: z.array(z.string().min(1)).max(5000).optional(),
});

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  search: z.string().trim().max(255).optional(),
  filter: z
    .enum([
      'all',
      'top3',
      'top10',
      'top20',
      'top50',
      'top100',
      'notRanking',
      'improved',
      'dropped',
    ])
    .default('all'),
  sort: z.enum(['keyword', 'position', 'change', 'checkedAt']).default('position'),
  direction: z.enum(['asc', 'desc']).default('asc'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type ListQuery = z.infer<typeof listQuerySchema>;
