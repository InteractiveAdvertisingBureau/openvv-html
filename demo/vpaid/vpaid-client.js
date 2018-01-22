(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
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

},{}],2:[function(require,module,exports){
!function(e,t){"object"==typeof exports&&"object"==typeof module?module.exports=t():"function"==typeof define&&define.amd?define([],t):"object"==typeof exports?exports.VPAIDInterface=t():e.VPAIDInterface=t()}(this,function(){return function(e){function t(r){if(n[r])return n[r].exports;var i=n[r]={i:r,l:!1,exports:{}};return e[r].call(i.exports,i,i.exports,t),i.l=!0,i.exports}var n={};return t.m=e,t.c=n,t.d=function(e,n,r){t.o(e,n)||Object.defineProperty(e,n,{configurable:!1,enumerable:!0,get:r})},t.n=function(e){var n=e&&e.__esModule?function(){return e.default}:function(){return e};return t.d(n,"a",n),n},t.o=function(e,t){return Object.prototype.hasOwnProperty.call(e,t)},t.p="",t(t.s=11)}([function(e,t,n){"use strict";Object.defineProperty(t,"__esModule",{value:!0});t.AD_LOADED="AdLoaded",t.AD_STARTED="AdStarted",t.AD_STOPPED="AdStopped",t.AD_SKIPPED="AdSkipped",t.AD_SKIPPABLE_STATE_CHANGE="AdSkippableStateChange",t.AD_SIZE_CHANGE="AdSizeChange",t.AD_LINEAR_CHANGE="AdLinearChange",t.AD_DURATION_CHANGE="AdDurationChange",t.AD_EXPANDED_CHANGE="AdExpandedChange",t.AD_REMAINING_TIME_CHANGE="AdRemainingTimeChange",t.AD_VOLUME_CHANGE="AdVolumeChange",t.AD_IMPRESSION="AdImpression",t.AD_VIDEO_START="AdVideoStart",t.AD_VIDEO_FIRST_QUARTILE="AdVideoFirstQuartile",t.AD_VIDEO_MIDPOINT="AdVideoMidpoint",t.AD_VIDEO_THIRD_QUARTILE="AdVideoThirdQuartile",t.AD_VIDEO_COMPLETE="AdVideoComplete",t.AD_CLICK_THRU="AdClickThru",t.AD_INTERACTION="AdInteraction",t.AD_USER_ACCEPT_INVITATION="AdUserAcceptInvitation",t.AD_USER_MINIMIZE="AdUserMinimize",t.AD_USER_CLOSE="AdUserClose",t.AD_PAUSED="AdPaused",t.AD_PLAYING="AdPlaying",t.AD_LOG="AdLog",t.AD_ERROR="AdError"},function(e,t,n){"use strict";function r(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}function i(e,t){if(!e)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return!t||"object"!=typeof t&&"function"!=typeof t?e:t}function o(e,t){if("function"!=typeof t&&null!==t)throw new TypeError("Super expression must either be null or a function, not "+typeof t);e.prototype=Object.create(t&&t.prototype,{constructor:{value:e,enumerable:!1,writable:!0,configurable:!0}}),t&&(Object.setPrototypeOf?Object.setPrototypeOf(e,t):e.__proto__=t)}Object.defineProperty(t,"__esModule",{value:!0}),t.Listenable=t.Observable=void 0;var u=function(){function e(e,t){for(var n=0;n<t.length;n++){var r=t[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(e,r.key,r)}}return function(t,n,r){return n&&e(t.prototype,n),r&&e(t,r),t}}(),a=n(13),s=function(e){return e&&e.__esModule?e:{default:e}}(a);t.Observable=function(e){return function(e){function t(){return r(this,t),i(this,(t.__proto__||Object.getPrototypeOf(t)).apply(this,arguments))}return o(t,e),u(t,[{key:"subscribe",value:function(e,t,n){return this.pubsub=this.pubsub||new s.default,this.pubsub.subscribe(t,e.bind(n)),this}},{key:"unsubscribe",value:function(e,t){return this.pubsub=this.pubsub||new s.default,this.pubsub.unsubscribe(t,e),this}},{key:"publish",value:function(e,t){return this.pubsub=this.pubsub||new s.default,this.pubsub.publish(e,t),this}},{key:"publishAll",value:function(e){e&&(this.pubsub=this.pubsub||new s.default,e=Array.isArray(e)?e:[e],e.forEach(this.publish.bind(this)))}}]),t}(e)},t.Listenable=function(e){return function(e){function t(){return r(this,t),i(this,(t.__proto__||Object.getPrototypeOf(t)).apply(this,arguments))}return o(t,e),u(t,[{key:"registerListener",value:function(e,t,n,r){this.listeners=this.listeners||[],n=n.bind(r),this.listeners.push({el:e,eventName:t,fn:n}),e.addEventListener(t,n)}},{key:"unregisterListener",value:function(e,t){this.listeners=this.listeners||[],this.listeners.filter(function(e){return e.eventName===t}).forEach(function(t){return e.removeEventListener(t.eventName,t.fn)}),this.listeners=this.listeners.filter(function(e){return e.eventName!==t})}},{key:"unregisterAll",value:function(){this.listeners=this.listeners||[],this.listeners.forEach(function(e){return e.el.removeEventListener(e.eventName,e.fn)}),this.listeners=[]}}]),t}(e)}},function(e,t,n){"use strict";function r(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}Object.defineProperty(t,"__esModule",{value:!0}),t.default=void 0;var i,o=function(){function e(e,t){for(var n=0;n<t.length;n++){var r=t[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(e,r.key,r)}}return function(t,n,r){return n&&e(t.prototype,n),r&&e(t,r),t}}(),u=n(1),a=(0,u.Observable)(i=function(){function e(){r(this,e)}return o(e,[{key:"play",value:function(){}},{key:"pause",value:function(){}},{key:"destroy",value:function(){}},{key:"publish",value:function(){}},{key:"subscribe",value:function(){}},{key:"unsubscribe",value:function(){}},{key:"duration",get:function(){return-2}},{key:"remaining",get:function(){return-2}},{key:"volume",set:function(e){}}]),e}())||i;t.default=a},function(e,t,n){"use strict";function r(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}Object.defineProperty(t,"__esModule",{value:!0}),t.default=void 0;var i,o=function(){function e(e,t){for(var n=0;n<t.length;n++){var r=t[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(e,r.key,r)}}return function(t,n,r){return n&&e(t.prototype,n),r&&e(t,r),t}}(),u=n(1),a=(0,u.Observable)(i=function(){function e(){r(this,e)}return o(e,[{key:"setSize",value:function(){}},{key:"generateControls",value:function(){return document.createDocumentFragment()}},{key:"destroy",value:function(){}},{key:"publish",value:function(){}},{key:"subscribe",value:function(){}},{key:"unsubscribe",value:function(){}}]),e}())||i;t.default=a},function(e,t,n){"use strict";function r(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}Object.defineProperty(t,"__esModule",{value:!0});var i=function(){function e(e,t){for(var n=0;n<t.length;n++){var r=t[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(e,r.key,r)}}return function(t,n,r){return n&&e(t.prototype,n),r&&e(t,r),t}}(),o=function(){function e(){r(this,e)}return i(e,null,[{key:"parseAdParameters",value:function(){return{}}}]),e}();t.default=o},function(e,t,n){"use strict";function r(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}function i(e,t){if(!e)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return!t||"object"!=typeof t&&"function"!=typeof t?e:t}function o(e,t){if("function"!=typeof t&&null!==t)throw new TypeError("Super expression must either be null or a function, not "+typeof t);e.prototype=Object.create(t&&t.prototype,{constructor:{value:e,enumerable:!1,writable:!0,configurable:!0}}),t&&(Object.setPrototypeOf?Object.setPrototypeOf(e,t):e.__proto__=t)}Object.defineProperty(t,"__esModule",{value:!0}),t.default=void 0;var u,a=function(){function e(e,t){for(var n=0;n<t.length;n++){var r=t[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(e,r.key,r)}}return function(t,n,r){return n&&e(t.prototype,n),r&&e(t,r),t}}(),s=n(1),l=n(0),c=function(e){if(e&&e.__esModule)return e;var t={};if(null!=e)for(var n in e)Object.prototype.hasOwnProperty.call(e,n)&&(t[n]=e[n]);return t.default=e,t}(l),f=n(3),d=function(e){return e&&e.__esModule?e:{default:e}}(f),p=(0,s.Listenable)(u=function(e){function t(e,n,o){var u=n.clickThrough,a=o.size;r(this,t);var s=i(this,(t.__proto__||Object.getPrototypeOf(t)).call(this));if(void 0===e)throw"Fatal Error - slot element not provided";s.slotEl=e;var l=s.generateControls();return e.appendChild(l),u&&(s.clickThrough=u,s.setSize(a.width,a.height),s.registerListener(e,"click",s.onClick,s)),s}return o(t,e),a(t,[{key:"onClick",value:function(e){e.preventDefault(),this.publish(c.AD_CLICK_THRU),window.open(this.clickThrough,"_blank")}},{key:"setSize",value:function(e,t){this.slotEl.style="cursor: pointer; width: "+e+"px; height: "+t+"px;"}},{key:"generateControls",value:function(){return document.createDocumentFragment()}},{key:"destroy",value:function(){this.unregisterAll()}}]),t}(d.default))||u;t.default=p},function(e,t,n){"use strict";function r(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}function i(e,t){if(!e)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return!t||"object"!=typeof t&&"function"!=typeof t?e:t}function o(e,t){if("function"!=typeof t&&null!==t)throw new TypeError("Super expression must either be null or a function, not "+typeof t);e.prototype=Object.create(t&&t.prototype,{constructor:{value:e,enumerable:!1,writable:!0,configurable:!0}}),t&&(Object.setPrototypeOf?Object.setPrototypeOf(e,t):e.__proto__=t)}Object.defineProperty(t,"__esModule",{value:!0}),t.default=void 0;var u=function(){function e(e,t){for(var n=0;n<t.length;n++){var r=t[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(e,r.key,r)}}return function(t,n,r){return n&&e(t.prototype,n),r&&e(t,r),t}}(),a=n(4),s=function(e){return e&&e.__esModule?e:{default:e}}(a),l=function(e){function t(){return r(this,t),i(this,(t.__proto__||Object.getPrototypeOf(t)).apply(this,arguments))}return o(t,e),u(t,null,[{key:"parseAdParameters",value:function(e){return JSON.parse(e)}}]),t}(s.default);t.default=l},function(e,t,n){"use strict";function r(e){return e&&e.__esModule?e:{default:e}}function i(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}function o(e,t){if(!e)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return!t||"object"!=typeof t&&"function"!=typeof t?e:t}function u(e,t){if("function"!=typeof t&&null!==t)throw new TypeError("Super expression must either be null or a function, not "+typeof t);e.prototype=Object.create(t&&t.prototype,{constructor:{value:e,enumerable:!1,writable:!0,configurable:!0}}),t&&(Object.setPrototypeOf?Object.setPrototypeOf(e,t):e.__proto__=t)}Object.defineProperty(t,"__esModule",{value:!0}),t.default=void 0;var a,s=function(){function e(e,t){for(var n=0;n<t.length;n++){var r=t[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(e,r.key,r)}}return function(t,n,r){return n&&e(t.prototype,n),r&&e(t,r),t}}(),l=n(1),c=n(0),f=function(e){if(e&&e.__esModule)return e;var t={};if(null!=e)for(var n in e)Object.prototype.hasOwnProperty.call(e,n)&&(t[n]=e[n]);return t.default=e,t}(c),d=n(2),p=r(d),h=n(8),v=r(h),b=(0,l.Listenable)(a=function(e){function t(e,n,r){var u=n.videoURL;i(this,t);var a=o(this,(t.__proto__||Object.getPrototypeOf(t)).call(this));if(!e||!u)throw"Fatal Error - videoElement or videoURL not provided";return a.initializeState(e,u),a.registerEvents(e),a}return u(t,e),s(t,[{key:"play",value:function(){this.videoEl&&this.videoEl.play()}},{key:"pause",value:function(){this.videoEl&&this.videoEl.pause()}},{key:"initializeState",value:function(e,t){this.videoEl=e,this.videoURL=t,this.videoEl.autoplay=!0,this.videoEl.src=t,this.videoEl.play()}},{key:"registerEvents",value:function(e){this.registerListener(e,"loadedmetadata",this.onLoadedMetaData,this),this.registerListener(e,"ended",this.onEnded,this)}},{key:"onLoadedMetaData",value:function(e){this.timeUpdateHandler=new v.default(e.target.duration),this.registerListener(e.target,"timeupdate",this.onTimeUpdate,this),this.unregisterListener(e.target,"loadedmetadata"),this.publish(f.AD_DURATION_CHANGE)}},{key:"onTimeUpdate",value:function(e){var t=this.timeUpdateHandler.onTimeUpdate(e);this.publishAll(t)}},{key:"onEnded",value:function(){this.publish(f.AD_VIDEO_COMPLETE),this.publish(f.AD_STOPPED),this.destory()}},{key:"destory",value:function(){this.videoEl&&(this.videoEl.pause(),this.unregisterAll())}},{key:"duration",get:function(){return this.videoEl.duration>0?this.videoEl.duration:-2}},{key:"remaining",get:function(){return this.videoEl.duration?this.videoEl.duration-this.videoEl.currentTime:-2}},{key:"volume",get:function(){this.videoEl&&this.videoEl.volume},set:function(e){this.videoEl&&!isNaN(e)&&(this.videoEl.volume=e)}}]),t}(p.default))||a;t.default=b},function(e,t,n){"use strict";function r(e){return e&&e.__esModule?e:{default:e}}function i(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}function o(e,t){if(!e)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return!t||"object"!=typeof t&&"function"!=typeof t?e:t}function u(e,t){if("function"!=typeof t&&null!==t)throw new TypeError("Super expression must either be null or a function, not "+typeof t);e.prototype=Object.create(t&&t.prototype,{constructor:{value:e,enumerable:!1,writable:!0,configurable:!0}}),t&&(Object.setPrototypeOf?Object.setPrototypeOf(e,t):e.__proto__=t)}Object.defineProperty(t,"__esModule",{value:!0}),t.default=void 0;var a=function(){function e(e,t){for(var n=0;n<t.length;n++){var r=t[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(e,r.key,r)}}return function(t,n,r){return n&&e(t.prototype,n),r&&e(t,r),t}}(),s=n(0),l=function(e){if(e&&e.__esModule)return e;var t={};if(null!=e)for(var n in e)Object.prototype.hasOwnProperty.call(e,n)&&(t[n]=e[n]);return t.default=e,t}(s),c=n(9),f=r(c),d=n(10),p=r(d),h=function(e){function t(){return i(this,t),o(this,(t.__proto__||Object.getPrototypeOf(t)).apply(this,arguments))}return u(t,e),a(t,[{key:"generateTimeEvents",value:function(e){var t=e/4;return[new p.default(l.AD_VIDEO_FIRST_QUARTILE,t),new p.default(l.AD_VIDEO_MIDPOINT,2*t),new p.default(l.AD_VIDEO_THIRD_QUARTILE,3*t)]}}]),t}(f.default);t.default=h},function(e,t,n){"use strict";function r(e){if(Array.isArray(e)){for(var t=0,n=Array(e.length);t<e.length;t++)n[t]=e[t];return n}return Array.from(e)}function i(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}Object.defineProperty(t,"__esModule",{value:!0}),t.default=void 0;var o=function(){function e(e,t){for(var n=0;n<t.length;n++){var r=t[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(e,r.key,r)}}return function(t,n,r){return n&&e(t.prototype,n),r&&e(t,r),t}}(),u=n(0),a=function(e){if(e&&e.__esModule)return e;var t={};if(null!=e)for(var n in e)Object.prototype.hasOwnProperty.call(e,n)&&(t[n]=e[n]);return t.default=e,t}(u),s=function(){function e(t){i(this,e),this.lastTime=this.now,this.UPDATE_THRESHOLD=250,this.timeEvents=this.generateTimeEvents(t)}return o(e,[{key:"generateTimeEvents",value:function(e){return[]}},{key:"collectEvents",value:function(e){return this.timeEvents.reduce(function(t,n){var r=n.didEventOccur(e);return r&&t.push(r),t},[])}},{key:"onTimeUpdate",value:function(e){var t=[],n=e.target.currentTime;return this.now>this.lastTime+this.UPDATE_THRESHOLD&&(t=[].concat(r(this.collectEvents(n)),[a.AD_REMAINING_TIME_CHANGE])),this.lastTime=this.now,t}},{key:"now",get:function(){return(new Date).getTime()}}]),e}();t.default=s},function(e,t,n){"use strict";function r(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}Object.defineProperty(t,"__esModule",{value:!0});var i=function(){function e(e,t){for(var n=0;n<t.length;n++){var r=t[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(e,r.key,r)}}return function(t,n,r){return n&&e(t.prototype,n),r&&e(t,r),t}}(),o=function(){function e(t,n){r(this,e),this.eventName=t,this.eventTime=n,this.fired=!1}return i(e,[{key:"didEventOccur",value:function(e){if(!this.fired&&e>this.eventTime)return this.fired=!0,this.eventName}}]),e}();t.default=o},function(e,t,n){"use strict";function r(e){return e&&e.__esModule?e:{default:e}}var i=n(12),o=r(i),u=n(0),a=function(e){if(e&&e.__esModule)return e;var t={};if(null!=e)for(var n in e)Object.prototype.hasOwnProperty.call(e,n)&&(t[n]=e[n]);return t.default=e,t}(u),s=n(2),l=r(s),c=n(7),f=r(c),d=n(10),p=r(d),h=n(9),v=r(h),b=n(8),y=r(b),_=n(3),A=r(_),O=n(5),E=r(O),m=n(4),P=r(m),g=n(6),w=r(g);o.default.VPAIDInterface=o.default,o.default.VPAIDEvents=a,o.default.BaseCreative=l.default,o.default.VideoCreative=f.default,o.default.TimeEvent=p.default,o.default.TimeUpdateHandler=v.default,o.default.QuartileTimeUpdateHandler=y.default,o.default.BaseOverlay=A.default,o.default.ClickThroughOverlay=E.default,o.default.BaseParser=P.default,o.default.JSONParser=w.default,e.exports=o.default},function(e,t,n){"use strict";function r(e){return e&&e.__esModule?e:{default:e}}function i(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}Object.defineProperty(t,"__esModule",{value:!0}),t.default=void 0;var o,u=function(){function e(e,t){var n=[],r=!0,i=!1,o=void 0;try{for(var u,a=e[Symbol.iterator]();!(r=(u=a.next()).done)&&(n.push(u.value),!t||n.length!==t);r=!0);}catch(e){i=!0,o=e}finally{try{!r&&a.return&&a.return()}finally{if(i)throw o}}return n}return function(t,n){if(Array.isArray(t))return t;if(Symbol.iterator in Object(t))return e(t,n);throw new TypeError("Invalid attempt to destructure non-iterable instance")}}(),a=function(){function e(e,t){for(var n=0;n<t.length;n++){var r=t[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(e,r.key,r)}}return function(t,n,r){return n&&e(t.prototype,n),r&&e(t,r),t}}(),s=n(1),l=n(14),c=n(0),f=function(e){if(e&&e.__esModule)return e;var t={};if(null!=e)for(var n in e)Object.prototype.hasOwnProperty.call(e,n)&&(t[n]=e[n]);return t.default=e,t}(c),d=n(15),p=n(5),h=r(p),v=n(6),b=r(v),y=n(7),_=r(y),A=(0,s.Observable)(o=(0,d.VPAIDMethods)(o=(0,d.VPAIDProperties)(o=function(){function e(){var t=arguments.length>0&&void 0!==arguments[0]?arguments[0]:{};i(this,e),this.initializeState(t),this.attachVPAID(t)}return a(e,[{key:"attachVPAID",value:function(e){e.window&&!e.window.getVPAIDAd&&(e.window.getVPAIDAd=this.getVPAIDAd.bind(this))}},{key:"initializeState",value:function(e){this.expanded=!1,this.skippable=!1,this.size={width:640,height:360},this.selectComponents(e)}},{key:"selectComponents",value:function(e){this.AdCreative=(0,l.ValidCreative)(e.creativeFormat)?e.creativeFormat:_.default,this.Overlay=(0,l.ValidOverlay)(e.overlays)?e.overlays:h.default,this.Parser=(0,l.ValidParser)(e.parser)?e.parser:b.default}},{key:"getVPAIDAd",value:function(){return this}},{key:"onAdParseFail",value:function(e){console.log(e),this.destroy(),this.publish(f.AD_ERROR,"Error parsing AdParameters - "+e.toString()),this.publish(f.AD_STOPPED)}},{key:"onAdParametersParsed",value:function(e){var t=this,n=u(e,1),r=n[0];this.ad=new this.AdCreative(this.environmentVars.videoSlot,r,this),this.adOverlay=new this.Overlay(this.environmentVars.slot,r,this),Object.values(f).forEach(function(e){t.ad&&t.ad.subscribe&&t.ad.subscribe(t.onCreativeEvent.bind(t,e),e),t.adOverlay&&t.adOverlay.subscribe&&t.adOverlay.subscribe(t.onOverlayEvent.bind(t,e),e)}),this.publish(f.AD_LOADED)}},{key:"onCreativeEvent",value:function(e){this.publish(e)}},{key:"onOverlayEvent",value:function(e){this.publish(e)}},{key:"destroy",value:function(){this.ad&&"function"==typeof this.ad.destroy&&this.ad.destroy(),this.adOverlay&&"function"==typeof this.adOverlay.destroy&&this.adOverlay.destroy()}}]),e}())||o)||o)||o;t.default=A},function(e,t,n){var r,i;/**
 * PubSub.js
 * Javascript implementation of the Publish/Subscribe pattern.
 *
 * @version 3.4.0
 * @author George Raptis <georapbox@gmail.com> (georapbox.github.io)
 * @homepage https://github.com/georapbox/PubSub#readme
 * @repository https://github.com/georapbox/PubSub.git
 * @license MIT
 */
!function(o,u,a){"use strict";r=a,void 0!==(i="function"==typeof r?r.call(t,n,t,e):r)&&(e.exports=i)}(0,0,function(e,t){"use strict";function n(e,t,n){var r;for(r in e)if(Object.prototype.hasOwnProperty.call(e,r)&&t&&!1===t.call(n,e[r],r,e))return;return e}function r(e){return function(){return this[e].apply(this,arguments)}}function i(e,t,n){for(var r,i,o=e._pubsub_topics,u=o[t]?o[t].slice(0):[],a=0,s=u.length;a<s;a+=1)i=u[a].token,r=u[a],r.callback(n,{name:t,token:i}),!0===r.once&&e.unsubscribe(i)}function o(e){var t=Array.prototype.slice.call(e,1);return t.length<=1?t[0]:t}function u(e,t,n,r){return!!e._pubsub_topics[t]&&(r?i(e,t,n):setTimeout(function(){i(e,t,n)},0),!0)}function a(){return this instanceof a?(this._pubsub_topics={},this._pubsub_uid=-1,this):new a}var s=(t||{})[e];return a.prototype.subscribe=function(e,t,n){var r=this._pubsub_topics,i=this._pubsub_uid+=1,o={};if("function"!=typeof t)throw new TypeError("When subscribing for an event, a callback function must be defined.");return r[e]||(r[e]=[]),o.token=i,o.callback=t,o.once=!!n,r[e].push(o),i},a.prototype.subscribeOnce=function(e,t){return this.subscribe(e,t,!0)},a.prototype.publish=function(e){return u(this,e,o(arguments),!1)},a.prototype.publishSync=function(e){return u(this,e,o(arguments),!0)},a.prototype.unsubscribe=function(e){var t,n,r=this._pubsub_topics,i=!1;for(t in r)if(Object.prototype.hasOwnProperty.call(r,t)&&r[t]){for(n=r[t].length;n;){if(n-=1,r[t][n].token===e)return r[t].splice(n,1),0===r[t].length&&delete r[t],e;t===e&&(r[t].splice(n,1),0===r[t].length&&delete r[t],i=!0)}if(!0===i)return e}return!1},a.prototype.unsubscribeAll=function(){return this._pubsub_topics={},this},a.prototype.hasSubscribers=function(e){var t=this._pubsub_topics,r=!1;return null==e?(n(t,function(e,t){if(t)return r=!0,!1}),r):Object.prototype.hasOwnProperty.call(t,e)},a.prototype.subscribers=function(){var e={};return n(this._pubsub_topics,function(t,n){e[n]=t.slice(0)}),e},a.prototype.subscribersByTopic=function(e){return this._pubsub_topics[e]?this._pubsub_topics[e].slice(0):[]},a.prototype.alias=function(e){return n(e,function(t,n){a.prototype[n]&&(a.prototype[e[n]]=r(n))}),this},a.noConflict=function(){return t&&(t[e]=s),a},a.version="3.4.0",a})},function(e,t,n){"use strict";function r(e){return e&&e.__esModule?e:{default:e}}Object.defineProperty(t,"__esModule",{value:!0}),t.ValidParser=t.ValidOverlay=t.ValidCreative=t.ValidateClass=void 0;var i=n(2),o=r(i),u=n(3),a=r(u),s=n(4),l=r(s),c=t.ValidateClass=function(e,t){return e.prototype instanceof t};t.ValidCreative=function(e){if(void 0===e)return!1;if(c(e,o.default))return!0;throw"Invalid creative provided. Should inherit from BaseCreative or VideoCreative"},t.ValidOverlay=function(e){if(void 0===e)return!1;if(c(e,a.default))return!0;throw"Invalid overlay provided. Should inherit from BaseOverlay or SimpleControls"},t.ValidParser=function(e){if(void 0===e)return!1;if(c(e,l.default))return!0;throw"Invalid parser provided. Should inherit from BaseParser or JSONParser"}},function(e,t,n){"use strict";function r(e){return e&&e.__esModule?e:{default:e}}Object.defineProperty(t,"__esModule",{value:!0}),t.VPAIDProperties=t.VPAIDMethods=void 0;var i=n(16),o=r(i),u=n(17),a=r(u);t.VPAIDMethods=o.default,t.VPAIDProperties=a.default},function(e,t,n){"use strict";function r(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}function i(e,t){if(!e)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return!t||"object"!=typeof t&&"function"!=typeof t?e:t}function o(e,t){if("function"!=typeof t&&null!==t)throw new TypeError("Super expression must either be null or a function, not "+typeof t);e.prototype=Object.create(t&&t.prototype,{constructor:{value:e,enumerable:!1,writable:!0,configurable:!0}}),t&&(Object.setPrototypeOf?Object.setPrototypeOf(e,t):e.__proto__=t)}Object.defineProperty(t,"__esModule",{value:!0});var u=Object.assign||function(e){for(var t=1;t<arguments.length;t++){var n=arguments[t];for(var r in n)Object.prototype.hasOwnProperty.call(n,r)&&(e[r]=n[r])}return e},a=function(){function e(e,t){for(var n=0;n<t.length;n++){var r=t[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(e,r.key,r)}}return function(t,n,r){return n&&e(t.prototype,n),r&&e(t,r),t}}(),s=n(0),l=function(e){if(e&&e.__esModule)return e;var t={};if(null!=e)for(var n in e)Object.prototype.hasOwnProperty.call(e,n)&&(t[n]=e[n]);return t.default=e,t}(s);t.default=function(e){return function(e){function t(){return r(this,t),i(this,(t.__proto__||Object.getPrototypeOf(t)).apply(this,arguments))}return o(t,e),a(t,[{key:"initAd",value:function(e,t,n,r){var i=arguments.length>4&&void 0!==arguments[4]?arguments[4]:{},o=arguments.length>5&&void 0!==arguments[5]?arguments[5]:{};return this.updateStateFromInitAd({width:e,height:t,viewMode:n,creativeData:i,environmentVars:o}),this.parseAdParameters(i.AdParameters),this}},{key:"parseAdParameters",value:function(e){try{Promise.all([this.Parser.parseAdParameters(e)]).then(this.onAdParametersParsed.bind(this),this.onAdParseFail.bind(this))}catch(e){this.onAdParseFail(e)}return this}},{key:"startAd",value:function(){return this.skippable=!0,this.publish(l.AD_IMPRESSION),this.publish(l.AD_STARTED),this.publish(l.AD_VIDEO_START),this.publish(l.AD_SKIPPABLE_STATE_CHANGE),this}},{key:"skipAd",value:function(){return this.publish(l.AD_SKIPPED),this}},{key:"stopAd",value:function(){return this.destroy&&this.destroy(),this.publish(l.AD_STOPPED),this}},{key:"pauseAd",value:function(){return this.ad&&this.ad.pause(),this.publish(l.AD_PAUSED),this}},{key:"resumeAd",value:function(){return this.ad&&this.ad.play(),this.publish(l.AD_PLAYING),this}},{key:"collapseAd",value:function(){return this.expanded=!1,this.publish(l.AD_EXPANDED_CHANGE),this}},{key:"expandAd",value:function(){return this.expanded=!0,this.publish(l.AD_EXPANDED_CHANGE),this}},{key:"resizeAd",value:function(e,t,n){return this.setSize(e,t),this.viewMode=n,this.publish(l.AD_SIZE_CHANGE),this}},{key:"setSize",value:function(e,t){this.size&&(this.size.width=e,this.size.height=t),this.adOverlay&&this.adOverlay.setSize(e,t)}},{key:"updateStateFromInitAd",value:function(e){var t=e.width,n=e.height,r=e.viewMode,i=e.creativeData,o=e.environmentVars;this.setSize(t,n),this.viewMode=r,this.creativeData=u({},i),this.environmentVars=u({},o)}}]),t}(e)}},function(e,t,n){"use strict";function r(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}function i(e,t){if(!e)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return!t||"object"!=typeof t&&"function"!=typeof t?e:t}function o(e,t){if("function"!=typeof t&&null!==t)throw new TypeError("Super expression must either be null or a function, not "+typeof t);e.prototype=Object.create(t&&t.prototype,{constructor:{value:e,enumerable:!1,writable:!0,configurable:!0}}),t&&(Object.setPrototypeOf?Object.setPrototypeOf(e,t):e.__proto__=t)}Object.defineProperty(t,"__esModule",{value:!0});var u=function(){function e(e,t){for(var n=0;n<t.length;n++){var r=t[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(e,r.key,r)}}return function(t,n,r){return n&&e(t.prototype,n),r&&e(t,r),t}}();t.default=function(e){return function(e){function t(){return r(this,t),i(this,(t.__proto__||Object.getPrototypeOf(t)).apply(this,arguments))}return o(t,e),u(t,[{key:"getAdExpanded",value:function(){return this.expanded}},{key:"getAdLinear",value:function(){return!0}},{key:"getAdDuration",value:function(){return this.ad?this.ad.duration:-2}},{key:"getAdRemainingTime",value:function(){return this.ad?this.ad.remaining:-2}},{key:"getAdSkippableState",value:function(){return this.skippable}},{key:"getAdVolume",value:function(){return this.ad&&!isNaN(this.ad.volume)?this.ad.volume:-1}},{key:"getAdCompanions",value:function(){return""}},{key:"getAdIcons",value:function(){return!1}},{key:"getAdHeight",value:function(){return this.size?this.size.height:-1}},{key:"getAdWidth",value:function(){return this.size?this.size.width:-1}},{key:"handshakeVersion",value:function(){return"2.0"}},{key:"setAdVolume",value:function(e){this.ad&&(this.ad.volume=e)}}]),t}(e)}}])});
},{}],3:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _vpaidGeneric = require('vpaid-generic');

var _OpenVV = require('../../OpenVV.js');

var _OpenVV2 = _interopRequireDefault(_OpenVV);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var OpenVVOverlay = function (_BaseOverlay) {
  _inherits(OpenVVOverlay, _BaseOverlay);

  function OpenVVOverlay(element) {
    _classCallCheck(this, OpenVVOverlay);

    var _this = _possibleConstructorReturn(this, (OpenVVOverlay.__proto__ || Object.getPrototypeOf(OpenVVOverlay)).call(this));

    _this.element = element;
    _this.stateDisplayElement = _this.createStateDisplay();
    _this.element.appendChild(_this.stateDisplayElement);
    _this.openvv = new _OpenVV2.default();

    _this.openvv.measureElement(element).onViewableChange(_this.updateStateDisplay.bind(_this)).onViewableComplete(_this.updateStateDisplay.bind(_this)).start();
    return _this;
  }

  _createClass(OpenVVOverlay, [{
    key: 'updateStateDisplay',
    value: function updateStateDisplay(value) {
      if ((typeof value === 'undefined' ? 'undefined' : _typeof(value)) === 'object') {
        value = Object.keys(value).map(function (key) {
          if (key === 'percentViewable') {
            value[key] = (value[key] * 100).toFixed(2) + '%';
          }
          return key + ': ' + value[key];
        }).join('\n');
      }
      this.stateDisplayElement.innerHTML = '<pre>' + value + '</pre>';
    }
  }, {
    key: 'createStateDisplay',
    value: function createStateDisplay() {
      var el = document.createElement('div');
      el.style.color = 'white';
      el.style.fontSize = '1.2em';
      el.style.padding = '16px 24px';
      el.style.textShadow = '1px 1px 2px #00000078';
      return el;
    }
  }]);

  return OpenVVOverlay;
}(_vpaidGeneric.BaseOverlay);

exports.default = OpenVVOverlay;
module.exports = exports['default'];

},{"../../OpenVV.js":14,"vpaid-generic":2}],4:[function(require,module,exports){
'use strict';

var _vpaidGeneric = require('vpaid-generic');

var _vpaidGeneric2 = _interopRequireDefault(_vpaidGeneric);

var _OpenVVOverlay = require('./OpenVVOverlay.js');

var _OpenVVOverlay2 = _interopRequireDefault(_OpenVVOverlay);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

new _vpaidGeneric2.default({ window: window, overlays: _OpenVVOverlay2.default });

},{"./OpenVVOverlay.js":3,"vpaid-generic":2}],5:[function(require,module,exports){
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

},{}],6:[function(require,module,exports){
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

},{"../Measurement/MeasurementTechniques/BaseTechnique":9}],7:[function(require,module,exports){
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

},{}],8:[function(require,module,exports){
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
      return new technique(this._element, this._strategy.criteria);
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

},{"../Environment/Environment":5,"../Helpers/Validators":6,"../Timing/InViewTimer":16,"./Events":7,"./Strategies/":13}],9:[function(require,module,exports){
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

},{}],10:[function(require,module,exports){
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

},{"../../Helpers/Validators":6,"../Strategies/":13,"./BaseTechnique":9}],11:[function(require,module,exports){
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

},{"../../Environment/Environment":5,"./IntersectionObserver":10,"intersection-observer":1}],12:[function(require,module,exports){
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

},{"./BaseTechnique":9,"./IntersectionObserver":10,"./IntersectionObserverPolyfill":11}],13:[function(require,module,exports){
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

},{"../../Helpers/Validators":6,"../../Options/ViewabilityCriteria":15,"../MeasurementTechniques/":12}],14:[function(require,module,exports){
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

},{"./Environment/Environment":5,"./Measurement/Events":7,"./Measurement/MeasurementExecutor":8,"./Measurement/MeasurementTechniques/":12,"./Measurement/Strategies/":13,"./Options/ViewabilityCriteria":15,"./Timing/InViewTimer":16}],15:[function(require,module,exports){
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

},{}],16:[function(require,module,exports){
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

},{}]},{},[4]);
