import BaseTechnique from './BaseTechnique';
import { validElement } from '../../Helpers/Validators';
import { DEFAULT_STRATEGY } from '../Strategies/';

/**
 * Represents a measurement technique that uses native IntersectionObserver API
 * @extends {BaseTechnique}
 */
export default class IntersectionObserver extends BaseTechnique {
  /**
   * Creates instance of IntersectionObserver measurement technique
   * @constructor
   * @param  {HTMLElement} element - element to perform viewability measurement on
   * @param  {Object} criteria - measurement criteria object. See Options/ViewabilityCriteria for more details
   * @return {IntersectionObserver} instance of IntersectionObserver measurement technique
   */
  constructor(element, criteria = DEFAULT_STRATEGY.criteria) {
    super(element, criteria);
    if(criteria !== undefined && element) {
      this.element = element;
      this.criteria = criteria;
      this.inView = false;
      this.started = false;
      this.notificationLevels = [0,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1];
      if(this.notificationLevels.indexOf(this.criteria.inViewThreshold) === -1) {
        this.notificationLevels.push(this.criteria.inViewThreshold);
      }
    }
    else if(!element) {
      throw 'element not provided';
    } 
  }

  /**
   * starts measuring the specified element for viewability
   * @override
   */
  start() {
    this.observer = new window.IntersectionObserver(this.viewableChange.bind(this),{ threshold: this.notificationLevels });
    this.observer.observe(this.element);
  }

  /**
   * stops measuring the specified element for viewability
   * @override
   */
  dispose() {
    if(this.observer) {
      this.observer.unobserve(element);
      this.observer.disconnect(element);
    }
  }

  /**
   * @override
   * @return {Boolean} determines if the technique is capable of measuring in the current environment
   */
  get unmeasureable() {
    return (!window.IntersectionObserver || this.usesPolyfill ) || !validElement(this.element);
  }

  /**
   * @override
   * @return {Boolean} reports whether the element is in view according to the IntersectionObserver measurement technique
   */
  get viewable() {
    return this.inView;
  }

  /**
   * @override
   * @return {String} reports measurement technique name
   */
  get techniqueName() {
    return 'IntersectionObserver';
  }

  /**
   * @return {Boolean} - reports whether measurement technique is using the native IntersectionObserver API or the polyfill bundled with the library.
   * Polyfill usage is infered by checking if the IntersectionObserver API has a THROTTLE_TIMEOUT memmber
   * Only the polyfill should have that member in it's API
   */
  get usesPolyfill() {
    return typeof window.IntersectionObserver.prototype.THROTTLE_TIMEOUT === 'number';
  }

  /**
   * callback function for IntersectionObserver change events
   * @param  {Array} entries - change entries
   */
  viewableChange(entries) {
    if(entries && entries.length && entries[0].intersectionRatio !== undefined) {
      this.percentViewable = entries[0].intersectionRatio;
      
      if(entries[0].intersectionRatio < this.criteria.inViewThreshold && this.started) {
        this.inView = false;
        this.listeners.outView.forEach( l => l() );
      }
      if(entries[0].intersectionRatio >= this.criteria.inViewThreshold) {
        this.started = true;
        this.inView = true;
        this.listeners.inView.forEach( l => l() );
      }

      this.listeners.changeView.forEach( l => l() );
    }
  }

}