(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.OpenVV = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';

function find(array, predicate, context) {
  if (typeof Array.prototype.find === 'function') {
    return array.find(predicate, context);
  }

  context = context || this;
  var length = array.length;
  var i;

  if (typeof predicate !== 'function') {
    throw new TypeError(predicate + ' is not a function');
  }

  for (i = 0; i < length; i++) {
    if (predicate.call(context, array[i], i, array)) {
      return array[i];
    }
  }
}

module.exports = find;

},{}],2:[function(require,module,exports){
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
  var parent = target.parentNode;
  var atRoot = false;

  while (!atRoot) {
    var parentRect = null;

    // If we're at the root element, set parentRect to the already
    // calculated rootRect. And since <body> and <html> cannot be clipped
    // to a rect that's not also the document rect, consider them root too.
    if (parent == this.root ||
        parent == document.body ||
        parent == document.documentElement ||
        parent.nodeType != 1) {
      atRoot = true;
      parentRect = rootRect;
    }
    // Otherwise check to see if the parent element hides overflow,
    // and if so update parentRect.
    else {
      if (window.getComputedStyle(parent).overflow != 'visible') {
        parentRect = getBoundingClientRect(parent);
      }
    }
    // If either of the above conditionals set a new parentRect,
    // calculate new intersection data.
    if (parentRect) {
      intersectionRect = computeRectIntersection(parentRect, intersectionRect);

      if (!intersectionRect) break;
    }
    parent = parent.parentNode;
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
    // Check if the node is a shadow root, if it is get the host.
    if (node.nodeType == 11 && node.host) {
      node = node.host;
    }

    if (node == parent) return true;

    // Traverse upwards in the DOM.
    node = node.parentNode;
  }
  return false;
}


// Exposes the constructors globally.
window.IntersectionObserver = IntersectionObserver;
window.IntersectionObserverEntry = IntersectionObserverEntry;

}(window, document));

},{}],3:[function(require,module,exports){
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

},{}],4:[function(require,module,exports){
'use strict';

require('array-find');

},{"array-find":1}],5:[function(require,module,exports){
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

},{"../Measurement/MeasurementTechniques/BaseTechnique":8}],6:[function(require,module,exports){
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

},{}],7:[function(require,module,exports){
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

},{"../Environment/Environment":3,"../Helpers/Validators":5,"../Timing/InViewTimer":15,"./Events":6,"./Strategies/":12}],8:[function(require,module,exports){
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

},{}],9:[function(require,module,exports){
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

},{"../../Helpers/Validators":5,"../Strategies/":12,"./BaseTechnique":8}],10:[function(require,module,exports){
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

},{"../../Environment/Environment":3,"./IntersectionObserver":9,"intersection-observer":2}],11:[function(require,module,exports){
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

},{"./BaseTechnique":8,"./IntersectionObserver":9,"./IntersectionObserverPolyfill":10}],12:[function(require,module,exports){
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

},{"../../Helpers/Validators":5,"../../Options/ViewabilityCriteria":14,"../MeasurementTechniques/":11}],13:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

require('./Helpers/Polyfills.js');

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

},{"./Environment/Environment":3,"./Helpers/Polyfills.js":4,"./Measurement/Events":6,"./Measurement/MeasurementExecutor":7,"./Measurement/MeasurementTechniques/":11,"./Measurement/Strategies/":12,"./Options/ViewabilityCriteria":14,"./Timing/InViewTimer":15}],14:[function(require,module,exports){
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

},{}],15:[function(require,module,exports){
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

},{}]},{},[13])(13)
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvYXJyYXktZmluZC9maW5kLmpzIiwibm9kZV9tb2R1bGVzL2ludGVyc2VjdGlvbi1vYnNlcnZlci9pbnRlcnNlY3Rpb24tb2JzZXJ2ZXIuanMiLCJzcmMvRW52aXJvbm1lbnQvRW52aXJvbm1lbnQuanMiLCJzcmMvSGVscGVycy9Qb2x5ZmlsbHMuanMiLCJzcmMvSGVscGVycy9WYWxpZGF0b3JzLmpzIiwic3JjL01lYXN1cmVtZW50L0V2ZW50cy5qcyIsInNyYy9NZWFzdXJlbWVudC9NZWFzdXJlbWVudEV4ZWN1dG9yLmpzIiwic3JjL01lYXN1cmVtZW50L01lYXN1cmVtZW50VGVjaG5pcXVlcy9CYXNlVGVjaG5pcXVlLmpzIiwic3JjL01lYXN1cmVtZW50L01lYXN1cmVtZW50VGVjaG5pcXVlcy9JbnRlcnNlY3Rpb25PYnNlcnZlci5qcyIsInNyYy9NZWFzdXJlbWVudC9NZWFzdXJlbWVudFRlY2huaXF1ZXMvSW50ZXJzZWN0aW9uT2JzZXJ2ZXJQb2x5ZmlsbC5qcyIsInNyYy9NZWFzdXJlbWVudC9NZWFzdXJlbWVudFRlY2huaXF1ZXMvaW5kZXguanMiLCJzcmMvTWVhc3VyZW1lbnQvU3RyYXRlZ2llcy9pbmRleC5qcyIsInNyYy9PcGVuVlYuanMiLCJzcmMvT3B0aW9ucy9WaWV3YWJpbGl0eUNyaXRlcmlhLmpzIiwic3JjL1RpbWluZy9JblZpZXdUaW1lci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7Ozs7OztBQzVyQkE7Ozs7OztBQU1BOzs7O0FBSU8sSUFBTSxrQ0FBYSxTQUFiLFVBQWEsR0FBa0I7QUFBQSxNQUFqQixPQUFpQix1RUFBUCxFQUFPOztBQUMxQyxTQUFPO0FBQ0wsbUJBQWUsS0FBSyxHQUFMLENBQVMsU0FBUyxJQUFULENBQWMsV0FBdkIsRUFBb0MsT0FBTyxVQUEzQyxLQUEw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Q0Q7QUFDRjs7QUFFRDs7Ozs4QkFDVTtBQUNSLFdBQUssUUFBTDtBQUNEOzs7Ozs7a0JBdkRrQixXIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIid1c2Ugc3RyaWN0JztcblxuZnVuY3Rpb24gZmluZChhcnJheSwgcHJlZGljYXRlLCBjb250ZXh0KSB7XG4gIGlmICh0eXBlb2YgQXJyYXkucHJvdG90eXBlLmZpbmQgPT09ICdmdW5jdGlvbicpIHtcbiAgICByZXR1cm4gYXJyYXkuZmluZChwcmVkaWNhdGUsIGNvbnRleHQpO1xuICB9XG5cbiAgY29udGV4dCA9IGNvbnRleHQgfHwgdGhpcztcbiAgdmFyIGxlbmd0aCA9IGFycmF5Lmxlbmd0aDtcbiAgdmFyIGk7XG5cbiAgaWYgKHR5cGVvZiBwcmVkaWNhdGUgIT09ICdmdW5jdGlvbicpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKHByZWRpY2F0ZSArICcgaXMgbm90IGEgZnVuY3Rpb24nKTtcbiAgfVxuXG4gIGZvciAoaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIGlmIChwcmVkaWNhdGUuY2FsbChjb250ZXh0LCBhcnJheVtpXSwgaSwgYXJyYXkpKSB7XG4gICAgICByZXR1cm4gYXJyYXlbaV07XG4gICAgfVxuICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0gZmluZDtcbiIsIi8qKlxuICogQ29weXJpZ2h0IDIwMTYgR29vZ2xlIEluYy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiBMaWNlbnNlZCB1bmRlciB0aGUgQXBhY2hlIExpY2Vuc2UsIFZlcnNpb24gMi4wICh0aGUgXCJMaWNlbnNlXCIpO1xuICogeW91IG1heSBub3QgdXNlIHRoaXMgZmlsZSBleGNlcHQgaW4gY29tcGxpYW5jZSB3aXRoIHRoZSBMaWNlbnNlLlxuICogWW91IG1heSBvYnRhaW4gYSBjb3B5IG9mIHRoZSBMaWNlbnNlIGF0XG4gKlxuICogICAgIGh0dHA6Ly93d3cuYXBhY2hlLm9yZy9saWNlbnNlcy9MSUNFTlNFLTIuMFxuICpcbiAqIFVubGVzcyByZXF1aXJlZCBieSBhcHBsaWNhYmxlIGxhdyBvciBhZ3JlZWQgdG8gaW4gd3JpdGluZywgc29mdHdhcmVcbiAqIGRpc3RyaWJ1dGVkIHVuZGVyIHRoZSBMaWNlbnNlIGlzIGRpc3RyaWJ1dGVkIG9uIGFuIFwiQVMgSVNcIiBCQVNJUyxcbiAqIFdJVEhPVVQgV0FSUkFOVElFUyBPUiBDT05ESVRJT05TIE9GIEFOWSBLSU5ELCBlaXRoZXIgZXhwcmVzcyBvciBpbXBsaWVkLlxuICogU2VlIHRoZSBMaWNlbnNlIGZvciB0aGUgc3BlY2lmaWMgbGFuZ3VhZ2UgZ292ZXJuaW5nIHBlcm1pc3Npb25zIGFuZFxuICogbGltaXRhdGlvbnMgdW5kZXIgdGhlIExpY2Vuc2UuXG4gKi9cblxuKGZ1bmN0aW9uKHdpbmRvdywgZG9jdW1lbnQpIHtcbid1c2Ugc3RyaWN0JztcblxuXG4vLyBFeGl0cyBlYXJseSBpZiBhbGwgSW50ZXJzZWN0aW9uT2JzZXJ2ZXIgYW5kIEludGVyc2VjdGlvbk9ic2VydmVyRW50cnlcbi8vIGZlYXR1cmVzIGFyZSBuYXRpdmVseSBzdXBwb3J0ZWQuXG5pZiAoJ0ludGVyc2VjdGlvbk9ic2VydmVyJyBpbiB3aW5kb3cgJiZcbiAgICAnSW50ZXJzZWN0aW9uT2JzZXJ2ZXJFbnRyeScgaW4gd2luZG93ICYmXG4gICAgJ2ludGVyc2VjdGlvblJhdGlvJyBpbiB3aW5kb3cuSW50ZXJzZWN0aW9uT2JzZXJ2ZXJFbnRyeS5wcm90b3R5cGUpIHtcbiAgcmV0dXJuO1xufVxuXG5cbi8qKlxuICogQW4gSW50ZXJzZWN0aW9uT2JzZXJ2ZXIgcmVnaXN0cnkuIFRoaXMgcmVnaXN0cnkgZXhpc3RzIHRvIGhvbGQgYSBzdHJvbmdcbiAqIHJlZmVyZW5jZSB0byBJbnRlcnNlY3Rpb25PYnNlcnZlciBpbnN0YW5jZXMgY3VycmVudGx5IG9ic2VydmVyaW5nIGEgdGFyZ2V0XG4gKiBlbGVtZW50LiBXaXRob3V0IHRoaXMgcmVnaXN0cnksIGluc3RhbmNlcyB3aXRob3V0IGFub3RoZXIgcmVmZXJlbmNlIG1heSBiZVxuICogZ2FyYmFnZSBjb2xsZWN0ZWQuXG4gKi9cbnZhciByZWdpc3RyeSA9IFtdO1xuXG5cbi8qKlxuICogQ3JlYXRlcyB0aGUgZ2xvYmFsIEludGVyc2VjdGlvbk9ic2VydmVyRW50cnkgY29uc3RydWN0b3IuXG4gKiBodHRwczovL3dpY2cuZ2l0aHViLmlvL0ludGVyc2VjdGlvbk9ic2VydmVyLyNpbnRlcnNlY3Rpb24tb2JzZXJ2ZXItZW50cnlcbiAqIEBwYXJhbSB7T2JqZWN0fSBlbnRyeSBBIGRpY3Rpb25hcnkgb2YgaW5zdGFuY2UgcHJvcGVydGllcy5cbiAqIEBjb25zdHJ1Y3RvclxuICovXG5mdW5jdGlvbiBJbnRlcnNlY3Rpb25PYnNlcnZlckVudHJ5KGVudHJ5KSB7XG4gIHRoaXMudGltZSA9IGVudHJ5LnRpbWU7XG4gIHRoaXMudGFyZ2V0ID0gZW50cnkudGFyZ2V0O1xuICB0aGlzLnJvb3RCb3VuZHMgPSBlbnRyeS5yb290Qm91bmRzO1xuICB0aGlzLmJvdW5kaW5nQ2xpZW50UmVjdCA9IGVudHJ5LmJvdW5kaW5nQ2xpZW50UmVjdDtcbiAgdGhpcy5pbnRlcnNlY3Rpb25SZWN0ID0gZW50cnkuaW50ZXJzZWN0aW9uUmVjdCB8fCBnZXRFbXB0eVJlY3QoKTtcbiAgdGhpcy5pc0ludGVyc2VjdGluZyA9ICEhZW50cnkuaW50ZXJzZWN0aW9uUmVjdDtcblxuICAvLyBDYWxjdWxhdGVzIHRoZSBpbnRlcnNlY3Rpb24gcmF0aW8uXG4gIHZhciB0YXJnZXRSZWN0ID0gdGhpcy5ib3VuZGluZ0NsaWVudFJlY3Q7XG4gIHZhciB0YXJnZXRBcmVhID0gdGFyZ2V0UmVjdC53aWR0aCAqIHRhcmdldFJlY3QuaGVpZ2h0O1xuICB2YXIgaW50ZXJzZWN0aW9uUmVjdCA9IHRoaXMuaW50ZXJzZWN0aW9uUmVjdDtcbiAgdmFyIGludGVyc2VjdGlvbkFyZWEgPSBpbnRlcnNlY3Rpb25SZWN0LndpZHRoICogaW50ZXJzZWN0aW9uUmVjdC5oZWlnaHQ7XG5cbiAgLy8gU2V0cyBpbnRlcnNlY3Rpb24gcmF0aW8uXG4gIGlmICh0YXJnZXRBcmVhKSB7XG4gICAgdGhpcy5pbnRlcnNlY3Rpb25SYXRpbyA9IGludGVyc2VjdGlvbkFyZWEgLyB0YXJnZXRBcmVhO1xuICB9IGVsc2Uge1xuICAgIC8vIElmIGFyZWEgaXMgemVybyBhbmQgaXMgaW50ZXJzZWN0aW5nLCBzZXRzIHRvIDEsIG90aGVyd2lzZSB0byAwXG4gICAgdGhpcy5pbnRlcnNlY3Rpb25SYXRpbyA9IHRoaXMuaXNJbnRlcnNlY3RpbmcgPyAxIDogMDtcbiAgfVxufVxuXG5cbi8qKlxuICogQ3JlYXRlcyB0aGUgZ2xvYmFsIEludGVyc2VjdGlvbk9ic2VydmVyIGNvbnN0cnVjdG9yLlxuICogaHR0cHM6Ly93aWNnLmdpdGh1Yi5pby9JbnRlcnNlY3Rpb25PYnNlcnZlci8jaW50ZXJzZWN0aW9uLW9ic2VydmVyLWludGVyZmFjZVxuICogQHBhcmFtIHtGdW5jdGlvbn0gY2FsbGJhY2sgVGhlIGZ1bmN0aW9uIHRvIGJlIGludm9rZWQgYWZ0ZXIgaW50ZXJzZWN0aW9uXG4gKiAgICAgY2hhbmdlcyBoYXZlIHF1ZXVlZC4gVGhlIGZ1bmN0aW9uIGlzIG5vdCBpbnZva2VkIGlmIHRoZSBxdWV1ZSBoYXNcbiAqICAgICBiZWVuIGVtcHRpZWQgYnkgY2FsbGluZyB0aGUgYHRha2VSZWNvcmRzYCBtZXRob2QuXG4gKiBAcGFyYW0ge09iamVjdD19IG9wdF9vcHRpb25zIE9wdGlvbmFsIGNvbmZpZ3VyYXRpb24gb3B0aW9ucy5cbiAqIEBjb25zdHJ1Y3RvclxuICovXG5mdW5jdGlvbiBJbnRlcnNlY3Rpb25PYnNlcnZlcihjYWxsYmFjaywgb3B0X29wdGlvbnMpIHtcblxuICB2YXIgb3B0aW9ucyA9IG9wdF9vcHRpb25zIHx8IHt9O1xuXG4gIGlmICh0eXBlb2YgY2FsbGJhY2sgIT0gJ2Z1bmN0aW9uJykge1xuICAgIHRocm93IG5ldyBFcnJvcignY2FsbGJhY2sgbXVzdCBiZSBhIGZ1bmN0aW9uJyk7XG4gIH1cblxuICBpZiAob3B0aW9ucy5yb290ICYmIG9wdGlvbnMucm9vdC5ub2RlVHlwZSAhPSAxKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdyb290IG11c3QgYmUgYW4gRWxlbWVudCcpO1xuICB9XG5cbiAgLy8gQmluZHMgYW5kIHRocm90dGxlcyBgdGhpcy5fY2hlY2tGb3JJbnRlcnNlY3Rpb25zYC5cbiAgdGhpcy5fY2hlY2tGb3JJbnRlcnNlY3Rpb25zID0gdGhyb3R0bGUoXG4gICAgICB0aGlzLl9jaGVja0ZvckludGVyc2VjdGlvbnMuYmluZCh0aGlzKSwgdGhpcy5USFJPVFRMRV9USU1FT1VUKTtcblxuICAvLyBQcml2YXRlIHByb3BlcnRpZXMuXG4gIHRoaXMuX2NhbGxiYWNrID0gY2FsbGJhY2s7XG4gIHRoaXMuX29ic2VydmF0aW9uVGFyZ2V0cyA9IFtdO1xuICB0aGlzLl9xdWV1ZWRFbnRyaWVzID0gW107XG4gIHRoaXMuX3Jvb3RNYXJnaW5WYWx1ZXMgPSB0aGlzLl9wYXJzZVJvb3RNYXJnaW4ob3B0aW9ucy5yb290TWFyZ2luKTtcblxuICAvLyBQdWJsaWMgcHJvcGVydGllcy5cbiAgdGhpcy50aHJlc2hvbGRzID0gdGhpcy5faW5pdFRocmVzaG9sZHMob3B0aW9ucy50aHJlc2hvbGQpO1xuICB0aGlzLnJvb3QgPSBvcHRpb25zLnJvb3QgfHwgbnVsbDtcbiAgdGhpcy5yb290TWFyZ2luID0gdGhpcy5fcm9vdE1hcmdpblZhbHVlcy5tYXAoZnVuY3Rpb24obWFyZ2luKSB7XG4gICAgcmV0dXJuIG1hcmdpbi52YWx1ZSArIG1hcmdpbi51bml0O1xuICB9KS5qb2luKCcgJyk7XG59XG5cblxuLyoqXG4gKiBUaGUgbWluaW11bSBpbnRlcnZhbCB3aXRoaW4gd2hpY2ggdGhlIGRvY3VtZW50IHdpbGwgYmUgY2hlY2tlZCBmb3JcbiAqIGludGVyc2VjdGlvbiBjaGFuZ2VzLlxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuVEhST1RUTEVfVElNRU9VVCA9IDEwMDtcblxuXG4vKipcbiAqIFRoZSBmcmVxdWVuY3kgaW4gd2hpY2ggdGhlIHBvbHlmaWxsIHBvbGxzIGZvciBpbnRlcnNlY3Rpb24gY2hhbmdlcy5cbiAqIHRoaXMgY2FuIGJlIHVwZGF0ZWQgb24gYSBwZXIgaW5zdGFuY2UgYmFzaXMgYW5kIG11c3QgYmUgc2V0IHByaW9yIHRvXG4gKiBjYWxsaW5nIGBvYnNlcnZlYCBvbiB0aGUgZmlyc3QgdGFyZ2V0LlxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuUE9MTF9JTlRFUlZBTCA9IG51bGw7XG5cblxuLyoqXG4gKiBTdGFydHMgb2JzZXJ2aW5nIGEgdGFyZ2V0IGVsZW1lbnQgZm9yIGludGVyc2VjdGlvbiBjaGFuZ2VzIGJhc2VkIG9uXG4gKiB0aGUgdGhyZXNob2xkcyB2YWx1ZXMuXG4gKiBAcGFyYW0ge0VsZW1lbnR9IHRhcmdldCBUaGUgRE9NIGVsZW1lbnQgdG8gb2JzZXJ2ZS5cbiAqL1xuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLm9ic2VydmUgPSBmdW5jdGlvbih0YXJnZXQpIHtcbiAgLy8gSWYgdGhlIHRhcmdldCBpcyBhbHJlYWR5IGJlaW5nIG9ic2VydmVkLCBkbyBub3RoaW5nLlxuICBpZiAodGhpcy5fb2JzZXJ2YXRpb25UYXJnZXRzLnNvbWUoZnVuY3Rpb24oaXRlbSkge1xuICAgIHJldHVybiBpdGVtLmVsZW1lbnQgPT0gdGFyZ2V0O1xuICB9KSkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGlmICghKHRhcmdldCAmJiB0YXJnZXQubm9kZVR5cGUgPT0gMSkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3RhcmdldCBtdXN0IGJlIGFuIEVsZW1lbnQnKTtcbiAgfVxuXG4gIHRoaXMuX3JlZ2lzdGVySW5zdGFuY2UoKTtcbiAgdGhpcy5fb2JzZXJ2YXRpb25UYXJnZXRzLnB1c2goe2VsZW1lbnQ6IHRhcmdldCwgZW50cnk6IG51bGx9KTtcbiAgdGhpcy5fbW9uaXRvckludGVyc2VjdGlvbnMoKTtcbn07XG5cblxuLyoqXG4gKiBTdG9wcyBvYnNlcnZpbmcgYSB0YXJnZXQgZWxlbWVudCBmb3IgaW50ZXJzZWN0aW9uIGNoYW5nZXMuXG4gKiBAcGFyYW0ge0VsZW1lbnR9IHRhcmdldCBUaGUgRE9NIGVsZW1lbnQgdG8gb2JzZXJ2ZS5cbiAqL1xuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLnVub2JzZXJ2ZSA9IGZ1bmN0aW9uKHRhcmdldCkge1xuICB0aGlzLl9vYnNlcnZhdGlvblRhcmdldHMgPVxuICAgICAgdGhpcy5fb2JzZXJ2YXRpb25UYXJnZXRzLmZpbHRlcihmdW5jdGlvbihpdGVtKSB7XG5cbiAgICByZXR1cm4gaXRlbS5lbGVtZW50ICE9IHRhcmdldDtcbiAgfSk7XG4gIGlmICghdGhpcy5fb2JzZXJ2YXRpb25UYXJnZXRzLmxlbmd0aCkge1xuICAgIHRoaXMuX3VubW9uaXRvckludGVyc2VjdGlvbnMoKTtcbiAgICB0aGlzLl91bnJlZ2lzdGVySW5zdGFuY2UoKTtcbiAgfVxufTtcblxuXG4vKipcbiAqIFN0b3BzIG9ic2VydmluZyBhbGwgdGFyZ2V0IGVsZW1lbnRzIGZvciBpbnRlcnNlY3Rpb24gY2hhbmdlcy5cbiAqL1xuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLmRpc2Nvbm5lY3QgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5fb2JzZXJ2YXRpb25UYXJnZXRzID0gW107XG4gIHRoaXMuX3VubW9uaXRvckludGVyc2VjdGlvbnMoKTtcbiAgdGhpcy5fdW5yZWdpc3Rlckluc3RhbmNlKCk7XG59O1xuXG5cbi8qKlxuICogUmV0dXJucyBhbnkgcXVldWUgZW50cmllcyB0aGF0IGhhdmUgbm90IHlldCBiZWVuIHJlcG9ydGVkIHRvIHRoZVxuICogY2FsbGJhY2sgYW5kIGNsZWFycyB0aGUgcXVldWUuIFRoaXMgY2FuIGJlIHVzZWQgaW4gY29uanVuY3Rpb24gd2l0aCB0aGVcbiAqIGNhbGxiYWNrIHRvIG9idGFpbiB0aGUgYWJzb2x1dGUgbW9zdCB1cC10by1kYXRlIGludGVyc2VjdGlvbiBpbmZvcm1hdGlvbi5cbiAqIEByZXR1cm4ge0FycmF5fSBUaGUgY3VycmVudGx5IHF1ZXVlZCBlbnRyaWVzLlxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUudGFrZVJlY29yZHMgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHJlY29yZHMgPSB0aGlzLl9xdWV1ZWRFbnRyaWVzLnNsaWNlKCk7XG4gIHRoaXMuX3F1ZXVlZEVudHJpZXMgPSBbXTtcbiAgcmV0dXJuIHJlY29yZHM7XG59O1xuXG5cbi8qKlxuICogQWNjZXB0cyB0aGUgdGhyZXNob2xkIHZhbHVlIGZyb20gdGhlIHVzZXIgY29uZmlndXJhdGlvbiBvYmplY3QgYW5kXG4gKiByZXR1cm5zIGEgc29ydGVkIGFycmF5IG9mIHVuaXF1ZSB0aHJlc2hvbGQgdmFsdWVzLiBJZiBhIHZhbHVlIGlzIG5vdFxuICogYmV0d2VlbiAwIGFuZCAxIGFuZCBlcnJvciBpcyB0aHJvd24uXG4gKiBAcHJpdmF0ZVxuICogQHBhcmFtIHtBcnJheXxudW1iZXI9fSBvcHRfdGhyZXNob2xkIEFuIG9wdGlvbmFsIHRocmVzaG9sZCB2YWx1ZSBvclxuICogICAgIGEgbGlzdCBvZiB0aHJlc2hvbGQgdmFsdWVzLCBkZWZhdWx0aW5nIHRvIFswXS5cbiAqIEByZXR1cm4ge0FycmF5fSBBIHNvcnRlZCBsaXN0IG9mIHVuaXF1ZSBhbmQgdmFsaWQgdGhyZXNob2xkIHZhbHVlcy5cbiAqL1xuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLl9pbml0VGhyZXNob2xkcyA9IGZ1bmN0aW9uKG9wdF90aHJlc2hvbGQpIHtcbiAgdmFyIHRocmVzaG9sZCA9IG9wdF90aHJlc2hvbGQgfHwgWzBdO1xuICBpZiAoIUFycmF5LmlzQXJyYXkodGhyZXNob2xkKSkgdGhyZXNob2xkID0gW3RocmVzaG9sZF07XG5cbiAgcmV0dXJuIHRocmVzaG9sZC5zb3J0KCkuZmlsdGVyKGZ1bmN0aW9uKHQsIGksIGEpIHtcbiAgICBpZiAodHlwZW9mIHQgIT0gJ251bWJlcicgfHwgaXNOYU4odCkgfHwgdCA8IDAgfHwgdCA+IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcigndGhyZXNob2xkIG11c3QgYmUgYSBudW1iZXIgYmV0d2VlbiAwIGFuZCAxIGluY2x1c2l2ZWx5Jyk7XG4gICAgfVxuICAgIHJldHVybiB0ICE9PSBhW2kgLSAxXTtcbiAgfSk7XG59O1xuXG5cbi8qKlxuICogQWNjZXB0cyB0aGUgcm9vdE1hcmdpbiB2YWx1ZSBmcm9tIHRoZSB1c2VyIGNvbmZpZ3VyYXRpb24gb2JqZWN0XG4gKiBhbmQgcmV0dXJucyBhbiBhcnJheSBvZiB0aGUgZm91ciBtYXJnaW4gdmFsdWVzIGFzIGFuIG9iamVjdCBjb250YWluaW5nXG4gKiB0aGUgdmFsdWUgYW5kIHVuaXQgcHJvcGVydGllcy4gSWYgYW55IG9mIHRoZSB2YWx1ZXMgYXJlIG5vdCBwcm9wZXJseVxuICogZm9ybWF0dGVkIG9yIHVzZSBhIHVuaXQgb3RoZXIgdGhhbiBweCBvciAlLCBhbmQgZXJyb3IgaXMgdGhyb3duLlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7c3RyaW5nPX0gb3B0X3Jvb3RNYXJnaW4gQW4gb3B0aW9uYWwgcm9vdE1hcmdpbiB2YWx1ZSxcbiAqICAgICBkZWZhdWx0aW5nIHRvICcwcHgnLlxuICogQHJldHVybiB7QXJyYXk8T2JqZWN0Pn0gQW4gYXJyYXkgb2YgbWFyZ2luIG9iamVjdHMgd2l0aCB0aGUga2V5c1xuICogICAgIHZhbHVlIGFuZCB1bml0LlxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuX3BhcnNlUm9vdE1hcmdpbiA9IGZ1bmN0aW9uKG9wdF9yb290TWFyZ2luKSB7XG4gIHZhciBtYXJnaW5TdHJpbmcgPSBvcHRfcm9vdE1hcmdpbiB8fCAnMHB4JztcbiAgdmFyIG1hcmdpbnMgPSBtYXJnaW5TdHJpbmcuc3BsaXQoL1xccysvKS5tYXAoZnVuY3Rpb24obWFyZ2luKSB7XG4gICAgdmFyIHBhcnRzID0gL14oLT9cXGQqXFwuP1xcZCspKHB4fCUpJC8uZXhlYyhtYXJnaW4pO1xuICAgIGlmICghcGFydHMpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcigncm9vdE1hcmdpbiBtdXN0IGJlIHNwZWNpZmllZCBpbiBwaXhlbHMgb3IgcGVyY2VudCcpO1xuICAgIH1cbiAgICByZXR1cm4ge3ZhbHVlOiBwYXJzZUZsb2F0KHBhcnRzWzFdKSwgdW5pdDogcGFydHNbMl19O1xuICB9KTtcblxuICAvLyBIYW5kbGVzIHNob3J0aGFuZC5cbiAgbWFyZ2luc1sxXSA9IG1hcmdpbnNbMV0gfHwgbWFyZ2luc1swXTtcbiAgbWFyZ2luc1syXSA9IG1hcmdpbnNbMl0gfHwgbWFyZ2luc1swXTtcbiAgbWFyZ2luc1szXSA9IG1hcmdpbnNbM10gfHwgbWFyZ2luc1sxXTtcblxuICByZXR1cm4gbWFyZ2lucztcbn07XG5cblxuLyoqXG4gKiBTdGFydHMgcG9sbGluZyBmb3IgaW50ZXJzZWN0aW9uIGNoYW5nZXMgaWYgdGhlIHBvbGxpbmcgaXMgbm90IGFscmVhZHlcbiAqIGhhcHBlbmluZywgYW5kIGlmIHRoZSBwYWdlJ3MgdmlzaWJpbHR5IHN0YXRlIGlzIHZpc2libGUuXG4gKiBAcHJpdmF0ZVxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuX21vbml0b3JJbnRlcnNlY3Rpb25zID0gZnVuY3Rpb24oKSB7XG4gIGlmICghdGhpcy5fbW9uaXRvcmluZ0ludGVyc2VjdGlvbnMpIHtcbiAgICB0aGlzLl9tb25pdG9yaW5nSW50ZXJzZWN0aW9ucyA9IHRydWU7XG5cbiAgICB0aGlzLl9jaGVja0ZvckludGVyc2VjdGlvbnMoKTtcblxuICAgIC8vIElmIGEgcG9sbCBpbnRlcnZhbCBpcyBzZXQsIHVzZSBwb2xsaW5nIGluc3RlYWQgb2YgbGlzdGVuaW5nIHRvXG4gICAgLy8gcmVzaXplIGFuZCBzY3JvbGwgZXZlbnRzIG9yIERPTSBtdXRhdGlvbnMuXG4gICAgaWYgKHRoaXMuUE9MTF9JTlRFUlZBTCkge1xuICAgICAgdGhpcy5fbW9uaXRvcmluZ0ludGVydmFsID0gc2V0SW50ZXJ2YWwoXG4gICAgICAgICAgdGhpcy5fY2hlY2tGb3JJbnRlcnNlY3Rpb25zLCB0aGlzLlBPTExfSU5URVJWQUwpO1xuICAgIH1cbiAgICBlbHNlIHtcbiAgICAgIGFkZEV2ZW50KHdpbmRvdywgJ3Jlc2l6ZScsIHRoaXMuX2NoZWNrRm9ySW50ZXJzZWN0aW9ucywgdHJ1ZSk7XG4gICAgICBhZGRFdmVudChkb2N1bWVudCwgJ3Njcm9sbCcsIHRoaXMuX2NoZWNrRm9ySW50ZXJzZWN0aW9ucywgdHJ1ZSk7XG5cbiAgICAgIGlmICgnTXV0YXRpb25PYnNlcnZlcicgaW4gd2luZG93KSB7XG4gICAgICAgIHRoaXMuX2RvbU9ic2VydmVyID0gbmV3IE11dGF0aW9uT2JzZXJ2ZXIodGhpcy5fY2hlY2tGb3JJbnRlcnNlY3Rpb25zKTtcbiAgICAgICAgdGhpcy5fZG9tT2JzZXJ2ZXIub2JzZXJ2ZShkb2N1bWVudCwge1xuICAgICAgICAgIGF0dHJpYnV0ZXM6IHRydWUsXG4gICAgICAgICAgY2hpbGRMaXN0OiB0cnVlLFxuICAgICAgICAgIGNoYXJhY3RlckRhdGE6IHRydWUsXG4gICAgICAgICAgc3VidHJlZTogdHJ1ZVxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn07XG5cblxuLyoqXG4gKiBTdG9wcyBwb2xsaW5nIGZvciBpbnRlcnNlY3Rpb24gY2hhbmdlcy5cbiAqIEBwcml2YXRlXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5fdW5tb25pdG9ySW50ZXJzZWN0aW9ucyA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5fbW9uaXRvcmluZ0ludGVyc2VjdGlvbnMpIHtcbiAgICB0aGlzLl9tb25pdG9yaW5nSW50ZXJzZWN0aW9ucyA9IGZhbHNlO1xuXG4gICAgY2xlYXJJbnRlcnZhbCh0aGlzLl9tb25pdG9yaW5nSW50ZXJ2YWwpO1xuICAgIHRoaXMuX21vbml0b3JpbmdJbnRlcnZhbCA9IG51bGw7XG5cbiAgICByZW1vdmVFdmVudCh3aW5kb3csICdyZXNpemUnLCB0aGlzLl9jaGVja0ZvckludGVyc2VjdGlvbnMsIHRydWUpO1xuICAgIHJlbW92ZUV2ZW50KGRvY3VtZW50LCAnc2Nyb2xsJywgdGhpcy5fY2hlY2tGb3JJbnRlcnNlY3Rpb25zLCB0cnVlKTtcblxuICAgIGlmICh0aGlzLl9kb21PYnNlcnZlcikge1xuICAgICAgdGhpcy5fZG9tT2JzZXJ2ZXIuZGlzY29ubmVjdCgpO1xuICAgICAgdGhpcy5fZG9tT2JzZXJ2ZXIgPSBudWxsO1xuICAgIH1cbiAgfVxufTtcblxuXG4vKipcbiAqIFNjYW5zIGVhY2ggb2JzZXJ2YXRpb24gdGFyZ2V0IGZvciBpbnRlcnNlY3Rpb24gY2hhbmdlcyBhbmQgYWRkcyB0aGVtXG4gKiB0byB0aGUgaW50ZXJuYWwgZW50cmllcyBxdWV1ZS4gSWYgbmV3IGVudHJpZXMgYXJlIGZvdW5kLCBpdFxuICogc2NoZWR1bGVzIHRoZSBjYWxsYmFjayB0byBiZSBpbnZva2VkLlxuICogQHByaXZhdGVcbiAqL1xuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLl9jaGVja0ZvckludGVyc2VjdGlvbnMgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHJvb3RJc0luRG9tID0gdGhpcy5fcm9vdElzSW5Eb20oKTtcbiAgdmFyIHJvb3RSZWN0ID0gcm9vdElzSW5Eb20gPyB0aGlzLl9nZXRSb290UmVjdCgpIDogZ2V0RW1wdHlSZWN0KCk7XG5cbiAgdGhpcy5fb2JzZXJ2YXRpb25UYXJnZXRzLmZvckVhY2goZnVuY3Rpb24oaXRlbSkge1xuICAgIHZhciB0YXJnZXQgPSBpdGVtLmVsZW1lbnQ7XG4gICAgdmFyIHRhcmdldFJlY3QgPSBnZXRCb3VuZGluZ0NsaWVudFJlY3QodGFyZ2V0KTtcbiAgICB2YXIgcm9vdENvbnRhaW5zVGFyZ2V0ID0gdGhpcy5fcm9vdENvbnRhaW5zVGFyZ2V0KHRhcmdldCk7XG4gICAgdmFyIG9sZEVudHJ5ID0gaXRlbS5lbnRyeTtcbiAgICB2YXIgaW50ZXJzZWN0aW9uUmVjdCA9IHJvb3RJc0luRG9tICYmIHJvb3RDb250YWluc1RhcmdldCAmJlxuICAgICAgICB0aGlzLl9jb21wdXRlVGFyZ2V0QW5kUm9vdEludGVyc2VjdGlvbih0YXJnZXQsIHJvb3RSZWN0KTtcblxuICAgIHZhciBuZXdFbnRyeSA9IGl0ZW0uZW50cnkgPSBuZXcgSW50ZXJzZWN0aW9uT2JzZXJ2ZXJFbnRyeSh7XG4gICAgICB0aW1lOiBub3coKSxcbiAgICAgIHRhcmdldDogdGFyZ2V0LFxuICAgICAgYm91bmRpbmdDbGllbnRSZWN0OiB0YXJnZXRSZWN0LFxuICAgICAgcm9vdEJvdW5kczogcm9vdFJlY3QsXG4gICAgICBpbnRlcnNlY3Rpb25SZWN0OiBpbnRlcnNlY3Rpb25SZWN0XG4gICAgfSk7XG5cbiAgICBpZiAoIW9sZEVudHJ5KSB7XG4gICAgICB0aGlzLl9xdWV1ZWRFbnRyaWVzLnB1c2gobmV3RW50cnkpO1xuICAgIH0gZWxzZSBpZiAocm9vdElzSW5Eb20gJiYgcm9vdENvbnRhaW5zVGFyZ2V0KSB7XG4gICAgICAvLyBJZiB0aGUgbmV3IGVudHJ5IGludGVyc2VjdGlvbiByYXRpbyBoYXMgY3Jvc3NlZCBhbnkgb2YgdGhlXG4gICAgICAvLyB0aHJlc2hvbGRzLCBhZGQgYSBuZXcgZW50cnkuXG4gICAgICBpZiAodGhpcy5faGFzQ3Jvc3NlZFRocmVzaG9sZChvbGRFbnRyeSwgbmV3RW50cnkpKSB7XG4gICAgICAgIHRoaXMuX3F1ZXVlZEVudHJpZXMucHVzaChuZXdFbnRyeSk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIElmIHRoZSByb290IGlzIG5vdCBpbiB0aGUgRE9NIG9yIHRhcmdldCBpcyBub3QgY29udGFpbmVkIHdpdGhpblxuICAgICAgLy8gcm9vdCBidXQgdGhlIHByZXZpb3VzIGVudHJ5IGZvciB0aGlzIHRhcmdldCBoYWQgYW4gaW50ZXJzZWN0aW9uLFxuICAgICAgLy8gYWRkIGEgbmV3IHJlY29yZCBpbmRpY2F0aW5nIHJlbW92YWwuXG4gICAgICBpZiAob2xkRW50cnkgJiYgb2xkRW50cnkuaXNJbnRlcnNlY3RpbmcpIHtcbiAgICAgICAgdGhpcy5fcXVldWVkRW50cmllcy5wdXNoKG5ld0VudHJ5KTtcbiAgICAgIH1cbiAgICB9XG4gIH0sIHRoaXMpO1xuXG4gIGlmICh0aGlzLl9xdWV1ZWRFbnRyaWVzLmxlbmd0aCkge1xuICAgIHRoaXMuX2NhbGxiYWNrKHRoaXMudGFrZVJlY29yZHMoKSwgdGhpcyk7XG4gIH1cbn07XG5cblxuLyoqXG4gKiBBY2NlcHRzIGEgdGFyZ2V0IGFuZCByb290IHJlY3QgY29tcHV0ZXMgdGhlIGludGVyc2VjdGlvbiBiZXR3ZWVuIHRoZW5cbiAqIGZvbGxvd2luZyB0aGUgYWxnb3JpdGhtIGluIHRoZSBzcGVjLlxuICogVE9ETyhwaGlsaXB3YWx0b24pOiBhdCB0aGlzIHRpbWUgY2xpcC1wYXRoIGlzIG5vdCBjb25zaWRlcmVkLlxuICogaHR0cHM6Ly93aWNnLmdpdGh1Yi5pby9JbnRlcnNlY3Rpb25PYnNlcnZlci8jY2FsY3VsYXRlLWludGVyc2VjdGlvbi1yZWN0LWFsZ29cbiAqIEBwYXJhbSB7RWxlbWVudH0gdGFyZ2V0IFRoZSB0YXJnZXQgRE9NIGVsZW1lbnRcbiAqIEBwYXJhbSB7T2JqZWN0fSByb290UmVjdCBUaGUgYm91bmRpbmcgcmVjdCBvZiB0aGUgcm9vdCBhZnRlciBiZWluZ1xuICogICAgIGV4cGFuZGVkIGJ5IHRoZSByb290TWFyZ2luIHZhbHVlLlxuICogQHJldHVybiB7P09iamVjdH0gVGhlIGZpbmFsIGludGVyc2VjdGlvbiByZWN0IG9iamVjdCBvciB1bmRlZmluZWQgaWYgbm9cbiAqICAgICBpbnRlcnNlY3Rpb24gaXMgZm91bmQuXG4gKiBAcHJpdmF0ZVxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuX2NvbXB1dGVUYXJnZXRBbmRSb290SW50ZXJzZWN0aW9uID1cbiAgICBmdW5jdGlvbih0YXJnZXQsIHJvb3RSZWN0KSB7XG5cbiAgLy8gSWYgdGhlIGVsZW1lbnQgaXNuJ3QgZGlzcGxheWVkLCBhbiBpbnRlcnNlY3Rpb24gY2FuJ3QgaGFwcGVuLlxuICBpZiAod2luZG93LmdldENvbXB1dGVkU3R5bGUodGFyZ2V0KS5kaXNwbGF5ID09ICdub25lJykgcmV0dXJuO1xuXG4gIHZhciB0YXJnZXRSZWN0ID0gZ2V0Qm91bmRpbmdDbGllbnRSZWN0KHRhcmdldCk7XG4gIHZhciBpbnRlcnNlY3Rpb25SZWN0ID0gdGFyZ2V0UmVjdDtcbiAgdmFyIHBhcmVudCA9IHRhcmdldC5wYXJlbnROb2RlO1xuICB2YXIgYXRSb290ID0gZmFsc2U7XG5cbiAgd2hpbGUgKCFhdFJvb3QpIHtcbiAgICB2YXIgcGFyZW50UmVjdCA9IG51bGw7XG5cbiAgICAvLyBJZiB3ZSdyZSBhdCB0aGUgcm9vdCBlbGVtZW50LCBzZXQgcGFyZW50UmVjdCB0byB0aGUgYWxyZWFkeVxuICAgIC8vIGNhbGN1bGF0ZWQgcm9vdFJlY3QuIEFuZCBzaW5jZSA8Ym9keT4gYW5kIDxodG1sPiBjYW5ub3QgYmUgY2xpcHBlZFxuICAgIC8vIHRvIGEgcmVjdCB0aGF0J3Mgbm90IGFsc28gdGhlIGRvY3VtZW50IHJlY3QsIGNvbnNpZGVyIHRoZW0gcm9vdCB0b28uXG4gICAgaWYgKHBhcmVudCA9PSB0aGlzLnJvb3QgfHxcbiAgICAgICAgcGFyZW50ID09IGRvY3VtZW50LmJvZHkgfHxcbiAgICAgICAgcGFyZW50ID09IGRvY3VtZW50LmRvY3VtZW50RWxlbWVudCB8fFxuICAgICAgICBwYXJlbnQubm9kZVR5cGUgIT0gMSkge1xuICAgICAgYXRSb290ID0gdHJ1ZTtcbiAgICAgIHBhcmVudFJlY3QgPSByb290UmVjdDtcbiAgICB9XG4gICAgLy8gT3RoZXJ3aXNlIGNoZWNrIHRvIHNlZSBpZiB0aGUgcGFyZW50IGVsZW1lbnQgaGlkZXMgb3ZlcmZsb3csXG4gICAgLy8gYW5kIGlmIHNvIHVwZGF0ZSBwYXJlbnRSZWN0LlxuICAgIGVsc2Uge1xuICAgICAgaWYgKHdpbmRvdy5nZXRDb21wdXRlZFN0eWxlKHBhcmVudCkub3ZlcmZsb3cgIT0gJ3Zpc2libGUnKSB7XG4gICAgICAgIHBhcmVudFJlY3QgPSBnZXRCb3VuZGluZ0NsaWVudFJlY3QocGFyZW50KTtcbiAgICAgIH1cbiAgICB9XG4gICAgLy8gSWYgZWl0aGVyIG9mIHRoZSBhYm92ZSBjb25kaXRpb25hbHMgc2V0IGEgbmV3IHBhcmVudFJlY3QsXG4gICAgLy8gY2FsY3VsYXRlIG5ldyBpbnRlcnNlY3Rpb24gZGF0YS5cbiAgICBpZiAocGFyZW50UmVjdCkge1xuICAgICAgaW50ZXJzZWN0aW9uUmVjdCA9IGNvbXB1dGVSZWN0SW50ZXJzZWN0aW9uKHBhcmVudFJlY3QsIGludGVyc2VjdGlvblJlY3QpO1xuXG4gICAgICBpZiAoIWludGVyc2VjdGlvblJlY3QpIGJyZWFrO1xuICAgIH1cbiAgICBwYXJlbnQgPSBwYXJlbnQucGFyZW50Tm9kZTtcbiAgfVxuICByZXR1cm4gaW50ZXJzZWN0aW9uUmVjdDtcbn07XG5cblxuLyoqXG4gKiBSZXR1cm5zIHRoZSByb290IHJlY3QgYWZ0ZXIgYmVpbmcgZXhwYW5kZWQgYnkgdGhlIHJvb3RNYXJnaW4gdmFsdWUuXG4gKiBAcmV0dXJuIHtPYmplY3R9IFRoZSBleHBhbmRlZCByb290IHJlY3QuXG4gKiBAcHJpdmF0ZVxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuX2dldFJvb3RSZWN0ID0gZnVuY3Rpb24oKSB7XG4gIHZhciByb290UmVjdDtcbiAgaWYgKHRoaXMucm9vdCkge1xuICAgIHJvb3RSZWN0ID0gZ2V0Qm91bmRpbmdDbGllbnRSZWN0KHRoaXMucm9vdCk7XG4gIH0gZWxzZSB7XG4gICAgLy8gVXNlIDxodG1sPi88Ym9keT4gaW5zdGVhZCBvZiB3aW5kb3cgc2luY2Ugc2Nyb2xsIGJhcnMgYWZmZWN0IHNpemUuXG4gICAgdmFyIGh0bWwgPSBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQ7XG4gICAgdmFyIGJvZHkgPSBkb2N1bWVudC5ib2R5O1xuICAgIHJvb3RSZWN0ID0ge1xuICAgICAgdG9wOiAwLFxuICAgICAgbGVmdDogMCxcbiAgICAgIHJpZ2h0OiBodG1sLmNsaWVudFdpZHRoIHx8IGJvZHkuY2xpZW50V2lkdGgsXG4gICAgICB3aWR0aDogaHRtbC5jbGllbnRXaWR0aCB8fCBib2R5LmNsaWVudFdpZHRoLFxuICAgICAgYm90dG9tOiBodG1sLmNsaWVudEhlaWdodCB8fCBib2R5LmNsaWVudEhlaWdodCxcbiAgICAgIGhlaWdodDogaHRtbC5jbGllbnRIZWlnaHQgfHwgYm9keS5jbGllbnRIZWlnaHRcbiAgICB9O1xuICB9XG4gIHJldHVybiB0aGlzLl9leHBhbmRSZWN0QnlSb290TWFyZ2luKHJvb3RSZWN0KTtcbn07XG5cblxuLyoqXG4gKiBBY2NlcHRzIGEgcmVjdCBhbmQgZXhwYW5kcyBpdCBieSB0aGUgcm9vdE1hcmdpbiB2YWx1ZS5cbiAqIEBwYXJhbSB7T2JqZWN0fSByZWN0IFRoZSByZWN0IG9iamVjdCB0byBleHBhbmQuXG4gKiBAcmV0dXJuIHtPYmplY3R9IFRoZSBleHBhbmRlZCByZWN0LlxuICogQHByaXZhdGVcbiAqL1xuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLl9leHBhbmRSZWN0QnlSb290TWFyZ2luID0gZnVuY3Rpb24ocmVjdCkge1xuICB2YXIgbWFyZ2lucyA9IHRoaXMuX3Jvb3RNYXJnaW5WYWx1ZXMubWFwKGZ1bmN0aW9uKG1hcmdpbiwgaSkge1xuICAgIHJldHVybiBtYXJnaW4udW5pdCA9PSAncHgnID8gbWFyZ2luLnZhbHVlIDpcbiAgICAgICAgbWFyZ2luLnZhbHVlICogKGkgJSAyID8gcmVjdC53aWR0aCA6IHJlY3QuaGVpZ2h0KSAvIDEwMDtcbiAgfSk7XG4gIHZhciBuZXdSZWN0ID0ge1xuICAgIHRvcDogcmVjdC50b3AgLSBtYXJnaW5zWzBdLFxuICAgIHJpZ2h0OiByZWN0LnJpZ2h0ICsgbWFyZ2luc1sxXSxcbiAgICBib3R0b206IHJlY3QuYm90dG9tICsgbWFyZ2luc1syXSxcbiAgICBsZWZ0OiByZWN0LmxlZnQgLSBtYXJnaW5zWzNdXG4gIH07XG4gIG5ld1JlY3Qud2lkdGggPSBuZXdSZWN0LnJpZ2h0IC0gbmV3UmVjdC5sZWZ0O1xuICBuZXdSZWN0LmhlaWdodCA9IG5ld1JlY3QuYm90dG9tIC0gbmV3UmVjdC50b3A7XG5cbiAgcmV0dXJuIG5ld1JlY3Q7XG59O1xuXG5cbi8qKlxuICogQWNjZXB0cyBhbiBvbGQgYW5kIG5ldyBlbnRyeSBhbmQgcmV0dXJucyB0cnVlIGlmIGF0IGxlYXN0IG9uZSBvZiB0aGVcbiAqIHRocmVzaG9sZCB2YWx1ZXMgaGFzIGJlZW4gY3Jvc3NlZC5cbiAqIEBwYXJhbSB7P0ludGVyc2VjdGlvbk9ic2VydmVyRW50cnl9IG9sZEVudHJ5IFRoZSBwcmV2aW91cyBlbnRyeSBmb3IgYVxuICogICAgcGFydGljdWxhciB0YXJnZXQgZWxlbWVudCBvciBudWxsIGlmIG5vIHByZXZpb3VzIGVudHJ5IGV4aXN0cy5cbiAqIEBwYXJhbSB7SW50ZXJzZWN0aW9uT2JzZXJ2ZXJFbnRyeX0gbmV3RW50cnkgVGhlIGN1cnJlbnQgZW50cnkgZm9yIGFcbiAqICAgIHBhcnRpY3VsYXIgdGFyZ2V0IGVsZW1lbnQuXG4gKiBAcmV0dXJuIHtib29sZWFufSBSZXR1cm5zIHRydWUgaWYgYSBhbnkgdGhyZXNob2xkIGhhcyBiZWVuIGNyb3NzZWQuXG4gKiBAcHJpdmF0ZVxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuX2hhc0Nyb3NzZWRUaHJlc2hvbGQgPVxuICAgIGZ1bmN0aW9uKG9sZEVudHJ5LCBuZXdFbnRyeSkge1xuXG4gIC8vIFRvIG1ha2UgY29tcGFyaW5nIGVhc2llciwgYW4gZW50cnkgdGhhdCBoYXMgYSByYXRpbyBvZiAwXG4gIC8vIGJ1dCBkb2VzIG5vdCBhY3R1YWxseSBpbnRlcnNlY3QgaXMgZ2l2ZW4gYSB2YWx1ZSBvZiAtMVxuICB2YXIgb2xkUmF0aW8gPSBvbGRFbnRyeSAmJiBvbGRFbnRyeS5pc0ludGVyc2VjdGluZyA/XG4gICAgICBvbGRFbnRyeS5pbnRlcnNlY3Rpb25SYXRpbyB8fCAwIDogLTE7XG4gIHZhciBuZXdSYXRpbyA9IG5ld0VudHJ5LmlzSW50ZXJzZWN0aW5nID9cbiAgICAgIG5ld0VudHJ5LmludGVyc2VjdGlvblJhdGlvIHx8IDAgOiAtMTtcblxuICAvLyBJZ25vcmUgdW5jaGFuZ2VkIHJhdGlvc1xuICBpZiAob2xkUmF0aW8gPT09IG5ld1JhdGlvKSByZXR1cm47XG5cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLnRocmVzaG9sZHMubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgdGhyZXNob2xkID0gdGhpcy50aHJlc2hvbGRzW2ldO1xuXG4gICAgLy8gUmV0dXJuIHRydWUgaWYgYW4gZW50cnkgbWF0Y2hlcyBhIHRocmVzaG9sZCBvciBpZiB0aGUgbmV3IHJhdGlvXG4gICAgLy8gYW5kIHRoZSBvbGQgcmF0aW8gYXJlIG9uIHRoZSBvcHBvc2l0ZSBzaWRlcyBvZiBhIHRocmVzaG9sZC5cbiAgICBpZiAodGhyZXNob2xkID09IG9sZFJhdGlvIHx8IHRocmVzaG9sZCA9PSBuZXdSYXRpbyB8fFxuICAgICAgICB0aHJlc2hvbGQgPCBvbGRSYXRpbyAhPT0gdGhyZXNob2xkIDwgbmV3UmF0aW8pIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgfVxufTtcblxuXG4vKipcbiAqIFJldHVybnMgd2hldGhlciBvciBub3QgdGhlIHJvb3QgZWxlbWVudCBpcyBhbiBlbGVtZW50IGFuZCBpcyBpbiB0aGUgRE9NLlxuICogQHJldHVybiB7Ym9vbGVhbn0gVHJ1ZSBpZiB0aGUgcm9vdCBlbGVtZW50IGlzIGFuIGVsZW1lbnQgYW5kIGlzIGluIHRoZSBET00uXG4gKiBAcHJpdmF0ZVxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuX3Jvb3RJc0luRG9tID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiAhdGhpcy5yb290IHx8IGNvbnRhaW5zRGVlcChkb2N1bWVudCwgdGhpcy5yb290KTtcbn07XG5cblxuLyoqXG4gKiBSZXR1cm5zIHdoZXRoZXIgb3Igbm90IHRoZSB0YXJnZXQgZWxlbWVudCBpcyBhIGNoaWxkIG9mIHJvb3QuXG4gKiBAcGFyYW0ge0VsZW1lbnR9IHRhcmdldCBUaGUgdGFyZ2V0IGVsZW1lbnQgdG8gY2hlY2suXG4gKiBAcmV0dXJuIHtib29sZWFufSBUcnVlIGlmIHRoZSB0YXJnZXQgZWxlbWVudCBpcyBhIGNoaWxkIG9mIHJvb3QuXG4gKiBAcHJpdmF0ZVxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuX3Jvb3RDb250YWluc1RhcmdldCA9IGZ1bmN0aW9uKHRhcmdldCkge1xuICByZXR1cm4gY29udGFpbnNEZWVwKHRoaXMucm9vdCB8fCBkb2N1bWVudCwgdGFyZ2V0KTtcbn07XG5cblxuLyoqXG4gKiBBZGRzIHRoZSBpbnN0YW5jZSB0byB0aGUgZ2xvYmFsIEludGVyc2VjdGlvbk9ic2VydmVyIHJlZ2lzdHJ5IGlmIGl0IGlzbid0XG4gKiBhbHJlYWR5IHByZXNlbnQuXG4gKiBAcHJpdmF0ZVxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuX3JlZ2lzdGVySW5zdGFuY2UgPSBmdW5jdGlvbigpIHtcbiAgaWYgKHJlZ2lzdHJ5LmluZGV4T2YodGhpcykgPCAwKSB7XG4gICAgcmVnaXN0cnkucHVzaCh0aGlzKTtcbiAgfVxufTtcblxuXG4vKipcbiAqIFJlbW92ZXMgdGhlIGluc3RhbmNlIGZyb20gdGhlIGdsb2JhbCBJbnRlcnNlY3Rpb25PYnNlcnZlciByZWdpc3RyeS5cbiAqIEBwcml2YXRlXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5fdW5yZWdpc3Rlckluc3RhbmNlID0gZnVuY3Rpb24oKSB7XG4gIHZhciBpbmRleCA9IHJlZ2lzdHJ5LmluZGV4T2YodGhpcyk7XG4gIGlmIChpbmRleCAhPSAtMSkgcmVnaXN0cnkuc3BsaWNlKGluZGV4LCAxKTtcbn07XG5cblxuLyoqXG4gKiBSZXR1cm5zIHRoZSByZXN1bHQgb2YgdGhlIHBlcmZvcm1hbmNlLm5vdygpIG1ldGhvZCBvciBudWxsIGluIGJyb3dzZXJzXG4gKiB0aGF0IGRvbid0IHN1cHBvcnQgdGhlIEFQSS5cbiAqIEByZXR1cm4ge251bWJlcn0gVGhlIGVsYXBzZWQgdGltZSBzaW5jZSB0aGUgcGFnZSB3YXMgcmVxdWVzdGVkLlxuICovXG5mdW5jdGlvbiBub3coKSB7XG4gIHJldHVybiB3aW5kb3cucGVyZm9ybWFuY2UgJiYgcGVyZm9ybWFuY2Uubm93ICYmIHBlcmZvcm1hbmNlLm5vdygpO1xufVxuXG5cbi8qKlxuICogVGhyb3R0bGVzIGEgZnVuY3Rpb24gYW5kIGRlbGF5cyBpdHMgZXhlY3V0aW9uZywgc28gaXQncyBvbmx5IGNhbGxlZCBhdCBtb3N0XG4gKiBvbmNlIHdpdGhpbiBhIGdpdmVuIHRpbWUgcGVyaW9kLlxuICogQHBhcmFtIHtGdW5jdGlvbn0gZm4gVGhlIGZ1bmN0aW9uIHRvIHRocm90dGxlLlxuICogQHBhcmFtIHtudW1iZXJ9IHRpbWVvdXQgVGhlIGFtb3VudCBvZiB0aW1lIHRoYXQgbXVzdCBwYXNzIGJlZm9yZSB0aGVcbiAqICAgICBmdW5jdGlvbiBjYW4gYmUgY2FsbGVkIGFnYWluLlxuICogQHJldHVybiB7RnVuY3Rpb259IFRoZSB0aHJvdHRsZWQgZnVuY3Rpb24uXG4gKi9cbmZ1bmN0aW9uIHRocm90dGxlKGZuLCB0aW1lb3V0KSB7XG4gIHZhciB0aW1lciA9IG51bGw7XG4gIHJldHVybiBmdW5jdGlvbiAoKSB7XG4gICAgaWYgKCF0aW1lcikge1xuICAgICAgdGltZXIgPSBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgICBmbigpO1xuICAgICAgICB0aW1lciA9IG51bGw7XG4gICAgICB9LCB0aW1lb3V0KTtcbiAgICB9XG4gIH07XG59XG5cblxuLyoqXG4gKiBBZGRzIGFuIGV2ZW50IGhhbmRsZXIgdG8gYSBET00gbm9kZSBlbnN1cmluZyBjcm9zcy1icm93c2VyIGNvbXBhdGliaWxpdHkuXG4gKiBAcGFyYW0ge05vZGV9IG5vZGUgVGhlIERPTSBub2RlIHRvIGFkZCB0aGUgZXZlbnQgaGFuZGxlciB0by5cbiAqIEBwYXJhbSB7c3RyaW5nfSBldmVudCBUaGUgZXZlbnQgbmFtZS5cbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZuIFRoZSBldmVudCBoYW5kbGVyIHRvIGFkZC5cbiAqIEBwYXJhbSB7Ym9vbGVhbn0gb3B0X3VzZUNhcHR1cmUgT3B0aW9uYWxseSBhZGRzIHRoZSBldmVuIHRvIHRoZSBjYXB0dXJlXG4gKiAgICAgcGhhc2UuIE5vdGU6IHRoaXMgb25seSB3b3JrcyBpbiBtb2Rlcm4gYnJvd3NlcnMuXG4gKi9cbmZ1bmN0aW9uIGFkZEV2ZW50KG5vZGUsIGV2ZW50LCBmbiwgb3B0X3VzZUNhcHR1cmUpIHtcbiAgaWYgKHR5cGVvZiBub2RlLmFkZEV2ZW50TGlzdGVuZXIgPT0gJ2Z1bmN0aW9uJykge1xuICAgIG5vZGUuYWRkRXZlbnRMaXN0ZW5lcihldmVudCwgZm4sIG9wdF91c2VDYXB0dXJlIHx8IGZhbHNlKTtcbiAgfVxuICBlbHNlIGlmICh0eXBlb2Ygbm9kZS5hdHRhY2hFdmVudCA9PSAnZnVuY3Rpb24nKSB7XG4gICAgbm9kZS5hdHRhY2hFdmVudCgnb24nICsgZXZlbnQsIGZuKTtcbiAgfVxufVxuXG5cbi8qKlxuICogUmVtb3ZlcyBhIHByZXZpb3VzbHkgYWRkZWQgZXZlbnQgaGFuZGxlciBmcm9tIGEgRE9NIG5vZGUuXG4gKiBAcGFyYW0ge05vZGV9IG5vZGUgVGhlIERPTSBub2RlIHRvIHJlbW92ZSB0aGUgZXZlbnQgaGFuZGxlciBmcm9tLlxuICogQHBhcmFtIHtzdHJpbmd9IGV2ZW50IFRoZSBldmVudCBuYW1lLlxuICogQHBhcmFtIHtGdW5jdGlvbn0gZm4gVGhlIGV2ZW50IGhhbmRsZXIgdG8gcmVtb3ZlLlxuICogQHBhcmFtIHtib29sZWFufSBvcHRfdXNlQ2FwdHVyZSBJZiB0aGUgZXZlbnQgaGFuZGxlciB3YXMgYWRkZWQgd2l0aCB0aGlzXG4gKiAgICAgZmxhZyBzZXQgdG8gdHJ1ZSwgaXQgc2hvdWxkIGJlIHNldCB0byB0cnVlIGhlcmUgaW4gb3JkZXIgdG8gcmVtb3ZlIGl0LlxuICovXG5mdW5jdGlvbiByZW1vdmVFdmVudChub2RlLCBldmVudCwgZm4sIG9wdF91c2VDYXB0dXJlKSB7XG4gIGlmICh0eXBlb2Ygbm9kZS5yZW1vdmVFdmVudExpc3RlbmVyID09ICdmdW5jdGlvbicpIHtcbiAgICBub2RlLnJlbW92ZUV2ZW50TGlzdGVuZXIoZXZlbnQsIGZuLCBvcHRfdXNlQ2FwdHVyZSB8fCBmYWxzZSk7XG4gIH1cbiAgZWxzZSBpZiAodHlwZW9mIG5vZGUuZGV0YXRjaEV2ZW50ID09ICdmdW5jdGlvbicpIHtcbiAgICBub2RlLmRldGF0Y2hFdmVudCgnb24nICsgZXZlbnQsIGZuKTtcbiAgfVxufVxuXG5cbi8qKlxuICogUmV0dXJucyB0aGUgaW50ZXJzZWN0aW9uIGJldHdlZW4gdHdvIHJlY3Qgb2JqZWN0cy5cbiAqIEBwYXJhbSB7T2JqZWN0fSByZWN0MSBUaGUgZmlyc3QgcmVjdC5cbiAqIEBwYXJhbSB7T2JqZWN0fSByZWN0MiBUaGUgc2Vjb25kIHJlY3QuXG4gKiBAcmV0dXJuIHs/T2JqZWN0fSBUaGUgaW50ZXJzZWN0aW9uIHJlY3Qgb3IgdW5kZWZpbmVkIGlmIG5vIGludGVyc2VjdGlvblxuICogICAgIGlzIGZvdW5kLlxuICovXG5mdW5jdGlvbiBjb21wdXRlUmVjdEludGVyc2VjdGlvbihyZWN0MSwgcmVjdDIpIHtcbiAgdmFyIHRvcCA9IE1hdGgubWF4KHJlY3QxLnRvcCwgcmVjdDIudG9wKTtcbiAgdmFyIGJvdHRvbSA9IE1hdGgubWluKHJlY3QxLmJvdHRvbSwgcmVjdDIuYm90dG9tKTtcbiAgdmFyIGxlZnQgPSBNYXRoLm1heChyZWN0MS5sZWZ0LCByZWN0Mi5sZWZ0KTtcbiAgdmFyIHJpZ2h0ID0gTWF0aC5taW4ocmVjdDEucmlnaHQsIHJlY3QyLnJpZ2h0KTtcbiAgdmFyIHdpZHRoID0gcmlnaHQgLSBsZWZ0O1xuICB2YXIgaGVpZ2h0ID0gYm90dG9tIC0gdG9wO1xuXG4gIHJldHVybiAod2lkdGggPj0gMCAmJiBoZWlnaHQgPj0gMCkgJiYge1xuICAgIHRvcDogdG9wLFxuICAgIGJvdHRvbTogYm90dG9tLFxuICAgIGxlZnQ6IGxlZnQsXG4gICAgcmlnaHQ6IHJpZ2h0LFxuICAgIHdpZHRoOiB3aWR0aCxcbiAgICBoZWlnaHQ6IGhlaWdodFxuICB9O1xufVxuXG5cbi8qKlxuICogU2hpbXMgdGhlIG5hdGl2ZSBnZXRCb3VuZGluZ0NsaWVudFJlY3QgZm9yIGNvbXBhdGliaWxpdHkgd2l0aCBvbGRlciBJRS5cbiAqIEBwYXJhbSB7RWxlbWVudH0gZWwgVGhlIGVsZW1lbnQgd2hvc2UgYm91bmRpbmcgcmVjdCB0byBnZXQuXG4gKiBAcmV0dXJuIHtPYmplY3R9IFRoZSAocG9zc2libHkgc2hpbW1lZCkgcmVjdCBvZiB0aGUgZWxlbWVudC5cbiAqL1xuZnVuY3Rpb24gZ2V0Qm91bmRpbmdDbGllbnRSZWN0KGVsKSB7XG4gIHZhciByZWN0O1xuXG4gIHRyeSB7XG4gICAgcmVjdCA9IGVsLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICAvLyBJZ25vcmUgV2luZG93cyA3IElFMTEgXCJVbnNwZWNpZmllZCBlcnJvclwiXG4gICAgLy8gaHR0cHM6Ly9naXRodWIuY29tL1dJQ0cvSW50ZXJzZWN0aW9uT2JzZXJ2ZXIvcHVsbC8yMDVcbiAgfVxuXG4gIGlmICghcmVjdCkgcmV0dXJuIGdldEVtcHR5UmVjdCgpO1xuXG4gIC8vIE9sZGVyIElFXG4gIGlmICghKHJlY3Qud2lkdGggJiYgcmVjdC5oZWlnaHQpKSB7XG4gICAgcmVjdCA9IHtcbiAgICAgIHRvcDogcmVjdC50b3AsXG4gICAgICByaWdodDogcmVjdC5yaWdodCxcbiAgICAgIGJvdHRvbTogcmVjdC5ib3R0b20sXG4gICAgICBsZWZ0OiByZWN0LmxlZnQsXG4gICAgICB3aWR0aDogcmVjdC5yaWdodCAtIHJlY3QubGVmdCxcbiAgICAgIGhlaWdodDogcmVjdC5ib3R0b20gLSByZWN0LnRvcFxuICAgIH07XG4gIH1cbiAgcmV0dXJuIHJlY3Q7XG59XG5cblxuLyoqXG4gKiBSZXR1cm5zIGFuIGVtcHR5IHJlY3Qgb2JqZWN0LiBBbiBlbXB0eSByZWN0IGlzIHJldHVybmVkIHdoZW4gYW4gZWxlbWVudFxuICogaXMgbm90IGluIHRoZSBET00uXG4gKiBAcmV0dXJuIHtPYmplY3R9IFRoZSBlbXB0eSByZWN0LlxuICovXG5mdW5jdGlvbiBnZXRFbXB0eVJlY3QoKSB7XG4gIHJldHVybiB7XG4gICAgdG9wOiAwLFxuICAgIGJvdHRvbTogMCxcbiAgICBsZWZ0OiAwLFxuICAgIHJpZ2h0OiAwLFxuICAgIHdpZHRoOiAwLFxuICAgIGhlaWdodDogMFxuICB9O1xufVxuXG4vKipcbiAqIENoZWNrcyB0byBzZWUgaWYgYSBwYXJlbnQgZWxlbWVudCBjb250YWlucyBhIGNoaWxkIGVsZW1udCAoaW5jbHVkaW5nIGluc2lkZVxuICogc2hhZG93IERPTSkuXG4gKiBAcGFyYW0ge05vZGV9IHBhcmVudCBUaGUgcGFyZW50IGVsZW1lbnQuXG4gKiBAcGFyYW0ge05vZGV9IGNoaWxkIFRoZSBjaGlsZCBlbGVtZW50LlxuICogQHJldHVybiB7Ym9vbGVhbn0gVHJ1ZSBpZiB0aGUgcGFyZW50IG5vZGUgY29udGFpbnMgdGhlIGNoaWxkIG5vZGUuXG4gKi9cbmZ1bmN0aW9uIGNvbnRhaW5zRGVlcChwYXJlbnQsIGNoaWxkKSB7XG4gIHZhciBub2RlID0gY2hpbGQ7XG4gIHdoaWxlIChub2RlKSB7XG4gICAgLy8gQ2hlY2sgaWYgdGhlIG5vZGUgaXMgYSBzaGFkb3cgcm9vdCwgaWYgaXQgaXMgZ2V0IHRoZSBob3N0LlxuICAgIGlmIChub2RlLm5vZGVUeXBlID09IDExICYmIG5vZGUuaG9zdCkge1xuICAgICAgbm9kZSA9IG5vZGUuaG9zdDtcbiAgICB9XG5cbiAgICBpZiAobm9kZSA9PSBwYXJlbnQpIHJldHVybiB0cnVlO1xuXG4gICAgLy8gVHJhdmVyc2UgdXB3YXJkcyBpbiB0aGUgRE9NLlxuICAgIG5vZGUgPSBub2RlLnBhcmVudE5vZGU7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG5cbi8vIEV4cG9zZXMgdGhlIGNvbnN0cnVjdG9ycyBnbG9iYWxseS5cbndpbmRvdy5JbnRlcnNlY3Rpb25PYnNlcnZlciA9IEludGVyc2VjdGlvbk9ic2VydmVyO1xud2luZG93LkludGVyc2VjdGlvbk9ic2VydmVyRW50cnkgPSBJbnRlcnNlY3Rpb25PYnNlcnZlckVudHJ5O1xuXG59KHdpbmRvdywgZG9jdW1lbnQpKTtcbiIsIi8qKlxuICogRW52aXJvbm1lbnQgTW9kdWxlXG4gKiBAbW9kdWxlIEVudmlyb25tZW50L0Vudmlyb25tZW50XG4gKiByZXByZXNlbnRzIGZ1bmN0aW9ucyB0aGF0IGRlc2NyaWJlIHRoZSBjdXJyZW50IGVudmlyb25tZW50IHRoZSBtZWF1c3JlbWVudCBsaWJyYXJ5IGlzIHJ1bm5pbmcgaW5cbiAqL1xuXG4vKipcbiAqIEBwYXJhbSAge0hUTUxFbGVtZW50fSBlbGVtZW50IC0gYSBIVE1MIGVsZW1lbnQgdG8gZ2V0IHByb3BlcnRpZXMgZnJvbSBcbiAqIEByZXR1cm4ge09iamVjdH0gYW4gb2JqZWN0IGRlc2NyaWJpbmcgdGhlIHZhcmlvdXMgcGVydGl0bmVudCBlbnZpcm9ubWVudCBkZXRhaWxzXG4gKi9cbmV4cG9ydCBjb25zdCBnZXREZXRhaWxzID0gKGVsZW1lbnQgPSB7fSkgPT4ge1xuICByZXR1cm4ge1xuICAgIHZpZXdwb3J0V2lkdGg6IE1hdGgubWF4KGRvY3VtZW50LmJvZHkuY2xpZW50V2lkdGgsIHdpbmRvdy5pbm5lcldpZHRoKSB8fCAtMSxcbiAgICB2aWV3cG9ydEhlaWdodDogTWF0aC5tYXgoZG9jdW1lbnQuYm9keS5jbGllbnRIZWlnaHQsIHdpbmRvdy5pbm5lckhlaWdodCkgfHwgLTEsXG4gICAgZWxlbWVudFdpZHRoOiBlbGVtZW50LmNsaWVudFdpZHRoIHx8IC0xLFxuICAgIGVsZW1lbnRIZWlnaHQ6IGVsZW1lbnQuY2xpZW50SGVpZ2h0IHx8IC0xLFxuICAgIGlmcmFtZUNvbnRleHQ6IGlGcmFtZUNvbnRleHQoKSxcbiAgICBmb2N1czogaXNJbkZvY3VzKClcbiAgfVxufVxuXG4vKipcbiAqIEByZXR1cm4ge0Jvb2xlYW59IGRldGVybWluZXMgd2hldGhlciB0aGUgY3VycmVudCBwYWdlIGlzIGluIGZvY3VzXG4gKi9cbmV4cG9ydCBjb25zdCBpc0luRm9jdXMgPSAoKSA9PiB7XG4gIGlmIChkb2N1bWVudC5oaWRkZW4gIT09ICd1bmRlZmluZWQnKXtcbiAgICBpZiAoZG9jdW1lbnQuaGlkZGVuID09PSB0cnVlKXtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICBpZihpRnJhbWVDb250ZXh0KCkgPT09IGlGcmFtZVNlcnZpbmdTY2VuYXJpb3MuQ1JPU1NfRE9NQUlOX0lGUkFNRSkge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgaWYod2luZG93LmRvY3VtZW50Lmhhc0ZvY3VzKSB7XG4gICAgcmV0dXJuIHdpbmRvdy50b3AuZG9jdW1lbnQuaGFzRm9jdXMoKTtcbiAgfVxuXG4gIHJldHVybiB0cnVlO1xufVxuXG4vKipcbiAqIEByZXR1cm4ge1N0cmluZ30gcmV0dXJucyB0aGUgY3VycmVudCBpRnJhbWUgc2VydmluZyBjb250ZXh0LiBJdCdzIGVpdGhlciAnb24gcGFnZScsICdzYW1lIGRvbWFpbiBpZnJhbWUnLCBvciAnY3Jvc3MgZG9tYWluIGlmcmFtZSdcbiAqL1xuZXhwb3J0IGNvbnN0IGlGcmFtZUNvbnRleHQgPSAoKSA9PiB7XG4gIHRyeSB7XG4gICAgaWYod2luZG93LnRvcCA9PT0gd2luZG93KSB7XG4gICAgICByZXR1cm4gaUZyYW1lU2VydmluZ1NjZW5hcmlvcy5PTl9QQUdFXG4gICAgfVxuXG4gICAgbGV0IGN1cldpbiA9IHdpbmRvdywgbGV2ZWwgPSAwO1xuICAgIHdoaWxlKGN1cldpbi5wYXJlbnQgIT09IGN1cldpbiAmJiBsZXZlbCA8IDEwMDApIHtcbiAgICAgIGlmKGN1cldpbi5wYXJlbnQuZG9jdW1lbnQuZG9tYWluICE9PSBjdXJXaW4uZG9jdW1lbnQuZG9tYWluKSB7XG4gICAgICAgIHJldHVybiBpRnJhbWVTZXJ2aW5nU2NlbmFyaW9zLkNST1NTX0RPTUFJTl9JRlJBTUU7XG4gICAgICB9XG5cbiAgICAgIGN1cldpbiA9IGN1cldpbi5wYXJlbnQ7XG4gICAgfVxuICAgIGlGcmFtZVNlcnZpbmdTY2VuYXJpb3MuU0FNRV9ET01BSU5fSUZSQU1FO1xuICB9XG4gIGNhdGNoKGUpIHtcbiAgICByZXR1cm4gaUZyYW1lU2VydmluZ1NjZW5hcmlvcy5DUk9TU19ET01BSU5fSUZSQU1FXG4gIH1cbn1cblxuLyoqXG4gKiBjb25zdGFudHMgZGVzY3JpYmluZyBkaWZmZXJlbnQgdHlwZXMgb2YgaUZyYW1lIGNvbnRleHRzXG4gKiBAdHlwZSB7T2JqZWN0fVxuICovXG5leHBvcnQgY29uc3QgaUZyYW1lU2VydmluZ1NjZW5hcmlvcyA9IHtcbiAgT05fUEFHRTogJ29uIHBhZ2UnLFxuICBTQU1FX0RPTUFJTl9JRlJBTUU6ICdzYW1lIGRvbWFpbiBpZnJhbWUnLFxuICBDUk9TU19ET01BSU5fSUZSQU1FOiAnY3Jvc3MgZG9tYWluIGlmcmFtZSdcbn0iLCJpbXBvcnQgJ2FycmF5LWZpbmQnOyIsImltcG9ydCBCYXNlVGVjaG5pcXVlIGZyb20gJy4uL01lYXN1cmVtZW50L01lYXN1cmVtZW50VGVjaG5pcXVlcy9CYXNlVGVjaG5pcXVlJztcblxuLyoqXG4gKiBWYWxpZGF0b3JzIG1vZHVsZVxuICogQG1vZHVsZSBIZWxwZXJzL1ZhbGlkYXRvcnNcbiAqIHJlcHJlc2VudHMgZnVuY3Rpb25zIGZvciBjaGVja2luZyB0aGUgdmFsaWRpdGl5IG9mIGEgZ2l2ZW4gaW5wdXQgdmFsdWUgXG4gKi9cblxuLyoqXG4gKiBAcGFyYW0gIHtCYXNlVGVjaG5pcXVlfSB0ZWNobmlxdWUgLSB0ZWNobmlxdWUgdG8gY2hlY2sgZm9yIHZhbGlkaXR5XG4gKiBAcmV0dXJuIHtCb29sZWFufSBkZXRlcm1pbmF0aW9uIG9mIHdoZXRoZXIgdGhlIHRlY2huaXF1ZSBtZWV0cyB0aGUgbWluaW11bSBzdGFuZGFyZHMgXG4gKiBmb3IgbWVhc3VyaW5nIHZpZXdhYmlsaXR5IGFjY29yZGluZyB0byB0aGUgaW50ZXJmYWNlIGRlZmluZWQgYnkgQmFzZVRlY2huaXF1ZVxuICovXG5leHBvcnQgY29uc3QgdmFsaWRUZWNobmlxdWUgPSAodGVjaG5pcXVlKSA9PiB7XG4gIGNvbnN0IHZhbGlkID0gXG4gICAgdHlwZW9mIHRlY2huaXF1ZSA9PT0gJ2Z1bmN0aW9uJyAmJlxuICAgIE9iamVjdFxuICAgICAgLmdldE93blByb3BlcnR5TmFtZXMoQmFzZVRlY2huaXF1ZSlcbiAgICAgIC5yZWR1Y2UoIChwcm9wLCB2YWxpZCkgPT4gdmFsaWQgJiYgdHlwZW9mIHRlY2huaXF1ZVtwcm9wXSA9PT0gdHlwZW9mIEJhc2VUZWNobmlxdWVbcHJvcF0sIHRydWUpO1xuXG4gIHJldHVybiB2YWxpZDtcbn07XG5cbi8qKlxuICogQHBhcmFtICB7SFRNTEVsZW1lbnR9IGVsZW1lbnQgLSBlbGVtZW50IHRvIGNoZWNrIGZvciB2YWxpZGl0eVxuICogQHJldHVybiB7Qm9vbGVhbn0gZGV0ZXJtaW5lcyB3aGV0aGVyIGVsZW1lbnQgaXMgYW4gYWN0dWFsIEhUTUwgZWxlbWVudCBvciBhIHByb3h5IGVsZW1lbnQgKHdoaWNoIG1heSBiZSBwcm92aWRlZCBieSBHb29nbGUncyBJTUEgVlBBSUQgaG9zdCkgXG4gKi9cbmV4cG9ydCBjb25zdCB2YWxpZEVsZW1lbnQgPSAoZWxlbWVudCkgPT4ge1xuICByZXR1cm4gZWxlbWVudCAmJiBlbGVtZW50LnRvU3RyaW5nKCkuaW5kZXhPZignRWxlbWVudCcpID4gLTE7XG59O1xuXG4vKipcbiAqIEBwYXJhbSAge09iamVjdH0gb2JqIC0gdmlld2FiaWxpdHkgY3JpdGVyaWEgdG8gY2hlY2sgZm9yIHZhbGlkYWl0eS4gTm90ZSwgd2UncmUgdXNpbmcgRVM2IGRlc3RydWN0dXJpbmcgdG8gcHVsbCB0aGUgcHJvcGVydGllcyB3ZSB3YW50IHRvIHRlc3QgZnJvbSB0aGUgb2JqZWN0XG4gKiBAcGFyYW0gIHtOdW1iZXJ9IG9iai5pblZpZXdUaHJlc2hvbGQgLSBhbW91bnQgZWxlbWVudCBtdXN0IGJlIGluIHZpZXcgYnksIHRvIGJlIGNvdW50ZWQgYXMgaW4gdmlld1xuICogQHBhcmFtICB7TnVtYmVyfSBvYmoudGltZUluVmlldyAtIGR1cmF0aW9uIGVsZW1lbnQgbXVzdCBiZSBpbiB2aWV3IGZvciwgdG8gYmUgY29uc2lkZXJlZCB2aWV3YWJsZVxuICogQHJldHVybiB7T2JqZWN0fSBvYmplY3QgdGhhdCBjb250YWlucyBhIHByb3BlcnR5IGRlc2NyaWJpbmcgaWYgdGhlIGNyaXRlcmlhIG1lZXRzIHRoZSBleHBlY3RlZCByZXF1aXJlbWVudHMgYW5kIGlmIG5vdCwgd2hpY2ggYXNzZXJ0aW9ucyBpdCBmYWlsc1xuICovXG5leHBvcnQgY29uc3QgdmFsaWRhdGVDcml0ZXJpYSA9ICh7IGluVmlld1RocmVzaG9sZCwgdGltZUluVmlldyB9KSA9PiB7XG4gIGxldCBpbnZhbGlkID0gZmFsc2UsIHJlYXNvbnMgPSBbXTsgXG5cbiAgaWYodHlwZW9mIGluVmlld1RocmVzaG9sZCAhPT0gJ251bWJlcicgfHwgaW5WaWV3VGhyZXNob2xkID4gMSkge1xuICAgIGludmFsaWQgPSB0cnVlO1xuICAgIHJlYXNvbnMucHVzaCgnaW5WaWV3VGhyZXNob2xkIG11c3QgYmUgYSBudW1iZXIgZXF1YWwgdG8gb3IgbGVzcyB0aGFuIDEnKTtcbiAgfVxuXG4gIGlmKHR5cGVvZiB0aW1lSW5WaWV3ICE9PSAnbnVtYmVyJyB8fCB0aW1lSW5WaWV3IDwgMCkge1xuICAgIGludmFsaWQgPSB0cnVlO1xuICAgIHJlYXNvbnMucHVzaCgndGltZUluVmlldyBtdXN0IGJlIGEgbnVtYmVyIGdyZWF0ZXIgdG8gb3IgZXF1YWwgMCcpO1xuICB9XG5cbiAgcmV0dXJuIHsgaW52YWxpZCwgcmVhc29uczogcmVhc29ucy5qb2luKCcgfCAnKSB9O1xufTtcblxuLyoqXG4gKiBAcGFyYW0gIHtPYmplY3R9IG9iaiAtIHN0cmF0ZWd5IG9iamVjdCB0byB0ZXN0IGZvciB2YWxpZGl0eSBcbiAqIEBwYXJhbSAge0Jvb2xlYW59IG9iai5hdXRvc3RhcnQgLSBjb25maWd1cmVzIHdoZXRoZXIgdmlld2FiaWxpdHkgbWVhc3VyZW1lbnQgc2hvdWxkIGJlZ2luIGFzIHNvb24gYXMgdGVjaG5pcXVlIGlzIGNvbmZpZ3VyZWRcbiAqIEBwYXJhbSAge0FycmF5LjxCYXNlVGVjaG5pcXVlPn0gb2JqLnRlY2huaXF1ZXMgLSBsaXN0IG9mIG1lYXN1cmVtZW50IHRlY2huaXF1ZXMgdG8gdXNlXG4gKiBAcGFyYW0gIHtPYmplY3R9IG9iai5jcml0ZXJpYSAtIG1lYXN1cmVtZW50IGNyaXRlcmlhIHRvIHVzZSB0byBkZXRlcm1pbmUgaWYgYW4gZWxlbWVudCBpcyB2aWV3YWJsZVxuICogQHJldHVybiB7T2JqZWN0fSBvYmplY3QgZGVzY3JpYmluZyB3aGV0aGVyIHRoZSB0ZXN0ZWQgc3RyYXRlZ3kgaXMgaW52YWxpZCBhbmQgaWYgc28sIHdoYXQgaXMgdGhlIHJlYXNvbiBmb3IgYmVpbmcgaW52YWxpZFxuICovXG5leHBvcnQgY29uc3QgdmFsaWRhdGVTdHJhdGVneSA9ICh7IGF1dG9zdGFydCwgdGVjaG5pcXVlcywgY3JpdGVyaWEgfSkgPT4ge1xuICBsZXQgaW52YWxpZCA9IGZhbHNlLCByZWFzb25zID0gW107XG5cbiAgaWYodHlwZW9mIGF1dG9zdGFydCAhPT0gJ2Jvb2xlYW4nKSB7XG4gICAgaW52YWxpZCA9IHRydWU7XG4gICAgcmVhc29ucy5wdXNoKCdhdXRvc3RhcnQgbXVzdCBiZSBib29sZWFuJyk7XG4gIH1cblxuICBpZighQXJyYXkuaXNBcnJheSh0ZWNobmlxdWVzKSB8fCB0ZWNobmlxdWVzLmxlbmd0aCA9PT0gMCkge1xuICAgIGludmFsaWQgPSB0cnVlO1xuICAgIHJlYXNvbnMucHVzaCgndGVjaG5pcXVlcyBtdXN0IGJlIGFuIGFycmF5IGNvbnRhaW5pbmcgYXRsZWFzdCBvbiBtZWFzdXJlbWVudCB0ZWNobmlxdWVzJyk7XG4gIH1cblxuICBjb25zdCB2YWxpZGF0ZWQgPSB2YWxpZGF0ZUNyaXRlcmlhKGNyaXRlcmlhKTtcblxuICBpZih2YWxpZGF0ZWQuaW52YWxpZCkge1xuICAgIGludmFsaWQgPSB0cnVlO1xuICAgIHJlYXNvbnMucHVzaCh2YWxpZGF0ZWQucmVhc29ucyk7XG4gIH1cblxuICByZXR1cm4geyBpbnZhbGlkLCByZWFzb25zOiByZWFzb25zLmpvaW4oJyB8ICcpIH07XG59OyIsIi8qKlxuICogRXZlbnRzIG1vZHVsZVxuICogQG1vZHVsZSBNZWFzdXJlbWVudC9FdmVudHNcbiAqIHJlcHJlc2VudHMgRXZlbnQgY29uc3RhbnRzXG4gKi9cblxuLyoqIHJlcHJlc2VudHMgdGhhdCBlbGVtZW50IGlzIGluIHZpZXcgYW5kIG1lYXN1cmVtZW50IGhhcyBzdGFydGVkICovXG5leHBvcnQgY29uc3QgU1RBUlQgPSAnc3RhcnQnO1xuLyoqIHJlcHJlc2VudHMgYSB2aWV3YWJsZSBtZWFzdXJlbWVudCBzdG9wLiBUaGlzIG9jY3VycyB3aGVuIG1lYXN1cmVtZW50IGhhcyBwcmV2aW91c2x5IHN0YXJ0ZWQsIGJ1dCB0aGUgZWxlbWVudCBoYXMgZ29uZSBvdXQgb2YgdmlldyAqL1xuZXhwb3J0IGNvbnN0IFNUT1AgPSAnc3RvcCc7XG4vKiogcmVwcmVzZW50cyBhIHZpZXdhYmxlIGNoYW5nZSBldmVudC4gRWl0aGVyIG1lYXN1cmVtZW50IGhhcyBzdGFydGVkLCBzdG9wcGVkLCBvciB0aGUgZWxlbWVudCdzIGluIHZpZXcgYW1vdW50ICh2aWV3YWJsZSBwZXJjZW50YWdlKSBoYXMgY2hhbmdlZCAqL1xuZXhwb3J0IGNvbnN0IENIQU5HRSA9ICdjaGFuZ2UnO1xuLyoqIHJlcHJlc2VudHMgdGhhdCB2aWV3YWJpbGl0eSBtZWFzdXJlbWVudCBoYXMgY29tcGxldGVkLiB0aGUgZWxlbWVudCBoYXMgYmVlbiBpbiB2aWV3IGZvciB0aGUgZHVyYXRpb24gc3BlY2lmaWVkIGluIHRoZSBtZWFzdXJlbWVudCBjcml0ZXJpYSAqL1xuZXhwb3J0IGNvbnN0IENPTVBMRVRFID0gJ2NvbXBsZXRlJztcbi8qKiByZXByZXNlbnRzIHRoYXQgbm8gY29tcGF0aWJsZSB0ZWNobmlxdWVzIGhhdmUgYmVlbiBmb3VuZCB0byBtZWFzdXJlIHZpZXdhYmlsaXR5IHdpdGggKi9cbmV4cG9ydCBjb25zdCBVTk1FQVNVUkVBQkxFID0gJ3VubWVhc3VyZWFibGUnO1xuLyoqIGludGVybmFsIHJlcHJlc2VudGF0aW9uIG9mIHRoZSB2aWV3YWJsZSBzdGF0ZSBvZiB0aGUgZWxlbWVudCBhcyBpbiB2aWV3ICovXG5leHBvcnQgY29uc3QgSU5WSUVXID0gJ2ludmlldyc7XG4vKiogaW50ZXJuYWwgcmVwcmVzZW50YXRpb24gb2YgdGhlIHZpZXdhYmxlIHN0YXRlIG9mIHRoZSBlbGVtZW50IGFzIG91dCBvZiB2aWV3ICovXG5leHBvcnQgY29uc3QgT1VUVklFVyA9ICdvdXR2aWV3JzsgIiwiaW1wb3J0IEluVmlld1RpbWVyIGZyb20gJy4uL1RpbWluZy9JblZpZXdUaW1lcic7XG5pbXBvcnQgeyBERUZBVUxUX1NUUkFURUdZIH0gZnJvbSAnLi9TdHJhdGVnaWVzLyc7XG5pbXBvcnQgeyB2YWxpZFRlY2huaXF1ZSwgdmFsaWRhdGVTdHJhdGVneSB9IGZyb20gJy4uL0hlbHBlcnMvVmFsaWRhdG9ycyc7XG5pbXBvcnQgKiBhcyBFbnZpcm9ubWVudCBmcm9tICcuLi9FbnZpcm9ubWVudC9FbnZpcm9ubWVudCc7XG5pbXBvcnQgKiBhcyBFdmVudHMgZnJvbSAnLi9FdmVudHMnO1xuXG4vKipcbiAqIENsYXNzIHJlcHJlc2VudGluZyBhIG1lYXN1cmVtZW50IGV4ZWN1dG9yXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIE1lYXN1cmVtZW50RXhlY3V0b3Ige1xuICAvKipcbiAgICogQ3JlYXRlIGEgbmV3IGluc3RhbmNlIG9mIGEgTWVhc3VyZW1lbnRFeGVjdXRvclxuICAgKiBAcGFyYW0ge0hUTUxFbGVtZW50fSBlbGVtZW50IC0gYSBIVE1MIGVsZW1lbnQgdG8gbWVhc3VyZVxuICAgKiBAcGFyYW0ge09iamVjdH0gc3RyYXRlZ3kgLSBhIHN0cmF0ZWd5IG9iamVjdCBkZWZpbmluZyB0aGUgbWVhc3VyZW1lbnQgdGVjaG5pcXVlcyBhbmQgd2hhdCBjcml0ZXJpYSBjb25zdGl0dXRlIGEgdmlld2FibGUgc3RhdGUuXG4gICAqIFNlZSBPcGVuVlYuU3RyYXRlZ2llcyBERUZBVUxUX1NUUkFURUdZIGFuZCBTdHJhdGVneUZhY3RvcnkgZm9yIG1vcmUgZGV0YWlscyBvbiByZXF1aXJlZCBwYXJhbXNcbiAgICovXG4gIGNvbnN0cnVjdG9yKGVsZW1lbnQsIHN0cmF0ZWd5ID0ge30pIHtcbiAgICAvKiogQHByaXZhdGUge09iamVjdH0gZXZlbnQgbGlzdGVuZXIgYXJyYXlzICovXG4gICAgdGhpcy5fbGlzdGVuZXJzID0geyBzdGFydDogW10sIHN0b3A6IFtdLCBjaGFuZ2U6IFtdLCBjb21wbGV0ZTogW10sIHVubWVhc3VyZWFibGU6IFtdIH07XG4gICAgLyoqIEBwcml2YXRlIHtIVE1MRWxlbWVudH0gSFRNTCBlbGVtZW50IHRvIG1lYXN1cmUgKi9cbiAgICB0aGlzLl9lbGVtZW50ID0gZWxlbWVudDtcbiAgICAvKiogQHByaXZhdGUge09iamVjdH0gbWVhc3VyZW1lbnQgc3RyYXRlZ3kgKi9cbiAgICB0aGlzLl9zdHJhdGVneSA9IE9iamVjdC5hc3NpZ24oe30sIERFRkFVTFRfU1RSQVRFR1ksIHN0cmF0ZWd5KTtcbiAgICAvKiogQHByaXZhdGUge0Jvb2xlYW59IHRyYWNrcyB3aGV0aGVyIHZpZXdhYmlsaXR5IGNyaXRlcmlhIGhhcyBiZWVuIG1ldCAqL1xuICAgIHRoaXMuX2NyaXRlcmlhTWV0ID0gZmFsc2U7XG5cbiAgICBjb25zdCB2YWxpZGF0ZWQgPSB2YWxpZGF0ZVN0cmF0ZWd5KHRoaXMuX3N0cmF0ZWd5KTtcblxuICAgIGlmKHZhbGlkYXRlZC5pbnZhbGlkKSB7XG4gICAgICB0aHJvdyB2YWxpZGF0ZWQucmVhc29ucztcbiAgICB9XG5cbiAgICAvKiogQHByaXZhdGUge0Jhc2VUZWNobmlxdWV9IHRlY2huaXF1ZSB0byBtZWFzdXJlIHZpZXdhYmlsaXR5IHdpdGggKi9cbiAgICB0aGlzLl90ZWNobmlxdWUgPSB0aGlzLl9zZWxlY3RUZWNobmlxdWUodGhpcy5fc3RyYXRlZ3kudGVjaG5pcXVlcyk7XG4gICAgXG4gICAgaWYodGhpcy5fdGVjaG5pcXVlKSB7XG4gICAgICB0aGlzLl9hZGRTdWJzY3JpcHRpb25zKHRoaXMuX3RlY2huaXF1ZSk7XG4gICAgfSAgIFxuXG4gICAgaWYodGhpcy51bm1lYXN1cmVhYmxlKSB7XG4gICAgICAvLyBmaXJlIHVubWVhc3VyZWFibGUgYWZ0ZXIgY3VycmVudCBKUyBsb29wIGNvbXBsZXRlcyBcbiAgICAgIC8vIHNvIG9wcG9ydHVuaXR5IGlzIGdpdmVuIGZvciBjb25zdW1lcnMgdG8gcHJvdmlkZSB1bm1lYXN1cmVhYmxlIGNhbGxiYWNrXG4gICAgICBzZXRUaW1lb3V0KCAoKSA9PiB0aGlzLl9wdWJsaXNoKEV2ZW50cy5VTk1FQVNVUkVBQkxFLCBFbnZpcm9ubWVudC5nZXREZXRhaWxzKHRoaXMuX2VsZW1lbnQpKSwgMCk7XG4gICAgfVxuICAgIGVsc2UgaWYodGhpcy5fc3RyYXRlZ3kuYXV0b3N0YXJ0KSB7XG4gICAgICB0aGlzLl90ZWNobmlxdWUuc3RhcnQoKTtcbiAgICB9XG4gIH1cblxuICAvKiogXG4gICAqIHN0YXJ0cyB2aWV3YWJpbGl0eSBtZWFzdXJtZW50IHVzaW5nIHRoZSBzZWxlY3RlZCB0ZWNobmlxdWVcbiAgICogQHB1YmxpY1xuICAgKi9cbiAgc3RhcnQoKSB7XG4gICAgdGhpcy5fdGVjaG5pcXVlLnN0YXJ0KCk7XG4gIH1cblxuICAvKipcbiAgICogZGlzcG9zZSB0aGUgbWVhc3VybWVudCB0ZWNobmlxdWUgYW5kIGFueSB0aW1lcnNcbiAgICogQHB1YmxpY1xuICAgKi9cbiAgZGlzcG9zZSgpIHtcbiAgICBpZih0aGlzLl90ZWNobmlxdWUpIHtcbiAgICAgIHRoaXMuX3RlY2huaXF1ZS5kaXNwb3NlKCk7XG4gICAgfVxuICAgIGlmKHRoaXMudGltZXIpIHtcbiAgICAgIHRoaXMudGltZXIuZGlzcG9zZSgpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBIYW5kbGUgdmlld2FiaWxpdHkgdHJhY2tpbmcgc3RhcnRcbiAgICogQHB1YmxpY1xuICAgKiBAcGFyYW0gIHt2aWV3YWJsZUNhbGxiYWNrfSBjYWxsYmFjayAtIGlzIGNhbGxlZCB3aGVuIHZpZXdhYmlsaXR5IHN0YXJ0cyB0cmFja2luZ1xuICAgKiBAcmV0dXJuIHtNZWFzdXJtZW50RXhlY3V0b3J9IHJldHVybnMgaW5zdGFuY2Ugb2YgTWVhc3VyZW1lbnRFeGVjdXRvciBhc3NvY2lhdGVkIHdpdGggdGhpcyBjYWxsYmFja1xuICAgKi9cbiAgb25WaWV3YWJsZVN0YXJ0KGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIHRoaXMuX2FkZENhbGxiYWNrKGNhbGxiYWNrLCBFdmVudHMuU1RBUlQpO1xuICB9XG5cbiAgLyoqXG4gICAqIEhhbmRsZSB2aWV3YWJpbGl0eSB0cmFja2luZyBzdG9wLlxuICAgKiBAcHVibGljXG4gICAqIEBwYXJhbSB7dmlld2FibGVDYWxsYmFja30gY2FsbGJhY2sgLSBpcyBjYWxsZWQgd2hlbiB2aWV3YWJpbGl0eSBoYXMgcHJldmlvdXNseSBzdGFydGVkLCBidXQgZWxlbWVudCBpcyBub3cgb3V0IG9mIHZpZXdcbiAgICogQHJldHVybiB7TWVhc3VyZW1lbnRFeGVjdXRvcn0gcmV0dXJucyBpbnN0YW5jZSBvZiBNZWFzdXJlbWVudEV4ZWN1dG9yIGFzc29jaWF0ZWQgd2l0aCB0aGlzIGNhbGxiYWNrXG4gICAqL1xuICBvblZpZXdhYmxlU3RvcChjYWxsYmFjaykge1xuICAgIHJldHVybiB0aGlzLl9hZGRDYWxsYmFjayhjYWxsYmFjaywgRXZlbnRzLlNUT1ApO1xuICB9XG5cbiAgLyoqXG4gICAqIEhhbmRsZSB2aWV3YWJpbGl0eSBjaGFuZ2UuXG4gICAqIEBwdWJsaWNcbiAgICogQHBhcmFtICB7dmlld2FibGVDYWxsYmFja30gY2FsbGJhY2sgLSBjYWxsZWQgd2hlbiB0aGUgdmlld2FibGUgcGVyY2VudGFnZSBvZiB0aGUgZWxlbWVudCBoYXMgY2hhbmdlZFxuICAgKiBAcmV0dXJuIHtNZWFzdXJlbWVudEV4ZWN1dG9yfSByZXR1cm5zIGluc3RhbmNlIG9mIE1lYXN1cmVtZW50RXhlY3V0b3IgYXNzb2NpYXRlZCB3aXRoIHRoaXMgY2FsbGJhY2tcbiAgICovXG4gIG9uVmlld2FibGVDaGFuZ2UoY2FsbGJhY2spIHtcbiAgICByZXR1cm4gdGhpcy5fYWRkQ2FsbGJhY2soY2FsbGJhY2ssIEV2ZW50cy5DSEFOR0UpO1xuICB9XG5cbiAgLyoqXG4gICAqIEhhbmRsZSB2aWV3YWJpbGl0eSBjb21wbGV0ZS5cbiAgICogQHB1YmxpY1xuICAgKiBAcGFyYW0gIHt2aWV3YWJsZUNhbGxiYWNrfSBjYWxsYmFjayAtIGNhbGxlZCB3aGVuIGVsZW1lbnQgaGFzIGJlZW4gaW4gdmlldyBmb3IgdGhlIGR1cmF0aW9uIHNwZWNpZmllZCBpbiB0aGUgbWVhc3VyZW1lbnQgc3RyYXRlZ3kgY29uZmlnXG4gICAqIEByZXR1cm4ge01lYXN1cmVtZW50RXhlY3V0b3J9IHJldHVybnMgaW5zdGFuY2Ugb2YgTWVhc3VyZW1lbnRFeGVjdXRvciBhc3NvY2lhdGVkIHdpdGggdGhpcyBjYWxsYmFja1xuICAgKi9cbiAgb25WaWV3YWJsZUNvbXBsZXRlKGNhbGxiYWNrKSB7XG4gICAgdGhpcy5fYWRkQ2FsbGJhY2soY2FsbGJhY2ssIEV2ZW50cy5DT01QTEVURSk7XG4gICAgLy8gaWYgdmlld2FibGl0eSBjcml0ZXJpYSBhbHJlYWR5IG1ldCwgZmlyZSBjYWxsYmFjayBpbW1lZGlhdGVseVxuICAgIGlmKHRoaXMuY3JpdGVyaWFNZXQpIHtcbiAgICAgIHRoaXMuX3RlY2huaXF1ZUNoYW5nZShFdmVudHMuQ09NUExFVEUsIHRoaXMuX3RlY2huaXF1ZSk7XG4gICAgfVxuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLyoqXG4gICAqIEhhbmRsZSB1bm1lYXN1cmVhYmxlIGV2ZW50XG4gICAqIEBwdWJsaWNcbiAgICogQHBhcmFtICB7dmlld2FibGVDYWxsYmFja30gY2FsbGJhY2sgLSBjYWxsZWQgd2hlbiBubyBzdWl0YWJsZSBtZWFzdXJlbWVudCB0ZWNobmlxdWVzIGFyZSBhdmFpbGFibGUgZnJvbSB0aGUgdGVjaG5pcXVlcyBwcm92aWRlZFxuICAgKiBAcmV0dXJuIHtNZWFzdXJlbWVudEV4ZWN1dG9yfSByZXR1cm5zIGluc3RhbmNlIG9mIE1lYXN1cmVtZW50RXhlY3V0b3IgYXNzb2NpYXRlZCB3aXRoIHRoaXMgY2FsbGJhY2tcbiAgICovXG4gIG9uVW5tZWFzdXJlYWJsZShjYWxsYmFjaykge1xuICAgIHRoaXMuX2FkZENhbGxiYWNrKGNhbGxiYWNrLCBFdmVudHMuVU5NRUFTVVJFQUJMRSk7XG4gICAgLy8gaWYgZXhlY3V0b3IgaXMgYWxyZWFkeSB1bm1lYXN1cmVhYmxlLCBmaXJlIGNhbGxiYWNrIGltbWVkaWF0ZWx5XG4gICAgaWYodGhpcy51bm1lYXN1cmVhYmxlKSB7XG4gICAgICB0aGlzLl90ZWNobmlxdWVDaGFuZ2UoRXZlbnRzLlVOTUVBU1VSRUFCTEUpXG4gICAgfVxuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgIC8qKlxuICAgKiBAY2FsbGJhY2sgdmlld2FibGVDYWxsYmFja1xuICAgKiBAcGFyYW0ge09iamVjdH0gZGV0YWlscyAtIGVudmlyb25tZW50IGFuZCBtZWFzdXJlbWVudCBkZXRhaWxzIG9mIHZpZXdhYmxlIGV2ZW50XG4gICAqIEByZXR1cm4ge01lYXN1cm1lbnRFeGVjdXRvcn0gcmV0dXJucyBpbnN0YW5jZSBvZiBNZWFzdXJlbWVudEV4ZWN1dG9yIGFzc29jaWF0ZWQgd2l0aCB0aGlzIGNhbGxiYWNrXG4gICAqL1xuXG4gIC8qKlxuICAgKiBAcmV0dXJuIHtCb29sZWFufSAtIHdoZXRoZXIgTWVhc3VyZW1lbnRFeGVjdXRvciBpbnN0YW5jZSBpcyBjYXBhYmxlIG9mIG1lYXN1cmluZyB2aWV3YWJpbGl0eVxuICAgKi9cbiAgZ2V0IHVubWVhc3VyZWFibGUoKSB7XG4gICAgcmV0dXJuICF0aGlzLl90ZWNobmlxdWUgfHwgdGhpcy5fdGVjaG5pcXVlLnVubWVhc3VyZWFibGU7XG4gIH1cblxuICAvKipcbiAgICogSW5zdGFudGlhdGVzIGFuZCBmaWx0ZXJzIGxpc3Qgb2YgYXZhaWxhYmxlIG1lYXN1cmVtZW50IHRlY2hucWl1ZXMgdG8gdGhlIGZpcnN0IHVubWVhc3VyZWFibGUgdGVjaG5pcXVlXG4gICAqIEBwcml2YXRlXG4gICAqIEBwYXJhbSAge0FycmF5fSAtIGxpc3Qgb2YgdGVjaG5pcXVlcyBhdmFpbGFibGUgdG8gbWVhc3VyZSB2aWV3YWJpbGl0eSB3aXRoXG4gICAqIEByZXR1cm4ge0Jhc2VUZWNobmlxdWV9IHNlbGVjdGVkIHRlY2huaXF1ZVxuICAgKi9cbiAgX3NlbGVjdFRlY2huaXF1ZSh0ZWNobmlxdWVzKSB7XG4gICAgcmV0dXJuIHRlY2huaXF1ZXNcbiAgICAgICAgICAgIC5maWx0ZXIodmFsaWRUZWNobmlxdWUpXG4gICAgICAgICAgICAubWFwKHRoaXMuX2luc3RhbnRpYXRlVGVjaG5pcXVlLmJpbmQodGhpcykpXG4gICAgICAgICAgICAuZmluZCh0ZWNobmlxdWUgPT4gIXRlY2huaXF1ZS51bm1lYXN1cmVhYmxlKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBjcmVhdGVzIGluc3RhbmNlIG9mIHRlY2huaXF1ZVxuICAgKiBAcHJpdmF0ZVxuICAgKiBAcGFyYW0gIHtGdW5jdGlvbn0gLSB0ZWNobmlxdWUgY29uc3RydWN0b3JcbiAgICogQHJldHVybiB7QmFzZVRlY2huaXF1ZX0gaW5zdGFuY2Ugb2YgdGVjaG5pcXVlIHByb3ZpZGVkXG4gICAqL1xuICBfaW5zdGFudGlhdGVUZWNobmlxdWUodGVjaG5pcXVlKSB7XG4gICAgcmV0dXJuIG5ldyB0ZWNobmlxdWUoZWxlbWVudCwgdGhpcy5fc3RyYXRlZ3kuY3JpdGVyaWEpO1xuICB9XG5cbiAgLyoqXG4gICAqIGFkZHMgZXZlbnQgbGlzdGVuZXJzIHRvIHRlY2huaXF1ZSBcbiAgICogQHByaXZhdGVcbiAgICogQHBhcmFtIHtCYXNlVGVjaG5pcXVlfSAtIHRlY2huaXF1ZSB0byBhZGQgZXZlbnQgbGlzdGVuZXJzIHRvXG4gICAqL1xuICBfYWRkU3Vic2NyaXB0aW9ucyh0ZWNobmlxdWUpIHtcbiAgICBpZih0ZWNobmlxdWUpIHtcbiAgICAgIHRlY2huaXF1ZS5vbkluVmlldyh0aGlzLl90ZWNobmlxdWVDaGFuZ2UuYmluZCh0aGlzLCBFdmVudHMuSU5WSUVXLCB0ZWNobmlxdWUpKTtcbiAgICAgIHRlY2huaXF1ZS5vbkNoYW5nZVZpZXcodGhpcy5fdGVjaG5pcXVlQ2hhbmdlLmJpbmQodGhpcywgRXZlbnRzLkNIQU5HRSwgdGVjaG5pcXVlKSk7XG4gICAgICB0ZWNobmlxdWUub25PdXRWaWV3KHRoaXMuX3RlY2huaXF1ZUNoYW5nZS5iaW5kKHRoaXMsIEV2ZW50cy5PVVRWSUVXLCB0ZWNobmlxdWUpKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogaGFuZGxlcyB2aWV3YWJsZSBjaGFuZ2UgZXZlbnRzIGZyb20gYSBtZWFzdXJlbWVudCB0ZWNobmlxdWVcbiAgICogQHByaXZhdGVcbiAgICogQHBhcmFtICB7U3RyaW5nfSAtIGNoYW5nZSB0eXBlLiBTZWUgTWVhc3VyZW1lbnQvRXZlbnRzIG1vZHVsZSBmb3IgbGlzdCBvZiBjaGFuZ2VzXG4gICAqIEBwYXJhbSAge09iamVjdH0gLSB0ZWNobmlxdWUgdGhhdCByZXBvcnRlZCBjaGFuZ2UuIE1heSBiZSB1bmRlZmluZWQgaW4gY2FzZSBvZiB1bm1lYXN1cmVhYmxlIGV2ZW50XG4gICAqL1xuICBfdGVjaG5pcXVlQ2hhbmdlKGNoYW5nZSwgdGVjaG5pcXVlID0ge30pIHtcbiAgICBsZXQgZXZlbnROYW1lO1xuICAgIGNvbnN0IGRldGFpbHMgPSB0aGlzLl9hcHBlbmRFbnZpcm9ubWVudCh0ZWNobmlxdWUpO1xuXG4gICAgc3dpdGNoKGNoYW5nZSkge1xuICAgICAgY2FzZSBFdmVudHMuSU5WSUVXOlxuICAgICAgICBpZighdGhpcy5fY3JpdGVyaWFNZXQpe1xuICAgICAgICAgIHRoaXMudGltZXIgPSBuZXcgSW5WaWV3VGltZXIodGhpcy5fc3RyYXRlZ3kuY3JpdGVyaWEudGltZUluVmlldyk7XG4gICAgICAgICAgdGhpcy50aW1lci5lbGFwc2VkKHRoaXMuX3RpbWVyRWxhcHNlZC5iaW5kKHRoaXMsIHRlY2huaXF1ZSkpO1xuICAgICAgICAgIHRoaXMudGltZXIuc3RhcnQoKTtcbiAgICAgICAgICBldmVudE5hbWUgPSBFdmVudHMuU1RBUlQ7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIGJyZWFrO1xuXG4gICAgICBjYXNlIEV2ZW50cy5DSEFOR0U6XG4gICAgICAgIGV2ZW50TmFtZSA9IGNoYW5nZTtcbiAgICAgICAgYnJlYWs7XG5cbiAgICAgIGNhc2UgRXZlbnRzLkNPTVBMRVRFOlxuICAgICAgICBpZighdGhpcy5fY3JpdGVyaWFNZXQpIHtcbiAgICAgICAgICB0aGlzLl9jcml0ZXJpYU1ldCA9IHRydWU7XG4gICAgICAgICAgZXZlbnROYW1lID0gY2hhbmdlO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBicmVhaztcblxuICAgICAgY2FzZSBFdmVudHMuT1VUVklFVzpcbiAgICAgICAgaWYoIXRoaXMuX2NyaXRlcmlhTWV0KSB7XG4gICAgICAgICAgaWYodGhpcy50aW1lcikge1xuICAgICAgICAgICAgdGhpcy50aW1lci5zdG9wKCk7XG4gICAgICAgICAgICBkZWxldGUgdGhpcy50aW1lcjtcbiAgICAgICAgICB9XG4gICAgICAgICAgZXZlbnROYW1lID0gRXZlbnRzLlNUT1A7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIGJyZWFrO1xuXG4gICAgICBjYXNlIEV2ZW50cy5VTk1FQVNVUkVBQkxFOiBcbiAgICAgICAgZXZlbnROYW1lID0gRXZlbnRzLlVOTUVBU1VSRUFCTEU7XG4gICAgfVxuXG4gICAgaWYoZXZlbnROYW1lKSB7XG4gICAgICB0aGlzLl9wdWJsaXNoKGV2ZW50TmFtZSwgZGV0YWlscyk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIHB1Ymxpc2hlcyBldmVudHMgdG8gYXZhaWxhYmxlIGxpc3RlbmVyc1xuICAgKiBAcHJpdmF0ZVxuICAgKiBAcGFyYW0gIHtTdHJpbmd9IC0gZXZlbnQgbmFtZVxuICAgKiBAcGFyYW0gIHt9IC0gdmFsdWUgdG8gY2FsbCBjYWxsYmFjayB3aXRoXG4gICAqL1xuICBfcHVibGlzaChldmVudCwgdmFsdWUpIHtcbiAgICBpZihBcnJheS5pc0FycmF5KHRoaXMuX2xpc3RlbmVyc1tldmVudF0pKSB7XG4gICAgICB0aGlzLl9saXN0ZW5lcnNbZXZlbnRdLmZvckVhY2goIGwgPT4gbCh2YWx1ZSkgKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogY2FsbGJhY2sgZm9yIHRpbWVyIGVsYXBzZWQgXG4gICAqIEBwcml2YXRlXG4gICAqIEBwYXJhbSAge0Jhc2VUZWNobmlxdWV9IC0gdGVjaG5pcXVlIHVzZWQgdG8gcGVyZm9ybSBtZWFzdXJlbWVudFxuICAgKi9cbiAgX3RpbWVyRWxhcHNlZCh0ZWNobmlxdWUpIHtcbiAgICB0aGlzLl90ZWNobmlxdWVDaGFuZ2UoRXZlbnRzLkNPTVBMRVRFLCB0ZWNobmlxdWUpO1xuICB9XG5cbiAgLyoqXG4gICAqIEFzc29jaWF0ZXMgY2FsbGJhY2sgZnVuY3Rpb24gd2l0aCBldmVudCBcbiAgICogQHByaXZhdGVcbiAgICogQHBhcmFtIHtGdW5jdGlvbn0gLSBjYWxsYmFjayBmdW5jdGlvbiB0byBhc3NvY2lhdGUgd2l0aCBldmVudFxuICAgKiBAcGFyYW0ge1N0cmluZ30gZXZlbnQgLSBldmVudCB0byBhc3NvY2lhdGUgY2FsbGJhY2sgZnVuY3Rpb24gd2l0aFxuICAgKiBAcmV0dXJuIHtNZWFzdXJlbWVudEV4ZWN1dG9yfSByZXR1cm5zIGluc3RhbmNlIG9mIE1lYXN1cmVtZW50RXhlY3V0b3IgYXNzb2NpYXRlZCB3aXRoIHRoaXMgY2FsbGJhY2tcbiAgICovXG4gIF9hZGRDYWxsYmFjayhjYWxsYmFjaywgZXZlbnQpIHtcbiAgICBpZih0aGlzLl9saXN0ZW5lcnNbZXZlbnRdICYmIHR5cGVvZiBjYWxsYmFjayA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgdGhpcy5fbGlzdGVuZXJzW2V2ZW50XS5wdXNoKGNhbGxiYWNrKTtcbiAgICB9XG4gICAgZWxzZSBpZih0eXBlb2YgY2FsbGJhY2sgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHRocm93ICdDYWxsYmFjayBtdXN0IGJlIGEgZnVuY3Rpb24nO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLyoqXG4gICAqIENvbWJpbmVzIGVudmlyb25tZW50IGRldGFpbHMgd2l0aCBtZWFzdXJlbWVudCB0ZWNobmlxdWUgZGV0YWlsc1xuICAgKiBAcHJpdmF0ZVxuICAgKiBAcGFyYW0gIHtCYXNlVGVjaG5pcXVlfSAtIHRlY2huaXF1ZSB0byBnZXQgbWVhc3VyZW1lbnQgZGV0YWlscyBmcm9tIFxuICAgKiBAcmV0dXJuIHtPYmplY3R9IEVudmlyb25tZW50IGRldGFpbHMgYW5kIG1lYXN1cmVtZW50IGRldGFpbHMgY29tYmluZWRcbiAgICovXG4gIF9hcHBlbmRFbnZpcm9ubWVudCh0ZWNobmlxdWUpIHtcbiAgICByZXR1cm4gT2JqZWN0LmFzc2lnbihcbiAgICAgIHt9LCBcbiAgICAgIHsgXG4gICAgICAgIHBlcmNlbnRWaWV3YWJsZTogdHlwZW9mIHRlY2huaXF1ZS5wZXJjZW50Vmlld2FibGUgPT09ICd1bmRlZmluZWQnID8gLTEgOiB0ZWNobmlxdWUucGVyY2VudFZpZXdhYmxlLCBcbiAgICAgICAgdGVjaG5pcXVlOiB0ZWNobmlxdWUudGVjaG5pcXVlTmFtZSB8fCAtMSwgXG4gICAgICAgIHZpZXdhYmxlOiB0eXBlb2YgdGVjaG5pcXVlLnZpZXdhYmxlID09PSAndW5kZWZpbmVkJyA/IC0xIDogdGVjaG5pcXVlLnZpZXdhYmxlIFxuICAgICAgfSwgXG4gICAgICBFbnZpcm9ubWVudC5nZXREZXRhaWxzKHRoaXMuX2VsZW1lbnQpIFxuICAgICk7XG4gIH1cbn0iLCIvKipcbiAqIENsYXNzIHJlcHJlc2VudGluZyBiYXNpYyBmdW5jdGlvbmFsaXR5IG9mIGEgTWVhc3VyZW1lbnQgVGVjaG5pcXVlXG4gKiBTb21lIG9mIGl0J3MgbWVtYmVycyBhcmUgaW50ZW5kZWQgdG8gYmUgb3ZlcnJpZGVuIGJ5IGluaGVyaXR0aW5nIGNsYXNzXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEJhc2VUZWNobmlxdWUge1xuICAvKipcbiAgICogQGNvbnN0cnVjdG9yXG4gICAqIEByZXR1cm4ge0Jhc2VUZWNobmlxdWV9IGluc3RhbmNlIG9mIEJhc2VUZWNobmlxdWVcbiAgICovXG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHRoaXMubGlzdGVuZXJzID0ge1xuICAgICAgaW5WaWV3OltdLFxuICAgICAgb3V0VmlldzpbXSxcbiAgICAgIGNoYW5nZVZpZXc6W11cbiAgICB9O1xuXG4gICAgdGhpcy5wZXJjZW50Vmlld2FibGUgPSAwLjA7XG4gIH1cblxuICAvKipcbiAgICogRGVmaW5lcyBjYWxsYmFjayB0byBjYWxsIHdoZW4gdGVjaG5pcXVlIGRldGVybWluZXMgZWxlbWVudCBpcyBpbiB2aWV3XG4gICAqIEBwYXJhbSAge2NoYW5nZUNhbGxiYWNrfSAtIGNhbGxiYWNrIHRvIGNhbGwgd2hlbiBlbGVtZW50IGlzIGluIHZpZXdcbiAgICogQHJldHVybiB7QmFzZVRlY2huaXF1ZX0gaW5zdGFuY2Ugb2YgQmFzZVRlY2huaXF1ZSBhc3NvY2lhdGVkIHdpdGggY2FsbGJhY2suIENhbiBiZSB1c2VkIHRvIGNoYWluIGNhbGxiYWNrIGRlZmluaXRpb25zLlxuICAgKi9cbiAgb25JblZpZXcoY2IpIHtcbiAgICByZXR1cm4gdGhpcy5hZGRDYWxsYmFjayhjYiwnaW5WaWV3Jyk7XG4gIH1cblxuICAvKipcbiAgICogRGVmaW5lcyBjYWxsYmFjayB0byBjYWxsIHdoZW4gdGVjaG5pcXVlIGRldGVybWluZXMgZWxlbWVudCB2aWV3YWJpbGl0eSBoYXMgY2hhbmdlZFxuICAgKiBAcGFyYW0gIHtjaGFuZ2VDYWxsYmFja30gLSBjYWxsYmFjayB0byBjYWxsIHdoZW4gZWxlbWVudCdzIHZpZXdhYmlsaXR5IGhhcyBjaGFuZ2VkXG4gICAqIEByZXR1cm4ge0Jhc2VUZWNobmlxdWV9IGluc3RhbmNlIG9mIEJhc2VUZWNobmlxdWUgYXNzb2NpYXRlZCB3aXRoIGNhbGxiYWNrLiBDYW4gYmUgdXNlZCB0byBjaGFpbiBjYWxsYmFjayBkZWZpbml0aW9ucy5cbiAgICovXG4gIG9uQ2hhbmdlVmlldyhjYikge1xuICAgIHJldHVybiB0aGlzLmFkZENhbGxiYWNrKGNiLCdjaGFuZ2VWaWV3Jyk7XG4gIH1cblxuICAvKipcbiAgICogRGVmaW5lcyBjYWxsYmFjayB0byBjYWxsIHdoZW4gdGVjaG5pcXVlIGRldGVybWluZXMgZWxlbWVudCBpcyBubyBsb25nZXIgaW4gdmlld1xuICAgKiBAcGFyYW0gIHtjaGFuZ2VDYWxsYmFja30gLSBjYWxsYmFjayB0byBjYWxsIHdoZW4gZWxlbWVudCBpcyBubyBsb25nZXIgaW4gdmlld1xuICAgKiBAcmV0dXJuIHtCYXNlVGVjaG5pcXVlfSBpbnN0YW5jZSBvZiBCYXNlVGVjaG5pcXVlIGFzc29jaWF0ZWQgd2l0aCBjYWxsYmFjay4gQ2FuIGJlIHVzZWQgdG8gY2hhaW4gY2FsbGJhY2sgZGVmaW5pdGlvbnMuXG4gICAqL1xuICBvbk91dFZpZXcoY2IpIHtcbiAgICByZXR1cm4gdGhpcy5hZGRDYWxsYmFjayhjYiwnb3V0VmlldycpO1xuICB9XG5cbiAgLyoqXG4gICAqIEBjYWxsYmFjayBjaGFuZ2VDYWxsYmFja1xuICAgKi9cblxuICAvKipcbiAgICogQXNzb2NpYXRlIGNhbGxiYWNrIHdpdGggbmFtZWQgZXZlbnRcbiAgICogQHBhcmFtIHtGdW5jdGlvbn0gY2FsbGJhY2sgLSBjYWxsYmFjayB0byBjYWxsIHdoZW4gZXZlbnQgb2NjdXJzXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBldmVudCAtIG5hbWUgb2YgZXZlbnQgdG8gYXNzb2NpYXRlIHdpdGggY2FsbGJhY2tcbiAgICovXG4gIGFkZENhbGxiYWNrKGNhbGxiYWNrLCBldmVudCkge1xuICAgIGlmKHR5cGVvZiBjYWxsYmFjayA9PT0gJ2Z1bmN0aW9uJyAmJiB0aGlzLmxpc3RlbmVyc1tldmVudF0pIHtcbiAgICAgIHRoaXMubGlzdGVuZXJzW2V2ZW50XS5wdXNoKGNhbGxiYWNrKTtcbiAgICB9XG4gICAgZWxzZSBpZih0eXBlb2YgY2FsbGJhY2sgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHRocm93ICdjYWxsYmFjayBtdXN0IGJlIGZ1bmN0aW9uJztcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8qKiBcbiAgICogZW1wdHkgc3RhcnQgbWVtYmVyLiBzaG91bGQgYmUgaW1wbGVtZW50ZWQgYnkgaW5oZXJpdHRpbmcgY2xhc3NcbiAgICovXG4gIHN0YXJ0KCkge31cblxuICAvKipcbiAgICogZW1wdHkgZGlzcG9zZSBtZW1iZXIuIHNob3VsZCBiZSBpbXBsZW1lbnRlZCBieSBpbmhlcml0dGluZyBjbGFzc1xuICAgKi9cbiAgZGlzcG9zZSgpIHt9XG5cbiAgLyoqXG4gICAqIEByZXR1cm4ge0Jvb2xlYW59IGRlZmluZXMgd2hldGhlciB0aGUgdGVjaG5pcXVlIGlzIGNhcGFibGUgb2YgbWVhc3VyaW5nIGluIHRoZSBjdXJyZW50IGVudmlyb25tZW50XG4gICAqL1xuICBnZXQgdW5tZWFzdXJlYWJsZSgpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICAvKipcbiAgICogQHJldHVybiB7Qm9vbGVhbn0gZGVmaW5lcyB3aGV0aGVyIHRoZSB0ZWNobmlxdWUgaGFzIGRldGVybWluZWQgdGhhdCB0aGUgbWVhc3VyZWQgZWxlbWVudCBpcyBpbiB2aWV3XG4gICAqL1xuICBnZXQgdmlld2FibGUoKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgLyoqXG4gICAqIEByZXR1cm4ge1N0cmluZ30gbmFtZSBvZiB0aGUgbWVhc3VyZW1lbnQgdGVjaG5pcXVlXG4gICAqL1xuICBnZXQgdGVjaG5pcXVlTmFtZSgpIHtcbiAgICByZXR1cm4gJ0Jhc2VUZWNobmlxdWUnO1xuICB9XG59IiwiaW1wb3J0IEJhc2VUZWNobmlxdWUgZnJvbSAnLi9CYXNlVGVjaG5pcXVlJztcbmltcG9ydCB7IHZhbGlkRWxlbWVudCB9IGZyb20gJy4uLy4uL0hlbHBlcnMvVmFsaWRhdG9ycyc7XG5pbXBvcnQgeyBERUZBVUxUX1NUUkFURUdZIH0gZnJvbSAnLi4vU3RyYXRlZ2llcy8nO1xuXG4vKipcbiAqIFJlcHJlc2VudHMgYSBtZWFzdXJlbWVudCB0ZWNobmlxdWUgdGhhdCB1c2VzIG5hdGl2ZSBJbnRlcnNlY3Rpb25PYnNlcnZlciBBUElcbiAqIEBleHRlbmRzIHtCYXNlVGVjaG5pcXVlfVxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBJbnRlcnNlY3Rpb25PYnNlcnZlciBleHRlbmRzIEJhc2VUZWNobmlxdWUge1xuICAvKipcbiAgICogQ3JlYXRlcyBpbnN0YW5jZSBvZiBJbnRlcnNlY3Rpb25PYnNlcnZlciBtZWFzdXJlbWVudCB0ZWNobmlxdWVcbiAgICogQGNvbnN0cnVjdG9yXG4gICAqIEBwYXJhbSAge0hUTUxFbGVtZW50fSBlbGVtZW50IC0gZWxlbWVudCB0byBwZXJmb3JtIHZpZXdhYmlsaXR5IG1lYXN1cmVtZW50IG9uXG4gICAqIEBwYXJhbSAge09iamVjdH0gY3JpdGVyaWEgLSBtZWFzdXJlbWVudCBjcml0ZXJpYSBvYmplY3QuIFNlZSBPcHRpb25zL1ZpZXdhYmlsaXR5Q3JpdGVyaWEgZm9yIG1vcmUgZGV0YWlsc1xuICAgKiBAcmV0dXJuIHtJbnRlcnNlY3Rpb25PYnNlcnZlcn0gaW5zdGFuY2Ugb2YgSW50ZXJzZWN0aW9uT2JzZXJ2ZXIgbWVhc3VyZW1lbnQgdGVjaG5pcXVlXG4gICAqL1xuICBjb25zdHJ1Y3RvcihlbGVtZW50LCBjcml0ZXJpYSA9IERFRkFVTFRfU1RSQVRFR1kuY3JpdGVyaWEpIHtcbiAgICBzdXBlcihlbGVtZW50LCBjcml0ZXJpYSk7XG4gICAgaWYoY3JpdGVyaWEgIT09IHVuZGVmaW5lZCAmJiBlbGVtZW50KSB7XG4gICAgICB0aGlzLmVsZW1lbnQgPSBlbGVtZW50O1xuICAgICAgdGhpcy5jcml0ZXJpYSA9IGNyaXRlcmlhO1xuICAgICAgdGhpcy5pblZpZXcgPSBmYWxzZTtcbiAgICAgIHRoaXMuc3RhcnRlZCA9IGZhbHNlO1xuICAgICAgdGhpcy5ub3RpZmljYXRpb25MZXZlbHMgPSBbMCwwLjEsMC4yLDAuMywwLjQsMC41LDAuNiwwLjcsMC44LDAuOSwxXTtcbiAgICAgIGlmKHRoaXMubm90aWZpY2F0aW9uTGV2ZWxzLmluZGV4T2YodGhpcy5jcml0ZXJpYS5pblZpZXdUaHJlc2hvbGQpID09PSAtMSkge1xuICAgICAgICB0aGlzLm5vdGlmaWNhdGlvbkxldmVscy5wdXNoKHRoaXMuY3JpdGVyaWEuaW5WaWV3VGhyZXNob2xkKTtcbiAgICAgIH1cbiAgICB9XG4gICAgZWxzZSBpZighZWxlbWVudCkge1xuICAgICAgdGhyb3cgJ2VsZW1lbnQgbm90IHByb3ZpZGVkJztcbiAgICB9IFxuICB9XG5cbiAgLyoqXG4gICAqIHN0YXJ0cyBtZWFzdXJpbmcgdGhlIHNwZWNpZmllZCBlbGVtZW50IGZvciB2aWV3YWJpbGl0eVxuICAgKiBAb3ZlcnJpZGVcbiAgICovXG4gIHN0YXJ0KCkge1xuICAgIHRoaXMub2JzZXJ2ZXIgPSBuZXcgd2luZG93LkludGVyc2VjdGlvbk9ic2VydmVyKHRoaXMudmlld2FibGVDaGFuZ2UuYmluZCh0aGlzKSx7IHRocmVzaG9sZDogdGhpcy5ub3RpZmljYXRpb25MZXZlbHMgfSk7XG4gICAgdGhpcy5vYnNlcnZlci5vYnNlcnZlKHRoaXMuZWxlbWVudCk7XG4gIH1cblxuICAvKipcbiAgICogc3RvcHMgbWVhc3VyaW5nIHRoZSBzcGVjaWZpZWQgZWxlbWVudCBmb3Igdmlld2FiaWxpdHlcbiAgICogQG92ZXJyaWRlXG4gICAqL1xuICBkaXNwb3NlKCkge1xuICAgIGlmKHRoaXMub2JzZXJ2ZXIpIHtcbiAgICAgIHRoaXMub2JzZXJ2ZXIudW5vYnNlcnZlKGVsZW1lbnQpO1xuICAgICAgdGhpcy5vYnNlcnZlci5kaXNjb25uZWN0KGVsZW1lbnQpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBAb3ZlcnJpZGVcbiAgICogQHJldHVybiB7Qm9vbGVhbn0gZGV0ZXJtaW5lcyBpZiB0aGUgdGVjaG5pcXVlIGlzIGNhcGFibGUgb2YgbWVhc3VyaW5nIGluIHRoZSBjdXJyZW50IGVudmlyb25tZW50XG4gICAqL1xuICBnZXQgdW5tZWFzdXJlYWJsZSgpIHtcbiAgICByZXR1cm4gKCF3aW5kb3cuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIgfHwgdGhpcy51c2VzUG9seWZpbGwgKSB8fCAhdmFsaWRFbGVtZW50KHRoaXMuZWxlbWVudCk7XG4gIH1cblxuICAvKipcbiAgICogQG92ZXJyaWRlXG4gICAqIEByZXR1cm4ge0Jvb2xlYW59IHJlcG9ydHMgd2hldGhlciB0aGUgZWxlbWVudCBpcyBpbiB2aWV3IGFjY29yZGluZyB0byB0aGUgSW50ZXJzZWN0aW9uT2JzZXJ2ZXIgbWVhc3VyZW1lbnQgdGVjaG5pcXVlXG4gICAqL1xuICBnZXQgdmlld2FibGUoKSB7XG4gICAgcmV0dXJuIHRoaXMuaW5WaWV3O1xuICB9XG5cbiAgLyoqXG4gICAqIEBvdmVycmlkZVxuICAgKiBAcmV0dXJuIHtTdHJpbmd9IHJlcG9ydHMgbWVhc3VyZW1lbnQgdGVjaG5pcXVlIG5hbWVcbiAgICovXG4gIGdldCB0ZWNobmlxdWVOYW1lKCkge1xuICAgIHJldHVybiAnSW50ZXJzZWN0aW9uT2JzZXJ2ZXInO1xuICB9XG5cbiAgLyoqXG4gICAqIEByZXR1cm4ge0Jvb2xlYW59IC0gcmVwb3J0cyB3aGV0aGVyIG1lYXN1cmVtZW50IHRlY2huaXF1ZSBpcyB1c2luZyB0aGUgbmF0aXZlIEludGVyc2VjdGlvbk9ic2VydmVyIEFQSSBvciB0aGUgcG9seWZpbGwgYnVuZGxlZCB3aXRoIHRoZSBsaWJyYXJ5LlxuICAgKiBQb2x5ZmlsbCB1c2FnZSBpcyBpbmZlcmVkIGJ5IGNoZWNraW5nIGlmIHRoZSBJbnRlcnNlY3Rpb25PYnNlcnZlciBBUEkgaGFzIGEgVEhST1RUTEVfVElNRU9VVCBtZW1tYmVyXG4gICAqIE9ubHkgdGhlIHBvbHlmaWxsIHNob3VsZCBoYXZlIHRoYXQgbWVtYmVyIGluIGl0J3MgQVBJXG4gICAqL1xuICBnZXQgdXNlc1BvbHlmaWxsKCkge1xuICAgIHJldHVybiB0eXBlb2Ygd2luZG93LkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5USFJPVFRMRV9USU1FT1VUID09PSAnbnVtYmVyJztcbiAgfVxuXG4gIC8qKlxuICAgKiBjYWxsYmFjayBmdW5jdGlvbiBmb3IgSW50ZXJzZWN0aW9uT2JzZXJ2ZXIgY2hhbmdlIGV2ZW50c1xuICAgKiBAcGFyYW0gIHtBcnJheX0gZW50cmllcyAtIGNoYW5nZSBlbnRyaWVzXG4gICAqL1xuICB2aWV3YWJsZUNoYW5nZShlbnRyaWVzKSB7XG4gICAgaWYoZW50cmllcyAmJiBlbnRyaWVzLmxlbmd0aCAmJiBlbnRyaWVzWzBdLmludGVyc2VjdGlvblJhdGlvICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMucGVyY2VudFZpZXdhYmxlID0gZW50cmllc1swXS5pbnRlcnNlY3Rpb25SYXRpbztcbiAgICAgIFxuICAgICAgaWYoZW50cmllc1swXS5pbnRlcnNlY3Rpb25SYXRpbyA8IHRoaXMuY3JpdGVyaWEuaW5WaWV3VGhyZXNob2xkICYmIHRoaXMuc3RhcnRlZCkge1xuICAgICAgICB0aGlzLmluVmlldyA9IGZhbHNlO1xuICAgICAgICB0aGlzLmxpc3RlbmVycy5vdXRWaWV3LmZvckVhY2goIGwgPT4gbCgpICk7XG4gICAgICB9XG4gICAgICBpZihlbnRyaWVzWzBdLmludGVyc2VjdGlvblJhdGlvID49IHRoaXMuY3JpdGVyaWEuaW5WaWV3VGhyZXNob2xkKSB7XG4gICAgICAgIHRoaXMuc3RhcnRlZCA9IHRydWU7XG4gICAgICAgIHRoaXMuaW5WaWV3ID0gdHJ1ZTtcbiAgICAgICAgdGhpcy5saXN0ZW5lcnMuaW5WaWV3LmZvckVhY2goIGwgPT4gbCgpICk7XG4gICAgICB9XG5cbiAgICAgIHRoaXMubGlzdGVuZXJzLmNoYW5nZVZpZXcuZm9yRWFjaCggbCA9PiBsKCkgKTtcbiAgICB9XG4gIH1cblxufSIsImltcG9ydCBJbnRlcnNlY3Rpb25PYnNlcnZlciBmcm9tICcuL0ludGVyc2VjdGlvbk9ic2VydmVyJztcbmltcG9ydCBQb2x5ZmlsbCBmcm9tICdpbnRlcnNlY3Rpb24tb2JzZXJ2ZXInO1xuaW1wb3J0ICogYXMgRW52aXJvbm1lbnQgZnJvbSAnLi4vLi4vRW52aXJvbm1lbnQvRW52aXJvbm1lbnQnO1xuXG4vKipcbiAqIFJlcHJlc2VudHMgYSBtZWFzdXJlbWVudCB0ZWNobmlxdWUgdGhhdCB1c2VzIHRoZSBJbnRlcnNlY3Rpb25PYnNlcnZlciBBUEkgcG9seWZpbGxcbiAqIEBleHRlbmRzIHtJbnRlcnNlY3Rpb25PYnNlcnZlcn1cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgSW50ZXJzZWN0aW9uT2JzZXJ2ZXJQb2x5ZmlsbCBleHRlbmRzIEludGVyc2VjdGlvbk9ic2VydmVyIHtcbiAgLyoqXG4gICAqIGRldGVybWluZXMgd2hldGhlciB0aGUgbWVhc3VyZW1lbnQgdGVjaG5pcXVlIGlzIGNhcGFibGUgb2YgbWVhc3VyaW5nIGdpdmVuIHRoZSBjdXJyZW50IGVudmlyb25tZW50XG4gICAqIEBvdmVycmlkZVxuICAgKiBAcmV0dXJuIHtCb29sZWFufVxuICAgKi9cbiAgZ2V0IHVubWVhc3VyZWFibGUoKSB7XG4gICAgcmV0dXJuIEVudmlyb25tZW50LmlGcmFtZUNvbnRleHQoKSA9PT0gRW52aXJvbm1lbnQuaUZyYW1lU2VydmluZ1NjZW5hcmlvcy5DUk9TU19ET01BSU5fSUZSQU1FO1xuICB9XG5cbiAgLyoqXG4gICAqIEByZXR1cm4ge1N0cmluZ30gbmFtZSBvZiBtZWFzdXJlbWVudCB0ZWNobmlxdWVcbiAgICovXG4gIGdldCB0ZWNobmlxdWVOYW1lKCkge1xuICAgIHJldHVybiAnSW50ZXJzZWN0aW9uT2JzZXJ2ZXJQb2x5RmlsbCc7XG4gIH1cbn0iLCJleHBvcnQgeyBkZWZhdWx0IGFzIEludGVyc2VjdGlvbk9ic2VydmVyIH0gZnJvbSAnLi9JbnRlcnNlY3Rpb25PYnNlcnZlcic7XG5leHBvcnQgeyBkZWZhdWx0IGFzIEludGVyc2VjdGlvbk9ic2VydmVyUG9seWZpbGwgfSBmcm9tICcuL0ludGVyc2VjdGlvbk9ic2VydmVyUG9seWZpbGwnO1xuZXhwb3J0IHsgZGVmYXVsdCBhcyBCYXNlVGVjaG5pcXVlIH0gZnJvbSAnLi9CYXNlVGVjaG5pcXVlJzsiLCIvKipcbiAqIFN0cmF0ZWdpZXMgbW9kdWxlXG4gKiBAbW9kdWxlIE1lYXN1cmVtZW50L1N0cmF0ZWdpZXNcbiAqIHJlcHJlc2VudHMgY29uc3RhbnRzIGFuZCBmYWN0b3JpZXMgcmVsYXRlZCB0byBtZWFzdXJlbWVudCBzdHJhdGVnaWVzIFxuICovXG5cbmltcG9ydCAqIGFzIFZhbGlkYXRvcnMgZnJvbSAnLi4vLi4vSGVscGVycy9WYWxpZGF0b3JzJztcbmltcG9ydCAqIGFzIE1lYXN1cmVtZW50VGVjaG5pcXVlcyBmcm9tICcuLi9NZWFzdXJlbWVudFRlY2huaXF1ZXMvJztcbmltcG9ydCAqIGFzIFZpZXdhYmlsaXR5Q3JpdGVyaWEgZnJvbSAnLi4vLi4vT3B0aW9ucy9WaWV3YWJpbGl0eUNyaXRlcmlhJztcblxuLyoqXG4gKiByZXByZXNlbnRzIGRlZmF1bHQgbWVhc3VyZW1lbnQgc3RyYXRlZ3kuIERlZmluZXMgYXV0b3N0YXJ0LCB0ZWNobmlxdWVzLCBhbmQgbWVhc3VyZW1lbnQgY3JpdGVyaWFcbiAqIEB0eXBlIHtPYmplY3R9XG4gKi9cbmV4cG9ydCBjb25zdCBERUZBVUxUX1NUUkFURUdZID0ge1xuICBhdXRvc3RhcnQ6IHRydWUsXG4gIHRlY2huaXF1ZXM6IFtNZWFzdXJlbWVudFRlY2huaXF1ZXMuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIsIE1lYXN1cmVtZW50VGVjaG5pcXVlcy5JbnRlcnNlY3Rpb25PYnNlcnZlclBvbHlmaWxsXSxcbiAgY3JpdGVyaWE6IFZpZXdhYmlsaXR5Q3JpdGVyaWEuTVJDX1ZJREVPXG59O1xuXG4vKipcbiAqIENyZWF0ZSBzdHJhdGVneSBvYmplY3QgdXNpbmcgdGhlIHByb3ZpZGVkIHZhbHVlc1xuICogQHBhcmFtICB7Qm9vbGVhbn0gYXV0b3N0YXJ0IC0gd2hldGhlciBtZWFzdXJlbWVudCBzaG91bGQgc3RhcnQgaW1tZWRpYXRlbHlcbiAqIEBwYXJhbSAge0FycmF5LjxCYXNlVGVjaG5pcXVlPn0gdGVjaG5pcXVlcyAtIGxpc3Qgb2YgdGVjaG5pcXVlcyB0byB1c2UgZm9yIG1lYXN1cmVtZW50LiBGaXJzdCBub24tdW5tZWFzdXJlYWJsZSB0ZWNobmlxdWUgd2lsbCBiZSB1c2VkXG4gKiBAcGFyYW0gIHtPYmplY3R9IGNyaXRlcmlhIC0gY3JpdGVyaWEgb2JqZWN0LiBTZWUgT3B0aW9ucy9WaWV3YWJpbGl0eUNyaXRlcmlhIGZvciBwcmUtZGVmaW5lZCBjcml0ZXJpYSBhbmQgY3JpdGVyaWEgZmFjdG9yeVxuICogQHJldHVybiB7T2JqZWN0fSBvYmplY3QgY29udGFpbmluZyBhcHByb3ByaWF0ZWx5IG5hbWVkIHByb3BlcnRpZXMgdG8gYmUgdXNlZCBhcyBtZWFzdXJlbWVudCBzdHJhdGVneVxuICovXG5leHBvcnQgY29uc3QgU3RyYXRlZ3lGYWN0b3J5ID0gKGF1dG9zdGFydCA9IERFRkFVTFRfU1RSQVRFR1kuYXV0b3N0YXJ0LCB0ZWNobmlxdWVzID0gREVGQVVMVF9TVFJBVEVHWS50ZWNobmlxdWVzLCBjcml0ZXJpYSA9IERFRkFVTFRfU1RSQVRFR1kuY3JpdGVyaWEpID0+IHtcbiAgY29uc3Qgc3RyYXRlZ3kgPSB7IGF1dG9zdGFydCwgdGVjaG5pcXVlcywgY3JpdGVyaWEgfSxcbiAgICAgICAgdmFsaWRhdGVkID0gVmFsaWRhdG9ycy52YWxpZGF0ZVN0cmF0ZWd5KHN0cmF0ZWd5KTsgIFxuXG4gIGlmKHZhbGlkYXRlZC5pbnZhbGlkKSB7XG4gICAgdGhyb3cgdmFsaWRhdGVkLnJlYXNvbnM7XG4gIH1cblxuICByZXR1cm4gc3RyYXRlZ3k7XG59OyIsImltcG9ydCAnLi9IZWxwZXJzL1BvbHlmaWxscy5qcyc7XG5pbXBvcnQgKiBhcyBFdmVudHMgZnJvbSAnLi9NZWFzdXJlbWVudC9FdmVudHMnO1xuaW1wb3J0IEluVmlld1RpbWVyIGZyb20gJy4vVGltaW5nL0luVmlld1RpbWVyJztcbmltcG9ydCAqIGFzIFN0cmF0ZWdpZXMgZnJvbSAnLi9NZWFzdXJlbWVudC9TdHJhdGVnaWVzLyc7XG5pbXBvcnQgKiBhcyBFbnZpcm9ubWVudCBmcm9tICcuL0Vudmlyb25tZW50L0Vudmlyb25tZW50JztcbmltcG9ydCBNZWFzdXJlbWVudEV4ZWN1dG9yIGZyb20gJy4vTWVhc3VyZW1lbnQvTWVhc3VyZW1lbnRFeGVjdXRvcic7XG5pbXBvcnQgKiBhcyBWaWV3YWJpbGl0eUNyaXRlcmlhIGZyb20gJy4vT3B0aW9ucy9WaWV3YWJpbGl0eUNyaXRlcmlhJztcbmltcG9ydCAqIGFzIE1lYXN1cmVtZW50VGVjaG5pcXVlcyBmcm9tICcuL01lYXN1cmVtZW50L01lYXN1cmVtZW50VGVjaG5pcXVlcy8nO1xuXG4vKiogQ2xhc3MgcmVwcmVzZW50cyB0aGUgbWFpbiBlbnRyeSBwb2ludCB0byB0aGUgT3BlblZWIGxpYnJhcnkgKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIE9wZW5WViB7XG4gIC8qKlxuICAgKiBDcmVhdGUgYSBuZXcgaW5zdGFuY2Ugb2YgT3BlblZWIFxuICAgKi9cbiAgY29uc3RydWN0b3IoKSB7XG4gICAgdGhpcy5leGVjdXRvcnMgPSBbXTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBbGxvd3MgbWVhc3VyZW1lbnQgb2YgYW4gZWxlbWVudCB1c2luZyBhIHN0cmF0ZWd5IGRlZmluaXRpb24gIFxuICAgKiBAcGFyYW0gIHtIVE1MRWxlbWVudH0gZWxlbWVudCAtIHRoZSBlbGVtZW50IHlvdSdkIGxpa2UgbWVhc3VyZSB2aWV3YWJpbGl0eSBvblxuICAgKiBAcGFyYW0gIHtPYmplY3R9IHN0cmF0ZWd5IC0gYW4gb2JqZWN0IHJlcHJlc2VudGluZyB0aGUgc3RyYXRlZ3kgdG8gdXNlIGZvciBtZWFzdXJlbWVudC4gXG4gICAqIFNlZSBPcGVuVlYuU3RyYXRlZ2llcyBmb3IgU3RyYXRlZ3lGYWN0b3J5IGFuZCBERUZBVUxUX1NUUkFURUdZIGZvciBtb3JlIGluZm9ybWF0aW9uLiBcbiAgICogQHJldHVybiB7TWVhc3VyZW1lbnRFeGVjdXRvcn0gcmV0dXJucyBpbnN0YW5jZSBvZiBNZWFzdXJtZW50RXhlY3V0b3IuIFxuICAgKiBUaGlzIGluc3RhbmNlIGV4cG9zZXMgZXZlbnQgbGlzdGVuZXJzIG9uVmlld2FibGVTdGFydCwgb25WaWV3YWJsZVN0b3AsIG9uVmlld2FibGVDaGFuZ2UsIG9uVmlld2FibGVDb21wbGV0ZSwgYW5kIG9uVW5tZWFzdXJlYWJsZVxuICAgKiBBbHNvIGV4cG9zZXMgc3RhcnQgYW5kIGRpc3Bvc2VcbiAgICovXG4gIG1lYXN1cmVFbGVtZW50KGVsZW1lbnQsIHN0cmF0ZWd5KSB7XG4gICAgY29uc3QgZXhlY3V0b3IgPSBuZXcgTWVhc3VyZW1lbnRFeGVjdXRvcihlbGVtZW50LCBzdHJhdGVneSk7XG4gICAgdGhpcy5leGVjdXRvcnMucHVzaChleGVjdXRvcik7XG4gICAgcmV0dXJuIGV4ZWN1dG9yO1xuICB9IFxuXG4gIC8qKlxuICAgKiBkZXN0cm95cyBhbGwgbWVhc3VyZW1lbnQgZXhlY3V0b3JzXG4gICAqL1xuICBkaXNwb3NlKCkge1xuICAgIHRoaXMuZXhlY3V0b3JzLmZvckVhY2goIGUgPT4gZS5kaXNwb3NlKCkgKTtcbiAgfVxufVxuXG4vKipcbiAqIEV4cG9zZXMgYWxsIHB1YmxpYyBjbGFzc2VzIGFuZCBjb25zdGFudHMgYXZhaWxhYmxlIGluIHRoZSBPcGVuVlYgcGFja2FnZVxuICovXG5PcGVuVlYuVmlld2FiaWxpdHlDcml0ZXJpYSA9IFZpZXdhYmlsaXR5Q3JpdGVyaWE7XG5PcGVuVlYuTWVhc3VyZW1lbnRFeGVjdXRvciA9IE1lYXN1cmVtZW50RXhlY3V0b3I7XG5PcGVuVlYuTWVhc3VyZW1lbnRUZWNobmlxdWVzID0gTWVhc3VyZW1lbnRUZWNobmlxdWVzO1xuT3BlblZWLkluVmlld1RpbWVyID0gSW5WaWV3VGltZXI7XG5PcGVuVlYuU3RyYXRlZ2llcyA9IFN0cmF0ZWdpZXM7XG5PcGVuVlYuRXZlbnRzID0gRXZlbnRzOyIsIi8qKlxuICogVmlld2FiaWxpdHkgQ3JpdGVyaWEgbW9kdWxlXG4gKiBAbW9kdWxlIE9wdGlvbnMvVmlld2FiaWxpdHlDcml0ZXJpYVxuICogcmVwcmVzZW50cyBjb25zdGFudHMgYW5kIGZhY3RvcmllcyByZWxhdGVkIHRvIG1lYXN1cmVtZW50IGNyaXRlcmlhIFxuICovXG5cbi8qKlxuICogUmVwcmVzZW50cyBjcml0ZXJpYSBmb3IgTVJDIHZpZXdhYmxlIHZpZGVvIGltcHJlc3Npb25cbiAqIEB0eXBlIHtPYmplY3R9XG4gKi9cbmV4cG9ydCBjb25zdCBNUkNfVklERU8gPSB7XG4gIGluVmlld1RocmVzaG9sZDogMC41LFxuICB0aW1lSW5WaWV3OiAyMDAwXG59O1xuXG4vKipcbiAqIFJlcHJlc2VudHMgY3JpdGVyaWEgZm9yIE1SQyB2aWV3YWJsZSBkaXNwbGF5IGltcHJlc3Npb25cbiAqIEB0eXBlIHtPYmplY3R9XG4gKi9cbmV4cG9ydCBjb25zdCBNUkNfRElTUExBWSA9IHtcbiAgaW5WaWV3VGhyZXNob2xkOiAwLjUsXG4gIHRpbWVJblZpZXc6IDEwMDBcbn07XG5cblxuLyoqXG4gKiBDcmVhdGVzIGN1c3RvbSBjcml0ZXJpYSBvYmplY3QgdXNpbmcgdGhlIHRocmVzaG9sZCBhbmQgZHVyYXRpb24gcHJvdmlkZWQgXG4gKiBAcGFyYW0gIHtOdW1iZXJ9IC0gYW1vdW50IGVsZW1lbnQgbXVzdCBiZSBpbiB2aWV3IGJlZm9yZSBpdCBpcyBjb25zaWRlcmVkIGluIHZpZXdcbiAqIEBwYXJhbSAge051bWJlcn0gLSBob3cgbG9uZyBlbGVtZW50IG11c3QgYmUgaW4gdmlldyBiZWZvcmUgaXQgaXMgY29uc2lkZXJlZCB2aWV3YWJsZVxuICogQHJldHVybiB7T2JqZWN0fSBvYmplY3QgY29udGFpbmluZyBhcHByb3ByaWF0ZWx5IG5hbWVkIHByb3BlcnRpZXMgdG8gYmUgdXNlZCBhcyB2aWV3YWJpbGl0eSBjcml0ZXJpYSBcbiAqL1xuZXhwb3J0IGNvbnN0IGN1c3RvbUNyaXRlcmlhID0gKGluVmlld1RocmVzaG9sZCA9IDAuNSwgdGltZUluVmlldyA9IDIwMDApID0+ICh7IGluVmlld1RocmVzaG9sZCwgdGltZUluVmlldyB9KTsiLCIvKipcbiAqIFJlcHJlc2VudHMgYSB0aW1lciBjbGFzcyB0byBub3RpZnkgYSBsaXN0ZW5lciB3aGVuIGEgc3BlY2lmaWVkIGR1cmF0aW9uIGhhcyBlbGFwc2VkXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEluVmlld1RpbWVyIHtcbiAgLyoqXG4gICAqIENyZWF0ZXMgbmV3IGluc3RhbmNlIG9mIGFuIEluVmlld1RpbWVyXG4gICAqIEBjb25zdHJ1Y3RvclxuICAgKiBAcGFyYW0gIHtOdW1iZXJ9IGR1cmF0aW9uIC0gd2hlbiB0byBmaXJlIGVsYXBzZWQgY2FsbGJhY2tcbiAgICogQHJldHVybiB7SW5WaWV3VGltZXJ9IGluc3RhbmNlIG9mIEluVmlld1RpbWVyXG4gICAqL1xuICBjb25zdHJ1Y3RvcihkdXJhdGlvbikge1xuICAgIHRoaXMuZHVyYXRpb24gPSBkdXJhdGlvbjtcbiAgICB0aGlzLmxpc3RlbmVycyA9IFtdO1xuICAgIHRoaXMuY29tcGxldGVkID0gZmFsc2U7XG4gIH1cblxuICAvKipcbiAgICogbm90aWZpZXMgbGlzdGVuZXJzIHRoYXQgdGltZXIgaGFzIGVsYXBzZWQgZm9yIHRoZSBzcGVjaWZpZWQgZHVyYXRpb25cbiAgICovXG4gIHRpbWVyQ29tcGxldGUoKSB7XG4gICAgdGhpcy5jb21wbGV0ZWQgPSB0cnVlO1xuICAgIHRoaXMubGlzdGVuZXJzLmZvckVhY2goIGwgPT4gbCgpICk7XG4gIH1cblxuICAvKipcbiAgICogYWNjZXB0cyBjYWxsYmFjayBmdW5jdGlvbnMgdG8gY2FsbCB3aGVuIHRoZSB0aW1lciBoYXMgZWxhcHNlZFxuICAgKiBAcGFyYW0gIHtGdW5jdGlvbn0gY2IgLSBjYWxsYmFjayB0byBjYWxsIHdoZW4gdGltZXIgaGFzIGVsYXBzZWRcbiAgICovXG4gIGVsYXBzZWQoY2IpIHtcbiAgICBpZih0eXBlb2YgY2IgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHRoaXMubGlzdGVuZXJzLnB1c2goY2IpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBzdGFydCB0aW1lclxuICAgKi9cbiAgc3RhcnQoKSB7XG4gICAgdGhpcy5lbmRUaW1lcigpO1xuICAgIHRoaXMudGltZXIgPSBzZXRUaW1lb3V0KHRoaXMudGltZXJDb21wbGV0ZS5iaW5kKHRoaXMpLCB0aGlzLmR1cmF0aW9uKTtcbiAgfVxuXG4gIC8qKiBzdG9wIHRpbWVyICovXG4gIHN0b3AoKSB7XG4gICAgdGhpcy5lbmRUaW1lcigpO1xuICB9XG5cbiAgLyoqIGNsZWFycyBzZXRUaW1lb3V0IGFzc29jaWF0ZWQgd2l0aCBjbGFzcyAqL1xuICBlbmRUaW1lcigpIHtcbiAgICBpZih0aGlzLnRpbWVyKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy50aW1lcik7XG4gICAgICB0aGlzLmxpc3RlbmVycy5sZW5ndGggPSAwO1xuICAgIH1cbiAgfVxuXG4gIC8qKiBkZXN0cm95cyB0aW1lciAqL1xuICBkaXNwb3NlKCkge1xuICAgIHRoaXMuZW5kVGltZXIoKTtcbiAgfVxuXG59Il19
