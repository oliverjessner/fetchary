'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHTML } = require('linkedom');
const { BrowserCapture } = require('../src/capture/browser');

function instagramHtml(fixture) {
  const cookieLabel = fixture.cookieLabel || (fixture.german ? 'Optionale Cookies ablehnen' : '  Decline   optional cookies  ');
  const loginLabel = fixture.german ? 'Anmelden' : 'Log in';
  const closeLabel = fixture.german ? 'Schließen' : 'Close';
  let close = `<div role="button" id="close"><svg aria-label="${closeLabel}"><path d="M0 0"></path></svg></div>`;
  if (fixture.close === false) close = '';
  if (fixture.close === 'aria') close = `<button id="close" aria-label="${closeLabel}"></button>`;
  if (fixture.close === 'text') close = '<button id="close">Not now</button>';
  const inputs = '<input name="username"><input type="password" name="password">';
  const title = fixture.login === 'form' ? inputs
    : fixture.login === 'unrelated' ? '<h2>Instagram post</h2><p>Log in to Instagram to like this post.</p>'
      : `<span>${fixture.german ? 'Sieh dir Fotos, Videos und mehr von example an' : 'See photos, videos and more from example'}</span>`;
  const login = fixture.login === false ? ''
    : fixture.login === 'page' ? `<form id="login">${inputs}<button>${loginLabel}</button></form>`
      : `<div role="dialog" aria-modal="true" id="login">
        ${title}
        <button>${loginLabel}</button><button>${fixture.german ? 'Registrieren' : 'Sign up'}</button>
        <button style="display:none" data-decoy>Close</button>
        <button disabled data-decoy>Close</button>
        <div role="button" aria-disabled="true" data-decoy>Close</div>
        ${close}
      </div>`;
  const cookieControl = fixture.accessibleCookie
    ? `<div role="button" id="decline" aria-label="${cookieLabel}">Cookie choice</div>`
    : `<button id="decline">${cookieLabel}</button>`;
  const cookie = `<div role="dialog" aria-modal="true" id="consent">
    <h2>${fixture.german ? 'Cookies von Instagram' : 'Cookies from Instagram'}</h2>
    <button style="display:none" data-decoy>Decline optional cookies</button>
    <button disabled data-decoy>Decline optional cookies</button>
    <div role="button" aria-disabled="true" data-decoy>Decline optional cookies</div>
    <button data-decoy>Allow all cookies</button>${cookieControl}
  </div>`;

  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <main>Public Instagram profile</main>
    <button data-decoy>Decline optional cookies</button><button data-decoy aria-label="Close">Close</button>
    <script>
      const bindControls = () => {
        for (const element of document.querySelectorAll('[data-decoy]')) {
          element.onclick = () => { document.body.dataset.unwantedClick = 'true'; };
        }
        const close = document.querySelector('#close');
        if (close) close.onclick = () => { document.querySelector('#login').remove(); };
      };
      const showLogin = () => {
        document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(login)});
        bindControls();
      };
      const showConsent = () => {
        document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(cookie)});
        bindControls();
        document.querySelector('#decline').onclick = () => {
          document.querySelector('#consent').remove();
          ${fixture.delay ? `setTimeout(showLogin, ${fixture.delay});` : 'showLogin();'}
        };
      };
      ${fixture.cookie === false ? 'showLogin();' : fixture.delay ? `setTimeout(showConsent, ${fixture.delay});` : 'showConsent();'}
    </script>
  </body></html>`;
}

function videoPlatformHtml(vendor, fixture) {
  const tiktok = vendor === 'tiktok';
  const cookieLabel = fixture.unsupported ? 'Manage cookies'
    : fixture.german ? (tiktok ? 'Optionale Cookies ablehnen' : 'Ablehnen')
      : (tiktok ? '  Decline   optional cookies  ' : '  Reject  ');
  const cookieAttributes = tiktok ? 'data-e2e="cookie-banner"' : fixture.onetrust ? 'id="onetrust-banner-sdk"' : 'data-a-target="consent-banner"';
  const rejectAttributes = fixture.onetrust ? 'id="onetrust-reject-all-handler"' : 'id="reject"';
  const controls = `
    <button data-decoy style="display:none">${cookieLabel}</button>
    <button data-decoy disabled>${cookieLabel}</button>
    <div role="button" data-decoy aria-disabled="true">${cookieLabel}</div>
    <button data-decoy>Accept all</button>
    <button ${rejectAttributes} ${fixture.accessible ? `aria-label="${cookieLabel}"` : ''}>${fixture.accessible ? 'Cookie choice' : fixture.onetrust ? 'Refuser' : cookieLabel}</button>`;
  const cookie = `<div id="consent"><div ${cookieAttributes}><h2>Cookies</h2>${controls}</div></div>`;
  const closeLabel = fixture.german ? 'Schließen' : tiktok ? 'Close_button' : 'Close';
  const title = fixture.unrelated ? '<h2>Video settings</h2><p>Log in to see more videos.</p>'
    : fixture.german ? `<h2>Bei ${tiktok ? 'TikTok' : 'Twitch'} anmelden</h2>`
      : `<h2>Log in to ${tiktok ? 'TikTok' : 'Twitch'}</h2>`;
  let authAttributes = fixture.unrelated ? '' : tiktok ? 'data-e2e="login-modal"' : 'data-a-target="passport-modal"';
  if (fixture.titleOnly) authAttributes = '';
  const closeAttributes = fixture.markerClose ? (tiktok ? 'data-e2e="modal-close-inner-button"' : 'data-a-target="modalClose"') : `aria-label="${closeLabel}"`;
  const close = fixture.undismissible ? '' : `<button id="close" ${closeAttributes}></button>`;
  const authBody = `<div ${authAttributes}>${title}
    <form ${!tiktok && fixture.titleOnly ? 'name="login-submit-form"' : ''}><input name="username"><input type="password"><button data-decoy>Log in</button></form>
    <button data-decoy style="display:none" aria-label="${closeLabel}"></button>
    <button data-decoy disabled aria-label="${closeLabel}"></button>
    <div role="button" data-decoy aria-disabled="true" aria-label="${closeLabel}"></div>
    ${close}
  </div>`;
  const login = fixture.loginPage ? `<main id="login">${authBody}</main>`
    : `<div role="dialog" aria-modal="true" id="login" ${fixture.captcha ? 'class="captcha-verify-container"' : ''}>${authBody}</div>`;
  const verification = tiktok
    ? '<div role="dialog" id="verification" class="captcha-verify-container"><h2>Drag the slider to fit the puzzle</h2><button data-decoy id="captcha_close_button" aria-label="Close">Close</button></div>'
    : '<div role="dialog" id="verification" data-a-target="content-classification-gate-overlay"><h2>Mature content</h2><button data-decoy aria-label="Close">Close</button></div>';
  const shadow = Boolean(tiktok && fixture.shadow);

  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <main id="profile">Public ${vendor} profile</main>
    <button data-decoy>${cookieLabel}</button><button data-decoy aria-label="${closeLabel}">Close</button>
    ${verification}
    <script>
      const bindDecoys = root => {
        for (const element of root.querySelectorAll('[data-decoy]')) {
          element.onclick = () => { document.body.dataset.unwantedClick = 'true'; };
        }
      };
      const showLogin = () => {
        document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(login)});
        bindDecoys(document);
        const close = document.querySelector('#close');
        if (close) close.onclick = () => { document.querySelector('#login').remove(); };
      };
      const showConsent = () => {
        let root;
        if (${shadow}) {
          const host = document.createElement('tiktok-cookie-banner');
          host.id = 'consent';
          document.body.append(host);
          root = host.attachShadow({ mode: 'open' });
          if (${Boolean(fixture.nestedShadow)}) {
            const child = document.createElement('cookie-controls');
            root.append(child);
            root = child.attachShadow({ mode: 'open' });
          }
          root.innerHTML = ${JSON.stringify(controls)};
        } else {
          document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(cookie)});
          root = document.querySelector('#consent');
        }
        bindDecoys(root);
        root.querySelector('button#reject, #onetrust-reject-all-handler').onclick = () => {
          document.querySelector('#consent').remove();
          ${fixture.delay ? `setTimeout(showLogin, ${fixture.delay});` : 'showLogin();'}
        };
      };
      bindDecoys(document);
      ${fixture.cookies === false ? 'showLogin();' : fixture.delay ? `setTimeout(showConsent, ${fixture.delay});` : 'showConsent();'}
    </script>
  </body></html>`;
}


function linkedinHtml(fixture) {
  const decline = fixture.german ? 'Ablehnen' : 'Reject';
  const cookie = `<div id="consent" class="artdeco-global-alert--COOKIE_CONSENT" ${fixture.cookieAria ? 'aria-hidden="true"' : ''}>
    <button data-decoy disabled>${decline}</button><button data-decoy style="display:none">${decline}</button>
    <button data-decoy style="visibility:hidden" data-control-name="ga-cookie.consent.deny.v4">${decline}</button>
    <button data-decoy aria-disabled="true">${decline}</button><button data-decoy>Accept</button>
    <button id="reject" ${fixture.stable ? 'data-tracking-control-name="ga-cookie.consent.deny.v4"' : ''} ${fixture.accessible ? `aria-label="${decline}"` : ''}>${fixture.unsupported ? 'Manage cookies' : fixture.stable ? 'Refuser' : fixture.accessible ? 'Cookie choice' : decline}</button>
  </div>`;
  const title = fixture.unrelated ? 'Video settings' : fixture.portal ? 'Sign in to see who you already know at Example' : fixture.german ? 'Bei LinkedIn anmelden' : 'Sign in to LinkedIn';
  const auth = `<div id="login" ${fixture.hidden ? 'aria-hidden="true"' : ''} ${fixture.visibility ? 'style="visibility:hidden"' : ''} ${fixture.unrelated || fixture.titleOnly || fixture.portal ? 'role="dialog"' : 'class="contextual-sign-in-modal"'}>
    <section role="dialog"><h2>${title}</h2><form><input name="session_key"><input type="password"><button data-decoy>Sign in</button></form>
    ${fixture.challenge ? '<div id="captcha"><button data-decoy aria-label="Dismiss">Close</button></div>' : ''}
    <button data-decoy style="display:none" class="modal__dismiss" aria-label="Dismiss"></button><button data-decoy disabled aria-label="Dismiss"></button>
    ${fixture.undismissible ? '' : `<button id="close" ${fixture.portal ? 'data-tracking-control-name="organization_guest_contextual-sign-in-modal_modal_dismiss"' : ''} ${fixture.stableClose ? 'class="modal__dismiss"' : `aria-label="${fixture.german ? 'Schließen' : 'Dismiss'}"`}></button>`}
    </section></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
    ${fixture.authwall ? '<main>Sign in required</main>' : '<main><h1 class="top-card-layout__title">Example</h1><h3 class="top-card-layout__first-subline">Sunnyvale, CA 1,473 followers</h3></main>'}
    <aside>999,999 followers</aside><button data-decoy>${decline}</button><button data-decoy aria-label="Dismiss">Close</button>
    <script>
      const bind = () => {
        for (const element of document.querySelectorAll('[data-decoy]')) element.onclick = () => { document.body.dataset.unwantedClick = 'true'; };
        const reject = document.getElementById('reject');
        if (reject) reject.onclick = () => { document.getElementById('consent').remove(); };
        const close = document.getElementById('close');
        if (close) close.onclick = () => { document.getElementById('login').remove(); };
      };
      const show = () => { document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(cookie + auth)}); bind(); };
      bind();
      ${fixture.delay ? 'setTimeout(show, 35);' : 'show();'}
    </script></body></html>`;
}



for (const vendor of ['instagram','tiktok','twitch','linkedin']) {
  test(`${vendor} retains localized, delayed and guarded overlay behavior in real Chromium`, async t => {
    let activeHtml;
    const capture = new BrowserCapture();
    t.after(() => capture.close());
    const fixtures = { english:{}, german:{german:true}, delayed:{delay:35}, accessible:{accessible:true,accessibleCookie:true,close:'aria'},
      unrelated:{cookies:false,cookie:false,unrelated:true,login:'unrelated'}, undismissible:{cookies:false,cookie:false,undismissible:true,close:false},
      ...(vendor==='tiktok'?{shadow:{shadow:true,nestedShadow:true},captcha:{cookies:false,captcha:true}}:{}),
      ...(vendor==='linkedin'?{challenge:{challenge:true},hidden:{hidden:true},unsupported:{unsupported:true}}:{}),
    };
    for (const [name, fixture] of Object.entries(fixtures)) await t.test(name,async()=>{
      activeHtml = vendor === 'instagram' ? instagramHtml(fixture) : vendor === 'linkedin' ? linkedinHtml(fixture) : videoPlatformHtml(vendor,fixture);
      const url = vendor === 'tiktok' ? `https://www.tiktok.com/@${name}` : vendor === 'linkedin' ? `https://www.linkedin.com/company/${name}/` : `https://www.${vendor==='twitch'?'twitch.tv':'instagram.com'}/${name}/`;
      const result = await capture.capture({url,timeout:5000,waitAfterLoadMs:fixture.delay?300:0,maxResponseBytes:10*1024*1024,allowPrivateNetwork:true,userAgent:'fetchary/2.0',fetch:async()=>new Response(activeHtml,{headers:{'content-type':'text/html'}})});
      const document=parseHTML(result.renderedHtml).document;
      const preserved=fixture.unrelated||fixture.login==='unrelated'||fixture.undismissible||fixture.close===false||fixture.captcha||fixture.challenge||fixture.hidden;
      assert.equal(document.body.hasAttribute('data-unwanted-click'),false);
      if(!preserved) assert.ok(result.dismissedOverlays.includes(`${vendor}-login-dialog`));
      else assert.equal(result.dismissedOverlays.includes(`${vendor}-login-dialog`),false);
      if(fixture.cookies!==false && fixture.cookie!==false && !fixture.unsupported) assert.ok(result.dismissedOverlays.includes(`${vendor}-cookie-consent`));
      if(fixture.captcha) assert.ok(document.getElementById('verification'));
    });
  });
}

test('YouTube consent redirects are submitted without changing public content or leaking Chromium resources',async t=>{
  const capture=new BrowserCapture();t.after(()=>capture.close());
  let posted=false;
  const result=await capture.capture({url:'https://consent.youtube.com/m',timeout:5000,waitAfterLoadMs:0,maxResponseBytes:1024*1024,allowPrivateNetwork:true,userAgent:'fetchary/2.0',fetch:async(url,options)=>{
    if(url.includes('/save')) {posted=options.method==='POST';return new Response(null,{status:302,headers:{location:'https://www.youtube.com/@example'}});}
    return new Response(url.includes('consent.youtube.com')?'<html><body><h1>Before you continue to YouTube</h1><form action="/save" method="post"><button>Reject all</button><button>Accept all</button></form></body></html>':'<html><body><main>Public channel</main></body></html>',{headers:{'content-type':'text/html'}});
  }});
  assert.equal(posted,true);assert.equal(result.browserFinalUrl,'https://www.youtube.com/@example');
  assert.deepEqual(result.dismissedOverlays,['youtube-cookie-consent']);assert.match(result.renderedHtml,/Public channel/);
});

test('Threads and X retain optional-cookie and dismissible-dialog handling without UA disguise',async t=>{
  const capture=new BrowserCapture();t.after(()=>capture.close());
  const fixtures=[
    ['https://threads.com/@example','<div role="dialog" aria-modal="true" id="consent"><button onclick="this.parentNode.remove()">Decline optional cookies</button></div>',['threads-cookie-consent']],
    ['https://x.com/example','<button onclick="this.remove()">Refuse non-essential cookies</button><div role="dialog">Sign in to X<button aria-label="Close" onclick="this.parentNode.remove()">Close</button></div>',['x-cookie-consent','x-login-dialog']],
  ];
  for(const [url,html,expected] of fixtures) {
    const result=await capture.capture({url,timeout:5000,waitAfterLoadMs:0,maxResponseBytes:1024*1024,allowPrivateNetwork:true,userAgent:'fetchary/2.0',fetch:async()=>new Response(`<html><body><main>Public profile</main>${html}</body></html>`,{headers:{'content-type':'text/html'}})});
    assert.deepEqual(result.dismissedOverlays,expected);
  }
});
