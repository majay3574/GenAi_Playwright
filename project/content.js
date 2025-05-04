function updateElementInfo(element) {
  if (!infoPanel) {
    // Create info panel if it doesn't exist
    infoPanel = document.createElement('div');
    infoPanel.id = 'element-picker-info';
    infoPanel.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:rgba(0,0,0,0.8);color:white;padding:10px;z-index:999999;font-family:monospace;max-height:150px;overflow:auto;';
    document.body.appendChild(infoPanel);
  }
  
  // Generate preview of XPath
  const candidates = analyzeElementContext(element);
  candidates.sort((a, b) => b.score - a.score);
  const bestXPath = candidates.length > 0 ? candidates[0].xpath : '';
  
  // Create element info
  const tagName = element.tagName.toLowerCase();
  const id = element.id ? `id="${element.id}"` : '';
  const classes = element.className ? `class="${element.className}"` : '';
  
  infoPanel.innerHTML = `
    <div><strong>Element:</strong> &lt;${tagName} ${id} ${classes}&gt;</div>
    <div><strong>Likely XPath:</strong> <code>${bestXPath}</code></div>
    <div><small>Press ESC to cancel, or click to select this element</small></div>
  `;
}

function preventDefaultAction(e) {
  if (!isPickerActive) return;
  
  e.preventDefault();
  e.stopPropagation();
  return false;
}

let isPickerActive = false;
let highlightedElement = null;
let documentHTML = null;
let infoPanel = null;
 
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'ping') {
    sendResponse({ status: 'ok' });
    return true;
  }
 
  if (message.action === 'startPicker') {
    isPickerActive = true;
    enableElementPicker();
    
    // Send confirmation that picker is active
    sendResponse({ status: 'pickerActive' });
  }
 
  return true;
});

// New functions for improved XPath analysis with text-first approach
function analyzeElementContext(element) {
  const candidates = [];
  
  // First try text-based XPath (highest priority)
  const textXPath = createTextBasedXPath(element);
  if (textXPath) {
    candidates.push({ xpath: textXPath, score: 15, type: 'text' });
  }
  
  // Try to find an anchor element (a stable parent with ID or other reliable attribute)
  const anchorElement = findClosestAnchorElement(element);
  
  if (anchorElement && anchorElement !== element) {
    // Create relative XPath from anchor element to target element
    const relativeXPath = createRelativeXPath(anchorElement, element);
    if (relativeXPath) {
      candidates.push({ xpath: relativeXPath, score: 10, type: 'relative' });
    }
  }
  
  // Direct identifiable XPath as backup
  const directXPath = generateStableXPath(element);
  if (directXPath) candidates.push({ xpath: directXPath, score: 8, type: 'direct' });
  
  // Full path as last resort
  const fullXPath = generateFullXPath(element);
  if (fullXPath) candidates.push({ xpath: fullXPath, score: 5, type: 'full-path' });
  
  return candidates;
}

function createTextBasedXPath(element) {
  // Check if element has direct text content that's useful
  const directText = element.textContent?.trim();
  const tagName = element.tagName.toLowerCase();
  
  // For elements that typically contain text
  const textElements = ['a', 'button', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label', 'li', 'p', 'span', 'td', 'th'];
  
  if (directText && directText.length > 0 && directText.length < 100 && textElements.includes(tagName)) {
    // Escape quotes in text
    const safeText = directText.replace(/"/g, '\\"');
    
    // For elements with exact text match
    if (directText.length < 50) {
      const exactMatch = `//${tagName}[text()="${safeText}"]`;
      
      // Verify this XPath uniquely identifies the element
      try {
        const result = document.evaluate(exactMatch, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        if (result.snapshotLength === 1 && result.snapshotItem(0) === element) {
          return exactMatch;
        }
      } catch (e) {
        // Invalid XPath, continue to next approach
      }
    }
    
    // For elements whose text contains the value (for longer text or non-unique exact matches)
    const containsMatch = `//${tagName}[contains(text(),"${safeText.substring(0, Math.min(safeText.length, 40))}")]`;
    
    try {
      const result = document.evaluate(containsMatch, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      if (result.snapshotLength === 1 && result.snapshotItem(0) === element) {
        return containsMatch;
      }
    } catch (e) {
      // Invalid XPath, continue to next approach
    }
  }
  
  return null;
}

function findClosestAnchorElement(element) {
  // Maximum levels to traverse up
  const MAX_LEVELS = 4;
  let currentElement = element;
  let level = 0;
  
  while (currentElement && level < MAX_LEVELS) {
    // Check if current element has ID or other stable attributes
    if (hasStableIdentifier(currentElement)) {
      return currentElement;
    }
    
    // Move to parent element
    currentElement = currentElement.parentElement;
    level++;
  }
  
  // If no stable parent found, return the element itself
  return element;
}

function hasStableIdentifier(element) {
  if (!element) return false;
  
  // Check for text content first
  const directText = element.textContent?.trim();
  if (directText && directText.length > 0 && directText.length < 50 && isStatic(directText)) {
    const tagName = element.tagName.toLowerCase();
    const textElements = ['a', 'button', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label', 'li', 'p', 'span', 'td', 'th'];
    if (textElements.includes(tagName)) {
      return true;
    }
  }
  
  // Check ID (second priority)
  const id = element.getAttribute('id');
  if (id && isStatic(id)) return true;
  
  // Check placeholder (third priority)
  const placeholder = element.getAttribute('placeholder');
  if (placeholder && isStatic(placeholder)) return true;
  
  // Check other attributes in priority order
  const priorityAttrs = ['name', 'class', 'aria-label', 'data-testid', 'data-id', 'role', 'title'];
  for (const attr of priorityAttrs) {
    const value = element.getAttribute(attr);
    if (value && isStatic(value)) return true;
  }
  
  return false;
}

function createRelativeXPath(anchorElement, targetElement) {
  // Generate XPath for anchor element, following our priority order
  let anchorXPath = '';
  const anchorTagName = anchorElement.tagName.toLowerCase();
  
  // Try text-based XPath first
  const anchorText = anchorElement.textContent?.trim();
  const textElements = ['a', 'button', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label', 'li', 'p', 'span', 'td', 'th'];
  
  if (anchorText && anchorText.length > 0 && anchorText.length < 50 && textElements.includes(anchorTagName)) {
    const safeText = anchorText.replace(/"/g, '\\"');
    anchorXPath = `//${anchorTagName}[text()="${safeText}"]`;
    
    // Verify this XPath uniquely identifies the anchor
    try {
      const result = document.evaluate(anchorXPath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      if (result.snapshotLength !== 1 || result.snapshotItem(0) !== anchorElement) {
        // If not unique, try contains
        anchorXPath = `//${anchorTagName}[contains(text(),"${safeText.substring(0, Math.min(safeText.length, 40))}")]`;
        const containsResult = document.evaluate(anchorXPath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        if (containsResult.snapshotLength !== 1 || containsResult.snapshotItem(0) !== anchorElement) {
          anchorXPath = ''; // Reset if not unique
        }
      }
    } catch (e) {
      anchorXPath = ''; // Reset if invalid
    }
  }
  
  // If text-based didn't work, try ID
  if (!anchorXPath) {
    const anchorId = anchorElement.getAttribute('id');
    if (anchorId && isStatic(anchorId)) {
      anchorXPath = `//${anchorTagName}[@id="${anchorId}"]`;
    }
  }
  
  // If ID didn't work, try placeholder
  if (!anchorXPath) {
    const placeholder = anchorElement.getAttribute('placeholder');
    if (placeholder && isStatic(placeholder)) {
      anchorXPath = `//${anchorTagName}[@placeholder="${placeholder.replace(/"/g, '\\"')}"]`;
    }
  }
  
  // If still no luck, try other attributes
  if (!anchorXPath) {
    const priorityAttrs = ['name', 'class', 'aria-label', 'data-testid', 'data-id', 'role', 'title'];
    for (const attrName of priorityAttrs) {
      const value = anchorElement.getAttribute(attrName);
      if (value && isStatic(value)) {
        anchorXPath = `//${anchorTagName}[@${attrName}="${value.replace(/"/g, '\\"')}"]`;
        break;
      }
    }
  }
  
  // If no unique anchor found, give up on relative XPath
  if (!anchorXPath) {
    return null;
  }
  
  // If target is the anchor, just return the anchor XPath
  if (anchorElement === targetElement) {
    return anchorXPath;
  }
  
  // Find path from anchor to target
  const path = [];
  let current = targetElement;
  
  while (current && current !== anchorElement) {
    const parent = current.parentElement;
    if (!parent) break;
    
    const tagName = current.tagName.toLowerCase();
    
    // Try text-based selector first for the current element
    const text = current.textContent?.trim();
    let added = false;
    
    if (text && text.length > 0 && text.length < 50 && textElements.includes(tagName)) {
      const safeText = text.replace(/"/g, '\\"');
      // Check if this text is unique among siblings
      const textXPath = `${tagName}[text()="${safeText}"]`;
      
      try {
        const siblingResult = document.evaluate(textXPath, parent, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        if (siblingResult.snapshotLength === 1 && siblingResult.snapshotItem(0) === current) {
          path.unshift(textXPath);
          added = true;
        } else {
          // Try with contains
          const containsXPath = `${tagName}[contains(text(),"${safeText.substring(0, Math.min(safeText.length, 40))}")]`;
          const containsResult = document.evaluate(containsXPath, parent, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          if (containsResult.snapshotLength === 1 && containsResult.snapshotItem(0) === current) {
            path.unshift(containsXPath);
            added = true;
          }
        }
      } catch (e) {
        // Invalid XPath, continue to other methods
      }
    }
    
    // If text didn't work, try attributes in order of priority
    if (!added) {
      // Check ID first
      const id = current.getAttribute('id');
      if (id && isStatic(id)) {
        path.unshift(`${tagName}[@id="${id}"]`);
        added = true;
      }
      
      // Then placeholder
      if (!added) {
        const placeholder = current.getAttribute('placeholder');
        if (placeholder && isStatic(placeholder)) {
          path.unshift(`${tagName}[@placeholder="${placeholder.replace(/"/g, '\\"')}"]`);
          added = true;
        }
      }
      
      // Then other attributes
      if (!added) {
        const priorityAttrs = ['name', 'class', 'aria-label', 'data-testid', 'data-id', 'role', 'title'];
        for (const attrName of priorityAttrs) {
          if (added) break;
          
          const value = current.getAttribute(attrName);
          if (value && isStatic(value)) {
            path.unshift(`${tagName}[@${attrName}="${value.replace(/"/g, '\\"')}"]`);
            added = true;
          }
        }
      }
      
      // If no distinguishing attribute, use position
      if (!added) {
        // Get index of current among siblings of same type
        const siblings = Array.from(parent.children).filter(
          child => child.tagName === current.tagName
        );
        
        const index = siblings.indexOf(current) + 1;
        
        if (siblings.length > 1) {
          path.unshift(`${tagName}[${index}]`);
        } else {
          path.unshift(tagName);
        }
      }
    }
    
    current = parent;
  }
  
  if (path.length === 0) {
    return anchorXPath;
  }
  
  return `${anchorXPath}/${path.join('/')}`;
}

function findStableAttribute(element) {
  const tagName = element.tagName.toLowerCase();
  
  // First try text for appropriate elements
  const text = element.textContent?.trim();
  const textElements = ['a', 'button', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label', 'li', 'p', 'span', 'td', 'th'];
  
  if (text && text.length > 0 && text.length < 50 && textElements.includes(tagName) && isStatic(text)) {
    return { name: 'text()', value: text };
  }
  
  // Then try other attributes in priority order
  const priorityAttrs = [
    'id', 'placeholder', 'name', 'class', 'aria-label', 
    'data-testid', 'data-id', 'role', 'title'
  ];
  
  for (const attrName of priorityAttrs) {
    const value = element.getAttribute(attrName);
    if (value && isStatic(value)) {
      return { name: attrName, value };
    }
  }
  
  // Check all other non-style attributes
  for (const attr of element.attributes) {
    if (!['style', 'class'].includes(attr.name) && 
        !attr.name.startsWith('on') && 
        isStatic(attr.value)) {
      return { name: attr.name, value: attr.value };
    }
  }
  
  return null;
}

function getBestXPath(candidates, element) {
  if (candidates.length === 0) return null;
  
  // Sort by score (highest first)
  candidates.sort((a, b) => b.score - a.score);
  
  // First, try all text-based XPaths
  const textXPaths = candidates.filter(c => c.type === 'text');
  for (const candidate of textXPaths) {
    try {
      const nodes = document.evaluate(candidate.xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      if (nodes.snapshotLength === 1 && nodes.snapshotItem(0) === element) {
        return candidate.xpath;
      }
    } catch (e) {
      console.error("Invalid XPath:", candidate.xpath);
    }
  }
  
  // Then try all relative XPaths
  const relativeXPaths = candidates.filter(c => c.type === 'relative');
  for (const candidate of relativeXPaths) {
    try {
      const nodes = document.evaluate(candidate.xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      if (nodes.snapshotLength === 1 && nodes.snapshotItem(0) === element) {
        return candidate.xpath;
      }
    } catch (e) {
      console.error("Invalid XPath:", candidate.xpath);
    }
  }
  
  // If no unique relative XPath found, try others
  for (const candidate of candidates) {
    if (candidate.type === 'text' || candidate.type === 'relative') continue; // Already checked
    
    try {
      const nodes = document.evaluate(candidate.xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      if (nodes.snapshotLength === 1 && nodes.snapshotItem(0) === element) {
        return candidate.xpath;
      }
    } catch (e) {
      console.error("Invalid XPath:", candidate.xpath);
    }
  }
  
  // If no unique XPath found, return the highest scoring one
  return candidates[0].xpath;
}
 
function enableElementPicker() {
  document.body.style.cursor = 'crosshair';
  
  // Store the entire document HTML for analysis
  documentHTML = document.documentElement.outerHTML;
  
  // Add event listeners with capture phase to prevent navigation
  document.addEventListener('mouseover', highlightElement, true);
  document.addEventListener('click', selectElement, true);
  document.addEventListener('mousedown', preventDefaultAction, true);
  document.addEventListener('keydown', handleKeyPress, true);
  
  // Prevent all links and form submissions
  document.addEventListener('submit', preventDefaultAction, true);
  
  // Notify user that picker is active
  const notification = document.createElement('div');
  notification.textContent = 'Element picker active. Click on an element to select it, or press ESC to cancel.';
  notification.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#6366f1;color:white;padding:10px;z-index:999999;text-align:center;';
  notification.id = 'element-picker-notification';
  document.body.appendChild(notification);
}
 
function disableElementPicker() {
  isPickerActive = false;
  document.body.style.cursor = 'default';
  
  if (highlightedElement) {
    highlightedElement.style.outline = '';
  }
  
  // Remove all event listeners that were added
  document.removeEventListener('mouseover', highlightElement, true);
  document.removeEventListener('click', selectElement, true);
  document.removeEventListener('mousedown', preventDefaultAction, true);
  document.removeEventListener('keydown', handleKeyPress, true);
  document.removeEventListener('submit', preventDefaultAction, true);
  
  // Remove notification if it exists
  const notification = document.getElementById('element-picker-notification');
  if (notification) notification.remove();
  
  // Remove info panel if it exists
  if (infoPanel) {
    infoPanel.remove();
    infoPanel = null;
  }
  
  // Notify that picker has been disabled
  chrome.runtime.sendMessage({
    action: 'pickerDisabled'
  });
}
 
function highlightElement(e) {
  if (!isPickerActive) return;
 
  e.preventDefault();
  e.stopPropagation();
 
  if (highlightedElement) {
    highlightedElement.style.outline = '';
  }
 
  highlightedElement = e.target;
  highlightedElement.style.outline = '2px solid #6366f1';
  
  // Show element info
  updateElementInfo(highlightedElement);
}
 
function selectElement(e) {
  if (!isPickerActive) return;
 
  e.preventDefault();
  e.stopPropagation();
 
  const element = e.target;
  
  // Get the HTML content of the selected element
  const htmlContent = element.outerHTML;
  
  // Analyze the element and its context to find the most stable XPath
  const candidateXPaths = analyzeElementContext(element);
  const stableXPath = getBestXPath(candidateXPaths, element);
  const finalSelector = stableXPath || generateFullXPath(element);
  const selectorType = 'xpath';
 
  let action = '';
  const tagName = element.tagName.toLowerCase();
  const type = element.getAttribute('type');
 
  if (tagName === 'input') {
    if (type === 'checkbox' || type === 'radio') {
      action = 'check()';
    } else {
      action = 'fill()';
    }
  } else if (tagName === 'select') {
    action = 'selectOption()';
  } else if (tagName === 'textarea') {
    action = 'fill()';
  } else {
    action = 'click()';
  }
  
  // Clean up the info panel
  if (infoPanel) {
    infoPanel.remove();
    infoPanel = null;
  }
 
  chrome.runtime.sendMessage({
    action: 'elementSelected',
    selectorType,
    selector: `${finalSelector} → ${action}`,
    htmlContent: htmlContent
  });
 
  disableElementPicker();
}
 
function handleKeyPress(e) {
  if (e.key === 'Escape' && isPickerActive) {
    e.preventDefault();
    e.stopPropagation();
    disableElementPicker();
  }
}
 
function isStatic(value) {
  if (!value) return false;
  if (/\d{2,}|__|\[\d+\]|[a-f0-9]{8}/.test(value)) return false; // Avoid UUIDs and auto-generated IDs
  if (value.startsWith(':') || value.length < 3) return false;
  if (/^(row|col|btn|container|wrapper)\d+$/.test(value)) return false; // Avoid dynamic layout elements
  return true;
}
 
function generateStableXPath(el) {
  const tag = el.tagName.toLowerCase();
  
  // First try text-based XPath
  const text = el.textContent?.trim();
  const textElements = ['a', 'button', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label', 'li', 'p', 'span', 'td', 'th'];
  
  if (text && text.length > 0 && text.length < 50 && textElements.includes(tag) && isStatic(text)) {
    const safeText = text.replace(/"/g, '\\"');
    return `//${tag}[text()="${safeText}"]`;
  }
  
  // Then try ID
  const id = el.getAttribute('id');
  if (id && isStatic(id)) {
    return `//${tag}[@id="${id}"]`;
  }
  
  // Then placeholder
  const placeholder = el.getAttribute('placeholder');
  if (placeholder && isStatic(placeholder)) {
    const safePlaceholder = placeholder.replace(/"/g, '\\"');
    return `//${tag}[@placeholder="${safePlaceholder}"]`;
  }
  
  // Then try other attributes in priority order
  const priorityAttrs = ['name', 'class', 'aria-label', 'data-testid', 'data-id', 'role', 'title'];
  
  for (const attrName of priorityAttrs) {
    const value = el.getAttribute(attrName);
    if (value && isStatic(value)) {
      const safeValue = value.replace(/"/g, '\\"');
      return `//${tag}[@${attrName}="${safeValue}"]`;
    }
  }
  
  return null;
}
 
function generateFullXPath(el) {
  if (el.nodeType !== 1) return '';
  
  // Try to find a text-based XPath first
  const textXPath = createTextBasedXPath(el);
  if (textXPath) return textXPath;
  
  // Try to find an anchor first
  const anchorElement = findClosestAnchorElement(el);
  
  // If we found an anchor that's not the element itself, create relative path
  if (anchorElement && anchorElement !== el) {
    const relativeXPath = createRelativeXPath(anchorElement, el);
    if (relativeXPath) return relativeXPath;
  }
  
  // Otherwise, create a path to the closest ancestor with a reliable attribute
  let currentEl = el;
  let parts = [];
  let maxDepth = 8; // Limit path depth to avoid excessively long paths
  
  while (currentEl && currentEl.nodeType === 1 && maxDepth > 0) {
    const tag = currentEl.tagName.toLowerCase();
    
    // Check for text first
    const text = currentEl.textContent?.trim();
    const textElements = ['a', 'button', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label', 'li', 'p', 'span', 'td', 'th'];
    
    if (text && text.length > 0 && text.length < 50 && textElements.includes(tag) && isStatic(text)) {
      const safeText = text.replace(/"/g, '\\"');
      parts.unshift(`${tag}[text()="${safeText}"]`);
      return `//${parts.join('/')}`;
    }
    
    // If we find an element with an ID, use it as the base
    const id = currentEl.getAttribute('id');
    if (id && isStatic(id)) {
      parts.unshift(`${tag}[@id="${id}"]`);
      return `//${parts.join('/')}`;
    }
    
    // Check for placeholder
    const placeholder = currentEl.getAttribute('placeholder');
    if (placeholder && isStatic(placeholder)) {
      const safePlaceholder = placeholder.replace(/"/g, '\\"');
      parts.unshift(`${tag}[@placeholder="${safePlaceholder}"]`);
      return `//${parts.join('/')}`;
    }
    
    // Check for other stable attributes in priority order
    const priorityAttrs = ['name', 'class', 'aria-label', 'data-testid', 'data-id', 'role', 'title'];
    let foundStableAttr = false;
    
    for (const attrName of priorityAttrs) {
      const value = currentEl.getAttribute(attrName);
      if (value && isStatic(value)) {
        const safeValue = value.replace(/"/g, '\\"');
        parts.unshift(`${tag}[@${attrName}="${safeValue}"]`);
        foundStableAttr = true;
        break;
      }
    }
    
    if (foundStableAttr) {
      return `//${parts.join('/')}`;
    }
    
    // If no stable attributes, add position-based selector
    let index = 1;
    let sibling = currentEl.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === currentEl.tagName) {
        index++;
      }
      sibling = sibling.previousElementSibling;
    }
    
    if (index > 1) {
      parts.unshift(`${tag}[${index}]`);
    } else {
      parts.unshift(tag);
    }
    
    currentEl = currentEl.parentElement;
    maxDepth--;
  }
  
  return `//${parts.join('/')}`;
}