import type { LookupAddress } from 'node:dns';
import type { Buffer } from 'node:buffer';
import type { CountryCode } from 'libphonenumber-js';

export type ExtractionType = 'text' | 'html' | 'favicon' | 'images' | 'avatar' | 'selector' | 'social-links' | 'social-insights' | 'emails' | 'telephone' | 'links' | 'documents';
export type CaptureMode = 'auto' | 'http' | 'browser';
export type Platform = 'youtube' | 'tiktok' | 'instagram' | 'facebook' | 'x' | 'threads' | 'linkedin' | 'twitch' | 'reddit' | 'github' | 'vimeo' | 'bluesky';
export type SocialKind = 'profile' | 'channel' | 'post' | 'video' | 'unknown';
export type CaptureBrowser = {
  newPage(): Promise<{ goto(url: string, options: { waitUntil: 'load'; timeout: number }): Promise<unknown>; content(): Promise<string>; url(): string; close(): Promise<void> }>;
  close(): Promise<void>;
};
export type ExtractionOptions = {
  mode?: CaptureMode;
  timeout?: number;
  userAgent?: string;
  headers?: HeadersInit;
  waitAfterLoad?: number | string;
  signal?: AbortSignal;
  /** Default 10 MiB, applied to decoded responses and rendered HTML. */
  maxResponseBytes?: number;
  /** Explicitly trust local/private network targets; false by default. */
  allowPrivateNetwork?: boolean;
  fetch?: typeof globalThis.fetch;
  launchBrowser?: (options: { headless: true; args: string[]; timeout?: number; signal?: AbortSignal }) => Promise<CaptureBrowser>;
  /** Trusted DNS injection. All returned addresses are validated. */
  lookup?: (hostname: string, options: { all: true; verbatim: true }) => Promise<LookupAddress[]>;
  /** Default 45000. Zero bypasses both cache and in-flight deduplication. */
  cacheTtlMs?: number;
};
export type ContentOptions = ExtractionOptions & { includeSelectors?: string[]; ignoreSelectors?: string[]; format?: 'html' | 'text' };
export type ContactOptions = ExtractionOptions & { includeSelectors?: string[]; ignoreSelectors?: string[] };
export type LinksOptions = ExtractionOptions & { includeSelectors?: string[]; ignoreSelectors?: string[] };
export type TelephoneOptions = ContactOptions & { defaultCountry?: CountryCode };
export type FaviconOptions<Binary extends boolean = boolean> = ExtractionOptions & { binary?: Binary };
export type SelectorOptions = ExtractionOptions & { selector: string; all?: boolean; format?: 'text' | 'html'; attribute?: string };
export type ImageSource = 'img' | 'srcset' | 'lazy' | 'metadata' | 'link' | 'background';
export type ImagesOptions = ExtractionOptions & { unique?: boolean; includeMetadata?: boolean; sources?: ImageSource[] };
export type SocialLinksOptions = ExtractionOptions & { platform?: Platform | 'twitter' };
export type ExtractionMetadata = {
  requestedUrl: string; finalUrl: string; rawFinalUrl: string;
  /** Original snapshot timestamp; preserved on cache hits. */
  capturedAt: string | null;
  /** Time this extraction result was produced. */
  extractedAt: string;
  captureMode: 'http' | 'browser'; status: number; contentType: string | null;
  dismissedOverlays: string[]; cache: { hit: boolean; ageMs: number; ttlMs: number };
};
export type ExtractionResult<T, K extends ExtractionType = ExtractionType> = ExtractionMetadata & { type: K; data: T };
export type ContentResult<K extends 'text' | 'html' = 'text' | 'html'> = ExtractionResult<string, K> & { content: string; format: K };
/** Compatibility name for HTML/text results. */
export type ExtractResult = ContentResult;
export type ExtractOptions = ContentOptions;
export type ExtractedImage = { url: string; width: number | null; height: number | null; scalable: boolean; resolutionVerified: boolean; contentType: string | null; source: string };
export type FaviconResult<Binary extends boolean = false> = ExtractionResult<Binary extends true ? Buffer : ExtractedImage, 'favicon'> & { image: ExtractedImage };
export type AvatarData = { platform: Platform; profile: string | null; image: ExtractedImage };
export type ProfilePictureResult = ExtractionResult<AvatarData, 'avatar'> & AvatarData & { vendor: string };
export type ImageLink = { url: string; alt: string; width: number | null; height: number | null; source: ImageSource; originalAttribute: string; resolutionVerified: false };
export type ImagesResult = ExtractionResult<ImageLink[], 'images'> & { images: ImageLink[] };
export type SelectorResult = ExtractionResult<{ matched: boolean; values: Array<string | null> }, 'selector'> & { content: string; format: 'text' | 'html' };
export type SocialLink = { platform: Platform; url: string; kind: SocialKind; source: 'link' | 'rel-me' | 'metadata' | 'json-ld' };
export type SocialLinksResult = ExtractionResult<SocialLink[], 'social-links'> & { links: SocialLink[] };
export type EmailsResult = ExtractionResult<string[], 'emails'> & { emails: string[] };
export type TelephoneResult = ExtractionResult<string[], 'telephone'> & { numbers: string[] };
export type LinkLocation = { pageUrl: string; selector: string; attribute: 'href' | 'src' | 'data' };
export type ExtractedLink = { url: string; rawUrl: string; text: string; rel: string[]; internal: boolean; source: 'a' | 'area' | 'link'; location: LinkLocation };
export type DocumentLink = Omit<ExtractedLink, 'source'> & {
  source: ExtractedLink['source'] | 'iframe' | 'embed' | 'object';
  filename: string | null; extension: string | null; contentType: string | null;
  detectedBy: 'url' | 'query' | 'download' | 'type';
};
export type LinksResult = ExtractionResult<ExtractedLink[], 'links'> & { links: ExtractedLink[] };
export type DocumentsResult = ExtractionResult<DocumentLink[], 'documents'> & { documents: DocumentLink[] };
export type Metric = 'likes' | 'comments' | 'views' | 'shares' | 'saves' | 'followers' | 'following' | 'posts' | 'subscribers';
export type InsightStatus = 'available' | 'partial' | 'unavailable' | 'unsupported' | 'login_required' | 'blocked' | 'extraction_error';
export type SocialInsightsData = {
  platform: Platform | null; kind: SocialKind; url: string;
  metrics: Record<Metric, number | null>;
  status: InsightStatus;
  sources: Partial<Record<Metric, { type: 'embedded-json' | 'json-ld' | 'vendor'; field: string; approximate: boolean | null }>>;
  unavailable: Partial<Record<Metric, string>>;
};
export type SocialInsightsResult = ExtractionResult<SocialInsightsData, 'social-insights'> & { vendor: Platform | null; followers: number | null };
export type ResultMap = { text: ContentResult<'text'>; html: ContentResult<'html'>; favicon: FaviconResult<boolean>; images: ImagesResult; avatar: ProfilePictureResult; selector: SelectorResult; 'social-links': SocialLinksResult; 'social-insights': SocialInsightsResult; emails: EmailsResult; telephone: TelephoneResult; links: LinksResult; documents: DocumentsResult };
export type OptionsMap = { text: ContentOptions; html: ContentOptions; favicon: FaviconOptions; images: ImagesOptions; avatar: ExtractionOptions; selector: SelectorOptions; 'social-links': SocialLinksOptions; 'social-insights': ExtractionOptions; emails: ContactOptions; telephone: TelephoneOptions; links: LinksOptions; documents: LinksOptions };
export declare function extract<Binary extends boolean = false>(url: string, options: FaviconOptions<Binary> & { type: 'favicon' }): Promise<FaviconResult<Binary>>;
export declare function extract<K extends ExtractionType>(url: string, options: OptionsMap[K] & { type: K }): Promise<ResultMap[K]>;
export declare function extract(url: string, options?: ContentOptions): Promise<ContentResult>;
export declare function extractText(url: string, options?: ContentOptions): Promise<ContentResult<'text'>>;
export declare function extractHtml(url: string, options?: ContentOptions): Promise<ContentResult<'html'>>;
export declare function extractLinks(url: string, options?: LinksOptions): Promise<LinksResult>;
export declare function extractDocuments(url: string, options?: LinksOptions): Promise<DocumentsResult>;
export declare function extractEmails(url: string, options?: ContactOptions): Promise<EmailsResult>;
export declare function extractTelephone(url: string, options?: TelephoneOptions): Promise<TelephoneResult>;
export declare function extractFavicon<Binary extends boolean = false>(url: string, options?: FaviconOptions<Binary>): Promise<FaviconResult<Binary>>;
export declare function extractImages(url: string, options?: ImagesOptions): Promise<ImagesResult>;
export declare function extractSelector(url: string, options: SelectorOptions): Promise<SelectorResult>;
export declare function extractSelector(url: string, selector: string, options?: Omit<SelectorOptions, 'selector'>): Promise<SelectorResult>;
export declare function extractSocialLinks(url: string, options?: SocialLinksOptions): Promise<SocialLinksResult>;
export declare function extractSocialInsights(url: string, options?: ExtractionOptions): Promise<SocialInsightsResult>;
export declare function extractSocialAvatar(url: string, options?: ExtractionOptions): Promise<ProfilePictureResult>;
export declare const extractProfilePicture: typeof extractSocialAvatar;
export type ExtractorOptions = ExtractionOptions & { maxEntries?: number; maxCacheBytes?: number };
export type Extractor = { extract: typeof extract; extractText: typeof extractText; extractHtml: typeof extractHtml; extractLinks: typeof extractLinks; extractDocuments: typeof extractDocuments; extractEmails: typeof extractEmails; extractTelephone: typeof extractTelephone; extractFavicon: typeof extractFavicon; extractImages: typeof extractImages; extractSelector: typeof extractSelector; extractSocialLinks: typeof extractSocialLinks; extractSocialInsights: typeof extractSocialInsights; extractSocialAvatar: typeof extractSocialAvatar; extractProfilePicture: typeof extractProfilePicture; clearCache(): void };
export declare function createExtractor(options?: ExtractorOptions): Extractor;
export declare function clearCache(): void;
export declare class FetcharyError extends Error { url?: string }
export declare class FetcharyValidationError extends FetcharyError {}
export declare class FetcharyFetchError extends FetcharyError { status?: number }
export declare class FetcharyBrowserError extends FetcharyError { phase?: string; status?: number }
export declare class FetcharyNotFoundError extends FetcharyError {}
