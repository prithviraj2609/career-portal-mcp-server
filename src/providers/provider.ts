import type {
  AccountSnapshot,
  JobDetails,
  JobSearchInput,
  MutationRequest,
  ProviderCapability,
  ProviderName,
  SearchPage,
} from "../types.js";

export interface ProviderAdapter {
  readonly name: ProviderName;
  capabilities(): ProviderCapability[];
  searchJobs(input: JobSearchInput): Promise<SearchPage>;
  getJobDetails(jobId: string): Promise<JobDetails>;
  readAccount(kind: AccountSnapshot["kind"]): Promise<AccountSnapshot>;
  readMutationState(request: MutationRequest): Promise<Record<string, unknown>>;
  executeMutation(request: MutationRequest): Promise<unknown>;
}
