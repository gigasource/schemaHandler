const EE = require('events');
const _ = require('lodash');
let AwaitLock;

class Hooks extends EE {
  getPreHandler(event) {
    this._preEe = this._preEe || new EE();
    return _.get(this._preEe._events, event);
  }

  get preEe() {
    this._preEe = this._preEe || new EE();
    return this._preEe;
  }

  pre(event, listener) {
    if (isArrowFn(listener)) throw new Error(`don't use arrow function here because of scope`);
    this.preEe.on(...arguments);
  }

  onDefault() {
    this._defaultEe = this._defaultEe || new EE();
    this._defaultEe.on(...arguments);
  }

  once(event, listener) {
    const _this = this;

    function _listener() {
      _this.removeListener(event, _listener);
      return listener.bind(this)(...arguments);
    }

    return this.on(event, _listener);
  }

  locks = {}

  getLock(channel) {
    if (this.locks) {
      return this.locks[channel];
    }
  }

  onQueue(event, channel, listener) {
    if (!AwaitLock) AwaitLock = require('await-lock').default; //lazy

    [channel, listener] = !listener ? [event, channel] : [channel, listener];
    const lock = this.locks[channel] = this.locks[channel] || new AwaitLock();
    const _listener = async function () {
      event;
      await lock.acquireAsync();
      const result = await listener.bind(this)(...arguments);
      lock.release()
      return result;
    }
    return this.on(event, _listener);
  }

  onQueueCount(event, channel, listener) {
    if (!AwaitLock) AwaitLock = require('await-lock').default; //lazy

    [channel, listener] = !listener ? [event, channel] : [channel, listener];
    const lock = this.locks[channel] = this.locks[channel] || new AwaitLock();
    let called = 0;
    const _listener = async function () {
      await lock.acquireAsync();
      called++;
      this.keepLock = function () {
        this._keepLock = true;
      }
      const result = await listener.bind(this)(called, ...arguments);
      if (!this._keepLock) {
        lock.release()
      }
      return result;
    }
    return this.on(event, _listener);
  }

  layers = {}

  sortLayer(event) {
    const map = this.layers[event] = this.layers[event] || new Map();
    let events = _.get(this._events, event);
    if (Array.isArray(events)) {
      events = _.sortBy(events, [e => map.get(e) || 0]);
      _.set(this._events, event, events);
    }
  }

  onCount(event, layer, listener) {
    if (arguments.length === 2) [layer, listener] = [0, layer];
    let called = 0;
    const _listener = async function () {
      called++;
      const result = await listener.bind(this)(called, ...arguments)
      return result;
    }
    return this.on(event, layer, _listener)
  }

  on(event, layer, listener) {
    if (arguments.length === 2) [layer, listener] = [0, layer];
    const map = this.layers[event] = this.layers[event] || new Map();
    map.set(listener, layer);
    if (isArrowFn(listener)) throw new Error(`don't use arrow function here because of scope`);
    super.on(event, listener);
    this.sortLayer(event);
    return {
      off: () => {
        this.off(event, listener);
      },
      emit: (...args) => {
        this.emit(...args);
      }
    }
  }

  off(event) {
    if (arguments.length === 1) {
      this.removeAllListeners(event);
    } else {
      this.removeListener(...arguments);
    }
  }

  removeListener(event, listener) {
    const map = this.layers[event] = this.layers[event] || new Map();
    map.delete(listener);
    super.removeListener(...arguments);
  }

  emitPrepare(channel, event, ...args) {
    let handler;
    if (channel !== 'default') {
      handler = _.get(this._events, event);
    }

    if (_.isEmpty(handler) && !_.isFunction(handler) && this._defaultEe && _.get(this._defaultEe._events, event)) {
      if (!handler) handler = [];
      if (!Array.isArray(handler)) {
        handler = [handler]
      }
      const defaultHandler = _.get(this._defaultEe._events, event);
      if (Array.isArray(defaultHandler)) {
        handler.unshift(...defaultHandler);
      } else {
        handler.unshift(defaultHandler);
      }
    }

    if (channel !== 'default') {
      //pre
      if (this._preEe && _.get(this._preEe._events, event)) {
        if (!handler) handler = [];
        if (!Array.isArray(handler)) {
          handler = [handler]
        }
        const preHandler = this.getPreHandler(event);
        if (Array.isArray(preHandler)) {
          handler.unshift(...preHandler);
        } else {
          handler.unshift(preHandler);
        }
      }
    }

    return handler;
  }

  emitDefault(event, ...args) {
    return this.__emit('default', event, ...args);
  }

  emit(event, ...args) {
    return this.__emit('all', event, ...args);
  }

  __emit(channel = 'all', event, ...args) {
    const handler = this.emitPrepare(...arguments);

    if (_.isEmpty(handler) && !_.isFunction(handler)) {
      return false;
    }

    const _this = {
      setValue(val) {
        this._value = val;
      },
      stop() {
        this._stop = true;
      }
    }

    if (typeof _.last(args) === 'function' && _.last(args).toString().includes('eval')) {
      const _eval = _.last(args);
      _this.update = function (_var, value) {
        const _value = JSON.stringify([value]);
        _eval(`${_var} = ${_value}[0];`)
      }
    }

    const promises = []
    if (typeof handler === 'function') {
      const p = Reflect.apply(handler, _this, args);
      if (p instanceof Promise) promises.push(p);
    } else {
      let _handler = [...handler];
      for (let i = 0; i < _handler.length; i += 1) {
        const p = Reflect.apply(_handler[i], _this, args);
        if (_this._stop) break;
        if (p instanceof Promise) promises.push(p);
      }
    }

    if (promises.length > 0) {
      return new Promise(async (resolve, reject) => {
        for (const promise of promises) {
          await promise;
        }
        resolve(_this.hasOwnProperty('_value') ? _this._value : _this)
      });
    }

    return _this.hasOwnProperty('_value') ? _this._value : _this;
  }
}

const isArrowFn = (fn) => {
  if (fn.toString().includes('this.')) {
    return (typeof fn === 'function') && /^[^{]+?=>/.test(fn.toString());
  }
};

['getPreHandler', 'preEe', 'on', 'pre', 'onDefault', 'emit', 'emitPrepare', 'emitDefault'].forEach(
  p => Object.defineProperty(Hooks.prototype, p, {enumerable: true})
)


module.exports = Hooks;
