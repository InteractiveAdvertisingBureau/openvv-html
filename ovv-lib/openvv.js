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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvaW50ZXJzZWN0aW9uLW9ic2VydmVyL2ludGVyc2VjdGlvbi1vYnNlcnZlci5qcyIsInNyY1xcRW52aXJvbm1lbnRcXEVudmlyb25tZW50LmpzIiwic3JjXFxIZWxwZXJzXFxWYWxpZGF0b3JzLmpzIiwic3JjXFxNZWFzdXJlbWVudFxcRXZlbnRzLmpzIiwic3JjXFxNZWFzdXJlbWVudFxcTWVhc3VyZW1lbnRFeGVjdXRvci5qcyIsInNyY1xcTWVhc3VyZW1lbnRcXE1lYXN1cmVtZW50VGVjaG5pcXVlc1xcQmFzZVRlY2huaXF1ZS5qcyIsInNyY1xcTWVhc3VyZW1lbnRcXE1lYXN1cmVtZW50VGVjaG5pcXVlc1xcSW50ZXJzZWN0aW9uT2JzZXJ2ZXIuanMiLCJzcmNcXE1lYXN1cmVtZW50XFxNZWFzdXJlbWVudFRlY2huaXF1ZXNcXEludGVyc2VjdGlvbk9ic2VydmVyUG9seWZpbGwuanMiLCJzcmNcXE1lYXN1cmVtZW50XFxNZWFzdXJlbWVudFRlY2huaXF1ZXNcXGluZGV4LmpzIiwic3JjXFxNZWFzdXJlbWVudFxcU3RyYXRlZ2llc1xcaW5kZXguanMiLCJzcmNcXE9wZW5WVi5qcyIsInNyY1xcT3B0aW9uc1xcVmlld2FiaWxpdHlDcml0ZXJpYS5qcyIsInNyY1xcVGltaW5nXFxJblZpZXdUaW1lci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtB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dXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiLyoqXG4gKiBDb3B5cmlnaHQgMjAxNiBHb29nbGUgSW5jLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqIExpY2Vuc2VkIHVuZGVyIHRoZSBBcGFjaGUgTGljZW5zZSwgVmVyc2lvbiAyLjAgKHRoZSBcIkxpY2Vuc2VcIik7XG4gKiB5b3UgbWF5IG5vdCB1c2UgdGhpcyBmaWxlIGV4Y2VwdCBpbiBjb21wbGlhbmNlIHdpdGggdGhlIExpY2Vuc2UuXG4gKiBZb3UgbWF5IG9idGFpbiBhIGNvcHkgb2YgdGhlIExpY2Vuc2UgYXRcbiAqXG4gKiAgICAgaHR0cDovL3d3dy5hcGFjaGUub3JnL2xpY2Vuc2VzL0xJQ0VOU0UtMi4wXG4gKlxuICogVW5sZXNzIHJlcXVpcmVkIGJ5IGFwcGxpY2FibGUgbGF3IG9yIGFncmVlZCB0byBpbiB3cml0aW5nLCBzb2Z0d2FyZVxuICogZGlzdHJpYnV0ZWQgdW5kZXIgdGhlIExpY2Vuc2UgaXMgZGlzdHJpYnV0ZWQgb24gYW4gXCJBUyBJU1wiIEJBU0lTLFxuICogV0lUSE9VVCBXQVJSQU5USUVTIE9SIENPTkRJVElPTlMgT0YgQU5ZIEtJTkQsIGVpdGhlciBleHByZXNzIG9yIGltcGxpZWQuXG4gKiBTZWUgdGhlIExpY2Vuc2UgZm9yIHRoZSBzcGVjaWZpYyBsYW5ndWFnZSBnb3Zlcm5pbmcgcGVybWlzc2lvbnMgYW5kXG4gKiBsaW1pdGF0aW9ucyB1bmRlciB0aGUgTGljZW5zZS5cbiAqL1xuXG4oZnVuY3Rpb24od2luZG93LCBkb2N1bWVudCkge1xuJ3VzZSBzdHJpY3QnO1xuXG5cbi8vIEV4aXRzIGVhcmx5IGlmIGFsbCBJbnRlcnNlY3Rpb25PYnNlcnZlciBhbmQgSW50ZXJzZWN0aW9uT2JzZXJ2ZXJFbnRyeVxuLy8gZmVhdHVyZXMgYXJlIG5hdGl2ZWx5IHN1cHBvcnRlZC5cbmlmICgnSW50ZXJzZWN0aW9uT2JzZXJ2ZXInIGluIHdpbmRvdyAmJlxuICAgICdJbnRlcnNlY3Rpb25PYnNlcnZlckVudHJ5JyBpbiB3aW5kb3cgJiZcbiAgICAnaW50ZXJzZWN0aW9uUmF0aW8nIGluIHdpbmRvdy5JbnRlcnNlY3Rpb25PYnNlcnZlckVudHJ5LnByb3RvdHlwZSkge1xuICByZXR1cm47XG59XG5cblxuLyoqXG4gKiBBbiBJbnRlcnNlY3Rpb25PYnNlcnZlciByZWdpc3RyeS4gVGhpcyByZWdpc3RyeSBleGlzdHMgdG8gaG9sZCBhIHN0cm9uZ1xuICogcmVmZXJlbmNlIHRvIEludGVyc2VjdGlvbk9ic2VydmVyIGluc3RhbmNlcyBjdXJyZW50bHkgb2JzZXJ2ZXJpbmcgYSB0YXJnZXRcbiAqIGVsZW1lbnQuIFdpdGhvdXQgdGhpcyByZWdpc3RyeSwgaW5zdGFuY2VzIHdpdGhvdXQgYW5vdGhlciByZWZlcmVuY2UgbWF5IGJlXG4gKiBnYXJiYWdlIGNvbGxlY3RlZC5cbiAqL1xudmFyIHJlZ2lzdHJ5ID0gW107XG5cblxuLyoqXG4gKiBDcmVhdGVzIHRoZSBnbG9iYWwgSW50ZXJzZWN0aW9uT2JzZXJ2ZXJFbnRyeSBjb25zdHJ1Y3Rvci5cbiAqIGh0dHBzOi8vd2ljZy5naXRodWIuaW8vSW50ZXJzZWN0aW9uT2JzZXJ2ZXIvI2ludGVyc2VjdGlvbi1vYnNlcnZlci1lbnRyeVxuICogQHBhcmFtIHtPYmplY3R9IGVudHJ5IEEgZGljdGlvbmFyeSBvZiBpbnN0YW5jZSBwcm9wZXJ0aWVzLlxuICogQGNvbnN0cnVjdG9yXG4gKi9cbmZ1bmN0aW9uIEludGVyc2VjdGlvbk9ic2VydmVyRW50cnkoZW50cnkpIHtcbiAgdGhpcy50aW1lID0gZW50cnkudGltZTtcbiAgdGhpcy50YXJnZXQgPSBlbnRyeS50YXJnZXQ7XG4gIHRoaXMucm9vdEJvdW5kcyA9IGVudHJ5LnJvb3RCb3VuZHM7XG4gIHRoaXMuYm91bmRpbmdDbGllbnRSZWN0ID0gZW50cnkuYm91bmRpbmdDbGllbnRSZWN0O1xuICB0aGlzLmludGVyc2VjdGlvblJlY3QgPSBlbnRyeS5pbnRlcnNlY3Rpb25SZWN0IHx8IGdldEVtcHR5UmVjdCgpO1xuICB0aGlzLmlzSW50ZXJzZWN0aW5nID0gISFlbnRyeS5pbnRlcnNlY3Rpb25SZWN0O1xuXG4gIC8vIENhbGN1bGF0ZXMgdGhlIGludGVyc2VjdGlvbiByYXRpby5cbiAgdmFyIHRhcmdldFJlY3QgPSB0aGlzLmJvdW5kaW5nQ2xpZW50UmVjdDtcbiAgdmFyIHRhcmdldEFyZWEgPSB0YXJnZXRSZWN0LndpZHRoICogdGFyZ2V0UmVjdC5oZWlnaHQ7XG4gIHZhciBpbnRlcnNlY3Rpb25SZWN0ID0gdGhpcy5pbnRlcnNlY3Rpb25SZWN0O1xuICB2YXIgaW50ZXJzZWN0aW9uQXJlYSA9IGludGVyc2VjdGlvblJlY3Qud2lkdGggKiBpbnRlcnNlY3Rpb25SZWN0LmhlaWdodDtcblxuICAvLyBTZXRzIGludGVyc2VjdGlvbiByYXRpby5cbiAgaWYgKHRhcmdldEFyZWEpIHtcbiAgICB0aGlzLmludGVyc2VjdGlvblJhdGlvID0gaW50ZXJzZWN0aW9uQXJlYSAvIHRhcmdldEFyZWE7XG4gIH0gZWxzZSB7XG4gICAgLy8gSWYgYXJlYSBpcyB6ZXJvIGFuZCBpcyBpbnRlcnNlY3RpbmcsIHNldHMgdG8gMSwgb3RoZXJ3aXNlIHRvIDBcbiAgICB0aGlzLmludGVyc2VjdGlvblJhdGlvID0gdGhpcy5pc0ludGVyc2VjdGluZyA/IDEgOiAwO1xuICB9XG59XG5cblxuLyoqXG4gKiBDcmVhdGVzIHRoZSBnbG9iYWwgSW50ZXJzZWN0aW9uT2JzZXJ2ZXIgY29uc3RydWN0b3IuXG4gKiBodHRwczovL3dpY2cuZ2l0aHViLmlvL0ludGVyc2VjdGlvbk9ic2VydmVyLyNpbnRlcnNlY3Rpb24tb2JzZXJ2ZXItaW50ZXJmYWNlXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBjYWxsYmFjayBUaGUgZnVuY3Rpb24gdG8gYmUgaW52b2tlZCBhZnRlciBpbnRlcnNlY3Rpb25cbiAqICAgICBjaGFuZ2VzIGhhdmUgcXVldWVkLiBUaGUgZnVuY3Rpb24gaXMgbm90IGludm9rZWQgaWYgdGhlIHF1ZXVlIGhhc1xuICogICAgIGJlZW4gZW1wdGllZCBieSBjYWxsaW5nIHRoZSBgdGFrZVJlY29yZHNgIG1ldGhvZC5cbiAqIEBwYXJhbSB7T2JqZWN0PX0gb3B0X29wdGlvbnMgT3B0aW9uYWwgY29uZmlndXJhdGlvbiBvcHRpb25zLlxuICogQGNvbnN0cnVjdG9yXG4gKi9cbmZ1bmN0aW9uIEludGVyc2VjdGlvbk9ic2VydmVyKGNhbGxiYWNrLCBvcHRfb3B0aW9ucykge1xuXG4gIHZhciBvcHRpb25zID0gb3B0X29wdGlvbnMgfHwge307XG5cbiAgaWYgKHR5cGVvZiBjYWxsYmFjayAhPSAnZnVuY3Rpb24nKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdjYWxsYmFjayBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcbiAgfVxuXG4gIGlmIChvcHRpb25zLnJvb3QgJiYgb3B0aW9ucy5yb290Lm5vZGVUeXBlICE9IDEpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3Jvb3QgbXVzdCBiZSBhbiBFbGVtZW50Jyk7XG4gIH1cblxuICAvLyBCaW5kcyBhbmQgdGhyb3R0bGVzIGB0aGlzLl9jaGVja0ZvckludGVyc2VjdGlvbnNgLlxuICB0aGlzLl9jaGVja0ZvckludGVyc2VjdGlvbnMgPSB0aHJvdHRsZShcbiAgICAgIHRoaXMuX2NoZWNrRm9ySW50ZXJzZWN0aW9ucy5iaW5kKHRoaXMpLCB0aGlzLlRIUk9UVExFX1RJTUVPVVQpO1xuXG4gIC8vIFByaXZhdGUgcHJvcGVydGllcy5cbiAgdGhpcy5fY2FsbGJhY2sgPSBjYWxsYmFjaztcbiAgdGhpcy5fb2JzZXJ2YXRpb25UYXJnZXRzID0gW107XG4gIHRoaXMuX3F1ZXVlZEVudHJpZXMgPSBbXTtcbiAgdGhpcy5fcm9vdE1hcmdpblZhbHVlcyA9IHRoaXMuX3BhcnNlUm9vdE1hcmdpbihvcHRpb25zLnJvb3RNYXJnaW4pO1xuXG4gIC8vIFB1YmxpYyBwcm9wZXJ0aWVzLlxuICB0aGlzLnRocmVzaG9sZHMgPSB0aGlzLl9pbml0VGhyZXNob2xkcyhvcHRpb25zLnRocmVzaG9sZCk7XG4gIHRoaXMucm9vdCA9IG9wdGlvbnMucm9vdCB8fCBudWxsO1xuICB0aGlzLnJvb3RNYXJnaW4gPSB0aGlzLl9yb290TWFyZ2luVmFsdWVzLm1hcChmdW5jdGlvbihtYXJnaW4pIHtcbiAgICByZXR1cm4gbWFyZ2luLnZhbHVlICsgbWFyZ2luLnVuaXQ7XG4gIH0pLmpvaW4oJyAnKTtcbn1cblxuXG4vKipcbiAqIFRoZSBtaW5pbXVtIGludGVydmFsIHdpdGhpbiB3aGljaCB0aGUgZG9jdW1lbnQgd2lsbCBiZSBjaGVja2VkIGZvclxuICogaW50ZXJzZWN0aW9uIGNoYW5nZXMuXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5USFJPVFRMRV9USU1FT1VUID0gMTAwO1xuXG5cbi8qKlxuICogVGhlIGZyZXF1ZW5jeSBpbiB3aGljaCB0aGUgcG9seWZpbGwgcG9sbHMgZm9yIGludGVyc2VjdGlvbiBjaGFuZ2VzLlxuICogdGhpcyBjYW4gYmUgdXBkYXRlZCBvbiBhIHBlciBpbnN0YW5jZSBiYXNpcyBhbmQgbXVzdCBiZSBzZXQgcHJpb3IgdG9cbiAqIGNhbGxpbmcgYG9ic2VydmVgIG9uIHRoZSBmaXJzdCB0YXJnZXQuXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5QT0xMX0lOVEVSVkFMID0gbnVsbDtcblxuXG4vKipcbiAqIFN0YXJ0cyBvYnNlcnZpbmcgYSB0YXJnZXQgZWxlbWVudCBmb3IgaW50ZXJzZWN0aW9uIGNoYW5nZXMgYmFzZWQgb25cbiAqIHRoZSB0aHJlc2hvbGRzIHZhbHVlcy5cbiAqIEBwYXJhbSB7RWxlbWVudH0gdGFyZ2V0IFRoZSBET00gZWxlbWVudCB0byBvYnNlcnZlLlxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUub2JzZXJ2ZSA9IGZ1bmN0aW9uKHRhcmdldCkge1xuICAvLyBJZiB0aGUgdGFyZ2V0IGlzIGFscmVhZHkgYmVpbmcgb2JzZXJ2ZWQsIGRvIG5vdGhpbmcuXG4gIGlmICh0aGlzLl9vYnNlcnZhdGlvblRhcmdldHMuc29tZShmdW5jdGlvbihpdGVtKSB7XG4gICAgcmV0dXJuIGl0ZW0uZWxlbWVudCA9PSB0YXJnZXQ7XG4gIH0pKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgaWYgKCEodGFyZ2V0ICYmIHRhcmdldC5ub2RlVHlwZSA9PSAxKSkge1xuICAgIHRocm93IG5ldyBFcnJvcigndGFyZ2V0IG11c3QgYmUgYW4gRWxlbWVudCcpO1xuICB9XG5cbiAgdGhpcy5fcmVnaXN0ZXJJbnN0YW5jZSgpO1xuICB0aGlzLl9vYnNlcnZhdGlvblRhcmdldHMucHVzaCh7ZWxlbWVudDogdGFyZ2V0LCBlbnRyeTogbnVsbH0pO1xuICB0aGlzLl9tb25pdG9ySW50ZXJzZWN0aW9ucygpO1xufTtcblxuXG4vKipcbiAqIFN0b3BzIG9ic2VydmluZyBhIHRhcmdldCBlbGVtZW50IGZvciBpbnRlcnNlY3Rpb24gY2hhbmdlcy5cbiAqIEBwYXJhbSB7RWxlbWVudH0gdGFyZ2V0IFRoZSBET00gZWxlbWVudCB0byBvYnNlcnZlLlxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUudW5vYnNlcnZlID0gZnVuY3Rpb24odGFyZ2V0KSB7XG4gIHRoaXMuX29ic2VydmF0aW9uVGFyZ2V0cyA9XG4gICAgICB0aGlzLl9vYnNlcnZhdGlvblRhcmdldHMuZmlsdGVyKGZ1bmN0aW9uKGl0ZW0pIHtcblxuICAgIHJldHVybiBpdGVtLmVsZW1lbnQgIT0gdGFyZ2V0O1xuICB9KTtcbiAgaWYgKCF0aGlzLl9vYnNlcnZhdGlvblRhcmdldHMubGVuZ3RoKSB7XG4gICAgdGhpcy5fdW5tb25pdG9ySW50ZXJzZWN0aW9ucygpO1xuICAgIHRoaXMuX3VucmVnaXN0ZXJJbnN0YW5jZSgpO1xuICB9XG59O1xuXG5cbi8qKlxuICogU3RvcHMgb2JzZXJ2aW5nIGFsbCB0YXJnZXQgZWxlbWVudHMgZm9yIGludGVyc2VjdGlvbiBjaGFuZ2VzLlxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuZGlzY29ubmVjdCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLl9vYnNlcnZhdGlvblRhcmdldHMgPSBbXTtcbiAgdGhpcy5fdW5tb25pdG9ySW50ZXJzZWN0aW9ucygpO1xuICB0aGlzLl91bnJlZ2lzdGVySW5zdGFuY2UoKTtcbn07XG5cblxuLyoqXG4gKiBSZXR1cm5zIGFueSBxdWV1ZSBlbnRyaWVzIHRoYXQgaGF2ZSBub3QgeWV0IGJlZW4gcmVwb3J0ZWQgdG8gdGhlXG4gKiBjYWxsYmFjayBhbmQgY2xlYXJzIHRoZSBxdWV1ZS4gVGhpcyBjYW4gYmUgdXNlZCBpbiBjb25qdW5jdGlvbiB3aXRoIHRoZVxuICogY2FsbGJhY2sgdG8gb2J0YWluIHRoZSBhYnNvbHV0ZSBtb3N0IHVwLXRvLWRhdGUgaW50ZXJzZWN0aW9uIGluZm9ybWF0aW9uLlxuICogQHJldHVybiB7QXJyYXl9IFRoZSBjdXJyZW50bHkgcXVldWVkIGVudHJpZXMuXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS50YWtlUmVjb3JkcyA9IGZ1bmN0aW9uKCkge1xuICB2YXIgcmVjb3JkcyA9IHRoaXMuX3F1ZXVlZEVudHJpZXMuc2xpY2UoKTtcbiAgdGhpcy5fcXVldWVkRW50cmllcyA9IFtdO1xuICByZXR1cm4gcmVjb3Jkcztcbn07XG5cblxuLyoqXG4gKiBBY2NlcHRzIHRoZSB0aHJlc2hvbGQgdmFsdWUgZnJvbSB0aGUgdXNlciBjb25maWd1cmF0aW9uIG9iamVjdCBhbmRcbiAqIHJldHVybnMgYSBzb3J0ZWQgYXJyYXkgb2YgdW5pcXVlIHRocmVzaG9sZCB2YWx1ZXMuIElmIGEgdmFsdWUgaXMgbm90XG4gKiBiZXR3ZWVuIDAgYW5kIDEgYW5kIGVycm9yIGlzIHRocm93bi5cbiAqIEBwcml2YXRlXG4gKiBAcGFyYW0ge0FycmF5fG51bWJlcj19IG9wdF90aHJlc2hvbGQgQW4gb3B0aW9uYWwgdGhyZXNob2xkIHZhbHVlIG9yXG4gKiAgICAgYSBsaXN0IG9mIHRocmVzaG9sZCB2YWx1ZXMsIGRlZmF1bHRpbmcgdG8gWzBdLlxuICogQHJldHVybiB7QXJyYXl9IEEgc29ydGVkIGxpc3Qgb2YgdW5pcXVlIGFuZCB2YWxpZCB0aHJlc2hvbGQgdmFsdWVzLlxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuX2luaXRUaHJlc2hvbGRzID0gZnVuY3Rpb24ob3B0X3RocmVzaG9sZCkge1xuICB2YXIgdGhyZXNob2xkID0gb3B0X3RocmVzaG9sZCB8fCBbMF07XG4gIGlmICghQXJyYXkuaXNBcnJheSh0aHJlc2hvbGQpKSB0aHJlc2hvbGQgPSBbdGhyZXNob2xkXTtcblxuICByZXR1cm4gdGhyZXNob2xkLnNvcnQoKS5maWx0ZXIoZnVuY3Rpb24odCwgaSwgYSkge1xuICAgIGlmICh0eXBlb2YgdCAhPSAnbnVtYmVyJyB8fCBpc05hTih0KSB8fCB0IDwgMCB8fCB0ID4gMSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCd0aHJlc2hvbGQgbXVzdCBiZSBhIG51bWJlciBiZXR3ZWVuIDAgYW5kIDEgaW5jbHVzaXZlbHknKTtcbiAgICB9XG4gICAgcmV0dXJuIHQgIT09IGFbaSAtIDFdO1xuICB9KTtcbn07XG5cblxuLyoqXG4gKiBBY2NlcHRzIHRoZSByb290TWFyZ2luIHZhbHVlIGZyb20gdGhlIHVzZXIgY29uZmlndXJhdGlvbiBvYmplY3RcbiAqIGFuZCByZXR1cm5zIGFuIGFycmF5IG9mIHRoZSBmb3VyIG1hcmdpbiB2YWx1ZXMgYXMgYW4gb2JqZWN0IGNvbnRhaW5pbmdcbiAqIHRoZSB2YWx1ZSBhbmQgdW5pdCBwcm9wZXJ0aWVzLiBJZiBhbnkgb2YgdGhlIHZhbHVlcyBhcmUgbm90IHByb3Blcmx5XG4gKiBmb3JtYXR0ZWQgb3IgdXNlIGEgdW5pdCBvdGhlciB0aGFuIHB4IG9yICUsIGFuZCBlcnJvciBpcyB0aHJvd24uXG4gKiBAcHJpdmF0ZVxuICogQHBhcmFtIHtzdHJpbmc9fSBvcHRfcm9vdE1hcmdpbiBBbiBvcHRpb25hbCByb290TWFyZ2luIHZhbHVlLFxuICogICAgIGRlZmF1bHRpbmcgdG8gJzBweCcuXG4gKiBAcmV0dXJuIHtBcnJheTxPYmplY3Q+fSBBbiBhcnJheSBvZiBtYXJnaW4gb2JqZWN0cyB3aXRoIHRoZSBrZXlzXG4gKiAgICAgdmFsdWUgYW5kIHVuaXQuXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5fcGFyc2VSb290TWFyZ2luID0gZnVuY3Rpb24ob3B0X3Jvb3RNYXJnaW4pIHtcbiAgdmFyIG1hcmdpblN0cmluZyA9IG9wdF9yb290TWFyZ2luIHx8ICcwcHgnO1xuICB2YXIgbWFyZ2lucyA9IG1hcmdpblN0cmluZy5zcGxpdCgvXFxzKy8pLm1hcChmdW5jdGlvbihtYXJnaW4pIHtcbiAgICB2YXIgcGFydHMgPSAvXigtP1xcZCpcXC4/XFxkKykocHh8JSkkLy5leGVjKG1hcmdpbik7XG4gICAgaWYgKCFwYXJ0cykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdyb290TWFyZ2luIG11c3QgYmUgc3BlY2lmaWVkIGluIHBpeGVscyBvciBwZXJjZW50Jyk7XG4gICAgfVxuICAgIHJldHVybiB7dmFsdWU6IHBhcnNlRmxvYXQocGFydHNbMV0pLCB1bml0OiBwYXJ0c1syXX07XG4gIH0pO1xuXG4gIC8vIEhhbmRsZXMgc2hvcnRoYW5kLlxuICBtYXJnaW5zWzFdID0gbWFyZ2luc1sxXSB8fCBtYXJnaW5zWzBdO1xuICBtYXJnaW5zWzJdID0gbWFyZ2luc1syXSB8fCBtYXJnaW5zWzBdO1xuICBtYXJnaW5zWzNdID0gbWFyZ2luc1szXSB8fCBtYXJnaW5zWzFdO1xuXG4gIHJldHVybiBtYXJnaW5zO1xufTtcblxuXG4vKipcbiAqIFN0YXJ0cyBwb2xsaW5nIGZvciBpbnRlcnNlY3Rpb24gY2hhbmdlcyBpZiB0aGUgcG9sbGluZyBpcyBub3QgYWxyZWFkeVxuICogaGFwcGVuaW5nLCBhbmQgaWYgdGhlIHBhZ2UncyB2aXNpYmlsdHkgc3RhdGUgaXMgdmlzaWJsZS5cbiAqIEBwcml2YXRlXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5fbW9uaXRvckludGVyc2VjdGlvbnMgPSBmdW5jdGlvbigpIHtcbiAgaWYgKCF0aGlzLl9tb25pdG9yaW5nSW50ZXJzZWN0aW9ucykge1xuICAgIHRoaXMuX21vbml0b3JpbmdJbnRlcnNlY3Rpb25zID0gdHJ1ZTtcblxuICAgIHRoaXMuX2NoZWNrRm9ySW50ZXJzZWN0aW9ucygpO1xuXG4gICAgLy8gSWYgYSBwb2xsIGludGVydmFsIGlzIHNldCwgdXNlIHBvbGxpbmcgaW5zdGVhZCBvZiBsaXN0ZW5pbmcgdG9cbiAgICAvLyByZXNpemUgYW5kIHNjcm9sbCBldmVudHMgb3IgRE9NIG11dGF0aW9ucy5cbiAgICBpZiAodGhpcy5QT0xMX0lOVEVSVkFMKSB7XG4gICAgICB0aGlzLl9tb25pdG9yaW5nSW50ZXJ2YWwgPSBzZXRJbnRlcnZhbChcbiAgICAgICAgICB0aGlzLl9jaGVja0ZvckludGVyc2VjdGlvbnMsIHRoaXMuUE9MTF9JTlRFUlZBTCk7XG4gICAgfVxuICAgIGVsc2Uge1xuICAgICAgYWRkRXZlbnQod2luZG93LCAncmVzaXplJywgdGhpcy5fY2hlY2tGb3JJbnRlcnNlY3Rpb25zLCB0cnVlKTtcbiAgICAgIGFkZEV2ZW50KGRvY3VtZW50LCAnc2Nyb2xsJywgdGhpcy5fY2hlY2tGb3JJbnRlcnNlY3Rpb25zLCB0cnVlKTtcblxuICAgICAgaWYgKCdNdXRhdGlvbk9ic2VydmVyJyBpbiB3aW5kb3cpIHtcbiAgICAgICAgdGhpcy5fZG9tT2JzZXJ2ZXIgPSBuZXcgTXV0YXRpb25PYnNlcnZlcih0aGlzLl9jaGVja0ZvckludGVyc2VjdGlvbnMpO1xuICAgICAgICB0aGlzLl9kb21PYnNlcnZlci5vYnNlcnZlKGRvY3VtZW50LCB7XG4gICAgICAgICAgYXR0cmlidXRlczogdHJ1ZSxcbiAgICAgICAgICBjaGlsZExpc3Q6IHRydWUsXG4gICAgICAgICAgY2hhcmFjdGVyRGF0YTogdHJ1ZSxcbiAgICAgICAgICBzdWJ0cmVlOiB0cnVlXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cbiAgfVxufTtcblxuXG4vKipcbiAqIFN0b3BzIHBvbGxpbmcgZm9yIGludGVyc2VjdGlvbiBjaGFuZ2VzLlxuICogQHByaXZhdGVcbiAqL1xuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLl91bm1vbml0b3JJbnRlcnNlY3Rpb25zID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLl9tb25pdG9yaW5nSW50ZXJzZWN0aW9ucykge1xuICAgIHRoaXMuX21vbml0b3JpbmdJbnRlcnNlY3Rpb25zID0gZmFsc2U7XG5cbiAgICBjbGVhckludGVydmFsKHRoaXMuX21vbml0b3JpbmdJbnRlcnZhbCk7XG4gICAgdGhpcy5fbW9uaXRvcmluZ0ludGVydmFsID0gbnVsbDtcblxuICAgIHJlbW92ZUV2ZW50KHdpbmRvdywgJ3Jlc2l6ZScsIHRoaXMuX2NoZWNrRm9ySW50ZXJzZWN0aW9ucywgdHJ1ZSk7XG4gICAgcmVtb3ZlRXZlbnQoZG9jdW1lbnQsICdzY3JvbGwnLCB0aGlzLl9jaGVja0ZvckludGVyc2VjdGlvbnMsIHRydWUpO1xuXG4gICAgaWYgKHRoaXMuX2RvbU9ic2VydmVyKSB7XG4gICAgICB0aGlzLl9kb21PYnNlcnZlci5kaXNjb25uZWN0KCk7XG4gICAgICB0aGlzLl9kb21PYnNlcnZlciA9IG51bGw7XG4gICAgfVxuICB9XG59O1xuXG5cbi8qKlxuICogU2NhbnMgZWFjaCBvYnNlcnZhdGlvbiB0YXJnZXQgZm9yIGludGVyc2VjdGlvbiBjaGFuZ2VzIGFuZCBhZGRzIHRoZW1cbiAqIHRvIHRoZSBpbnRlcm5hbCBlbnRyaWVzIHF1ZXVlLiBJZiBuZXcgZW50cmllcyBhcmUgZm91bmQsIGl0XG4gKiBzY2hlZHVsZXMgdGhlIGNhbGxiYWNrIHRvIGJlIGludm9rZWQuXG4gKiBAcHJpdmF0ZVxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuX2NoZWNrRm9ySW50ZXJzZWN0aW9ucyA9IGZ1bmN0aW9uKCkge1xuICB2YXIgcm9vdElzSW5Eb20gPSB0aGlzLl9yb290SXNJbkRvbSgpO1xuICB2YXIgcm9vdFJlY3QgPSByb290SXNJbkRvbSA/IHRoaXMuX2dldFJvb3RSZWN0KCkgOiBnZXRFbXB0eVJlY3QoKTtcblxuICB0aGlzLl9vYnNlcnZhdGlvblRhcmdldHMuZm9yRWFjaChmdW5jdGlvbihpdGVtKSB7XG4gICAgdmFyIHRhcmdldCA9IGl0ZW0uZWxlbWVudDtcbiAgICB2YXIgdGFyZ2V0UmVjdCA9IGdldEJvdW5kaW5nQ2xpZW50UmVjdCh0YXJnZXQpO1xuICAgIHZhciByb290Q29udGFpbnNUYXJnZXQgPSB0aGlzLl9yb290Q29udGFpbnNUYXJnZXQodGFyZ2V0KTtcbiAgICB2YXIgb2xkRW50cnkgPSBpdGVtLmVudHJ5O1xuICAgIHZhciBpbnRlcnNlY3Rpb25SZWN0ID0gcm9vdElzSW5Eb20gJiYgcm9vdENvbnRhaW5zVGFyZ2V0ICYmXG4gICAgICAgIHRoaXMuX2NvbXB1dGVUYXJnZXRBbmRSb290SW50ZXJzZWN0aW9uKHRhcmdldCwgcm9vdFJlY3QpO1xuXG4gICAgdmFyIG5ld0VudHJ5ID0gaXRlbS5lbnRyeSA9IG5ldyBJbnRlcnNlY3Rpb25PYnNlcnZlckVudHJ5KHtcbiAgICAgIHRpbWU6IG5vdygpLFxuICAgICAgdGFyZ2V0OiB0YXJnZXQsXG4gICAgICBib3VuZGluZ0NsaWVudFJlY3Q6IHRhcmdldFJlY3QsXG4gICAgICByb290Qm91bmRzOiByb290UmVjdCxcbiAgICAgIGludGVyc2VjdGlvblJlY3Q6IGludGVyc2VjdGlvblJlY3RcbiAgICB9KTtcblxuICAgIGlmICghb2xkRW50cnkpIHtcbiAgICAgIHRoaXMuX3F1ZXVlZEVudHJpZXMucHVzaChuZXdFbnRyeSk7XG4gICAgfSBlbHNlIGlmIChyb290SXNJbkRvbSAmJiByb290Q29udGFpbnNUYXJnZXQpIHtcbiAgICAgIC8vIElmIHRoZSBuZXcgZW50cnkgaW50ZXJzZWN0aW9uIHJhdGlvIGhhcyBjcm9zc2VkIGFueSBvZiB0aGVcbiAgICAgIC8vIHRocmVzaG9sZHMsIGFkZCBhIG5ldyBlbnRyeS5cbiAgICAgIGlmICh0aGlzLl9oYXNDcm9zc2VkVGhyZXNob2xkKG9sZEVudHJ5LCBuZXdFbnRyeSkpIHtcbiAgICAgICAgdGhpcy5fcXVldWVkRW50cmllcy5wdXNoKG5ld0VudHJ5KTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgLy8gSWYgdGhlIHJvb3QgaXMgbm90IGluIHRoZSBET00gb3IgdGFyZ2V0IGlzIG5vdCBjb250YWluZWQgd2l0aGluXG4gICAgICAvLyByb290IGJ1dCB0aGUgcHJldmlvdXMgZW50cnkgZm9yIHRoaXMgdGFyZ2V0IGhhZCBhbiBpbnRlcnNlY3Rpb24sXG4gICAgICAvLyBhZGQgYSBuZXcgcmVjb3JkIGluZGljYXRpbmcgcmVtb3ZhbC5cbiAgICAgIGlmIChvbGRFbnRyeSAmJiBvbGRFbnRyeS5pc0ludGVyc2VjdGluZykge1xuICAgICAgICB0aGlzLl9xdWV1ZWRFbnRyaWVzLnB1c2gobmV3RW50cnkpO1xuICAgICAgfVxuICAgIH1cbiAgfSwgdGhpcyk7XG5cbiAgaWYgKHRoaXMuX3F1ZXVlZEVudHJpZXMubGVuZ3RoKSB7XG4gICAgdGhpcy5fY2FsbGJhY2sodGhpcy50YWtlUmVjb3JkcygpLCB0aGlzKTtcbiAgfVxufTtcblxuXG4vKipcbiAqIEFjY2VwdHMgYSB0YXJnZXQgYW5kIHJvb3QgcmVjdCBjb21wdXRlcyB0aGUgaW50ZXJzZWN0aW9uIGJldHdlZW4gdGhlblxuICogZm9sbG93aW5nIHRoZSBhbGdvcml0aG0gaW4gdGhlIHNwZWMuXG4gKiBUT0RPKHBoaWxpcHdhbHRvbik6IGF0IHRoaXMgdGltZSBjbGlwLXBhdGggaXMgbm90IGNvbnNpZGVyZWQuXG4gKiBodHRwczovL3dpY2cuZ2l0aHViLmlvL0ludGVyc2VjdGlvbk9ic2VydmVyLyNjYWxjdWxhdGUtaW50ZXJzZWN0aW9uLXJlY3QtYWxnb1xuICogQHBhcmFtIHtFbGVtZW50fSB0YXJnZXQgVGhlIHRhcmdldCBET00gZWxlbWVudFxuICogQHBhcmFtIHtPYmplY3R9IHJvb3RSZWN0IFRoZSBib3VuZGluZyByZWN0IG9mIHRoZSByb290IGFmdGVyIGJlaW5nXG4gKiAgICAgZXhwYW5kZWQgYnkgdGhlIHJvb3RNYXJnaW4gdmFsdWUuXG4gKiBAcmV0dXJuIHs/T2JqZWN0fSBUaGUgZmluYWwgaW50ZXJzZWN0aW9uIHJlY3Qgb2JqZWN0IG9yIHVuZGVmaW5lZCBpZiBub1xuICogICAgIGludGVyc2VjdGlvbiBpcyBmb3VuZC5cbiAqIEBwcml2YXRlXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5fY29tcHV0ZVRhcmdldEFuZFJvb3RJbnRlcnNlY3Rpb24gPVxuICAgIGZ1bmN0aW9uKHRhcmdldCwgcm9vdFJlY3QpIHtcblxuICAvLyBJZiB0aGUgZWxlbWVudCBpc24ndCBkaXNwbGF5ZWQsIGFuIGludGVyc2VjdGlvbiBjYW4ndCBoYXBwZW4uXG4gIGlmICh3aW5kb3cuZ2V0Q29tcHV0ZWRTdHlsZSh0YXJnZXQpLmRpc3BsYXkgPT0gJ25vbmUnKSByZXR1cm47XG5cbiAgdmFyIHRhcmdldFJlY3QgPSBnZXRCb3VuZGluZ0NsaWVudFJlY3QodGFyZ2V0KTtcbiAgdmFyIGludGVyc2VjdGlvblJlY3QgPSB0YXJnZXRSZWN0O1xuICB2YXIgcGFyZW50ID0gZ2V0UGFyZW50Tm9kZSh0YXJnZXQpO1xuICB2YXIgYXRSb290ID0gZmFsc2U7XG5cbiAgd2hpbGUgKCFhdFJvb3QpIHtcbiAgICB2YXIgcGFyZW50UmVjdCA9IG51bGw7XG4gICAgdmFyIHBhcmVudENvbXB1dGVkU3R5bGUgPSBwYXJlbnQubm9kZVR5cGUgPT0gMSA/XG4gICAgICAgIHdpbmRvdy5nZXRDb21wdXRlZFN0eWxlKHBhcmVudCkgOiB7fTtcblxuICAgIC8vIElmIHRoZSBwYXJlbnQgaXNuJ3QgZGlzcGxheWVkLCBhbiBpbnRlcnNlY3Rpb24gY2FuJ3QgaGFwcGVuLlxuICAgIGlmIChwYXJlbnRDb21wdXRlZFN0eWxlLmRpc3BsYXkgPT0gJ25vbmUnKSByZXR1cm47XG5cbiAgICBpZiAocGFyZW50ID09IHRoaXMucm9vdCB8fCBwYXJlbnQgPT0gZG9jdW1lbnQpIHtcbiAgICAgIGF0Um9vdCA9IHRydWU7XG4gICAgICBwYXJlbnRSZWN0ID0gcm9vdFJlY3Q7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIElmIHRoZSBlbGVtZW50IGhhcyBhIG5vbi12aXNpYmxlIG92ZXJmbG93LCBhbmQgaXQncyBub3QgdGhlIDxib2R5PlxuICAgICAgLy8gb3IgPGh0bWw+IGVsZW1lbnQsIHVwZGF0ZSB0aGUgaW50ZXJzZWN0aW9uIHJlY3QuXG4gICAgICAvLyBOb3RlOiA8Ym9keT4gYW5kIDxodG1sPiBjYW5ub3QgYmUgY2xpcHBlZCB0byBhIHJlY3QgdGhhdCdzIG5vdCBhbHNvXG4gICAgICAvLyB0aGUgZG9jdW1lbnQgcmVjdCwgc28gbm8gbmVlZCB0byBjb21wdXRlIGEgbmV3IGludGVyc2VjdGlvbi5cbiAgICAgIGlmIChwYXJlbnQgIT0gZG9jdW1lbnQuYm9keSAmJlxuICAgICAgICAgIHBhcmVudCAhPSBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQgJiZcbiAgICAgICAgICBwYXJlbnRDb21wdXRlZFN0eWxlLm92ZXJmbG93ICE9ICd2aXNpYmxlJykge1xuICAgICAgICBwYXJlbnRSZWN0ID0gZ2V0Qm91bmRpbmdDbGllbnRSZWN0KHBhcmVudCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gSWYgZWl0aGVyIG9mIHRoZSBhYm92ZSBjb25kaXRpb25hbHMgc2V0IGEgbmV3IHBhcmVudFJlY3QsXG4gICAgLy8gY2FsY3VsYXRlIG5ldyBpbnRlcnNlY3Rpb24gZGF0YS5cbiAgICBpZiAocGFyZW50UmVjdCkge1xuICAgICAgaW50ZXJzZWN0aW9uUmVjdCA9IGNvbXB1dGVSZWN0SW50ZXJzZWN0aW9uKHBhcmVudFJlY3QsIGludGVyc2VjdGlvblJlY3QpO1xuXG4gICAgICBpZiAoIWludGVyc2VjdGlvblJlY3QpIGJyZWFrO1xuICAgIH1cbiAgICBwYXJlbnQgPSBnZXRQYXJlbnROb2RlKHBhcmVudCk7XG4gIH1cbiAgcmV0dXJuIGludGVyc2VjdGlvblJlY3Q7XG59O1xuXG5cbi8qKlxuICogUmV0dXJucyB0aGUgcm9vdCByZWN0IGFmdGVyIGJlaW5nIGV4cGFuZGVkIGJ5IHRoZSByb290TWFyZ2luIHZhbHVlLlxuICogQHJldHVybiB7T2JqZWN0fSBUaGUgZXhwYW5kZWQgcm9vdCByZWN0LlxuICogQHByaXZhdGVcbiAqL1xuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLl9nZXRSb290UmVjdCA9IGZ1bmN0aW9uKCkge1xuICB2YXIgcm9vdFJlY3Q7XG4gIGlmICh0aGlzLnJvb3QpIHtcbiAgICByb290UmVjdCA9IGdldEJvdW5kaW5nQ2xpZW50UmVjdCh0aGlzLnJvb3QpO1xuICB9IGVsc2Uge1xuICAgIC8vIFVzZSA8aHRtbD4vPGJvZHk+IGluc3RlYWQgb2Ygd2luZG93IHNpbmNlIHNjcm9sbCBiYXJzIGFmZmVjdCBzaXplLlxuICAgIHZhciBodG1sID0gZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50O1xuICAgIHZhciBib2R5ID0gZG9jdW1lbnQuYm9keTtcbiAgICByb290UmVjdCA9IHtcbiAgICAgIHRvcDogMCxcbiAgICAgIGxlZnQ6IDAsXG4gICAgICByaWdodDogaHRtbC5jbGllbnRXaWR0aCB8fCBib2R5LmNsaWVudFdpZHRoLFxuICAgICAgd2lkdGg6IGh0bWwuY2xpZW50V2lkdGggfHwgYm9keS5jbGllbnRXaWR0aCxcbiAgICAgIGJvdHRvbTogaHRtbC5jbGllbnRIZWlnaHQgfHwgYm9keS5jbGllbnRIZWlnaHQsXG4gICAgICBoZWlnaHQ6IGh0bWwuY2xpZW50SGVpZ2h0IHx8IGJvZHkuY2xpZW50SGVpZ2h0XG4gICAgfTtcbiAgfVxuICByZXR1cm4gdGhpcy5fZXhwYW5kUmVjdEJ5Um9vdE1hcmdpbihyb290UmVjdCk7XG59O1xuXG5cbi8qKlxuICogQWNjZXB0cyBhIHJlY3QgYW5kIGV4cGFuZHMgaXQgYnkgdGhlIHJvb3RNYXJnaW4gdmFsdWUuXG4gKiBAcGFyYW0ge09iamVjdH0gcmVjdCBUaGUgcmVjdCBvYmplY3QgdG8gZXhwYW5kLlxuICogQHJldHVybiB7T2JqZWN0fSBUaGUgZXhwYW5kZWQgcmVjdC5cbiAqIEBwcml2YXRlXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5fZXhwYW5kUmVjdEJ5Um9vdE1hcmdpbiA9IGZ1bmN0aW9uKHJlY3QpIHtcbiAgdmFyIG1hcmdpbnMgPSB0aGlzLl9yb290TWFyZ2luVmFsdWVzLm1hcChmdW5jdGlvbihtYXJnaW4sIGkpIHtcbiAgICByZXR1cm4gbWFyZ2luLnVuaXQgPT0gJ3B4JyA/IG1hcmdpbi52YWx1ZSA6XG4gICAgICAgIG1hcmdpbi52YWx1ZSAqIChpICUgMiA/IHJlY3Qud2lkdGggOiByZWN0LmhlaWdodCkgLyAxMDA7XG4gIH0pO1xuICB2YXIgbmV3UmVjdCA9IHtcbiAgICB0b3A6IHJlY3QudG9wIC0gbWFyZ2luc1swXSxcbiAgICByaWdodDogcmVjdC5yaWdodCArIG1hcmdpbnNbMV0sXG4gICAgYm90dG9tOiByZWN0LmJvdHRvbSArIG1hcmdpbnNbMl0sXG4gICAgbGVmdDogcmVjdC5sZWZ0IC0gbWFyZ2luc1szXVxuICB9O1xuICBuZXdSZWN0LndpZHRoID0gbmV3UmVjdC5yaWdodCAtIG5ld1JlY3QubGVmdDtcbiAgbmV3UmVjdC5oZWlnaHQgPSBuZXdSZWN0LmJvdHRvbSAtIG5ld1JlY3QudG9wO1xuXG4gIHJldHVybiBuZXdSZWN0O1xufTtcblxuXG4vKipcbiAqIEFjY2VwdHMgYW4gb2xkIGFuZCBuZXcgZW50cnkgYW5kIHJldHVybnMgdHJ1ZSBpZiBhdCBsZWFzdCBvbmUgb2YgdGhlXG4gKiB0aHJlc2hvbGQgdmFsdWVzIGhhcyBiZWVuIGNyb3NzZWQuXG4gKiBAcGFyYW0gez9JbnRlcnNlY3Rpb25PYnNlcnZlckVudHJ5fSBvbGRFbnRyeSBUaGUgcHJldmlvdXMgZW50cnkgZm9yIGFcbiAqICAgIHBhcnRpY3VsYXIgdGFyZ2V0IGVsZW1lbnQgb3IgbnVsbCBpZiBubyBwcmV2aW91cyBlbnRyeSBleGlzdHMuXG4gKiBAcGFyYW0ge0ludGVyc2VjdGlvbk9ic2VydmVyRW50cnl9IG5ld0VudHJ5IFRoZSBjdXJyZW50IGVudHJ5IGZvciBhXG4gKiAgICBwYXJ0aWN1bGFyIHRhcmdldCBlbGVtZW50LlxuICogQHJldHVybiB7Ym9vbGVhbn0gUmV0dXJucyB0cnVlIGlmIGEgYW55IHRocmVzaG9sZCBoYXMgYmVlbiBjcm9zc2VkLlxuICogQHByaXZhdGVcbiAqL1xuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLl9oYXNDcm9zc2VkVGhyZXNob2xkID1cbiAgICBmdW5jdGlvbihvbGRFbnRyeSwgbmV3RW50cnkpIHtcblxuICAvLyBUbyBtYWtlIGNvbXBhcmluZyBlYXNpZXIsIGFuIGVudHJ5IHRoYXQgaGFzIGEgcmF0aW8gb2YgMFxuICAvLyBidXQgZG9lcyBub3QgYWN0dWFsbHkgaW50ZXJzZWN0IGlzIGdpdmVuIGEgdmFsdWUgb2YgLTFcbiAgdmFyIG9sZFJhdGlvID0gb2xkRW50cnkgJiYgb2xkRW50cnkuaXNJbnRlcnNlY3RpbmcgP1xuICAgICAgb2xkRW50cnkuaW50ZXJzZWN0aW9uUmF0aW8gfHwgMCA6IC0xO1xuICB2YXIgbmV3UmF0aW8gPSBuZXdFbnRyeS5pc0ludGVyc2VjdGluZyA/XG4gICAgICBuZXdFbnRyeS5pbnRlcnNlY3Rpb25SYXRpbyB8fCAwIDogLTE7XG5cbiAgLy8gSWdub3JlIHVuY2hhbmdlZCByYXRpb3NcbiAgaWYgKG9sZFJhdGlvID09PSBuZXdSYXRpbykgcmV0dXJuO1xuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy50aHJlc2hvbGRzLmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIHRocmVzaG9sZCA9IHRoaXMudGhyZXNob2xkc1tpXTtcblxuICAgIC8vIFJldHVybiB0cnVlIGlmIGFuIGVudHJ5IG1hdGNoZXMgYSB0aHJlc2hvbGQgb3IgaWYgdGhlIG5ldyByYXRpb1xuICAgIC8vIGFuZCB0aGUgb2xkIHJhdGlvIGFyZSBvbiB0aGUgb3Bwb3NpdGUgc2lkZXMgb2YgYSB0aHJlc2hvbGQuXG4gICAgaWYgKHRocmVzaG9sZCA9PSBvbGRSYXRpbyB8fCB0aHJlc2hvbGQgPT0gbmV3UmF0aW8gfHxcbiAgICAgICAgdGhyZXNob2xkIDwgb2xkUmF0aW8gIT09IHRocmVzaG9sZCA8IG5ld1JhdGlvKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gIH1cbn07XG5cblxuLyoqXG4gKiBSZXR1cm5zIHdoZXRoZXIgb3Igbm90IHRoZSByb290IGVsZW1lbnQgaXMgYW4gZWxlbWVudCBhbmQgaXMgaW4gdGhlIERPTS5cbiAqIEByZXR1cm4ge2Jvb2xlYW59IFRydWUgaWYgdGhlIHJvb3QgZWxlbWVudCBpcyBhbiBlbGVtZW50IGFuZCBpcyBpbiB0aGUgRE9NLlxuICogQHByaXZhdGVcbiAqL1xuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLl9yb290SXNJbkRvbSA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gIXRoaXMucm9vdCB8fCBjb250YWluc0RlZXAoZG9jdW1lbnQsIHRoaXMucm9vdCk7XG59O1xuXG5cbi8qKlxuICogUmV0dXJucyB3aGV0aGVyIG9yIG5vdCB0aGUgdGFyZ2V0IGVsZW1lbnQgaXMgYSBjaGlsZCBvZiByb290LlxuICogQHBhcmFtIHtFbGVtZW50fSB0YXJnZXQgVGhlIHRhcmdldCBlbGVtZW50IHRvIGNoZWNrLlxuICogQHJldHVybiB7Ym9vbGVhbn0gVHJ1ZSBpZiB0aGUgdGFyZ2V0IGVsZW1lbnQgaXMgYSBjaGlsZCBvZiByb290LlxuICogQHByaXZhdGVcbiAqL1xuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLl9yb290Q29udGFpbnNUYXJnZXQgPSBmdW5jdGlvbih0YXJnZXQpIHtcbiAgcmV0dXJuIGNvbnRhaW5zRGVlcCh0aGlzLnJvb3QgfHwgZG9jdW1lbnQsIHRhcmdldCk7XG59O1xuXG5cbi8qKlxuICogQWRkcyB0aGUgaW5zdGFuY2UgdG8gdGhlIGdsb2JhbCBJbnRlcnNlY3Rpb25PYnNlcnZlciByZWdpc3RyeSBpZiBpdCBpc24ndFxuICogYWxyZWFkeSBwcmVzZW50LlxuICogQHByaXZhdGVcbiAqL1xuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLl9yZWdpc3Rlckluc3RhbmNlID0gZnVuY3Rpb24oKSB7XG4gIGlmIChyZWdpc3RyeS5pbmRleE9mKHRoaXMpIDwgMCkge1xuICAgIHJlZ2lzdHJ5LnB1c2godGhpcyk7XG4gIH1cbn07XG5cblxuLyoqXG4gKiBSZW1vdmVzIHRoZSBpbnN0YW5jZSBmcm9tIHRoZSBnbG9iYWwgSW50ZXJzZWN0aW9uT2JzZXJ2ZXIgcmVnaXN0cnkuXG4gKiBAcHJpdmF0ZVxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuX3VucmVnaXN0ZXJJbnN0YW5jZSA9IGZ1bmN0aW9uKCkge1xuICB2YXIgaW5kZXggPSByZWdpc3RyeS5pbmRleE9mKHRoaXMpO1xuICBpZiAoaW5kZXggIT0gLTEpIHJlZ2lzdHJ5LnNwbGljZShpbmRleCwgMSk7XG59O1xuXG5cbi8qKlxuICogUmV0dXJucyB0aGUgcmVzdWx0IG9mIHRoZSBwZXJmb3JtYW5jZS5ub3coKSBtZXRob2Qgb3IgbnVsbCBpbiBicm93c2Vyc1xuICogdGhhdCBkb24ndCBzdXBwb3J0IHRoZSBBUEkuXG4gKiBAcmV0dXJuIHtudW1iZXJ9IFRoZSBlbGFwc2VkIHRpbWUgc2luY2UgdGhlIHBhZ2Ugd2FzIHJlcXVlc3RlZC5cbiAqL1xuZnVuY3Rpb24gbm93KCkge1xuICByZXR1cm4gd2luZG93LnBlcmZvcm1hbmNlICYmIHBlcmZvcm1hbmNlLm5vdyAmJiBwZXJmb3JtYW5jZS5ub3coKTtcbn1cblxuXG4vKipcbiAqIFRocm90dGxlcyBhIGZ1bmN0aW9uIGFuZCBkZWxheXMgaXRzIGV4ZWN1dGlvbmcsIHNvIGl0J3Mgb25seSBjYWxsZWQgYXQgbW9zdFxuICogb25jZSB3aXRoaW4gYSBnaXZlbiB0aW1lIHBlcmlvZC5cbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZuIFRoZSBmdW5jdGlvbiB0byB0aHJvdHRsZS5cbiAqIEBwYXJhbSB7bnVtYmVyfSB0aW1lb3V0IFRoZSBhbW91bnQgb2YgdGltZSB0aGF0IG11c3QgcGFzcyBiZWZvcmUgdGhlXG4gKiAgICAgZnVuY3Rpb24gY2FuIGJlIGNhbGxlZCBhZ2Fpbi5cbiAqIEByZXR1cm4ge0Z1bmN0aW9ufSBUaGUgdGhyb3R0bGVkIGZ1bmN0aW9uLlxuICovXG5mdW5jdGlvbiB0aHJvdHRsZShmbiwgdGltZW91dCkge1xuICB2YXIgdGltZXIgPSBudWxsO1xuICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgIGlmICghdGltZXIpIHtcbiAgICAgIHRpbWVyID0gc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgICAgZm4oKTtcbiAgICAgICAgdGltZXIgPSBudWxsO1xuICAgICAgfSwgdGltZW91dCk7XG4gICAgfVxuICB9O1xufVxuXG5cbi8qKlxuICogQWRkcyBhbiBldmVudCBoYW5kbGVyIHRvIGEgRE9NIG5vZGUgZW5zdXJpbmcgY3Jvc3MtYnJvd3NlciBjb21wYXRpYmlsaXR5LlxuICogQHBhcmFtIHtOb2RlfSBub2RlIFRoZSBET00gbm9kZSB0byBhZGQgdGhlIGV2ZW50IGhhbmRsZXIgdG8uXG4gKiBAcGFyYW0ge3N0cmluZ30gZXZlbnQgVGhlIGV2ZW50IG5hbWUuXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmbiBUaGUgZXZlbnQgaGFuZGxlciB0byBhZGQuXG4gKiBAcGFyYW0ge2Jvb2xlYW59IG9wdF91c2VDYXB0dXJlIE9wdGlvbmFsbHkgYWRkcyB0aGUgZXZlbiB0byB0aGUgY2FwdHVyZVxuICogICAgIHBoYXNlLiBOb3RlOiB0aGlzIG9ubHkgd29ya3MgaW4gbW9kZXJuIGJyb3dzZXJzLlxuICovXG5mdW5jdGlvbiBhZGRFdmVudChub2RlLCBldmVudCwgZm4sIG9wdF91c2VDYXB0dXJlKSB7XG4gIGlmICh0eXBlb2Ygbm9kZS5hZGRFdmVudExpc3RlbmVyID09ICdmdW5jdGlvbicpIHtcbiAgICBub2RlLmFkZEV2ZW50TGlzdGVuZXIoZXZlbnQsIGZuLCBvcHRfdXNlQ2FwdHVyZSB8fCBmYWxzZSk7XG4gIH1cbiAgZWxzZSBpZiAodHlwZW9mIG5vZGUuYXR0YWNoRXZlbnQgPT0gJ2Z1bmN0aW9uJykge1xuICAgIG5vZGUuYXR0YWNoRXZlbnQoJ29uJyArIGV2ZW50LCBmbik7XG4gIH1cbn1cblxuXG4vKipcbiAqIFJlbW92ZXMgYSBwcmV2aW91c2x5IGFkZGVkIGV2ZW50IGhhbmRsZXIgZnJvbSBhIERPTSBub2RlLlxuICogQHBhcmFtIHtOb2RlfSBub2RlIFRoZSBET00gbm9kZSB0byByZW1vdmUgdGhlIGV2ZW50IGhhbmRsZXIgZnJvbS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBldmVudCBUaGUgZXZlbnQgbmFtZS5cbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZuIFRoZSBldmVudCBoYW5kbGVyIHRvIHJlbW92ZS5cbiAqIEBwYXJhbSB7Ym9vbGVhbn0gb3B0X3VzZUNhcHR1cmUgSWYgdGhlIGV2ZW50IGhhbmRsZXIgd2FzIGFkZGVkIHdpdGggdGhpc1xuICogICAgIGZsYWcgc2V0IHRvIHRydWUsIGl0IHNob3VsZCBiZSBzZXQgdG8gdHJ1ZSBoZXJlIGluIG9yZGVyIHRvIHJlbW92ZSBpdC5cbiAqL1xuZnVuY3Rpb24gcmVtb3ZlRXZlbnQobm9kZSwgZXZlbnQsIGZuLCBvcHRfdXNlQ2FwdHVyZSkge1xuICBpZiAodHlwZW9mIG5vZGUucmVtb3ZlRXZlbnRMaXN0ZW5lciA9PSAnZnVuY3Rpb24nKSB7XG4gICAgbm9kZS5yZW1vdmVFdmVudExpc3RlbmVyKGV2ZW50LCBmbiwgb3B0X3VzZUNhcHR1cmUgfHwgZmFsc2UpO1xuICB9XG4gIGVsc2UgaWYgKHR5cGVvZiBub2RlLmRldGF0Y2hFdmVudCA9PSAnZnVuY3Rpb24nKSB7XG4gICAgbm9kZS5kZXRhdGNoRXZlbnQoJ29uJyArIGV2ZW50LCBmbik7XG4gIH1cbn1cblxuXG4vKipcbiAqIFJldHVybnMgdGhlIGludGVyc2VjdGlvbiBiZXR3ZWVuIHR3byByZWN0IG9iamVjdHMuXG4gKiBAcGFyYW0ge09iamVjdH0gcmVjdDEgVGhlIGZpcnN0IHJlY3QuXG4gKiBAcGFyYW0ge09iamVjdH0gcmVjdDIgVGhlIHNlY29uZCByZWN0LlxuICogQHJldHVybiB7P09iamVjdH0gVGhlIGludGVyc2VjdGlvbiByZWN0IG9yIHVuZGVmaW5lZCBpZiBubyBpbnRlcnNlY3Rpb25cbiAqICAgICBpcyBmb3VuZC5cbiAqL1xuZnVuY3Rpb24gY29tcHV0ZVJlY3RJbnRlcnNlY3Rpb24ocmVjdDEsIHJlY3QyKSB7XG4gIHZhciB0b3AgPSBNYXRoLm1heChyZWN0MS50b3AsIHJlY3QyLnRvcCk7XG4gIHZhciBib3R0b20gPSBNYXRoLm1pbihyZWN0MS5ib3R0b20sIHJlY3QyLmJvdHRvbSk7XG4gIHZhciBsZWZ0ID0gTWF0aC5tYXgocmVjdDEubGVmdCwgcmVjdDIubGVmdCk7XG4gIHZhciByaWdodCA9IE1hdGgubWluKHJlY3QxLnJpZ2h0LCByZWN0Mi5yaWdodCk7XG4gIHZhciB3aWR0aCA9IHJpZ2h0IC0gbGVmdDtcbiAgdmFyIGhlaWdodCA9IGJvdHRvbSAtIHRvcDtcblxuICByZXR1cm4gKHdpZHRoID49IDAgJiYgaGVpZ2h0ID49IDApICYmIHtcbiAgICB0b3A6IHRvcCxcbiAgICBib3R0b206IGJvdHRvbSxcbiAgICBsZWZ0OiBsZWZ0LFxuICAgIHJpZ2h0OiByaWdodCxcbiAgICB3aWR0aDogd2lkdGgsXG4gICAgaGVpZ2h0OiBoZWlnaHRcbiAgfTtcbn1cblxuXG4vKipcbiAqIFNoaW1zIHRoZSBuYXRpdmUgZ2V0Qm91bmRpbmdDbGllbnRSZWN0IGZvciBjb21wYXRpYmlsaXR5IHdpdGggb2xkZXIgSUUuXG4gKiBAcGFyYW0ge0VsZW1lbnR9IGVsIFRoZSBlbGVtZW50IHdob3NlIGJvdW5kaW5nIHJlY3QgdG8gZ2V0LlxuICogQHJldHVybiB7T2JqZWN0fSBUaGUgKHBvc3NpYmx5IHNoaW1tZWQpIHJlY3Qgb2YgdGhlIGVsZW1lbnQuXG4gKi9cbmZ1bmN0aW9uIGdldEJvdW5kaW5nQ2xpZW50UmVjdChlbCkge1xuICB2YXIgcmVjdDtcblxuICB0cnkge1xuICAgIHJlY3QgPSBlbC5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgLy8gSWdub3JlIFdpbmRvd3MgNyBJRTExIFwiVW5zcGVjaWZpZWQgZXJyb3JcIlxuICAgIC8vIGh0dHBzOi8vZ2l0aHViLmNvbS9XSUNHL0ludGVyc2VjdGlvbk9ic2VydmVyL3B1bGwvMjA1XG4gIH1cblxuICBpZiAoIXJlY3QpIHJldHVybiBnZXRFbXB0eVJlY3QoKTtcblxuICAvLyBPbGRlciBJRVxuICBpZiAoIShyZWN0LndpZHRoICYmIHJlY3QuaGVpZ2h0KSkge1xuICAgIHJlY3QgPSB7XG4gICAgICB0b3A6IHJlY3QudG9wLFxuICAgICAgcmlnaHQ6IHJlY3QucmlnaHQsXG4gICAgICBib3R0b206IHJlY3QuYm90dG9tLFxuICAgICAgbGVmdDogcmVjdC5sZWZ0LFxuICAgICAgd2lkdGg6IHJlY3QucmlnaHQgLSByZWN0LmxlZnQsXG4gICAgICBoZWlnaHQ6IHJlY3QuYm90dG9tIC0gcmVjdC50b3BcbiAgICB9O1xuICB9XG4gIHJldHVybiByZWN0O1xufVxuXG5cbi8qKlxuICogUmV0dXJucyBhbiBlbXB0eSByZWN0IG9iamVjdC4gQW4gZW1wdHkgcmVjdCBpcyByZXR1cm5lZCB3aGVuIGFuIGVsZW1lbnRcbiAqIGlzIG5vdCBpbiB0aGUgRE9NLlxuICogQHJldHVybiB7T2JqZWN0fSBUaGUgZW1wdHkgcmVjdC5cbiAqL1xuZnVuY3Rpb24gZ2V0RW1wdHlSZWN0KCkge1xuICByZXR1cm4ge1xuICAgIHRvcDogMCxcbiAgICBib3R0b206IDAsXG4gICAgbGVmdDogMCxcbiAgICByaWdodDogMCxcbiAgICB3aWR0aDogMCxcbiAgICBoZWlnaHQ6IDBcbiAgfTtcbn1cblxuLyoqXG4gKiBDaGVja3MgdG8gc2VlIGlmIGEgcGFyZW50IGVsZW1lbnQgY29udGFpbnMgYSBjaGlsZCBlbGVtbnQgKGluY2x1ZGluZyBpbnNpZGVcbiAqIHNoYWRvdyBET00pLlxuICogQHBhcmFtIHtOb2RlfSBwYXJlbnQgVGhlIHBhcmVudCBlbGVtZW50LlxuICogQHBhcmFtIHtOb2RlfSBjaGlsZCBUaGUgY2hpbGQgZWxlbWVudC5cbiAqIEByZXR1cm4ge2Jvb2xlYW59IFRydWUgaWYgdGhlIHBhcmVudCBub2RlIGNvbnRhaW5zIHRoZSBjaGlsZCBub2RlLlxuICovXG5mdW5jdGlvbiBjb250YWluc0RlZXAocGFyZW50LCBjaGlsZCkge1xuICB2YXIgbm9kZSA9IGNoaWxkO1xuICB3aGlsZSAobm9kZSkge1xuICAgIGlmIChub2RlID09IHBhcmVudCkgcmV0dXJuIHRydWU7XG5cbiAgICBub2RlID0gZ2V0UGFyZW50Tm9kZShub2RlKTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cblxuLyoqXG4gKiBHZXRzIHRoZSBwYXJlbnQgbm9kZSBvZiBhbiBlbGVtZW50IG9yIGl0cyBob3N0IGVsZW1lbnQgaWYgdGhlIHBhcmVudCBub2RlXG4gKiBpcyBhIHNoYWRvdyByb290LlxuICogQHBhcmFtIHtOb2RlfSBub2RlIFRoZSBub2RlIHdob3NlIHBhcmVudCB0byBnZXQuXG4gKiBAcmV0dXJuIHtOb2RlfG51bGx9IFRoZSBwYXJlbnQgbm9kZSBvciBudWxsIGlmIG5vIHBhcmVudCBleGlzdHMuXG4gKi9cbmZ1bmN0aW9uIGdldFBhcmVudE5vZGUobm9kZSkge1xuICB2YXIgcGFyZW50ID0gbm9kZS5wYXJlbnROb2RlO1xuXG4gIGlmIChwYXJlbnQgJiYgcGFyZW50Lm5vZGVUeXBlID09IDExICYmIHBhcmVudC5ob3N0KSB7XG4gICAgLy8gSWYgdGhlIHBhcmVudCBpcyBhIHNoYWRvdyByb290LCByZXR1cm4gdGhlIGhvc3QgZWxlbWVudC5cbiAgICByZXR1cm4gcGFyZW50Lmhvc3Q7XG4gIH1cbiAgcmV0dXJuIHBhcmVudDtcbn1cblxuXG4vLyBFeHBvc2VzIHRoZSBjb25zdHJ1Y3RvcnMgZ2xvYmFsbHkuXG53aW5kb3cuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIgPSBJbnRlcnNlY3Rpb25PYnNlcnZlcjtcbndpbmRvdy5JbnRlcnNlY3Rpb25PYnNlcnZlckVudHJ5ID0gSW50ZXJzZWN0aW9uT2JzZXJ2ZXJFbnRyeTtcblxufSh3aW5kb3csIGRvY3VtZW50KSk7XG4iLCIvKipcclxuICogRW52aXJvbm1lbnQgTW9kdWxlXHJcbiAqIEBtb2R1bGUgRW52aXJvbm1lbnQvRW52aXJvbm1lbnRcclxuICogcmVwcmVzZW50cyBmdW5jdGlvbnMgdGhhdCBkZXNjcmliZSB0aGUgY3VycmVudCBlbnZpcm9ubWVudCB0aGUgbWVhdXNyZW1lbnQgbGlicmFyeSBpcyBydW5uaW5nIGluXHJcbiAqL1xyXG5cclxuLyoqXHJcbiAqIEBwYXJhbSAge0hUTUxFbGVtZW50fSBlbGVtZW50IC0gYSBIVE1MIGVsZW1lbnQgdG8gZ2V0IHByb3BlcnRpZXMgZnJvbSBcclxuICogQHJldHVybiB7T2JqZWN0fSBhbiBvYmplY3QgZGVzY3JpYmluZyB0aGUgdmFyaW91cyBwZXJ0aXRuZW50IGVudmlyb25tZW50IGRldGFpbHNcclxuICovXHJcbmV4cG9ydCBjb25zdCBnZXREZXRhaWxzID0gKGVsZW1lbnQgPSB7fSkgPT4ge1xyXG4gIHJldHVybiB7XHJcbiAgICB2aWV3cG9ydFdpZHRoOiBNYXRoLm1heChkb2N1bWVudC5ib2R5LmNsaWVudFdpZHRoLCB3aW5kb3cuaW5uZXJXaWR0aCkgfHwgLTEsXHJcbiAgICB2aWV3cG9ydEhlaWdodDogTWF0aC5tYXgoZG9jdW1lbnQuYm9keS5jbGllbnRIZWlnaHQsIHdpbmRvdy5pbm5lckhlaWdodCkgfHwgLTEsXHJcbiAgICBlbGVtZW50V2lkdGg6IGVsZW1lbnQuY2xpZW50V2lkdGggfHwgLTEsXHJcbiAgICBlbGVtZW50SGVpZ2h0OiBlbGVtZW50LmNsaWVudEhlaWdodCB8fCAtMSxcclxuICAgIGlmcmFtZUNvbnRleHQ6IGlGcmFtZUNvbnRleHQoKSxcclxuICAgIGZvY3VzOiBpc0luRm9jdXMoKVxyXG4gIH1cclxufVxyXG5cclxuLyoqXHJcbiAqIEByZXR1cm4ge0Jvb2xlYW59IGRldGVybWluZXMgd2hldGhlciB0aGUgY3VycmVudCBwYWdlIGlzIGluIGZvY3VzXHJcbiAqL1xyXG5leHBvcnQgY29uc3QgaXNJbkZvY3VzID0gKCkgPT4ge1xyXG4gIGlmIChkb2N1bWVudC5oaWRkZW4gIT09ICd1bmRlZmluZWQnKXtcclxuICAgIGlmIChkb2N1bWVudC5oaWRkZW4gPT09IHRydWUpe1xyXG4gICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBpZihpRnJhbWVDb250ZXh0KCkgPT09IGlGcmFtZVNlcnZpbmdTY2VuYXJpb3MuQ1JPU1NfRE9NQUlOX0lGUkFNRSkge1xyXG4gICAgcmV0dXJuIHRydWU7XHJcbiAgfVxyXG5cclxuICBpZih3aW5kb3cuZG9jdW1lbnQuaGFzRm9jdXMpIHtcclxuICAgIHJldHVybiB3aW5kb3cudG9wLmRvY3VtZW50Lmhhc0ZvY3VzKCk7XHJcbiAgfVxyXG5cclxuICByZXR1cm4gdHJ1ZTtcclxufVxyXG5cclxuLyoqXHJcbiAqIEByZXR1cm4ge1N0cmluZ30gcmV0dXJucyB0aGUgY3VycmVudCBpRnJhbWUgc2VydmluZyBjb250ZXh0LiBJdCdzIGVpdGhlciAnb24gcGFnZScsICdzYW1lIGRvbWFpbiBpZnJhbWUnLCBvciAnY3Jvc3MgZG9tYWluIGlmcmFtZSdcclxuICovXHJcbmV4cG9ydCBjb25zdCBpRnJhbWVDb250ZXh0ID0gKCkgPT4ge1xyXG4gIHRyeSB7XHJcbiAgICBpZih3aW5kb3cudG9wID09PSB3aW5kb3cpIHtcclxuICAgICAgcmV0dXJuIGlGcmFtZVNlcnZpbmdTY2VuYXJpb3MuT05fUEFHRVxyXG4gICAgfVxyXG5cclxuICAgIGxldCBjdXJXaW4gPSB3aW5kb3csIGxldmVsID0gMDtcclxuICAgIHdoaWxlKGN1cldpbi5wYXJlbnQgIT09IGN1cldpbiAmJiBsZXZlbCA8IDEwMDApIHtcclxuICAgICAgaWYoY3VyV2luLnBhcmVudC5kb2N1bWVudC5kb21haW4gIT09IGN1cldpbi5kb2N1bWVudC5kb21haW4pIHtcclxuICAgICAgICByZXR1cm4gaUZyYW1lU2VydmluZ1NjZW5hcmlvcy5DUk9TU19ET01BSU5fSUZSQU1FO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjdXJXaW4gPSBjdXJXaW4ucGFyZW50O1xyXG4gICAgfVxyXG4gICAgaUZyYW1lU2VydmluZ1NjZW5hcmlvcy5TQU1FX0RPTUFJTl9JRlJBTUU7XHJcbiAgfVxyXG4gIGNhdGNoKGUpIHtcclxuICAgIHJldHVybiBpRnJhbWVTZXJ2aW5nU2NlbmFyaW9zLkNST1NTX0RPTUFJTl9JRlJBTUVcclxuICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBjb25zdGFudHMgZGVzY3JpYmluZyBkaWZmZXJlbnQgdHlwZXMgb2YgaUZyYW1lIGNvbnRleHRzXHJcbiAqIEB0eXBlIHtPYmplY3R9XHJcbiAqL1xyXG5leHBvcnQgY29uc3QgaUZyYW1lU2VydmluZ1NjZW5hcmlvcyA9IHtcclxuICBPTl9QQUdFOiAnb24gcGFnZScsXHJcbiAgU0FNRV9ET01BSU5fSUZSQU1FOiAnc2FtZSBkb21haW4gaWZyYW1lJyxcclxuICBDUk9TU19ET01BSU5fSUZSQU1FOiAnY3Jvc3MgZG9tYWluIGlmcmFtZSdcclxufSIsImltcG9ydCBCYXNlVGVjaG5pcXVlIGZyb20gJy4uL01lYXN1cmVtZW50L01lYXN1cmVtZW50VGVjaG5pcXVlcy9CYXNlVGVjaG5pcXVlJztcclxuXHJcbi8qKlxyXG4gKiBWYWxpZGF0b3JzIG1vZHVsZVxyXG4gKiBAbW9kdWxlIEhlbHBlcnMvVmFsaWRhdG9yc1xyXG4gKiByZXByZXNlbnRzIGZ1bmN0aW9ucyBmb3IgY2hlY2tpbmcgdGhlIHZhbGlkaXRpeSBvZiBhIGdpdmVuIGlucHV0IHZhbHVlIFxyXG4gKi9cclxuXHJcbi8qKlxyXG4gKiBAcGFyYW0gIHtCYXNlVGVjaG5pcXVlfSB0ZWNobmlxdWUgLSB0ZWNobmlxdWUgdG8gY2hlY2sgZm9yIHZhbGlkaXR5XHJcbiAqIEByZXR1cm4ge0Jvb2xlYW59IGRldGVybWluYXRpb24gb2Ygd2hldGhlciB0aGUgdGVjaG5pcXVlIG1lZXRzIHRoZSBtaW5pbXVtIHN0YW5kYXJkcyBcclxuICogZm9yIG1lYXN1cmluZyB2aWV3YWJpbGl0eSBhY2NvcmRpbmcgdG8gdGhlIGludGVyZmFjZSBkZWZpbmVkIGJ5IEJhc2VUZWNobmlxdWVcclxuICovXHJcbmV4cG9ydCBjb25zdCB2YWxpZFRlY2huaXF1ZSA9ICh0ZWNobmlxdWUpID0+IHtcclxuICBjb25zdCB2YWxpZCA9IFxyXG4gICAgdHlwZW9mIHRlY2huaXF1ZSA9PT0gJ2Z1bmN0aW9uJyAmJlxyXG4gICAgT2JqZWN0XHJcbiAgICAgIC5nZXRPd25Qcm9wZXJ0eU5hbWVzKEJhc2VUZWNobmlxdWUpXHJcbiAgICAgIC5yZWR1Y2UoIChwcm9wLCB2YWxpZCkgPT4gdmFsaWQgJiYgdHlwZW9mIHRlY2huaXF1ZVtwcm9wXSA9PT0gdHlwZW9mIEJhc2VUZWNobmlxdWVbcHJvcF0sIHRydWUpO1xyXG5cclxuICByZXR1cm4gdmFsaWQ7XHJcbn07XHJcblxyXG4vKipcclxuICogQHBhcmFtICB7SFRNTEVsZW1lbnR9IGVsZW1lbnQgLSBlbGVtZW50IHRvIGNoZWNrIGZvciB2YWxpZGl0eVxyXG4gKiBAcmV0dXJuIHtCb29sZWFufSBkZXRlcm1pbmVzIHdoZXRoZXIgZWxlbWVudCBpcyBhbiBhY3R1YWwgSFRNTCBlbGVtZW50IG9yIGEgcHJveHkgZWxlbWVudCAod2hpY2ggbWF5IGJlIHByb3ZpZGVkIGJ5IEdvb2dsZSdzIElNQSBWUEFJRCBob3N0KSBcclxuICovXHJcbmV4cG9ydCBjb25zdCB2YWxpZEVsZW1lbnQgPSAoZWxlbWVudCkgPT4ge1xyXG4gIHJldHVybiBlbGVtZW50ICYmIGVsZW1lbnQudG9TdHJpbmcoKS5pbmRleE9mKCdFbGVtZW50JykgPiAtMTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBAcGFyYW0gIHtPYmplY3R9IG9iaiAtIHZpZXdhYmlsaXR5IGNyaXRlcmlhIHRvIGNoZWNrIGZvciB2YWxpZGFpdHkuIE5vdGUsIHdlJ3JlIHVzaW5nIEVTNiBkZXN0cnVjdHVyaW5nIHRvIHB1bGwgdGhlIHByb3BlcnRpZXMgd2Ugd2FudCB0byB0ZXN0IGZyb20gdGhlIG9iamVjdFxyXG4gKiBAcGFyYW0gIHtOdW1iZXJ9IG9iai5pblZpZXdUaHJlc2hvbGQgLSBhbW91bnQgZWxlbWVudCBtdXN0IGJlIGluIHZpZXcgYnksIHRvIGJlIGNvdW50ZWQgYXMgaW4gdmlld1xyXG4gKiBAcGFyYW0gIHtOdW1iZXJ9IG9iai50aW1lSW5WaWV3IC0gZHVyYXRpb24gZWxlbWVudCBtdXN0IGJlIGluIHZpZXcgZm9yLCB0byBiZSBjb25zaWRlcmVkIHZpZXdhYmxlXHJcbiAqIEByZXR1cm4ge09iamVjdH0gb2JqZWN0IHRoYXQgY29udGFpbnMgYSBwcm9wZXJ0eSBkZXNjcmliaW5nIGlmIHRoZSBjcml0ZXJpYSBtZWV0cyB0aGUgZXhwZWN0ZWQgcmVxdWlyZW1lbnRzIGFuZCBpZiBub3QsIHdoaWNoIGFzc2VydGlvbnMgaXQgZmFpbHNcclxuICovXHJcbmV4cG9ydCBjb25zdCB2YWxpZGF0ZUNyaXRlcmlhID0gKHsgaW5WaWV3VGhyZXNob2xkLCB0aW1lSW5WaWV3IH0pID0+IHtcclxuICBsZXQgaW52YWxpZCA9IGZhbHNlLCByZWFzb25zID0gW107IFxyXG5cclxuICBpZih0eXBlb2YgaW5WaWV3VGhyZXNob2xkICE9PSAnbnVtYmVyJyB8fCBpblZpZXdUaHJlc2hvbGQgPiAxKSB7XHJcbiAgICBpbnZhbGlkID0gdHJ1ZTtcclxuICAgIHJlYXNvbnMucHVzaCgnaW5WaWV3VGhyZXNob2xkIG11c3QgYmUgYSBudW1iZXIgZXF1YWwgdG8gb3IgbGVzcyB0aGFuIDEnKTtcclxuICB9XHJcblxyXG4gIGlmKHR5cGVvZiB0aW1lSW5WaWV3ICE9PSAnbnVtYmVyJyB8fCB0aW1lSW5WaWV3IDwgMCkge1xyXG4gICAgaW52YWxpZCA9IHRydWU7XHJcbiAgICByZWFzb25zLnB1c2goJ3RpbWVJblZpZXcgbXVzdCBiZSBhIG51bWJlciBncmVhdGVyIHRvIG9yIGVxdWFsIDAnKTtcclxuICB9XHJcblxyXG4gIHJldHVybiB7IGludmFsaWQsIHJlYXNvbnM6IHJlYXNvbnMuam9pbignIHwgJykgfTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBAcGFyYW0gIHtPYmplY3R9IG9iaiAtIHN0cmF0ZWd5IG9iamVjdCB0byB0ZXN0IGZvciB2YWxpZGl0eSBcclxuICogQHBhcmFtICB7Qm9vbGVhbn0gb2JqLmF1dG9zdGFydCAtIGNvbmZpZ3VyZXMgd2hldGhlciB2aWV3YWJpbGl0eSBtZWFzdXJlbWVudCBzaG91bGQgYmVnaW4gYXMgc29vbiBhcyB0ZWNobmlxdWUgaXMgY29uZmlndXJlZFxyXG4gKiBAcGFyYW0gIHtBcnJheS48QmFzZVRlY2huaXF1ZT59IG9iai50ZWNobmlxdWVzIC0gbGlzdCBvZiBtZWFzdXJlbWVudCB0ZWNobmlxdWVzIHRvIHVzZVxyXG4gKiBAcGFyYW0gIHtPYmplY3R9IG9iai5jcml0ZXJpYSAtIG1lYXN1cmVtZW50IGNyaXRlcmlhIHRvIHVzZSB0byBkZXRlcm1pbmUgaWYgYW4gZWxlbWVudCBpcyB2aWV3YWJsZVxyXG4gKiBAcmV0dXJuIHtPYmplY3R9IG9iamVjdCBkZXNjcmliaW5nIHdoZXRoZXIgdGhlIHRlc3RlZCBzdHJhdGVneSBpcyBpbnZhbGlkIGFuZCBpZiBzbywgd2hhdCBpcyB0aGUgcmVhc29uIGZvciBiZWluZyBpbnZhbGlkXHJcbiAqL1xyXG5leHBvcnQgY29uc3QgdmFsaWRhdGVTdHJhdGVneSA9ICh7IGF1dG9zdGFydCwgdGVjaG5pcXVlcywgY3JpdGVyaWEgfSkgPT4ge1xyXG4gIGxldCBpbnZhbGlkID0gZmFsc2UsIHJlYXNvbnMgPSBbXTtcclxuXHJcbiAgaWYodHlwZW9mIGF1dG9zdGFydCAhPT0gJ2Jvb2xlYW4nKSB7XHJcbiAgICBpbnZhbGlkID0gdHJ1ZTtcclxuICAgIHJlYXNvbnMucHVzaCgnYXV0b3N0YXJ0IG11c3QgYmUgYm9vbGVhbicpO1xyXG4gIH1cclxuXHJcbiAgaWYoIUFycmF5LmlzQXJyYXkodGVjaG5pcXVlcykgfHwgdGVjaG5pcXVlcy5sZW5ndGggPT09IDApIHtcclxuICAgIGludmFsaWQgPSB0cnVlO1xyXG4gICAgcmVhc29ucy5wdXNoKCd0ZWNobmlxdWVzIG11c3QgYmUgYW4gYXJyYXkgY29udGFpbmluZyBhdGxlYXN0IG9uIG1lYXN1cmVtZW50IHRlY2huaXF1ZXMnKTtcclxuICB9XHJcblxyXG4gIGNvbnN0IHZhbGlkYXRlZCA9IHZhbGlkYXRlQ3JpdGVyaWEoY3JpdGVyaWEpO1xyXG5cclxuICBpZih2YWxpZGF0ZWQuaW52YWxpZCkge1xyXG4gICAgaW52YWxpZCA9IHRydWU7XHJcbiAgICByZWFzb25zLnB1c2godmFsaWRhdGVkLnJlYXNvbnMpO1xyXG4gIH1cclxuXHJcbiAgcmV0dXJuIHsgaW52YWxpZCwgcmVhc29uczogcmVhc29ucy5qb2luKCcgfCAnKSB9O1xyXG59OyIsIi8qKlxyXG4gKiBFdmVudHMgbW9kdWxlXHJcbiAqIEBtb2R1bGUgTWVhc3VyZW1lbnQvRXZlbnRzXHJcbiAqIHJlcHJlc2VudHMgRXZlbnQgY29uc3RhbnRzXHJcbiAqL1xyXG5cclxuLyoqIHJlcHJlc2VudHMgdGhhdCBlbGVtZW50IGlzIGluIHZpZXcgYW5kIG1lYXN1cmVtZW50IGhhcyBzdGFydGVkICovXHJcbmV4cG9ydCBjb25zdCBTVEFSVCA9ICdzdGFydCc7XHJcbi8qKiByZXByZXNlbnRzIGEgdmlld2FibGUgbWVhc3VyZW1lbnQgc3RvcC4gVGhpcyBvY2N1cnMgd2hlbiBtZWFzdXJlbWVudCBoYXMgcHJldmlvdXNseSBzdGFydGVkLCBidXQgdGhlIGVsZW1lbnQgaGFzIGdvbmUgb3V0IG9mIHZpZXcgKi9cclxuZXhwb3J0IGNvbnN0IFNUT1AgPSAnc3RvcCc7XHJcbi8qKiByZXByZXNlbnRzIGEgdmlld2FibGUgY2hhbmdlIGV2ZW50LiBFaXRoZXIgbWVhc3VyZW1lbnQgaGFzIHN0YXJ0ZWQsIHN0b3BwZWQsIG9yIHRoZSBlbGVtZW50J3MgaW4gdmlldyBhbW91bnQgKHZpZXdhYmxlIHBlcmNlbnRhZ2UpIGhhcyBjaGFuZ2VkICovXHJcbmV4cG9ydCBjb25zdCBDSEFOR0UgPSAnY2hhbmdlJztcclxuLyoqIHJlcHJlc2VudHMgdGhhdCB2aWV3YWJpbGl0eSBtZWFzdXJlbWVudCBoYXMgY29tcGxldGVkLiB0aGUgZWxlbWVudCBoYXMgYmVlbiBpbiB2aWV3IGZvciB0aGUgZHVyYXRpb24gc3BlY2lmaWVkIGluIHRoZSBtZWFzdXJlbWVudCBjcml0ZXJpYSAqL1xyXG5leHBvcnQgY29uc3QgQ09NUExFVEUgPSAnY29tcGxldGUnO1xyXG4vKiogcmVwcmVzZW50cyB0aGF0IG5vIGNvbXBhdGlibGUgdGVjaG5pcXVlcyBoYXZlIGJlZW4gZm91bmQgdG8gbWVhc3VyZSB2aWV3YWJpbGl0eSB3aXRoICovXHJcbmV4cG9ydCBjb25zdCBVTk1FQVNVUkVBQkxFID0gJ3VubWVhc3VyZWFibGUnO1xyXG4vKiogaW50ZXJuYWwgcmVwcmVzZW50YXRpb24gb2YgdGhlIHZpZXdhYmxlIHN0YXRlIG9mIHRoZSBlbGVtZW50IGFzIGluIHZpZXcgKi9cclxuZXhwb3J0IGNvbnN0IElOVklFVyA9ICdpbnZpZXcnO1xyXG4vKiogaW50ZXJuYWwgcmVwcmVzZW50YXRpb24gb2YgdGhlIHZpZXdhYmxlIHN0YXRlIG9mIHRoZSBlbGVtZW50IGFzIG91dCBvZiB2aWV3ICovXHJcbmV4cG9ydCBjb25zdCBPVVRWSUVXID0gJ291dHZpZXcnOyAiLCJpbXBvcnQgSW5WaWV3VGltZXIgZnJvbSAnLi4vVGltaW5nL0luVmlld1RpbWVyJztcclxuaW1wb3J0IHsgREVGQVVMVF9TVFJBVEVHWSB9IGZyb20gJy4vU3RyYXRlZ2llcy8nO1xyXG5pbXBvcnQgeyB2YWxpZFRlY2huaXF1ZSwgdmFsaWRhdGVTdHJhdGVneSB9IGZyb20gJy4uL0hlbHBlcnMvVmFsaWRhdG9ycyc7XHJcbmltcG9ydCAqIGFzIEVudmlyb25tZW50IGZyb20gJy4uL0Vudmlyb25tZW50L0Vudmlyb25tZW50JztcclxuaW1wb3J0ICogYXMgRXZlbnRzIGZyb20gJy4vRXZlbnRzJztcclxuXHJcbi8qKlxyXG4gKiBDbGFzcyByZXByZXNlbnRpbmcgYSBtZWFzdXJlbWVudCBleGVjdXRvclxyXG4gKi9cclxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgTWVhc3VyZW1lbnRFeGVjdXRvciB7XHJcbiAgLyoqXHJcbiAgICogQ3JlYXRlIGEgbmV3IGluc3RhbmNlIG9mIGEgTWVhc3VyZW1lbnRFeGVjdXRvclxyXG4gICAqIEBwYXJhbSB7SFRNTEVsZW1lbnR9IGVsZW1lbnQgLSBhIEhUTUwgZWxlbWVudCB0byBtZWFzdXJlXHJcbiAgICogQHBhcmFtIHtPYmplY3R9IHN0cmF0ZWd5IC0gYSBzdHJhdGVneSBvYmplY3QgZGVmaW5pbmcgdGhlIG1lYXN1cmVtZW50IHRlY2huaXF1ZXMgYW5kIHdoYXQgY3JpdGVyaWEgY29uc3RpdHV0ZSBhIHZpZXdhYmxlIHN0YXRlLlxyXG4gICAqIFNlZSBPcGVuVlYuU3RyYXRlZ2llcyBERUZBVUxUX1NUUkFURUdZIGFuZCBTdHJhdGVneUZhY3RvcnkgZm9yIG1vcmUgZGV0YWlscyBvbiByZXF1aXJlZCBwYXJhbXNcclxuICAgKi9cclxuICBjb25zdHJ1Y3RvcihlbGVtZW50LCBzdHJhdGVneSA9IHt9KSB7XHJcbiAgICAvKiogQHByaXZhdGUge09iamVjdH0gZXZlbnQgbGlzdGVuZXIgYXJyYXlzICovXHJcbiAgICB0aGlzLl9saXN0ZW5lcnMgPSB7IHN0YXJ0OiBbXSwgc3RvcDogW10sIGNoYW5nZTogW10sIGNvbXBsZXRlOiBbXSwgdW5tZWFzdXJlYWJsZTogW10gfTtcclxuICAgIC8qKiBAcHJpdmF0ZSB7SFRNTEVsZW1lbnR9IEhUTUwgZWxlbWVudCB0byBtZWFzdXJlICovXHJcbiAgICB0aGlzLl9lbGVtZW50ID0gZWxlbWVudDtcclxuICAgIC8qKiBAcHJpdmF0ZSB7T2JqZWN0fSBtZWFzdXJlbWVudCBzdHJhdGVneSAqL1xyXG4gICAgdGhpcy5fc3RyYXRlZ3kgPSBPYmplY3QuYXNzaWduKHt9LCBERUZBVUxUX1NUUkFURUdZLCBzdHJhdGVneSk7XHJcbiAgICAvKiogQHByaXZhdGUge0Jvb2xlYW59IHRyYWNrcyB3aGV0aGVyIHZpZXdhYmlsaXR5IGNyaXRlcmlhIGhhcyBiZWVuIG1ldCAqL1xyXG4gICAgdGhpcy5fY3JpdGVyaWFNZXQgPSBmYWxzZTtcclxuXHJcbiAgICBjb25zdCB2YWxpZGF0ZWQgPSB2YWxpZGF0ZVN0cmF0ZWd5KHRoaXMuX3N0cmF0ZWd5KTtcclxuXHJcbiAgICBpZih2YWxpZGF0ZWQuaW52YWxpZCkge1xyXG4gICAgICB0aHJvdyB2YWxpZGF0ZWQucmVhc29ucztcclxuICAgIH1cclxuXHJcbiAgICAvKiogQHByaXZhdGUge0Jhc2VUZWNobmlxdWV9IHRlY2huaXF1ZSB0byBtZWFzdXJlIHZpZXdhYmlsaXR5IHdpdGggKi9cclxuICAgIHRoaXMuX3RlY2huaXF1ZSA9IHRoaXMuX3NlbGVjdFRlY2huaXF1ZSh0aGlzLl9zdHJhdGVneS50ZWNobmlxdWVzKTtcclxuICAgIFxyXG4gICAgaWYodGhpcy5fdGVjaG5pcXVlKSB7XHJcbiAgICAgIHRoaXMuX2FkZFN1YnNjcmlwdGlvbnModGhpcy5fdGVjaG5pcXVlKTtcclxuICAgIH0gICBcclxuXHJcbiAgICBpZih0aGlzLnVubWVhc3VyZWFibGUpIHtcclxuICAgICAgLy8gZmlyZSB1bm1lYXN1cmVhYmxlIGFmdGVyIGN1cnJlbnQgSlMgbG9vcCBjb21wbGV0ZXMgXHJcbiAgICAgIC8vIHNvIG9wcG9ydHVuaXR5IGlzIGdpdmVuIGZvciBjb25zdW1lcnMgdG8gcHJvdmlkZSB1bm1lYXN1cmVhYmxlIGNhbGxiYWNrXHJcbiAgICAgIHNldFRpbWVvdXQoICgpID0+IHRoaXMuX3B1Ymxpc2goRXZlbnRzLlVOTUVBU1VSRUFCTEUsIEVudmlyb25tZW50LmdldERldGFpbHModGhpcy5fZWxlbWVudCkpLCAwKTtcclxuICAgIH1cclxuICAgIGVsc2UgaWYodGhpcy5fc3RyYXRlZ3kuYXV0b3N0YXJ0KSB7XHJcbiAgICAgIHRoaXMuX3RlY2huaXF1ZS5zdGFydCgpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqIFxyXG4gICAqIHN0YXJ0cyB2aWV3YWJpbGl0eSBtZWFzdXJtZW50IHVzaW5nIHRoZSBzZWxlY3RlZCB0ZWNobmlxdWVcclxuICAgKiBAcHVibGljXHJcbiAgICovXHJcbiAgc3RhcnQoKSB7XHJcbiAgICB0aGlzLl90ZWNobmlxdWUuc3RhcnQoKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIGRpc3Bvc2UgdGhlIG1lYXN1cm1lbnQgdGVjaG5pcXVlIGFuZCBhbnkgdGltZXJzXHJcbiAgICogQHB1YmxpY1xyXG4gICAqL1xyXG4gIGRpc3Bvc2UoKSB7XHJcbiAgICBpZih0aGlzLl90ZWNobmlxdWUpIHtcclxuICAgICAgdGhpcy5fdGVjaG5pcXVlLmRpc3Bvc2UoKTtcclxuICAgIH1cclxuICAgIGlmKHRoaXMudGltZXIpIHtcclxuICAgICAgdGhpcy50aW1lci5kaXNwb3NlKCk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBIYW5kbGUgdmlld2FiaWxpdHkgdHJhY2tpbmcgc3RhcnRcclxuICAgKiBAcHVibGljXHJcbiAgICogQHBhcmFtICB7dmlld2FibGVDYWxsYmFja30gY2FsbGJhY2sgLSBpcyBjYWxsZWQgd2hlbiB2aWV3YWJpbGl0eSBzdGFydHMgdHJhY2tpbmdcclxuICAgKiBAcmV0dXJuIHtNZWFzdXJtZW50RXhlY3V0b3J9IHJldHVybnMgaW5zdGFuY2Ugb2YgTWVhc3VyZW1lbnRFeGVjdXRvciBhc3NvY2lhdGVkIHdpdGggdGhpcyBjYWxsYmFja1xyXG4gICAqL1xyXG4gIG9uVmlld2FibGVTdGFydChjYWxsYmFjaykge1xyXG4gICAgcmV0dXJuIHRoaXMuX2FkZENhbGxiYWNrKGNhbGxiYWNrLCBFdmVudHMuU1RBUlQpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogSGFuZGxlIHZpZXdhYmlsaXR5IHRyYWNraW5nIHN0b3AuXHJcbiAgICogQHB1YmxpY1xyXG4gICAqIEBwYXJhbSB7dmlld2FibGVDYWxsYmFja30gY2FsbGJhY2sgLSBpcyBjYWxsZWQgd2hlbiB2aWV3YWJpbGl0eSBoYXMgcHJldmlvdXNseSBzdGFydGVkLCBidXQgZWxlbWVudCBpcyBub3cgb3V0IG9mIHZpZXdcclxuICAgKiBAcmV0dXJuIHtNZWFzdXJlbWVudEV4ZWN1dG9yfSByZXR1cm5zIGluc3RhbmNlIG9mIE1lYXN1cmVtZW50RXhlY3V0b3IgYXNzb2NpYXRlZCB3aXRoIHRoaXMgY2FsbGJhY2tcclxuICAgKi9cclxuICBvblZpZXdhYmxlU3RvcChjYWxsYmFjaykge1xyXG4gICAgcmV0dXJuIHRoaXMuX2FkZENhbGxiYWNrKGNhbGxiYWNrLCBFdmVudHMuU1RPUCk7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBIYW5kbGUgdmlld2FiaWxpdHkgY2hhbmdlLlxyXG4gICAqIEBwdWJsaWNcclxuICAgKiBAcGFyYW0gIHt2aWV3YWJsZUNhbGxiYWNrfSBjYWxsYmFjayAtIGNhbGxlZCB3aGVuIHRoZSB2aWV3YWJsZSBwZXJjZW50YWdlIG9mIHRoZSBlbGVtZW50IGhhcyBjaGFuZ2VkXHJcbiAgICogQHJldHVybiB7TWVhc3VyZW1lbnRFeGVjdXRvcn0gcmV0dXJucyBpbnN0YW5jZSBvZiBNZWFzdXJlbWVudEV4ZWN1dG9yIGFzc29jaWF0ZWQgd2l0aCB0aGlzIGNhbGxiYWNrXHJcbiAgICovXHJcbiAgb25WaWV3YWJsZUNoYW5nZShjYWxsYmFjaykge1xyXG4gICAgcmV0dXJuIHRoaXMuX2FkZENhbGxiYWNrKGNhbGxiYWNrLCBFdmVudHMuQ0hBTkdFKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEhhbmRsZSB2aWV3YWJpbGl0eSBjb21wbGV0ZS5cclxuICAgKiBAcHVibGljXHJcbiAgICogQHBhcmFtICB7dmlld2FibGVDYWxsYmFja30gY2FsbGJhY2sgLSBjYWxsZWQgd2hlbiBlbGVtZW50IGhhcyBiZWVuIGluIHZpZXcgZm9yIHRoZSBkdXJhdGlvbiBzcGVjaWZpZWQgaW4gdGhlIG1lYXN1cmVtZW50IHN0cmF0ZWd5IGNvbmZpZ1xyXG4gICAqIEByZXR1cm4ge01lYXN1cmVtZW50RXhlY3V0b3J9IHJldHVybnMgaW5zdGFuY2Ugb2YgTWVhc3VyZW1lbnRFeGVjdXRvciBhc3NvY2lhdGVkIHdpdGggdGhpcyBjYWxsYmFja1xyXG4gICAqL1xyXG4gIG9uVmlld2FibGVDb21wbGV0ZShjYWxsYmFjaykge1xyXG4gICAgdGhpcy5fYWRkQ2FsbGJhY2soY2FsbGJhY2ssIEV2ZW50cy5DT01QTEVURSk7XHJcbiAgICAvLyBpZiB2aWV3YWJsaXR5IGNyaXRlcmlhIGFscmVhZHkgbWV0LCBmaXJlIGNhbGxiYWNrIGltbWVkaWF0ZWx5XHJcbiAgICBpZih0aGlzLmNyaXRlcmlhTWV0KSB7XHJcbiAgICAgIHRoaXMuX3RlY2huaXF1ZUNoYW5nZShFdmVudHMuQ09NUExFVEUsIHRoaXMuX3RlY2huaXF1ZSk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gdGhpcztcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEhhbmRsZSB1bm1lYXN1cmVhYmxlIGV2ZW50XHJcbiAgICogQHB1YmxpY1xyXG4gICAqIEBwYXJhbSAge3ZpZXdhYmxlQ2FsbGJhY2t9IGNhbGxiYWNrIC0gY2FsbGVkIHdoZW4gbm8gc3VpdGFibGUgbWVhc3VyZW1lbnQgdGVjaG5pcXVlcyBhcmUgYXZhaWxhYmxlIGZyb20gdGhlIHRlY2huaXF1ZXMgcHJvdmlkZWRcclxuICAgKiBAcmV0dXJuIHtNZWFzdXJlbWVudEV4ZWN1dG9yfSByZXR1cm5zIGluc3RhbmNlIG9mIE1lYXN1cmVtZW50RXhlY3V0b3IgYXNzb2NpYXRlZCB3aXRoIHRoaXMgY2FsbGJhY2tcclxuICAgKi9cclxuICBvblVubWVhc3VyZWFibGUoY2FsbGJhY2spIHtcclxuICAgIHRoaXMuX2FkZENhbGxiYWNrKGNhbGxiYWNrLCBFdmVudHMuVU5NRUFTVVJFQUJMRSk7XHJcbiAgICAvLyBpZiBleGVjdXRvciBpcyBhbHJlYWR5IHVubWVhc3VyZWFibGUsIGZpcmUgY2FsbGJhY2sgaW1tZWRpYXRlbHlcclxuICAgIGlmKHRoaXMudW5tZWFzdXJlYWJsZSkge1xyXG4gICAgICB0aGlzLl90ZWNobmlxdWVDaGFuZ2UoRXZlbnRzLlVOTUVBU1VSRUFCTEUpXHJcbiAgICB9XHJcbiAgICByZXR1cm4gdGhpcztcclxuICB9XHJcblxyXG4gICAvKipcclxuICAgKiBAY2FsbGJhY2sgdmlld2FibGVDYWxsYmFja1xyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBkZXRhaWxzIC0gZW52aXJvbm1lbnQgYW5kIG1lYXN1cmVtZW50IGRldGFpbHMgb2Ygdmlld2FibGUgZXZlbnRcclxuICAgKiBAcmV0dXJuIHtNZWFzdXJtZW50RXhlY3V0b3J9IHJldHVybnMgaW5zdGFuY2Ugb2YgTWVhc3VyZW1lbnRFeGVjdXRvciBhc3NvY2lhdGVkIHdpdGggdGhpcyBjYWxsYmFja1xyXG4gICAqL1xyXG5cclxuICAvKipcclxuICAgKiBAcmV0dXJuIHtCb29sZWFufSAtIHdoZXRoZXIgTWVhc3VyZW1lbnRFeGVjdXRvciBpbnN0YW5jZSBpcyBjYXBhYmxlIG9mIG1lYXN1cmluZyB2aWV3YWJpbGl0eVxyXG4gICAqL1xyXG4gIGdldCB1bm1lYXN1cmVhYmxlKCkge1xyXG4gICAgcmV0dXJuICF0aGlzLl90ZWNobmlxdWUgfHwgdGhpcy5fdGVjaG5pcXVlLnVubWVhc3VyZWFibGU7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBJbnN0YW50aWF0ZXMgYW5kIGZpbHRlcnMgbGlzdCBvZiBhdmFpbGFibGUgbWVhc3VyZW1lbnQgdGVjaG5xaXVlcyB0byB0aGUgZmlyc3QgdW5tZWFzdXJlYWJsZSB0ZWNobmlxdWVcclxuICAgKiBAcHJpdmF0ZVxyXG4gICAqIEBwYXJhbSAge0FycmF5fSAtIGxpc3Qgb2YgdGVjaG5pcXVlcyBhdmFpbGFibGUgdG8gbWVhc3VyZSB2aWV3YWJpbGl0eSB3aXRoXHJcbiAgICogQHJldHVybiB7QmFzZVRlY2huaXF1ZX0gc2VsZWN0ZWQgdGVjaG5pcXVlXHJcbiAgICovXHJcbiAgX3NlbGVjdFRlY2huaXF1ZSh0ZWNobmlxdWVzKSB7XHJcbiAgICByZXR1cm4gdGVjaG5pcXVlc1xyXG4gICAgICAgICAgICAuZmlsdGVyKHZhbGlkVGVjaG5pcXVlKVxyXG4gICAgICAgICAgICAubWFwKHRoaXMuX2luc3RhbnRpYXRlVGVjaG5pcXVlLmJpbmQodGhpcykpXHJcbiAgICAgICAgICAgIC5maW5kKHRlY2huaXF1ZSA9PiAhdGVjaG5pcXVlLnVubWVhc3VyZWFibGUpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogY3JlYXRlcyBpbnN0YW5jZSBvZiB0ZWNobmlxdWVcclxuICAgKiBAcHJpdmF0ZVxyXG4gICAqIEBwYXJhbSAge0Z1bmN0aW9ufSAtIHRlY2huaXF1ZSBjb25zdHJ1Y3RvclxyXG4gICAqIEByZXR1cm4ge0Jhc2VUZWNobmlxdWV9IGluc3RhbmNlIG9mIHRlY2huaXF1ZSBwcm92aWRlZFxyXG4gICAqL1xyXG4gIF9pbnN0YW50aWF0ZVRlY2huaXF1ZSh0ZWNobmlxdWUpIHtcclxuICAgIHJldHVybiBuZXcgdGVjaG5pcXVlKGVsZW1lbnQsIHRoaXMuX3N0cmF0ZWd5LmNyaXRlcmlhKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIGFkZHMgZXZlbnQgbGlzdGVuZXJzIHRvIHRlY2huaXF1ZSBcclxuICAgKiBAcHJpdmF0ZVxyXG4gICAqIEBwYXJhbSB7QmFzZVRlY2huaXF1ZX0gLSB0ZWNobmlxdWUgdG8gYWRkIGV2ZW50IGxpc3RlbmVycyB0b1xyXG4gICAqL1xyXG4gIF9hZGRTdWJzY3JpcHRpb25zKHRlY2huaXF1ZSkge1xyXG4gICAgaWYodGVjaG5pcXVlKSB7XHJcbiAgICAgIHRlY2huaXF1ZS5vbkluVmlldyh0aGlzLl90ZWNobmlxdWVDaGFuZ2UuYmluZCh0aGlzLCBFdmVudHMuSU5WSUVXLCB0ZWNobmlxdWUpKTtcclxuICAgICAgdGVjaG5pcXVlLm9uQ2hhbmdlVmlldyh0aGlzLl90ZWNobmlxdWVDaGFuZ2UuYmluZCh0aGlzLCBFdmVudHMuQ0hBTkdFLCB0ZWNobmlxdWUpKTtcclxuICAgICAgdGVjaG5pcXVlLm9uT3V0Vmlldyh0aGlzLl90ZWNobmlxdWVDaGFuZ2UuYmluZCh0aGlzLCBFdmVudHMuT1VUVklFVywgdGVjaG5pcXVlKSk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBoYW5kbGVzIHZpZXdhYmxlIGNoYW5nZSBldmVudHMgZnJvbSBhIG1lYXN1cmVtZW50IHRlY2huaXF1ZVxyXG4gICAqIEBwcml2YXRlXHJcbiAgICogQHBhcmFtICB7U3RyaW5nfSAtIGNoYW5nZSB0eXBlLiBTZWUgTWVhc3VyZW1lbnQvRXZlbnRzIG1vZHVsZSBmb3IgbGlzdCBvZiBjaGFuZ2VzXHJcbiAgICogQHBhcmFtICB7T2JqZWN0fSAtIHRlY2huaXF1ZSB0aGF0IHJlcG9ydGVkIGNoYW5nZS4gTWF5IGJlIHVuZGVmaW5lZCBpbiBjYXNlIG9mIHVubWVhc3VyZWFibGUgZXZlbnRcclxuICAgKi9cclxuICBfdGVjaG5pcXVlQ2hhbmdlKGNoYW5nZSwgdGVjaG5pcXVlID0ge30pIHtcclxuICAgIGxldCBldmVudE5hbWU7XHJcbiAgICBjb25zdCBkZXRhaWxzID0gdGhpcy5fYXBwZW5kRW52aXJvbm1lbnQodGVjaG5pcXVlKTtcclxuXHJcbiAgICBzd2l0Y2goY2hhbmdlKSB7XHJcbiAgICAgIGNhc2UgRXZlbnRzLklOVklFVzpcclxuICAgICAgICBpZighdGhpcy5fY3JpdGVyaWFNZXQpe1xyXG4gICAgICAgICAgdGhpcy50aW1lciA9IG5ldyBJblZpZXdUaW1lcih0aGlzLl9zdHJhdGVneS5jcml0ZXJpYS50aW1lSW5WaWV3KTtcclxuICAgICAgICAgIHRoaXMudGltZXIuZWxhcHNlZCh0aGlzLl90aW1lckVsYXBzZWQuYmluZCh0aGlzLCB0ZWNobmlxdWUpKTtcclxuICAgICAgICAgIHRoaXMudGltZXIuc3RhcnQoKTtcclxuICAgICAgICAgIGV2ZW50TmFtZSA9IEV2ZW50cy5TVEFSVDtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgYnJlYWs7XHJcblxyXG4gICAgICBjYXNlIEV2ZW50cy5DSEFOR0U6XHJcbiAgICAgICAgZXZlbnROYW1lID0gY2hhbmdlO1xyXG4gICAgICAgIGJyZWFrO1xyXG5cclxuICAgICAgY2FzZSBFdmVudHMuQ09NUExFVEU6XHJcbiAgICAgICAgaWYoIXRoaXMuX2NyaXRlcmlhTWV0KSB7XHJcbiAgICAgICAgICB0aGlzLl9jcml0ZXJpYU1ldCA9IHRydWU7XHJcbiAgICAgICAgICBldmVudE5hbWUgPSBjaGFuZ2U7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGJyZWFrO1xyXG5cclxuICAgICAgY2FzZSBFdmVudHMuT1VUVklFVzpcclxuICAgICAgICBpZighdGhpcy5fY3JpdGVyaWFNZXQpIHtcclxuICAgICAgICAgIGlmKHRoaXMudGltZXIpIHtcclxuICAgICAgICAgICAgdGhpcy50aW1lci5zdG9wKCk7XHJcbiAgICAgICAgICAgIGRlbGV0ZSB0aGlzLnRpbWVyO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgZXZlbnROYW1lID0gRXZlbnRzLlNUT1A7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGJyZWFrO1xyXG5cclxuICAgICAgY2FzZSBFdmVudHMuVU5NRUFTVVJFQUJMRTogXHJcbiAgICAgICAgZXZlbnROYW1lID0gRXZlbnRzLlVOTUVBU1VSRUFCTEU7XHJcbiAgICB9XHJcblxyXG4gICAgaWYoZXZlbnROYW1lKSB7XHJcbiAgICAgIHRoaXMuX3B1Ymxpc2goZXZlbnROYW1lLCBkZXRhaWxzKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIHB1Ymxpc2hlcyBldmVudHMgdG8gYXZhaWxhYmxlIGxpc3RlbmVyc1xyXG4gICAqIEBwcml2YXRlXHJcbiAgICogQHBhcmFtICB7U3RyaW5nfSAtIGV2ZW50IG5hbWVcclxuICAgKiBAcGFyYW0gIHt9IC0gdmFsdWUgdG8gY2FsbCBjYWxsYmFjayB3aXRoXHJcbiAgICovXHJcbiAgX3B1Ymxpc2goZXZlbnQsIHZhbHVlKSB7XHJcbiAgICBpZihBcnJheS5pc0FycmF5KHRoaXMuX2xpc3RlbmVyc1tldmVudF0pKSB7XHJcbiAgICAgIHRoaXMuX2xpc3RlbmVyc1tldmVudF0uZm9yRWFjaCggbCA9PiBsKHZhbHVlKSApO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogY2FsbGJhY2sgZm9yIHRpbWVyIGVsYXBzZWQgXHJcbiAgICogQHByaXZhdGVcclxuICAgKiBAcGFyYW0gIHtCYXNlVGVjaG5pcXVlfSAtIHRlY2huaXF1ZSB1c2VkIHRvIHBlcmZvcm0gbWVhc3VyZW1lbnRcclxuICAgKi9cclxuICBfdGltZXJFbGFwc2VkKHRlY2huaXF1ZSkge1xyXG4gICAgdGhpcy5fdGVjaG5pcXVlQ2hhbmdlKEV2ZW50cy5DT01QTEVURSwgdGVjaG5pcXVlKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEFzc29jaWF0ZXMgY2FsbGJhY2sgZnVuY3Rpb24gd2l0aCBldmVudCBcclxuICAgKiBAcHJpdmF0ZVxyXG4gICAqIEBwYXJhbSB7RnVuY3Rpb259IC0gY2FsbGJhY2sgZnVuY3Rpb24gdG8gYXNzb2NpYXRlIHdpdGggZXZlbnRcclxuICAgKiBAcGFyYW0ge1N0cmluZ30gZXZlbnQgLSBldmVudCB0byBhc3NvY2lhdGUgY2FsbGJhY2sgZnVuY3Rpb24gd2l0aFxyXG4gICAqIEByZXR1cm4ge01lYXN1cmVtZW50RXhlY3V0b3J9IHJldHVybnMgaW5zdGFuY2Ugb2YgTWVhc3VyZW1lbnRFeGVjdXRvciBhc3NvY2lhdGVkIHdpdGggdGhpcyBjYWxsYmFja1xyXG4gICAqL1xyXG4gIF9hZGRDYWxsYmFjayhjYWxsYmFjaywgZXZlbnQpIHtcclxuICAgIGlmKHRoaXMuX2xpc3RlbmVyc1tldmVudF0gJiYgdHlwZW9mIGNhbGxiYWNrID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgIHRoaXMuX2xpc3RlbmVyc1tldmVudF0ucHVzaChjYWxsYmFjayk7XHJcbiAgICB9XHJcbiAgICBlbHNlIGlmKHR5cGVvZiBjYWxsYmFjayAhPT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgICB0aHJvdyAnQ2FsbGJhY2sgbXVzdCBiZSBhIGZ1bmN0aW9uJztcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gdGhpcztcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIENvbWJpbmVzIGVudmlyb25tZW50IGRldGFpbHMgd2l0aCBtZWFzdXJlbWVudCB0ZWNobmlxdWUgZGV0YWlsc1xyXG4gICAqIEBwcml2YXRlXHJcbiAgICogQHBhcmFtICB7QmFzZVRlY2huaXF1ZX0gLSB0ZWNobmlxdWUgdG8gZ2V0IG1lYXN1cmVtZW50IGRldGFpbHMgZnJvbSBcclxuICAgKiBAcmV0dXJuIHtPYmplY3R9IEVudmlyb25tZW50IGRldGFpbHMgYW5kIG1lYXN1cmVtZW50IGRldGFpbHMgY29tYmluZWRcclxuICAgKi9cclxuICBfYXBwZW5kRW52aXJvbm1lbnQodGVjaG5pcXVlKSB7XHJcbiAgICByZXR1cm4gT2JqZWN0LmFzc2lnbihcclxuICAgICAge30sIFxyXG4gICAgICB7IFxyXG4gICAgICAgIHBlcmNlbnRWaWV3YWJsZTogdHlwZW9mIHRlY2huaXF1ZS5wZXJjZW50Vmlld2FibGUgPT09ICd1bmRlZmluZWQnID8gLTEgOiB0ZWNobmlxdWUucGVyY2VudFZpZXdhYmxlLCBcclxuICAgICAgICB0ZWNobmlxdWU6IHRlY2huaXF1ZS50ZWNobmlxdWVOYW1lIHx8IC0xLCBcclxuICAgICAgICB2aWV3YWJsZTogdHlwZW9mIHRlY2huaXF1ZS52aWV3YWJsZSA9PT0gJ3VuZGVmaW5lZCcgPyAtMSA6IHRlY2huaXF1ZS52aWV3YWJsZSBcclxuICAgICAgfSwgXHJcbiAgICAgIEVudmlyb25tZW50LmdldERldGFpbHModGhpcy5fZWxlbWVudCkgXHJcbiAgICApO1xyXG4gIH1cclxufSIsIi8qKlxyXG4gKiBDbGFzcyByZXByZXNlbnRpbmcgYmFzaWMgZnVuY3Rpb25hbGl0eSBvZiBhIE1lYXN1cmVtZW50IFRlY2huaXF1ZVxyXG4gKiBTb21lIG9mIGl0J3MgbWVtYmVycyBhcmUgaW50ZW5kZWQgdG8gYmUgb3ZlcnJpZGVuIGJ5IGluaGVyaXR0aW5nIGNsYXNzXHJcbiAqL1xyXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBCYXNlVGVjaG5pcXVlIHtcclxuICAvKipcclxuICAgKiBAY29uc3RydWN0b3JcclxuICAgKiBAcmV0dXJuIHtCYXNlVGVjaG5pcXVlfSBpbnN0YW5jZSBvZiBCYXNlVGVjaG5pcXVlXHJcbiAgICovXHJcbiAgY29uc3RydWN0b3IoKSB7XHJcbiAgICB0aGlzLmxpc3RlbmVycyA9IHtcclxuICAgICAgaW5WaWV3OltdLFxyXG4gICAgICBvdXRWaWV3OltdLFxyXG4gICAgICBjaGFuZ2VWaWV3OltdXHJcbiAgICB9O1xyXG5cclxuICAgIHRoaXMucGVyY2VudFZpZXdhYmxlID0gMC4wO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogRGVmaW5lcyBjYWxsYmFjayB0byBjYWxsIHdoZW4gdGVjaG5pcXVlIGRldGVybWluZXMgZWxlbWVudCBpcyBpbiB2aWV3XHJcbiAgICogQHBhcmFtICB7Y2hhbmdlQ2FsbGJhY2t9IC0gY2FsbGJhY2sgdG8gY2FsbCB3aGVuIGVsZW1lbnQgaXMgaW4gdmlld1xyXG4gICAqIEByZXR1cm4ge0Jhc2VUZWNobmlxdWV9IGluc3RhbmNlIG9mIEJhc2VUZWNobmlxdWUgYXNzb2NpYXRlZCB3aXRoIGNhbGxiYWNrLiBDYW4gYmUgdXNlZCB0byBjaGFpbiBjYWxsYmFjayBkZWZpbml0aW9ucy5cclxuICAgKi9cclxuICBvbkluVmlldyhjYikge1xyXG4gICAgcmV0dXJuIHRoaXMuYWRkQ2FsbGJhY2soY2IsJ2luVmlldycpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogRGVmaW5lcyBjYWxsYmFjayB0byBjYWxsIHdoZW4gdGVjaG5pcXVlIGRldGVybWluZXMgZWxlbWVudCB2aWV3YWJpbGl0eSBoYXMgY2hhbmdlZFxyXG4gICAqIEBwYXJhbSAge2NoYW5nZUNhbGxiYWNrfSAtIGNhbGxiYWNrIHRvIGNhbGwgd2hlbiBlbGVtZW50J3Mgdmlld2FiaWxpdHkgaGFzIGNoYW5nZWRcclxuICAgKiBAcmV0dXJuIHtCYXNlVGVjaG5pcXVlfSBpbnN0YW5jZSBvZiBCYXNlVGVjaG5pcXVlIGFzc29jaWF0ZWQgd2l0aCBjYWxsYmFjay4gQ2FuIGJlIHVzZWQgdG8gY2hhaW4gY2FsbGJhY2sgZGVmaW5pdGlvbnMuXHJcbiAgICovXHJcbiAgb25DaGFuZ2VWaWV3KGNiKSB7XHJcbiAgICByZXR1cm4gdGhpcy5hZGRDYWxsYmFjayhjYiwnY2hhbmdlVmlldycpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogRGVmaW5lcyBjYWxsYmFjayB0byBjYWxsIHdoZW4gdGVjaG5pcXVlIGRldGVybWluZXMgZWxlbWVudCBpcyBubyBsb25nZXIgaW4gdmlld1xyXG4gICAqIEBwYXJhbSAge2NoYW5nZUNhbGxiYWNrfSAtIGNhbGxiYWNrIHRvIGNhbGwgd2hlbiBlbGVtZW50IGlzIG5vIGxvbmdlciBpbiB2aWV3XHJcbiAgICogQHJldHVybiB7QmFzZVRlY2huaXF1ZX0gaW5zdGFuY2Ugb2YgQmFzZVRlY2huaXF1ZSBhc3NvY2lhdGVkIHdpdGggY2FsbGJhY2suIENhbiBiZSB1c2VkIHRvIGNoYWluIGNhbGxiYWNrIGRlZmluaXRpb25zLlxyXG4gICAqL1xyXG4gIG9uT3V0VmlldyhjYikge1xyXG4gICAgcmV0dXJuIHRoaXMuYWRkQ2FsbGJhY2soY2IsJ291dFZpZXcnKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEBjYWxsYmFjayBjaGFuZ2VDYWxsYmFja1xyXG4gICAqL1xyXG5cclxuICAvKipcclxuICAgKiBBc3NvY2lhdGUgY2FsbGJhY2sgd2l0aCBuYW1lZCBldmVudFxyXG4gICAqIEBwYXJhbSB7RnVuY3Rpb259IGNhbGxiYWNrIC0gY2FsbGJhY2sgdG8gY2FsbCB3aGVuIGV2ZW50IG9jY3Vyc1xyXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBldmVudCAtIG5hbWUgb2YgZXZlbnQgdG8gYXNzb2NpYXRlIHdpdGggY2FsbGJhY2tcclxuICAgKi9cclxuICBhZGRDYWxsYmFjayhjYWxsYmFjaywgZXZlbnQpIHtcclxuICAgIGlmKHR5cGVvZiBjYWxsYmFjayA9PT0gJ2Z1bmN0aW9uJyAmJiB0aGlzLmxpc3RlbmVyc1tldmVudF0pIHtcclxuICAgICAgdGhpcy5saXN0ZW5lcnNbZXZlbnRdLnB1c2goY2FsbGJhY2spO1xyXG4gICAgfVxyXG4gICAgZWxzZSBpZih0eXBlb2YgY2FsbGJhY2sgIT09ICdmdW5jdGlvbicpIHtcclxuICAgICAgdGhyb3cgJ2NhbGxiYWNrIG11c3QgYmUgZnVuY3Rpb24nO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiB0aGlzO1xyXG4gIH1cclxuXHJcbiAgLyoqIFxyXG4gICAqIGVtcHR5IHN0YXJ0IG1lbWJlci4gc2hvdWxkIGJlIGltcGxlbWVudGVkIGJ5IGluaGVyaXR0aW5nIGNsYXNzXHJcbiAgICovXHJcbiAgc3RhcnQoKSB7fVxyXG5cclxuICAvKipcclxuICAgKiBlbXB0eSBkaXNwb3NlIG1lbWJlci4gc2hvdWxkIGJlIGltcGxlbWVudGVkIGJ5IGluaGVyaXR0aW5nIGNsYXNzXHJcbiAgICovXHJcbiAgZGlzcG9zZSgpIHt9XHJcblxyXG4gIC8qKlxyXG4gICAqIEByZXR1cm4ge0Jvb2xlYW59IGRlZmluZXMgd2hldGhlciB0aGUgdGVjaG5pcXVlIGlzIGNhcGFibGUgb2YgbWVhc3VyaW5nIGluIHRoZSBjdXJyZW50IGVudmlyb25tZW50XHJcbiAgICovXHJcbiAgZ2V0IHVubWVhc3VyZWFibGUoKSB7XHJcbiAgICByZXR1cm4gZmFsc2U7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBAcmV0dXJuIHtCb29sZWFufSBkZWZpbmVzIHdoZXRoZXIgdGhlIHRlY2huaXF1ZSBoYXMgZGV0ZXJtaW5lZCB0aGF0IHRoZSBtZWFzdXJlZCBlbGVtZW50IGlzIGluIHZpZXdcclxuICAgKi9cclxuICBnZXQgdmlld2FibGUoKSB7XHJcbiAgICByZXR1cm4gZmFsc2U7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBAcmV0dXJuIHtTdHJpbmd9IG5hbWUgb2YgdGhlIG1lYXN1cmVtZW50IHRlY2huaXF1ZVxyXG4gICAqL1xyXG4gIGdldCB0ZWNobmlxdWVOYW1lKCkge1xyXG4gICAgcmV0dXJuICdCYXNlVGVjaG5pcXVlJztcclxuICB9XHJcbn0iLCJpbXBvcnQgQmFzZVRlY2huaXF1ZSBmcm9tICcuL0Jhc2VUZWNobmlxdWUnO1xyXG5pbXBvcnQgeyB2YWxpZEVsZW1lbnQgfSBmcm9tICcuLi8uLi9IZWxwZXJzL1ZhbGlkYXRvcnMnO1xyXG5pbXBvcnQgeyBERUZBVUxUX1NUUkFURUdZIH0gZnJvbSAnLi4vU3RyYXRlZ2llcy8nO1xyXG5cclxuLyoqXHJcbiAqIFJlcHJlc2VudHMgYSBtZWFzdXJlbWVudCB0ZWNobmlxdWUgdGhhdCB1c2VzIG5hdGl2ZSBJbnRlcnNlY3Rpb25PYnNlcnZlciBBUElcclxuICogQGV4dGVuZHMge0Jhc2VUZWNobmlxdWV9XHJcbiAqL1xyXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBJbnRlcnNlY3Rpb25PYnNlcnZlciBleHRlbmRzIEJhc2VUZWNobmlxdWUge1xyXG4gIC8qKlxyXG4gICAqIENyZWF0ZXMgaW5zdGFuY2Ugb2YgSW50ZXJzZWN0aW9uT2JzZXJ2ZXIgbWVhc3VyZW1lbnQgdGVjaG5pcXVlXHJcbiAgICogQGNvbnN0cnVjdG9yXHJcbiAgICogQHBhcmFtICB7SFRNTEVsZW1lbnR9IGVsZW1lbnQgLSBlbGVtZW50IHRvIHBlcmZvcm0gdmlld2FiaWxpdHkgbWVhc3VyZW1lbnQgb25cclxuICAgKiBAcGFyYW0gIHtPYmplY3R9IGNyaXRlcmlhIC0gbWVhc3VyZW1lbnQgY3JpdGVyaWEgb2JqZWN0LiBTZWUgT3B0aW9ucy9WaWV3YWJpbGl0eUNyaXRlcmlhIGZvciBtb3JlIGRldGFpbHNcclxuICAgKiBAcmV0dXJuIHtJbnRlcnNlY3Rpb25PYnNlcnZlcn0gaW5zdGFuY2Ugb2YgSW50ZXJzZWN0aW9uT2JzZXJ2ZXIgbWVhc3VyZW1lbnQgdGVjaG5pcXVlXHJcbiAgICovXHJcbiAgY29uc3RydWN0b3IoZWxlbWVudCwgY3JpdGVyaWEgPSBERUZBVUxUX1NUUkFURUdZLmNyaXRlcmlhKSB7XHJcbiAgICBzdXBlcihlbGVtZW50LCBjcml0ZXJpYSk7XHJcbiAgICBpZihjcml0ZXJpYSAhPT0gdW5kZWZpbmVkICYmIGVsZW1lbnQpIHtcclxuICAgICAgdGhpcy5lbGVtZW50ID0gZWxlbWVudDtcclxuICAgICAgdGhpcy5jcml0ZXJpYSA9IGNyaXRlcmlhO1xyXG4gICAgICB0aGlzLmluVmlldyA9IGZhbHNlO1xyXG4gICAgICB0aGlzLnN0YXJ0ZWQgPSBmYWxzZTtcclxuICAgICAgdGhpcy5ub3RpZmljYXRpb25MZXZlbHMgPSBbMCwwLjEsMC4yLDAuMywwLjQsMC41LDAuNiwwLjcsMC44LDAuOSwxXTtcclxuICAgICAgaWYodGhpcy5ub3RpZmljYXRpb25MZXZlbHMuaW5kZXhPZih0aGlzLmNyaXRlcmlhLmluVmlld1RocmVzaG9sZCkgPT09IC0xKSB7XHJcbiAgICAgICAgdGhpcy5ub3RpZmljYXRpb25MZXZlbHMucHVzaCh0aGlzLmNyaXRlcmlhLmluVmlld1RocmVzaG9sZCk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIGVsc2UgaWYoIWVsZW1lbnQpIHtcclxuICAgICAgdGhyb3cgJ2VsZW1lbnQgbm90IHByb3ZpZGVkJztcclxuICAgIH0gXHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBzdGFydHMgbWVhc3VyaW5nIHRoZSBzcGVjaWZpZWQgZWxlbWVudCBmb3Igdmlld2FiaWxpdHlcclxuICAgKiBAb3ZlcnJpZGVcclxuICAgKi9cclxuICBzdGFydCgpIHtcclxuICAgIHRoaXMub2JzZXJ2ZXIgPSBuZXcgd2luZG93LkludGVyc2VjdGlvbk9ic2VydmVyKHRoaXMudmlld2FibGVDaGFuZ2UuYmluZCh0aGlzKSx7IHRocmVzaG9sZDogdGhpcy5ub3RpZmljYXRpb25MZXZlbHMgfSk7XHJcbiAgICB0aGlzLm9ic2VydmVyLm9ic2VydmUodGhpcy5lbGVtZW50KTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIHN0b3BzIG1lYXN1cmluZyB0aGUgc3BlY2lmaWVkIGVsZW1lbnQgZm9yIHZpZXdhYmlsaXR5XHJcbiAgICogQG92ZXJyaWRlXHJcbiAgICovXHJcbiAgZGlzcG9zZSgpIHtcclxuICAgIGlmKHRoaXMub2JzZXJ2ZXIpIHtcclxuICAgICAgdGhpcy5vYnNlcnZlci51bm9ic2VydmUoZWxlbWVudCk7XHJcbiAgICAgIHRoaXMub2JzZXJ2ZXIuZGlzY29ubmVjdChlbGVtZW50KTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEBvdmVycmlkZVxyXG4gICAqIEByZXR1cm4ge0Jvb2xlYW59IGRldGVybWluZXMgaWYgdGhlIHRlY2huaXF1ZSBpcyBjYXBhYmxlIG9mIG1lYXN1cmluZyBpbiB0aGUgY3VycmVudCBlbnZpcm9ubWVudFxyXG4gICAqL1xyXG4gIGdldCB1bm1lYXN1cmVhYmxlKCkge1xyXG4gICAgcmV0dXJuICghd2luZG93LkludGVyc2VjdGlvbk9ic2VydmVyIHx8IHRoaXMudXNlc1BvbHlmaWxsICkgfHwgIXZhbGlkRWxlbWVudCh0aGlzLmVsZW1lbnQpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQG92ZXJyaWRlXHJcbiAgICogQHJldHVybiB7Qm9vbGVhbn0gcmVwb3J0cyB3aGV0aGVyIHRoZSBlbGVtZW50IGlzIGluIHZpZXcgYWNjb3JkaW5nIHRvIHRoZSBJbnRlcnNlY3Rpb25PYnNlcnZlciBtZWFzdXJlbWVudCB0ZWNobmlxdWVcclxuICAgKi9cclxuICBnZXQgdmlld2FibGUoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5pblZpZXc7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBAb3ZlcnJpZGVcclxuICAgKiBAcmV0dXJuIHtTdHJpbmd9IHJlcG9ydHMgbWVhc3VyZW1lbnQgdGVjaG5pcXVlIG5hbWVcclxuICAgKi9cclxuICBnZXQgdGVjaG5pcXVlTmFtZSgpIHtcclxuICAgIHJldHVybiAnSW50ZXJzZWN0aW9uT2JzZXJ2ZXInO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQHJldHVybiB7Qm9vbGVhbn0gLSByZXBvcnRzIHdoZXRoZXIgbWVhc3VyZW1lbnQgdGVjaG5pcXVlIGlzIHVzaW5nIHRoZSBuYXRpdmUgSW50ZXJzZWN0aW9uT2JzZXJ2ZXIgQVBJIG9yIHRoZSBwb2x5ZmlsbCBidW5kbGVkIHdpdGggdGhlIGxpYnJhcnkuXHJcbiAgICogUG9seWZpbGwgdXNhZ2UgaXMgaW5mZXJlZCBieSBjaGVja2luZyBpZiB0aGUgSW50ZXJzZWN0aW9uT2JzZXJ2ZXIgQVBJIGhhcyBhIFRIUk9UVExFX1RJTUVPVVQgbWVtbWJlclxyXG4gICAqIE9ubHkgdGhlIHBvbHlmaWxsIHNob3VsZCBoYXZlIHRoYXQgbWVtYmVyIGluIGl0J3MgQVBJXHJcbiAgICovXHJcbiAgZ2V0IHVzZXNQb2x5ZmlsbCgpIHtcclxuICAgIHJldHVybiB0eXBlb2Ygd2luZG93LkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5USFJPVFRMRV9USU1FT1VUID09PSAnbnVtYmVyJztcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIGNhbGxiYWNrIGZ1bmN0aW9uIGZvciBJbnRlcnNlY3Rpb25PYnNlcnZlciBjaGFuZ2UgZXZlbnRzXHJcbiAgICogQHBhcmFtICB7QXJyYXl9IGVudHJpZXMgLSBjaGFuZ2UgZW50cmllc1xyXG4gICAqL1xyXG4gIHZpZXdhYmxlQ2hhbmdlKGVudHJpZXMpIHtcclxuICAgIGlmKGVudHJpZXMgJiYgZW50cmllcy5sZW5ndGggJiYgZW50cmllc1swXS5pbnRlcnNlY3Rpb25SYXRpbyAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgIHRoaXMucGVyY2VudFZpZXdhYmxlID0gZW50cmllc1swXS5pbnRlcnNlY3Rpb25SYXRpbztcclxuICAgICAgXHJcbiAgICAgIGlmKGVudHJpZXNbMF0uaW50ZXJzZWN0aW9uUmF0aW8gPCB0aGlzLmNyaXRlcmlhLmluVmlld1RocmVzaG9sZCAmJiB0aGlzLnN0YXJ0ZWQpIHtcclxuICAgICAgICB0aGlzLmluVmlldyA9IGZhbHNlO1xyXG4gICAgICAgIHRoaXMubGlzdGVuZXJzLm91dFZpZXcuZm9yRWFjaCggbCA9PiBsKCkgKTtcclxuICAgICAgfVxyXG4gICAgICBpZihlbnRyaWVzWzBdLmludGVyc2VjdGlvblJhdGlvID49IHRoaXMuY3JpdGVyaWEuaW5WaWV3VGhyZXNob2xkKSB7XHJcbiAgICAgICAgdGhpcy5zdGFydGVkID0gdHJ1ZTtcclxuICAgICAgICB0aGlzLmluVmlldyA9IHRydWU7XHJcbiAgICAgICAgdGhpcy5saXN0ZW5lcnMuaW5WaWV3LmZvckVhY2goIGwgPT4gbCgpICk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIHRoaXMubGlzdGVuZXJzLmNoYW5nZVZpZXcuZm9yRWFjaCggbCA9PiBsKCkgKTtcclxuICAgIH1cclxuICB9XHJcblxyXG59IiwiaW1wb3J0IEludGVyc2VjdGlvbk9ic2VydmVyIGZyb20gJy4vSW50ZXJzZWN0aW9uT2JzZXJ2ZXInO1xyXG5pbXBvcnQgUG9seWZpbGwgZnJvbSAnaW50ZXJzZWN0aW9uLW9ic2VydmVyJztcclxuaW1wb3J0ICogYXMgRW52aXJvbm1lbnQgZnJvbSAnLi4vLi4vRW52aXJvbm1lbnQvRW52aXJvbm1lbnQnO1xyXG5cclxuLyoqXHJcbiAqIFJlcHJlc2VudHMgYSBtZWFzdXJlbWVudCB0ZWNobmlxdWUgdGhhdCB1c2VzIHRoZSBJbnRlcnNlY3Rpb25PYnNlcnZlciBBUEkgcG9seWZpbGxcclxuICogQGV4dGVuZHMge0ludGVyc2VjdGlvbk9ic2VydmVyfVxyXG4gKi9cclxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgSW50ZXJzZWN0aW9uT2JzZXJ2ZXJQb2x5ZmlsbCBleHRlbmRzIEludGVyc2VjdGlvbk9ic2VydmVyIHtcclxuICAvKipcclxuICAgKiBkZXRlcm1pbmVzIHdoZXRoZXIgdGhlIG1lYXN1cmVtZW50IHRlY2huaXF1ZSBpcyBjYXBhYmxlIG9mIG1lYXN1cmluZyBnaXZlbiB0aGUgY3VycmVudCBlbnZpcm9ubWVudFxyXG4gICAqIEBvdmVycmlkZVxyXG4gICAqIEByZXR1cm4ge0Jvb2xlYW59XHJcbiAgICovXHJcbiAgZ2V0IHVubWVhc3VyZWFibGUoKSB7XHJcbiAgICByZXR1cm4gRW52aXJvbm1lbnQuaUZyYW1lQ29udGV4dCgpID09PSBFbnZpcm9ubWVudC5pRnJhbWVTZXJ2aW5nU2NlbmFyaW9zLkNST1NTX0RPTUFJTl9JRlJBTUU7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBAcmV0dXJuIHtTdHJpbmd9IG5hbWUgb2YgbWVhc3VyZW1lbnQgdGVjaG5pcXVlXHJcbiAgICovXHJcbiAgZ2V0IHRlY2huaXF1ZU5hbWUoKSB7XHJcbiAgICByZXR1cm4gJ0ludGVyc2VjdGlvbk9ic2VydmVyUG9seUZpbGwnO1xyXG4gIH1cclxufSIsImV4cG9ydCB7IGRlZmF1bHQgYXMgSW50ZXJzZWN0aW9uT2JzZXJ2ZXIgfSBmcm9tICcuL0ludGVyc2VjdGlvbk9ic2VydmVyJztcclxuZXhwb3J0IHsgZGVmYXVsdCBhcyBJbnRlcnNlY3Rpb25PYnNlcnZlclBvbHlmaWxsIH0gZnJvbSAnLi9JbnRlcnNlY3Rpb25PYnNlcnZlclBvbHlmaWxsJztcclxuZXhwb3J0IHsgZGVmYXVsdCBhcyBCYXNlVGVjaG5pcXVlIH0gZnJvbSAnLi9CYXNlVGVjaG5pcXVlJzsiLCIvKipcclxuICogU3RyYXRlZ2llcyBtb2R1bGVcclxuICogQG1vZHVsZSBNZWFzdXJlbWVudC9TdHJhdGVnaWVzXHJcbiAqIHJlcHJlc2VudHMgY29uc3RhbnRzIGFuZCBmYWN0b3JpZXMgcmVsYXRlZCB0byBtZWFzdXJlbWVudCBzdHJhdGVnaWVzIFxyXG4gKi9cclxuXHJcbmltcG9ydCAqIGFzIFZhbGlkYXRvcnMgZnJvbSAnLi4vLi4vSGVscGVycy9WYWxpZGF0b3JzJztcclxuaW1wb3J0ICogYXMgTWVhc3VyZW1lbnRUZWNobmlxdWVzIGZyb20gJy4uL01lYXN1cmVtZW50VGVjaG5pcXVlcy8nO1xyXG5pbXBvcnQgKiBhcyBWaWV3YWJpbGl0eUNyaXRlcmlhIGZyb20gJy4uLy4uL09wdGlvbnMvVmlld2FiaWxpdHlDcml0ZXJpYSc7XHJcblxyXG4vKipcclxuICogcmVwcmVzZW50cyBkZWZhdWx0IG1lYXN1cmVtZW50IHN0cmF0ZWd5LiBEZWZpbmVzIGF1dG9zdGFydCwgdGVjaG5pcXVlcywgYW5kIG1lYXN1cmVtZW50IGNyaXRlcmlhXHJcbiAqIEB0eXBlIHtPYmplY3R9XHJcbiAqL1xyXG5leHBvcnQgY29uc3QgREVGQVVMVF9TVFJBVEVHWSA9IHtcclxuICBhdXRvc3RhcnQ6IHRydWUsXHJcbiAgdGVjaG5pcXVlczogW01lYXN1cmVtZW50VGVjaG5pcXVlcy5JbnRlcnNlY3Rpb25PYnNlcnZlciwgTWVhc3VyZW1lbnRUZWNobmlxdWVzLkludGVyc2VjdGlvbk9ic2VydmVyUG9seWZpbGxdLFxyXG4gIGNyaXRlcmlhOiBWaWV3YWJpbGl0eUNyaXRlcmlhLk1SQ19WSURFT1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIENyZWF0ZSBzdHJhdGVneSBvYmplY3QgdXNpbmcgdGhlIHByb3ZpZGVkIHZhbHVlc1xyXG4gKiBAcGFyYW0gIHtCb29sZWFufSBhdXRvc3RhcnQgLSB3aGV0aGVyIG1lYXN1cmVtZW50IHNob3VsZCBzdGFydCBpbW1lZGlhdGVseVxyXG4gKiBAcGFyYW0gIHtBcnJheS48QmFzZVRlY2huaXF1ZT59IHRlY2huaXF1ZXMgLSBsaXN0IG9mIHRlY2huaXF1ZXMgdG8gdXNlIGZvciBtZWFzdXJlbWVudC4gRmlyc3Qgbm9uLXVubWVhc3VyZWFibGUgdGVjaG5pcXVlIHdpbGwgYmUgdXNlZFxyXG4gKiBAcGFyYW0gIHtPYmplY3R9IGNyaXRlcmlhIC0gY3JpdGVyaWEgb2JqZWN0LiBTZWUgT3B0aW9ucy9WaWV3YWJpbGl0eUNyaXRlcmlhIGZvciBwcmUtZGVmaW5lZCBjcml0ZXJpYSBhbmQgY3JpdGVyaWEgZmFjdG9yeVxyXG4gKiBAcmV0dXJuIHtPYmplY3R9IG9iamVjdCBjb250YWluaW5nIGFwcHJvcHJpYXRlbHkgbmFtZWQgcHJvcGVydGllcyB0byBiZSB1c2VkIGFzIG1lYXN1cmVtZW50IHN0cmF0ZWd5XHJcbiAqL1xyXG5leHBvcnQgY29uc3QgU3RyYXRlZ3lGYWN0b3J5ID0gKGF1dG9zdGFydCA9IERFRkFVTFRfU1RSQVRFR1kuYXV0b3N0YXJ0LCB0ZWNobmlxdWVzID0gREVGQVVMVF9TVFJBVEVHWS50ZWNobmlxdWVzLCBjcml0ZXJpYSA9IERFRkFVTFRfU1RSQVRFR1kuY3JpdGVyaWEpID0+IHtcclxuICBjb25zdCBzdHJhdGVneSA9IHsgYXV0b3N0YXJ0LCB0ZWNobmlxdWVzLCBjcml0ZXJpYSB9LFxyXG4gICAgICAgIHZhbGlkYXRlZCA9IFZhbGlkYXRvcnMudmFsaWRhdGVTdHJhdGVneShzdHJhdGVneSk7ICBcclxuXHJcbiAgaWYodmFsaWRhdGVkLmludmFsaWQpIHtcclxuICAgIHRocm93IHZhbGlkYXRlZC5yZWFzb25zO1xyXG4gIH1cclxuXHJcbiAgcmV0dXJuIHN0cmF0ZWd5O1xyXG59OyIsImltcG9ydCAqIGFzIEV2ZW50cyBmcm9tICcuL01lYXN1cmVtZW50L0V2ZW50cyc7XHJcbmltcG9ydCBJblZpZXdUaW1lciBmcm9tICcuL1RpbWluZy9JblZpZXdUaW1lcic7XHJcbmltcG9ydCAqIGFzIFN0cmF0ZWdpZXMgZnJvbSAnLi9NZWFzdXJlbWVudC9TdHJhdGVnaWVzLyc7XHJcbmltcG9ydCAqIGFzIEVudmlyb25tZW50IGZyb20gJy4vRW52aXJvbm1lbnQvRW52aXJvbm1lbnQnO1xyXG5pbXBvcnQgTWVhc3VyZW1lbnRFeGVjdXRvciBmcm9tICcuL01lYXN1cmVtZW50L01lYXN1cmVtZW50RXhlY3V0b3InO1xyXG5pbXBvcnQgKiBhcyBWaWV3YWJpbGl0eUNyaXRlcmlhIGZyb20gJy4vT3B0aW9ucy9WaWV3YWJpbGl0eUNyaXRlcmlhJztcclxuaW1wb3J0ICogYXMgTWVhc3VyZW1lbnRUZWNobmlxdWVzIGZyb20gJy4vTWVhc3VyZW1lbnQvTWVhc3VyZW1lbnRUZWNobmlxdWVzLyc7XHJcblxyXG4vKiogQ2xhc3MgcmVwcmVzZW50cyB0aGUgbWFpbiBlbnRyeSBwb2ludCB0byB0aGUgT3BlblZWIGxpYnJhcnkgKi9cclxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgT3BlblZWIHtcclxuICAvKipcclxuICAgKiBDcmVhdGUgYSBuZXcgaW5zdGFuY2Ugb2YgT3BlblZWIFxyXG4gICAqL1xyXG4gIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgdGhpcy5leGVjdXRvcnMgPSBbXTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEFsbG93cyBtZWFzdXJlbWVudCBvZiBhbiBlbGVtZW50IHVzaW5nIGEgc3RyYXRlZ3kgZGVmaW5pdGlvbiAgXHJcbiAgICogQHBhcmFtICB7SFRNTEVsZW1lbnR9IGVsZW1lbnQgLSB0aGUgZWxlbWVudCB5b3UnZCBsaWtlIG1lYXN1cmUgdmlld2FiaWxpdHkgb25cclxuICAgKiBAcGFyYW0gIHtPYmplY3R9IHN0cmF0ZWd5IC0gYW4gb2JqZWN0IHJlcHJlc2VudGluZyB0aGUgc3RyYXRlZ3kgdG8gdXNlIGZvciBtZWFzdXJlbWVudC4gXHJcbiAgICogU2VlIE9wZW5WVi5TdHJhdGVnaWVzIGZvciBTdHJhdGVneUZhY3RvcnkgYW5kIERFRkFVTFRfU1RSQVRFR1kgZm9yIG1vcmUgaW5mb3JtYXRpb24uIFxyXG4gICAqIEByZXR1cm4ge01lYXN1cmVtZW50RXhlY3V0b3J9IHJldHVybnMgaW5zdGFuY2Ugb2YgTWVhc3VybWVudEV4ZWN1dG9yLiBcclxuICAgKiBUaGlzIGluc3RhbmNlIGV4cG9zZXMgZXZlbnQgbGlzdGVuZXJzIG9uVmlld2FibGVTdGFydCwgb25WaWV3YWJsZVN0b3AsIG9uVmlld2FibGVDaGFuZ2UsIG9uVmlld2FibGVDb21wbGV0ZSwgYW5kIG9uVW5tZWFzdXJlYWJsZVxyXG4gICAqIEFsc28gZXhwb3NlcyBzdGFydCBhbmQgZGlzcG9zZVxyXG4gICAqL1xyXG4gIG1lYXN1cmVFbGVtZW50KGVsZW1lbnQsIHN0cmF0ZWd5KSB7XHJcbiAgICBjb25zdCBleGVjdXRvciA9IG5ldyBNZWFzdXJlbWVudEV4ZWN1dG9yKGVsZW1lbnQsIHN0cmF0ZWd5KTtcclxuICAgIHRoaXMuZXhlY3V0b3JzLnB1c2goZXhlY3V0b3IpO1xyXG4gICAgcmV0dXJuIGV4ZWN1dG9yO1xyXG4gIH0gXHJcblxyXG4gIC8qKlxyXG4gICAqIGRlc3Ryb3lzIGFsbCBtZWFzdXJlbWVudCBleGVjdXRvcnNcclxuICAgKi9cclxuICBkaXNwb3NlKCkge1xyXG4gICAgdGhpcy5leGVjdXRvcnMuZm9yRWFjaCggZSA9PiBlLmRpc3Bvc2UoKSApO1xyXG4gIH1cclxufVxyXG5cclxuLyoqXHJcbiAqIEV4cG9zZXMgYWxsIHB1YmxpYyBjbGFzc2VzIGFuZCBjb25zdGFudHMgYXZhaWxhYmxlIGluIHRoZSBPcGVuVlYgcGFja2FnZVxyXG4gKi9cclxuT3BlblZWLlZpZXdhYmlsaXR5Q3JpdGVyaWEgPSBWaWV3YWJpbGl0eUNyaXRlcmlhO1xyXG5PcGVuVlYuTWVhc3VyZW1lbnRFeGVjdXRvciA9IE1lYXN1cmVtZW50RXhlY3V0b3I7XHJcbk9wZW5WVi5NZWFzdXJlbWVudFRlY2huaXF1ZXMgPSBNZWFzdXJlbWVudFRlY2huaXF1ZXM7XHJcbk9wZW5WVi5JblZpZXdUaW1lciA9IEluVmlld1RpbWVyO1xyXG5PcGVuVlYuU3RyYXRlZ2llcyA9IFN0cmF0ZWdpZXM7XHJcbk9wZW5WVi5FdmVudHMgPSBFdmVudHM7IiwiLyoqXHJcbiAqIFZpZXdhYmlsaXR5IENyaXRlcmlhIG1vZHVsZVxyXG4gKiBAbW9kdWxlIE9wdGlvbnMvVmlld2FiaWxpdHlDcml0ZXJpYVxyXG4gKiByZXByZXNlbnRzIGNvbnN0YW50cyBhbmQgZmFjdG9yaWVzIHJlbGF0ZWQgdG8gbWVhc3VyZW1lbnQgY3JpdGVyaWEgXHJcbiAqL1xyXG5cclxuLyoqXHJcbiAqIFJlcHJlc2VudHMgY3JpdGVyaWEgZm9yIE1SQyB2aWV3YWJsZSB2aWRlbyBpbXByZXNzaW9uXHJcbiAqIEB0eXBlIHtPYmplY3R9XHJcbiAqL1xyXG5leHBvcnQgY29uc3QgTVJDX1ZJREVPID0ge1xyXG4gIGluVmlld1RocmVzaG9sZDogMC41LFxyXG4gIHRpbWVJblZpZXc6IDIwMDBcclxufTtcclxuXHJcbi8qKlxyXG4gKiBSZXByZXNlbnRzIGNyaXRlcmlhIGZvciBNUkMgdmlld2FibGUgZGlzcGxheSBpbXByZXNzaW9uXHJcbiAqIEB0eXBlIHtPYmplY3R9XHJcbiAqL1xyXG5leHBvcnQgY29uc3QgTVJDX0RJU1BMQVkgPSB7XHJcbiAgaW5WaWV3VGhyZXNob2xkOiAwLjUsXHJcbiAgdGltZUluVmlldzogMTAwMFxyXG59O1xyXG5cclxuXHJcbi8qKlxyXG4gKiBDcmVhdGVzIGN1c3RvbSBjcml0ZXJpYSBvYmplY3QgdXNpbmcgdGhlIHRocmVzaG9sZCBhbmQgZHVyYXRpb24gcHJvdmlkZWQgXHJcbiAqIEBwYXJhbSAge051bWJlcn0gLSBhbW91bnQgZWxlbWVudCBtdXN0IGJlIGluIHZpZXcgYmVmb3JlIGl0IGlzIGNvbnNpZGVyZWQgaW4gdmlld1xyXG4gKiBAcGFyYW0gIHtOdW1iZXJ9IC0gaG93IGxvbmcgZWxlbWVudCBtdXN0IGJlIGluIHZpZXcgYmVmb3JlIGl0IGlzIGNvbnNpZGVyZWQgdmlld2FibGVcclxuICogQHJldHVybiB7T2JqZWN0fSBvYmplY3QgY29udGFpbmluZyBhcHByb3ByaWF0ZWx5IG5hbWVkIHByb3BlcnRpZXMgdG8gYmUgdXNlZCBhcyB2aWV3YWJpbGl0eSBjcml0ZXJpYSBcclxuICovXHJcbmV4cG9ydCBjb25zdCBjdXN0b21Dcml0ZXJpYSA9IChpblZpZXdUaHJlc2hvbGQgPSAwLjUsIHRpbWVJblZpZXcgPSAyMDAwKSA9PiAoeyBpblZpZXdUaHJlc2hvbGQsIHRpbWVJblZpZXcgfSk7IiwiLyoqXHJcbiAqIFJlcHJlc2VudHMgYSB0aW1lciBjbGFzcyB0byBub3RpZnkgYSBsaXN0ZW5lciB3aGVuIGEgc3BlY2lmaWVkIGR1cmF0aW9uIGhhcyBlbGFwc2VkXHJcbiAqL1xyXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBJblZpZXdUaW1lciB7XHJcbiAgLyoqXHJcbiAgICogQ3JlYXRlcyBuZXcgaW5zdGFuY2Ugb2YgYW4gSW5WaWV3VGltZXJcclxuICAgKiBAY29uc3RydWN0b3JcclxuICAgKiBAcGFyYW0gIHtOdW1iZXJ9IGR1cmF0aW9uIC0gd2hlbiB0byBmaXJlIGVsYXBzZWQgY2FsbGJhY2tcclxuICAgKiBAcmV0dXJuIHtJblZpZXdUaW1lcn0gaW5zdGFuY2Ugb2YgSW5WaWV3VGltZXJcclxuICAgKi9cclxuICBjb25zdHJ1Y3RvcihkdXJhdGlvbikge1xyXG4gICAgdGhpcy5kdXJhdGlvbiA9IGR1cmF0aW9uO1xyXG4gICAgdGhpcy5saXN0ZW5lcnMgPSBbXTtcclxuICAgIHRoaXMuY29tcGxldGVkID0gZmFsc2U7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBub3RpZmllcyBsaXN0ZW5lcnMgdGhhdCB0aW1lciBoYXMgZWxhcHNlZCBmb3IgdGhlIHNwZWNpZmllZCBkdXJhdGlvblxyXG4gICAqL1xyXG4gIHRpbWVyQ29tcGxldGUoKSB7XHJcbiAgICB0aGlzLmNvbXBsZXRlZCA9IHRydWU7XHJcbiAgICB0aGlzLmxpc3RlbmVycy5mb3JFYWNoKCBsID0+IGwoKSApO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogYWNjZXB0cyBjYWxsYmFjayBmdW5jdGlvbnMgdG8gY2FsbCB3aGVuIHRoZSB0aW1lciBoYXMgZWxhcHNlZFxyXG4gICAqIEBwYXJhbSAge0Z1bmN0aW9ufSBjYiAtIGNhbGxiYWNrIHRvIGNhbGwgd2hlbiB0aW1lciBoYXMgZWxhcHNlZFxyXG4gICAqL1xyXG4gIGVsYXBzZWQoY2IpIHtcclxuICAgIGlmKHR5cGVvZiBjYiA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgICB0aGlzLmxpc3RlbmVycy5wdXNoKGNiKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIHN0YXJ0IHRpbWVyXHJcbiAgICovXHJcbiAgc3RhcnQoKSB7XHJcbiAgICB0aGlzLmVuZFRpbWVyKCk7XHJcbiAgICB0aGlzLnRpbWVyID0gc2V0VGltZW91dCh0aGlzLnRpbWVyQ29tcGxldGUuYmluZCh0aGlzKSwgdGhpcy5kdXJhdGlvbik7XHJcbiAgfVxyXG5cclxuICAvKiogc3RvcCB0aW1lciAqL1xyXG4gIHN0b3AoKSB7XHJcbiAgICB0aGlzLmVuZFRpbWVyKCk7XHJcbiAgfVxyXG5cclxuICAvKiogY2xlYXJzIHNldFRpbWVvdXQgYXNzb2NpYXRlZCB3aXRoIGNsYXNzICovXHJcbiAgZW5kVGltZXIoKSB7XHJcbiAgICBpZih0aGlzLnRpbWVyKSB7XHJcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLnRpbWVyKTtcclxuICAgICAgdGhpcy5saXN0ZW5lcnMubGVuZ3RoID0gMDtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKiBkZXN0cm95cyB0aW1lciAqL1xyXG4gIGRpc3Bvc2UoKSB7XHJcbiAgICB0aGlzLmVuZFRpbWVyKCk7XHJcbiAgfVxyXG5cclxufSJdfQ==
