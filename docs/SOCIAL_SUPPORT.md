# Social platform support

This matrix describes implemented, fixture-tested patterns in Fetchary.
Attention: Social sites can change their
public markup, hide metrics, or require login. No live social-site verification
was performed for this refactor.

| Platform    | URL Recognition | Social Link Detection | Avatar Extraction | Follower Extraction     | Likes       | Comments    | Views       | Shares      | Profile Support | Post Support | Status  | Notes                                                                      |
| ----------- | --------------- | --------------------- | ----------------- | ----------------------- | ----------- | ----------- | ----------- | ----------- | --------------- | ------------ | ------- | -------------------------------------------------------------------------- |
| YouTube     | SUPPORTED       | SUPPORTED             | SUPPORTED         | SUPPORTED (subscribers) | SUPPORTED   | SUPPORTED   | SUPPORTED   | UNSUPPORTED | PARTIAL         | PARTIAL      | PARTIAL | Channel subscribers; matching video player state, primary actions, JSON-LD |
| TikTok      | SUPPORTED       | SUPPORTED             | SUPPORTED         | SUPPORTED               | SUPPORTED   | SUPPORTED   | SUPPORTED   | SUPPORTED   | PARTIAL         | PARTIAL      | PARTIAL | Scoped user/video state; saves also supported when collectCount is exposed |
| Instagram   | SUPPORTED       | SUPPORTED             | SUPPORTED         | SUPPORTED               | SUPPORTED   | SUPPORTED   | SUPPORTED   | UNSUPPORTED | PARTIAL         | PARTIAL      | PARTIAL | Scoped user/media state; views only when a video count exists              |
| Facebook    | SUPPORTED       | SUPPORTED             | UNSUPPORTED       | UNSUPPORTED             | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED     | UNSUPPORTED  | PARTIAL | URL recognition and links only                                             |
| X / Twitter | SUPPORTED       | SUPPORTED             | SUPPORTED         | SUPPORTED               | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | PARTIAL         | UNSUPPORTED  | PARTIAL | Existing matching-profile follower links and avatar parser                 |
| Threads     | SUPPORTED       | SUPPORTED             | SUPPORTED         | SUPPORTED               | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | PARTIAL         | UNSUPPORTED  | PARTIAL | Public profile JSON/description followers; no engagement parser            |
| LinkedIn    | SUPPORTED       | SUPPORTED             | SUPPORTED         | SUPPORTED               | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | PARTIAL         | UNSUPPORTED  | PARTIAL | Profile/company header or matching JSON-LD followers                       |
| Twitch      | SUPPORTED       | SUPPORTED             | SUPPORTED         | SUPPORTED               | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | PARTIAL         | UNSUPPORTED  | PARTIAL | Channel followers; subscriptions/viewers are not followers                 |
| Reddit      | SUPPORTED       | SUPPORTED             | UNSUPPORTED       | UNSUPPORTED             | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED     | UNSUPPORTED  | PARTIAL | URL recognition and links only                                             |
| GitHub      | SUPPORTED       | SUPPORTED             | SUPPORTED         | SUPPORTED               | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | PARTIAL         | UNSUPPORTED  | PARTIAL | User follower links; repositories are not profiles                         |
| Vimeo       | SUPPORTED       | SUPPORTED             | UNSUPPORTED       | UNSUPPORTED             | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED     | UNSUPPORTED  | PARTIAL | URL recognition and links only                                             |
| Bluesky     | SUPPORTED       | SUPPORTED             | UNSUPPORTED       | UNSUPPORTED             | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED     | UNSUPPORTED  | PARTIAL | bsky.app profile/post URLs only; no firehose/API access                    |

Fixture verification date: **2026-10-16**. This date refers to offline tests,
including real Chromium serving local/injected HTML, not public-site requests.

## Shared behavior

Insight metrics are always the same nine fields: `likes`, `comments`, `views`,
`shares`, `saves`, `followers`, `following`, `posts`, `subscribers`. Missing values
stay `null`; unsupported combinations have an explicit reason. `available` means
all metrics implemented for this platform and URL kind were found, rather than
all nine fields. Compact counts have approximation metadata; some legacy
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
  their distinction.
- Video insights: `views` from matching `videoDetails.videoId`; `likes` from scoped
  primary video actions; `comments` from scoped comment headers. Matching
  VideoObject JSON-LD supplies supported interaction statistics/comment counts.
- Avatar: channel header images, embedded header avatars, and verified square
  metadata fallback. Preview thumbnails are not channel avatars.
- Browser: optional when these fields exist in HTTP HTML; modern rendered fields
  may need it. Optional-cookie rejection and consent-form redirects are preserved.
- Limits: only the documented player/header variants are implemented. Alternate
  mobile/modern button variants may expose no metric. Likes may be rounded or
  hidden; comment totals and subscriber counts may not be exposed. No shares,
  saves, following, or post-count extraction.
- Fixtures: `test/fixtures/social/youtube-video.html`,
  `test/fixtures/social/youtube-channel.html`; their exact and compact
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
  and `/tv/shortcode`. Shortcode case is significant.
- Profile metrics: `followers`, `following`, `posts` from matching user JSON;
  the existing matching follower-link/description parser remains a fallback.
- Post/reel metrics: `likes`, `comments`, `views` from matching shortcode media
  fields. JSON-LD can supply supported public interaction statistics.
- Avatar: matching profile JSON, account-named image elements and verified square
  metadata fallback. Banners and rectangular preview images are excluded.
- Browser: optional for public embedded state; otherwise may be required for
  rendered content. Localized optional-cookie and dismissible login-dialog
  handling is tested. Login pages and inaccessible controls remain intact.
- Limits: photos often have no view count, likes can be hidden, and login walls
  are common constraints. Shares/saves and private metrics are unsupported.
- Fixtures: `test/fixtures/social/instagram-profile.html`,
  `test/fixtures/social/instagram-post.html`, including unrelated accounts
  and case-sensitive wrong-post checks.

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
- Avatar: profile header image or matching Person/Organization image/logo.
- Browser: optional for HTTP-exposed data; localized consent and dismissible login
  dialogs are covered. An HTTP avatar can supply a safe same-capture login-wall
  fallback. The guarded public HTTP follower fallback is retained at a same-platform login wall; insights still report `login_required` and identify `followerCountFromRaw` as the source.
- Sessions: `--cookies <file>` or `--cookies-from-browser chrome` (macOS) imports an existing session into an isolated
  browser context. Authenticated LinkedIn availability has not been live-verified.
- Limits: no post metrics or historical comparisons. Importing a session does not
  guarantee access or add support for other metrics.
- Tests: `linkedin.test.js`, LinkedIn avatar cases in `extract.test.js`, real
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

## Facebook, Reddit, Vimeo, and Bluesky

These adapters currently provide URL recognition and social link discovery only.
They expose no avatar or metric capability. Profile/post insights return
`unsupported`, regardless of HTTP/browser mode. Rendering does not grant a
capability the adapter lacks.

- Facebook: recognized profile/page, post/story/permalink, watch/video/reel URL
  patterns on facebook.com/fb.com. No scraping of authenticated Facebook data.
- Reddit: `/user/name`, `/u/name`, comment/post paths, and redd.it post links.
- Vimeo: numeric video IDs and simple profile paths.
- Bluesky: bsky.app `/profile/handle` and `/profile/handle/post/id`. Custom external
  domains are not treated as Bluesky URLs, and there is no firehose or API access.
- Tests: all-platform link discovery and filtering in `semantic.test.js`, plus
  explicit Facebook unsupported-metric availability. These tests cover URL/data
  handling only, never live platform reachability.
