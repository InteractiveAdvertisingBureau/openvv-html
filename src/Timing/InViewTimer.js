/**
 * Represents a timer class to notify a listener when a specified duration has elapsed
 */
export default class InViewTimer {
  /**
   * Creates new instance of an InViewTimer
   * @constructor
   * @param  {Number} duration - when to fire elapsed callback
   * @return {InViewTimer} instance of InViewTimer
   */
  constructor(duration) {
    this.duration = duration;
    this.listeners = [];
    this.completed = false;
  }

  /**
   * notifies listeners that timer has elapsed for the specified duration
   */
  timerComplete() {
    this.completed = true;
    this.listeners.forEach( l => l() );
  }

  /**
   * accepts callback functions to call when the timer has elapsed
   * @param  {Function} cb - callback to call when timer has elapsed
   */
  elapsed(cb) {
    if(typeof cb === 'function') {
      this.listeners.push(cb);
    }
  }

  /**
   * start timer
   */
  start() {
    this.endTimer();
    this.timer = setTimeout(this.timerComplete.bind(this), this.duration);
  }

  /** stop timer */
  stop() {
    this.endTimer();
  }

  /** clears setTimeout associated with class */
  endTimer() {
    if(this.timer) {
      clearTimeout(this.timer);
      this.listeners.length = 0;
    }
  }

  /** destroys timer */
  dispose() {
    this.endTimer();
  }

}