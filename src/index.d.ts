import type { LookupAddress } from 'node:dns';
import type { Buffer } from 'node:buffer';

/** Geographic countries supported by the bundled phone-number metadata. */
type CountryCode =
  | 'AC' | 'AD' | 'AE' | 'AF' | 'AG' | 'AI' | 'AL' | 'AM' | 'AO' | 'AR' | 'AS' | 'AT'
  | 'AU' | 'AW' | 'AX' | 'AZ' | 'BA' | 'BB' | 'BD' | 'BE' | 'BF' | 'BG' | 'BH' | 'BI'
  | 'BJ' | 'BL' | 'BM' | 'BN' | 'BO' | 'BQ' | 'BR' | 'BS' | 'BT' | 'BW' | 'BY' | 'BZ'
  | 'CA' | 'CC' | 'CD' | 'CF' | 'CG' | 'CH' | 'CI' | 'CK' | 'CL' | 'CM' | 'CN' | 'CO'
  | 'CR' | 'CU' | 'CV' | 'CW' | 'CX' | 'CY' | 'CZ' | 'DE' | 'DJ' | 'DK' | 'DM' | 'DO'
  | 'DZ' | 'EC' | 'EE' | 'EG' | 'EH' | 'ER' | 'ES' | 'ET' | 'FI' | 'FJ' | 'FK' | 'FM'
  | 'FO' | 'FR' | 'GA' | 'GB' | 'GD' | 'GE' | 'GF' | 'GG' | 'GH' | 'GI' | 'GL' | 'GM'
  | 'GN' | 'GP' | 'GQ' | 'GR' | 'GT' | 'GU' | 'GW' | 'GY' | 'HK' | 'HN' | 'HR' | 'HT'
  | 'HU' | 'ID' | 'IE' | 'IL' | 'IM' | 'IN' | 'IO' | 'IQ' | 'IR' | 'IS' | 'IT' | 'JE'
  | 'JM' | 'JO' | 'JP' | 'KE' | 'KG' | 'KH' | 'KI' | 'KM' | 'KN' | 'KP' | 'KR' | 'KW'
  | 'KY' | 'KZ' | 'LA' | 'LB' | 'LC' | 'LI' | 'LK' | 'LR' | 'LS' | 'LT' | 'LU' | 'LV'
  | 'LY' | 'MA' | 'MC' | 'MD' | 'ME' | 'MF' | 'MG' | 'MH' | 'MK' | 'ML' | 'MM' | 'MN'
  | 'MO' | 'MP' | 'MQ' | 'MR' | 'MS' | 'MT' | 'MU' | 'MV' | 'MW' | 'MX' | 'MY' | 'MZ'
  | 'NA' | 'NC' | 'NE' | 'NF' | 'NG' | 'NI' | 'NL' | 'NO' | 'NP' | 'NR' | 'NU' | 'NZ'
  | 'OM' | 'PA' | 'PE' | 'PF' | 'PG' | 'PH' | 'PK' | 'PL' | 'PM' | 'PR' | 'PS' | 'PT'
  | 'PW' | 'PY' | 'QA' | 'RE' | 'RO' | 'RS' | 'RU' | 'RW' | 'SA' | 'SB' | 'SC' | 'SD'
  | 'SE' | 'SG' | 'SH' | 'SI' | 'SJ' | 'SK' | 'SL' | 'SM' | 'SN' | 'SO' | 'SR' | 'SS'
  | 'ST' | 'SV' | 'SX' | 'SY' | 'SZ' | 'TA' | 'TC' | 'TD' | 'TG' | 'TH' | 'TJ' | 'TK'
  | 'TL' | 'TM' | 'TN' | 'TO' | 'TR' | 'TT' | 'TV' | 'TW' | 'TZ' | 'UA' | 'UG' | 'US'
  | 'UY' | 'UZ' | 'VA' | 'VC' | 'VE' | 'VG' | 'VI' | 'VN' | 'VU' | 'WF' | 'WS' | 'XK'
  | 'YE' | 'YT' | 'ZA' | 'ZM' | 'ZW';

export type ExtractionType = 'text' | 'html' | 'favicon' | 'images' | 'videos' | 'avatar' | 'selector' | 'social-links' | 'social-insights' | 'emails' | 'telephone' | 'links' | 'documents' | 'metadata' | 'structured-data' | 'tracker-intelligence' | 'price';
export type CaptureMode = 'auto' | 'http' | 'browser';
export type ConsentMode = 'reject' | 'accept' | 'off';
export type ConsentStatus = 'not_detected' | 'handled' | 'failed' | 'unsupported' | 'blocked';
export type ConsentMetadata = {
  detected: boolean;
  provider: string | null;
  /** Requested policy; handled is the only status confirming a completed decision. */
  action: ConsentMode;
  status: ConsentStatus;
  /** Explanation when a detected dialog could not be completed. */
  reason?: string;
};
export type Platform = 'youtube' | 'tiktok' | 'instagram' | 'facebook' | 'x' | 'threads' | 'linkedin' | 'twitch' | 'reddit' | 'github' | 'vimeo' | 'bluesky' | 'telegram' | 'hackernews';
export type SocialKind = 'profile' | 'channel' | 'post' | 'video' | 'repository' | 'release' | 'unknown';
export type BrowserResourceType = 'image' | 'font' | 'media' | 'stylesheet' | 'script' | 'xhr' | 'fetch' | 'eventsource' | 'websocket' | 'manifest' | 'other';
export type CaptureCookieData = { name: string; value: string; domain: string; path: string; secure: boolean; httpOnly: boolean; expires?: number; sameSite?: 'Strict' | 'Lax' | 'None' };
export type CapturePage = {
  goto(url: string, options: { waitUntil: 'load'; timeout: number }): Promise<unknown>;
  content(): Promise<string>; url(): string; close(): Promise<void>;
};
export type CaptureBrowser = {
  newPage(): Promise<CapturePage>;
  /** Required when importing session cookies with a custom browser implementation. */
  createBrowserContext?(): Promise<{ newPage(): Promise<CapturePage>; setCookie(...cookies: CaptureCookieData[]): Promise<void>; close(): Promise<void> }>;
  close(): Promise<void>;
};
export type ExtractionOptions = {
  /** Use cookies explicitly saved by login(); authenticated captures bypass caches. */
  session?: string;
  /** Default ~/.fetchary/sessions; requires session for extraction. */
  sessionDir?: string;
  mode?: CaptureMode;
  /** Default reject; accept requires explicit selection; off disables generic consent handling. */
  consent?: ConsentMode;
  timeout?: number;
  userAgent?: string;
  headers?: HeadersInit;
  /** Read-only Netscape/JSON cookie export. Cookie-file captures bypass all page caches. */
  cookieFile?: string;
  /** Read relevant cookies from Chrome on macOS; disables page caching. Conflicts with cookieFile. */
  cookiesFromBrowser?: 'chrome';
  /** Chrome profile directory name (default: Default) or absolute profile directory path. */
  browserProfile?: string;
  waitAfterLoad?: number | string;
  signal?: AbortSignal;
  /** Default 45 MiB, applied to each decoded response/resource and rendered HTML. */
  maxResponseBytes?: number;
  /** Explicit browser subresources to omit; the main navigation is retained. */
  blockedResourceTypes?: BrowserResourceType[];
  /** Explicitly trust local/private network targets; false by default. */
  allowPrivateNetwork?: boolean;
  /** Skip TLS certificate and hostname verification; true by default. Set false to verify. */
  insecure?: boolean;
  fetch?: typeof globalThis.fetch;
  launchBrowser?: (options: { headless: true; acceptInsecureCerts: boolean; args: string[]; timeout?: number; signal?: AbortSignal }) => Promise<CaptureBrowser>;
  /** Trusted DNS injection. All returned addresses are validated. */
  lookup?: (hostname: string, options: { all: true; verbatim: true }) => Promise<LookupAddress[]>;
  /** Default 45000. Zero bypasses both cache and in-flight deduplication. */
  cacheTtlMs?: number;
};
export type PriceOptions = ExtractionOptions & { productSelector?: string; priceSelector?: string; country?: string; language?: string };
export type ContentOptions = ExtractionOptions & { includeSelectors?: string[]; ignoreSelectors?: string[]; format?: 'html' | 'text' };
export type ContactOptions<Details extends boolean = boolean> = ExtractionOptions & { includeSelectors?: string[]; ignoreSelectors?: string[]; details?: Details };
export type EmailOptions<Details extends boolean = boolean> = ContactOptions<Details> & { deobfuscate?: boolean };
export type LinksOptions = ExtractionOptions & { includeSelectors?: string[]; ignoreSelectors?: string[] };
export type TelephoneOptions<Details extends boolean = boolean> = ContactOptions<Details> & { defaultCountry?: CountryCode };
export type SingleFaviconOptions<Binary extends boolean = boolean> = ExtractionOptions & { binary?: Binary; all?: false };
export type AllFaviconsOptions = ExtractionOptions & { all: true; binary?: false };
export type FaviconOptions<Binary extends boolean = boolean> = SingleFaviconOptions<Binary> | AllFaviconsOptions;
export type SelectorOptions = ExtractionOptions & { selector: string; all?: boolean; format?: 'text' | 'html'; attribute?: string };
export type ImageSource = 'img' | 'srcset' | 'lazy' | 'metadata' | 'link' | 'background' | 'stylesheet';
export type ImagesOptions = ExtractionOptions & { unique?: boolean; includeMetadata?: boolean; sources?: ImageSource[]; /** Default true. */ includeStylesheets?: boolean };
export type SocialLinksOptions = ExtractionOptions & { platform?: Platform | 'twitter' };
export type ExtractionMetadata = {
  requestedUrl: string; finalUrl: string; rawFinalUrl: string;
  /** Original snapshot timestamp; preserved on cache hits. */
  capturedAt: string | null;
  /** Time this extraction result was produced. */
  extractedAt: string;
  captureMode: 'http' | 'browser'; status: number; contentType: string | null;
  dismissedOverlays: string[]; consent: ConsentMetadata; cache: { hit: boolean; ageMs: number; ttlMs: number };
};
export type ExtractionResult<T, K extends ExtractionType = ExtractionType> = ExtractionMetadata & { type: K; data: T };
export type ContentResult<K extends 'text' | 'html' = 'text' | 'html'> = ExtractionResult<string, K> & { content: string; format: K };
/** Compatibility name for HTML/text results. */
export type ExtractResult = ContentResult;
export type ExtractOptions = ContentOptions;
export type ExtractedImage = { url: string; width: number | null; height: number | null; scalable: boolean; resolutionVerified: boolean; contentType: string | null; source: string };
export type FaviconResult<Binary extends boolean = false> = ExtractionResult<Binary extends true ? Buffer : ExtractedImage, 'favicon'> & { image: ExtractedImage };
export type FaviconsResult = ExtractionResult<ExtractedImage[], 'favicon'> & { image: ExtractedImage; images: ExtractedImage[] };
export type AvatarData = { platform: Platform; profile: string | null; image: ExtractedImage };
export type ProfilePictureResult = ExtractionResult<AvatarData, 'avatar'> & AvatarData & { vendor: string };
export type ImageLink = { url: string; alt: string; width: number | null; height: number | null; source: ImageSource; originalAttribute: string; resolutionVerified: false; stylesheetUrl?: string };
export type ImagesResult = ExtractionResult<ImageLink[], 'images'> & { images: ImageLink[] };
export type SelectorResult = ExtractionResult<{ matched: boolean; values: Array<string | null> }, 'selector'> & { content: string; format: 'text' | 'html' };
export type SocialLink = { platform: Platform; url: string; kind: SocialKind; source: 'link' | 'rel-me' | 'metadata' | 'json-ld' };
export type SocialLinksResult = ExtractionResult<SocialLink[], 'social-links'> & { links: SocialLink[] };
export type ContactDetail = { value: string; raw: string; label: string | null; department: string | null; location: string | null };
export type TelephoneDetail = ContactDetail & { kind: 'fax' | 'mobile' | 'landline' | null };
export type EmailsResult<Details extends boolean = false> = ExtractionResult<Details extends true ? ContactDetail[] : string[], 'emails'> & { emails: Details extends true ? ContactDetail[] : string[] };
export type TelephoneResult<Details extends boolean = false> = ExtractionResult<Details extends true ? TelephoneDetail[] : string[], 'telephone'> & { numbers: Details extends true ? TelephoneDetail[] : string[] };
export type LinkLocation = { pageUrl: string; selector: string; attribute: 'href' | 'src' | 'data' | 'textContent' };
export type ExtractedLink = { url: string; rawUrl: string; text: string; rel: string[]; internal: boolean; source: 'a' | 'area' | 'link' | 'loc'; location: LinkLocation; lastmod?: string | null; changefreq?: string | null; priority?: number | null };
export type DocumentLink = Omit<ExtractedLink, 'source'> & {
  source: Exclude<ExtractedLink['source'], 'loc'> | 'iframe' | 'embed' | 'object';
  filename: string | null; extension: string | null; contentType: string | null;
  detectedBy: 'url' | 'query' | 'download' | 'type';
};
export type LinksResult = ExtractionResult<ExtractedLink[], 'links'> & { links: ExtractedLink[] };
export type DocumentsResult = ExtractionResult<DocumentLink[], 'documents'> & { documents: DocumentLink[] };
export type VideoLink = {
  url: string; rawUrl: string;
  source: string;
  originalAttribute: string; extension: string | null; contentType: string | null; platform: Platform | null;
  postUrl?: string;
};
export type VideosResult = ExtractionResult<VideoLink[], 'videos'> & { videos: VideoLink[] };
export type MetadataPerson = { name: string | null; url: string | null };
export type MetadataEvidence = { value: string; raw: string; source: 'html' | 'meta' | 'json-ld' | 'microdata'; field: string };
export type MetadataField = 'title' | 'description' | 'publishedAt' | 'modifiedAt';
export type PageMetadata = {
  title: string | null; description: string | null; canonical: string | null; language: string | null; publishedAt: string | null; modifiedAt: string | null;
  authors: MetadataPerson[]; publisher: MetadataPerson | null;
  openGraph: Record<string, string[]>; twitter: Record<string, string[]>;
  scientific: { doi: string | null; authors: string[]; journal: string | null; pdfUrl: string | null };
  sources: Record<MetadataField, MetadataEvidence | null>; alternatives: Record<MetadataField, MetadataEvidence[]>;
};
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };
export type MicrodataItem = { types: string[]; id: string | null; properties: Record<string, Array<string | MicrodataItem | null>> };
export type StructuredDataIssue = { source: 'json-ld' | 'microdata'; index: number; message: string };
export type ResolvedEntity = { id: string; types: string[]; properties: JsonObject };
export type StructuredData = { jsonLd: JsonObject[]; microdata: MicrodataItem[]; errors: StructuredDataIssue[]; resolved: { roots: string[]; entities: Record<string, ResolvedEntity> } };
export type MetadataResult = ExtractionResult<PageMetadata, 'metadata'> & { metadata: PageMetadata };
export type StructuredDataResult = ExtractionResult<StructuredData, 'structured-data'> & { structuredData: StructuredData };
export type PriceStatus = 'consistent' | 'conflict' | 'single_source' | 'ambiguous' | 'unavailable';
export type PriceRole = 'current' | 'list' | 'unit' | 'subscription' | 'installment' | 'range-min' | 'range-max';
export type PriceVariant = { size: string[]; color: string[]; material: string[]; model: string[]; configuration: string[] };
export type PriceProduct = { id: string | null; name: string | null; url: string | null; sku: string | null; variant?: PriceVariant };
export type ShippingQuantity = { min: string | null; max: string | null; unit: string | null };
export type PriceShipping = {
  cost: { amount: string; currency: string | null } | null;
  regions: Array<{ country: string | null; region: string | null; postalCode: string | null }>;
  deliveryTime: { handling: ShippingQuantity | null; transit: ShippingQuantity | null } | null;
};
export type PriceEvidence = {
  source: 'json-ld' | 'visible-dom' | 'microdata' | 'meta';
  document: 'raw' | 'rendered'; locator: string; url: string; raw: string;
  capturedAt: string; captureMode: 'http' | 'browser';
  scriptIndex?: number; attribute?: string;
  /** computed-visible records a completed browser CSS visibility check. */
  visibility?: 'static-not-hidden' | 'rendered-not-hidden' | 'computed-visible';
};
export type PriceCandidate = {
  amount: string; currency: string | null; role: PriceRole; raw: string;
  product: PriceProduct | null; association: 'matched' | 'uncertain';
  conditions: Record<string, string>; shipping: PriceShipping[]; evidence: PriceEvidence[];
};
export type PriceIssue = { code: string; message: string; document?: 'raw' | 'rendered'; scriptIndex?: number; locator?: string; raw?: string | null };
export type PriceData = { status: PriceStatus; selected: PriceCandidate | null; product: PriceProduct | null; candidates: PriceCandidate[]; issues: PriceIssue[]; context: { country: string | null; language: string | null } };
export type PriceResult = ExtractionResult<PriceData, 'price'>;
export type TrackerProvider = 'google-tag-manager' | 'google-analytics' | 'google-ads' | 'meta-pixel' | 'tiktok-pixel' | 'linkedin-insight' | 'pinterest-tag' | 'microsoft-clarity' | 'microsoft-advertising-uet' | 'hotjar' | 'yandex-metrica' | 'matomo' | 'plausible' | 'adobe-experience-platform-tags' | 'posthog' | 'umami' | 'goatcounter' | 'cloudflare-web-analytics' | 'simple-analytics' | 'reddit-pixel' | 'x-pixel';
export type TrackerIdentifier = { kind: 'container-id' | 'measurement-id' | 'tracking-id' | 'conversion-id' | 'pixel-id' | 'partner-id' | 'tag-id' | 'project-id' | 'site-id' | 'counter-id' | 'website-id' | 'project-token' | 'site-endpoint' | 'site-token' | 'library-id'; value: string; /** Self-hosted server endpoint where relevant; null means unscoped. */ scope?: string | null };
export type TrackerEvidence = { source: string; document: 'raw' | 'rendered'; field: string; index: number; tokenIndex?: number };
export type DetectedTracker = { provider: TrackerProvider; category: 'tag-manager' | 'analytics' | 'advertising'; identifiers: TrackerIdentifier[]; detection: 'confirmed_configuration' | 'provider_reference'; evidence: TrackerEvidence[]; configuration?: { trackedDomains: string[] } };
export type TrackerIntelligenceData = { trackers: DetectedTracker[]; externalHosts: string[]; summary: { providers: number; uniqueIdentifiers: number } };
export type TrackerIntelligenceResult = ExtractionResult<TrackerIntelligenceData, 'tracker-intelligence'>;
export type Metric = 'likes' | 'comments' | 'views' | 'shares' | 'saves' | 'followers' | 'following' | 'posts' | 'subscribers' | 'score' | 'stars' | 'forks' | 'karma';
export type InsightStatus = 'available' | 'partial' | 'unavailable' | 'unsupported' | 'login_required' | 'blocked' | 'extraction_error';
export type SocialInsightsData = {
  platform: Platform | null; kind: SocialKind; url: string;
  metrics: Record<Metric, number | null>;
  status: InsightStatus;
  sources: Partial<Record<Metric, { type: 'embedded-json' | 'json-ld' | 'vendor'; field: string; approximate: boolean | null }>>;
  unavailable: Partial<Record<Metric, string>>;
};
export type SocialInsightsResult = ExtractionResult<SocialInsightsData, 'social-insights'> & { vendor: Platform | null; followers: number | null };
export type ResultMap = { text: ContentResult<'text'>; html: ContentResult<'html'>; favicon: FaviconResult<boolean> | FaviconsResult; images: ImagesResult; videos: VideosResult; avatar: ProfilePictureResult; selector: SelectorResult; 'social-links': SocialLinksResult; 'social-insights': SocialInsightsResult; emails: EmailsResult<boolean>; telephone: TelephoneResult<boolean>; links: LinksResult; documents: DocumentsResult; metadata: MetadataResult; 'structured-data': StructuredDataResult; 'tracker-intelligence': TrackerIntelligenceResult; price: PriceResult };
export type OptionsMap = { text: ContentOptions; html: ContentOptions; favicon: FaviconOptions; images: ImagesOptions; videos: LinksOptions; avatar: ExtractionOptions; selector: SelectorOptions; 'social-links': SocialLinksOptions; 'social-insights': ExtractionOptions; emails: EmailOptions; telephone: TelephoneOptions; links: LinksOptions; documents: LinksOptions; metadata: ExtractionOptions; 'structured-data': ExtractionOptions; 'tracker-intelligence': ExtractionOptions; price: PriceOptions };
export type AnalysisType = 'favicon' | 'links' | 'social-links' | 'emails' | 'telephone' | 'images' | 'documents' | 'structured-data' | 'metadata' | 'tracker-intelligence' | 'price';
export type AnalysisOptions = ExtractionOptions & { defaultCountry?: CountryCode };
export type AnalysisResults = { [K in AnalysisType]: (K extends 'favicon' ? FaviconResult : K extends 'emails' ? EmailsResult : K extends 'telephone' ? TelephoneResult : ResultMap[K]) | null };
export type AnalysisIssue = { error: string; message: string; status?: number; phase?: string };
export type AnalysisDiagnostics = {
  requests: number; decodedBytes: number; httpMs: number; browserMs: number;
  rawSnapshotBytes: number; renderedSnapshotBytes: number; cacheHits: number;
  fallbackReasons: string[]; durationMs: number; sectionMs: Partial<Record<AnalysisType, number>>;
};
export type AnalysisResult = ExtractionMetadata & { type: 'analyse'; results: AnalysisResults; errors: Partial<Record<AnalysisType, AnalysisIssue>>; summary: { succeeded: number; failed: number }; diagnostics: AnalysisDiagnostics };
export declare function analyse(url: string, options?: AnalysisOptions): Promise<AnalysisResult>;
export declare function extract(url: string, options: AllFaviconsOptions & { type: 'favicon' }): Promise<FaviconsResult>;
export declare function extract<Binary extends boolean = false>(url: string, options: SingleFaviconOptions<Binary> & { type: 'favicon' }): Promise<FaviconResult<Binary>>;
export declare function extract<Details extends boolean = false>(url: string, options: EmailOptions<Details> & { type: 'emails' }): Promise<EmailsResult<Details>>;
export declare function extract<Details extends boolean = false>(url: string, options: TelephoneOptions<Details> & { type: 'telephone' }): Promise<TelephoneResult<Details>>;
export declare function extract<K extends ExtractionType>(url: string, options: OptionsMap[K] & { type: K }): Promise<ResultMap[K]>;
export declare function extract(url: string, options?: ContentOptions): Promise<ContentResult>;
export declare function extractText(url: string, options?: ContentOptions): Promise<ContentResult<'text'>>;
export declare function extractHtml(url: string, options?: ContentOptions): Promise<ContentResult<'html'>>;
export declare function extractLinks(url: string, options?: LinksOptions): Promise<LinksResult>;
export declare function extractDocuments(url: string, options?: LinksOptions): Promise<DocumentsResult>;
export declare function extractVideos(url: string, options?: LinksOptions): Promise<VideosResult>;
export declare function extractPrice(url: string, options?: PriceOptions): Promise<PriceResult>;
export declare function extractMetadata(url: string, options?: ExtractionOptions): Promise<MetadataResult>;
export declare function extractTrackerIntelligence(url: string, options?: ExtractionOptions): Promise<TrackerIntelligenceResult>;
export declare function extractStructuredData(url: string, options?: ExtractionOptions): Promise<StructuredDataResult>;
export declare function extractEmails<Details extends boolean = false>(url: string, options?: EmailOptions<Details>): Promise<EmailsResult<Details>>;
export declare function extractTelephone<Details extends boolean = false>(url: string, options?: TelephoneOptions<Details>): Promise<TelephoneResult<Details>>;
export declare function extractFavicon(url: string, options: AllFaviconsOptions): Promise<FaviconsResult>;
export declare function extractFavicon<Binary extends boolean = false>(url: string, options?: SingleFaviconOptions<Binary>): Promise<FaviconResult<Binary>>;
export declare function extractFavicon(url: string, options: FaviconOptions): Promise<FaviconResult<boolean> | FaviconsResult>;
export declare function extractImages(url: string, options?: ImagesOptions): Promise<ImagesResult>;
export declare function extractSelector(url: string, options: SelectorOptions): Promise<SelectorResult>;
export declare function extractSelector(url: string, selector: string, options?: Omit<SelectorOptions, 'selector'>): Promise<SelectorResult>;
export declare function extractSocialLinks(url: string, options?: SocialLinksOptions): Promise<SocialLinksResult>;
export declare function extractSocialInsights(url: string, options?: ExtractionOptions): Promise<SocialInsightsResult>;
export declare function extractSocialAvatar(url: string, options?: ExtractionOptions): Promise<ProfilePictureResult>;
export declare const extractProfilePicture: typeof extractSocialAvatar;
export type ClientConfiguration = ExtractionOptions & { /** Exact hostname or *.hostname rules, applied before per-call overrides. */ domainOptions?: Record<string, ExtractionOptions> };
export type ExtractorOptions = ClientConfiguration & { maxEntries?: number; maxCacheBytes?: number };
export type CaptureCacheStats = {
  hits: number; misses: number; deduplicated: number; loads: number; failures: number;
  evictions: number; expired: number; bypasses: number; entries: number; bytes: number;
  pending: number; maxEntries: number; maxCacheBytes: number;
};
export type Extractor = {
  /** Merge validated capture defaults for future calls on this client. */
  configure(options: ClientConfiguration): Extractor;
  getCacheStats(): CaptureCacheStats;
  analyse: typeof analyse; extract: typeof extract; extractText: typeof extractText; extractHtml: typeof extractHtml; extractLinks: typeof extractLinks; extractDocuments: typeof extractDocuments; extractVideos: typeof extractVideos; extractPrice: typeof extractPrice; extractMetadata: typeof extractMetadata; extractStructuredData: typeof extractStructuredData; extractTrackerIntelligence: typeof extractTrackerIntelligence; extractEmails: typeof extractEmails; extractTelephone: typeof extractTelephone; extractFavicon: typeof extractFavicon; extractImages: typeof extractImages; extractSelector: typeof extractSelector; extractSocialLinks: typeof extractSocialLinks; extractSocialInsights: typeof extractSocialInsights; extractSocialAvatar: typeof extractSocialAvatar; extractProfilePicture: typeof extractProfilePicture; clearCache(): void;
};
export declare function createExtractor(options?: ExtractorOptions): Extractor;
export declare function clearCache(): void;
export type SessionOptions = { sessionDir?: string; signal?: AbortSignal };
export type SavedSession = { session: string; origin: string; savedAt: string; cookieCount: number };
export type SessionInfo = SavedSession & { activeCookieCount: number };
export type LoginPage = {
  goto(url: string, options: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<{ status(): number } | null | void>;
  on?(event: 'close', listener: () => void): unknown;
  off?(event: 'close', listener: () => void): unknown;
};
export type LoginBrowser = {
  createBrowserContext(): Promise<{ newPage(): Promise<LoginPage>; cookies(): Promise<CaptureCookieData[]>; close(): Promise<void> }>;
  on?(event: 'disconnected', listener: () => void): unknown;
  off?(event: 'disconnected', listener: () => void): unknown;
  close(): Promise<void>;
};
export type LoginOptions = SessionOptions & {
  session?: string;
  /** Overall login timeout, default 300000 ms. */
  timeout?: number;
  allowPrivateNetwork?: boolean;
  /** Accept TLS certificate and hostname errors in the login browser; true by default. */
  insecure?: boolean;
  lookup?: ExtractionOptions['lookup'];
  /** Resolve after the user has signed in; receives no credentials. */
  confirm(info: { session: string; origin: string; signal: AbortSignal }): Promise<void>;
  launchBrowser?: (options: { headless: false; defaultViewport: null; acceptInsecureCerts: boolean; timeout: number; signal: AbortSignal; args: string[]; handleSIGINT: false; handleSIGTERM: false; handleSIGHUP: false }) => Promise<LoginBrowser>;
};
export declare function login(url: string, options: LoginOptions): Promise<SavedSession>;
export declare function listSessions(options?: SessionOptions): Promise<SessionInfo[]>;
export declare function logout(session: string, options?: SessionOptions): Promise<{ session: string; removed: boolean }>;
export type BulkLogoutResult = { removed: number; failed: number; sessions: Array<{ session: string; removed: boolean; error?: string }> };
export declare function logout(selection: string[] | { domain: string }, options?: SessionOptions): Promise<BulkLogoutResult>;
export declare class FetcharyError extends Error { url?: string }
export declare class FetcharyValidationError extends FetcharyError {}
export declare class FetcharyFetchError extends FetcharyError { status?: number }
export declare class FetcharyBrowserError extends FetcharyError { phase?: string; status?: number }
export declare class FetcharyNotFoundError extends FetcharyError {}
