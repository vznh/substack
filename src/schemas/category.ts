// schemas/category
import { z } from "zod";

const CategorySchema = z.object({
  name: z.string(),
  id: z.union([z.number(), z.string()])
});

const CategoryResponseSchema = z.object({
  publications: z.array(z.object({
    id: z.string(),
    name: z.string(),
    base_url: z.string(),
    custom_domain: z.string().nullable(),
    subdomain: z.string(),
    subscribers: z.number().optional()
  })),
  more: z.boolean()
});

type CategoryData = z.infer<typeof CategorySchema>;
type CategoryResponseItem = z.infer<typeof CategoryResponseSchema>["publications"][0];

export { CategorySchema, CategoryResponseSchema, type CategoryData, type CategoryResponseItem }
