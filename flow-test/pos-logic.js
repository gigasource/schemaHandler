const {hooks, flow, getRestChain, execChain} = require('../flow/flow');
const {reactive, computed, watch, watchEffect, h} = require('vue');
const _ = require('lodash');
const {stringify, inspect} = require("../utils");

async function initOrderLogic() {
  flow.hooks.on(':openTable', async function ({fn, args, index, chain, scope, query}) {
    const order = reactive({table: args[0], items: [], takeAway: false})
    query.scope = order;

    //vSum
    watchEffect(() => {
      order.vSum = _.sumBy(order.items, 'vSum');
    })

    //item.vSum
    watchEffect(() => {
      for (const item of order.items) {
        const vSum = item.price * item.quantity + _.sumBy(item.modifiers, m => m.price * m.quantity);
        item.vSum = vSum - (item.vDiscount || 0);
      }
    })

    //takeAway
    watchEffect(() => {
      for (const item of order.items) {
        item.vTakeAway = order.takeAway || item.takeAway;
      }
    })

    //taxes
    watchEffect(() => {
      for (const item of order.items) {
        if (item.taxes) {
          item.tax = item.vTakeAway ? item.taxes[1] : item.taxes[0];
        }
      }
    })

    //discount
    watchEffect(() => {
      const discount = order.discount;
      if (discount) {
        for (const item of order.items) {
          if (_.endsWith(discount, '%') && !item.discount) {
            item.discount = discount;
          }
          if (item.discount) {
            const _discount = parseFloat(item.discount.replace('%', ''));
            item.vDiscount = +(item.vSum * _discount / 100).toFixed(2);
          }
        }
        order.vDiscount = _.sumBy(order.items, 'vDiscount')/*.toFixed(2)*/;
      }
    })

    //vTaxSum
    watchEffect(() => {
      for (const item of order.items) {
        item.vTaxSum = [{tax: item.tax}]
      }
    })


    /*watch(() => stringify(order.items), function () {
      console.log('trigger items change');
    })

    watch(() => order.items.map(i => _.pick(i, ['price', 'quantity'])), function () {
      console.log('changeItem');
    })

    watch(() => order.vSum, function () {
      console.log('trigger')
    })*/
  })

  hooks.on(':addItem', async function ({fn, args, index, chain, scope, query}) {
    scope.items.push(args[0]);
  })

  hooks.on(':takeAway', async function ({fn, args, index, chain, scope, query}) {
    const [takeAway = true] = args;
    scope.takeAway = takeAway;
  })

  hooks.on(':addModifiers', async function ({fn, args, index, chain, scope, query}) {
    const last = _.last(scope.items);
    if (last) {
      last.modifiers = last.modifiers || [];
      last.modifiers.push(args[0]);
    }
  })

  hooks.on(':changeQuantity', async function ({fn, args, index, chain, scope, query}) {
    scope.items[0].quantity = 10;
  })

  hooks.on(':discount', async function ({fn, args, index, chain, scope, query}) {
    scope.discount = args[0];
  })

  hooks.on(':logOrder', async function ({fn, args, index, chain, scope, query}) {
    console.log(inspect(scope));
    console.table(scope.items);
  })
}

module.exports = {initOrderLogic}
