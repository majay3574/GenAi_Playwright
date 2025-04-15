let isPickerActive = false;
let highlightedElement = null;
 
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'ping') {
    sendResponse({ status: 'ok' });
    return true;
  }
 
  if (message.action === 'startPicker') {
    isPickerActive = true;
    enableElementPicker();
  }
 
  return true;
});
 
function enableElementPicker() {
  document.body.style.cursor = 'crosshair';
  document.addEventListener('mouseover', highlightElement);
  document.addEventListener('click', selectElement);
  document.addEventListener('keydown', handleKeyPress);
}
 
function disableElementPicker() {
  isPickerActive = false;
  document.body.style.cursor = 'default';
  if (highlightedElement) {
    highlightedElement.style.outline = '';
  }
  document.removeEventListener('mouseover', highlightElement);
  document.removeEventListener('click', selectElement);
  document.removeEventListener('keydown', handleKeyPress);
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
}
 
function selectElement(e) {
  if (!isPickerActive) return;
 
  e.preventDefault();
  e.stopPropagation();
 
  const element = e.target;
 
  const stableXPath = generateStableXPath(element);
  const stableCss = generateStableCssSelector(element);
 
  const finalSelector = stableXPath || stableCss || generateFullXPath(element);
  const selectorType = stableXPath ? 'xpath' : stableCss ? 'css' : 'xpath';
 
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
 
  chrome.runtime.sendMessage({
    action: 'elementSelected',
    selectorType,
    selector: `${finalSelector} → ${action}`
  });
 
  disableElementPicker();
}
 
function handleKeyPress(e) {
  if (e.key === 'Escape' && isPickerActive) {
    disableElementPicker();
  }
}
 
function isStatic(value) {
  if (!value) return false;
  if (/\d{2,}|__|\[\d+\]/.test(value)) return false;
  if (value.startsWith(':') || value.length < 4) return false;
  return true;
}
 
function generateStableCssSelector(el) {
  if (el.id && isStatic(el.id)) {
    return `${el.tagName.toLowerCase()}#${el.id}`;
  }
 
  const dataAttrs = Array.from(el.attributes)
    .filter(attr => attr.name.startsWith('data-') && isStatic(attr.value));
  if (dataAttrs.length > 0) {
    return `${el.tagName.toLowerCase()}[${dataAttrs[0].name}="${dataAttrs[0].value}"]`;
  }
 
  const staticClasses = Array.from(el.classList)
    .filter(cls => isStatic(cls));
  if (staticClasses.length > 0) {
    return `${el.tagName.toLowerCase()}.${staticClasses.join('.')}`;
  }
 
  return null;
}
 
function generateStableXPath(el) {
  const tag = el.tagName.toLowerCase();
  const text = el.textContent?.trim();
  const name = el.getAttribute('name');
  const id = el.getAttribute('id');
  const ariaLabel = el.getAttribute('aria-label');
  const placeholder = el.getAttribute('placeholder');
 
  if (id && isStatic(id)) {
    return `//${tag}[@id="${id}"]`;
  } else if (name && isStatic(name)) {
    return `//${tag}[@name="${name}"]`;
  } else if (ariaLabel && isStatic(ariaLabel)) {
    return `//${tag}[@aria-label="${ariaLabel}"]`;
  } else if (placeholder && isStatic(placeholder)) {
    return `//${tag}[@placeholder="${placeholder}"]`;
  } else if (text && text.length < 40 && !/\d/.test(text)) {
    return `//${tag}[normalize-space(text())="${text}"]`;
  }
 
  return null;
}
 
function generateFullXPath(el) {
  if (el.nodeType !== 1) return '';
 
  const parts = [];
  while (el && el.nodeType === 1) {
    let index = 1;
    let sibling = el.previousSibling;
    while (sibling) {
      if (sibling.nodeType === 1 && sibling.nodeName === el.nodeName) {
        index++;
      }
      sibling = sibling.previousSibling;
    }
 
    const tag = el.tagName.toLowerCase();
    const id = el.getAttribute('id');
    const name = el.getAttribute('name');
 
    if (id && isStatic(id)) {
      parts.unshift(`//${tag}[@id="${id}"]`);
      break;
    } else if (name && isStatic(name)) {
      parts.unshift(`//${tag}[@name="${name}"]`);
    } else {
      parts.unshift(`//${tag}[${index}]`);
    }
 
    el = el.parentNode;
  }
 
  return parts.length ? parts.join('/') : null;
}