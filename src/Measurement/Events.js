/**
 * Events module
 * @module Measurement/Events
 * represents Event constants
 */

/** represents that element is in view and measurement has started */
export const START = 'start';
/** represents a viewable measurement stop. This occurs when measurement has previously started, but the element has gone out of view */
export const STOP = 'stop';
/** represents a viewable change event. Either measurement has started, stopped, or the element's in view amount (viewable percentage) has changed */
export const CHANGE = 'change';
/** represents that viewability measurement has completed. the element has been in view for the duration specified in the measurement criteria */
export const COMPLETE = 'complete';
/** represents that no compatible techniques have been found to measure viewability with */
export const UNMEASUREABLE = 'unmeasureable';
/** internal representation of the viewable state of the element as in view */
export const INVIEW = 'inview';
/** internal representation of the viewable state of the element as out of view */
export const OUTVIEW = 'outview'; 