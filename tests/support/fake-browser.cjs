'use strict';

const realThree = require('three');

function seededRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    for (const name of names) this.values.add(name);
  }

  remove(...names) {
    for (const name of names) this.values.delete(name);
  }

  contains(name) {
    return this.values.has(name);
  }

  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : !!force;
    if (enabled) this.values.add(name);
    else this.values.delete(name);
    return enabled;
  }
}

class FakeElement {
  constructor(id, ownerDocument) {
    this.id = id || '';
    this.ownerDocument = ownerDocument;
    this.style = Object.create(null);
    this.classList = new FakeClassList();
    this.children = [];
    this.listeners = new Map();
    this.textContent = '';
    this.width = 0;
    this.height = 0;
    this.visible = true;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  addEventListener(type, listener) {
    let listeners = this.listeners.get(type);
    if (!listeners) {
      listeners = [];
      this.listeners.set(type, listeners);
    }
    listeners.push(listener);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type);
    if (!listeners) return;
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners.splice(index, 1);
  }

  dispatchEvent(event) {
    event.target = this;
    for (const listener of this.listeners.get(event.type) || []) listener(event);
    return !event.defaultPrevented;
  }

  requestPointerLock() {
    this.ownerDocument.pointerLockElement = this;
    return Promise.resolve();
  }
}

function createFakeBrowser(options = {}) {
  const random = seededRandom(options.seed === undefined ? 0x51f15e : options.seed);
  const errors = [];
  const logs = [];
  const elements = new Map();
  const windowListeners = new Map();
  const clock = {
    nowMs: options.startTimeMs || 0,
    now() {
      return this.nowMs;
    },
    advance(milliseconds) {
      this.nowMs += milliseconds;
      return this.nowMs;
    }
  };

  const document = {
    pointerLockElement: null,
    body: null,
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new FakeElement(id, document));
      return elements.get(id);
    },
    createElement(tagName) {
      return new FakeElement(String(tagName).toLowerCase(), document);
    },
    addEventListener(type, listener) {
      let listeners = windowListeners.get(`document:${type}`);
      if (!listeners) {
        listeners = [];
        windowListeners.set(`document:${type}`, listeners);
      }
      listeners.push(listener);
    },
    removeEventListener() {}
  };
  document.body = new FakeElement('body', document);

  class FakeWebGLRenderer {
    constructor() {
      this.domElement = new FakeElement('canvas', document);
      this.shadowMap = {enabled: false, type: null};
      this.info = {render: {frame: 0}};
      this.renderCount = 0;
    }

    setSize(width, height) {
      this.domElement.width = width;
      this.domElement.height = height;
    }

    setPixelRatio() {}

    render() {
      this.renderCount++;
      this.info.render.frame++;
    }

    dispose() {}
  }

  const math = Object.create(Math);
  Object.defineProperty(math, 'random', {value: random, configurable: false});
  const THREE = Object.assign({}, realThree, {WebGLRenderer: FakeWebGLRenderer});
  const quietConsole = {
    log(...args) {
      logs.push(args.join(' '));
    },
    info(...args) {
      logs.push(args.join(' '));
    },
    warn(...args) {
      logs.push(args.join(' '));
    },
    error(...args) {
      errors.push(args.join(' '));
    }
  };

  let nextTimerId = 1;
  const sandbox = {
    THREE,
    document,
    console: options.console || quietConsole,
    Math: math,
    performance: {now: () => clock.now()},
    location: {search: ''},
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    structuredClone,
    Promise,
    setTimeout() {
      return nextTimerId++;
    },
    clearTimeout() {},
    setInterval() {
      return nextTimerId++;
    },
    clearInterval() {},
    requestAnimationFrame() {
      return 0;
    },
    cancelAnimationFrame() {},
    addEventListener(type, listener) {
      let listeners = windowListeners.get(type);
      if (!listeners) {
        listeners = [];
        windowListeners.set(type, listeners);
      }
      listeners.push(listener);
    },
    removeEventListener() {},
    dispatchEvent(event) {
      for (const listener of windowListeners.get(event.type) || []) listener(event);
    },
    __testClock: clock
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;

  return {sandbox, clock, errors, logs, elements, THREE};
}

module.exports = {createFakeBrowser, seededRandom};
