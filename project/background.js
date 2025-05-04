// Handle communication between content script and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'elementSelected') {
    // Forward the selected element to the popup
    chrome.runtime.sendMessage(message);
    // Reopen the popup
    chrome.action.openPopup();
  }
  return true;
});
 
// Inject content script when needed
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startPicker') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs || tabs.length === 0) {
        console.error("No active tab found.");
        return;
      }
 
      const tab = tabs[0];
      if (!tab.id) {
        console.error("Tab ID is undefined.");
        return;
      }
 
      try {
        // Check if content script is already running
        await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
      } catch (error) {
        // Not running, inject content.js
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          });
        } catch (scriptError) {
          console.error("Failed to inject content script:", scriptError);
        }
      }
 
      // Now send the actual startPicker signal
      chrome.tabs.sendMessage(tab.id, message);
    });
  }
  return true;
});