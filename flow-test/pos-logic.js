const {hooks, flow, getRestChain, execChain} = require('../flow/flow');
const {reactive, computed, watch, watchEffect, h} = require('vue');
const _ = require('lodash');
const {stringify, inspect} = require("../utils");

async function initOrderLogic() {
  flow.hooks.post(':openTable', async function ({fn, args, index, chain, scope, query}, returnResult) {
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

  hooks.post(':addItem', async function ({fn, args, index, chain, scope, query}, returnResult) {
    scope.items.push(args[0]);
  })

  hooks.post(':takeAway', async function ({fn, args, index, chain, scope, query}, returnResult) {
    const [takeAway = true] = args;
    scope.takeAway = takeAway;
  })

  hooks.post(':addModifiers', async function ({fn, args, index, chain, scope, query}, returnResult) {
    const last = _.last(scope.items);
    if (last) {
      last.modifiers = last.modifiers || [];
      last.modifiers.push(args[0]);
    }
  })

  hooks.post(':changeQuantity', async function ({fn, args, index, chain, scope, query}, returnResult) {
    scope.items[0].quantity = 10;
  })

  hooks.post(':discount', async function ({fn, args, index, chain, scope, query}, returnResult) {
    scope.discount = args[0];
  })

  hooks.post(':logOrder', async function ({fn, args, index, chain, scope, query}, returnResult) {
    console.log(inspect(scope));
    console.table(scope.items);
  })
}

module.exports = {initOrderLogic}
