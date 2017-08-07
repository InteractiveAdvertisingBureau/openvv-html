var app = new Vue({
  el: '#statusContainer',
  data: {
    threshold: 0.0,
    viewable: false,
    percentViewable: 0.0,
    focus: true,
    elementWidth: 0,
    elementHeight: 0,
    viewportWidth: 0,
    viewportHeight: 0,
    iframeContext: 'unknown',
    technique: 'unknown',
    criteriaMet: false,
    unmeasureable: false
  }
});

var openvv = new OpenVV(), element = document.getElementById('elementToMeasure');

var executor = openvv
  .measureElement(element)
  .onViewableStart(function(args) {
    console.log('Viewable Start', new Date().toString(), args);
  })
  .onViewableStop(function(args) {
    console.log('Viewable Stop', new Date().toString(), args);
  })
  .onViewableChange(function(args){
    update(args);
    app.threshold = executor._strategy.criteria.inViewThreshold;
    console.log('Viewable Change', new Date().toString(), args);
  })
  .onViewableComplete(function(args) {
    app.criteriaMet = true;
    console.log('Viewable Complete', new Date().toString(), args);
  })
  .onUnmeasureable(function() {
    app.unmeasureable = true;
    console.log('Unmeasureable');
  });

function update(details) {
  Object.keys(details).forEach(function(key) { app[key] = details[key]; });
}