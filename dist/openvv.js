(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.OpenVV = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/**
 * Copyright 2016 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

(function(window, document) {
'use strict';


// Exits early if all IntersectionObserver and IntersectionObserverEntry
// features are natively supported.
if ('IntersectionObserver' in window &&
    'IntersectionObserverEntry' in window &&
    'intersectionRatio' in window.IntersectionObserverEntry.prototype) {
  return;
}


/**
 * An IntersectionObserver registry. This registry exists to hold a strong
 * reference to IntersectionObserver instances currently observering a target
 * element. Without this registry, instances without another reference may be
 * garbage collected.
 */
var registry = [];


/**
 * Creates the global IntersectionObserverEntry constructor.
 * https://wicg.github.io/IntersectionObserver/#intersection-observer-entry
 * @param {Object} entry A dictionary of instance properties.
 * @constructor
 */
function IntersectionObserverEntry(entry) {
  this.time = entry.time;
  this.target = entry.target;
  this.rootBounds = entry.rootBounds;
  this.boundingClientRect = entry.boundingClientRect;
  this.intersectionRect = entry.intersectionRect || getEmptyRect();
  this.isIntersecting = !!entry.intersectionRect;

  // Calculates the intersection ratio.
  var targetRect = this.boundingClientRect;
  var targetArea = targetRect.width * targetRect.height;
  var intersectionRect = this.intersectionRect;
  var intersectionArea = intersectionRect.width * intersectionRect.height;

  // Sets intersection ratio.
  if (targetArea) {
    this.intersectionRatio = intersectionArea / targetArea;
  } else {
    // If area is zero and is intersecting, sets to 1, otherwise to 0
    this.intersectionRatio = this.isIntersecting ? 1 : 0;
  }
}


/**
 * Creates the global IntersectionObserver constructor.
 * https://wicg.github.io/IntersectionObserver/#intersection-observer-interface
 * @param {Function} callback The function to be invoked after intersection
 *     changes have queued. The function is not invoked if the queue has
 *     been emptied by calling the `takeRecords` method.
 * @param {Object=} opt_options Optional configuration options.
 * @constructor
 */
function IntersectionObserver(callback, opt_options) {

  var options = opt_options || {};

  if (typeof callback != 'function') {
    throw new Error('callback must be a function');
  }

  if (options.root && options.root.nodeType != 1) {
    throw new Error('root must be an Element');
  }

  // Binds and throttles `this._checkForIntersections`.
  this._checkForIntersections = throttle(
      this._checkForIntersections.bind(this), this.THROTTLE_TIMEOUT);

  // Private properties.
  this._callback = callback;
  this._observationTargets = [];
  this._queuedEntries = [];
  this._rootMarginValues = this._parseRootMargin(options.rootMargin);

  // Public properties.
  this.thresholds = this._initThresholds(options.threshold);
  this.root = options.root || null;
  this.rootMargin = this._rootMarginValues.map(function(margin) {
    return margin.value + margin.unit;
  }).join(' ');
}


/**
 * The minimum interval within which the document will be checked for
 * intersection changes.
 */
IntersectionObserver.prototype.THROTTLE_TIMEOUT = 100;


/**
 * The frequency in which the polyfill polls for intersection changes.
 * this can be updated on a per instance basis and must be set prior to
 * calling `observe` on the first target.
 */
IntersectionObserver.prototype.POLL_INTERVAL = null;


/**
 * Starts observing a target element for intersection changes based on
 * the thresholds values.
 * @param {Element} target The DOM element to observe.
 */
IntersectionObserver.prototype.observe = function(target) {
  // If the target is already being observed, do nothing.
  if (this._observationTargets.some(function(item) {
    return item.element == target;
  })) {
    return;
  }

  if (!(target && target.nodeType == 1)) {
    throw new Error('target must be an Element');
  }

  this._registerInstance();
  this._observationTargets.push({element: target, entry: null});
  this._monitorIntersections();
};


/**
 * Stops observing a target element for intersection changes.
 * @param {Element} target The DOM element to observe.
 */
IntersectionObserver.prototype.unobserve = function(target) {
  this._observationTargets =
      this._observationTargets.filter(function(item) {

    return item.element != target;
  });
  if (!this._observationTargets.length) {
    this._unmonitorIntersections();
    this._unregisterInstance();
  }
};


/**
 * Stops observing all target elements for intersection changes.
 */
IntersectionObserver.prototype.disconnect = function() {
  this._observationTargets = [];
  this._unmonitorIntersections();
  this._unregisterInstance();
};


/**
 * Returns any queue entries that have not yet been reported to the
 * callback and clears the queue. This can be used in conjunction with the
 * callback to obtain the absolute most up-to-date intersection information.
 * @return {Array} The currently queued entries.
 */
IntersectionObserver.prototype.takeRecords = function() {
  var records = this._queuedEntries.slice();
  this._queuedEntries = [];
  return records;
};


/**
 * Accepts the threshold value from the user configuration object and
 * returns a sorted array of unique threshold values. If a value is not
 * between 0 and 1 and error is thrown.
 * @private
 * @param {Array|number=} opt_threshold An optional threshold value or
 *     a list of threshold values, defaulting to [0].
 * @return {Array} A sorted list of unique and valid threshold values.
 */
IntersectionObserver.prototype._initThresholds = function(opt_threshold) {
  var threshold = opt_threshold || [0];
  if (!Array.isArray(threshold)) threshold = [threshold];

  return threshold.sort().filter(function(t, i, a) {
    if (typeof t != 'number' || isNaN(t) || t < 0 || t > 1) {
      throw new Error('threshold must be a number between 0 and 1 inclusively');
    }
    return t !== a[i - 1];
  });
};


/**
 * Accepts the rootMargin value from the user configuration object
 * and returns an array of the four margin values as an object containing
 * the value and unit properties. If any of the values are not properly
 * formatted or use a unit other than px or %, and error is thrown.
 * @private
 * @param {string=} opt_rootMargin An optional rootMargin value,
 *     defaulting to '0px'.
 * @return {Array<Object>} An array of margin objects with the keys
 *     value and unit.
 */
IntersectionObserver.prototype._parseRootMargin = function(opt_rootMargin) {
  var marginString = opt_rootMargin || '0px';
  var margins = marginString.split(/\s+/).map(function(margin) {
    var parts = /^(-?\d*\.?\d+)(px|%)$/.exec(margin);
    if (!parts) {
      throw new Error('rootMargin must be specified in pixels or percent');
    }
    return {value: parseFloat(parts[1]), unit: parts[2]};
  });

  // Handles shorthand.
  margins[1] = margins[1] || margins[0];
  margins[2] = margins[2] || margins[0];
  margins[3] = margins[3] || margins[1];

  return margins;
};


/**
 * Starts polling for intersection changes if the polling is not already
 * happening, and if the page's visibilty state is visible.
 * @private
 */
IntersectionObserver.prototype._monitorIntersections = function() {
  if (!this._monitoringIntersections) {
    this._monitoringIntersections = true;

    this._checkForIntersections();

    // If a poll interval is set, use polling instead of listening to
    // resize and scroll events or DOM mutations.
    if (this.POLL_INTERVAL) {
      this._monitoringInterval = setInterval(
          this._checkForIntersections, this.POLL_INTERVAL);
    }
    else {
      addEvent(window, 'resize', this._checkForIntersections, true);
      addEvent(document, 'scroll', this._checkForIntersections, true);

      if ('MutationObserver' in window) {
        this._domObserver = new MutationObserver(this._checkForIntersections);
        this._domObserver.observe(document, {
          attributes: true,
          childList: true,
          characterData: true,
          subtree: true
        });
      }
    }
  }
};


/**
 * Stops polling for intersection changes.
 * @private
 */
IntersectionObserver.prototype._unmonitorIntersections = function() {
  if (this._monitoringIntersections) {
    this._monitoringIntersections = false;

    clearInterval(this._monitoringInterval);
    this._monitoringInterval = null;

    removeEvent(window, 'resize', this._checkForIntersections, true);
    removeEvent(document, 'scroll', this._checkForIntersections, true);

    if (this._domObserver) {
      this._domObserver.disconnect();
      this._domObserver = null;
    }
  }
};


/**
 * Scans each observation target for intersection changes and adds them
 * to the internal entries queue. If new entries are found, it
 * schedules the callback to be invoked.
 * @private
 */
IntersectionObserver.prototype._checkForIntersections = function() {
  var rootIsInDom = this._rootIsInDom();
  var rootRect = rootIsInDom ? this._getRootRect() : getEmptyRect();

  this._observationTargets.forEach(function(item) {
    var target = item.element;
    var targetRect = getBoundingClientRect(target);
    var rootContainsTarget = this._rootContainsTarget(target);
    var oldEntry = item.entry;
    var intersectionRect = rootIsInDom && rootContainsTarget &&
        this._computeTargetAndRootIntersection(target, rootRect);

    var newEntry = item.entry = new IntersectionObserverEntry({
      time: now(),
      target: target,
      boundingClientRect: targetRect,
      rootBounds: rootRect,
      intersectionRect: intersectionRect
    });

    if (!oldEntry) {
      this._queuedEntries.push(newEntry);
    } else if (rootIsInDom && rootContainsTarget) {
      // If the new entry intersection ratio has crossed any of the
      // thresholds, add a new entry.
      if (this._hasCrossedThreshold(oldEntry, newEntry)) {
        this._queuedEntries.push(newEntry);
      }
    } else {
      // If the root is not in the DOM or target is not contained within
      // root but the previous entry for this target had an intersection,
      // add a new record indicating removal.
      if (oldEntry && oldEntry.isIntersecting) {
        this._queuedEntries.push(newEntry);
      }
    }
  }, this);

  if (this._queuedEntries.length) {
    this._callback(this.takeRecords(), this);
  }
};


/**
 * Accepts a target and root rect computes the intersection between then
 * following the algorithm in the spec.
 * TODO(philipwalton): at this time clip-path is not considered.
 * https://wicg.github.io/IntersectionObserver/#calculate-intersection-rect-algo
 * @param {Element} target The target DOM element
 * @param {Object} rootRect The bounding rect of the root after being
 *     expanded by the rootMargin value.
 * @return {?Object} The final intersection rect object or undefined if no
 *     intersection is found.
 * @private
 */
IntersectionObserver.prototype._computeTargetAndRootIntersection =
    function(target, rootRect) {

  // If the element isn't displayed, an intersection can't happen.
  if (window.getComputedStyle(target).display == 'none') return;

  var targetRect = getBoundingClientRect(target);
  var intersectionRect = targetRect;
  var parent = getParentNode(target);
  var atRoot = false;

  while (!atRoot) {
    var parentRect = null;
    var parentComputedStyle = parent.nodeType == 1 ?
        window.getComputedStyle(parent) : {};

    // If the parent isn't displayed, an intersection can't happen.
    if (parentComputedStyle.display == 'none') return;

    if (parent == this.root || parent == document) {
      atRoot = true;
      parentRect = rootRect;
    } else {
      // If the element has a non-visible overflow, and it's not the <body>
      // or <html> element, update the intersection rect.
      // Note: <body> and <html> cannot be clipped to a rect that's not also
      // the document rect, so no need to compute a new intersection.
      if (parent != document.body &&
          parent != document.documentElement &&
          parentComputedStyle.overflow != 'visible') {
        parentRect = getBoundingClientRect(parent);
      }
    }

    // If either of the above conditionals set a new parentRect,
    // calculate new intersection data.
    if (parentRect) {
      intersectionRect = computeRectIntersection(parentRect, intersectionRect);

      if (!intersectionRect) break;
    }
    parent = getParentNode(parent);
  }
  return intersectionRect;
};


/**
 * Returns the root rect after being expanded by the rootMargin value.
 * @return {Object} The expanded root rect.
 * @private
 */
IntersectionObserver.prototype._getRootRect = function() {
  var rootRect;
  if (this.root) {
    rootRect = getBoundingClientRect(this.root);
  } else {
    // Use <html>/<body> instead of window since scroll bars affect size.
    var html = document.documentElement;
    var body = document.body;
    rootRect = {
      top: 0,
      left: 0,
      right: html.clientWidth || body.clientWidth,
      width: html.clientWidth || body.clientWidth,
      bottom: html.clientHeight || body.clientHeight,
      height: html.clientHeight || body.clientHeight
    };
  }
  return this._expandRectByRootMargin(rootRect);
};


/**
 * Accepts a rect and expands it by the rootMargin value.
 * @param {Object} rect The rect object to expand.
 * @return {Object} The expanded rect.
 * @private
 */
IntersectionObserver.prototype._expandRectByRootMargin = function(rect) {
  var margins = this._rootMarginValues.map(function(margin, i) {
    return margin.unit == 'px' ? margin.value :
        margin.value * (i % 2 ? rect.width : rect.height) / 100;
  });
  var newRect = {
    top: rect.top - margins[0],
    right: rect.right + margins[1],
    bottom: rect.bottom + margins[2],
    left: rect.left - margins[3]
  };
  newRect.width = newRect.right - newRect.left;
  newRect.height = newRect.bottom - newRect.top;

  return newRect;
};


/**
 * Accepts an old and new entry and returns true if at least one of the
 * threshold values has been crossed.
 * @param {?IntersectionObserverEntry} oldEntry The previous entry for a
 *    particular target element or null if no previous entry exists.
 * @param {IntersectionObserverEntry} newEntry The current entry for a
 *    particular target element.
 * @return {boolean} Returns true if a any threshold has been crossed.
 * @private
 */
IntersectionObserver.prototype._hasCrossedThreshold =
    function(oldEntry, newEntry) {

  // To make comparing easier, an entry that has a ratio of 0
  // but does not actually intersect is given a value of -1
  var oldRatio = oldEntry && oldEntry.isIntersecting ?
      oldEntry.intersectionRatio || 0 : -1;
  var newRatio = newEntry.isIntersecting ?
      newEntry.intersectionRatio || 0 : -1;

  // Ignore unchanged ratios
  if (oldRatio === newRatio) return;

  for (var i = 0; i < this.thresholds.length; i++) {
    var threshold = this.thresholds[i];

    // Return true if an entry matches a threshold or if the new ratio
    // and the old ratio are on the opposite sides of a threshold.
    if (threshold == oldRatio || threshold == newRatio ||
        threshold < oldRatio !== threshold < newRatio) {
      return true;
    }
  }
};


/**
 * Returns whether or not the root element is an element and is in the DOM.
 * @return {boolean} True if the root element is an element and is in the DOM.
 * @private
 */
IntersectionObserver.prototype._rootIsInDom = function() {
  return !this.root || containsDeep(document, this.root);
};


/**
 * Returns whether or not the target element is a child of root.
 * @param {Element} target The target element to check.
 * @return {boolean} True if the target element is a child of root.
 * @private
 */
IntersectionObserver.prototype._rootContainsTarget = function(target) {
  return containsDeep(this.root || document, target);
};


/**
 * Adds the instance to the global IntersectionObserver registry if it isn't
 * already present.
 * @private
 */
IntersectionObserver.prototype._registerInstance = function() {
  if (registry.indexOf(this) < 0) {
    registry.push(this);
  }
};


/**
 * Removes the instance from the global IntersectionObserver registry.
 * @private
 */
IntersectionObserver.prototype._unregisterInstance = function() {
  var index = registry.indexOf(this);
  if (index != -1) registry.splice(index, 1);
};


/**
 * Returns the result of the performance.now() method or null in browsers
 * that don't support the API.
 * @return {number} The elapsed time since the page was requested.
 */
function now() {
  return window.performance && performance.now && performance.now();
}


/**
 * Throttles a function and delays its executiong, so it's only called at most
 * once within a given time period.
 * @param {Function} fn The function to throttle.
 * @param {number} timeout The amount of time that must pass before the
 *     function can be called again.
 * @return {Function} The throttled function.
 */
function throttle(fn, timeout) {
  var timer = null;
  return function () {
    if (!timer) {
      timer = setTimeout(function() {
        fn();
        timer = null;
      }, timeout);
    }
  };
}


/**
 * Adds an event handler to a DOM node ensuring cross-browser compatibility.
 * @param {Node} node The DOM node to add the event handler to.
 * @param {string} event The event name.
 * @param {Function} fn The event handler to add.
 * @param {boolean} opt_useCapture Optionally adds the even to the capture
 *     phase. Note: this only works in modern browsers.
 */
function addEvent(node, event, fn, opt_useCapture) {
  if (typeof node.addEventListener == 'function') {
    node.addEventListener(event, fn, opt_useCapture || false);
  }
  else if (typeof node.attachEvent == 'function') {
    node.attachEvent('on' + event, fn);
  }
}


/**
 * Removes a previously added event handler from a DOM node.
 * @param {Node} node The DOM node to remove the event handler from.
 * @param {string} event The event name.
 * @param {Function} fn The event handler to remove.
 * @param {boolean} opt_useCapture If the event handler was added with this
 *     flag set to true, it should be set to true here in order to remove it.
 */
function removeEvent(node, event, fn, opt_useCapture) {
  if (typeof node.removeEventListener == 'function') {
    node.removeEventListener(event, fn, opt_useCapture || false);
  }
  else if (typeof node.detatchEvent == 'function') {
    node.detatchEvent('on' + event, fn);
  }
}


/**
 * Returns the intersection between two rect objects.
 * @param {Object} rect1 The first rect.
 * @param {Object} rect2 The second rect.
 * @return {?Object} The intersection rect or undefined if no intersection
 *     is found.
 */
function computeRectIntersection(rect1, rect2) {
  var top = Math.max(rect1.top, rect2.top);
  var bottom = Math.min(rect1.bottom, rect2.bottom);
  var left = Math.max(rect1.left, rect2.left);
  var right = Math.min(rect1.right, rect2.right);
  var width = right - left;
  var height = bottom - top;

  return (width >= 0 && height >= 0) && {
    top: top,
    bottom: bottom,
    left: left,
    right: right,
    width: width,
    height: height
  };
}


/**
 * Shims the native getBoundingClientRect for compatibility with older IE.
 * @param {Element} el The element whose bounding rect to get.
 * @return {Object} The (possibly shimmed) rect of the element.
 */
function getBoundingClientRect(el) {
  var rect;

  try {
    rect = el.getBoundingClientRect();
  } catch (err) {
    // Ignore Windows 7 IE11 "Unspecified error"
    // https://github.com/WICG/IntersectionObserver/pull/205
  }

  if (!rect) return getEmptyRect();

  // Older IE
  if (!(rect.width && rect.height)) {
    rect = {
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top
    };
  }
  return rect;
}


/**
 * Returns an empty rect object. An empty rect is returned when an element
 * is not in the DOM.
 * @return {Object} The empty rect.
 */
function getEmptyRect() {
  return {
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    width: 0,
    height: 0
  };
}

/**
 * Checks to see if a parent element contains a child elemnt (including inside
 * shadow DOM).
 * @param {Node} parent The parent element.
 * @param {Node} child The child element.
 * @return {boolean} True if the parent node contains the child node.
 */
function containsDeep(parent, child) {
  var node = child;
  while (node) {
    if (node == parent) return true;

    node = getParentNode(node);
  }
  return false;
}


/**
 * Gets the parent node of an element or its host element if the parent node
 * is a shadow root.
 * @param {Node} node The node whose parent to get.
 * @return {Node|null} The parent node or null if no parent exists.
 */
function getParentNode(node) {
  var parent = node.parentNode;

  if (parent && parent.nodeType == 11 && parent.host) {
    // If the parent is a shadow root, return the host element.
    return parent.host;
  }
  return parent;
}


// Exposes the constructors globally.
window.IntersectionObserver = IntersectionObserver;
window.IntersectionObserverEntry = IntersectionObserverEntry;

}(window, document));

},{}],2:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
/**
 * Environment Module
 * @module Environment/Environment
 * represents functions that describe the current environment the meausrement library is running in
 */

/**
 * @param  {HTMLElement} element - a HTML element to get properties from 
 * @return {Object} an object describing the various pertitnent environment details
 */
var getDetails = exports.getDetails = function getDetails() {
  var element = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

  return {
    viewportWidth: Math.max(document.body.clientWidth, window.innerWidth) || -1,
    viewportHeight: Math.max(document.body.clientHeight, window.innerHeight) || -1,
    elementWidth: element.clientWidth || -1,
    elementHeight: element.clientHeight || -1,
    iframeContext: iFrameContext(),
    focus: isInFocus()
  };
};

/**
 * @return {Boolean} determines whether the current page is in focus
 */
var isInFocus = exports.isInFocus = function isInFocus() {
  if (document.hidden !== 'undefined') {
    if (document.hidden === true) {
      return false;
    }
  }

  if (iFrameContext() === iFrameServingScenarios.CROSS_DOMAIN_IFRAME) {
    return true;
  }

  if (window.document.hasFocus) {
    return window.top.document.hasFocus();
  }

  return true;
};

/**
 * @return {String} returns the current iFrame serving context. It's either 'on page', 'same domain iframe', or 'cross domain iframe'
 */
var iFrameContext = exports.iFrameContext = function iFrameContext() {
  try {
    if (window.top === window) {
      return iFrameServingScenarios.ON_PAGE;
    }

    var curWin = window,
        level = 0;
    while (curWin.parent !== curWin && level < 1000) {
      if (curWin.parent.document.domain !== curWin.document.domain) {
        return iFrameServingScenarios.CROSS_DOMAIN_IFRAME;
      }

      curWin = curWin.parent;
    }
    iFrameServingScenarios.SAME_DOMAIN_IFRAME;
  } catch (e) {
    return iFrameServingScenarios.CROSS_DOMAIN_IFRAME;
  }
};

/**
 * constants describing different types of iFrame contexts
 * @type {Object}
 */
var iFrameServingScenarios = exports.iFrameServingScenarios = {
  ON_PAGE: 'on page',
  SAME_DOMAIN_IFRAME: 'same domain iframe',
  CROSS_DOMAIN_IFRAME: 'cross domain iframe'
};

},{}],3:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.validateStrategy = exports.validateCriteria = exports.validElement = exports.validTechnique = undefined;

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var _BaseTechnique = require('../Measurement/MeasurementTechniques/BaseTechnique');

var _BaseTechnique2 = _interopRequireDefault(_BaseTechnique);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * Validators module
 * @module Helpers/Validators
 * represents functions for checking the validitiy of a given input value 
 */

/**
 * @param  {BaseTechnique} technique - technique to check for validity
 * @return {Boolean} determination of whether the technique meets the minimum standards 
 * for measuring viewability according to the interface defined by BaseTechnique
 */
var validTechnique = exports.validTechnique = function validTechnique(technique) {
  var valid = typeof technique === 'function' && Object.getOwnPropertyNames(_BaseTechnique2.default).reduce(function (prop, valid) {
    return valid && _typeof(technique[prop]) === _typeof(_BaseTechnique2.default[prop]);
  }, true);

  return valid;
};

/**
 * @param  {HTMLElement} element - element to check for validity
 * @return {Boolean} determines whether element is an actual HTML element or a proxy element (which may be provided by Google's IMA VPAID host) 
 */
var validElement = exports.validElement = function validElement(element) {
  return element && element.toString().indexOf('Element') > -1;
};

/**
 * @param  {Object} obj - viewability criteria to check for validaity. Note, we're using ES6 destructuring to pull the properties we want to test from the object
 * @param  {Number} obj.inViewThreshold - amount element must be in view by, to be counted as in view
 * @param  {Number} obj.timeInView - duration element must be in view for, to be considered viewable
 * @return {Object} object that contains a property describing if the criteria meets the expected requirements and if not, which assertions it fails
 */
var validateCriteria = exports.validateCriteria = function validateCriteria(_ref) {
  var inViewThreshold = _ref.inViewThreshold,
      timeInView = _ref.timeInView;

  var invalid = false,
      reasons = [];

  if (typeof inViewThreshold !== 'number' || inViewThreshold > 1) {
    invalid = true;
    reasons.push('inViewThreshold must be a number equal to or less than 1');
  }

  if (typeof timeInView !== 'number' || timeInView < 0) {
    invalid = true;
    reasons.push('timeInView must be a number greater to or equal 0');
  }

  return { invalid: invalid, reasons: reasons.join(' | ') };
};

/**
 * @param  {Object} obj - strategy object to test for validity 
 * @param  {Boolean} obj.autostart - configures whether viewability measurement should begin as soon as technique is configured
 * @param  {Array.<BaseTechnique>} obj.techniques - list of measurement techniques to use
 * @param  {Object} obj.criteria - measurement criteria to use to determine if an element is viewable
 * @return {Object} object describing whether the tested strategy is invalid and if so, what is the reason for being invalid
 */
var validateStrategy = exports.validateStrategy = function validateStrategy(_ref2) {
  var autostart = _ref2.autostart,
      techniques = _ref2.techniques,
      criteria = _ref2.criteria;

  var invalid = false,
      reasons = [];

  if (typeof autostart !== 'boolean') {
    invalid = true;
    reasons.push('autostart must be boolean');
  }

  if (!Array.isArray(techniques) || techniques.length === 0) {
    invalid = true;
    reasons.push('techniques must be an array containing atleast on measurement techniques');
  }

  var validated = validateCriteria(criteria);

  if (validated.invalid) {
    invalid = true;
    reasons.push(validated.reasons);
  }

  return { invalid: invalid, reasons: reasons.join(' | ') };
};

},{"../Measurement/MeasurementTechniques/BaseTechnique":6}],4:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
/**
 * Events module
 * @module Measurement/Events
 * represents Event constants
 */

/** represents that element is in view and measurement has started */
var START = exports.START = 'start';
/** represents a viewable measurement stop. This occurs when measurement has previously started, but the element has gone out of view */
var STOP = exports.STOP = 'stop';
/** represents a viewable change event. Either measurement has started, stopped, or the element's in view amount (viewable percentage) has changed */
var CHANGE = exports.CHANGE = 'change';
/** represents that viewability measurement has completed. the element has been in view for the duration specified in the measurement criteria */
var COMPLETE = exports.COMPLETE = 'complete';
/** represents that no compatible techniques have been found to measure viewability with */
var UNMEASUREABLE = exports.UNMEASUREABLE = 'unmeasureable';
/** internal representation of the viewable state of the element as in view */
var INVIEW = exports.INVIEW = 'inview';
/** internal representation of the viewable state of the element as out of view */
var OUTVIEW = exports.OUTVIEW = 'outview';

},{}],5:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _InViewTimer = require('../Timing/InViewTimer');

var _InViewTimer2 = _interopRequireDefault(_InViewTimer);

var _Strategies = require('./Strategies/');

var _Validators = require('../Helpers/Validators');

var _Environment = require('../Environment/Environment');

var Environment = _interopRequireWildcard(_Environment);

var _Events = require('./Events');

var Events = _interopRequireWildcard(_Events);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

/**
 * Class representing a measurement executor
 */
var MeasurementExecutor = function () {
  /**
   * Create a new instance of a MeasurementExecutor
   * @param {HTMLElement} element - a HTML element to measure
   * @param {Object} strategy - a strategy object defining the measurement techniques and what criteria constitute a viewable state.
   * See OpenVV.Strategies DEFAULT_STRATEGY and StrategyFactory for more details on required params
   */
  function MeasurementExecutor(element) {
    var _this = this;

    var strategy = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

    _classCallCheck(this, MeasurementExecutor);

    /** @private {Object} event listener arrays */
    this._listeners = { start: [], stop: [], change: [], complete: [], unmeasureable: [] };
    /** @private {HTMLElement} HTML element to measure */
    this._element = element;
    /** @private {Object} measurement strategy */
    this._strategy = _extends({}, _Strategies.DEFAULT_STRATEGY, strategy);
    /** @private {Boolean} tracks whether viewability criteria has been met */
    this._criteriaMet = false;

    var validated = (0, _Validators.validateStrategy)(this._strategy);

    if (validated.invalid) {
      throw validated.reasons;
    }

    /** @private {BaseTechnique} technique to measure viewability with */
    this._technique = this._selectTechnique(this._strategy.techniques);

    if (this._technique) {
      this._addSubscriptions(this._technique);
    }

    if (this.unmeasureable) {
      // fire unmeasureable after current JS loop completes 
      // so opportunity is given for consumers to provide unmeasureable callback
      setTimeout(function () {
        return _this._publish(Events.UNMEASUREABLE, Environment.getDetails(_this._element));
      }, 0);
    } else if (this._strategy.autostart) {
      this._technique.start();
    }
  }

  /** 
   * starts viewability measurment using the selected technique
   * @public
   */


  _createClass(MeasurementExecutor, [{
    key: 'start',
    value: function start() {
      this._technique.start();
    }

    /**
     * dispose the measurment technique and any timers
     * @public
     */

  }, {
    key: 'dispose',
    value: function dispose() {
      if (this._technique) {
        this._technique.dispose();
      }
      if (this.timer) {
        this.timer.dispose();
      }
    }

    /**
     * Handle viewability tracking start
     * @public
     * @param  {viewableCallback} callback - is called when viewability starts tracking
     * @return {MeasurmentExecutor} returns instance of MeasurementExecutor associated with this callback
     */

  }, {
    key: 'onViewableStart',
    value: function onViewableStart(callback) {
      return this._addCallback(callback, Events.START);
    }

    /**
     * Handle viewability tracking stop.
     * @public
     * @param {viewableCallback} callback - is called when viewability has previously started, but element is now out of view
     * @return {MeasurementExecutor} returns instance of MeasurementExecutor associated with this callback
     */

  }, {
    key: 'onViewableStop',
    value: function onViewableStop(callback) {
      return this._addCallback(callback, Events.STOP);
    }

    /**
     * Handle viewability change.
     * @public
     * @param  {viewableCallback} callback - called when the viewable percentage of the element has changed
     * @return {MeasurementExecutor} returns instance of MeasurementExecutor associated with this callback
     */

  }, {
    key: 'onViewableChange',
    value: function onViewableChange(callback) {
      return this._addCallback(callback, Events.CHANGE);
    }

    /**
     * Handle viewability complete.
     * @public
     * @param  {viewableCallback} callback - called when element has been in view for the duration specified in the measurement strategy config
     * @return {MeasurementExecutor} returns instance of MeasurementExecutor associated with this callback
     */

  }, {
    key: 'onViewableComplete',
    value: function onViewableComplete(callback) {
      this._addCallback(callback, Events.COMPLETE);
      // if viewablity criteria already met, fire callback immediately
      if (this.criteriaMet) {
        this._techniqueChange(Events.COMPLETE, this._technique);
      }
      return this;
    }

    /**
     * Handle unmeasureable event
     * @public
     * @param  {viewableCallback} callback - called when no suitable measurement techniques are available from the techniques provided
     * @return {MeasurementExecutor} returns instance of MeasurementExecutor associated with this callback
     */

  }, {
    key: 'onUnmeasureable',
    value: function onUnmeasureable(callback) {
      this._addCallback(callback, Events.UNMEASUREABLE);
      // if executor is already unmeasureable, fire callback immediately
      if (this.unmeasureable) {
        this._techniqueChange(Events.UNMEASUREABLE);
      }
      return this;
    }

    /**
    * @callback viewableCallback
    * @param {Object} details - environment and measurement details of viewable event
    * @return {MeasurmentExecutor} returns instance of MeasurementExecutor associated with this callback
    */

    /**
     * @return {Boolean} - whether MeasurementExecutor instance is capable of measuring viewability
     */

  }, {
    key: '_selectTechnique',


    /**
     * Instantiates and filters list of available measurement technqiues to the first unmeasureable technique
     * @private
     * @param  {Array} - list of techniques available to measure viewability with
     * @return {BaseTechnique} selected technique
     */
    value: function _selectTechnique(techniques) {
      return techniques.filter(_Validators.validTechnique).map(this._instantiateTechnique.bind(this)).find(function (technique) {
        return !technique.unmeasureable;
      });
    }

    /**
     * creates instance of technique
     * @private
     * @param  {Function} - technique constructor
     * @return {BaseTechnique} instance of technique provided
     */

  }, {
    key: '_instantiateTechnique',
    value: function _instantiateTechnique(technique) {
      return new technique(element, this._strategy.criteria);
    }

    /**
     * adds event listeners to technique 
     * @private
     * @param {BaseTechnique} - technique to add event listeners to
     */

  }, {
    key: '_addSubscriptions',
    value: function _addSubscriptions(technique) {
      if (technique) {
        technique.onInView(this._techniqueChange.bind(this, Events.INVIEW, technique));
        technique.onChangeView(this._techniqueChange.bind(this, Events.CHANGE, technique));
        technique.onOutView(this._techniqueChange.bind(this, Events.OUTVIEW, technique));
      }
    }

    /**
     * handles viewable change events from a measurement technique
     * @private
     * @param  {String} - change type. See Measurement/Events module for list of changes
     * @param  {Object} - technique that reported change. May be undefined in case of unmeasureable event
     */

  }, {
    key: '_techniqueChange',
    value: function _techniqueChange(change) {
      var technique = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

      var eventName = void 0;
      var details = this._appendEnvironment(technique);

      switch (change) {
        case Events.INVIEW:
          if (!this._criteriaMet) {
            this.timer = new _InViewTimer2.default(this._strategy.criteria.timeInView);
            this.timer.elapsed(this._timerElapsed.bind(this, technique));
            this.timer.start();
            eventName = Events.START;
          }

          break;

        case Events.CHANGE:
          eventName = change;
          break;

        case Events.COMPLETE:
          if (!this._criteriaMet) {
            this._criteriaMet = true;
            eventName = change;
          }

          break;

        case Events.OUTVIEW:
          if (!this._criteriaMet) {
            if (this.timer) {
              this.timer.stop();
              delete this.timer;
            }
            eventName = Events.STOP;
          }

          break;

        case Events.UNMEASUREABLE:
          eventName = Events.UNMEASUREABLE;
      }

      if (eventName) {
        this._publish(eventName, details);
      }
    }

    /**
     * publishes events to available listeners
     * @private
     * @param  {String} - event name
     * @param  {} - value to call callback with
     */

  }, {
    key: '_publish',
    value: function _publish(event, value) {
      if (Array.isArray(this._listeners[event])) {
        this._listeners[event].forEach(function (l) {
          return l(value);
        });
      }
    }

    /**
     * callback for timer elapsed 
     * @private
     * @param  {BaseTechnique} - technique used to perform measurement
     */

  }, {
    key: '_timerElapsed',
    value: function _timerElapsed(technique) {
      this._techniqueChange(Events.COMPLETE, technique);
    }

    /**
     * Associates callback function with event 
     * @private
     * @param {Function} - callback function to associate with event
     * @param {String} event - event to associate callback function with
     * @return {MeasurementExecutor} returns instance of MeasurementExecutor associated with this callback
     */

  }, {
    key: '_addCallback',
    value: function _addCallback(callback, event) {
      if (this._listeners[event] && typeof callback === 'function') {
        this._listeners[event].push(callback);
      } else if (typeof callback !== 'function') {
        throw 'Callback must be a function';
      }

      return this;
    }

    /**
     * Combines environment details with measurement technique details
     * @private
     * @param  {BaseTechnique} - technique to get measurement details from 
     * @return {Object} Environment details and measurement details combined
     */

  }, {
    key: '_appendEnvironment',
    value: function _appendEnvironment(technique) {
      return _extends({}, {
        percentViewable: typeof technique.percentViewable === 'undefined' ? -1 : technique.percentViewable,
        technique: technique.techniqueName || -1,
        viewable: typeof technique.viewable === 'undefined' ? -1 : technique.viewable
      }, Environment.getDetails(this._element));
    }
  }, {
    key: 'unmeasureable',
    get: function get() {
      return !this._technique || this._technique.unmeasureable;
    }
  }]);

  return MeasurementExecutor;
}();

exports.default = MeasurementExecutor;
module.exports = exports['default'];

},{"../Environment/Environment":2,"../Helpers/Validators":3,"../Timing/InViewTimer":13,"./Events":4,"./Strategies/":10}],6:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

/**
 * Class representing basic functionality of a Measurement Technique
 * Some of it's members are intended to be overriden by inheritting class
 */
var BaseTechnique = function () {
  /**
   * @constructor
   * @return {BaseTechnique} instance of BaseTechnique
   */
  function BaseTechnique() {
    _classCallCheck(this, BaseTechnique);

    this.listeners = {
      inView: [],
      outView: [],
      changeView: []
    };

    this.percentViewable = 0.0;
  }

  /**
   * Defines callback to call when technique determines element is in view
   * @param  {changeCallback} - callback to call when element is in view
   * @return {BaseTechnique} instance of BaseTechnique associated with callback. Can be used to chain callback definitions.
   */


  _createClass(BaseTechnique, [{
    key: 'onInView',
    value: function onInView(cb) {
      return this.addCallback(cb, 'inView');
    }

    /**
     * Defines callback to call when technique determines element viewability has changed
     * @param  {changeCallback} - callback to call when element's viewability has changed
     * @return {BaseTechnique} instance of BaseTechnique associated with callback. Can be used to chain callback definitions.
     */

  }, {
    key: 'onChangeView',
    value: function onChangeView(cb) {
      return this.addCallback(cb, 'changeView');
    }

    /**
     * Defines callback to call when technique determines element is no longer in view
     * @param  {changeCallback} - callback to call when element is no longer in view
     * @return {BaseTechnique} instance of BaseTechnique associated with callback. Can be used to chain callback definitions.
     */

  }, {
    key: 'onOutView',
    value: function onOutView(cb) {
      return this.addCallback(cb, 'outView');
    }

    /**
     * @callback changeCallback
     */

    /**
     * Associate callback with named event
     * @param {Function} callback - callback to call when event occurs
     * @param {String} event - name of event to associate with callback
     */

  }, {
    key: 'addCallback',
    value: function addCallback(callback, event) {
      if (typeof callback === 'function' && this.listeners[event]) {
        this.listeners[event].push(callback);
      } else if (typeof callback !== 'function') {
        throw 'callback must be function';
      }

      return this;
    }

    /** 
     * empty start member. should be implemented by inheritting class
     */

  }, {
    key: 'start',
    value: function start() {}

    /**
     * empty dispose member. should be implemented by inheritting class
     */

  }, {
    key: 'dispose',
    value: function dispose() {}

    /**
     * @return {Boolean} defines whether the technique is capable of measuring in the current environment
     */

  }, {
    key: 'unmeasureable',
    get: function get() {
      return false;
    }

    /**
     * @return {Boolean} defines whether the technique has determined that the measured element is in view
     */

  }, {
    key: 'viewable',
    get: function get() {
      return false;
    }

    /**
     * @return {String} name of the measurement technique
     */

  }, {
    key: 'techniqueName',
    get: function get() {
      return 'BaseTechnique';
    }
  }]);

  return BaseTechnique;
}();

exports.default = BaseTechnique;
module.exports = exports['default'];

},{}],7:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _BaseTechnique2 = require('./BaseTechnique');

var _BaseTechnique3 = _interopRequireDefault(_BaseTechnique2);

var _Validators = require('../../Helpers/Validators');

var _Strategies = require('../Strategies/');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

/**
 * Represents a measurement technique that uses native IntersectionObserver API
 * @extends {BaseTechnique}
 */
var IntersectionObserver = function (_BaseTechnique) {
  _inherits(IntersectionObserver, _BaseTechnique);

  /**
   * Creates instance of IntersectionObserver measurement technique
   * @constructor
   * @param  {HTMLElement} element - element to perform viewability measurement on
   * @param  {Object} criteria - measurement criteria object. See Options/ViewabilityCriteria for more details
   * @return {IntersectionObserver} instance of IntersectionObserver measurement technique
   */
  function IntersectionObserver(element) {
    var criteria = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : _Strategies.DEFAULT_STRATEGY.criteria;

    _classCallCheck(this, IntersectionObserver);

    var _this = _possibleConstructorReturn(this, (IntersectionObserver.__proto__ || Object.getPrototypeOf(IntersectionObserver)).call(this, element, criteria));

    if (criteria !== undefined && element) {
      _this.element = element;
      _this.criteria = criteria;
      _this.inView = false;
      _this.started = false;
      _this.notificationLevels = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
      if (_this.notificationLevels.indexOf(_this.criteria.inViewThreshold) === -1) {
        _this.notificationLevels.push(_this.criteria.inViewThreshold);
      }
    } else if (!element) {
      throw 'element not provided';
    }
    return _this;
  }

  /**
   * starts measuring the specified element for viewability
   * @override
   */


  _createClass(IntersectionObserver, [{
    key: 'start',
    value: function start() {
      this.observer = new window.IntersectionObserver(this.viewableChange.bind(this), { threshold: this.notificationLevels });
      this.observer.observe(this.element);
    }

    /**
     * stops measuring the specified element for viewability
     * @override
     */

  }, {
    key: 'dispose',
    value: function dispose() {
      if (this.observer) {
        this.observer.unobserve(element);
        this.observer.disconnect(element);
      }
    }

    /**
     * @override
     * @return {Boolean} determines if the technique is capable of measuring in the current environment
     */

  }, {
    key: 'viewableChange',


    /**
     * callback function for IntersectionObserver change events
     * @param  {Array} entries - change entries
     */
    value: function viewableChange(entries) {
      if (entries && entries.length && entries[0].intersectionRatio !== undefined) {
        this.percentViewable = entries[0].intersectionRatio;

        if (entries[0].intersectionRatio < this.criteria.inViewThreshold && this.started) {
          this.inView = false;
          this.listeners.outView.forEach(function (l) {
            return l();
          });
        }
        if (entries[0].intersectionRatio >= this.criteria.inViewThreshold) {
          this.started = true;
          this.inView = true;
          this.listeners.inView.forEach(function (l) {
            return l();
          });
        }

        this.listeners.changeView.forEach(function (l) {
          return l();
        });
      }
    }
  }, {
    key: 'unmeasureable',
    get: function get() {
      return !window.IntersectionObserver || this.usesPolyfill || !(0, _Validators.validElement)(this.element);
    }

    /**
     * @override
     * @return {Boolean} reports whether the element is in view according to the IntersectionObserver measurement technique
     */

  }, {
    key: 'viewable',
    get: function get() {
      return this.inView;
    }

    /**
     * @override
     * @return {String} reports measurement technique name
     */

  }, {
    key: 'techniqueName',
    get: function get() {
      return 'IntersectionObserver';
    }

    /**
     * @return {Boolean} - reports whether measurement technique is using the native IntersectionObserver API or the polyfill bundled with the library.
     * Polyfill usage is infered by checking if the IntersectionObserver API has a THROTTLE_TIMEOUT memmber
     * Only the polyfill should have that member in it's API
     */

  }, {
    key: 'usesPolyfill',
    get: function get() {
      return typeof window.IntersectionObserver.prototype.THROTTLE_TIMEOUT === 'number';
    }
  }]);

  return IntersectionObserver;
}(_BaseTechnique3.default);

exports.default = IntersectionObserver;
module.exports = exports['default'];

},{"../../Helpers/Validators":3,"../Strategies/":10,"./BaseTechnique":6}],8:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _IntersectionObserver2 = require('./IntersectionObserver');

var _IntersectionObserver3 = _interopRequireDefault(_IntersectionObserver2);

var _intersectionObserver = require('intersection-observer');

var _intersectionObserver2 = _interopRequireDefault(_intersectionObserver);

var _Environment = require('../../Environment/Environment');

var Environment = _interopRequireWildcard(_Environment);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

/**
 * Represents a measurement technique that uses the IntersectionObserver API polyfill
 * @extends {IntersectionObserver}
 */
var IntersectionObserverPolyfill = function (_IntersectionObserver) {
  _inherits(IntersectionObserverPolyfill, _IntersectionObserver);

  function IntersectionObserverPolyfill() {
    _classCallCheck(this, IntersectionObserverPolyfill);

    return _possibleConstructorReturn(this, (IntersectionObserverPolyfill.__proto__ || Object.getPrototypeOf(IntersectionObserverPolyfill)).apply(this, arguments));
  }

  _createClass(IntersectionObserverPolyfill, [{
    key: 'unmeasureable',

    /**
     * determines whether the measurement technique is capable of measuring given the current environment
     * @override
     * @return {Boolean}
     */
    get: function get() {
      return Environment.iFrameContext() === Environment.iFrameServingScenarios.CROSS_DOMAIN_IFRAME;
    }

    /**
     * @return {String} name of measurement technique
     */

  }, {
    key: 'techniqueName',
    get: function get() {
      return 'IntersectionObserverPolyFill';
    }
  }]);

  return IntersectionObserverPolyfill;
}(_IntersectionObserver3.default);

exports.default = IntersectionObserverPolyfill;
module.exports = exports['default'];

},{"../../Environment/Environment":2,"./IntersectionObserver":7,"intersection-observer":1}],9:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _IntersectionObserver = require('./IntersectionObserver');

Object.defineProperty(exports, 'IntersectionObserver', {
  enumerable: true,
  get: function get() {
    return _interopRequireDefault(_IntersectionObserver).default;
  }
});

var _IntersectionObserverPolyfill = require('./IntersectionObserverPolyfill');

Object.defineProperty(exports, 'IntersectionObserverPolyfill', {
  enumerable: true,
  get: function get() {
    return _interopRequireDefault(_IntersectionObserverPolyfill).default;
  }
});

var _BaseTechnique = require('./BaseTechnique');

Object.defineProperty(exports, 'BaseTechnique', {
  enumerable: true,
  get: function get() {
    return _interopRequireDefault(_BaseTechnique).default;
  }
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

},{"./BaseTechnique":6,"./IntersectionObserver":7,"./IntersectionObserverPolyfill":8}],10:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.StrategyFactory = exports.DEFAULT_STRATEGY = undefined;

var _Validators = require('../../Helpers/Validators');

var Validators = _interopRequireWildcard(_Validators);

var _MeasurementTechniques = require('../MeasurementTechniques/');

var MeasurementTechniques = _interopRequireWildcard(_MeasurementTechniques);

var _ViewabilityCriteria = require('../../Options/ViewabilityCriteria');

var ViewabilityCriteria = _interopRequireWildcard(_ViewabilityCriteria);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

/**
 * represents default measurement strategy. Defines autostart, techniques, and measurement criteria
 * @type {Object}
 */
var DEFAULT_STRATEGY = exports.DEFAULT_STRATEGY = {
  autostart: true,
  techniques: [MeasurementTechniques.IntersectionObserver, MeasurementTechniques.IntersectionObserverPolyfill],
  criteria: ViewabilityCriteria.MRC_VIDEO
};

/**
 * Create strategy object using the provided values
 * @param  {Boolean} autostart - whether measurement should start immediately
 * @param  {Array.<BaseTechnique>} techniques - list of techniques to use for measurement. First non-unmeasureable technique will be used
 * @param  {Object} criteria - criteria object. See Options/ViewabilityCriteria for pre-defined criteria and criteria factory
 * @return {Object} object containing appropriately named properties to be used as measurement strategy
 */
/**
 * Strategies module
 * @module Measurement/Strategies
 * represents constants and factories related to measurement strategies 
 */

var StrategyFactory = exports.StrategyFactory = function StrategyFactory() {
  var autostart = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : DEFAULT_STRATEGY.autostart;
  var techniques = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : DEFAULT_STRATEGY.techniques;
  var criteria = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : DEFAULT_STRATEGY.criteria;

  var strategy = { autostart: autostart, techniques: techniques, criteria: criteria },
      validated = Validators.validateStrategy(strategy);

  if (validated.invalid) {
    throw validated.reasons;
  }

  return strategy;
};

},{"../../Helpers/Validators":3,"../../Options/ViewabilityCriteria":12,"../MeasurementTechniques/":9}],11:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _Events = require('./Measurement/Events');

var Events = _interopRequireWildcard(_Events);

var _InViewTimer = require('./Timing/InViewTimer');

var _InViewTimer2 = _interopRequireDefault(_InViewTimer);

var _Strategies = require('./Measurement/Strategies/');

var Strategies = _interopRequireWildcard(_Strategies);

var _Environment = require('./Environment/Environment');

var Environment = _interopRequireWildcard(_Environment);

var _MeasurementExecutor = require('./Measurement/MeasurementExecutor');

var _MeasurementExecutor2 = _interopRequireDefault(_MeasurementExecutor);

var _ViewabilityCriteria = require('./Options/ViewabilityCriteria');

var ViewabilityCriteria = _interopRequireWildcard(_ViewabilityCriteria);

var _MeasurementTechniques = require('./Measurement/MeasurementTechniques/');

var MeasurementTechniques = _interopRequireWildcard(_MeasurementTechniques);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

/** Class represents the main entry point to the OpenVV library */
var OpenVV = function () {
  /**
   * Create a new instance of OpenVV 
   */
  function OpenVV() {
    _classCallCheck(this, OpenVV);

    this.executors = [];
  }

  /**
   * Allows measurement of an element using a strategy definition  
   * @param  {HTMLElement} element - the element you'd like measure viewability on
   * @param  {Object} strategy - an object representing the strategy to use for measurement. 
   * See OpenVV.Strategies for StrategyFactory and DEFAULT_STRATEGY for more information. 
   * @return {MeasurementExecutor} returns instance of MeasurmentExecutor. 
   * This instance exposes event listeners onViewableStart, onViewableStop, onViewableChange, onViewableComplete, and onUnmeasureable
   * Also exposes start and dispose
   */


  _createClass(OpenVV, [{
    key: 'measureElement',
    value: function measureElement(element, strategy) {
      var executor = new _MeasurementExecutor2.default(element, strategy);
      this.executors.push(executor);
      return executor;
    }

    /**
     * destroys all measurement executors
     */

  }, {
    key: 'dispose',
    value: function dispose() {
      this.executors.forEach(function (e) {
        return e.dispose();
      });
    }
  }]);

  return OpenVV;
}();

/**
 * Exposes all public classes and constants available in the OpenVV package
 */


exports.default = OpenVV;
OpenVV.ViewabilityCriteria = ViewabilityCriteria;
OpenVV.MeasurementExecutor = _MeasurementExecutor2.default;
OpenVV.MeasurementTechniques = MeasurementTechniques;
OpenVV.InViewTimer = _InViewTimer2.default;
OpenVV.Strategies = Strategies;
OpenVV.Events = Events;
module.exports = exports['default'];

},{"./Environment/Environment":2,"./Measurement/Events":4,"./Measurement/MeasurementExecutor":5,"./Measurement/MeasurementTechniques/":9,"./Measurement/Strategies/":10,"./Options/ViewabilityCriteria":12,"./Timing/InViewTimer":13}],12:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
/**
 * Viewability Criteria module
 * @module Options/ViewabilityCriteria
 * represents constants and factories related to measurement criteria 
 */

/**
 * Represents criteria for MRC viewable video impression
 * @type {Object}
 */
var MRC_VIDEO = exports.MRC_VIDEO = {
  inViewThreshold: 0.5,
  timeInView: 2000
};

/**
 * Represents criteria for MRC viewable display impression
 * @type {Object}
 */
var MRC_DISPLAY = exports.MRC_DISPLAY = {
  inViewThreshold: 0.5,
  timeInView: 1000
};

/**
 * Creates custom criteria object using the threshold and duration provided 
 * @param  {Number} - amount element must be in view before it is considered in view
 * @param  {Number} - how long element must be in view before it is considered viewable
 * @return {Object} object containing appropriately named properties to be used as viewability criteria 
 */
var customCriteria = exports.customCriteria = function customCriteria() {
  var inViewThreshold = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 0.5;
  var timeInView = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 2000;
  return { inViewThreshold: inViewThreshold, timeInView: timeInView };
};

},{}],13:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

/**
 * Represents a timer class to notify a listener when a specified duration has elapsed
 */
var InViewTimer = function () {
  /**
   * Creates new instance of an InViewTimer
   * @constructor
   * @param  {Number} duration - when to fire elapsed callback
   * @return {InViewTimer} instance of InViewTimer
   */
  function InViewTimer(duration) {
    _classCallCheck(this, InViewTimer);

    this.duration = duration;
    this.listeners = [];
    this.completed = false;
  }

  /**
   * notifies listeners that timer has elapsed for the specified duration
   */


  _createClass(InViewTimer, [{
    key: 'timerComplete',
    value: function timerComplete() {
      this.completed = true;
      this.listeners.forEach(function (l) {
        return l();
      });
    }

    /**
     * accepts callback functions to call when the timer has elapsed
     * @param  {Function} cb - callback to call when timer has elapsed
     */

  }, {
    key: 'elapsed',
    value: function elapsed(cb) {
      if (typeof cb === 'function') {
        this.listeners.push(cb);
      }
    }

    /**
     * start timer
     */

  }, {
    key: 'start',
    value: function start() {
      this.endTimer();
      this.timer = setTimeout(this.timerComplete.bind(this), this.duration);
    }

    /** stop timer */

  }, {
    key: 'stop',
    value: function stop() {
      this.endTimer();
    }

    /** clears setTimeout associated with class */

  }, {
    key: 'endTimer',
    value: function endTimer() {
      if (this.timer) {
        clearTimeout(this.timer);
        this.listeners.length = 0;
      }
    }

    /** destroys timer */

  }, {
    key: 'dispose',
    value: function dispose() {
      this.endTimer();
    }
  }]);

  return InViewTimer;
}();

exports.default = InViewTimer;
module.exports = exports['default'];

},{}]},{},[11])(11)
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvaW50ZXJzZWN0aW9uLW9ic2VydmVyL2ludGVyc2VjdGlvbi1vYnNlcnZlci5qcyIsInNyYy9FbnZpcm9ubWVudC9FbnZpcm9ubWVudC5qcyIsInNyYy9IZWxwZXJzL1ZhbGlkYXRvcnMuanMiLCJzcmMvTWVhc3VyZW1lbnQvRXZlbnRzLmpzIiwic3JjL01lYXN1cmVtZW50L01lYXN1cmVtZW50RXhlY3V0b3IuanMiLCJzcmMvTWVhc3VyZW1lbnQvTWVhc3VyZW1lbnRUZWNobmlxdWVzL0Jhc2VUZWNobmlxdWUuanMiLCJzcmMvTWVhc3VyZW1lbnQvTWVhc3VyZW1lbnRUZWNobmlxdWVzL0ludGVyc2VjdGlvbk9ic2VydmVyLmpzIiwic3JjL01lYXN1cmVtZW50L01lYXN1cmVtZW50VGVjaG5pcXVlcy9JbnRlcnNlY3Rpb25PYnNlcnZlclBvbHlmaWxsLmpzIiwic3JjL01lYXN1cmVtZW50L01lYXN1cmVtZW50VGVjaG5pcXVlcy9pbmRleC5qcyIsInNyYy9NZWFzdXJlbWVudC9TdHJhdGVnaWVzL2luZGV4LmpzIiwic3JjL09wZW5WVi5qcyIsInNyYy9PcHRpb25zL1ZpZXdhYmlsaXR5Q3JpdGVyaWEuanMiLCJzcmMvVGltaW5nL0luVmlld1RpbWVyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNB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dCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIvKipcbiAqIENvcHlyaWdodCAyMDE2IEdvb2dsZSBJbmMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogTGljZW5zZWQgdW5kZXIgdGhlIEFwYWNoZSBMaWNlbnNlLCBWZXJzaW9uIDIuMCAodGhlIFwiTGljZW5zZVwiKTtcbiAqIHlvdSBtYXkgbm90IHVzZSB0aGlzIGZpbGUgZXhjZXB0IGluIGNvbXBsaWFuY2Ugd2l0aCB0aGUgTGljZW5zZS5cbiAqIFlvdSBtYXkgb2J0YWluIGEgY29weSBvZiB0aGUgTGljZW5zZSBhdFxuICpcbiAqICAgICBodHRwOi8vd3d3LmFwYWNoZS5vcmcvbGljZW5zZXMvTElDRU5TRS0yLjBcbiAqXG4gKiBVbmxlc3MgcmVxdWlyZWQgYnkgYXBwbGljYWJsZSBsYXcgb3IgYWdyZWVkIHRvIGluIHdyaXRpbmcsIHNvZnR3YXJlXG4gKiBkaXN0cmlidXRlZCB1bmRlciB0aGUgTGljZW5zZSBpcyBkaXN0cmlidXRlZCBvbiBhbiBcIkFTIElTXCIgQkFTSVMsXG4gKiBXSVRIT1VUIFdBUlJBTlRJRVMgT1IgQ09ORElUSU9OUyBPRiBBTlkgS0lORCwgZWl0aGVyIGV4cHJlc3Mgb3IgaW1wbGllZC5cbiAqIFNlZSB0aGUgTGljZW5zZSBmb3IgdGhlIHNwZWNpZmljIGxhbmd1YWdlIGdvdmVybmluZyBwZXJtaXNzaW9ucyBhbmRcbiAqIGxpbWl0YXRpb25zIHVuZGVyIHRoZSBMaWNlbnNlLlxuICovXG5cbihmdW5jdGlvbih3aW5kb3csIGRvY3VtZW50KSB7XG4ndXNlIHN0cmljdCc7XG5cblxuLy8gRXhpdHMgZWFybHkgaWYgYWxsIEludGVyc2VjdGlvbk9ic2VydmVyIGFuZCBJbnRlcnNlY3Rpb25PYnNlcnZlckVudHJ5XG4vLyBmZWF0dXJlcyBhcmUgbmF0aXZlbHkgc3VwcG9ydGVkLlxuaWYgKCdJbnRlcnNlY3Rpb25PYnNlcnZlcicgaW4gd2luZG93ICYmXG4gICAgJ0ludGVyc2VjdGlvbk9ic2VydmVyRW50cnknIGluIHdpbmRvdyAmJlxuICAgICdpbnRlcnNlY3Rpb25SYXRpbycgaW4gd2luZG93LkludGVyc2VjdGlvbk9ic2VydmVyRW50cnkucHJvdG90eXBlKSB7XG4gIHJldHVybjtcbn1cblxuXG4vKipcbiAqIEFuIEludGVyc2VjdGlvbk9ic2VydmVyIHJlZ2lzdHJ5LiBUaGlzIHJlZ2lzdHJ5IGV4aXN0cyB0byBob2xkIGEgc3Ryb25nXG4gKiByZWZlcmVuY2UgdG8gSW50ZXJzZWN0aW9uT2JzZXJ2ZXIgaW5zdGFuY2VzIGN1cnJlbnRseSBvYnNlcnZlcmluZyBhIHRhcmdldFxuICogZWxlbWVudC4gV2l0aG91dCB0aGlzIHJlZ2lzdHJ5LCBpbnN0YW5jZXMgd2l0aG91dCBhbm90aGVyIHJlZmVyZW5jZSBtYXkgYmVcbiAqIGdhcmJhZ2UgY29sbGVjdGVkLlxuICovXG52YXIgcmVnaXN0cnkgPSBbXTtcblxuXG4vKipcbiAqIENyZWF0ZXMgdGhlIGdsb2JhbCBJbnRlcnNlY3Rpb25PYnNlcnZlckVudHJ5IGNvbnN0cnVjdG9yLlxuICogaHR0cHM6Ly93aWNnLmdpdGh1Yi5pby9JbnRlcnNlY3Rpb25PYnNlcnZlci8jaW50ZXJzZWN0aW9uLW9ic2VydmVyLWVudHJ5XG4gKiBAcGFyYW0ge09iamVjdH0gZW50cnkgQSBkaWN0aW9uYXJ5IG9mIGluc3RhbmNlIHByb3BlcnRpZXMuXG4gKiBAY29uc3RydWN0b3JcbiAqL1xuZnVuY3Rpb24gSW50ZXJzZWN0aW9uT2JzZXJ2ZXJFbnRyeShlbnRyeSkge1xuICB0aGlzLnRpbWUgPSBlbnRyeS50aW1lO1xuICB0aGlzLnRhcmdldCA9IGVudHJ5LnRhcmdldDtcbiAgdGhpcy5yb290Qm91bmRzID0gZW50cnkucm9vdEJvdW5kcztcbiAgdGhpcy5ib3VuZGluZ0NsaWVudFJlY3QgPSBlbnRyeS5ib3VuZGluZ0NsaWVudFJlY3Q7XG4gIHRoaXMuaW50ZXJzZWN0aW9uUmVjdCA9IGVudHJ5LmludGVyc2VjdGlvblJlY3QgfHwgZ2V0RW1wdHlSZWN0KCk7XG4gIHRoaXMuaXNJbnRlcnNlY3RpbmcgPSAhIWVudHJ5LmludGVyc2VjdGlvblJlY3Q7XG5cbiAgLy8gQ2FsY3VsYXRlcyB0aGUgaW50ZXJzZWN0aW9uIHJhdGlvLlxuICB2YXIgdGFyZ2V0UmVjdCA9IHRoaXMuYm91bmRpbmdDbGllbnRSZWN0O1xuICB2YXIgdGFyZ2V0QXJlYSA9IHRhcmdldFJlY3Qud2lkdGggKiB0YXJnZXRSZWN0LmhlaWdodDtcbiAgdmFyIGludGVyc2VjdGlvblJlY3QgPSB0aGlzLmludGVyc2VjdGlvblJlY3Q7XG4gIHZhciBpbnRlcnNlY3Rpb25BcmVhID0gaW50ZXJzZWN0aW9uUmVjdC53aWR0aCAqIGludGVyc2VjdGlvblJlY3QuaGVpZ2h0O1xuXG4gIC8vIFNldHMgaW50ZXJzZWN0aW9uIHJhdGlvLlxuICBpZiAodGFyZ2V0QXJlYSkge1xuICAgIHRoaXMuaW50ZXJzZWN0aW9uUmF0aW8gPSBpbnRlcnNlY3Rpb25BcmVhIC8gdGFyZ2V0QXJlYTtcbiAgfSBlbHNlIHtcbiAgICAvLyBJZiBhcmVhIGlzIHplcm8gYW5kIGlzIGludGVyc2VjdGluZywgc2V0cyB0byAxLCBvdGhlcndpc2UgdG8gMFxuICAgIHRoaXMuaW50ZXJzZWN0aW9uUmF0aW8gPSB0aGlzLmlzSW50ZXJzZWN0aW5nID8gMSA6IDA7XG4gIH1cbn1cblxuXG4vKipcbiAqIENyZWF0ZXMgdGhlIGdsb2JhbCBJbnRlcnNlY3Rpb25PYnNlcnZlciBjb25zdHJ1Y3Rvci5cbiAqIGh0dHBzOi8vd2ljZy5naXRodWIuaW8vSW50ZXJzZWN0aW9uT2JzZXJ2ZXIvI2ludGVyc2VjdGlvbi1vYnNlcnZlci1pbnRlcmZhY2VcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGNhbGxiYWNrIFRoZSBmdW5jdGlvbiB0byBiZSBpbnZva2VkIGFmdGVyIGludGVyc2VjdGlvblxuICogICAgIGNoYW5nZXMgaGF2ZSBxdWV1ZWQuIFRoZSBmdW5jdGlvbiBpcyBub3QgaW52b2tlZCBpZiB0aGUgcXVldWUgaGFzXG4gKiAgICAgYmVlbiBlbXB0aWVkIGJ5IGNhbGxpbmcgdGhlIGB0YWtlUmVjb3Jkc2AgbWV0aG9kLlxuICogQHBhcmFtIHtPYmplY3Q9fSBvcHRfb3B0aW9ucyBPcHRpb25hbCBjb25maWd1cmF0aW9uIG9wdGlvbnMuXG4gKiBAY29uc3RydWN0b3JcbiAqL1xuZnVuY3Rpb24gSW50ZXJzZWN0aW9uT2JzZXJ2ZXIoY2FsbGJhY2ssIG9wdF9vcHRpb25zKSB7XG5cbiAgdmFyIG9wdGlvbnMgPSBvcHRfb3B0aW9ucyB8fCB7fTtcblxuICBpZiAodHlwZW9mIGNhbGxiYWNrICE9ICdmdW5jdGlvbicpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ2NhbGxiYWNrIG11c3QgYmUgYSBmdW5jdGlvbicpO1xuICB9XG5cbiAgaWYgKG9wdGlvbnMucm9vdCAmJiBvcHRpb25zLnJvb3Qubm9kZVR5cGUgIT0gMSkge1xuICAgIHRocm93IG5ldyBFcnJvcigncm9vdCBtdXN0IGJlIGFuIEVsZW1lbnQnKTtcbiAgfVxuXG4gIC8vIEJpbmRzIGFuZCB0aHJvdHRsZXMgYHRoaXMuX2NoZWNrRm9ySW50ZXJzZWN0aW9uc2AuXG4gIHRoaXMuX2NoZWNrRm9ySW50ZXJzZWN0aW9ucyA9IHRocm90dGxlKFxuICAgICAgdGhpcy5fY2hlY2tGb3JJbnRlcnNlY3Rpb25zLmJpbmQodGhpcyksIHRoaXMuVEhST1RUTEVfVElNRU9VVCk7XG5cbiAgLy8gUHJpdmF0ZSBwcm9wZXJ0aWVzLlxuICB0aGlzLl9jYWxsYmFjayA9IGNhbGxiYWNrO1xuICB0aGlzLl9vYnNlcnZhdGlvblRhcmdldHMgPSBbXTtcbiAgdGhpcy5fcXVldWVkRW50cmllcyA9IFtdO1xuICB0aGlzLl9yb290TWFyZ2luVmFsdWVzID0gdGhpcy5fcGFyc2VSb290TWFyZ2luKG9wdGlvbnMucm9vdE1hcmdpbik7XG5cbiAgLy8gUHVibGljIHByb3BlcnRpZXMuXG4gIHRoaXMudGhyZXNob2xkcyA9IHRoaXMuX2luaXRUaHJlc2hvbGRzKG9wdGlvbnMudGhyZXNob2xkKTtcbiAgdGhpcy5yb290ID0gb3B0aW9ucy5yb290IHx8IG51bGw7XG4gIHRoaXMucm9vdE1hcmdpbiA9IHRoaXMuX3Jvb3RNYXJnaW5WYWx1ZXMubWFwKGZ1bmN0aW9uKG1hcmdpbikge1xuICAgIHJldHVybiBtYXJnaW4udmFsdWUgKyBtYXJnaW4udW5pdDtcbiAgfSkuam9pbignICcpO1xufVxuXG5cbi8qKlxuICogVGhlIG1pbmltdW0gaW50ZXJ2YWwgd2l0aGluIHdoaWNoIHRoZSBkb2N1bWVudCB3aWxsIGJlIGNoZWNrZWQgZm9yXG4gKiBpbnRlcnNlY3Rpb24gY2hhbmdlcy5cbiAqL1xuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLlRIUk9UVExFX1RJTUVPVVQgPSAxMDA7XG5cblxuLyoqXG4gKiBUaGUgZnJlcXVlbmN5IGluIHdoaWNoIHRoZSBwb2x5ZmlsbCBwb2xscyBmb3IgaW50ZXJzZWN0aW9uIGNoYW5nZXMuXG4gKiB0aGlzIGNhbiBiZSB1cGRhdGVkIG9uIGEgcGVyIGluc3RhbmNlIGJhc2lzIGFuZCBtdXN0IGJlIHNldCBwcmlvciB0b1xuICogY2FsbGluZyBgb2JzZXJ2ZWAgb24gdGhlIGZpcnN0IHRhcmdldC5cbiAqL1xuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLlBPTExfSU5URVJWQUwgPSBudWxsO1xuXG5cbi8qKlxuICogU3RhcnRzIG9ic2VydmluZyBhIHRhcmdldCBlbGVtZW50IGZvciBpbnRlcnNlY3Rpb24gY2hhbmdlcyBiYXNlZCBvblxuICogdGhlIHRocmVzaG9sZHMgdmFsdWVzLlxuICogQHBhcmFtIHtFbGVtZW50fSB0YXJnZXQgVGhlIERPTSBlbGVtZW50IHRvIG9ic2VydmUuXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5vYnNlcnZlID0gZnVuY3Rpb24odGFyZ2V0KSB7XG4gIC8vIElmIHRoZSB0YXJnZXQgaXMgYWxyZWFkeSBiZWluZyBvYnNlcnZlZCwgZG8gbm90aGluZy5cbiAgaWYgKHRoaXMuX29ic2VydmF0aW9uVGFyZ2V0cy5zb21lKGZ1bmN0aW9uKGl0ZW0pIHtcbiAgICByZXR1cm4gaXRlbS5lbGVtZW50ID09IHRhcmdldDtcbiAgfSkpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICBpZiAoISh0YXJnZXQgJiYgdGFyZ2V0Lm5vZGVUeXBlID09IDEpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCd0YXJnZXQgbXVzdCBiZSBhbiBFbGVtZW50Jyk7XG4gIH1cblxuICB0aGlzLl9yZWdpc3Rlckluc3RhbmNlKCk7XG4gIHRoaXMuX29ic2VydmF0aW9uVGFyZ2V0cy5wdXNoKHtlbGVtZW50OiB0YXJnZXQsIGVudHJ5OiBudWxsfSk7XG4gIHRoaXMuX21vbml0b3JJbnRlcnNlY3Rpb25zKCk7XG59O1xuXG5cbi8qKlxuICogU3RvcHMgb2JzZXJ2aW5nIGEgdGFyZ2V0IGVsZW1lbnQgZm9yIGludGVyc2VjdGlvbiBjaGFuZ2VzLlxuICogQHBhcmFtIHtFbGVtZW50fSB0YXJnZXQgVGhlIERPTSBlbGVtZW50IHRvIG9ic2VydmUuXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS51bm9ic2VydmUgPSBmdW5jdGlvbih0YXJnZXQpIHtcbiAgdGhpcy5fb2JzZXJ2YXRpb25UYXJnZXRzID1cbiAgICAgIHRoaXMuX29ic2VydmF0aW9uVGFyZ2V0cy5maWx0ZXIoZnVuY3Rpb24oaXRlbSkge1xuXG4gICAgcmV0dXJuIGl0ZW0uZWxlbWVudCAhPSB0YXJnZXQ7XG4gIH0pO1xuICBpZiAoIXRoaXMuX29ic2VydmF0aW9uVGFyZ2V0cy5sZW5ndGgpIHtcbiAgICB0aGlzLl91bm1vbml0b3JJbnRlcnNlY3Rpb25zKCk7XG4gICAgdGhpcy5fdW5yZWdpc3Rlckluc3RhbmNlKCk7XG4gIH1cbn07XG5cblxuLyoqXG4gKiBTdG9wcyBvYnNlcnZpbmcgYWxsIHRhcmdldCBlbGVtZW50cyBmb3IgaW50ZXJzZWN0aW9uIGNoYW5nZXMuXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5kaXNjb25uZWN0ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuX29ic2VydmF0aW9uVGFyZ2V0cyA9IFtdO1xuICB0aGlzLl91bm1vbml0b3JJbnRlcnNlY3Rpb25zKCk7XG4gIHRoaXMuX3VucmVnaXN0ZXJJbnN0YW5jZSgpO1xufTtcblxuXG4vKipcbiAqIFJldHVybnMgYW55IHF1ZXVlIGVudHJpZXMgdGhhdCBoYXZlIG5vdCB5ZXQgYmVlbiByZXBvcnRlZCB0byB0aGVcbiAqIGNhbGxiYWNrIGFuZCBjbGVhcnMgdGhlIHF1ZXVlLiBUaGlzIGNhbiBiZSB1c2VkIGluIGNvbmp1bmN0aW9uIHdpdGggdGhlXG4gKiBjYWxsYmFjayB0byBvYnRhaW4gdGhlIGFic29sdXRlIG1vc3QgdXAtdG8tZGF0ZSBpbnRlcnNlY3Rpb24gaW5mb3JtYXRpb24uXG4gKiBAcmV0dXJuIHtBcnJheX0gVGhlIGN1cnJlbnRseSBxdWV1ZWQgZW50cmllcy5cbiAqL1xuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLnRha2VSZWNvcmRzID0gZnVuY3Rpb24oKSB7XG4gIHZhciByZWNvcmRzID0gdGhpcy5fcXVldWVkRW50cmllcy5zbGljZSgpO1xuICB0aGlzLl9xdWV1ZWRFbnRyaWVzID0gW107XG4gIHJldHVybiByZWNvcmRzO1xufTtcblxuXG4vKipcbiAqIEFjY2VwdHMgdGhlIHRocmVzaG9sZCB2YWx1ZSBmcm9tIHRoZSB1c2VyIGNvbmZpZ3VyYXRpb24gb2JqZWN0IGFuZFxuICogcmV0dXJucyBhIHNvcnRlZCBhcnJheSBvZiB1bmlxdWUgdGhyZXNob2xkIHZhbHVlcy4gSWYgYSB2YWx1ZSBpcyBub3RcbiAqIGJldHdlZW4gMCBhbmQgMSBhbmQgZXJyb3IgaXMgdGhyb3duLlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7QXJyYXl8bnVtYmVyPX0gb3B0X3RocmVzaG9sZCBBbiBvcHRpb25hbCB0aHJlc2hvbGQgdmFsdWUgb3JcbiAqICAgICBhIGxpc3Qgb2YgdGhyZXNob2xkIHZhbHVlcywgZGVmYXVsdGluZyB0byBbMF0uXG4gKiBAcmV0dXJuIHtBcnJheX0gQSBzb3J0ZWQgbGlzdCBvZiB1bmlxdWUgYW5kIHZhbGlkIHRocmVzaG9sZCB2YWx1ZXMuXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5faW5pdFRocmVzaG9sZHMgPSBmdW5jdGlvbihvcHRfdGhyZXNob2xkKSB7XG4gIHZhciB0aHJlc2hvbGQgPSBvcHRfdGhyZXNob2xkIHx8IFswXTtcbiAgaWYgKCFBcnJheS5pc0FycmF5KHRocmVzaG9sZCkpIHRocmVzaG9sZCA9IFt0aHJlc2hvbGRdO1xuXG4gIHJldHVybiB0aHJlc2hvbGQuc29ydCgpLmZpbHRlcihmdW5jdGlvbih0LCBpLCBhKSB7XG4gICAgaWYgKHR5cGVvZiB0ICE9ICdudW1iZXInIHx8IGlzTmFOKHQpIHx8IHQgPCAwIHx8IHQgPiAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ3RocmVzaG9sZCBtdXN0IGJlIGEgbnVtYmVyIGJldHdlZW4gMCBhbmQgMSBpbmNsdXNpdmVseScpO1xuICAgIH1cbiAgICByZXR1cm4gdCAhPT0gYVtpIC0gMV07XG4gIH0pO1xufTtcblxuXG4vKipcbiAqIEFjY2VwdHMgdGhlIHJvb3RNYXJnaW4gdmFsdWUgZnJvbSB0aGUgdXNlciBjb25maWd1cmF0aW9uIG9iamVjdFxuICogYW5kIHJldHVybnMgYW4gYXJyYXkgb2YgdGhlIGZvdXIgbWFyZ2luIHZhbHVlcyBhcyBhbiBvYmplY3QgY29udGFpbmluZ1xuICogdGhlIHZhbHVlIGFuZCB1bml0IHByb3BlcnRpZXMuIElmIGFueSBvZiB0aGUgdmFsdWVzIGFyZSBub3QgcHJvcGVybHlcbiAqIGZvcm1hdHRlZCBvciB1c2UgYSB1bml0IG90aGVyIHRoYW4gcHggb3IgJSwgYW5kIGVycm9yIGlzIHRocm93bi5cbiAqIEBwcml2YXRlXG4gKiBAcGFyYW0ge3N0cmluZz19IG9wdF9yb290TWFyZ2luIEFuIG9wdGlvbmFsIHJvb3RNYXJnaW4gdmFsdWUsXG4gKiAgICAgZGVmYXVsdGluZyB0byAnMHB4Jy5cbiAqIEByZXR1cm4ge0FycmF5PE9iamVjdD59IEFuIGFycmF5IG9mIG1hcmdpbiBvYmplY3RzIHdpdGggdGhlIGtleXNcbiAqICAgICB2YWx1ZSBhbmQgdW5pdC5cbiAqL1xuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLl9wYXJzZVJvb3RNYXJnaW4gPSBmdW5jdGlvbihvcHRfcm9vdE1hcmdpbikge1xuICB2YXIgbWFyZ2luU3RyaW5nID0gb3B0X3Jvb3RNYXJnaW4gfHwgJzBweCc7XG4gIHZhciBtYXJnaW5zID0gbWFyZ2luU3RyaW5nLnNwbGl0KC9cXHMrLykubWFwKGZ1bmN0aW9uKG1hcmdpbikge1xuICAgIHZhciBwYXJ0cyA9IC9eKC0/XFxkKlxcLj9cXGQrKShweHwlKSQvLmV4ZWMobWFyZ2luKTtcbiAgICBpZiAoIXBhcnRzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ3Jvb3RNYXJnaW4gbXVzdCBiZSBzcGVjaWZpZWQgaW4gcGl4ZWxzIG9yIHBlcmNlbnQnKTtcbiAgICB9XG4gICAgcmV0dXJuIHt2YWx1ZTogcGFyc2VGbG9hdChwYXJ0c1sxXSksIHVuaXQ6IHBhcnRzWzJdfTtcbiAgfSk7XG5cbiAgLy8gSGFuZGxlcyBzaG9ydGhhbmQuXG4gIG1hcmdpbnNbMV0gPSBtYXJnaW5zWzFdIHx8IG1hcmdpbnNbMF07XG4gIG1hcmdpbnNbMl0gPSBtYXJnaW5zWzJdIHx8IG1hcmdpbnNbMF07XG4gIG1hcmdpbnNbM10gPSBtYXJnaW5zWzNdIHx8IG1hcmdpbnNbMV07XG5cbiAgcmV0dXJuIG1hcmdpbnM7XG59O1xuXG5cbi8qKlxuICogU3RhcnRzIHBvbGxpbmcgZm9yIGludGVyc2VjdGlvbiBjaGFuZ2VzIGlmIHRoZSBwb2xsaW5nIGlzIG5vdCBhbHJlYWR5XG4gKiBoYXBwZW5pbmcsIGFuZCBpZiB0aGUgcGFnZSdzIHZpc2liaWx0eSBzdGF0ZSBpcyB2aXNpYmxlLlxuICogQHByaXZhdGVcbiAqL1xuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLl9tb25pdG9ySW50ZXJzZWN0aW9ucyA9IGZ1bmN0aW9uKCkge1xuICBpZiAoIXRoaXMuX21vbml0b3JpbmdJbnRlcnNlY3Rpb25zKSB7XG4gICAgdGhpcy5fbW9uaXRvcmluZ0ludGVyc2VjdGlvbnMgPSB0cnVlO1xuXG4gICAgdGhpcy5fY2hlY2tGb3JJbnRlcnNlY3Rpb25zKCk7XG5cbiAgICAvLyBJZiBhIHBvbGwgaW50ZXJ2YWwgaXMgc2V0LCB1c2UgcG9sbGluZyBpbnN0ZWFkIG9mIGxpc3RlbmluZyB0b1xuICAgIC8vIHJlc2l6ZSBhbmQgc2Nyb2xsIGV2ZW50cyBvciBET00gbXV0YXRpb25zLlxuICAgIGlmICh0aGlzLlBPTExfSU5URVJWQUwpIHtcbiAgICAgIHRoaXMuX21vbml0b3JpbmdJbnRlcnZhbCA9IHNldEludGVydmFsKFxuICAgICAgICAgIHRoaXMuX2NoZWNrRm9ySW50ZXJzZWN0aW9ucywgdGhpcy5QT0xMX0lOVEVSVkFMKTtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICBhZGRFdmVudCh3aW5kb3csICdyZXNpemUnLCB0aGlzLl9jaGVja0ZvckludGVyc2VjdGlvbnMsIHRydWUpO1xuICAgICAgYWRkRXZlbnQoZG9jdW1lbnQsICdzY3JvbGwnLCB0aGlzLl9jaGVja0ZvckludGVyc2VjdGlvbnMsIHRydWUpO1xuXG4gICAgICBpZiAoJ011dGF0aW9uT2JzZXJ2ZXInIGluIHdpbmRvdykge1xuICAgICAgICB0aGlzLl9kb21PYnNlcnZlciA9IG5ldyBNdXRhdGlvbk9ic2VydmVyKHRoaXMuX2NoZWNrRm9ySW50ZXJzZWN0aW9ucyk7XG4gICAgICAgIHRoaXMuX2RvbU9ic2VydmVyLm9ic2VydmUoZG9jdW1lbnQsIHtcbiAgICAgICAgICBhdHRyaWJ1dGVzOiB0cnVlLFxuICAgICAgICAgIGNoaWxkTGlzdDogdHJ1ZSxcbiAgICAgICAgICBjaGFyYWN0ZXJEYXRhOiB0cnVlLFxuICAgICAgICAgIHN1YnRyZWU6IHRydWVcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuICB9XG59O1xuXG5cbi8qKlxuICogU3RvcHMgcG9sbGluZyBmb3IgaW50ZXJzZWN0aW9uIGNoYW5nZXMuXG4gKiBAcHJpdmF0ZVxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuX3VubW9uaXRvckludGVyc2VjdGlvbnMgPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMuX21vbml0b3JpbmdJbnRlcnNlY3Rpb25zKSB7XG4gICAgdGhpcy5fbW9uaXRvcmluZ0ludGVyc2VjdGlvbnMgPSBmYWxzZTtcblxuICAgIGNsZWFySW50ZXJ2YWwodGhpcy5fbW9uaXRvcmluZ0ludGVydmFsKTtcbiAgICB0aGlzLl9tb25pdG9yaW5nSW50ZXJ2YWwgPSBudWxsO1xuXG4gICAgcmVtb3ZlRXZlbnQod2luZG93LCAncmVzaXplJywgdGhpcy5fY2hlY2tGb3JJbnRlcnNlY3Rpb25zLCB0cnVlKTtcbiAgICByZW1vdmVFdmVudChkb2N1bWVudCwgJ3Njcm9sbCcsIHRoaXMuX2NoZWNrRm9ySW50ZXJzZWN0aW9ucywgdHJ1ZSk7XG5cbiAgICBpZiAodGhpcy5fZG9tT2JzZXJ2ZXIpIHtcbiAgICAgIHRoaXMuX2RvbU9ic2VydmVyLmRpc2Nvbm5lY3QoKTtcbiAgICAgIHRoaXMuX2RvbU9ic2VydmVyID0gbnVsbDtcbiAgICB9XG4gIH1cbn07XG5cblxuLyoqXG4gKiBTY2FucyBlYWNoIG9ic2VydmF0aW9uIHRhcmdldCBmb3IgaW50ZXJzZWN0aW9uIGNoYW5nZXMgYW5kIGFkZHMgdGhlbVxuICogdG8gdGhlIGludGVybmFsIGVudHJpZXMgcXVldWUuIElmIG5ldyBlbnRyaWVzIGFyZSBmb3VuZCwgaXRcbiAqIHNjaGVkdWxlcyB0aGUgY2FsbGJhY2sgdG8gYmUgaW52b2tlZC5cbiAqIEBwcml2YXRlXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5fY2hlY2tGb3JJbnRlcnNlY3Rpb25zID0gZnVuY3Rpb24oKSB7XG4gIHZhciByb290SXNJbkRvbSA9IHRoaXMuX3Jvb3RJc0luRG9tKCk7XG4gIHZhciByb290UmVjdCA9IHJvb3RJc0luRG9tID8gdGhpcy5fZ2V0Um9vdFJlY3QoKSA6IGdldEVtcHR5UmVjdCgpO1xuXG4gIHRoaXMuX29ic2VydmF0aW9uVGFyZ2V0cy5mb3JFYWNoKGZ1bmN0aW9uKGl0ZW0pIHtcbiAgICB2YXIgdGFyZ2V0ID0gaXRlbS5lbGVtZW50O1xuICAgIHZhciB0YXJnZXRSZWN0ID0gZ2V0Qm91bmRpbmdDbGllbnRSZWN0KHRhcmdldCk7XG4gICAgdmFyIHJvb3RDb250YWluc1RhcmdldCA9IHRoaXMuX3Jvb3RDb250YWluc1RhcmdldCh0YXJnZXQpO1xuICAgIHZhciBvbGRFbnRyeSA9IGl0ZW0uZW50cnk7XG4gICAgdmFyIGludGVyc2VjdGlvblJlY3QgPSByb290SXNJbkRvbSAmJiByb290Q29udGFpbnNUYXJnZXQgJiZcbiAgICAgICAgdGhpcy5fY29tcHV0ZVRhcmdldEFuZFJvb3RJbnRlcnNlY3Rpb24odGFyZ2V0LCByb290UmVjdCk7XG5cbiAgICB2YXIgbmV3RW50cnkgPSBpdGVtLmVudHJ5ID0gbmV3IEludGVyc2VjdGlvbk9ic2VydmVyRW50cnkoe1xuICAgICAgdGltZTogbm93KCksXG4gICAgICB0YXJnZXQ6IHRhcmdldCxcbiAgICAgIGJvdW5kaW5nQ2xpZW50UmVjdDogdGFyZ2V0UmVjdCxcbiAgICAgIHJvb3RCb3VuZHM6IHJvb3RSZWN0LFxuICAgICAgaW50ZXJzZWN0aW9uUmVjdDogaW50ZXJzZWN0aW9uUmVjdFxuICAgIH0pO1xuXG4gICAgaWYgKCFvbGRFbnRyeSkge1xuICAgICAgdGhpcy5fcXVldWVkRW50cmllcy5wdXNoKG5ld0VudHJ5KTtcbiAgICB9IGVsc2UgaWYgKHJvb3RJc0luRG9tICYmIHJvb3RDb250YWluc1RhcmdldCkge1xuICAgICAgLy8gSWYgdGhlIG5ldyBlbnRyeSBpbnRlcnNlY3Rpb24gcmF0aW8gaGFzIGNyb3NzZWQgYW55IG9mIHRoZVxuICAgICAgLy8gdGhyZXNob2xkcywgYWRkIGEgbmV3IGVudHJ5LlxuICAgICAgaWYgKHRoaXMuX2hhc0Nyb3NzZWRUaHJlc2hvbGQob2xkRW50cnksIG5ld0VudHJ5KSkge1xuICAgICAgICB0aGlzLl9xdWV1ZWRFbnRyaWVzLnB1c2gobmV3RW50cnkpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBJZiB0aGUgcm9vdCBpcyBub3QgaW4gdGhlIERPTSBvciB0YXJnZXQgaXMgbm90IGNvbnRhaW5lZCB3aXRoaW5cbiAgICAgIC8vIHJvb3QgYnV0IHRoZSBwcmV2aW91cyBlbnRyeSBmb3IgdGhpcyB0YXJnZXQgaGFkIGFuIGludGVyc2VjdGlvbixcbiAgICAgIC8vIGFkZCBhIG5ldyByZWNvcmQgaW5kaWNhdGluZyByZW1vdmFsLlxuICAgICAgaWYgKG9sZEVudHJ5ICYmIG9sZEVudHJ5LmlzSW50ZXJzZWN0aW5nKSB7XG4gICAgICAgIHRoaXMuX3F1ZXVlZEVudHJpZXMucHVzaChuZXdFbnRyeSk7XG4gICAgICB9XG4gICAgfVxuICB9LCB0aGlzKTtcblxuICBpZiAodGhpcy5fcXVldWVkRW50cmllcy5sZW5ndGgpIHtcbiAgICB0aGlzLl9jYWxsYmFjayh0aGlzLnRha2VSZWNvcmRzKCksIHRoaXMpO1xuICB9XG59O1xuXG5cbi8qKlxuICogQWNjZXB0cyBhIHRhcmdldCBhbmQgcm9vdCByZWN0IGNvbXB1dGVzIHRoZSBpbnRlcnNlY3Rpb24gYmV0d2VlbiB0aGVuXG4gKiBmb2xsb3dpbmcgdGhlIGFsZ29yaXRobSBpbiB0aGUgc3BlYy5cbiAqIFRPRE8ocGhpbGlwd2FsdG9uKTogYXQgdGhpcyB0aW1lIGNsaXAtcGF0aCBpcyBub3QgY29uc2lkZXJlZC5cbiAqIGh0dHBzOi8vd2ljZy5naXRodWIuaW8vSW50ZXJzZWN0aW9uT2JzZXJ2ZXIvI2NhbGN1bGF0ZS1pbnRlcnNlY3Rpb24tcmVjdC1hbGdvXG4gKiBAcGFyYW0ge0VsZW1lbnR9IHRhcmdldCBUaGUgdGFyZ2V0IERPTSBlbGVtZW50XG4gKiBAcGFyYW0ge09iamVjdH0gcm9vdFJlY3QgVGhlIGJvdW5kaW5nIHJlY3Qgb2YgdGhlIHJvb3QgYWZ0ZXIgYmVpbmdcbiAqICAgICBleHBhbmRlZCBieSB0aGUgcm9vdE1hcmdpbiB2YWx1ZS5cbiAqIEByZXR1cm4gez9PYmplY3R9IFRoZSBmaW5hbCBpbnRlcnNlY3Rpb24gcmVjdCBvYmplY3Qgb3IgdW5kZWZpbmVkIGlmIG5vXG4gKiAgICAgaW50ZXJzZWN0aW9uIGlzIGZvdW5kLlxuICogQHByaXZhdGVcbiAqL1xuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLl9jb21wdXRlVGFyZ2V0QW5kUm9vdEludGVyc2VjdGlvbiA9XG4gICAgZnVuY3Rpb24odGFyZ2V0LCByb290UmVjdCkge1xuXG4gIC8vIElmIHRoZSBlbGVtZW50IGlzbid0IGRpc3BsYXllZCwgYW4gaW50ZXJzZWN0aW9uIGNhbid0IGhhcHBlbi5cbiAgaWYgKHdpbmRvdy5nZXRDb21wdXRlZFN0eWxlKHRhcmdldCkuZGlzcGxheSA9PSAnbm9uZScpIHJldHVybjtcblxuICB2YXIgdGFyZ2V0UmVjdCA9IGdldEJvdW5kaW5nQ2xpZW50UmVjdCh0YXJnZXQpO1xuICB2YXIgaW50ZXJzZWN0aW9uUmVjdCA9IHRhcmdldFJlY3Q7XG4gIHZhciBwYXJlbnQgPSBnZXRQYXJlbnROb2RlKHRhcmdldCk7XG4gIHZhciBhdFJvb3QgPSBmYWxzZTtcblxuICB3aGlsZSAoIWF0Um9vdCkge1xuICAgIHZhciBwYXJlbnRSZWN0ID0gbnVsbDtcbiAgICB2YXIgcGFyZW50Q29tcHV0ZWRTdHlsZSA9IHBhcmVudC5ub2RlVHlwZSA9PSAxID9cbiAgICAgICAgd2luZG93LmdldENvbXB1dGVkU3R5bGUocGFyZW50KSA6IHt9O1xuXG4gICAgLy8gSWYgdGhlIHBhcmVudCBpc24ndCBkaXNwbGF5ZWQsIGFuIGludGVyc2VjdGlvbiBjYW4ndCBoYXBwZW4uXG4gICAgaWYgKHBhcmVudENvbXB1dGVkU3R5bGUuZGlzcGxheSA9PSAnbm9uZScpIHJldHVybjtcblxuICAgIGlmIChwYXJlbnQgPT0gdGhpcy5yb290IHx8IHBhcmVudCA9PSBkb2N1bWVudCkge1xuICAgICAgYXRSb290ID0gdHJ1ZTtcbiAgICAgIHBhcmVudFJlY3QgPSByb290UmVjdDtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gSWYgdGhlIGVsZW1lbnQgaGFzIGEgbm9uLXZpc2libGUgb3ZlcmZsb3csIGFuZCBpdCdzIG5vdCB0aGUgPGJvZHk+XG4gICAgICAvLyBvciA8aHRtbD4gZWxlbWVudCwgdXBkYXRlIHRoZSBpbnRlcnNlY3Rpb24gcmVjdC5cbiAgICAgIC8vIE5vdGU6IDxib2R5PiBhbmQgPGh0bWw+IGNhbm5vdCBiZSBjbGlwcGVkIHRvIGEgcmVjdCB0aGF0J3Mgbm90IGFsc29cbiAgICAgIC8vIHRoZSBkb2N1bWVudCByZWN0LCBzbyBubyBuZWVkIHRvIGNvbXB1dGUgYSBuZXcgaW50ZXJzZWN0aW9uLlxuICAgICAgaWYgKHBhcmVudCAhPSBkb2N1bWVudC5ib2R5ICYmXG4gICAgICAgICAgcGFyZW50ICE9IGRvY3VtZW50LmRvY3VtZW50RWxlbWVudCAmJlxuICAgICAgICAgIHBhcmVudENvbXB1dGVkU3R5bGUub3ZlcmZsb3cgIT0gJ3Zpc2libGUnKSB7XG4gICAgICAgIHBhcmVudFJlY3QgPSBnZXRCb3VuZGluZ0NsaWVudFJlY3QocGFyZW50KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBJZiBlaXRoZXIgb2YgdGhlIGFib3ZlIGNvbmRpdGlvbmFscyBzZXQgYSBuZXcgcGFyZW50UmVjdCxcbiAgICAvLyBjYWxjdWxhdGUgbmV3IGludGVyc2VjdGlvbiBkYXRhLlxuICAgIGlmIChwYXJlbnRSZWN0KSB7XG4gICAgICBpbnRlcnNlY3Rpb25SZWN0ID0gY29tcHV0ZVJlY3RJbnRlcnNlY3Rpb24ocGFyZW50UmVjdCwgaW50ZXJzZWN0aW9uUmVjdCk7XG5cbiAgICAgIGlmICghaW50ZXJzZWN0aW9uUmVjdCkgYnJlYWs7XG4gICAgfVxuICAgIHBhcmVudCA9IGdldFBhcmVudE5vZGUocGFyZW50KTtcbiAgfVxuICByZXR1cm4gaW50ZXJzZWN0aW9uUmVjdDtcbn07XG5cblxuLyoqXG4gKiBSZXR1cm5zIHRoZSByb290IHJlY3QgYWZ0ZXIgYmVpbmcgZXhwYW5kZWQgYnkgdGhlIHJvb3RNYXJnaW4gdmFsdWUuXG4gKiBAcmV0dXJuIHtPYmplY3R9IFRoZSBleHBhbmRlZCByb290IHJlY3QuXG4gKiBAcHJpdmF0ZVxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuX2dldFJvb3RSZWN0ID0gZnVuY3Rpb24oKSB7XG4gIHZhciByb290UmVjdDtcbiAgaWYgKHRoaXMucm9vdCkge1xuICAgIHJvb3RSZWN0ID0gZ2V0Qm91bmRpbmdDbGllbnRSZWN0KHRoaXMucm9vdCk7XG4gIH0gZWxzZSB7XG4gICAgLy8gVXNlIDxodG1sPi88Ym9keT4gaW5zdGVhZCBvZiB3aW5kb3cgc2luY2Ugc2Nyb2xsIGJhcnMgYWZmZWN0IHNpemUuXG4gICAgdmFyIGh0bWwgPSBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQ7XG4gICAgdmFyIGJvZHkgPSBkb2N1bWVudC5ib2R5O1xuICAgIHJvb3RSZWN0ID0ge1xuICAgICAgdG9wOiAwLFxuICAgICAgbGVmdDogMCxcbiAgICAgIHJpZ2h0OiBodG1sLmNsaWVudFdpZHRoIHx8IGJvZHkuY2xpZW50V2lkdGgsXG4gICAgICB3aWR0aDogaHRtbC5jbGllbnRXaWR0aCB8fCBib2R5LmNsaWVudFdpZHRoLFxuICAgICAgYm90dG9tOiBodG1sLmNsaWVudEhlaWdodCB8fCBib2R5LmNsaWVudEhlaWdodCxcbiAgICAgIGhlaWdodDogaHRtbC5jbGllbnRIZWlnaHQgfHwgYm9keS5jbGllbnRIZWlnaHRcbiAgICB9O1xuICB9XG4gIHJldHVybiB0aGlzLl9leHBhbmRSZWN0QnlSb290TWFyZ2luKHJvb3RSZWN0KTtcbn07XG5cblxuLyoqXG4gKiBBY2NlcHRzIGEgcmVjdCBhbmQgZXhwYW5kcyBpdCBieSB0aGUgcm9vdE1hcmdpbiB2YWx1ZS5cbiAqIEBwYXJhbSB7T2JqZWN0fSByZWN0IFRoZSByZWN0IG9iamVjdCB0byBleHBhbmQuXG4gKiBAcmV0dXJuIHtPYmplY3R9IFRoZSBleHBhbmRlZCByZWN0LlxuICogQHByaXZhdGVcbiAqL1xuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLl9leHBhbmRSZWN0QnlSb290TWFyZ2luID0gZnVuY3Rpb24ocmVjdCkge1xuICB2YXIgbWFyZ2lucyA9IHRoaXMuX3Jvb3RNYXJnaW5WYWx1ZXMubWFwKGZ1bmN0aW9uKG1hcmdpbiwgaSkge1xuICAgIHJldHVybiBtYXJnaW4udW5pdCA9PSAncHgnID8gbWFyZ2luLnZhbHVlIDpcbiAgICAgICAgbWFyZ2luLnZhbHVlICogKGkgJSAyID8gcmVjdC53aWR0aCA6IHJlY3QuaGVpZ2h0KSAvIDEwMDtcbiAgfSk7XG4gIHZhciBuZXdSZWN0ID0ge1xuICAgIHRvcDogcmVjdC50b3AgLSBtYXJnaW5zWzBdLFxuICAgIHJpZ2h0OiByZWN0LnJpZ2h0ICsgbWFyZ2luc1sxXSxcbiAgICBib3R0b206IHJlY3QuYm90dG9tICsgbWFyZ2luc1syXSxcbiAgICBsZWZ0OiByZWN0LmxlZnQgLSBtYXJnaW5zWzNdXG4gIH07XG4gIG5ld1JlY3Qud2lkdGggPSBuZXdSZWN0LnJpZ2h0IC0gbmV3UmVjdC5sZWZ0O1xuICBuZXdSZWN0LmhlaWdodCA9IG5ld1JlY3QuYm90dG9tIC0gbmV3UmVjdC50b3A7XG5cbiAgcmV0dXJuIG5ld1JlY3Q7XG59O1xuXG5cbi8qKlxuICogQWNjZXB0cyBhbiBvbGQgYW5kIG5ldyBlbnRyeSBhbmQgcmV0dXJucyB0cnVlIGlmIGF0IGxlYXN0IG9uZSBvZiB0aGVcbiAqIHRocmVzaG9sZCB2YWx1ZXMgaGFzIGJlZW4gY3Jvc3NlZC5cbiAqIEBwYXJhbSB7P0ludGVyc2VjdGlvbk9ic2VydmVyRW50cnl9IG9sZEVudHJ5IFRoZSBwcmV2aW91cyBlbnRyeSBmb3IgYVxuICogICAgcGFydGljdWxhciB0YXJnZXQgZWxlbWVudCBvciBudWxsIGlmIG5vIHByZXZpb3VzIGVudHJ5IGV4aXN0cy5cbiAqIEBwYXJhbSB7SW50ZXJzZWN0aW9uT2JzZXJ2ZXJFbnRyeX0gbmV3RW50cnkgVGhlIGN1cnJlbnQgZW50cnkgZm9yIGFcbiAqICAgIHBhcnRpY3VsYXIgdGFyZ2V0IGVsZW1lbnQuXG4gKiBAcmV0dXJuIHtib29sZWFufSBSZXR1cm5zIHRydWUgaWYgYSBhbnkgdGhyZXNob2xkIGhhcyBiZWVuIGNyb3NzZWQuXG4gKiBAcHJpdmF0ZVxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuX2hhc0Nyb3NzZWRUaHJlc2hvbGQgPVxuICAgIGZ1bmN0aW9uKG9sZEVudHJ5LCBuZXdFbnRyeSkge1xuXG4gIC8vIFRvIG1ha2UgY29tcGFyaW5nIGVhc2llciwgYW4gZW50cnkgdGhhdCBoYXMgYSByYXRpbyBvZiAwXG4gIC8vIGJ1dCBkb2VzIG5vdCBhY3R1YWxseSBpbnRlcnNlY3QgaXMgZ2l2ZW4gYSB2YWx1ZSBvZiAtMVxuICB2YXIgb2xkUmF0aW8gPSBvbGRFbnRyeSAmJiBvbGRFbnRyeS5pc0ludGVyc2VjdGluZyA/XG4gICAgICBvbGRFbnRyeS5pbnRlcnNlY3Rpb25SYXRpbyB8fCAwIDogLTE7XG4gIHZhciBuZXdSYXRpbyA9IG5ld0VudHJ5LmlzSW50ZXJzZWN0aW5nID9cbiAgICAgIG5ld0VudHJ5LmludGVyc2VjdGlvblJhdGlvIHx8IDAgOiAtMTtcblxuICAvLyBJZ25vcmUgdW5jaGFuZ2VkIHJhdGlvc1xuICBpZiAob2xkUmF0aW8gPT09IG5ld1JhdGlvKSByZXR1cm47XG5cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLnRocmVzaG9sZHMubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgdGhyZXNob2xkID0gdGhpcy50aHJlc2hvbGRzW2ldO1xuXG4gICAgLy8gUmV0dXJuIHRydWUgaWYgYW4gZW50cnkgbWF0Y2hlcyBhIHRocmVzaG9sZCBvciBpZiB0aGUgbmV3IHJhdGlvXG4gICAgLy8gYW5kIHRoZSBvbGQgcmF0aW8gYXJlIG9uIHRoZSBvcHBvc2l0ZSBzaWRlcyBvZiBhIHRocmVzaG9sZC5cbiAgICBpZiAodGhyZXNob2xkID09IG9sZFJhdGlvIHx8IHRocmVzaG9sZCA9PSBuZXdSYXRpbyB8fFxuICAgICAgICB0aHJlc2hvbGQgPCBvbGRSYXRpbyAhPT0gdGhyZXNob2xkIDwgbmV3UmF0aW8pIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgfVxufTtcblxuXG4vKipcbiAqIFJldHVybnMgd2hldGhlciBvciBub3QgdGhlIHJvb3QgZWxlbWVudCBpcyBhbiBlbGVtZW50IGFuZCBpcyBpbiB0aGUgRE9NLlxuICogQHJldHVybiB7Ym9vbGVhbn0gVHJ1ZSBpZiB0aGUgcm9vdCBlbGVtZW50IGlzIGFuIGVsZW1lbnQgYW5kIGlzIGluIHRoZSBET00uXG4gKiBAcHJpdmF0ZVxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuX3Jvb3RJc0luRG9tID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiAhdGhpcy5yb290IHx8IGNvbnRhaW5zRGVlcChkb2N1bWVudCwgdGhpcy5yb290KTtcbn07XG5cblxuLyoqXG4gKiBSZXR1cm5zIHdoZXRoZXIgb3Igbm90IHRoZSB0YXJnZXQgZWxlbWVudCBpcyBhIGNoaWxkIG9mIHJvb3QuXG4gKiBAcGFyYW0ge0VsZW1lbnR9IHRhcmdldCBUaGUgdGFyZ2V0IGVsZW1lbnQgdG8gY2hlY2suXG4gKiBAcmV0dXJuIHtib29sZWFufSBUcnVlIGlmIHRoZSB0YXJnZXQgZWxlbWVudCBpcyBhIGNoaWxkIG9mIHJvb3QuXG4gKiBAcHJpdmF0ZVxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuX3Jvb3RDb250YWluc1RhcmdldCA9IGZ1bmN0aW9uKHRhcmdldCkge1xuICByZXR1cm4gY29udGFpbnNEZWVwKHRoaXMucm9vdCB8fCBkb2N1bWVudCwgdGFyZ2V0KTtcbn07XG5cblxuLyoqXG4gKiBBZGRzIHRoZSBpbnN0YW5jZSB0byB0aGUgZ2xvYmFsIEludGVyc2VjdGlvbk9ic2VydmVyIHJlZ2lzdHJ5IGlmIGl0IGlzbid0XG4gKiBhbHJlYWR5IHByZXNlbnQuXG4gKiBAcHJpdmF0ZVxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuX3JlZ2lzdGVySW5zdGFuY2UgPSBmdW5jdGlvbigpIHtcbiAgaWYgKHJlZ2lzdHJ5LmluZGV4T2YodGhpcykgPCAwKSB7XG4gICAgcmVnaXN0cnkucHVzaCh0aGlzKTtcbiAgfVxufTtcblxuXG4vKipcbiAqIFJlbW92ZXMgdGhlIGluc3RhbmNlIGZyb20gdGhlIGdsb2JhbCBJbnRlcnNlY3Rpb25PYnNlcnZlciByZWdpc3RyeS5cbiAqIEBwcml2YXRlXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5fdW5yZWdpc3Rlckluc3RhbmNlID0gZnVuY3Rpb24oKSB7XG4gIHZhciBpbmRleCA9IHJlZ2lzdHJ5LmluZGV4T2YodGhpcyk7XG4gIGlmIChpbmRleCAhPSAtMSkgcmVnaXN0cnkuc3BsaWNlKGluZGV4LCAxKTtcbn07XG5cblxuLyoqXG4gKiBSZXR1cm5zIHRoZSByZXN1bHQgb2YgdGhlIHBlcmZvcm1hbmNlLm5vdygpIG1ldGhvZCBvciBudWxsIGluIGJyb3dzZXJzXG4gKiB0aGF0IGRvbid0IHN1cHBvcnQgdGhlIEFQSS5cbiAqIEByZXR1cm4ge251bWJlcn0gVGhlIGVsYXBzZWQgdGltZSBzaW5jZSB0aGUgcGFnZSB3YXMgcmVxdWVzdGVkLlxuICovXG5mdW5jdGlvbiBub3coKSB7XG4gIHJldHVybiB3aW5kb3cucGVyZm9ybWFuY2UgJiYgcGVyZm9ybWFuY2Uubm93ICYmIHBlcmZvcm1hbmNlLm5vdygpO1xufVxuXG5cbi8qKlxuICogVGhyb3R0bGVzIGEgZnVuY3Rpb24gYW5kIGRlbGF5cyBpdHMgZXhlY3V0aW9uZywgc28gaXQncyBvbmx5IGNhbGxlZCBhdCBtb3N0XG4gKiBvbmNlIHdpdGhpbiBhIGdpdmVuIHRpbWUgcGVyaW9kLlxuICogQHBhcmFtIHtGdW5jdGlvbn0gZm4gVGhlIGZ1bmN0aW9uIHRvIHRocm90dGxlLlxuICogQHBhcmFtIHtudW1iZXJ9IHRpbWVvdXQgVGhlIGFtb3VudCBvZiB0aW1lIHRoYXQgbXVzdCBwYXNzIGJlZm9yZSB0aGVcbiAqICAgICBmdW5jdGlvbiBjYW4gYmUgY2FsbGVkIGFnYWluLlxuICogQHJldHVybiB7RnVuY3Rpb259IFRoZSB0aHJvdHRsZWQgZnVuY3Rpb24uXG4gKi9cbmZ1bmN0aW9uIHRocm90dGxlKGZuLCB0aW1lb3V0KSB7XG4gIHZhciB0aW1lciA9IG51bGw7XG4gIHJldHVybiBmdW5jdGlvbiAoKSB7XG4gICAgaWYgKCF0aW1lcikge1xuICAgICAgdGltZXIgPSBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgICBmbigpO1xuICAgICAgICB0aW1lciA9IG51bGw7XG4gICAgICB9LCB0aW1lb3V0KTtcbiAgICB9XG4gIH07XG59XG5cblxuLyoqXG4gKiBBZGRzIGFuIGV2ZW50IGhhbmRsZXIgdG8gYSBET00gbm9kZSBlbnN1cmluZyBjcm9zcy1icm93c2VyIGNvbXBhdGliaWxpdHkuXG4gKiBAcGFyYW0ge05vZGV9IG5vZGUgVGhlIERPTSBub2RlIHRvIGFkZCB0aGUgZXZlbnQgaGFuZGxlciB0by5cbiAqIEBwYXJhbSB7c3RyaW5nfSBldmVudCBUaGUgZXZlbnQgbmFtZS5cbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZuIFRoZSBldmVudCBoYW5kbGVyIHRvIGFkZC5cbiAqIEBwYXJhbSB7Ym9vbGVhbn0gb3B0X3VzZUNhcHR1cmUgT3B0aW9uYWxseSBhZGRzIHRoZSBldmVuIHRvIHRoZSBjYXB0dXJlXG4gKiAgICAgcGhhc2UuIE5vdGU6IHRoaXMgb25seSB3b3JrcyBpbiBtb2Rlcm4gYnJvd3NlcnMuXG4gKi9cbmZ1bmN0aW9uIGFkZEV2ZW50KG5vZGUsIGV2ZW50LCBmbiwgb3B0X3VzZUNhcHR1cmUpIHtcbiAgaWYgKHR5cGVvZiBub2RlLmFkZEV2ZW50TGlzdGVuZXIgPT0gJ2Z1bmN0aW9uJykge1xuICAgIG5vZGUuYWRkRXZlbnRMaXN0ZW5lcihldmVudCwgZm4sIG9wdF91c2VDYXB0dXJlIHx8IGZhbHNlKTtcbiAgfVxuICBlbHNlIGlmICh0eXBlb2Ygbm9kZS5hdHRhY2hFdmVudCA9PSAnZnVuY3Rpb24nKSB7XG4gICAgbm9kZS5hdHRhY2hFdmVudCgnb24nICsgZXZlbnQsIGZuKTtcbiAgfVxufVxuXG5cbi8qKlxuICogUmVtb3ZlcyBhIHByZXZpb3VzbHkgYWRkZWQgZXZlbnQgaGFuZGxlciBmcm9tIGEgRE9NIG5vZGUuXG4gKiBAcGFyYW0ge05vZGV9IG5vZGUgVGhlIERPTSBub2RlIHRvIHJlbW92ZSB0aGUgZXZlbnQgaGFuZGxlciBmcm9tLlxuICogQHBhcmFtIHtzdHJpbmd9IGV2ZW50IFRoZSBldmVudCBuYW1lLlxuICogQHBhcmFtIHtGdW5jdGlvbn0gZm4gVGhlIGV2ZW50IGhhbmRsZXIgdG8gcmVtb3ZlLlxuICogQHBhcmFtIHtib29sZWFufSBvcHRfdXNlQ2FwdHVyZSBJZiB0aGUgZXZlbnQgaGFuZGxlciB3YXMgYWRkZWQgd2l0aCB0aGlzXG4gKiAgICAgZmxhZyBzZXQgdG8gdHJ1ZSwgaXQgc2hvdWxkIGJlIHNldCB0byB0cnVlIGhlcmUgaW4gb3JkZXIgdG8gcmVtb3ZlIGl0LlxuICovXG5mdW5jdGlvbiByZW1vdmVFdmVudChub2RlLCBldmVudCwgZm4sIG9wdF91c2VDYXB0dXJlKSB7XG4gIGlmICh0eXBlb2Ygbm9kZS5yZW1vdmVFdmVudExpc3RlbmVyID09ICdmdW5jdGlvbicpIHtcbiAgICBub2RlLnJlbW92ZUV2ZW50TGlzdGVuZXIoZXZlbnQsIGZuLCBvcHRfdXNlQ2FwdHVyZSB8fCBmYWxzZSk7XG4gIH1cbiAgZWxzZSBpZiAodHlwZW9mIG5vZGUuZGV0YXRjaEV2ZW50ID09ICdmdW5jdGlvbicpIHtcbiAgICBub2RlLmRldGF0Y2hFdmVudCgnb24nICsgZXZlbnQsIGZuKTtcbiAgfVxufVxuXG5cbi8qKlxuICogUmV0dXJucyB0aGUgaW50ZXJzZWN0aW9uIGJldHdlZW4gdHdvIHJlY3Qgb2JqZWN0cy5cbiAqIEBwYXJhbSB7T2JqZWN0fSByZWN0MSBUaGUgZmlyc3QgcmVjdC5cbiAqIEBwYXJhbSB7T2JqZWN0fSByZWN0MiBUaGUgc2Vjb25kIHJlY3QuXG4gKiBAcmV0dXJuIHs/T2JqZWN0fSBUaGUgaW50ZXJzZWN0aW9uIHJlY3Qgb3IgdW5kZWZpbmVkIGlmIG5vIGludGVyc2VjdGlvblxuICogICAgIGlzIGZvdW5kLlxuICovXG5mdW5jdGlvbiBjb21wdXRlUmVjdEludGVyc2VjdGlvbihyZWN0MSwgcmVjdDIpIHtcbiAgdmFyIHRvcCA9IE1hdGgubWF4KHJlY3QxLnRvcCwgcmVjdDIudG9wKTtcbiAgdmFyIGJvdHRvbSA9IE1hdGgubWluKHJlY3QxLmJvdHRvbSwgcmVjdDIuYm90dG9tKTtcbiAgdmFyIGxlZnQgPSBNYXRoLm1heChyZWN0MS5sZWZ0LCByZWN0Mi5sZWZ0KTtcbiAgdmFyIHJpZ2h0ID0gTWF0aC5taW4ocmVjdDEucmlnaHQsIHJlY3QyLnJpZ2h0KTtcbiAgdmFyIHdpZHRoID0gcmlnaHQgLSBsZWZ0O1xuICB2YXIgaGVpZ2h0ID0gYm90dG9tIC0gdG9wO1xuXG4gIHJldHVybiAod2lkdGggPj0gMCAmJiBoZWlnaHQgPj0gMCkgJiYge1xuICAgIHRvcDogdG9wLFxuICAgIGJvdHRvbTogYm90dG9tLFxuICAgIGxlZnQ6IGxlZnQsXG4gICAgcmlnaHQ6IHJpZ2h0LFxuICAgIHdpZHRoOiB3aWR0aCxcbiAgICBoZWlnaHQ6IGhlaWdodFxuICB9O1xufVxuXG5cbi8qKlxuICogU2hpbXMgdGhlIG5hdGl2ZSBnZXRCb3VuZGluZ0NsaWVudFJlY3QgZm9yIGNvbXBhdGliaWxpdHkgd2l0aCBvbGRlciBJRS5cbiAqIEBwYXJhbSB7RWxlbWVudH0gZWwgVGhlIGVsZW1lbnQgd2hvc2UgYm91bmRpbmcgcmVjdCB0byBnZXQuXG4gKiBAcmV0dXJuIHtPYmplY3R9IFRoZSAocG9zc2libHkgc2hpbW1lZCkgcmVjdCBvZiB0aGUgZWxlbWVudC5cbiAqL1xuZnVuY3Rpb24gZ2V0Qm91bmRpbmdDbGllbnRSZWN0KGVsKSB7XG4gIHZhciByZWN0O1xuXG4gIHRyeSB7XG4gICAgcmVjdCA9IGVsLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICAvLyBJZ25vcmUgV2luZG93cyA3IElFMTEgXCJVbnNwZWNpZmllZCBlcnJvclwiXG4gICAgLy8gaHR0cHM6Ly9naXRodWIuY29tL1dJQ0cvSW50ZXJzZWN0aW9uT2JzZXJ2ZXIvcHVsbC8yMDVcbiAgfVxuXG4gIGlmICghcmVjdCkgcmV0dXJuIGdldEVtcHR5UmVjdCgpO1xuXG4gIC8vIE9sZGVyIElFXG4gIGlmICghKHJlY3Qud2lkdGggJiYgcmVjdC5oZWlnaHQpKSB7XG4gICAgcmVjdCA9IHtcbiAgICAgIHRvcDogcmVjdC50b3AsXG4gICAgICByaWdodDogcmVjdC5yaWdodCxcbiAgICAgIGJvdHRvbTogcmVjdC5ib3R0b20sXG4gICAgICBsZWZ0OiByZWN0LmxlZnQsXG4gICAgICB3aWR0aDogcmVjdC5yaWdodCAtIHJlY3QubGVmdCxcbiAgICAgIGhlaWdodDogcmVjdC5ib3R0b20gLSByZWN0LnRvcFxuICAgIH07XG4gIH1cbiAgcmV0dXJuIHJlY3Q7XG59XG5cblxuLyoqXG4gKiBSZXR1cm5zIGFuIGVtcHR5IHJlY3Qgb2JqZWN0LiBBbiBlbXB0eSByZWN0IGlzIHJldHVybmVkIHdoZW4gYW4gZWxlbWVudFxuICogaXMgbm90IGluIHRoZSBET00uXG4gKiBAcmV0dXJuIHtPYmplY3R9IFRoZSBlbXB0eSByZWN0LlxuICovXG5mdW5jdGlvbiBnZXRFbXB0eVJlY3QoKSB7XG4gIHJldHVybiB7XG4gICAgdG9wOiAwLFxuICAgIGJvdHRvbTogMCxcbiAgICBsZWZ0OiAwLFxuICAgIHJpZ2h0OiAwLFxuICAgIHdpZHRoOiAwLFxuICAgIGhlaWdodDogMFxuICB9O1xufVxuXG4vKipcbiAqIENoZWNrcyB0byBzZWUgaWYgYSBwYXJlbnQgZWxlbWVudCBjb250YWlucyBhIGNoaWxkIGVsZW1udCAoaW5jbHVkaW5nIGluc2lkZVxuICogc2hhZG93IERPTSkuXG4gKiBAcGFyYW0ge05vZGV9IHBhcmVudCBUaGUgcGFyZW50IGVsZW1lbnQuXG4gKiBAcGFyYW0ge05vZGV9IGNoaWxkIFRoZSBjaGlsZCBlbGVtZW50LlxuICogQHJldHVybiB7Ym9vbGVhbn0gVHJ1ZSBpZiB0aGUgcGFyZW50IG5vZGUgY29udGFpbnMgdGhlIGNoaWxkIG5vZGUuXG4gKi9cbmZ1bmN0aW9uIGNvbnRhaW5zRGVlcChwYXJlbnQsIGNoaWxkKSB7XG4gIHZhciBub2RlID0gY2hpbGQ7XG4gIHdoaWxlIChub2RlKSB7XG4gICAgaWYgKG5vZGUgPT0gcGFyZW50KSByZXR1cm4gdHJ1ZTtcblxuICAgIG5vZGUgPSBnZXRQYXJlbnROb2RlKG5vZGUpO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuXG4vKipcbiAqIEdldHMgdGhlIHBhcmVudCBub2RlIG9mIGFuIGVsZW1lbnQgb3IgaXRzIGhvc3QgZWxlbWVudCBpZiB0aGUgcGFyZW50IG5vZGVcbiAqIGlzIGEgc2hhZG93IHJvb3QuXG4gKiBAcGFyYW0ge05vZGV9IG5vZGUgVGhlIG5vZGUgd2hvc2UgcGFyZW50IHRvIGdldC5cbiAqIEByZXR1cm4ge05vZGV8bnVsbH0gVGhlIHBhcmVudCBub2RlIG9yIG51bGwgaWYgbm8gcGFyZW50IGV4aXN0cy5cbiAqL1xuZnVuY3Rpb24gZ2V0UGFyZW50Tm9kZShub2RlKSB7XG4gIHZhciBwYXJlbnQgPSBub2RlLnBhcmVudE5vZGU7XG5cbiAgaWYgKHBhcmVudCAmJiBwYXJlbnQubm9kZVR5cGUgPT0gMTEgJiYgcGFyZW50Lmhvc3QpIHtcbiAgICAvLyBJZiB0aGUgcGFyZW50IGlzIGEgc2hhZG93IHJvb3QsIHJldHVybiB0aGUgaG9zdCBlbGVtZW50LlxuICAgIHJldHVybiBwYXJlbnQuaG9zdDtcbiAgfVxuICByZXR1cm4gcGFyZW50O1xufVxuXG5cbi8vIEV4cG9zZXMgdGhlIGNvbnN0cnVjdG9ycyBnbG9iYWxseS5cbndpbmRvdy5JbnRlcnNlY3Rpb25PYnNlcnZlciA9IEludGVyc2VjdGlvbk9ic2VydmVyO1xud2luZG93LkludGVyc2VjdGlvbk9ic2VydmVyRW50cnkgPSBJbnRlcnNlY3Rpb25PYnNlcnZlckVudHJ5O1xuXG59KHdpbmRvdywgZG9jdW1lbnQpKTtcbiIsIi8qKlxuICogRW52aXJvbm1lbnQgTW9kdWxlXG4gKiBAbW9kdWxlIEVudmlyb25tZW50L0Vudmlyb25tZW50XG4gKiByZXByZXNlbnRzIGZ1bmN0aW9ucyB0aGF0IGRlc2NyaWJlIHRoZSBjdXJyZW50IGVudmlyb25tZW50IHRoZSBtZWF1c3JlbWVudCBsaWJyYXJ5IGlzIHJ1bm5pbmcgaW5cbiAqL1xuXG4vKipcbiAqIEBwYXJhbSAge0hUTUxFbGVtZW50fSBlbGVtZW50IC0gYSBIVE1MIGVsZW1lbnQgdG8gZ2V0IHByb3BlcnRpZXMgZnJvbSBcbiAqIEByZXR1cm4ge09iamVjdH0gYW4gb2JqZWN0IGRlc2NyaWJpbmcgdGhlIHZhcmlvdXMgcGVydGl0bmVudCBlbnZpcm9ubWVudCBkZXRhaWxzXG4gKi9cbmV4cG9ydCBjb25zdCBnZXREZXRhaWxzID0gKGVsZW1lbnQgPSB7fSkgPT4ge1xuICByZXR1cm4ge1xuICAgIHZpZXdwb3J0V2lkdGg6IE1hdGgubWF4KGRvY3VtZW50LmJvZHkuY2xpZW50V2lkdGgsIHdpbmRvdy5pbm5lcldpZHRoKSB8fCAtMSxcbiAgICB2aWV3cG9ydEhlaWdodDogTWF0aC5tYXgoZG9jdW1lbnQuYm9keS5jbGllbnRIZWlnaHQsIHdpbmRvdy5pbm5lckhlaWdodCkgfHwgLTEsXG4gICAgZWxlbWVudFdpZHRoOiBlbGVtZW50LmNsaWVudFdpZHRoIHx8IC0xLFxuICAgIGVsZW1lbnRIZWlnaHQ6IGVsZW1lbnQuY2xpZW50SGVpZ2h0IHx8IC0xLFxuICAgIGlmcmFtZUNvbnRleHQ6IGlGcmFtZUNvbnRleHQoKSxcbiAgICBmb2N1czogaXNJbkZvY3VzKClcbiAgfVxufVxuXG4vKipcbiAqIEByZXR1cm4ge0Jvb2xlYW59IGRldGVybWluZXMgd2hldGhlciB0aGUgY3VycmVudCBwYWdlIGlzIGluIGZvY3VzXG4gKi9cbmV4cG9ydCBjb25zdCBpc0luRm9jdXMgPSAoKSA9PiB7XG4gIGlmIChkb2N1bWVudC5oaWRkZW4gIT09ICd1bmRlZmluZWQnKXtcbiAgICBpZiAoZG9jdW1lbnQuaGlkZGVuID09PSB0cnVlKXtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICBpZihpRnJhbWVDb250ZXh0KCkgPT09IGlGcmFtZVNlcnZpbmdTY2VuYXJpb3MuQ1JPU1NfRE9NQUlOX0lGUkFNRSkge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgaWYod2luZG93LmRvY3VtZW50Lmhhc0ZvY3VzKSB7XG4gICAgcmV0dXJuIHdpbmRvdy50b3AuZG9jdW1lbnQuaGFzRm9jdXMoKTtcbiAgfVxuXG4gIHJldHVybiB0cnVlO1xufVxuXG4vKipcbiAqIEByZXR1cm4ge1N0cmluZ30gcmV0dXJucyB0aGUgY3VycmVudCBpRnJhbWUgc2VydmluZyBjb250ZXh0LiBJdCdzIGVpdGhlciAnb24gcGFnZScsICdzYW1lIGRvbWFpbiBpZnJhbWUnLCBvciAnY3Jvc3MgZG9tYWluIGlmcmFtZSdcbiAqL1xuZXhwb3J0IGNvbnN0IGlGcmFtZUNvbnRleHQgPSAoKSA9PiB7XG4gIHRyeSB7XG4gICAgaWYod2luZG93LnRvcCA9PT0gd2luZG93KSB7XG4gICAgICByZXR1cm4gaUZyYW1lU2VydmluZ1NjZW5hcmlvcy5PTl9QQUdFXG4gICAgfVxuXG4gICAgbGV0IGN1cldpbiA9IHdpbmRvdywgbGV2ZWwgPSAwO1xuICAgIHdoaWxlKGN1cldpbi5wYXJlbnQgIT09IGN1cldpbiAmJiBsZXZlbCA8IDEwMDApIHtcbiAgICAgIGlmKGN1cldpbi5wYXJlbnQuZG9jdW1lbnQuZG9tYWluICE9PSBjdXJXaW4uZG9jdW1lbnQuZG9tYWluKSB7XG4gICAgICAgIHJldHVybiBpRnJhbWVTZXJ2aW5nU2NlbmFyaW9zLkNST1NTX0RPTUFJTl9JRlJBTUU7XG4gICAgICB9XG5cbiAgICAgIGN1cldpbiA9IGN1cldpbi5wYXJlbnQ7XG4gICAgfVxuICAgIGlGcmFtZVNlcnZpbmdTY2VuYXJpb3MuU0FNRV9ET01BSU5fSUZSQU1FO1xuICB9XG4gIGNhdGNoKGUpIHtcbiAgICByZXR1cm4gaUZyYW1lU2VydmluZ1NjZW5hcmlvcy5DUk9TU19ET01BSU5fSUZSQU1FXG4gIH1cbn1cblxuLyoqXG4gKiBjb25zdGFudHMgZGVzY3JpYmluZyBkaWZmZXJlbnQgdHlwZXMgb2YgaUZyYW1lIGNvbnRleHRzXG4gKiBAdHlwZSB7T2JqZWN0fVxuICovXG5leHBvcnQgY29uc3QgaUZyYW1lU2VydmluZ1NjZW5hcmlvcyA9IHtcbiAgT05fUEFHRTogJ29uIHBhZ2UnLFxuICBTQU1FX0RPTUFJTl9JRlJBTUU6ICdzYW1lIGRvbWFpbiBpZnJhbWUnLFxuICBDUk9TU19ET01BSU5fSUZSQU1FOiAnY3Jvc3MgZG9tYWluIGlmcmFtZSdcbn0iLCJpbXBvcnQgQmFzZVRlY2huaXF1ZSBmcm9tICcuLi9NZWFzdXJlbWVudC9NZWFzdXJlbWVudFRlY2huaXF1ZXMvQmFzZVRlY2huaXF1ZSc7XG5cbi8qKlxuICogVmFsaWRhdG9ycyBtb2R1bGVcbiAqIEBtb2R1bGUgSGVscGVycy9WYWxpZGF0b3JzXG4gKiByZXByZXNlbnRzIGZ1bmN0aW9ucyBmb3IgY2hlY2tpbmcgdGhlIHZhbGlkaXRpeSBvZiBhIGdpdmVuIGlucHV0IHZhbHVlIFxuICovXG5cbi8qKlxuICogQHBhcmFtICB7QmFzZVRlY2huaXF1ZX0gdGVjaG5pcXVlIC0gdGVjaG5pcXVlIHRvIGNoZWNrIGZvciB2YWxpZGl0eVxuICogQHJldHVybiB7Qm9vbGVhbn0gZGV0ZXJtaW5hdGlvbiBvZiB3aGV0aGVyIHRoZSB0ZWNobmlxdWUgbWVldHMgdGhlIG1pbmltdW0gc3RhbmRhcmRzIFxuICogZm9yIG1lYXN1cmluZyB2aWV3YWJpbGl0eSBhY2NvcmRpbmcgdG8gdGhlIGludGVyZmFjZSBkZWZpbmVkIGJ5IEJhc2VUZWNobmlxdWVcbiAqL1xuZXhwb3J0IGNvbnN0IHZhbGlkVGVjaG5pcXVlID0gKHRlY2huaXF1ZSkgPT4ge1xuICBjb25zdCB2YWxpZCA9IFxuICAgIHR5cGVvZiB0ZWNobmlxdWUgPT09ICdmdW5jdGlvbicgJiZcbiAgICBPYmplY3RcbiAgICAgIC5nZXRPd25Qcm9wZXJ0eU5hbWVzKEJhc2VUZWNobmlxdWUpXG4gICAgICAucmVkdWNlKCAocHJvcCwgdmFsaWQpID0+IHZhbGlkICYmIHR5cGVvZiB0ZWNobmlxdWVbcHJvcF0gPT09IHR5cGVvZiBCYXNlVGVjaG5pcXVlW3Byb3BdLCB0cnVlKTtcblxuICByZXR1cm4gdmFsaWQ7XG59O1xuXG4vKipcbiAqIEBwYXJhbSAge0hUTUxFbGVtZW50fSBlbGVtZW50IC0gZWxlbWVudCB0byBjaGVjayBmb3IgdmFsaWRpdHlcbiAqIEByZXR1cm4ge0Jvb2xlYW59IGRldGVybWluZXMgd2hldGhlciBlbGVtZW50IGlzIGFuIGFjdHVhbCBIVE1MIGVsZW1lbnQgb3IgYSBwcm94eSBlbGVtZW50ICh3aGljaCBtYXkgYmUgcHJvdmlkZWQgYnkgR29vZ2xlJ3MgSU1BIFZQQUlEIGhvc3QpIFxuICovXG5leHBvcnQgY29uc3QgdmFsaWRFbGVtZW50ID0gKGVsZW1lbnQpID0+IHtcbiAgcmV0dXJuIGVsZW1lbnQgJiYgZWxlbWVudC50b1N0cmluZygpLmluZGV4T2YoJ0VsZW1lbnQnKSA+IC0xO1xufTtcblxuLyoqXG4gKiBAcGFyYW0gIHtPYmplY3R9IG9iaiAtIHZpZXdhYmlsaXR5IGNyaXRlcmlhIHRvIGNoZWNrIGZvciB2YWxpZGFpdHkuIE5vdGUsIHdlJ3JlIHVzaW5nIEVTNiBkZXN0cnVjdHVyaW5nIHRvIHB1bGwgdGhlIHByb3BlcnRpZXMgd2Ugd2FudCB0byB0ZXN0IGZyb20gdGhlIG9iamVjdFxuICogQHBhcmFtICB7TnVtYmVyfSBvYmouaW5WaWV3VGhyZXNob2xkIC0gYW1vdW50IGVsZW1lbnQgbXVzdCBiZSBpbiB2aWV3IGJ5LCB0byBiZSBjb3VudGVkIGFzIGluIHZpZXdcbiAqIEBwYXJhbSAge051bWJlcn0gb2JqLnRpbWVJblZpZXcgLSBkdXJhdGlvbiBlbGVtZW50IG11c3QgYmUgaW4gdmlldyBmb3IsIHRvIGJlIGNvbnNpZGVyZWQgdmlld2FibGVcbiAqIEByZXR1cm4ge09iamVjdH0gb2JqZWN0IHRoYXQgY29udGFpbnMgYSBwcm9wZXJ0eSBkZXNjcmliaW5nIGlmIHRoZSBjcml0ZXJpYSBtZWV0cyB0aGUgZXhwZWN0ZWQgcmVxdWlyZW1lbnRzIGFuZCBpZiBub3QsIHdoaWNoIGFzc2VydGlvbnMgaXQgZmFpbHNcbiAqL1xuZXhwb3J0IGNvbnN0IHZhbGlkYXRlQ3JpdGVyaWEgPSAoeyBpblZpZXdUaHJlc2hvbGQsIHRpbWVJblZpZXcgfSkgPT4ge1xuICBsZXQgaW52YWxpZCA9IGZhbHNlLCByZWFzb25zID0gW107IFxuXG4gIGlmKHR5cGVvZiBpblZpZXdUaHJlc2hvbGQgIT09ICdudW1iZXInIHx8IGluVmlld1RocmVzaG9sZCA+IDEpIHtcbiAgICBpbnZhbGlkID0gdHJ1ZTtcbiAgICByZWFzb25zLnB1c2goJ2luVmlld1RocmVzaG9sZCBtdXN0IGJlIGEgbnVtYmVyIGVxdWFsIHRvIG9yIGxlc3MgdGhhbiAxJyk7XG4gIH1cblxuICBpZih0eXBlb2YgdGltZUluVmlldyAhPT0gJ251bWJlcicgfHwgdGltZUluVmlldyA8IDApIHtcbiAgICBpbnZhbGlkID0gdHJ1ZTtcbiAgICByZWFzb25zLnB1c2goJ3RpbWVJblZpZXcgbXVzdCBiZSBhIG51bWJlciBncmVhdGVyIHRvIG9yIGVxdWFsIDAnKTtcbiAgfVxuXG4gIHJldHVybiB7IGludmFsaWQsIHJlYXNvbnM6IHJlYXNvbnMuam9pbignIHwgJykgfTtcbn07XG5cbi8qKlxuICogQHBhcmFtICB7T2JqZWN0fSBvYmogLSBzdHJhdGVneSBvYmplY3QgdG8gdGVzdCBmb3IgdmFsaWRpdHkgXG4gKiBAcGFyYW0gIHtCb29sZWFufSBvYmouYXV0b3N0YXJ0IC0gY29uZmlndXJlcyB3aGV0aGVyIHZpZXdhYmlsaXR5IG1lYXN1cmVtZW50IHNob3VsZCBiZWdpbiBhcyBzb29uIGFzIHRlY2huaXF1ZSBpcyBjb25maWd1cmVkXG4gKiBAcGFyYW0gIHtBcnJheS48QmFzZVRlY2huaXF1ZT59IG9iai50ZWNobmlxdWVzIC0gbGlzdCBvZiBtZWFzdXJlbWVudCB0ZWNobmlxdWVzIHRvIHVzZVxuICogQHBhcmFtICB7T2JqZWN0fSBvYmouY3JpdGVyaWEgLSBtZWFzdXJlbWVudCBjcml0ZXJpYSB0byB1c2UgdG8gZGV0ZXJtaW5lIGlmIGFuIGVsZW1lbnQgaXMgdmlld2FibGVcbiAqIEByZXR1cm4ge09iamVjdH0gb2JqZWN0IGRlc2NyaWJpbmcgd2hldGhlciB0aGUgdGVzdGVkIHN0cmF0ZWd5IGlzIGludmFsaWQgYW5kIGlmIHNvLCB3aGF0IGlzIHRoZSByZWFzb24gZm9yIGJlaW5nIGludmFsaWRcbiAqL1xuZXhwb3J0IGNvbnN0IHZhbGlkYXRlU3RyYXRlZ3kgPSAoeyBhdXRvc3RhcnQsIHRlY2huaXF1ZXMsIGNyaXRlcmlhIH0pID0+IHtcbiAgbGV0IGludmFsaWQgPSBmYWxzZSwgcmVhc29ucyA9IFtdO1xuXG4gIGlmKHR5cGVvZiBhdXRvc3RhcnQgIT09ICdib29sZWFuJykge1xuICAgIGludmFsaWQgPSB0cnVlO1xuICAgIHJlYXNvbnMucHVzaCgnYXV0b3N0YXJ0IG11c3QgYmUgYm9vbGVhbicpO1xuICB9XG5cbiAgaWYoIUFycmF5LmlzQXJyYXkodGVjaG5pcXVlcykgfHwgdGVjaG5pcXVlcy5sZW5ndGggPT09IDApIHtcbiAgICBpbnZhbGlkID0gdHJ1ZTtcbiAgICByZWFzb25zLnB1c2goJ3RlY2huaXF1ZXMgbXVzdCBiZSBhbiBhcnJheSBjb250YWluaW5nIGF0bGVhc3Qgb24gbWVhc3VyZW1lbnQgdGVjaG5pcXVlcycpO1xuICB9XG5cbiAgY29uc3QgdmFsaWRhdGVkID0gdmFsaWRhdGVDcml0ZXJpYShjcml0ZXJpYSk7XG5cbiAgaWYodmFsaWRhdGVkLmludmFsaWQpIHtcbiAgICBpbnZhbGlkID0gdHJ1ZTtcbiAgICByZWFzb25zLnB1c2godmFsaWRhdGVkLnJlYXNvbnMpO1xuICB9XG5cbiAgcmV0dXJuIHsgaW52YWxpZCwgcmVhc29uczogcmVhc29ucy5qb2luKCcgfCAnKSB9O1xufTsiLCIvKipcbiAqIEV2ZW50cyBtb2R1bGVcbiAqIEBtb2R1bGUgTWVhc3VyZW1lbnQvRXZlbnRzXG4gKiByZXByZXNlbnRzIEV2ZW50IGNvbnN0YW50c1xuICovXG5cbi8qKiByZXByZXNlbnRzIHRoYXQgZWxlbWVudCBpcyBpbiB2aWV3IGFuZCBtZWFzdXJlbWVudCBoYXMgc3RhcnRlZCAqL1xuZXhwb3J0IGNvbnN0IFNUQVJUID0gJ3N0YXJ0Jztcbi8qKiByZXByZXNlbnRzIGEgdmlld2FibGUgbWVhc3VyZW1lbnQgc3RvcC4gVGhpcyBvY2N1cnMgd2hlbiBtZWFzdXJlbWVudCBoYXMgcHJldmlvdXNseSBzdGFydGVkLCBidXQgdGhlIGVsZW1lbnQgaGFzIGdvbmUgb3V0IG9mIHZpZXcgKi9cbmV4cG9ydCBjb25zdCBTVE9QID0gJ3N0b3AnO1xuLyoqIHJlcHJlc2VudHMgYSB2aWV3YWJsZSBjaGFuZ2UgZXZlbnQuIEVpdGhlciBtZWFzdXJlbWVudCBoYXMgc3RhcnRlZCwgc3RvcHBlZCwgb3IgdGhlIGVsZW1lbnQncyBpbiB2aWV3IGFtb3VudCAodmlld2FibGUgcGVyY2VudGFnZSkgaGFzIGNoYW5nZWQgKi9cbmV4cG9ydCBjb25zdCBDSEFOR0UgPSAnY2hhbmdlJztcbi8qKiByZXByZXNlbnRzIHRoYXQgdmlld2FiaWxpdHkgbWVhc3VyZW1lbnQgaGFzIGNvbXBsZXRlZC4gdGhlIGVsZW1lbnQgaGFzIGJlZW4gaW4gdmlldyBmb3IgdGhlIGR1cmF0aW9uIHNwZWNpZmllZCBpbiB0aGUgbWVhc3VyZW1lbnQgY3JpdGVyaWEgKi9cbmV4cG9ydCBjb25zdCBDT01QTEVURSA9ICdjb21wbGV0ZSc7XG4vKiogcmVwcmVzZW50cyB0aGF0IG5vIGNvbXBhdGlibGUgdGVjaG5pcXVlcyBoYXZlIGJlZW4gZm91bmQgdG8gbWVhc3VyZSB2aWV3YWJpbGl0eSB3aXRoICovXG5leHBvcnQgY29uc3QgVU5NRUFTVVJFQUJMRSA9ICd1bm1lYXN1cmVhYmxlJztcbi8qKiBpbnRlcm5hbCByZXByZXNlbnRhdGlvbiBvZiB0aGUgdmlld2FibGUgc3RhdGUgb2YgdGhlIGVsZW1lbnQgYXMgaW4gdmlldyAqL1xuZXhwb3J0IGNvbnN0IElOVklFVyA9ICdpbnZpZXcnO1xuLyoqIGludGVybmFsIHJlcHJlc2VudGF0aW9uIG9mIHRoZSB2aWV3YWJsZSBzdGF0ZSBvZiB0aGUgZWxlbWVudCBhcyBvdXQgb2YgdmlldyAqL1xuZXhwb3J0IGNvbnN0IE9VVFZJRVcgPSAnb3V0dmlldyc7ICIsImltcG9ydCBJblZpZXdUaW1lciBmcm9tICcuLi9UaW1pbmcvSW5WaWV3VGltZXInO1xuaW1wb3J0IHsgREVGQVVMVF9TVFJBVEVHWSB9IGZyb20gJy4vU3RyYXRlZ2llcy8nO1xuaW1wb3J0IHsgdmFsaWRUZWNobmlxdWUsIHZhbGlkYXRlU3RyYXRlZ3kgfSBmcm9tICcuLi9IZWxwZXJzL1ZhbGlkYXRvcnMnO1xuaW1wb3J0ICogYXMgRW52aXJvbm1lbnQgZnJvbSAnLi4vRW52aXJvbm1lbnQvRW52aXJvbm1lbnQnO1xuaW1wb3J0ICogYXMgRXZlbnRzIGZyb20gJy4vRXZlbnRzJztcblxuLyoqXG4gKiBDbGFzcyByZXByZXNlbnRpbmcgYSBtZWFzdXJlbWVudCBleGVjdXRvclxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBNZWFzdXJlbWVudEV4ZWN1dG9yIHtcbiAgLyoqXG4gICAqIENyZWF0ZSBhIG5ldyBpbnN0YW5jZSBvZiBhIE1lYXN1cmVtZW50RXhlY3V0b3JcbiAgICogQHBhcmFtIHtIVE1MRWxlbWVudH0gZWxlbWVudCAtIGEgSFRNTCBlbGVtZW50IHRvIG1lYXN1cmVcbiAgICogQHBhcmFtIHtPYmplY3R9IHN0cmF0ZWd5IC0gYSBzdHJhdGVneSBvYmplY3QgZGVmaW5pbmcgdGhlIG1lYXN1cmVtZW50IHRlY2huaXF1ZXMgYW5kIHdoYXQgY3JpdGVyaWEgY29uc3RpdHV0ZSBhIHZpZXdhYmxlIHN0YXRlLlxuICAgKiBTZWUgT3BlblZWLlN0cmF0ZWdpZXMgREVGQVVMVF9TVFJBVEVHWSBhbmQgU3RyYXRlZ3lGYWN0b3J5IGZvciBtb3JlIGRldGFpbHMgb24gcmVxdWlyZWQgcGFyYW1zXG4gICAqL1xuICBjb25zdHJ1Y3RvcihlbGVtZW50LCBzdHJhdGVneSA9IHt9KSB7XG4gICAgLyoqIEBwcml2YXRlIHtPYmplY3R9IGV2ZW50IGxpc3RlbmVyIGFycmF5cyAqL1xuICAgIHRoaXMuX2xpc3RlbmVycyA9IHsgc3RhcnQ6IFtdLCBzdG9wOiBbXSwgY2hhbmdlOiBbXSwgY29tcGxldGU6IFtdLCB1bm1lYXN1cmVhYmxlOiBbXSB9O1xuICAgIC8qKiBAcHJpdmF0ZSB7SFRNTEVsZW1lbnR9IEhUTUwgZWxlbWVudCB0byBtZWFzdXJlICovXG4gICAgdGhpcy5fZWxlbWVudCA9IGVsZW1lbnQ7XG4gICAgLyoqIEBwcml2YXRlIHtPYmplY3R9IG1lYXN1cmVtZW50IHN0cmF0ZWd5ICovXG4gICAgdGhpcy5fc3RyYXRlZ3kgPSBPYmplY3QuYXNzaWduKHt9LCBERUZBVUxUX1NUUkFURUdZLCBzdHJhdGVneSk7XG4gICAgLyoqIEBwcml2YXRlIHtCb29sZWFufSB0cmFja3Mgd2hldGhlciB2aWV3YWJpbGl0eSBjcml0ZXJpYSBoYXMgYmVlbiBtZXQgKi9cbiAgICB0aGlzLl9jcml0ZXJpYU1ldCA9IGZhbHNlO1xuXG4gICAgY29uc3QgdmFsaWRhdGVkID0gdmFsaWRhdGVTdHJhdGVneSh0aGlzLl9zdHJhdGVneSk7XG5cbiAgICBpZih2YWxpZGF0ZWQuaW52YWxpZCkge1xuICAgICAgdGhyb3cgdmFsaWRhdGVkLnJlYXNvbnM7XG4gICAgfVxuXG4gICAgLyoqIEBwcml2YXRlIHtCYXNlVGVjaG5pcXVlfSB0ZWNobmlxdWUgdG8gbWVhc3VyZSB2aWV3YWJpbGl0eSB3aXRoICovXG4gICAgdGhpcy5fdGVjaG5pcXVlID0gdGhpcy5fc2VsZWN0VGVjaG5pcXVlKHRoaXMuX3N0cmF0ZWd5LnRlY2huaXF1ZXMpO1xuICAgIFxuICAgIGlmKHRoaXMuX3RlY2huaXF1ZSkge1xuICAgICAgdGhpcy5fYWRkU3Vic2NyaXB0aW9ucyh0aGlzLl90ZWNobmlxdWUpO1xuICAgIH0gICBcblxuICAgIGlmKHRoaXMudW5tZWFzdXJlYWJsZSkge1xuICAgICAgLy8gZmlyZSB1bm1lYXN1cmVhYmxlIGFmdGVyIGN1cnJlbnQgSlMgbG9vcCBjb21wbGV0ZXMgXG4gICAgICAvLyBzbyBvcHBvcnR1bml0eSBpcyBnaXZlbiBmb3IgY29uc3VtZXJzIHRvIHByb3ZpZGUgdW5tZWFzdXJlYWJsZSBjYWxsYmFja1xuICAgICAgc2V0VGltZW91dCggKCkgPT4gdGhpcy5fcHVibGlzaChFdmVudHMuVU5NRUFTVVJFQUJMRSwgRW52aXJvbm1lbnQuZ2V0RGV0YWlscyh0aGlzLl9lbGVtZW50KSksIDApO1xuICAgIH1cbiAgICBlbHNlIGlmKHRoaXMuX3N0cmF0ZWd5LmF1dG9zdGFydCkge1xuICAgICAgdGhpcy5fdGVjaG5pcXVlLnN0YXJ0KCk7XG4gICAgfVxuICB9XG5cbiAgLyoqIFxuICAgKiBzdGFydHMgdmlld2FiaWxpdHkgbWVhc3VybWVudCB1c2luZyB0aGUgc2VsZWN0ZWQgdGVjaG5pcXVlXG4gICAqIEBwdWJsaWNcbiAgICovXG4gIHN0YXJ0KCkge1xuICAgIHRoaXMuX3RlY2huaXF1ZS5zdGFydCgpO1xuICB9XG5cbiAgLyoqXG4gICAqIGRpc3Bvc2UgdGhlIG1lYXN1cm1lbnQgdGVjaG5pcXVlIGFuZCBhbnkgdGltZXJzXG4gICAqIEBwdWJsaWNcbiAgICovXG4gIGRpc3Bvc2UoKSB7XG4gICAgaWYodGhpcy5fdGVjaG5pcXVlKSB7XG4gICAgICB0aGlzLl90ZWNobmlxdWUuZGlzcG9zZSgpO1xuICAgIH1cbiAgICBpZih0aGlzLnRpbWVyKSB7XG4gICAgICB0aGlzLnRpbWVyLmRpc3Bvc2UoKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSGFuZGxlIHZpZXdhYmlsaXR5IHRyYWNraW5nIHN0YXJ0XG4gICAqIEBwdWJsaWNcbiAgICogQHBhcmFtICB7dmlld2FibGVDYWxsYmFja30gY2FsbGJhY2sgLSBpcyBjYWxsZWQgd2hlbiB2aWV3YWJpbGl0eSBzdGFydHMgdHJhY2tpbmdcbiAgICogQHJldHVybiB7TWVhc3VybWVudEV4ZWN1dG9yfSByZXR1cm5zIGluc3RhbmNlIG9mIE1lYXN1cmVtZW50RXhlY3V0b3IgYXNzb2NpYXRlZCB3aXRoIHRoaXMgY2FsbGJhY2tcbiAgICovXG4gIG9uVmlld2FibGVTdGFydChjYWxsYmFjaykge1xuICAgIHJldHVybiB0aGlzLl9hZGRDYWxsYmFjayhjYWxsYmFjaywgRXZlbnRzLlNUQVJUKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBIYW5kbGUgdmlld2FiaWxpdHkgdHJhY2tpbmcgc3RvcC5cbiAgICogQHB1YmxpY1xuICAgKiBAcGFyYW0ge3ZpZXdhYmxlQ2FsbGJhY2t9IGNhbGxiYWNrIC0gaXMgY2FsbGVkIHdoZW4gdmlld2FiaWxpdHkgaGFzIHByZXZpb3VzbHkgc3RhcnRlZCwgYnV0IGVsZW1lbnQgaXMgbm93IG91dCBvZiB2aWV3XG4gICAqIEByZXR1cm4ge01lYXN1cmVtZW50RXhlY3V0b3J9IHJldHVybnMgaW5zdGFuY2Ugb2YgTWVhc3VyZW1lbnRFeGVjdXRvciBhc3NvY2lhdGVkIHdpdGggdGhpcyBjYWxsYmFja1xuICAgKi9cbiAgb25WaWV3YWJsZVN0b3AoY2FsbGJhY2spIHtcbiAgICByZXR1cm4gdGhpcy5fYWRkQ2FsbGJhY2soY2FsbGJhY2ssIEV2ZW50cy5TVE9QKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBIYW5kbGUgdmlld2FiaWxpdHkgY2hhbmdlLlxuICAgKiBAcHVibGljXG4gICAqIEBwYXJhbSAge3ZpZXdhYmxlQ2FsbGJhY2t9IGNhbGxiYWNrIC0gY2FsbGVkIHdoZW4gdGhlIHZpZXdhYmxlIHBlcmNlbnRhZ2Ugb2YgdGhlIGVsZW1lbnQgaGFzIGNoYW5nZWRcbiAgICogQHJldHVybiB7TWVhc3VyZW1lbnRFeGVjdXRvcn0gcmV0dXJucyBpbnN0YW5jZSBvZiBNZWFzdXJlbWVudEV4ZWN1dG9yIGFzc29jaWF0ZWQgd2l0aCB0aGlzIGNhbGxiYWNrXG4gICAqL1xuICBvblZpZXdhYmxlQ2hhbmdlKGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIHRoaXMuX2FkZENhbGxiYWNrKGNhbGxiYWNrLCBFdmVudHMuQ0hBTkdFKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBIYW5kbGUgdmlld2FiaWxpdHkgY29tcGxldGUuXG4gICAqIEBwdWJsaWNcbiAgICogQHBhcmFtICB7dmlld2FibGVDYWxsYmFja30gY2FsbGJhY2sgLSBjYWxsZWQgd2hlbiBlbGVtZW50IGhhcyBiZWVuIGluIHZpZXcgZm9yIHRoZSBkdXJhdGlvbiBzcGVjaWZpZWQgaW4gdGhlIG1lYXN1cmVtZW50IHN0cmF0ZWd5IGNvbmZpZ1xuICAgKiBAcmV0dXJuIHtNZWFzdXJlbWVudEV4ZWN1dG9yfSByZXR1cm5zIGluc3RhbmNlIG9mIE1lYXN1cmVtZW50RXhlY3V0b3IgYXNzb2NpYXRlZCB3aXRoIHRoaXMgY2FsbGJhY2tcbiAgICovXG4gIG9uVmlld2FibGVDb21wbGV0ZShjYWxsYmFjaykge1xuICAgIHRoaXMuX2FkZENhbGxiYWNrKGNhbGxiYWNrLCBFdmVudHMuQ09NUExFVEUpO1xuICAgIC8vIGlmIHZpZXdhYmxpdHkgY3JpdGVyaWEgYWxyZWFkeSBtZXQsIGZpcmUgY2FsbGJhY2sgaW1tZWRpYXRlbHlcbiAgICBpZih0aGlzLmNyaXRlcmlhTWV0KSB7XG4gICAgICB0aGlzLl90ZWNobmlxdWVDaGFuZ2UoRXZlbnRzLkNPTVBMRVRFLCB0aGlzLl90ZWNobmlxdWUpO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8qKlxuICAgKiBIYW5kbGUgdW5tZWFzdXJlYWJsZSBldmVudFxuICAgKiBAcHVibGljXG4gICAqIEBwYXJhbSAge3ZpZXdhYmxlQ2FsbGJhY2t9IGNhbGxiYWNrIC0gY2FsbGVkIHdoZW4gbm8gc3VpdGFibGUgbWVhc3VyZW1lbnQgdGVjaG5pcXVlcyBhcmUgYXZhaWxhYmxlIGZyb20gdGhlIHRlY2huaXF1ZXMgcHJvdmlkZWRcbiAgICogQHJldHVybiB7TWVhc3VyZW1lbnRFeGVjdXRvcn0gcmV0dXJucyBpbnN0YW5jZSBvZiBNZWFzdXJlbWVudEV4ZWN1dG9yIGFzc29jaWF0ZWQgd2l0aCB0aGlzIGNhbGxiYWNrXG4gICAqL1xuICBvblVubWVhc3VyZWFibGUoY2FsbGJhY2spIHtcbiAgICB0aGlzLl9hZGRDYWxsYmFjayhjYWxsYmFjaywgRXZlbnRzLlVOTUVBU1VSRUFCTEUpO1xuICAgIC8vIGlmIGV4ZWN1dG9yIGlzIGFscmVhZHkgdW5tZWFzdXJlYWJsZSwgZmlyZSBjYWxsYmFjayBpbW1lZGlhdGVseVxuICAgIGlmKHRoaXMudW5tZWFzdXJlYWJsZSkge1xuICAgICAgdGhpcy5fdGVjaG5pcXVlQ2hhbmdlKEV2ZW50cy5VTk1FQVNVUkVBQkxFKVxuICAgIH1cbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gICAvKipcbiAgICogQGNhbGxiYWNrIHZpZXdhYmxlQ2FsbGJhY2tcbiAgICogQHBhcmFtIHtPYmplY3R9IGRldGFpbHMgLSBlbnZpcm9ubWVudCBhbmQgbWVhc3VyZW1lbnQgZGV0YWlscyBvZiB2aWV3YWJsZSBldmVudFxuICAgKiBAcmV0dXJuIHtNZWFzdXJtZW50RXhlY3V0b3J9IHJldHVybnMgaW5zdGFuY2Ugb2YgTWVhc3VyZW1lbnRFeGVjdXRvciBhc3NvY2lhdGVkIHdpdGggdGhpcyBjYWxsYmFja1xuICAgKi9cblxuICAvKipcbiAgICogQHJldHVybiB7Qm9vbGVhbn0gLSB3aGV0aGVyIE1lYXN1cmVtZW50RXhlY3V0b3IgaW5zdGFuY2UgaXMgY2FwYWJsZSBvZiBtZWFzdXJpbmcgdmlld2FiaWxpdHlcbiAgICovXG4gIGdldCB1bm1lYXN1cmVhYmxlKCkge1xuICAgIHJldHVybiAhdGhpcy5fdGVjaG5pcXVlIHx8IHRoaXMuX3RlY2huaXF1ZS51bm1lYXN1cmVhYmxlO1xuICB9XG5cbiAgLyoqXG4gICAqIEluc3RhbnRpYXRlcyBhbmQgZmlsdGVycyBsaXN0IG9mIGF2YWlsYWJsZSBtZWFzdXJlbWVudCB0ZWNobnFpdWVzIHRvIHRoZSBmaXJzdCB1bm1lYXN1cmVhYmxlIHRlY2huaXF1ZVxuICAgKiBAcHJpdmF0ZVxuICAgKiBAcGFyYW0gIHtBcnJheX0gLSBsaXN0IG9mIHRlY2huaXF1ZXMgYXZhaWxhYmxlIHRvIG1lYXN1cmUgdmlld2FiaWxpdHkgd2l0aFxuICAgKiBAcmV0dXJuIHtCYXNlVGVjaG5pcXVlfSBzZWxlY3RlZCB0ZWNobmlxdWVcbiAgICovXG4gIF9zZWxlY3RUZWNobmlxdWUodGVjaG5pcXVlcykge1xuICAgIHJldHVybiB0ZWNobmlxdWVzXG4gICAgICAgICAgICAuZmlsdGVyKHZhbGlkVGVjaG5pcXVlKVxuICAgICAgICAgICAgLm1hcCh0aGlzLl9pbnN0YW50aWF0ZVRlY2huaXF1ZS5iaW5kKHRoaXMpKVxuICAgICAgICAgICAgLmZpbmQodGVjaG5pcXVlID0+ICF0ZWNobmlxdWUudW5tZWFzdXJlYWJsZSk7XG4gIH1cblxuICAvKipcbiAgICogY3JlYXRlcyBpbnN0YW5jZSBvZiB0ZWNobmlxdWVcbiAgICogQHByaXZhdGVcbiAgICogQHBhcmFtICB7RnVuY3Rpb259IC0gdGVjaG5pcXVlIGNvbnN0cnVjdG9yXG4gICAqIEByZXR1cm4ge0Jhc2VUZWNobmlxdWV9IGluc3RhbmNlIG9mIHRlY2huaXF1ZSBwcm92aWRlZFxuICAgKi9cbiAgX2luc3RhbnRpYXRlVGVjaG5pcXVlKHRlY2huaXF1ZSkge1xuICAgIHJldHVybiBuZXcgdGVjaG5pcXVlKGVsZW1lbnQsIHRoaXMuX3N0cmF0ZWd5LmNyaXRlcmlhKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBhZGRzIGV2ZW50IGxpc3RlbmVycyB0byB0ZWNobmlxdWUgXG4gICAqIEBwcml2YXRlXG4gICAqIEBwYXJhbSB7QmFzZVRlY2huaXF1ZX0gLSB0ZWNobmlxdWUgdG8gYWRkIGV2ZW50IGxpc3RlbmVycyB0b1xuICAgKi9cbiAgX2FkZFN1YnNjcmlwdGlvbnModGVjaG5pcXVlKSB7XG4gICAgaWYodGVjaG5pcXVlKSB7XG4gICAgICB0ZWNobmlxdWUub25JblZpZXcodGhpcy5fdGVjaG5pcXVlQ2hhbmdlLmJpbmQodGhpcywgRXZlbnRzLklOVklFVywgdGVjaG5pcXVlKSk7XG4gICAgICB0ZWNobmlxdWUub25DaGFuZ2VWaWV3KHRoaXMuX3RlY2huaXF1ZUNoYW5nZS5iaW5kKHRoaXMsIEV2ZW50cy5DSEFOR0UsIHRlY2huaXF1ZSkpO1xuICAgICAgdGVjaG5pcXVlLm9uT3V0Vmlldyh0aGlzLl90ZWNobmlxdWVDaGFuZ2UuYmluZCh0aGlzLCBFdmVudHMuT1VUVklFVywgdGVjaG5pcXVlKSk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIGhhbmRsZXMgdmlld2FibGUgY2hhbmdlIGV2ZW50cyBmcm9tIGEgbWVhc3VyZW1lbnQgdGVjaG5pcXVlXG4gICAqIEBwcml2YXRlXG4gICAqIEBwYXJhbSAge1N0cmluZ30gLSBjaGFuZ2UgdHlwZS4gU2VlIE1lYXN1cmVtZW50L0V2ZW50cyBtb2R1bGUgZm9yIGxpc3Qgb2YgY2hhbmdlc1xuICAgKiBAcGFyYW0gIHtPYmplY3R9IC0gdGVjaG5pcXVlIHRoYXQgcmVwb3J0ZWQgY2hhbmdlLiBNYXkgYmUgdW5kZWZpbmVkIGluIGNhc2Ugb2YgdW5tZWFzdXJlYWJsZSBldmVudFxuICAgKi9cbiAgX3RlY2huaXF1ZUNoYW5nZShjaGFuZ2UsIHRlY2huaXF1ZSA9IHt9KSB7XG4gICAgbGV0IGV2ZW50TmFtZTtcbiAgICBjb25zdCBkZXRhaWxzID0gdGhpcy5fYXBwZW5kRW52aXJvbm1lbnQodGVjaG5pcXVlKTtcblxuICAgIHN3aXRjaChjaGFuZ2UpIHtcbiAgICAgIGNhc2UgRXZlbnRzLklOVklFVzpcbiAgICAgICAgaWYoIXRoaXMuX2NyaXRlcmlhTWV0KXtcbiAgICAgICAgICB0aGlzLnRpbWVyID0gbmV3IEluVmlld1RpbWVyKHRoaXMuX3N0cmF0ZWd5LmNyaXRlcmlhLnRpbWVJblZpZXcpO1xuICAgICAgICAgIHRoaXMudGltZXIuZWxhcHNlZCh0aGlzLl90aW1lckVsYXBzZWQuYmluZCh0aGlzLCB0ZWNobmlxdWUpKTtcbiAgICAgICAgICB0aGlzLnRpbWVyLnN0YXJ0KCk7XG4gICAgICAgICAgZXZlbnROYW1lID0gRXZlbnRzLlNUQVJUO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBicmVhaztcblxuICAgICAgY2FzZSBFdmVudHMuQ0hBTkdFOlxuICAgICAgICBldmVudE5hbWUgPSBjaGFuZ2U7XG4gICAgICAgIGJyZWFrO1xuXG4gICAgICBjYXNlIEV2ZW50cy5DT01QTEVURTpcbiAgICAgICAgaWYoIXRoaXMuX2NyaXRlcmlhTWV0KSB7XG4gICAgICAgICAgdGhpcy5fY3JpdGVyaWFNZXQgPSB0cnVlO1xuICAgICAgICAgIGV2ZW50TmFtZSA9IGNoYW5nZTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgYnJlYWs7XG5cbiAgICAgIGNhc2UgRXZlbnRzLk9VVFZJRVc6XG4gICAgICAgIGlmKCF0aGlzLl9jcml0ZXJpYU1ldCkge1xuICAgICAgICAgIGlmKHRoaXMudGltZXIpIHtcbiAgICAgICAgICAgIHRoaXMudGltZXIuc3RvcCgpO1xuICAgICAgICAgICAgZGVsZXRlIHRoaXMudGltZXI7XG4gICAgICAgICAgfVxuICAgICAgICAgIGV2ZW50TmFtZSA9IEV2ZW50cy5TVE9QO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBicmVhaztcblxuICAgICAgY2FzZSBFdmVudHMuVU5NRUFTVVJFQUJMRTogXG4gICAgICAgIGV2ZW50TmFtZSA9IEV2ZW50cy5VTk1FQVNVUkVBQkxFO1xuICAgIH1cblxuICAgIGlmKGV2ZW50TmFtZSkge1xuICAgICAgdGhpcy5fcHVibGlzaChldmVudE5hbWUsIGRldGFpbHMpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBwdWJsaXNoZXMgZXZlbnRzIHRvIGF2YWlsYWJsZSBsaXN0ZW5lcnNcbiAgICogQHByaXZhdGVcbiAgICogQHBhcmFtICB7U3RyaW5nfSAtIGV2ZW50IG5hbWVcbiAgICogQHBhcmFtICB7fSAtIHZhbHVlIHRvIGNhbGwgY2FsbGJhY2sgd2l0aFxuICAgKi9cbiAgX3B1Ymxpc2goZXZlbnQsIHZhbHVlKSB7XG4gICAgaWYoQXJyYXkuaXNBcnJheSh0aGlzLl9saXN0ZW5lcnNbZXZlbnRdKSkge1xuICAgICAgdGhpcy5fbGlzdGVuZXJzW2V2ZW50XS5mb3JFYWNoKCBsID0+IGwodmFsdWUpICk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIGNhbGxiYWNrIGZvciB0aW1lciBlbGFwc2VkIFxuICAgKiBAcHJpdmF0ZVxuICAgKiBAcGFyYW0gIHtCYXNlVGVjaG5pcXVlfSAtIHRlY2huaXF1ZSB1c2VkIHRvIHBlcmZvcm0gbWVhc3VyZW1lbnRcbiAgICovXG4gIF90aW1lckVsYXBzZWQodGVjaG5pcXVlKSB7XG4gICAgdGhpcy5fdGVjaG5pcXVlQ2hhbmdlKEV2ZW50cy5DT01QTEVURSwgdGVjaG5pcXVlKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBc3NvY2lhdGVzIGNhbGxiYWNrIGZ1bmN0aW9uIHdpdGggZXZlbnQgXG4gICAqIEBwcml2YXRlXG4gICAqIEBwYXJhbSB7RnVuY3Rpb259IC0gY2FsbGJhY2sgZnVuY3Rpb24gdG8gYXNzb2NpYXRlIHdpdGggZXZlbnRcbiAgICogQHBhcmFtIHtTdHJpbmd9IGV2ZW50IC0gZXZlbnQgdG8gYXNzb2NpYXRlIGNhbGxiYWNrIGZ1bmN0aW9uIHdpdGhcbiAgICogQHJldHVybiB7TWVhc3VyZW1lbnRFeGVjdXRvcn0gcmV0dXJucyBpbnN0YW5jZSBvZiBNZWFzdXJlbWVudEV4ZWN1dG9yIGFzc29jaWF0ZWQgd2l0aCB0aGlzIGNhbGxiYWNrXG4gICAqL1xuICBfYWRkQ2FsbGJhY2soY2FsbGJhY2ssIGV2ZW50KSB7XG4gICAgaWYodGhpcy5fbGlzdGVuZXJzW2V2ZW50XSAmJiB0eXBlb2YgY2FsbGJhY2sgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHRoaXMuX2xpc3RlbmVyc1tldmVudF0ucHVzaChjYWxsYmFjayk7XG4gICAgfVxuICAgIGVsc2UgaWYodHlwZW9mIGNhbGxiYWNrICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICB0aHJvdyAnQ2FsbGJhY2sgbXVzdCBiZSBhIGZ1bmN0aW9uJztcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8qKlxuICAgKiBDb21iaW5lcyBlbnZpcm9ubWVudCBkZXRhaWxzIHdpdGggbWVhc3VyZW1lbnQgdGVjaG5pcXVlIGRldGFpbHNcbiAgICogQHByaXZhdGVcbiAgICogQHBhcmFtICB7QmFzZVRlY2huaXF1ZX0gLSB0ZWNobmlxdWUgdG8gZ2V0IG1lYXN1cmVtZW50IGRldGFpbHMgZnJvbSBcbiAgICogQHJldHVybiB7T2JqZWN0fSBFbnZpcm9ubWVudCBkZXRhaWxzIGFuZCBtZWFzdXJlbWVudCBkZXRhaWxzIGNvbWJpbmVkXG4gICAqL1xuICBfYXBwZW5kRW52aXJvbm1lbnQodGVjaG5pcXVlKSB7XG4gICAgcmV0dXJuIE9iamVjdC5hc3NpZ24oXG4gICAgICB7fSwgXG4gICAgICB7IFxuICAgICAgICBwZXJjZW50Vmlld2FibGU6IHR5cGVvZiB0ZWNobmlxdWUucGVyY2VudFZpZXdhYmxlID09PSAndW5kZWZpbmVkJyA/IC0xIDogdGVjaG5pcXVlLnBlcmNlbnRWaWV3YWJsZSwgXG4gICAgICAgIHRlY2huaXF1ZTogdGVjaG5pcXVlLnRlY2huaXF1ZU5hbWUgfHwgLTEsIFxuICAgICAgICB2aWV3YWJsZTogdHlwZW9mIHRlY2huaXF1ZS52aWV3YWJsZSA9PT0gJ3VuZGVmaW5lZCcgPyAtMSA6IHRlY2huaXF1ZS52aWV3YWJsZSBcbiAgICAgIH0sIFxuICAgICAgRW52aXJvbm1lbnQuZ2V0RGV0YWlscyh0aGlzLl9lbGVtZW50KSBcbiAgICApO1xuICB9XG59IiwiLyoqXG4gKiBDbGFzcyByZXByZXNlbnRpbmcgYmFzaWMgZnVuY3Rpb25hbGl0eSBvZiBhIE1lYXN1cmVtZW50IFRlY2huaXF1ZVxuICogU29tZSBvZiBpdCdzIG1lbWJlcnMgYXJlIGludGVuZGVkIHRvIGJlIG92ZXJyaWRlbiBieSBpbmhlcml0dGluZyBjbGFzc1xuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBCYXNlVGVjaG5pcXVlIHtcbiAgLyoqXG4gICAqIEBjb25zdHJ1Y3RvclxuICAgKiBAcmV0dXJuIHtCYXNlVGVjaG5pcXVlfSBpbnN0YW5jZSBvZiBCYXNlVGVjaG5pcXVlXG4gICAqL1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICB0aGlzLmxpc3RlbmVycyA9IHtcbiAgICAgIGluVmlldzpbXSxcbiAgICAgIG91dFZpZXc6W10sXG4gICAgICBjaGFuZ2VWaWV3OltdXG4gICAgfTtcblxuICAgIHRoaXMucGVyY2VudFZpZXdhYmxlID0gMC4wO1xuICB9XG5cbiAgLyoqXG4gICAqIERlZmluZXMgY2FsbGJhY2sgdG8gY2FsbCB3aGVuIHRlY2huaXF1ZSBkZXRlcm1pbmVzIGVsZW1lbnQgaXMgaW4gdmlld1xuICAgKiBAcGFyYW0gIHtjaGFuZ2VDYWxsYmFja30gLSBjYWxsYmFjayB0byBjYWxsIHdoZW4gZWxlbWVudCBpcyBpbiB2aWV3XG4gICAqIEByZXR1cm4ge0Jhc2VUZWNobmlxdWV9IGluc3RhbmNlIG9mIEJhc2VUZWNobmlxdWUgYXNzb2NpYXRlZCB3aXRoIGNhbGxiYWNrLiBDYW4gYmUgdXNlZCB0byBjaGFpbiBjYWxsYmFjayBkZWZpbml0aW9ucy5cbiAgICovXG4gIG9uSW5WaWV3KGNiKSB7XG4gICAgcmV0dXJuIHRoaXMuYWRkQ2FsbGJhY2soY2IsJ2luVmlldycpO1xuICB9XG5cbiAgLyoqXG4gICAqIERlZmluZXMgY2FsbGJhY2sgdG8gY2FsbCB3aGVuIHRlY2huaXF1ZSBkZXRlcm1pbmVzIGVsZW1lbnQgdmlld2FiaWxpdHkgaGFzIGNoYW5nZWRcbiAgICogQHBhcmFtICB7Y2hhbmdlQ2FsbGJhY2t9IC0gY2FsbGJhY2sgdG8gY2FsbCB3aGVuIGVsZW1lbnQncyB2aWV3YWJpbGl0eSBoYXMgY2hhbmdlZFxuICAgKiBAcmV0dXJuIHtCYXNlVGVjaG5pcXVlfSBpbnN0YW5jZSBvZiBCYXNlVGVjaG5pcXVlIGFzc29jaWF0ZWQgd2l0aCBjYWxsYmFjay4gQ2FuIGJlIHVzZWQgdG8gY2hhaW4gY2FsbGJhY2sgZGVmaW5pdGlvbnMuXG4gICAqL1xuICBvbkNoYW5nZVZpZXcoY2IpIHtcbiAgICByZXR1cm4gdGhpcy5hZGRDYWxsYmFjayhjYiwnY2hhbmdlVmlldycpO1xuICB9XG5cbiAgLyoqXG4gICAqIERlZmluZXMgY2FsbGJhY2sgdG8gY2FsbCB3aGVuIHRlY2huaXF1ZSBkZXRlcm1pbmVzIGVsZW1lbnQgaXMgbm8gbG9uZ2VyIGluIHZpZXdcbiAgICogQHBhcmFtICB7Y2hhbmdlQ2FsbGJhY2t9IC0gY2FsbGJhY2sgdG8gY2FsbCB3aGVuIGVsZW1lbnQgaXMgbm8gbG9uZ2VyIGluIHZpZXdcbiAgICogQHJldHVybiB7QmFzZVRlY2huaXF1ZX0gaW5zdGFuY2Ugb2YgQmFzZVRlY2huaXF1ZSBhc3NvY2lhdGVkIHdpdGggY2FsbGJhY2suIENhbiBiZSB1c2VkIHRvIGNoYWluIGNhbGxiYWNrIGRlZmluaXRpb25zLlxuICAgKi9cbiAgb25PdXRWaWV3KGNiKSB7XG4gICAgcmV0dXJuIHRoaXMuYWRkQ2FsbGJhY2soY2IsJ291dFZpZXcnKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBAY2FsbGJhY2sgY2hhbmdlQ2FsbGJhY2tcbiAgICovXG5cbiAgLyoqXG4gICAqIEFzc29jaWF0ZSBjYWxsYmFjayB3aXRoIG5hbWVkIGV2ZW50XG4gICAqIEBwYXJhbSB7RnVuY3Rpb259IGNhbGxiYWNrIC0gY2FsbGJhY2sgdG8gY2FsbCB3aGVuIGV2ZW50IG9jY3Vyc1xuICAgKiBAcGFyYW0ge1N0cmluZ30gZXZlbnQgLSBuYW1lIG9mIGV2ZW50IHRvIGFzc29jaWF0ZSB3aXRoIGNhbGxiYWNrXG4gICAqL1xuICBhZGRDYWxsYmFjayhjYWxsYmFjaywgZXZlbnQpIHtcbiAgICBpZih0eXBlb2YgY2FsbGJhY2sgPT09ICdmdW5jdGlvbicgJiYgdGhpcy5saXN0ZW5lcnNbZXZlbnRdKSB7XG4gICAgICB0aGlzLmxpc3RlbmVyc1tldmVudF0ucHVzaChjYWxsYmFjayk7XG4gICAgfVxuICAgIGVsc2UgaWYodHlwZW9mIGNhbGxiYWNrICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICB0aHJvdyAnY2FsbGJhY2sgbXVzdCBiZSBmdW5jdGlvbic7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKiogXG4gICAqIGVtcHR5IHN0YXJ0IG1lbWJlci4gc2hvdWxkIGJlIGltcGxlbWVudGVkIGJ5IGluaGVyaXR0aW5nIGNsYXNzXG4gICAqL1xuICBzdGFydCgpIHt9XG5cbiAgLyoqXG4gICAqIGVtcHR5IGRpc3Bvc2UgbWVtYmVyLiBzaG91bGQgYmUgaW1wbGVtZW50ZWQgYnkgaW5oZXJpdHRpbmcgY2xhc3NcbiAgICovXG4gIGRpc3Bvc2UoKSB7fVxuXG4gIC8qKlxuICAgKiBAcmV0dXJuIHtCb29sZWFufSBkZWZpbmVzIHdoZXRoZXIgdGhlIHRlY2huaXF1ZSBpcyBjYXBhYmxlIG9mIG1lYXN1cmluZyBpbiB0aGUgY3VycmVudCBlbnZpcm9ubWVudFxuICAgKi9cbiAgZ2V0IHVubWVhc3VyZWFibGUoKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgLyoqXG4gICAqIEByZXR1cm4ge0Jvb2xlYW59IGRlZmluZXMgd2hldGhlciB0aGUgdGVjaG5pcXVlIGhhcyBkZXRlcm1pbmVkIHRoYXQgdGhlIG1lYXN1cmVkIGVsZW1lbnQgaXMgaW4gdmlld1xuICAgKi9cbiAgZ2V0IHZpZXdhYmxlKCkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBAcmV0dXJuIHtTdHJpbmd9IG5hbWUgb2YgdGhlIG1lYXN1cmVtZW50IHRlY2huaXF1ZVxuICAgKi9cbiAgZ2V0IHRlY2huaXF1ZU5hbWUoKSB7XG4gICAgcmV0dXJuICdCYXNlVGVjaG5pcXVlJztcbiAgfVxufSIsImltcG9ydCBCYXNlVGVjaG5pcXVlIGZyb20gJy4vQmFzZVRlY2huaXF1ZSc7XG5pbXBvcnQgeyB2YWxpZEVsZW1lbnQgfSBmcm9tICcuLi8uLi9IZWxwZXJzL1ZhbGlkYXRvcnMnO1xuaW1wb3J0IHsgREVGQVVMVF9TVFJBVEVHWSB9IGZyb20gJy4uL1N0cmF0ZWdpZXMvJztcblxuLyoqXG4gKiBSZXByZXNlbnRzIGEgbWVhc3VyZW1lbnQgdGVjaG5pcXVlIHRoYXQgdXNlcyBuYXRpdmUgSW50ZXJzZWN0aW9uT2JzZXJ2ZXIgQVBJXG4gKiBAZXh0ZW5kcyB7QmFzZVRlY2huaXF1ZX1cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgSW50ZXJzZWN0aW9uT2JzZXJ2ZXIgZXh0ZW5kcyBCYXNlVGVjaG5pcXVlIHtcbiAgLyoqXG4gICAqIENyZWF0ZXMgaW5zdGFuY2Ugb2YgSW50ZXJzZWN0aW9uT2JzZXJ2ZXIgbWVhc3VyZW1lbnQgdGVjaG5pcXVlXG4gICAqIEBjb25zdHJ1Y3RvclxuICAgKiBAcGFyYW0gIHtIVE1MRWxlbWVudH0gZWxlbWVudCAtIGVsZW1lbnQgdG8gcGVyZm9ybSB2aWV3YWJpbGl0eSBtZWFzdXJlbWVudCBvblxuICAgKiBAcGFyYW0gIHtPYmplY3R9IGNyaXRlcmlhIC0gbWVhc3VyZW1lbnQgY3JpdGVyaWEgb2JqZWN0LiBTZWUgT3B0aW9ucy9WaWV3YWJpbGl0eUNyaXRlcmlhIGZvciBtb3JlIGRldGFpbHNcbiAgICogQHJldHVybiB7SW50ZXJzZWN0aW9uT2JzZXJ2ZXJ9IGluc3RhbmNlIG9mIEludGVyc2VjdGlvbk9ic2VydmVyIG1lYXN1cmVtZW50IHRlY2huaXF1ZVxuICAgKi9cbiAgY29uc3RydWN0b3IoZWxlbWVudCwgY3JpdGVyaWEgPSBERUZBVUxUX1NUUkFURUdZLmNyaXRlcmlhKSB7XG4gICAgc3VwZXIoZWxlbWVudCwgY3JpdGVyaWEpO1xuICAgIGlmKGNyaXRlcmlhICE9PSB1bmRlZmluZWQgJiYgZWxlbWVudCkge1xuICAgICAgdGhpcy5lbGVtZW50ID0gZWxlbWVudDtcbiAgICAgIHRoaXMuY3JpdGVyaWEgPSBjcml0ZXJpYTtcbiAgICAgIHRoaXMuaW5WaWV3ID0gZmFsc2U7XG4gICAgICB0aGlzLnN0YXJ0ZWQgPSBmYWxzZTtcbiAgICAgIHRoaXMubm90aWZpY2F0aW9uTGV2ZWxzID0gWzAsMC4xLDAuMiwwLjMsMC40LDAuNSwwLjYsMC43LDAuOCwwLjksMV07XG4gICAgICBpZih0aGlzLm5vdGlmaWNhdGlvbkxldmVscy5pbmRleE9mKHRoaXMuY3JpdGVyaWEuaW5WaWV3VGhyZXNob2xkKSA9PT0gLTEpIHtcbiAgICAgICAgdGhpcy5ub3RpZmljYXRpb25MZXZlbHMucHVzaCh0aGlzLmNyaXRlcmlhLmluVmlld1RocmVzaG9sZCk7XG4gICAgICB9XG4gICAgfVxuICAgIGVsc2UgaWYoIWVsZW1lbnQpIHtcbiAgICAgIHRocm93ICdlbGVtZW50IG5vdCBwcm92aWRlZCc7XG4gICAgfSBcbiAgfVxuXG4gIC8qKlxuICAgKiBzdGFydHMgbWVhc3VyaW5nIHRoZSBzcGVjaWZpZWQgZWxlbWVudCBmb3Igdmlld2FiaWxpdHlcbiAgICogQG92ZXJyaWRlXG4gICAqL1xuICBzdGFydCgpIHtcbiAgICB0aGlzLm9ic2VydmVyID0gbmV3IHdpbmRvdy5JbnRlcnNlY3Rpb25PYnNlcnZlcih0aGlzLnZpZXdhYmxlQ2hhbmdlLmJpbmQodGhpcykseyB0aHJlc2hvbGQ6IHRoaXMubm90aWZpY2F0aW9uTGV2ZWxzIH0pO1xuICAgIHRoaXMub2JzZXJ2ZXIub2JzZXJ2ZSh0aGlzLmVsZW1lbnQpO1xuICB9XG5cbiAgLyoqXG4gICAqIHN0b3BzIG1lYXN1cmluZyB0aGUgc3BlY2lmaWVkIGVsZW1lbnQgZm9yIHZpZXdhYmlsaXR5XG4gICAqIEBvdmVycmlkZVxuICAgKi9cbiAgZGlzcG9zZSgpIHtcbiAgICBpZih0aGlzLm9ic2VydmVyKSB7XG4gICAgICB0aGlzLm9ic2VydmVyLnVub2JzZXJ2ZShlbGVtZW50KTtcbiAgICAgIHRoaXMub2JzZXJ2ZXIuZGlzY29ubmVjdChlbGVtZW50KTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQG92ZXJyaWRlXG4gICAqIEByZXR1cm4ge0Jvb2xlYW59IGRldGVybWluZXMgaWYgdGhlIHRlY2huaXF1ZSBpcyBjYXBhYmxlIG9mIG1lYXN1cmluZyBpbiB0aGUgY3VycmVudCBlbnZpcm9ubWVudFxuICAgKi9cbiAgZ2V0IHVubWVhc3VyZWFibGUoKSB7XG4gICAgcmV0dXJuICghd2luZG93LkludGVyc2VjdGlvbk9ic2VydmVyIHx8IHRoaXMudXNlc1BvbHlmaWxsICkgfHwgIXZhbGlkRWxlbWVudCh0aGlzLmVsZW1lbnQpO1xuICB9XG5cbiAgLyoqXG4gICAqIEBvdmVycmlkZVxuICAgKiBAcmV0dXJuIHtCb29sZWFufSByZXBvcnRzIHdoZXRoZXIgdGhlIGVsZW1lbnQgaXMgaW4gdmlldyBhY2NvcmRpbmcgdG8gdGhlIEludGVyc2VjdGlvbk9ic2VydmVyIG1lYXN1cmVtZW50IHRlY2huaXF1ZVxuICAgKi9cbiAgZ2V0IHZpZXdhYmxlKCkge1xuICAgIHJldHVybiB0aGlzLmluVmlldztcbiAgfVxuXG4gIC8qKlxuICAgKiBAb3ZlcnJpZGVcbiAgICogQHJldHVybiB7U3RyaW5nfSByZXBvcnRzIG1lYXN1cmVtZW50IHRlY2huaXF1ZSBuYW1lXG4gICAqL1xuICBnZXQgdGVjaG5pcXVlTmFtZSgpIHtcbiAgICByZXR1cm4gJ0ludGVyc2VjdGlvbk9ic2VydmVyJztcbiAgfVxuXG4gIC8qKlxuICAgKiBAcmV0dXJuIHtCb29sZWFufSAtIHJlcG9ydHMgd2hldGhlciBtZWFzdXJlbWVudCB0ZWNobmlxdWUgaXMgdXNpbmcgdGhlIG5hdGl2ZSBJbnRlcnNlY3Rpb25PYnNlcnZlciBBUEkgb3IgdGhlIHBvbHlmaWxsIGJ1bmRsZWQgd2l0aCB0aGUgbGlicmFyeS5cbiAgICogUG9seWZpbGwgdXNhZ2UgaXMgaW5mZXJlZCBieSBjaGVja2luZyBpZiB0aGUgSW50ZXJzZWN0aW9uT2JzZXJ2ZXIgQVBJIGhhcyBhIFRIUk9UVExFX1RJTUVPVVQgbWVtbWJlclxuICAgKiBPbmx5IHRoZSBwb2x5ZmlsbCBzaG91bGQgaGF2ZSB0aGF0IG1lbWJlciBpbiBpdCdzIEFQSVxuICAgKi9cbiAgZ2V0IHVzZXNQb2x5ZmlsbCgpIHtcbiAgICByZXR1cm4gdHlwZW9mIHdpbmRvdy5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuVEhST1RUTEVfVElNRU9VVCA9PT0gJ251bWJlcic7XG4gIH1cblxuICAvKipcbiAgICogY2FsbGJhY2sgZnVuY3Rpb24gZm9yIEludGVyc2VjdGlvbk9ic2VydmVyIGNoYW5nZSBldmVudHNcbiAgICogQHBhcmFtICB7QXJyYXl9IGVudHJpZXMgLSBjaGFuZ2UgZW50cmllc1xuICAgKi9cbiAgdmlld2FibGVDaGFuZ2UoZW50cmllcykge1xuICAgIGlmKGVudHJpZXMgJiYgZW50cmllcy5sZW5ndGggJiYgZW50cmllc1swXS5pbnRlcnNlY3Rpb25SYXRpbyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLnBlcmNlbnRWaWV3YWJsZSA9IGVudHJpZXNbMF0uaW50ZXJzZWN0aW9uUmF0aW87XG4gICAgICBcbiAgICAgIGlmKGVudHJpZXNbMF0uaW50ZXJzZWN0aW9uUmF0aW8gPCB0aGlzLmNyaXRlcmlhLmluVmlld1RocmVzaG9sZCAmJiB0aGlzLnN0YXJ0ZWQpIHtcbiAgICAgICAgdGhpcy5pblZpZXcgPSBmYWxzZTtcbiAgICAgICAgdGhpcy5saXN0ZW5lcnMub3V0Vmlldy5mb3JFYWNoKCBsID0+IGwoKSApO1xuICAgICAgfVxuICAgICAgaWYoZW50cmllc1swXS5pbnRlcnNlY3Rpb25SYXRpbyA+PSB0aGlzLmNyaXRlcmlhLmluVmlld1RocmVzaG9sZCkge1xuICAgICAgICB0aGlzLnN0YXJ0ZWQgPSB0cnVlO1xuICAgICAgICB0aGlzLmluVmlldyA9IHRydWU7XG4gICAgICAgIHRoaXMubGlzdGVuZXJzLmluVmlldy5mb3JFYWNoKCBsID0+IGwoKSApO1xuICAgICAgfVxuXG4gICAgICB0aGlzLmxpc3RlbmVycy5jaGFuZ2VWaWV3LmZvckVhY2goIGwgPT4gbCgpICk7XG4gICAgfVxuICB9XG5cbn0iLCJpbXBvcnQgSW50ZXJzZWN0aW9uT2JzZXJ2ZXIgZnJvbSAnLi9JbnRlcnNlY3Rpb25PYnNlcnZlcic7XG5pbXBvcnQgUG9seWZpbGwgZnJvbSAnaW50ZXJzZWN0aW9uLW9ic2VydmVyJztcbmltcG9ydCAqIGFzIEVudmlyb25tZW50IGZyb20gJy4uLy4uL0Vudmlyb25tZW50L0Vudmlyb25tZW50JztcblxuLyoqXG4gKiBSZXByZXNlbnRzIGEgbWVhc3VyZW1lbnQgdGVjaG5pcXVlIHRoYXQgdXNlcyB0aGUgSW50ZXJzZWN0aW9uT2JzZXJ2ZXIgQVBJIHBvbHlmaWxsXG4gKiBAZXh0ZW5kcyB7SW50ZXJzZWN0aW9uT2JzZXJ2ZXJ9XG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEludGVyc2VjdGlvbk9ic2VydmVyUG9seWZpbGwgZXh0ZW5kcyBJbnRlcnNlY3Rpb25PYnNlcnZlciB7XG4gIC8qKlxuICAgKiBkZXRlcm1pbmVzIHdoZXRoZXIgdGhlIG1lYXN1cmVtZW50IHRlY2huaXF1ZSBpcyBjYXBhYmxlIG9mIG1lYXN1cmluZyBnaXZlbiB0aGUgY3VycmVudCBlbnZpcm9ubWVudFxuICAgKiBAb3ZlcnJpZGVcbiAgICogQHJldHVybiB7Qm9vbGVhbn1cbiAgICovXG4gIGdldCB1bm1lYXN1cmVhYmxlKCkge1xuICAgIHJldHVybiBFbnZpcm9ubWVudC5pRnJhbWVDb250ZXh0KCkgPT09IEVudmlyb25tZW50LmlGcmFtZVNlcnZpbmdTY2VuYXJpb3MuQ1JPU1NfRE9NQUlOX0lGUkFNRTtcbiAgfVxuXG4gIC8qKlxuICAgKiBAcmV0dXJuIHtTdHJpbmd9IG5hbWUgb2YgbWVhc3VyZW1lbnQgdGVjaG5pcXVlXG4gICAqL1xuICBnZXQgdGVjaG5pcXVlTmFtZSgpIHtcbiAgICByZXR1cm4gJ0ludGVyc2VjdGlvbk9ic2VydmVyUG9seUZpbGwnO1xuICB9XG59IiwiZXhwb3J0IHsgZGVmYXVsdCBhcyBJbnRlcnNlY3Rpb25PYnNlcnZlciB9IGZyb20gJy4vSW50ZXJzZWN0aW9uT2JzZXJ2ZXInO1xuZXhwb3J0IHsgZGVmYXVsdCBhcyBJbnRlcnNlY3Rpb25PYnNlcnZlclBvbHlmaWxsIH0gZnJvbSAnLi9JbnRlcnNlY3Rpb25PYnNlcnZlclBvbHlmaWxsJztcbmV4cG9ydCB7IGRlZmF1bHQgYXMgQmFzZVRlY2huaXF1ZSB9IGZyb20gJy4vQmFzZVRlY2huaXF1ZSc7IiwiLyoqXG4gKiBTdHJhdGVnaWVzIG1vZHVsZVxuICogQG1vZHVsZSBNZWFzdXJlbWVudC9TdHJhdGVnaWVzXG4gKiByZXByZXNlbnRzIGNvbnN0YW50cyBhbmQgZmFjdG9yaWVzIHJlbGF0ZWQgdG8gbWVhc3VyZW1lbnQgc3RyYXRlZ2llcyBcbiAqL1xuXG5pbXBvcnQgKiBhcyBWYWxpZGF0b3JzIGZyb20gJy4uLy4uL0hlbHBlcnMvVmFsaWRhdG9ycyc7XG5pbXBvcnQgKiBhcyBNZWFzdXJlbWVudFRlY2huaXF1ZXMgZnJvbSAnLi4vTWVhc3VyZW1lbnRUZWNobmlxdWVzLyc7XG5pbXBvcnQgKiBhcyBWaWV3YWJpbGl0eUNyaXRlcmlhIGZyb20gJy4uLy4uL09wdGlvbnMvVmlld2FiaWxpdHlDcml0ZXJpYSc7XG5cbi8qKlxuICogcmVwcmVzZW50cyBkZWZhdWx0IG1lYXN1cmVtZW50IHN0cmF0ZWd5LiBEZWZpbmVzIGF1dG9zdGFydCwgdGVjaG5pcXVlcywgYW5kIG1lYXN1cmVtZW50IGNyaXRlcmlhXG4gKiBAdHlwZSB7T2JqZWN0fVxuICovXG5leHBvcnQgY29uc3QgREVGQVVMVF9TVFJBVEVHWSA9IHtcbiAgYXV0b3N0YXJ0OiB0cnVlLFxuICB0ZWNobmlxdWVzOiBbTWVhc3VyZW1lbnRUZWNobmlxdWVzLkludGVyc2VjdGlvbk9ic2VydmVyLCBNZWFzdXJlbWVudFRlY2huaXF1ZXMuSW50ZXJzZWN0aW9uT2JzZXJ2ZXJQb2x5ZmlsbF0sXG4gIGNyaXRlcmlhOiBWaWV3YWJpbGl0eUNyaXRlcmlhLk1SQ19WSURFT1xufTtcblxuLyoqXG4gKiBDcmVhdGUgc3RyYXRlZ3kgb2JqZWN0IHVzaW5nIHRoZSBwcm92aWRlZCB2YWx1ZXNcbiAqIEBwYXJhbSAge0Jvb2xlYW59IGF1dG9zdGFydCAtIHdoZXRoZXIgbWVhc3VyZW1lbnQgc2hvdWxkIHN0YXJ0IGltbWVkaWF0ZWx5XG4gKiBAcGFyYW0gIHtBcnJheS48QmFzZVRlY2huaXF1ZT59IHRlY2huaXF1ZXMgLSBsaXN0IG9mIHRlY2huaXF1ZXMgdG8gdXNlIGZvciBtZWFzdXJlbWVudC4gRmlyc3Qgbm9uLXVubWVhc3VyZWFibGUgdGVjaG5pcXVlIHdpbGwgYmUgdXNlZFxuICogQHBhcmFtICB7T2JqZWN0fSBjcml0ZXJpYSAtIGNyaXRlcmlhIG9iamVjdC4gU2VlIE9wdGlvbnMvVmlld2FiaWxpdHlDcml0ZXJpYSBmb3IgcHJlLWRlZmluZWQgY3JpdGVyaWEgYW5kIGNyaXRlcmlhIGZhY3RvcnlcbiAqIEByZXR1cm4ge09iamVjdH0gb2JqZWN0IGNvbnRhaW5pbmcgYXBwcm9wcmlhdGVseSBuYW1lZCBwcm9wZXJ0aWVzIHRvIGJlIHVzZWQgYXMgbWVhc3VyZW1lbnQgc3RyYXRlZ3lcbiAqL1xuZXhwb3J0IGNvbnN0IFN0cmF0ZWd5RmFjdG9yeSA9IChhdXRvc3RhcnQgPSBERUZBVUxUX1NUUkFURUdZLmF1dG9zdGFydCwgdGVjaG5pcXVlcyA9IERFRkFVTFRfU1RSQVRFR1kudGVjaG5pcXVlcywgY3JpdGVyaWEgPSBERUZBVUxUX1NUUkFURUdZLmNyaXRlcmlhKSA9PiB7XG4gIGNvbnN0IHN0cmF0ZWd5ID0geyBhdXRvc3RhcnQsIHRlY2huaXF1ZXMsIGNyaXRlcmlhIH0sXG4gICAgICAgIHZhbGlkYXRlZCA9IFZhbGlkYXRvcnMudmFsaWRhdGVTdHJhdGVneShzdHJhdGVneSk7ICBcblxuICBpZih2YWxpZGF0ZWQuaW52YWxpZCkge1xuICAgIHRocm93IHZhbGlkYXRlZC5yZWFzb25zO1xuICB9XG5cbiAgcmV0dXJuIHN0cmF0ZWd5O1xufTsiLCJpbXBvcnQgKiBhcyBFdmVudHMgZnJvbSAnLi9NZWFzdXJlbWVudC9FdmVudHMnO1xuaW1wb3J0IEluVmlld1RpbWVyIGZyb20gJy4vVGltaW5nL0luVmlld1RpbWVyJztcbmltcG9ydCAqIGFzIFN0cmF0ZWdpZXMgZnJvbSAnLi9NZWFzdXJlbWVudC9TdHJhdGVnaWVzLyc7XG5pbXBvcnQgKiBhcyBFbnZpcm9ubWVudCBmcm9tICcuL0Vudmlyb25tZW50L0Vudmlyb25tZW50JztcbmltcG9ydCBNZWFzdXJlbWVudEV4ZWN1dG9yIGZyb20gJy4vTWVhc3VyZW1lbnQvTWVhc3VyZW1lbnRFeGVjdXRvcic7XG5pbXBvcnQgKiBhcyBWaWV3YWJpbGl0eUNyaXRlcmlhIGZyb20gJy4vT3B0aW9ucy9WaWV3YWJpbGl0eUNyaXRlcmlhJztcbmltcG9ydCAqIGFzIE1lYXN1cmVtZW50VGVjaG5pcXVlcyBmcm9tICcuL01lYXN1cmVtZW50L01lYXN1cmVtZW50VGVjaG5pcXVlcy8nO1xuXG4vKiogQ2xhc3MgcmVwcmVzZW50cyB0aGUgbWFpbiBlbnRyeSBwb2ludCB0byB0aGUgT3BlblZWIGxpYnJhcnkgKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIE9wZW5WViB7XG4gIC8qKlxuICAgKiBDcmVhdGUgYSBuZXcgaW5zdGFuY2Ugb2YgT3BlblZWIFxuICAgKi9cbiAgY29uc3RydWN0b3IoKSB7XG4gICAgdGhpcy5leGVjdXRvcnMgPSBbXTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBbGxvd3MgbWVhc3VyZW1lbnQgb2YgYW4gZWxlbWVudCB1c2luZyBhIHN0cmF0ZWd5IGRlZmluaXRpb24gIFxuICAgKiBAcGFyYW0gIHtIVE1MRWxlbWVudH0gZWxlbWVudCAtIHRoZSBlbGVtZW50IHlvdSdkIGxpa2UgbWVhc3VyZSB2aWV3YWJpbGl0eSBvblxuICAgKiBAcGFyYW0gIHtPYmplY3R9IHN0cmF0ZWd5IC0gYW4gb2JqZWN0IHJlcHJlc2VudGluZyB0aGUgc3RyYXRlZ3kgdG8gdXNlIGZvciBtZWFzdXJlbWVudC4gXG4gICAqIFNlZSBPcGVuVlYuU3RyYXRlZ2llcyBmb3IgU3RyYXRlZ3lGYWN0b3J5IGFuZCBERUZBVUxUX1NUUkFURUdZIGZvciBtb3JlIGluZm9ybWF0aW9uLiBcbiAgICogQHJldHVybiB7TWVhc3VyZW1lbnRFeGVjdXRvcn0gcmV0dXJucyBpbnN0YW5jZSBvZiBNZWFzdXJtZW50RXhlY3V0b3IuIFxuICAgKiBUaGlzIGluc3RhbmNlIGV4cG9zZXMgZXZlbnQgbGlzdGVuZXJzIG9uVmlld2FibGVTdGFydCwgb25WaWV3YWJsZVN0b3AsIG9uVmlld2FibGVDaGFuZ2UsIG9uVmlld2FibGVDb21wbGV0ZSwgYW5kIG9uVW5tZWFzdXJlYWJsZVxuICAgKiBBbHNvIGV4cG9zZXMgc3RhcnQgYW5kIGRpc3Bvc2VcbiAgICovXG4gIG1lYXN1cmVFbGVtZW50KGVsZW1lbnQsIHN0cmF0ZWd5KSB7XG4gICAgY29uc3QgZXhlY3V0b3IgPSBuZXcgTWVhc3VyZW1lbnRFeGVjdXRvcihlbGVtZW50LCBzdHJhdGVneSk7XG4gICAgdGhpcy5leGVjdXRvcnMucHVzaChleGVjdXRvcik7XG4gICAgcmV0dXJuIGV4ZWN1dG9yO1xuICB9IFxuXG4gIC8qKlxuICAgKiBkZXN0cm95cyBhbGwgbWVhc3VyZW1lbnQgZXhlY3V0b3JzXG4gICAqL1xuICBkaXNwb3NlKCkge1xuICAgIHRoaXMuZXhlY3V0b3JzLmZvckVhY2goIGUgPT4gZS5kaXNwb3NlKCkgKTtcbiAgfVxufVxuXG4vKipcbiAqIEV4cG9zZXMgYWxsIHB1YmxpYyBjbGFzc2VzIGFuZCBjb25zdGFudHMgYXZhaWxhYmxlIGluIHRoZSBPcGVuVlYgcGFja2FnZVxuICovXG5PcGVuVlYuVmlld2FiaWxpdHlDcml0ZXJpYSA9IFZpZXdhYmlsaXR5Q3JpdGVyaWE7XG5PcGVuVlYuTWVhc3VyZW1lbnRFeGVjdXRvciA9IE1lYXN1cmVtZW50RXhlY3V0b3I7XG5PcGVuVlYuTWVhc3VyZW1lbnRUZWNobmlxdWVzID0gTWVhc3VyZW1lbnRUZWNobmlxdWVzO1xuT3BlblZWLkluVmlld1RpbWVyID0gSW5WaWV3VGltZXI7XG5PcGVuVlYuU3RyYXRlZ2llcyA9IFN0cmF0ZWdpZXM7XG5PcGVuVlYuRXZlbnRzID0gRXZlbnRzOyIsIi8qKlxuICogVmlld2FiaWxpdHkgQ3JpdGVyaWEgbW9kdWxlXG4gKiBAbW9kdWxlIE9wdGlvbnMvVmlld2FiaWxpdHlDcml0ZXJpYVxuICogcmVwcmVzZW50cyBjb25zdGFudHMgYW5kIGZhY3RvcmllcyByZWxhdGVkIHRvIG1lYXN1cmVtZW50IGNyaXRlcmlhIFxuICovXG5cbi8qKlxuICogUmVwcmVzZW50cyBjcml0ZXJpYSBmb3IgTVJDIHZpZXdhYmxlIHZpZGVvIGltcHJlc3Npb25cbiAqIEB0eXBlIHtPYmplY3R9XG4gKi9cbmV4cG9ydCBjb25zdCBNUkNfVklERU8gPSB7XG4gIGluVmlld1RocmVzaG9sZDogMC41LFxuICB0aW1lSW5WaWV3OiAyMDAwXG59O1xuXG4vKipcbiAqIFJlcHJlc2VudHMgY3JpdGVyaWEgZm9yIE1SQyB2aWV3YWJsZSBkaXNwbGF5IGltcHJlc3Npb25cbiAqIEB0eXBlIHtPYmplY3R9XG4gKi9cbmV4cG9ydCBjb25zdCBNUkNfRElTUExBWSA9IHtcbiAgaW5WaWV3VGhyZXNob2xkOiAwLjUsXG4gIHRpbWVJblZpZXc6IDEwMDBcbn07XG5cblxuLyoqXG4gKiBDcmVhdGVzIGN1c3RvbSBjcml0ZXJpYSBvYmplY3QgdXNpbmcgdGhlIHRocmVzaG9sZCBhbmQgZHVyYXRpb24gcHJvdmlkZWQgXG4gKiBAcGFyYW0gIHtOdW1iZXJ9IC0gYW1vdW50IGVsZW1lbnQgbXVzdCBiZSBpbiB2aWV3IGJlZm9yZSBpdCBpcyBjb25zaWRlcmVkIGluIHZpZXdcbiAqIEBwYXJhbSAge051bWJlcn0gLSBob3cgbG9uZyBlbGVtZW50IG11c3QgYmUgaW4gdmlldyBiZWZvcmUgaXQgaXMgY29uc2lkZXJlZCB2aWV3YWJsZVxuICogQHJldHVybiB7T2JqZWN0fSBvYmplY3QgY29udGFpbmluZyBhcHByb3ByaWF0ZWx5IG5hbWVkIHByb3BlcnRpZXMgdG8gYmUgdXNlZCBhcyB2aWV3YWJpbGl0eSBjcml0ZXJpYSBcbiAqL1xuZXhwb3J0IGNvbnN0IGN1c3RvbUNyaXRlcmlhID0gKGluVmlld1RocmVzaG9sZCA9IDAuNSwgdGltZUluVmlldyA9IDIwMDApID0+ICh7IGluVmlld1RocmVzaG9sZCwgdGltZUluVmlldyB9KTsiLCIvKipcbiAqIFJlcHJlc2VudHMgYSB0aW1lciBjbGFzcyB0byBub3RpZnkgYSBsaXN0ZW5lciB3aGVuIGEgc3BlY2lmaWVkIGR1cmF0aW9uIGhhcyBlbGFwc2VkXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEluVmlld1RpbWVyIHtcbiAgLyoqXG4gICAqIENyZWF0ZXMgbmV3IGluc3RhbmNlIG9mIGFuIEluVmlld1RpbWVyXG4gICAqIEBjb25zdHJ1Y3RvclxuICAgKiBAcGFyYW0gIHtOdW1iZXJ9IGR1cmF0aW9uIC0gd2hlbiB0byBmaXJlIGVsYXBzZWQgY2FsbGJhY2tcbiAgICogQHJldHVybiB7SW5WaWV3VGltZXJ9IGluc3RhbmNlIG9mIEluVmlld1RpbWVyXG4gICAqL1xuICBjb25zdHJ1Y3RvcihkdXJhdGlvbikge1xuICAgIHRoaXMuZHVyYXRpb24gPSBkdXJhdGlvbjtcbiAgICB0aGlzLmxpc3RlbmVycyA9IFtdO1xuICAgIHRoaXMuY29tcGxldGVkID0gZmFsc2U7XG4gIH1cblxuICAvKipcbiAgICogbm90aWZpZXMgbGlzdGVuZXJzIHRoYXQgdGltZXIgaGFzIGVsYXBzZWQgZm9yIHRoZSBzcGVjaWZpZWQgZHVyYXRpb25cbiAgICovXG4gIHRpbWVyQ29tcGxldGUoKSB7XG4gICAgdGhpcy5jb21wbGV0ZWQgPSB0cnVlO1xuICAgIHRoaXMubGlzdGVuZXJzLmZvckVhY2goIGwgPT4gbCgpICk7XG4gIH1cblxuICAvKipcbiAgICogYWNjZXB0cyBjYWxsYmFjayBmdW5jdGlvbnMgdG8gY2FsbCB3aGVuIHRoZSB0aW1lciBoYXMgZWxhcHNlZFxuICAgKiBAcGFyYW0gIHtGdW5jdGlvbn0gY2IgLSBjYWxsYmFjayB0byBjYWxsIHdoZW4gdGltZXIgaGFzIGVsYXBzZWRcbiAgICovXG4gIGVsYXBzZWQoY2IpIHtcbiAgICBpZih0eXBlb2YgY2IgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHRoaXMubGlzdGVuZXJzLnB1c2goY2IpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBzdGFydCB0aW1lclxuICAgKi9cbiAgc3RhcnQoKSB7XG4gICAgdGhpcy5lbmRUaW1lcigpO1xuICAgIHRoaXMudGltZXIgPSBzZXRUaW1lb3V0KHRoaXMudGltZXJDb21wbGV0ZS5iaW5kKHRoaXMpLCB0aGlzLmR1cmF0aW9uKTtcbiAgfVxuXG4gIC8qKiBzdG9wIHRpbWVyICovXG4gIHN0b3AoKSB7XG4gICAgdGhpcy5lbmRUaW1lcigpO1xuICB9XG5cbiAgLyoqIGNsZWFycyBzZXRUaW1lb3V0IGFzc29jaWF0ZWQgd2l0aCBjbGFzcyAqL1xuICBlbmRUaW1lcigpIHtcbiAgICBpZih0aGlzLnRpbWVyKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy50aW1lcik7XG4gICAgICB0aGlzLmxpc3RlbmVycy5sZW5ndGggPSAwO1xuICAgIH1cbiAgfVxuXG4gIC8qKiBkZXN0cm95cyB0aW1lciAqL1xuICBkaXNwb3NlKCkge1xuICAgIHRoaXMuZW5kVGltZXIoKTtcbiAgfVxuXG59Il19
