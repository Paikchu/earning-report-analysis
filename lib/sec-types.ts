import type { SecFiling, SecFilingSummary } from "./sec.ts";
import type {
  ComparisonResult,
  ClaimLedger,
  CompanyMemoryItem,
  FilingBlock,
  ModuleAnalysis,
  MemoryCandidate,
  ManagerReview,
  PriorSnapshotContext,
  PublishedSecReport,
  RouterResult,
  SecAnalysisBrief,
  SecHistorySnapshot,
  SecAnalysisModuleKey,
  SnapshotSummary,
} from "./sec-analysis.ts";

export type SecCacheRecord<T> = {
  payload: T;
  fetchedAt: string;
};

export type SecRepository = {
  getCache<T>(key: string): Promise<SecCacheRecord<T> | null>;
  setCache<T>(key: string, payload: T, fetchedAt: string): Promise<void>;
  getSummary(ticker: string, accessionNumber: string): Promise<SecFilingSummary | null>;
  setSummary(summary: SecFilingSummary): Promise<void>;
  getPublishedReport?(ticker: string, periodId: string): Promise<PublishedSecReport | null>;
  getAnalysisContext?(filing: SecFiling): Promise<SecAnalysisContext>;
  saveAnalysis?(artifact: SecAnalysisArtifact): Promise<void>;
};

export type SecAnalysisContext = {
  currentPeriodId: string;
  qoqPeriodId: string | null;
  yoyPeriodId: string | null;
  qoq: Partial<Record<SecAnalysisModuleKey, PriorSnapshotContext>>;
  yoy: Partial<Record<SecAnalysisModuleKey, PriorSnapshotContext>>;
  activeMemory: PriorSnapshotContext["activeMemory"];
  history?: SecHistorySnapshot;
  companyMemorySummary?: string;
  memoryItems?: CompanyMemoryItem[];
};

export type SecAnalysisArtifact = {
  filing: SecFiling;
  periodId: string;
  periodScope: "quarter" | "annual";
  blocks: FilingBlock[];
  moduleAnalyses: ModuleAnalysis[];
  snapshots: SnapshotSummary[];
  comparisons: ComparisonResult[];
  memoryCandidates: MemoryCandidate[];
  report: PublishedSecReport;
  router: RouterResult;
  brief?: SecAnalysisBrief;
  managerReview?: ManagerReview;
  claimLedger?: ClaimLedger;
  artifactKeys?: Record<string, string>;
};
