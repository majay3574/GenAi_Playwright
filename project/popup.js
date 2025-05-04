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
  const prompt = `Generate a complete Playwright test script in TypeScript using the following selectors: ${JSON.stringify(elements)}

# Generate Playwright Page Object Model (POM) Class
Generate a Playwright Page Object Model (POM) class with ONLY the element-specific methods.
## Class Structure
'''typescript
import { expect, Page } from '@playwright/test';
class [YourClassName] {
    selectors = {
        // Define your selectors here
    };
    private page: Page;
}
## Selectors Object
Define selectors for each element:
'''typescript
selectors = {
    elementName1: '//xpath-selector',
    elementName2: '[css-selector]',
    inputField: '//input[@id="example"]',
};
## Element-Specific Methods
Create a method for EACH selector following exactly this pattern:
For clickable elements:
async elementName() {
    await this.click(this.selectors.elementName, "Element Display Name", "ElementType");
}
For input fields:
'''typescript
async inputFieldName(value: string) {
    await this.waitSelector(this.selectors.inputFieldName, "Input Field Display Name");
    await this.page.locator(this.selectors.inputFieldName).fill(value);
    console.log('Typed "value" into Input Field Display Name');
}
## IMPORTANT
- DO NOT include any utility method implementations (click, waitSelector, etc.)
- DO NOT include a constructor
- Create ONE method for EACH selector
- Name methods exactly the same as their selector names
- Include the proper display name and element type in the parameters
- For input elements, use page.locator().fill() pattern
- Output ONLY the code - no instruction text, comments, or explanations
Example output: --> follow the same pattern
'''typescript
import { BrowserContext, expect, Page } from '@playwright/test';
import { PlaywrightWrapper } from '../utils/playwright';
export class CourseCreationPage extends PlaywrightWrapper {
    constructor(page: Page, context: BrowserContext) {
        super(page, context);
    }
    public selectors = {
        h4_action_title_inactive: '//div[@class="ms-2 h4_action_title_inactive"]',
        learningTab: '//span[text()="Learning"]',
        courseLink: '//a[text()="Course"]',
    };
    async h4_action_title_inactive() {
        await this.click(this.selectors.h4_action_title_inactive, "h4 Action Title Inactive", "Div");
    }
    async learningTab() {
        await this.click(this.selectors.learningTab, "Learning Tab", "Span");
    }
    async courseLink() {
        await this.click(this.selectors.courseLink, "Course Link", "Link");
    }
}
 `;



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