export { Auth, type Cookie, type AuthOptions } from "./core/auth.js";
export { Newsletter } from "./core/newsletter.js";
export { User, type UserData } from "./core/user.js";
export { Post, type PostData, type PostSummaryData } from "./core/post.js";
export {
  Category,
  fetch_all_categories,
} from "./core/category.js";
export { type CategoryData, type CategoryResponseItem } from "./schemas/category.js";
export {
  HttpError,
  request,
  setFetch,
  type FetchLike,
  type RequestOptions,
} from "./core/http.js";
export { AuthError } from "./core/errors.js";
export {
  type ArchiveResponseItem,
  type NewsletterMetadata,
  type Recommendation,
} from "./schemas/newsletter.js";
export { Substack as substack } from "./core/substack.js";
