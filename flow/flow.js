const EventEmitter = require('../hooks/hooks');
const NodeCache = require('node-cache');
const Kareem = require('kareem');
const _ = require('lodash');
const uuid = require('uuid');
const util = require('util');
const inspect = (obj) => util.inspect(obj, {depth: 1});
const cache = new NodeCache({useClones: false/*, checkperiod: 2*/});

const hooks = {}
_.extend(hooks, new EventEmitter());

function builder(resolver) {
  return new Proxy({}, {
    get(target, key) {
      const construct = function (obj, query) {
        this.scope = {}
        this.scopes = {}
      }
      construct.modelName = key;
      construct.modules = {};
      const proxy = new Proxy(construct, {
        apply: function (target, thisArg, argumentsList) {
          target.scope = argumentsList[0] || {};
          if (argumentsList[1]) _.assign(target, _.pick(argumentsList[1], ['scope, scopes']))
          return proxy;
        },
        get(targetLayer1, key) {
          if (['modelName', 'modules'].includes(key)) {
            return targetLayer1[key];
          }
          if (key === 'hooks') {
            return hooks;
          }
          if (key === 'then') {
            return undefined;
          }

          return function () {
            return new Proxy({
              modelName: construct.modelName,
              scope: construct.scope,
              scopes: construct.scopes,
              chain: [{fn: key, args: [...arguments]}]
            }, {
              get(targetLayer2, key, queryProxy) {
                if (['chain', 'modelName'].includes(key)) {
                  return targetLayer2[key];
                }
                if (key === 'then') {
                  /*if (target.options && target.options.preventThen) {
                    return undefined;
                  }*/
                  const promise = new Promise(resolver(targetLayer2));
                  return promise.then.bind(promise);
                }
                return function () {
                  targetLayer2.chain = targetLayer2.chain || [];
                  targetLayer2.chain.push({fn: key, args: [...arguments]});
                  return queryProxy;
                };
              }
            });
          };
        }
      });
      return proxy;
    }
  });
}

let models = builder(function (_this) {
  return async function (resolve, reject) {
    const query = {
      name: _this.modelName, chain: _this.chain, scope: (_this.scope || {}),
      scopes: (_this.scopes || {}), cursors: [], cursor: {}
    };
    //console.log(JSON.stringify(query.chain));

    //pre-process
    await hooks.emit(`chain-preprocess`, query);
    await execChain(query);

    if (_.last(query.chain).fn === 'v') {
      return resolve(query.scope);
    }
    resolve(flow(null, query));
  };
});

hooks.on(':return', async function ({fn, args, index, chain, scope, query}) {
  //const _query = query.stashes.pop();
  query.cursors = query.cursors || [];
  query.cursors.push(query.cursor);
  query.cursor = {}

  this.break = true;
})

async function execChain(query) {
  for (let i = 0; i < query.chain.length; i++) {
    const {fn, args} = query.chain[i];
    const cursor = query.cursor;

    const _args = [...args];
    //todo: callback layer
    let callback, _uuid;
    let nextFn;
    for (let arg of _args) {
      if (arg === '@callback') {
        _uuid = uuid.v1();
        callback = function (arg1, arg2) {
          hooks.emit(_uuid, arg1);
        }
        _args.splice(_args.indexOf(arg), 1, callback);
        //handle return;
        //if (!query.stashes) query.stashes = [];
        let _chain = getRestChain(query.chain, i);
        let returned = false, stash = 0;
        _chain = _chain.reduce((l, item) => {
          if (item.args.includes('@callback')) {
            stash++;
          }
          if (returned) l.push(item);
          if (item.fn === 'return') {
            if (stash > 0) {
              stash--;
            } else {
              l.push({fn: 'end', args : []});
              returned = true;
            }
          }
          return l;
        }, [])
        const _query = _.assign({}, query, {chain: _chain, cursor: {}});
        //exec new query here
        //query.stashes.unshift(_query);
        execChain(_query).then();
      } else if (_.startsWith(arg, '@last')) {
        let index = /\[(.*)\]/g.exec(arg);
        index = parseInt(index ? index[1] : 0);
        index = query.cursors.length - 1 - index;
        let last = query.cursors[index];
        if (last) {
          _args.splice(_args.indexOf(arg), 1, last.scope);
        } else {
          console.warn(new Error('No last scope exists'));
        }
      } else if (arg === '@next') {
        nextFn = {};

        async function endHanler() {
          const last = _.last(query.cursors);
          if (last === cursor) {
            let _args = [...nextFn.args];
            _args = _args.map((item) => item !== '@next' ? item : query.cursor._cursor);

            await hooks.emit(`pre//**`, _.assign({fn: nextFn.fn, args: _args, index: i, query}, query));
            cursor._cursor = cursor._cursor[nextFn.fn](..._args);
            hooks.removeListener(':end', endHanler);
          }
        }

        hooks.on(':end', endHanler);
      } else if (typeof arg === 'string') {
        arg = arg.replace('@scope', '@');
        if (arg === '@') {
          _args.splice(0, 1, query.scope);
        } else if (_.first(arg) === '@') {
          const _first = _.get(query.scopes, arg.replace('@.', ''));
          _args.splice(0, 1, _first);
        }
      }
    }

    if (cursor && cursor.module && fn !== 'end' && fn !== 'return') {
      if (!cursor._cursor) cursor._cursor = cursor.module;
      if (callback && query.target) {
        if (!cursor._cursor) cursor._cursor = cursor.module;
        cursor._cursor[fn](..._args);
        console.log('Register callback on : ', inspect([cursor._cursor.constructor.name]), ' : ', inspect(_args));

        cursor._cursor = await new Promise((resolve, reject) => {
          hooks.once(_uuid, (arg1) => {
            console.log('Callback was called from : ', cursor._cursor.constructor.name);
            resolve(arg1);
          });
        })
      } else {
        if (nextFn) {
          _.assign(nextFn, {fn, args: _args});
        } else {
          try {
            cursor._cursor = cursor._cursor[fn](..._args);
          } catch (e) {
            console.log('cursor: ', inspect([cursor._cursor]), ' fn: ', fn);
            console.warn(e);
          }
        }
      }
    }
    await hooks.emit(`pre//**`, _.assign({fn, args: _args, index: i, query}, query));
    let returnResult = await hooks.emit(`:${fn}`, _.assign({fn, args: _args, index: i, query}, query));
    if (returnResult.break) break;
  }
}

hooks.on('pre//**', async function ({fn, args, index, chain, scope, query}) {
  console.log('pre : ', inspect({fn, args}));
})

const flow = models['flow'];

//flow();

/*hooks.on('chain-preprocess', function (query) {
  query.chain = query.chain.reduce((chainWrapper, {fn, args}) => {
    if (chainWrapper.arr) {
      chainWrapper.arr.push({fn, args})
    } else {
      chainWrapper.chain.push({fn, args});
    }
    if (fn === 'on') {
      const arr = [];
      args.push(arr)
      chainWrapper.arr = arr;
    }

    return chainWrapper;
  }, {chain: []}).chain;
})*/

hooks.on(':test', async function ({fn, args, index, chain, scope, query}) {
  console.log('test', {fn, args});
})

hooks.on(':scope', async function ({fn, args, index, chain, scope, query}) {
  query.scope = args[0];
})

hooks.on(':emit', async function ({fn, args, index, chain, scope, query}) {
  const event = args.shift();
  await hooks.emit(`${event}`, {args, scope});
  console.log({fn, args});
})

hooks.on(':on', async function ({fn, args, index, chain, scope, query}) {
  const event = args.shift();
  const __chain = args.pop();
  hooks.on(`${event}`, async function ({args, scope: _scope}) {
    const _query = {chain: __chain, scope: _scope};
    await execChain(_query);
  });
})

hooks.on(':send', async function ({fn, args, index, chain, scope, query}) {
})

function getRestChain(chain, index) {
  const _chain = [...chain];
  _chain.splice(0, parseInt(index) + 1);
  return _chain;
}

hooks.on(':toBE', async function ({fn, args, index, chain, scope, query}) {
  const _chain = getRestChain(chain, index);
  const _query = {chain: _chain, scope};
  await hooks.emit('emitBE', _query);
  this.break = true;
})

hooks.on('emitBE', async function (query) {
  console.log('backend env');
  await execChain(query);
})

hooks.on(':toFE', async function ({fn, args, index, chain, scope, query}) {
  const _chain = getRestChain(chain, index);
  const _query = {chain: _chain, scope};
  await hooks.emit('emitFE', _query);
  this.break = true;
})

hooks.on('emitFE', async function (query) {
  console.log('frontend env');
  await execChain(query);
})

hooks.on(':require', async function ({fn, args: [_module, {name, wrapping, chainable}], index, chain, scope, query}) {
  const modules = flow.modules;
  if (!wrapping) wrapping = typeof _module === 'function' ? _module : () => _module;
  modules[name] = {wrapping, chainable};
  hooks.on(`:${name}`, async function ({fn, args, index, chain, scope, query}) {
    query.cursor = {
      module: wrapping(...args),
      scope: {},
      chainable: chainable,
      _cursor: null
    }
  });
})

hooks.on(`:end`, async function ({fn, args, index, chain, scope, query}) {
  if (query.cursor && query.cursor.chainable) {
    query.cursor.scope = query.scope = await query.cursor._cursor;
  } else {
    query.cursor.scope = await query.cursor._cursor;
    //todo: get last scope
  }

  //need once:
  hooks.emit(':end');
  query.cursors = query.cursors || [];
  query.cursors.push(query.cursor);
  query.cursor = {}
});

hooks.on(':to', async function ({fn, args, index, chain, scope, query}) {
  const _chain = getRestChain(chain, index);
  const _query = {chain: _chain, scope};
  const [{clientId}] = args;
  let returnValue = {break: false}
  await hooks.emit('flow-interface', {query: _query, args});

  //await hooks.emit('emitBE', _query);
  this.break = true;
})

hooks.on(':use', async function ({fn, args, index, chain, scope, query}) {
  query.cursor = {
    module: args[0],
    scope: {},
    chainable: false,
    _cursor: null
  }
})

async function run() {
  await flow.on('event').send('_default.table');
  await flow({table: 10}).test('abc').emit('event', {a: 1});

  //get scope before toBE and the rest
  //await flow({table: 10}).order({payment: 'cash'}).test('123').toBE().test('456').toFE().test('789');
  //await flow.on(':pay').signTse();
}

//run();

module.exports = {
  hooks, flow, Flow: flow, getRestChain, execChain
}
