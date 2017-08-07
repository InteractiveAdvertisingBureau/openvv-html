# OpenVV-HTML

A library to provide viewablity measurement in Javascript. The library uses [IntersectionObserver](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API) by default but other measurement techniques can be configured.

## Usage

The library implements Universal Module Defintions, meaning it can be used as a global (`OpenVV`), or imported using CommonJS or AMD import patterns.

### Global Namespace
Include openvv.js or openvv.min.js as a script tag on your page or concatenate it with your application source.

### Module Loaders
`require('OpenVV')` or `import OpenVV from 'OpenVV'` if using ES6 modules.

### Basic Usage
```javascript
// Create new instance of OpenVV and store element to measure
var openvv = new OpenVV(), element = document.getElementById('elementToMeasure');

openvv
  .measureElement(element)
  .onViewableStart(function(args) {
    // element has started being viewable according to the default threshold of 50% in view
    console.log('Viewable Start', new Date().toString(), args);
  })
  .onViewableStop(function(args) {
    // element has stopped being viewable as it has dropped below the default 50% in view threshold
    console.log('Viewable Stop', new Date().toString(), args);
  })
  .onViewableChange(function(args){
    // element's in view percentage has changed. Will be called whenever element's in view percentage changes
    console.log('Viewable Change', new Date().toString(), args);
  })
  .onViewableComplete(function(args) {
    // element has been in view above the viewable threshold for atleast 2 continuous seconds
    console.log('Viewable Complete', new Date().toString(), args);
  })
  .onUnmeasureable(function() {
    // no measurement techniques were found that are capable of measuring in the current enviroment (browser + iframe context)
    console.log('Unmeasureable');
  });
```
By default, the library just requires an element to measure. Internally, it's using the default measurement strategy if no strategy is provided:

```javascript
export const DEFAULT_STRATEGY = {
  autostart: true,
  techniques: [MeasurementTechniques.IntersectionObserver, MeasurementTechniques.IntersectionObserverPolyfill],
  criteria: ViewabilityCriteria.MRC_VIDEO
};
```

This strategy can be overridden by providing a strategy object as the second parameter to the `measureElement` call:

```
var openvv = new OpenVV(),
  autostart = false, 
  techniques = [OpenVV.MeasurementTechniques.IntersectionObserver], 
    criteria = { inViewThreshold: 1.0, timeInView: 5000 };
    
var strategy = OpenVV.Strategies.StrategyFactory(autostart, techniques, criteria);
openvv
  .measureElement(someElement, strategy)
    .onViewableComplete(function(args) { console.log('Element is viewable'); })
    .start();
```

### Custom Techniques
Custom measurement techniques can be used. They should inherit from `OpenVV.MeasurementTechniques.BaseTechnique` and override the any methods that require custom logic. See `OpenVV.MeasurementTechniques.IntersectionObserver` for examples of how to create a technique based on `BaseTechnique`. To use the custom technique, include the function in the list of techniques in the measurement strategy provided to `OpenVV.prototype.measureElement`. 


## Development
The library is written in [ES6](https://babeljs.io/learn-es2015/) and is compiled using [Grunt](https://gruntjs.com/) and [Babel](https://babeljs.io/).

### To build
```bash
npm install
grunt
```

Test pages are included in the `demo` directory. 

### Contributing

Issues, questions, or contributions can be submitted through Github issues for the repo.