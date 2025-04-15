let selectedElements = [];

document.addEventListener('DOMContentLoaded', () => {
  // Load saved API key
  chrome.storage.sync.get(['geminiApiKey'], (result) => {
    if (result.geminiApiKey) {
      document.getElementById('apiKey').value = result.geminiApiKey;
    }
  });

  // Load saved elements (removes duplicates + absolute XPath)
  chrome.storage.sync.get(['selectedElements'], (result) => {
    if (result.selectedElements) {
      selectedElements = result.selectedElements
        .filter((sel, i, arr) => arr.indexOf(sel) === i && !isAbsoluteXPath(sel));
      updateElementsList();
      document.getElementById('generateTest').disabled = selectedElements.length === 0;
    }
  });

  // Save API key
  document.getElementById('saveApiKey').addEventListener('click', () => {
    const apiKey = document.getElementById('apiKey').value;
    if (!apiKey) {
      showStatus('Please enter an API key!', 'error');
      return;
    }
    chrome.storage.sync.set({ geminiApiKey: apiKey }, () => {
      showStatus('API key saved successfully!', 'success');
    });
  });

  // Start element picker
  document.getElementById('startPicker').addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      chrome.runtime.sendMessage({
        action: 'startPicker',
        tabId: tab.id
      });
    });
  });

  // Generate test
  document.getElementById('generateTest').addEventListener('click', async () => {
    try {
      const result = await chrome.storage.sync.get(['geminiApiKey']);
      if (!result.geminiApiKey) {
        showStatus('Please enter your Gemini API key first!', 'error');
        return;
      }

      if (selectedElements.length === 0) {
        showStatus('Please select at least one element first!', 'error');
        return;
      }

      showStatus('Generating test...', 'info');
      await generatePlaywrightTest(selectedElements, result.geminiApiKey);
    } catch (error) {
      showStatus('Error: ' + error.message, 'error');
    }
  });


  // Copy generated code
  document.getElementById('copyCode').addEventListener('click', () => {
    const code = document.querySelector('#codeOutput code').textContent;
    if (!code) {
      showStatus('No code to copy!', 'error');
      return;
    }
    navigator.clipboard.writeText(code).then(() => {
      showStatus('Code copied to clipboard!', 'success');
    });
  });

  // Listen for selected elements from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'elementSelected') {
      const selector = message.selector;

      // Prevent absolute XPath
      if (isAbsoluteXPath(selector)) {
        showStatus('Absolute XPath skipped!', 'info');
        return;
      }

      // Prevent duplicates
      if (selectedElements.includes(selector)) {
        showStatus('Selector already added!', 'info');
        return;
      }

      selectedElements.push(selector);
      chrome.storage.sync.set({ selectedElements });
      updateElementsList();
      document.getElementById('generateTest').disabled = false;
    }
    return true;
  });
});

function updateElementsList() {
  const list = document.getElementById('elementsList');
  list.innerHTML = '';

  selectedElements.forEach((selector, index) => {
    const li = document.createElement('li');
    const removeButton = document.createElement('button');
    removeButton.className = 'utility-button';
    removeButton.innerHTML = '❌';
    removeButton.onclick = () => removeElement(index);

    const span = document.createElement('span');
    span.textContent = selector;

    li.appendChild(span);
    li.appendChild(removeButton);
    list.appendChild(li);
  });
}

function removeElement(index) {
  selectedElements.splice(index, 1);
  chrome.storage.sync.set({ selectedElements });
  updateElementsList();
  document.getElementById('generateTest').disabled = selectedElements.length === 0;
}

async function generatePlaywrightTest(elements, apiKey) {
  const prompt ='Generate a complete Playwright test script in TypeScript using the following selectors: ' + JSON.stringify(elements) + '.' +
  '\n\nRequirements:' +
  '\n1. Use only valid Playwright imports: \'import { test, expect } from \'@playwright/test\';\'' +
  '\n2. Write a fully standalone \'.ts\' test file that can be executed directly using the Playwright test runner.' +
  '\n3. Include \'test.beforeEach\' to launch the browser and navigate to a sample URL (\'https://example.com\' as a placeholder).' +
  '\n4. Include \'test.afterEach\' to properly close the browser.' +
  '\n5. Use the Page Object Model (POM) pattern:' +
  '\n   - Create a class that accepts \'page\' in its constructor.' +
  '\n   - For each selector, write a method like \'public async newButton()\' that:' +
  '\n     • Uses a try/catch block' +
  '\n     • Waits for the selector using \'await this.page.waitForSelector(...)\' with a reasonable timeout' +
  '\n     • Validates visibility with \'await this.validateElementVisibility(selector, "Descriptive Name")\'' +
  '\n     • Executes \'await this.click(selector, "Label", "Type")\'' +
  '\n   - Reference selectors like \'selectors.selectorName\'' +
  '\n6. In the test block, create an instance of the class and call all generated methods.' +
  '\n7. Assume helper methods \'validateElementVisibility\' and \'click\' are already available.' +
  '\n8. Avoid any dynamic selectors (e.g., IDs that change per session). If a selector is unstable, use robust CSS or XPath instead.' +
  '\n9. Format the code using Playwright and TypeScript best practices — clean indentation, camelCase, and readable structure.' +
  '\n10. The generated file should be production-ready — no TODOs, placeholder logic, CLI commands, or comments. Output only the final \'.ts\' code file.';
  


  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 2048,
        }
      })
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    const data = await response.json();

    if (data.candidates && data.candidates[0].content.parts[0].text) {
      let generatedCode = data.candidates[0].content.parts[0].text;
      generatedCode = generatedCode.replace(/```typescript|```/g, '').trim();
      const codeElement = document.querySelector('#codeOutput code');
      const preElement = document.querySelector('#codeOutput');
      codeElement.textContent = '';
      codeElement.textContent = generatedCode;
      preElement.style.whiteSpace = 'pre-wrap';
      preElement.style.overflowX = 'auto';

      showStatus('Test generated successfully!', 'success');
    } else {
      throw new Error('No code generated from the API');
    }

  } catch (error) {
    console.error('Error generating test:', error);
    showStatus('Error generating test: ' + error.message, 'error');
  }
}

function showStatus(message, type) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = `status-message ${type}`;

  if (type === 'success' || type === 'info') {
    setTimeout(() => {
      status.className = 'status-message';
      status.textContent = '';
    }, 3000);
  }
}

function isAbsoluteXPath(selector) {
  return selector.startsWith('/html') || selector.startsWith('/body') || selector.startsWith('/div') || selector.startsWith('//html');
}
