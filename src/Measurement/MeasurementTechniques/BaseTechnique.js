/**
 * Class representing basic functionality of a Measurement Technique
 * Some of it's members are intended to be overriden by inheritting class
 */
export default class BaseTechnique {
  /**
   * @constructor
   * @return {BaseTechnique} instance of BaseTechnique
   */
  constructor() {
    this.listeners = {
      inView:[],
      outView:[],
      changeView:[]
    };

    this.percentViewable = 0.0;
  }

  /**
   * Defines callback to call when technique determines element is in view
   * @param  {changeCallback} - callback to call when element is in view
   * @return {BaseTechnique} instance of BaseTechnique associated with callback. Can be used to chain callback definitions.
   */
  onInView(cb) {
    return this.addCallback(cb,'inView');
  }

  /**
   * Defines callback to call when technique determines element viewability has changed
   * @param  {changeCallback} - callback to call when element's viewability has changed
   * @return {BaseTechnique} instance of BaseTechnique associated with callback. Can be used to chain callback definitions.
   */
  onChangeView(cb) {
    return this.addCallback(cb,'changeView');
  }

  /**
   * Defines callback to call when technique determines element is no longer in view
   * @param  {changeCallback} - callback to call when element is no longer in view
   * @return {BaseTechnique} instance of BaseTechnique associated with callback. Can be used to chain callback definitions.
   */
  onOutView(cb) {
    return this.addCallback(cb,'outView');
  }

  /**
   * @callback changeCallback
   */

  /**
   * Associate callback with named event
   * @param {Function} callback - callback to call when event occurs
   * @param {String} event - name of event to associate with callback
   */
  addCallback(callback, event) {
    if(typeof callback === 'function' && this.listeners[event]) {
      this.listeners[event].push(callback);
    }
    else if(typeof callback !== 'function') {
      throw 'callback must be function';
    }

    return this;
  }

  /** 
   * empty start member. should be implemented by inheritting class
   */
  start() {}

  /**
   * empty dispose member. should be implemented by inheritting class
   */
  dispose() {}

  /**
   * @return {Boolean} defines whether the technique is capable of measuring in the current environment
   */
  get unmeasureable() {
    return false;
  }

  /**
   * @return {Boolean} defines whether the technique has determined that the measured element is in view
   */
  get viewable() {
    return false;
  }

  /**
   * @return {String} name of the measurement technique
   */
  get techniqueName() {
    return 'BaseTechnique';
  }
}