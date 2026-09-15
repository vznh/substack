// schemas/newsletter
import { z } from "zod";

// Publication metadata. Only identity fields are strict; the rest is
// optional and unknown fields are preserved via passthrough.
const NewsletterMetadataSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    base_url: z.string(),
    subdomain: z.string(),
    subscribers: z.number().optional(),
    custom_domain: z.string().nullable().optional(),
  })
  .passthrough();

// Archive summary entries. Publication IDs are numeric on the wire. Raw
// fields (including podcast metadata) are retained via passthrough.
const ArchiveResponseSchema = z.array(
  z
    .object({
      id: z.number(),
      slug: z.string(),
      canonical_url: z.string(),
      publication_id: z.number(),
      title: z.string().nullish(),
      type: z.string().nullish(),
      audience: z.string().nullish(),
      subtitle: z.string().nullish(),
      body_html: z.string().nullish(),
      publish_date: z.string().nullish(),
      post_date: z.string().nullish(),
      comment_count: z.number().nullish(),
      comments_count: z.number().nullish(),
      podcast_url: z.string().nullish(),
      podcast_upload_id: z.union([z.string(), z.number()]).nullish(),
      podcast_duration: z.number().nullish(),
    })
    .passthrough(),
);

const RecommendationSchema = z
  .object({
    recommendedPublication: z
      .object({
        custom_domain: z.string().nullable().optional(),
        subdomain: z.string(),
      })
      .passthrough(),
  })
  .passthrough();

const AuthorsSchema = z.array(
  z.object({ handle: z.string() }).passthrough(),
);

type NewsletterMetadata = z.infer<typeof NewsletterMetadataSchema>;
type ArchiveResponseItem = z.infer<typeof ArchiveResponseSchema>[number];
type Recommendation = z.infer<typeof RecommendationSchema>;

export {
  type NewsletterMetadata,
  type ArchiveResponseItem,
  type Recommendation,
  NewsletterMetadataSchema,
  RecommendationSchema,
  ArchiveResponseSchema,
  AuthorsSchema,
};
