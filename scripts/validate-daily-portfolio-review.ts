import { readFile } from "node:fs/promises";

import { validateDailyPortfolioReview } from "../lib/daily-portfolio-review.ts";
import type { PortfolioSnapshotV1 } from "../lib/portfolio-snapshot.ts";

const reviewPath = process.argv[2] ?? "data/daily-portfolio-review.json";
const snapshotPath = process.argv[3] ?? "data/portfolio-snapshot.json";
const [review, snapshot] = await Promise.all([
  readFile(reviewPath, "utf8").then(JSON.parse),
  readFile(snapshotPath, "utf8").then(JSON.parse) as Promise<PortfolioSnapshotV1>,
]);
const errors = validateDailyPortfolioReview(review, snapshot);

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else {
  console.log(`Daily portfolio review is valid: ${review.reviewDate}`);
}
