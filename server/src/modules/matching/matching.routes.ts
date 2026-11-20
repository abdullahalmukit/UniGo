import { Router } from "express";
import { rules } from "../../config/rules.js";
import { authenticate, authUser } from "../../middleware/authenticate.js";
import { requireVerifiedStudent } from "../../middleware/authorize.js";
import { matchingRateLimit } from "../../middleware/rate-limit.js";
import { parseInput } from "../../middleware/validate.js";
import { listServiceCategories } from "../service/service.service.js";
import { suggestServiceCategory } from "./category-hint.js";
import { getSuggestions } from "./matching.service.js";
import { categoryHintQuery, suggestionsQuery } from "./matching.validation.js";

// B9 (proposal section 20): ranked suggestions and the service category hint.
// Verified students only, like the feature pages the candidates come from.
export const matchingRouter = Router();
matchingRouter.use(authenticate, requireVerifiedStudent);

matchingRouter.get("/suggestions", matchingRateLimit, async (req, res) => {
  res.json(await getSuggestions(authUser(req).id, parseInput(suggestionsQuery, req.query)));
});

matchingRouter.get("/service-category", async (req, res) => {
  const { text } = parseInput(categoryHintQuery, req.query);
  if (text.trim().length < rules.matching.categoryHintMinLength) return void res.json({ suggestion: null });
  const hint = suggestServiceCategory(text);
  if (!hint) return void res.json({ suggestion: null });
  const category = (await listServiceCategories()).find((c) => c.code === hint.code && !c.isCustom);
  res.json({ suggestion: category ? { categoryId: category.id, code: hint.code, confidence: hint.confidence } : null });
});
