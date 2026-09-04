import { z } from 'zod';

import {
  COUNTRY_CODES,
  LANGUAGE_CODES,
  MAX_DEPTH,
  type CountryCode,
  type LanguageCode,
} from '@/config/serp';
import { normalizeDomain } from '@/lib/domain';

// Typed as tuples so the parsed value keeps its literal type: a validated
// country is a CountryCode, not any string, and the routes that pass it on to
// the location resolver do not need a cast.
export const countrySchema = z.enum(COUNTRY_CODES as [CountryCode, ...CountryCode[]]);
export const languageSchema = z.enum(LANGUAGE_CODES as [LanguageCode, ...LanguageCode[]]);
export const deviceSchema = z.enum(['DESKTOP', 'MOBILE']);

/**
 * A city, by name.
 *
 * Optional everywhere: an absent or empty city means the whole country is
 * searched. The name is turned into a DataForSEO location id on the server —
 * there is deliberately no field for a caller to send an id of its own.
 */
export const citySchema = z
  .string()
  .trim()
  .max(120, 'That city name is too long.')
  .transform((value) => (value.length === 0 ? null : value))
  .nullable();

/**
 * The devices to track. At least one, and each one only once.
 *
 * Every selected device is checked with its own SERP request and kept as its
 * own ranking history, so this is a list rather than a single value.
 */
export const devicesSchema = z
  .array(deviceSchema)
  .min(1, 'Select at least one device.')
  .max(2)
  .transform((devices) => [...new Set(devices)]);

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

export const createUserSchema = z.object({
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
  // Required: a rank check has to happen somewhere, and there is no sensible
  // country to assume on someone else's behalf.
  country: countrySchema,
  city: citySchema.optional(),
  language: languageSchema.default('en'),
  devices: devicesSchema.default(['DESKTOP']),
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
  city: citySchema.optional(),
  language: languageSchema.optional(),
  devices: devicesSchema.optional(),
});

export const importKeywordsSchema = z.object({
  csv: z.string().min(1, 'The file is empty').max(4_000_000),
  country: countrySchema.optional(),
  city: citySchema.optional(),
  language: languageSchema.optional(),
  devices: devicesSchema.optional(),
  /** When false, the server parses and returns a preview without saving. */
  commit: z.boolean().default(false),
});

/**
 * Project edit.
 *
 * The domain is deliberately absent. Every Ranking row is a position
 * observation *for a particular domain*; letting the domain change would make
 * the existing history describe two different websites on one chart. A
 * different domain means a new project.
 */
export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1, 'Please enter a project name').max(100).optional(),
    country: countrySchema.optional(),
    /** Explicit null clears the city and goes back to country-level tracking. */
    city: citySchema.optional(),
    language: languageSchema.optional(),
    devices: devicesSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'There is nothing to update.',
  });

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

/**
 * Admin edits to a user.
 *
 * There is deliberately no `role` field: role changes are not an HTTP
 * operation at all, so no request body can promote or demote anyone.
 */
export const updateUserSchema = z
  .object({
    name: z.string().trim().min(1, 'Please enter a name').max(100).optional(),
    isActive: z.boolean().optional(),
    password: z
      .string()
      .min(10, 'Password must be at least 10 characters')
      .max(200)
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'There is nothing to update.',
  });

/**
 * Deleting a user must say what happens to their projects.
 *
 * There is no default: silently destroying a client's whole ranking history
 * because somebody left the company is not an acceptable fallback.
 */
export const deleteUserQuerySchema = z.discriminatedUnion('onDelete', [
  z.object({
    onDelete: z.literal('reassign'),
    toUserId: z.string().min(1, 'Choose who receives the projects.'),
  }),
  z.object({ onDelete: z.literal('purge') }),
]);

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
  /** Show one device's rankings, or both side by side. */
  device: z.enum(['all', 'DESKTOP', 'MOBILE']).default('all'),
});

/** Query for the city picker. The country decides which cities are offered. */
export const cityQuerySchema = z.object({
  country: countrySchema,
  search: z.string().trim().max(120).optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type ListQuery = z.infer<typeof listQuerySchema>;
export type CityQuery = z.infer<typeof cityQuerySchema>;
