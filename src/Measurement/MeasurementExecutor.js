import InViewTimer from '../Timing/InViewTimer';
import { DEFAULT_STRATEGY } from './Strategies/';
import { validTechnique, validateStrategy } from '../Helpers/Validators';
import * as Environment from '../Environment/Environment';
import * as Events from './Events';

/**
 * Class representing a measurement executor
 */
export default class MeasurementExecutor {
  /**
   * Create a new instance of a MeasurementExecutor
   * @param {HTMLElement} element - a HTML element to measure
   * @param {Object} strategy - a strategy object defining the measurement techniques and what criteria constitute a viewable state.
   * See OpenVV.Strategies DEFAULT_STRATEGY and StrategyFactory for more details on required params
   */
  constructor(element, strategy = {}) {
    /** @private {Object} event listener arrays */
    this._listeners = { start: [], stop: [], change: [], complete: [], unmeasureable: [] };
    /** @private {HTMLElement} HTML element to measure */
    this._element = element;
    /** @private {Object} measurement strategy */
    this._strategy = Object.assign({}, DEFAULT_STRATEGY, strategy);
    /** @private {Boolean} tracks whether viewability criteria has been met */
    this._criteriaMet = false;

    const validated = validateStrategy(this._strategy);

    if(validated.invalid) {
      throw validated.reasons;
    }

    /** @private {BaseTechnique} technique to measure viewability with */
    this._technique = this._selectTechnique(this._strategy.techniques);
    
    if(this._technique) {
      this._addSubscriptions(this._technique);
    }   

    if(this.unmeasureable) {
      // fire unmeasureable after current JS loop completes 
      // so opportunity is given for consumers to provide unmeasureable callback
      setTimeout( () => this._publish(Events.UNMEASUREABLE, Environment.getDetails(this._element)), 0);
    }
    else if(this._strategy.autostart) {
      this._technique.start();
    }
  }

  /** 
   * starts viewability measurment using the selected technique
   * @public
   */
  start() {
    this._technique.start();
  }

  /**
   * dispose the measurment technique and any timers
   * @public
   */
  dispose() {
    if(this._technique) {
      this._technique.dispose();
    }
    if(this.timer) {
      this.timer.dispose();
    }
  }

  /**
   * Handle viewability tracking start
   * @public
   * @param  {viewableCallback} callback - is called when viewability starts tracking
   * @return {MeasurmentExecutor} returns instance of MeasurementExecutor associated with this callback
   */
  onViewableStart(callback) {
    return this._addCallback(callback, Events.START);
  }

  /**
   * Handle viewability tracking stop.
   * @public
   * @param {viewableCallback} callback - is called when viewability has previously started, but element is now out of view
   * @return {MeasurementExecutor} returns instance of MeasurementExecutor associated with this callback
   */
  onViewableStop(callback) {
    return this._addCallback(callback, Events.STOP);
  }

  /**
   * Handle viewability change.
   * @public
   * @param  {viewableCallback} callback - called when the viewable percentage of the element has changed
   * @return {MeasurementExecutor} returns instance of MeasurementExecutor associated with this callback
   */
  onViewableChange(callback) {
    return this._addCallback(callback, Events.CHANGE);
  }

  /**
   * Handle viewability complete.
   * @public
   * @param  {viewableCallback} callback - called when element has been in view for the duration specified in the measurement strategy config
   * @return {MeasurementExecutor} returns instance of MeasurementExecutor associated with this callback
   */
  onViewableComplete(callback) {
    this._addCallback(callback, Events.COMPLETE);
    // if viewablity criteria already met, fire callback immediately
    if(this.criteriaMet) {
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
  onUnmeasureable(callback) {
    this._addCallback(callback, Events.UNMEASUREABLE);
    // if executor is already unmeasureable, fire callback immediately
    if(this.unmeasureable) {
      this._techniqueChange(Events.UNMEASUREABLE)
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
  get unmeasureable() {
    return !this._technique || this._technique.unmeasureable;
  }

  /**
   * Instantiates and filters list of available measurement technqiues to the first unmeasureable technique
   * @private
   * @param  {Array} - list of techniques available to measure viewability with
   * @return {BaseTechnique} selected technique
   */
  _selectTechnique(techniques) {
    return techniques
            .filter(validTechnique)
            .map(this._instantiateTechnique.bind(this))
            .find(technique => !technique.unmeasureable);
  }

  /**
   * creates instance of technique
   * @private
   * @param  {Function} - technique constructor
   * @return {BaseTechnique} instance of technique provided
   */
  _instantiateTechnique(technique) {
    return new technique(element, this._strategy.criteria);
  }

  /**
   * adds event listeners to technique 
   * @private
   * @param {BaseTechnique} - technique to add event listeners to
   */
  _addSubscriptions(technique) {
    if(technique) {
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
  _techniqueChange(change, technique = {}) {
    let eventName;
    const details = this._appendEnvironment(technique);

    switch(change) {
      case Events.INVIEW:
        if(!this._criteriaMet){
          this.timer = new InViewTimer(this._strategy.criteria.timeInView);
          this.timer.elapsed(this._timerElapsed.bind(this, technique));
          this.timer.start();
          eventName = Events.START;
        }
        
        break;

      case Events.CHANGE:
        eventName = change;
        break;

      case Events.COMPLETE:
        if(!this._criteriaMet) {
          this._criteriaMet = true;
          eventName = change;
        }
        
        break;

      case Events.OUTVIEW:
        if(!this._criteriaMet) {
          if(this.timer) {
            this.timer.stop();
            delete this.timer;
          }
          eventName = Events.STOP;
        }
        
        break;

      case Events.UNMEASUREABLE: 
        eventName = Events.UNMEASUREABLE;
    }

    if(eventName) {
      this._publish(eventName, details);
    }
  }

  /**
   * publishes events to available listeners
   * @private
   * @param  {String} - event name
   * @param  {} - value to call callback with
   */
  _publish(event, value) {
    if(Array.isArray(this._listeners[event])) {
      this._listeners[event].forEach( l => l(value) );
    }
  }

  /**
   * callback for timer elapsed 
   * @private
   * @param  {BaseTechnique} - technique used to perform measurement
   */
  _timerElapsed(technique) {
    this._techniqueChange(Events.COMPLETE, technique);
  }

  /**
   * Associates callback function with event 
   * @private
   * @param {Function} - callback function to associate with event
   * @param {String} event - event to associate callback function with
   * @return {MeasurementExecutor} returns instance of MeasurementExecutor associated with this callback
   */
  _addCallback(callback, event) {
    if(this._listeners[event] && typeof callback === 'function') {
      this._listeners[event].push(callback);
    }
    else if(typeof callback !== 'function') {
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
  _appendEnvironment(technique) {
    return Object.assign(
      {}, 
      { 
        percentViewable: typeof technique.percentViewable === 'undefined' ? -1 : technique.percentViewable, 
        technique: technique.techniqueName || -1, 
        viewable: typeof technique.viewable === 'undefined' ? -1 : technique.viewable 
      }, 
      Environment.getDetails(this._element) 
    );
  }
}