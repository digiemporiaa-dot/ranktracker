import { z } from 'zod';

import {
  COUNTRY_CODES,
  LANGUAGE_CODES,
  MAX_DEPTH,
  SEARCH_DOMAIN_VALUES,
} from '@/config/serp';
import { normalizeDomain } from '@/lib/domain';

export const countrySchema = z.enum(COUNTRY_CODES as [string, ...string[]]);
export const languageSchema = z.enum(LANGUAGE_CODES as [string, ...string[]]);
export const deviceSchema = z.enum(['DESKTOP', 'MOBILE']);
export const searchDomainSchema = z.enum(SEARCH_DOMAIN_VALUES as [string, ...string[]]);

/**
 * A website/domain field, reduced to a bare host.
 *
 * Shared by project create and project edit so the value is normalized the
 * same way in both places — a mismatch between the two would mean a project
 * could never match its own search results.
 */
const websiteSchema = z
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
  });

/**
 * A route param or query id.
 *
 * Ids are cuids. Bounding the shape here keeps a hostile or malformed id from
 * reaching a query at all; a value that fails this is answered exactly like an
 * id that simply does not exist.
 */
export const idParamSchema = z.string().trim().min(1).max(60);

export const deleteKeywordQuerySchema = z.object({
  keywordId: idParamSchema,
});

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
  domain: websiteSchema,
  country: countrySchema.default('IN'),
  language: languageSchema.default('en'),
  device: deviceSchema.default('DESKTOP'),
  searchDomain: searchDomainSchema.default('google.com'),
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

/** The editable fields, excluding the confirmation flag. */
const UPDATABLE_PROJECT_FIELDS = [
  'name',
  'domain',
  'country',
  'language',
  'device',
  'searchDomain',
] as const;

/**
 * Project edit.
 *
 * `domain` is editable, but changing it is not a neutral edit: every Ranking
 * row is a position observation *for a particular domain*, so after a change
 * the stored history describes two different websites on one chart. The route
 * therefore refuses a domain change unless `confirmDomainChange` is true, and
 * the UI shows the warning that flag stands for. The flag is not itself an
 * edit — a body carrying only the flag is still "nothing to update".
 */
export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1, 'Please enter a project name').max(100).optional(),
    domain: websiteSchema.optional(),
    country: countrySchema.optional(),
    language: languageSchema.optional(),
    device: deviceSchema.optional(),
    searchDomain: searchDomainSchema.optional(),
    /** Acknowledgement that changing the website invalidates existing history. */
    confirmDomainChange: z.boolean().optional(),
  })
  .refine(
    (value) =>
      UPDATABLE_PROJECT_FIELDS.some((field) => value[field] !== undefined),
    { message: 'There is nothing to update.' },
  );

/** Upper bound on one bulk delete, mirroring the default MAX_KEYWORDS_PER_CHECK. */
export const MAX_BULK_DELETE = 500;

export const bulkDeleteKeywordsSchema = z.object({
  keywordIds: z
    .array(idParamSchema)
    .min(1, 'Select at least one keyword.')
    .max(MAX_BULK_DELETE, `You can delete at most ${MAX_BULK_DELETE} keywords at a time.`),
});

/** Clear-all requires the project name typed back, as deliberate friction. */
export const clearKeywordsSchema = z.object({
  confirm: z.string().min(1, 'Please type the project name to confirm.').max(120),
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
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type ListQuery = z.infer<typeof listQuerySchema>;
