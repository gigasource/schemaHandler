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

  async emit(event, ...args) {
    let handler = _.get(this._events, event);
    if (_.isEmpty(handler) && !_.isFunction(handler)) {
      return false;
    }
    //pre
    if (this._preEe) {
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

    const _this = {}
    if (typeof handler === 'function') {
      await Reflect.apply(handler, _this, args);
    } else {
      for (let i = 0; i < handler.length; i += 1) {
        await Reflect.apply(handler[i], _this, args);
      }
    }

    return _this;
  }
}

const hooks = new Hooks();

hooks.pre('test', async function () {
  console.log('pre')
})

hooks.on('test', async function ({arg}, e) {
  this.value = '11';
  console.log('haz')
  e(`_return = true`)
  e(`arg = 11`);
})

/*hooks.on('test', async (arg) => {
  await new Promise(resolve => {
    setTimeout(() => {
      console.log('test : ', arg);
      resolve();
    },1000)
  })
})*/

async function run() {
  let arg, _return;
  const a = await hooks.emit('test', {arg}, e => eval(e));
  if (a.ok) return;
  console.log(a);
}

run();

module.exports = Hooks;
