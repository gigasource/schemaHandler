const EE = require('events');
const _ = require('lodash');

class Hooks extends EE {
  getPreHandler(event) {
    this._preEe = this._preEe || new EE();
    return _.get(this._preEe._events, event);
  }

  get preEe() {
    this._preEe = this._preEe || new EE();
    return this._preEe;
  }

  pre() {
    this.preEe.on(...arguments);
  }

  default() {
    this._defaultEe = this._defaultEe || new EE();
    this._defaultEe.on(...arguments);
  }

  emitPrepare(event, ...args) {
    let handler = _.get(this._events, event);
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
    return handler;
  }

  emitSync(event, ...args) {
    const handler = this.emitPrepare(...arguments);

    if (_.isEmpty(handler) && !_.isFunction(handler)) {
      return false;
    }

    const _this = {}
    if (typeof handler === 'function') {
      Reflect.apply(handler, _this, args);
    } else {
      for (let i = 0; i < handler.length; i += 1) {
        Reflect.apply(handler[i], _this, args);
      }
    }

    return _this;
  }

  emit(event, ...args) {
    const handler = this.emitPrepare(...arguments);

    if (_.isEmpty(handler) && !_.isFunction(handler)) {
      return false;
    }

    const _this = {}
    const promises = []
    if (typeof handler === 'function') {
      if (isArrowFn(handler)) console.warn(`don't use arrow function here because of scope`);
      const p = Reflect.apply(handler, _this, args);
      if (p instanceof Promise) promises.push(p);
    } else {
      for (let i = 0; i < handler.length; i += 1) {
        if (isArrowFn(handler[i])) console.warn(`don't use array fn here`);
        const p = Reflect.apply(handler[i], _this, args);
        if (p instanceof Promise) promises.push(p);
      }
    }

    if (promises.length > 0) {
      return new Promise(async (resolve, reject) => {
        for (const promise of promises) {
          await promise;
        }
        resolve(_this);
      });
    }

    return _this;
  }
}

const isArrowFn = (fn) => (typeof fn === 'function') && /^[^{]+?=>/.test(fn.toString());

['getPreHandler', 'preEe', 'pre', 'default', 'emit', 'emitSync', 'emitPrepare'].forEach(
  p => Object.defineProperty(Hooks.prototype, p, {enumerable: true})
)


module.exports = Hooks;
