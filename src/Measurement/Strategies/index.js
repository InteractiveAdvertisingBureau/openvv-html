/**
 * Strategies module
 * @module Measurement/Strategies
 * represents constants and factories related to measurement strategies 
 */

import * as Validators from '../../Helpers/Validators';
import * as MeasurementTechniques from '../MeasurementTechniques/';
import * as ViewabilityCriteria from '../../Options/ViewabilityCriteria';

/**
 * represents default measurement strategy. Defines autostart, techniques, and measurement criteria
 * @type {Object}
 */
export const DEFAULT_STRATEGY = {
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
export const StrategyFactory = (autostart = DEFAULT_STRATEGY.autostart, techniques = DEFAULT_STRATEGY.techniques, criteria = DEFAULT_STRATEGY.criteria) => {
  const strategy = { autostart, techniques, criteria },
        validated = Validators.validateStrategy(strategy);  

  if(validated.invalid) {
    throw validated.reasons;
  }

  return strategy;
};