const {reactive, computed, watch, watchEffect, toRaw} = require('@vue/runtime-core');
const {hooks, flow} = require('./flow');
const _ = require('lodash');

isFrontend = false;

const orm = require("../orm");
orm.connect('mongodb://localhost:27017', 'myproject');
const stringify = JSON.stringify.bind(JSON);

async function run() {
  flow.hooks.post(':openTable', async function ({fn, args, index, chain, scope, query}, returnResult) {
    const order = reactive({table: args[0], items: []})
    query.scope = order;
    watchEffect( function () {
      order.vSum = _.sumBy(order.items, i => i.price * i.quantity);
    })

    watch(() => stringify(order.items), function () {
      console.log('trigger items change');
    })

    /*watch(() => order.items.map(i => _.pick(i, ['price', 'quantity'])), function () {
      console.log('changeItem');
    })*/

    /*watch(() => order.vSum, function () {
      console.log('trigger')
    })*/
  })

  hooks.post(':addItem', async function ({fn, args, index, chain, scope, query}, returnResult) {
    scope.items.push(args[0]);
  })

  hooks.post(':changeQuantity', async function ({fn, args, index, chain, scope, query}, returnResult) {
    scope.items[0].quantity = 10;
  })

  hooks.post(':print', async function ({fn, args, index, chain, scope}, returnResult) {
    console.log('print', scope);
  })

  hooks.post(':log', async function ({fn, args, index, chain, scope}, returnResult) {
    console.log(scope);
  })

  //await flow.on(':openTable').to({domain: 'customerdisplay'}).showOrder();
  /*await flow.on(':addItem').to({domain: 'customerdisplay'}).showOrder();
  await flow.on(':closeTable').to({domain: 'customerdisplay'}).showOrder();*/

  /*await flow.timeout(10).login('0000').openTable('10')
    .addItem({name: 'Cola', price: 1, quantity: 10})
    .addItem({name: 'Fanta', price: 1, quantity: 12})
    .discount('30%')
    .toBE()
    .print()
    .toFE()
    .route(':back');*/


  const _flow = await flow.scope({table: 10});
  await _flow.log();

  await flow.require(orm, {
    name: 'orm',
    chainable: true,
    /*wrapping: function () {
      if (arguments.length === 0) {
        return orm;
      } else {
        return orm(...arguments);
      }
    },*/
    whiteList: ['create']
  });


  //await flow.scope({order: {table: 1}}).orm('Order').create('@.order').end().log();
  await flow.shorthand(':createOrder').create('@').end();
  await flow.timeout(10).login('0000').openTable('10')
    .addItem({name: 'Cola', price: 1, quantity: 10})
    .addItem({name: 'Fanta', price: 2, quantity: 12})
    .addItem({name: 'Cola', price: 0, quantity: 1})
    .changeQuantity()
    .discount('30%')
    .computed()
    .toBE()
    .orm('Order').create('@').end()
    .log()

  await flow.orm('Order').count({}).end().log();
}

run();
