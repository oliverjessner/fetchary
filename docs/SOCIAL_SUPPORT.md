# Social platform support

This matrix describes implemented, fixture-tested patterns in Fetchary.
Social sites can change their public markup, hide metrics, or require login.
YouTube channel video totals were also checked live on **2026-10-21**, using the
default and browser modes. Instagram reel description counts were checked live
with HTTP and auto mode on the same date. Reddit post attributes were inspected
in a live browser capture on that date; later requests encountered a Reddit
access block. Other coverage below is based on fixtures.

| Platform    | URL Recognition | Social Link Detection | Avatar Extraction | Follower Extraction     | Likes       | Comments    | Views       | Shares      | Profile Support | Post Support | Status  | Notes                                                                      |
| ----------- | --------------- | --------------------- | ----------------- | ----------------------- | ----------- | ----------- | ----------- | ----------- | --------------- | ------------ | ------- | -------------------------------------------------------------------------- |
| YouTube     | SUPPORTED       | SUPPORTED             | SUPPORTED         | SUPPORTED (subscribers) | SUPPORTED   | SUPPORTED   | SUPPORTED   | UNSUPPORTED | PARTIAL         | PARTIAL      | PARTIAL | Channel subscribers and video totals as posts; scoped video metrics, JSON-LD |
| TikTok      | SUPPORTED       | SUPPORTED             | SUPPORTED         | SUPPORTED               | SUPPORTED   | SUPPORTED   | SUPPORTED   | SUPPORTED   | PARTIAL         | PARTIAL      | PARTIAL | Scoped user/video state; saves also supported when collectCount is exposed |
| Instagram   | SUPPORTED       | SUPPORTED             | SUPPORTED         | SUPPORTED               | SUPPORTED   | SUPPORTED   | SUPPORTED   | UNSUPPORTED | PARTIAL         | PARTIAL      | PARTIAL | Scoped user/media state; views only when a video count exists              |
| Facebook    | SUPPORTED       | SUPPORTED             | UNSUPPORTED       | UNSUPPORTED             | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED     | UNSUPPORTED  | PARTIAL | URL recognition and links only                                             |
| X / Twitter | SUPPORTED       | SUPPORTED             | SUPPORTED         | SUPPORTED               | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | PARTIAL         | UNSUPPORTED  | PARTIAL | Existing matching-profile follower links and avatar parser                 |
| Threads     | SUPPORTED       | SUPPORTED             | SUPPORTED         | SUPPORTED               | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | PARTIAL         | UNSUPPORTED  | PARTIAL | Public profile JSON/description followers; no engagement parser            |
| LinkedIn    | SUPPORTED       | SUPPORTED             | SUPPORTED         | SUPPORTED               | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | PARTIAL         | UNSUPPORTED  | PARTIAL | Public/signed-in profile headers or matching JSON-LD followers             |
| Twitch      | SUPPORTED       | SUPPORTED             | SUPPORTED         | SUPPORTED               | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | PARTIAL         | UNSUPPORTED  | PARTIAL | Channel followers; subscriptions/viewers are not followers                 |
| Reddit      | SUPPORTED       | SUPPORTED             | UNSUPPORTED       | UNSUPPORTED             | UNSUPPORTED | SUPPORTED   | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED     | PARTIAL      | PARTIAL | Matching post score and comment total; score is separate from likes        |
| GitHub      | SUPPORTED       | SUPPORTED             | SUPPORTED         | SUPPORTED               | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | PARTIAL         | UNSUPPORTED  | PARTIAL | User follower links; repositories are not profiles                         |
| Vimeo       | SUPPORTED       | SUPPORTED             | UNSUPPORTED       | UNSUPPORTED             | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED     | UNSUPPORTED  | PARTIAL | URL recognition and links only                                             |
| Bluesky     | SUPPORTED       | SUPPORTED             | UNSUPPORTED       | UNSUPPORTED             | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED     | UNSUPPORTED  | PARTIAL | bsky.app profile/post URLs only; no firehose/API access                    |

Fixture verification date: **2026-10-21**. This date refers to offline tests,
including real Chromium serving local/injected HTML, not public-site requests.

## Shared behavior

Insight metrics are always the same ten fields: `likes`, `comments`, `views`,
`shares`, `saves`, `followers`, `following`, `posts`, `subscribers`, `score`. Missing values
stay `null`; unsupported combinations have an explicit reason. `available` means
all metrics implemented for this platform and URL kind were found, rather than
all ten fields. Compact counts have approximation metadata; some legacy
follower parsers retain unknown precision (`approximate: null`).

Authentication walls, challenge pages, entity mismatches, parser errors and
unsupported combinations are distinct in the [result schema](LIBRARY.md#result-schemas).
An existing session can be imported with `--cookies <file>` or, on macOS,
`--cookies-from-browser chrome`; see
[signed-in sessions](CLI.md#signed-in-sessions). The same metric parsers apply.

Tests: `test/semantic.test.js`,
`test/followers.test.js`,
`test/extract.test.js`,
`test/vendor-browser.test.js`,
`test/security.test.js`.

## YouTube

- URLs: `/@handle`, `/channel/id`, `/c/name`, `/user/name`, recognized channel tabs,
  `/watch?v=id`, `/shorts/id`, `/embed/id`, `/live/id`, and `youtu.be/id`.
- Channel insights: `subscribers`, not `followers`. The old top-level `followers`
  compatibility field can contain this subscriber count; `data.metrics` keeps
  their distinction. `posts` is the channel's reported video total, read from
  legacy header counts, modern embedded header metadata, or rendered channel
  metadata. English/German labels, grouped totals such as `14.361 Videos`, zero,
  and compact totals are supported. Recommendations and channel descriptions do
  not supply this count; hidden rendered metadata is ignored.
- Video insights: `views` from matching `videoDetails.videoId`; `likes` from scoped
  primary video actions; `comments` from scoped comment headers. Matching
  VideoObject JSON-LD supplies supported interaction statistics/comment counts.
  Rendered watch-page comment headers are bound to `ytd-watch-flexy[video-id]`,
  including localized headings such as `14 Kommentare` and reported zero counts.
- Avatar: channel header images, embedded header avatars, and verified square
  metadata fallback. Preview thumbnails are not channel avatars.
- Browser: optional when these fields exist in HTTP HTML; modern rendered fields
  may need it. Optional-cookie rejection and consent-form redirects are preserved.
  The watch-page comment heading is kept in view during the existing post-load
  wait to load the reported total. There is no comment pagination or sort change;
  a short wait or unavailable/disabled comments can leave the total unknown.
- Limits: only the documented player/header variants are implemented. Alternate
  mobile/modern button variants may expose no metric. Likes may be rounded or
  hidden; comment totals, subscriber counts and channel video totals may not be
  exposed. No shares, saves, following, or community-post totals.
- Fixtures: `test/fixtures/social/youtube-video.html`,
  `test/fixtures/social/youtube-channel.html`, `test/fixtures/social/youtube-channel-header.html`,
  `test/fixtures/social/youtube-comments.html`;
  `test/youtube-posts.test.js` covers channel video totals and metadata scope;
  `test/youtube-comments.test.js` covers lazy loading in real Chromium and CLI output.
  Their exact and compact
  fields, case-sensitive IDs, wrong videos and malformed scripts are tested.

## TikTok

- URLs: `/@username` profiles and `/@username/video/id` videos. Short-link hosts are
  recognized; their URL kind can remain unknown until extraction follows a redirect.
- Profile metrics: `followers`, `following`, `posts` from the matching userInfo
  `stats`/`statsV2` fields. The existing dedicated follower DOM counter is a fallback.
- Video metrics: `likes`, `comments`, `views`, `shares`, `saves` from matching
  itemStruct `stats`/`statsV2` (`diggCount`, `commentCount`, `playCount`, `shareCount`,
  `collectCount`). JSON-LD is another scoped source for supported fields.
- Avatar: matching user JSON, profile avatar elements, verified square metadata.
- Browser: optional for public state, otherwise rendered pages may be needed.
  Cookie banners, nested shadow roots and dismissible login dialogs are covered;
  CAPTCHA dialogs are preserved.
- Limits: missing/private counts remain unavailable. Profile total hearts are not
  reported as a video's likes. Recommendations with another identity are ignored.
  Saves are not guaranteed to be public on a live video.
- Fixtures: `test/fixtures/social/tiktok-profile.html`,
  `test/fixtures/social/tiktok-video.html`, including a genuine zero like
  count and recommendations with unrelated statistics.

## Instagram

- URLs: username profiles, `/p/shortcode`, `/reel/shortcode`, `/reels/shortcode`,
  and `/tv/shortcode`, including owner-prefixed `/username/reel/shortcode` and
  corresponding post/video forms. Shortcode case is significant.
- Profile metrics: `followers`, `following`, `posts` from matching user JSON;
  the existing matching follower-link/description parser remains a fallback.
- Post/reel metrics: `likes`, `comments`, `views` from matching shortcode media
  fields. JSON-LD can supply supported public interaction statistics. A fallback
  reads labelled like/comment totals from Open Graph, standard or Twitter
  descriptions only when the page's declared URLs match the requested media.
  English/German labels, grouped/compact counts and reported zero are covered;
  caption numbers and unrelated media never supply these description totals.
- Avatar: matching profile JSON, account-named image elements and verified square
  metadata fallback. Banners and rectangular preview images are excluded.
- Browser: optional for public embedded state; otherwise may be required for
  rendered content. Localized optional-cookie and dismissible login-dialog
  handling is tested. If optional auto rendering fails, usable partial HTTP
  insights are retained. Explicit browser failures and login/access walls retain
  their existing behavior.
- Limits: photos often have no view count, likes can be hidden, and login walls
  are common constraints. Shares/saves and private metrics are unsupported.
- Fixtures: `test/fixtures/social/instagram-profile.html`,
  `test/fixtures/social/instagram-post.html`, `test/fixtures/social/instagram-reel-metadata.html`,
  including unrelated accounts and case-sensitive wrong-post checks.
  `test/instagram-insights.test.js` covers metadata scope, source precedence,
  HTTP fallback, cancellation/access guards, real Chromium and CLI output.

## X / Twitter

- URLs: user profiles and `/user/status/id` posts, with both x.com and twitter.com.
- Implemented insight: profile `followers` from matching follower/verified-follower
  links, preferring exact tooltips when available.
- Avatar: matching profile-photo elements or account-specific JSON. No status/post
  engagement metrics are implemented.
- Browser: often necessary when public profile elements are rendered. Recognized
  optional-cookie and dismissible login dialogs remain supported. The browser
  user agent is not disguised; login/CAPTCHA access is never bypassed.
- Tests: `followers.test.js`, avatar cases in `extract.test.js`, and X cases in
  `vendor-browser.test.js`. No live access claim is made.

## Threads

- URLs: `/@username` profiles and `/@username/post/id` posts; link discovery
  recognizes threads.com and threads.net. The existing avatar/follower adapter
  matches threads.com, so a threads.net extraction may require its public redirect.
- Implemented insight: profile `followers` from matching JSON or description.
- Avatar: matching account JSON, named avatar images and verified square metadata.
- Browser: optional for embedded state, otherwise rendered profile data may be
  needed. Optional-cookie rejection is covered. No post engagement parser exists.
- Tests: Threads cases in `followers.test.js`, `extract.test.js`,
  `vendor-browser.test.js`; login and missing-field behavior use shared tests.

## LinkedIn

- URLs: `/in/`, `/company/`, `/school/`, `/showcase/` profiles and supported profile
  tabs. Post URLs are recognized for links but have no engagement parser.
- Implemented insight: profile `followers` from matching Person/Organization
  JSON-LD, dedicated counters, profile header/description metadata, or matching
  follower links. Connections, employees and post reactions are excluded.
- Signed-in SDUI profile headers use stable topcard identifiers and matching
  heading/photo profile links, including self-profile URLs. Labelled follower
  paragraphs inside that header are read independently of generated CSS classes;
  unrelated, nested recommendation and hidden cards are ignored.
- Avatar: profile header image or matching Person/Organization image/logo.
- Browser: optional for HTTP-exposed data; localized consent and dismissible login
  dialogs are covered. An HTTP avatar can supply a safe same-capture login-wall
  fallback. The guarded public HTTP follower fallback is retained at a same-platform login wall; insights still report `login_required` and identify `followerCountFromRaw` as the source.
- Sessions: `--session <name>` uses a Fetchary login; `--cookies <file>` or
  `--cookies-from-browser chrome` (macOS) imports an existing session into an
  isolated browser context. SDUI parsing is covered by supplied HTML and Chromium
  fixtures; successful live access still depends on the website's session checks.
- Limits: no post metrics or historical comparisons. Importing a session does not
  guarantee access or add support for other metrics.
- Tests: `linkedin.test.js` and the reduced `social/linkedin-profile.html` fixture,
  LinkedIn avatar cases in `extract.test.js`, real
  hidden/unrelated/challenge dialog guards in `vendor-browser.test.js`.

## Twitch

- URLs: channel profiles, `/username/about`, and `/videos/id` recognition.
- Implemented insight: channel `followers` from account-specific JSON or channel
  header elements. Viewers and paid subscriptions are not substituted.
- Avatar: matching account JSON or channel avatar elements.
- Browser: optional for embedded state, otherwise rendered channel content may be
  needed. Cookie and dismissible authentication dialogs are covered; content
  classification gates remain intact. Video engagement metrics are unsupported.
- Tests: `followers.test.js`, `extract.test.js`, `vendor-browser.test.js`.

## GitHub

- URLs: `/username` profiles. Repository and other non-profile paths do not yield
  follower insights. Links to github.com are still recognized as social references.
- Implemented insight: `followers` from a link targeting the requested user's
  `?tab=followers`, with exact tooltip preference.
- Avatar: profile avatar elements or matching account JSON. HTTP is usually
  sufficient when these fields are present; no browser-only requirement is imposed.
- Limits: following counts, repository metrics and post metrics are unsupported.
- Tests: `followers.test.js`, avatar cases in `extract.test.js`, and shared-cache
  avatar/follower cases in `capture-cache.test.js`.

## Reddit

- URLs: post/comment permalinks and `redd.it/id` links; `/user/name` and `/u/name`
  profiles remain recognized for link discovery.
- Post metrics: `score` and `comments` from the matching `shreddit-post` ID and
  permalink, or embedded `t3` post records with `score` and `num_comments`.
  Recommendations, comment scores and conflicting post identities are ignored.
- `score` is Reddit's reported net vote score, not an individual upvote total or
  like count. It can be negative. Hidden scores remain `null`, even when another
  source for the same post contains a number. The `likes` field is unsupported.
- Browser: optional when counters are present in HTTP; auto mode uses ordinary
  rendering for JavaScript-only pages. Reddit access blocks and login walls are
  preserved. Recognized JavaScript challenge pages are not cached.
- Limits: post-level metrics only, including when opened through a comment
  permalink. No profile/community metrics, individual upvotes/downvotes, views,
  shares, saves, avatar extraction, API requests, or comment pagination.
- Fixtures: `test/fixtures/social/reddit-post.html`, reduced from the observed
  post attributes; `test/reddit-insights.test.js` covers scoping, embedded JSON,
  missing/hidden counts, signed scores, Chromium, CLI and auto rendering.

## Facebook, Vimeo, and Bluesky

These adapters currently provide URL recognition and social link discovery only.
They expose no avatar or metric capability. Profile/post insights return
`unsupported`, regardless of HTTP/browser mode. Rendering does not grant a
capability the adapter lacks.

- Facebook: recognized profile/page, post/story/permalink, watch/video/reel URL
  patterns on facebook.com/fb.com. No scraping of authenticated Facebook data.
- Vimeo: numeric video IDs and simple profile paths.
- Bluesky: bsky.app `/profile/handle` and `/profile/handle/post/id`. Custom external
  domains are not treated as Bluesky URLs, and there is no firehose or API access.
- Tests: all-platform link discovery and filtering in `semantic.test.js`, plus
  explicit Facebook unsupported-metric availability. These tests cover URL/data
  handling only, never live platform reachability.
