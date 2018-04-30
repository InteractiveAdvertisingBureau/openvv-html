import { BaseOverlay } from 'vpaid-generic';
import OpenVV from '../../OpenVV.js';

export default class OpenVVOverlay extends BaseOverlay {
  constructor(element) {
    super();

    this.element = element;
    this.stateDisplayElement = this.createStateDisplay();
    this.element.appendChild(this.stateDisplayElement);
    this.openvv = new OpenVV();
    
    this
      .openvv
      .measureElement(element)
      .onViewableChange(this.updateStateDisplay.bind(this))
      .onViewableComplete(this.updateStateDisplay.bind(this))
      .start();
  }

  updateStateDisplay(value) {
    if(typeof value === 'object') {
      value = Object.keys(value).map( key => { 
        if(key === 'percentViewable') {
          value[key] = (value[key] * 100).toFixed(2) + '%';
        }
        return `${key}: ${value[key]}`;
      }).join('\n');
    }
    this.stateDisplayElement.innerHTML = `<pre>${value}</pre>`;
  }

  createStateDisplay() {
    const el = document.createElement('div');
    el.style.color = 'white';
    el.style.fontSize = '1.2em';
    el.style.padding   = '16px 24px';
    el.style.textShadow = '1px 1px 2px #00000078';
    return el;
  }
}