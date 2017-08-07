import BaseTechnique from '../Measurement/MeasurementTechniques/BaseTechnique';

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
export const validTechnique = (technique) => {
  const valid = 
    typeof technique === 'function' &&
    Object
      .getOwnPropertyNames(BaseTechnique)
      .reduce( (prop, valid) => valid && typeof technique[prop] === typeof BaseTechnique[prop], true);

  return valid;
};

/**
 * @param  {HTMLElement} element - element to check for validity
 * @return {Boolean} determines whether element is an actual HTML element or a proxy element (which may be provided by Google's IMA VPAID host) 
 */
export const validElement = (element) => {
  return element && element.toString().indexOf('Element') > -1;
};

/**
 * @param  {Object} obj - viewability criteria to check for validaity. Note, we're using ES6 destructuring to pull the properties we want to test from the object
 * @param  {Number} obj.inViewThreshold - amount element must be in view by, to be counted as in view
 * @param  {Number} obj.timeInView - duration element must be in view for, to be considered viewable
 * @return {Object} object that contains a property describing if the criteria meets the expected requirements and if not, which assertions it fails
 */
export const validateCriteria = ({ inViewThreshold, timeInView }) => {
  let invalid = false, reasons = []; 

  if(typeof inViewThreshold !== 'number' || inViewThreshold > 1) {
    invalid = true;
    reasons.push('inViewThreshold must be a number equal to or less than 1');
  }

  if(typeof timeInView !== 'number' || timeInView < 0) {
    invalid = true;
    reasons.push('timeInView must be a number greater to or equal 0');
  }

  return { invalid, reasons: reasons.join(' | ') };
};

/**
 * @param  {Object} obj - strategy object to test for validity 
 * @param  {Boolean} obj.autostart - configures whether viewability measurement should begin as soon as technique is configured
 * @param  {Array.<BaseTechnique>} obj.techniques - list of measurement techniques to use
 * @param  {Object} obj.criteria - measurement criteria to use to determine if an element is viewable
 * @return {Object} object describing whether the tested strategy is invalid and if so, what is the reason for being invalid
 */
export const validateStrategy = ({ autostart, techniques, criteria }) => {
  let invalid = false, reasons = [];

  if(typeof autostart !== 'boolean') {
    invalid = true;
    reasons.push('autostart must be boolean');
  }

  if(!Array.isArray(techniques) || techniques.length === 0) {
    invalid = true;
    reasons.push('techniques must be an array containing atleast on measurement techniques');
  }

  const validated = validateCriteria(criteria);

  if(validated.invalid) {
    invalid = true;
    reasons.push(validated.reasons);
  }

  return { invalid, reasons: reasons.join(' | ') };
};