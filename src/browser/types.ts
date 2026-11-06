import type {
  AccountSnapshot,
  FieldChange,
  JobDetails,
  JobSearchInput,
  MutationRequest,
  ProviderName,
  SearchPage,
} from "../types.js";

export interface BrowserPage {
  goto(url: string): Promise<void>;
  url(): string;
  title(): Promise<string>;
  text(selector: string): Promise<string | undefined>;
  texts(selector: string): Promise<string[]>;
  attributes(selector: string, name: string): Promise<string[]>;
  values(selector: string): Promise<string[]>;
  click(selector: string): Promise<void>;
  clickAt(selector: string, index: number): Promise<void>;
  selectOption(
    inputSelector: string,
    listboxSelector: string,
    label: string,
  ): Promise<void>;
  selectNative(selector: string, label: string): Promise<void>;
  selectRoleOption(label: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  typeText(selector: string, value: string): Promise<void>;
  setChecked(selector: string, checked: boolean): Promise<void>;
  press(selector: string, key: string): Promise<void>;
  setInputFiles(selector: string, path: string): Promise<void>;
  waitFor(selector: string): Promise<void>;
  waitForFirst(selector: string): Promise<void>;
  waitForCount(selector: string, count: number): Promise<void>;
  waitForHidden(selector: string): Promise<void>;
  isVisible(selector: string): Promise<boolean>;
  count(selector: string): Promise<number>;
  getJson(url: string): Promise<unknown>;
  gotoAndCaptureJson(url: string, responsePath: string): Promise<unknown>;
}

export interface BrowserHandle {
  page: BrowserPage;
  pages(): BrowserPage[];
  storageState(): Promise<string>;
  close(): Promise<void>;
}

export interface BrowserLauncher {
  launch(
    provider: ProviderName,
    headed: boolean,
    storageState?: string,
  ): Promise<BrowserHandle>;
}

export interface ProviderBrowserWorkflow {
  readonly provider: ProviderName;
  readonly loginUrl: string;
  readonly authStatusUrl?: string;
  readonly profileUrl: string;
  isAuthenticated(page: BrowserPage): Promise<boolean>;
  assertSafePage(page: BrowserPage): Promise<void>;
  readProfile(
    page: BrowserPage,
    fields?: readonly string[],
  ): Promise<Record<string, unknown>>;
  searchJobs?(
    page: BrowserPage,
    input: JobSearchInput,
  ): Promise<SearchPage>;
  getJobDetails?(page: BrowserPage, jobId: string): Promise<JobDetails>;
  readAccountData?(
    page: BrowserPage,
    kind: AccountSnapshot["kind"],
  ): Promise<unknown>;
  readMutationState?(
    page: BrowserPage,
    request: MutationRequest,
  ): Promise<Record<string, unknown>>;
  executeMutation?(
    page: BrowserPage,
    request: MutationRequest,
    resumeMaxBytes: number,
    resumeDirectory: string | undefined,
  ): Promise<void>;
  applyChanges(
    page: BrowserPage,
    changes: FieldChange[],
    resumeMaxBytes: number,
    resumeDirectory: string | undefined,
  ): Promise<void>;
}

export type BrowserAuthStatus =
  | "disabled"
  | "not_authenticated"
  | "authenticated"
  | "expired";
