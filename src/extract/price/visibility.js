'use strict';

// This function is serialized by Puppeteer; keep it independent of module scope.
async function capturePriceVisibility(page) {
  if (typeof page.evaluate !== 'function') return undefined;
  return page.evaluate(() => {
    const hidden = []; const hiddenSubtrees = [];
    const selectors = new WeakMap(); const positions = new WeakMap();
    const locator = element => {
      const pending = []; let node = element;
      while (node?.localName && !selectors.has(node)) { pending.push(node); node = node.parentElement; }
      let prefix = node ? selectors.get(node) : '';
      for (const current of pending.reverse()) {
        if (!positions.has(current)) {
          let index = 0;
          for (const sibling of current.parentNode?.children || [current]) positions.set(sibling,++index);
        }
        const part = `${/^[a-z][a-z0-9-]*$/.test(current.localName) ? current.localName : '*'}:nth-child(${positions.get(current)})`;
        prefix = prefix ? `${prefix} > ${part}` : part;
        selectors.set(current,prefix);
      }
      return prefix;
    };
    // Visibility can be overridden by descendants; display/opacity cannot.
    const pending = [...document.children].map(element => ({element,depth:0})); let checked = 0; let truncated = false;
    let remaining = 2 * 1024 * 1024;
    function mark(element, subtree) {
      const location = locator(element);
      remaining -= location.length;
      if (remaining < 0) { truncated = true; return false; }
      hidden.push(location); if (subtree) hiddenSubtrees.push(location);
      return true;
    }
    while (pending.length && checked++ < 10000) {
      const {element,depth} = pending.pop(); const style = getComputedStyle(element);
      if (style.display === 'none' || style.opacity === '0' || style.contentVisibility === 'hidden') {
        if (!mark(element,true)) break;
      } else {
        if (['hidden','collapse'].includes(style.visibility) && !mark(element,false)) break;
        if (depth >= 128) { if (element.children.length) truncated = true; }
        else for (const child of element.children) pending.push({element:child,depth:depth+1});
      }
    }
    return { hidden, hiddenSubtrees, truncated:truncated || pending.length > 0 };
  });
}

module.exports = { capturePriceVisibility };
