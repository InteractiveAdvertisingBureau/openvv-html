import IntersectionObserver from './IntersectionObserver';
import Polyfill from 'intersection-observer';
import * as Environment from '../../Environment/Environment';

/**
 * Represents a measurement technique that uses the IntersectionObserver API polyfill
 * @extends {IntersectionObserver}
 */
export default class IntersectionObserverPolyfill extends IntersectionObserver {
  /**
   * determines whether the measurement technique is capable of measuring given the current environment
   * @override
   * @return {Boolean}
   */
  get unmeasureable() {
    return Environment.iFrameContext() === Environment.iFrameServingScenarios.CROSS_DOMAIN_IFRAME;
  }

  /**
   * @return {String} name of measurement technique
   */
  get techniqueName() {
    return 'IntersectionObserverPolyFill';
  }
}