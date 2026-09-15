import { z } from "zod";
import { NewsletterMetadataSchema } from "./newsletter.js";

const CategorySchema = z
  .object({
    name: z.string(),
    id: z.union([z.number(), z.string()]),
  })
  .passthrough();

const CategoryResponseSchema = z.object({
  publications: z.array(NewsletterMetadataSchema),
  more: z.boolean(),
});

type CategoryData = z.infer<typeof CategorySchema>;
type CategoryResponseItem = z.infer<typeof CategoryResponseSchema>["publications"][number];

export {
  CategorySchema,
  CategoryResponseSchema,
  type CategoryData,
  type CategoryResponseItem,
};
