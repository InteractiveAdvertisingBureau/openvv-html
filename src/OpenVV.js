import * as Events from './Measurement/Events';
import InViewTimer from './Timing/InViewTimer';
import * as Strategies from './Measurement/Strategies/';
import * as Environment from './Environment/Environment';
import MeasurementExecutor from './Measurement/MeasurementExecutor';
import * as ViewabilityCriteria from './Options/ViewabilityCriteria';
import * as MeasurementTechniques from './Measurement/MeasurementTechniques/';

/** Class represents the main entry point to the OpenVV library */
export default class OpenVV {
  /**
   * Create a new instance of OpenVV 
   */
  constructor() {
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
  measureElement(element, strategy) {
    const executor = new MeasurementExecutor(element, strategy);
    this.executors.push(executor);
    return executor;
  } 

  /**
   * destroys all measurement executors
   */
  dispose() {
    this.executors.forEach( e => e.dispose() );
  }
}

/**
 * Exposes all public classes and constants available in the OpenVV package
 */
OpenVV.ViewabilityCriteria = ViewabilityCriteria;
OpenVV.MeasurementExecutor = MeasurementExecutor;
OpenVV.MeasurementTechniques = MeasurementTechniques;
OpenVV.InViewTimer = InViewTimer;
OpenVV.Strategies = Strategies;
OpenVV.Events = Events;