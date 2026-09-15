// schemas/category
import { z } from "zod";

// Category list entry. Most IDs are numeric, while named categories such as
// "podcast" are also valid; lookups normalize both representations.
const CategorySchema = z
  .object({
    name: z.string(),
    id: z.union([z.number(), z.string()]),
  })
  .passthrough();

// Category contents. Publication IDs are numeric on the wire; unknown
// publication fields are preserved via passthrough.
const CategoryResponseSchema = z.object({
  publications: z
    .array(
      z
        .object({
          id: z.number(),
          name: z.string(),
          base_url: z.string(),
          subdomain: z.string(),
          custom_domain: z.string().nullable().optional(),
          subscribers: z.number().optional(),
        })
        .passthrough(),
    ),
  more: z.boolean(),
});

type CategoryData = z.infer<typeof CategorySchema>;
type CategoryResponseItem = z.infer<typeof CategoryResponseSchema>["publications"][number];

export { CategorySchema, CategoryResponseSchema, type CategoryData, type CategoryResponseItem };
