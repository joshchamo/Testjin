// Content Script for Testjin QA Automation Runner

console.log("Testjin content script active.");


// Helper to determine if an element is visible on the page
function isElementVisible(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  
  const hasRealDimensions = rect.width > 2 && rect.height > 2;
  const isOnScreen = rect.top >= -10 && rect.left >= -10;
  const isNotHidden = style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
  
  return hasRealDimensions && isOnScreen && isNotHidden;
}

// Helper to send verbose matching logs back to the background worker to display in Vercel console
function verboseLog(message) {
  console.log(`[Testjin verbose] ${message}`);
  try {
    chrome.runtime.sendMessage({ type: "VERBOSE_LOG", message });
  } catch (e) {
    // Ignore runtime error if message channel is closed
  }
}

// Custom locator resolver. Supports standard CSS, XPath, and :has-text() with value fallback for input elements.
function findElement(selector) {
  if (!selector) return null;

  let fallbackHiddenElement = null;

  // 1. Try standard CSS first (handles #id, .class, [data-test])
  // We prioritize visible matching elements over hidden ones to prevent "ghost clicks"
  try {
    const elements = Array.from(document.querySelectorAll(selector));
    const visibleEl = elements.find(el => isElementVisible(el));
    if (visibleEl) {
      verboseLog(`[SmartFinder] Selector "${selector}" resolved to a visible element via native CSS query.`);
      return visibleEl;
    }
    if (elements.length > 0) {
      fallbackHiddenElement = elements[0];
      verboseLog(`[SmartFinder] Selector "${selector}" matched hidden elements. Holding as last resort fallback.`);
    }
  } catch (e) {
    verboseLog(`[SmartFinder] Selector "${selector}" threw standard CSS query error. Trying fallbacks...`);
  }

  // 2. Generic Submit/Search Button Fallback
  // If the LLM guessed the wrong tag/class for a submit/search button, search for typical form submit or end buttons
  if (selector.includes("type='submit'") || selector.includes('type="submit"') || selector.includes('submit')) {
    const genericSubmit = Array.from(document.querySelectorAll('button[type="submit"], input[type="submit"], button[name="submit"], button.cdx-search-input__end-button, .cdx-search-input__end-button'))
      .find(el => isElementVisible(el));
    if (genericSubmit) {
      verboseLog(`[SmartFinder] Generic submit fallback resolved: <${genericSubmit.tagName.toLowerCase()}>`);
      return genericSubmit;
    }
  }

  // 2.5 Universal Search Fallback
  // If the LLM generates a bad search locator, grab the most obvious search input on the page
  if (selector.toLowerCase().includes('search')) {
    const genericSearch = Array.from(document.querySelectorAll('input[type="search"], input[name="search"], input[placeholder*="Search" i], input[placeholder*="search" i]'))
      .find(el => isElementVisible(el));
    if (genericSearch) {
      verboseLog(`[SmartFinder] Engaged Universal Search Fallback: <${genericSearch.tagName.toLowerCase()}>`);
      return genericSearch;
    }
  }

  // 3. Handle XPath selectors
  if (selector.startsWith('/') || selector.startsWith('//')) {
    try {
      const result = document.evaluate(selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      if (result.singleNodeValue) {
        verboseLog(`[SmartFinder] XPath "${selector}" successfully evaluated.`);
        return result.singleNodeValue;
      }
    } catch (e) {
      verboseLog(`[SmartFinder] XPath "${selector}" evaluation threw error: ${e.message}`);
    }
  }

  // 3.5 Button Text Translator Fallback
  // If the LLM generates [value='Search'], but the site uses <button>Search</button>
  const valueMatch = selector.match(/\[value=['"](.*?)['"]\]/);
  if (valueMatch) {
    const targetText = valueMatch[1].toLowerCase();
    
    // Find all buttons on the page
    const allButtons = Array.from(document.querySelectorAll('button'));
    
    // Find the first visible button that contains the text
    const matchingButton = allButtons.find(btn => {
      const isVisible = isElementVisible(btn);
      const hasText = btn.innerText && btn.innerText.toLowerCase().includes(targetText);
      return isVisible && hasText;
    });

    if (matchingButton) {
      verboseLog(`[SmartFinder] Translated [value='${targetText}'] to visible button: <${matchingButton.tagName.toLowerCase()}>`);
      return matchingButton;
    }
  }

  // 4. Playwright :has-text() Fallback Engine
  if (selector.includes('has-text')) {
    // Extract the tag and the text. e.g., "button:has-text('Login')" -> tag: "button", text: "Login"
    const match = selector.match(/(.*?):has-text\(['"](.*?)['"]\)/);
    
    if (match) {
      const tag = match[1] || '*';
      const searchText = match[2].toLowerCase();
      verboseLog(`[SmartFinder] Parsing Playwright has-text helper: Tag "${tag}" containing text "${searchText}"`);
      
      try {
        const elements = Array.from(document.querySelectorAll(tag));
        // Find first element that matches text content OR value attribute (for input type=submit/button) and is visible
        const matched = elements.find(el => {
          const isVisible = isElementVisible(el);
          if (!isVisible) return false;
          const innerMatch = (el.innerText || el.textContent || '').toLowerCase().includes(searchText);
          const valueMatch = el.value && typeof el.value === 'string' && el.value.toLowerCase().includes(searchText);
          return innerMatch || valueMatch;
        });
        if (matched) {
          verboseLog(`[SmartFinder] has-text matched element <${matched.tagName.toLowerCase()}> with value/innerText containing "${searchText}".`);
          return matched;
        }
      } catch (err) {
        verboseLog(`[SmartFinder] Error searching tag "${tag}": ${err.message}`);
      }
    }
  }

  // 5. Ultimate fallback: literal text matching across typical clickable tag types
  try {
    const cleanSelector = selector.replace(/['"]/g, '').toLowerCase();
    verboseLog(`[SmartFinder] Executing text fallback lookup for text: "${cleanSelector}"`);
    const elements = Array.from(document.querySelectorAll('button, a, input[type="submit"], input[type="button"], label, span, div, h1, h2, h3, p'));
    const matched = elements.find(el => {
      const isVisible = isElementVisible(el);
      if (!isVisible) return false;
      const innerMatch = (el.innerText || el.textContent || '').toLowerCase().includes(cleanSelector);
      const valueMatch = el.value && typeof el.value === 'string' && el.value.toLowerCase().includes(cleanSelector);
      return innerMatch || valueMatch;
    });
    if (matched) {
      verboseLog(`[SmartFinder] Text fallback found matching element <${matched.tagName.toLowerCase()}>.`);
      return matched;
    }
  } catch (e) {
    verboseLog(`[SmartFinder] Fallback search failed: ${e.message}`);
  }

  // Absolute last resort fallback: return the first matching hidden element from native query
  if (fallbackHiddenElement) {
    verboseLog(`[SmartFinder] Returning last resort hidden matching element: <${fallbackHiddenElement.tagName.toLowerCase()}>`);
    return fallbackHiddenElement;
  }

  verboseLog(`[SmartFinder] Selector "${selector}" could not be resolved in DOM.`);
  return null;
}

// Playwright-like auto-waiting helper
function waitForElement(selector, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    // Check if it's already there
    const existing = findElement(selector);
    if (existing && isElementVisible(existing)) {
      return resolve(existing);
    }

    const startTime = Date.now();

    // Setup MutationObserver to watch for DOM injections
    const observer = new MutationObserver(() => {
      const el = findElement(selector);
      if (el && isElementVisible(el)) {
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true
    });

    // Fallback polling interval to check visibility changes
    const interval = setInterval(() => {
      const el = findElement(selector);
      if (el && isElementVisible(el)) {
        observer.disconnect();
        clearInterval(interval);
        resolve(el);
      } else if (Date.now() - startTime > timeoutMs) {
        observer.disconnect();
        clearInterval(interval);
        reject(new Error(`Timeout waiting for element: "${selector}" to be visible (after ${timeoutMs}ms)`));
      }
    }, 250);
  });
}

// Simulates user entering value into input field (handles SPA input binding tracking)
function simulateFill(element, value) {
  element.focus();
  
  // React/Angular/Vue value setter override
  const prototype = Object.getPrototypeOf(element);
  const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set || 
                      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set ||
                      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  
  if (valueSetter) {
    valueSetter.call(element, value);
  } else {
    element.value = value;
  }
  
  // Fire the cascade of events React/SPAs expect from a real user typing
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
  element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  element.dispatchEvent(new Event('blur', { bubbles: true }));
}

// Simulates user mouse click
function simulateClick(element) {
  // Scroll it into view (Playwright does this automatically)
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  element.focus();
  
  // Dispatch a full click event sequence to satisfy React synthetic event pooling
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
  element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
  
  // Trigger standard browser native click behaviors
  element.click();

  // Force form submission if this is a submit element as a bulletproof fallback
  if (element.type === 'submit' || element.getAttribute('type') === 'submit') {
    const parentForm = element.closest('form');
    if (parentForm) {
      verboseLog("[SmartFinder] Submit button detected. Forcing parent form submission event...");
      try {
        parentForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      } catch (err) {
        verboseLog(`[SmartFinder] Form submission dispatch error: ${err.message}`);
      }
    }
  }
}

// Visually flashes/pulses element right before interacting to show what action is running
function highlightElement(element) {
  const originalOutline = element.style.outline;
  const originalBoxShadow = element.style.boxShadow;
  const originalTransition = element.style.transition;
  
  element.style.transition = 'outline 0.15s ease-in-out, box-shadow 0.15s ease-in-out';
  element.style.outline = "4px solid #00ffcc";
  element.style.boxShadow = "0 0 12px #00ffcc";
  
  setTimeout(() => {
    element.style.outline = originalOutline;
    element.style.boxShadow = originalBoxShadow;
    element.style.transition = originalTransition;
  }, 700);
}

// Message listener from background worker
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "EXECUTE_ACTION") {
    const { action, stepIndex } = request;
    console.log(`[Step ${stepIndex + 1}] Executing:`, action);

    // URL Assertion (does not wait for a DOM element)
    if (action.action === "assertUrl") {
      const currentUrl = window.location.href;
      const expectedUrl = action.value;
      if (currentUrl.toLowerCase().includes(expectedUrl.toLowerCase())) {
        sendResponse({ status: "success", message: `URL verified: contains "${expectedUrl}"` });
      } else {
        sendResponse({ status: "error", error: `AssertUrl failed: Expected URL to contain "${expectedUrl}", but got "${currentUrl}"` });
      }
      return true;
    }

    waitForElement(action.locator)
      .then((element) => {
        // Highlight element to guide user eye
        highlightElement(element);
        
        // Wait 600ms for pulse flash to show before completing action
        setTimeout(() => {
          if (action.action === "click") {
            element.scrollIntoView({ block: 'center', inline: 'center' });
            simulateClick(element);
            sendResponse({ status: "success", message: `Clicked element: "${action.locator}"` });
          } else if (action.action === "fill") {
            element.scrollIntoView({ block: 'center', inline: 'center' });
            
            // Check if the LLM appended our Cypress-style {enter} command
            const hasEnterTrigger = action.value.toLowerCase().endsWith('{enter}');
            const cleanValue = hasEnterTrigger ? action.value.slice(0, -7) : action.value;
            
            simulateFill(element, cleanValue);
            
            // If {enter} was present, fire the submission keystrokes!
            if (hasEnterTrigger) {
              verboseLog("Smart Finder: Firing {enter} keystroke");
              element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
              element.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
              element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
              
              // Fallback: Force a native HTML form submission
              const parentForm = element.closest('form');
              if (parentForm) {
                verboseLog("Smart Finder: Bypassing JS and forcing native form submission");
                window.HTMLFormElement.prototype.submit.call(parentForm);
              }
            }
            sendResponse({ status: "success", message: `Filled element "${action.locator}" with "${cleanValue}"${hasEnterTrigger ? ' and pressed Enter' : ''}` });
          } else if (action.action === "assertVisible") {
            element.scrollIntoView({ block: 'center', inline: 'center' });
            sendResponse({ status: "success", message: `Asserted element is visible: "${action.locator}"` });
          } else if (action.action === "assertText") {
            element.scrollIntoView({ block: 'center', inline: 'center' });
            const val = (element.value || element.textContent || '').trim();
            if (val.toLowerCase().includes(action.value.toLowerCase())) {
              sendResponse({ status: "success", message: `AssertText verified: "${action.value}" matches element content` });
            } else {
              sendResponse({ status: "error", error: `AssertText failed: Expected "${action.value}", found "${val}"` });
            }
          } else {
            sendResponse({ status: "error", error: `Unsupported action type: "${action.action}"` });
          }
        }, 600);
      })
      .catch((err) => {
        console.error(`[Step ${stepIndex + 1}] Action failed:`, err);
        sendResponse({ status: "error", error: err.message });
      });

    return true; // Keep message channel open for async response
  }
});
