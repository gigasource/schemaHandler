const EventEmitter = require('events');
const NodeCache = require('node-cache');
const Kareem = require('kareem');
const _ = require('lodash');
const cache = new NodeCache({useClones: false/*, checkperiod: 2*/});

const hooks = {}
_.extend(hooks, new Kareem());
hooks.execPostAsync = async function (name, context, args) {
  const posts = this._posts.get(name) || [];
  const numPosts = posts.length;
  for (let i = 0; i < numPosts; ++i) {
    await posts[i].fn.bind(context)(...(args || []));
  }
};
_.extend(hooks, new EventEmitter());

function builder(resolver) {
  return new Proxy({}, {
    get(target, key) {
      const construct = function (obj) {
        this.scope = {}
      }
      construct.modelName = key;
      construct.modules = {};
      const proxy = new Proxy(construct, {
        apply: function (target, thisArg, argumentsList) {
          target.scope = argumentsList[0] || {};
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
    const query = {name: _this.modelName, chain: _this.chain, scope: (_this.scope || {})};
    //console.log(JSON.stringify(query.chain));

    //pre-process
    await hooks.execPostAsync(`chain-preprocess`, null, [query]);
    await execChain(query);

    resolve(flow(query.scope));
  };
});

async function execChain(query) {
  for (let i = 0; i < query.chain.length; i++) {
    const {fn, args} = query.chain[i];
    if (query.module && fn !== 'end') {
      if (!query.moduleCursor) query.moduleCursor = query.module;
      const _args = [...args];
      let firstArg = args[0];
      if (typeof firstArg === 'string') {
        firstArg = firstArg.replace('@scope', '@');
        if (firstArg === '@') {
          _args.splice(0, 1, query.scope);
        } else if (_.first(firstArg) === '@') {
          const _first = _.get(query.scope, firstArg.replace('@.', ''));
          _args.splice(0, 1, _first);
        }
      }
      query.moduleCursor = query.moduleCursor[fn](..._args);
    }
    let returnResult = {ok: false, break: false, value: null}
    await hooks.execPostAsync(`:${fn}`, null, [_.assign({fn, args, index: i, query}, query), returnResult]);
    if (returnResult.break) break;
  }
}

const flow = models['flow'];

//flow();

hooks.post('chain-preprocess', null, function (query) {
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
})

hooks.post(':test', async function ({fn, args, index, chain, scope, query}, returnResult) {
  console.log({fn, args});
})

hooks.post(':scope', async function ({fn, args, index, chain, scope, query}, returnResult) {
  query.scope = args[0];
})

hooks.post(':emit', async function ({fn, args, index, chain, scope, query}, returnResult) {
  const event = args.shift();
  await hooks.execPostAsync(`${event}`, null, [{args, scope}]);
  console.log({fn, args});
})

hooks.post(':on', async function ({fn, args, index, chain, scope, query}, returnResult) {
  const event = args.shift();
  const __chain = args.pop();
  hooks.post(`${event}`, async function ({args, scope: _scope}) {
    const _query = {chain: __chain, scope: _scope};
    await execChain(_query);
  });
})

hooks.post(':send', async function ({fn, args, index, chain, scope, query}, returnResult) {
})

function getRestChain(chain, index) {
  const _chain = [...chain];
  _chain.splice(0, parseInt(index) + 1);
  return _chain;
}

hooks.post(':toBE', async function ({fn, args, index, chain, scope, query}, returnResult) {
  const _chain = getRestChain(chain, index);
  const _query = {chain: _chain, scope};
  await hooks.execPostAsync('emitBE', null, [_query]);
  returnResult.break = true;
})

hooks.post('emitBE', async function (query) {
  console.log('backend env');
  await execChain(query);
})

hooks.post(':toFE', async function ({fn, args, index, chain, scope, query}, returnResult) {
  const _chain = getRestChain(chain, index);
  const _query = {chain: _chain, scope};
  await hooks.execPostAsync('emitFE', null, [_query]);
  returnResult.break = true;
})

hooks.post('emitFE', async function (query) {
  console.log('frontend env');
  await execChain(query);
})

hooks.post(':require', async function ({fn, args: [_module, {name, wrapping}], index, chain, scope, query}, returnResult) {
  const modules = flow.modules;
  if (!wrapping) wrapping = typeof _module === 'function' ? _module : () => _module;
  modules[name] = wrapping;
  hooks.post(`:${name}`, async function ({fn, args, index, chain, scope, query}, returnResult) {
    query.module = wrapping(...args);
    query.moduleScope = {};
  });
})

hooks.post(`:end`, async function ({fn, args, index, chain, scope, query}, returnResult) {
  query.scope = await query.moduleCursor;
  delete query.module;
  delete query.moduleScope;
});

async function run() {
  await flow.on('event').send('_default.table');
  await flow({table: 10}).test('abc').emit('event', {a: 1});

  //get scope before toBE and the rest
  //await flow({table: 10}).order({payment: 'cash'}).test('123').toBE().test('456').toFE().test('789');
  //await flow.on(':pay').signTse();
}

//run();

module.exports = {
  hooks, flow, Flow: flow
}
