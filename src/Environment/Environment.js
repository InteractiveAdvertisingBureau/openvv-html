/**
 * Environment Module
 * @module Environment/Environment
 * represents functions that describe the current environment the meausrement library is running in
 */

/**
 * @param  {HTMLElement} element - a HTML element to get properties from 
 * @return {Object} an object describing the various pertitnent environment details
 */
export const getDetails = (element = {}) => {
  return {
    viewportWidth: Math.max(document.body.clientWidth, window.innerWidth) || -1,
    viewportHeight: Math.max(document.body.clientHeight, window.innerHeight) || -1,
    elementWidth: element.clientWidth || -1,
    elementHeight: element.clientHeight || -1,
    iframeContext: iFrameContext(),
    focus: isInFocus()
  }
}

/**
 * @return {Boolean} determines whether the current page is in focus
 */
export const isInFocus = () => {
  if (document.hidden !== 'undefined'){
    if (document.hidden === true){
      return false;
    }
  }

  if(iFrameContext() === iFrameServingScenarios.CROSS_DOMAIN_IFRAME) {
    return true;
  }

  if(window.document.hasFocus) {
    return window.top.document.hasFocus();
  }

  return true;
}

/**
 * @return {String} returns the current iFrame serving context. It's either 'on page', 'same domain iframe', or 'cross domain iframe'
 */
export const iFrameContext = () => {
  try {
    if(window.top === window) {
      return iFrameServingScenarios.ON_PAGE
    }

    let curWin = window, level = 0;
    while(curWin.parent !== curWin && level < 1000) {
      if(curWin.parent.document.domain !== curWin.document.domain) {
        return iFrameServingScenarios.CROSS_DOMAIN_IFRAME;
      }

      curWin = curWin.parent;
    }
    iFrameServingScenarios.SAME_DOMAIN_IFRAME;
  }
  catch(e) {
    return iFrameServingScenarios.CROSS_DOMAIN_IFRAME
  }
}

/**
 * constants describing different types of iFrame contexts
 * @type {Object}
 */
export const iFrameServingScenarios = {
  ON_PAGE: 'on page',
  SAME_DOMAIN_IFRAME: 'same domain iframe',
  CROSS_DOMAIN_IFRAME: 'cross domain iframe'
}