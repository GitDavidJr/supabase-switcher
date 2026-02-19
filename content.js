// content.js – injected into supabase.com pages
// This file acts as a bridge to read/write localStorage from the page context.
// The background service worker uses chrome.scripting.executeScript with inline
// functions instead of messaging to this script, but this content script is
// kept here as a placeholder/listener for future use.

console.debug('[Supabase Switcher] Content script loaded.');
