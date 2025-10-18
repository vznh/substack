// schemas/newsletter
import { z } from "zod";

const NewsletterMetadataSchema = z.object({
  id: z.string(),
  name: z.string(),
  subscribers: z.number(),
  base_url: z.string(),
  custom_domain: z.string().nullable(),
  subdomain: z.string()
});

const ArchiveResponseSchema = z.array(z.object({
  id: z.number(),
  slug: z.string(),
  title: z.string(),
  canonical_url: z.string(),
  publication_id: z.number(),
  type: z.string(),
  audience: z.enum(["everyone", "only_paid"]).optional(),
  subtitle: z.string().nullable(),
  body_html: z.string().nullable(),
  post_date: z.string().nullable(),
  comment_count: z.number().optional()
}));

const RecommendationSchema = z.object({
  recommendedPublication: z.object({
    custom_domain: z.string().nullable(),
    subdomain: z.string()
  }),
});

type NewsletterMetadata = z.infer<typeof NewsletterMetadataSchema>;
type ArchiveResponseItem = z.infer<typeof ArchiveResponseSchema>[0];

export {
  type NewsletterMetadata,
  type ArchiveResponseItem,
  NewsletterMetadataSchema,
  RecommendationSchema,
  ArchiveResponseSchema
}
