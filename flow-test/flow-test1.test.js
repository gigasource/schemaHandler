const orm = require("../orm");
const {ObjectID} = require("bson");
const {reactive, computed, watch, watchEffect, toRaw, h} = require('vue');
const {hooks, flow} = require('../flow/flow');
const _ = require('lodash');
let id = () => "5fb7f13453d00d8aace1d89b";
let paths, Model, model;

function stringify() {
  return JSON.parse(
    JSON.stringify(
      arguments[0],
      function (k, v) {
        if (
          this[k] instanceof ObjectID ||
          (typeof this[k] === "object" && ObjectID.isValid(this[k]))
        ) {
          return "ObjectID";
        }
        return v;
      },
      4
    )
  );
}

async function run() {
  flow.hooks.post(':openTable', async function ({fn, args, index, chain, scope, query}, returnResult) {
    const order = reactive({table: args[0], items: []})
    query.scope = order;
    watchEffect(function () {
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

  await flow.require(orm, {
    name: 'orm',
    chainable: true,
  });


  //await flow.scope({order: {table: 1}}).orm('Order').create('@.order').end().log();
  /*await flow.shorthand(':createOrder').create('@').end();
  await flow.timeout(10).login('0000').openTable('10')
    .addItem({name: 'Cola', price: 1, quantity: 10})
    .addItem({name: 'Fanta', price: 2, quantity: 20})
    .addItem({name: 'Cola', price: 0, quantity: 1})
    .changeQuantity()
    .discount('30%')
    .computed()
    .toBE()
    .orm('Order').create('@').end()
    .log()

  await flow.orm('Order').count({}).end().log();*/
}

describe("test flow 1", function () {
  beforeAll(async done => {
    orm.connect({uri: "mongodb://localhost:27017"}, "myproject");
    const schema = {
      a: Number,
      b: {
        type: Number,
        default: 100
      },
      items: [{}],
      date: Date,
      strArr: [String],
      groups: [
        {
          type: ObjectID
        }
      ],
      author: {
        type: ObjectID
      },
      categories: [
        {
          name: String,
          products: [
            {
              name: String,
              items: [{}]
            }
          ]
        }
      ]
    };
    //paths = convertSchemaToPaths(schema);
    Model = orm.registerSchema("Model", schema);
    await Model.remove();
    model = await Model.create({
      categories: [
        {
          name: "catA",
          products: [{name: "A"}, {name: "B"}]
        },
        {
          name: "catB",
          products: [{name: "C"}, {name: "D"}]
        }
      ]
    });
    await run();
    done();
  });

  it("case1", async function () {
    await flow.shorthand(':createOrder').create('@').end();
    await flow.timeout(10).login('0000').openTable('10')
      .addItem({name: 'Cola', price: 1, quantity: 10})
      .addItem({name: 'Fanta', price: 2, quantity: 20})
      .addItem({name: 'Cola', price: 0, quantity: 1})
      .changeQuantity()
      .discount('30%')
      .computed()
      .toBE()
      .orm('Order').create('@').end()
      .log()

    await flow.orm('Order').count({}).end().log();
  });

  it("update file", async function () {
    await flow.to({domain: 'online-order'}).registerDialog('placeId',<dialog></dialog>);

    await flow
      .buildpkg().zipfile().makeMd5()
      .checkExistsVersion().uploadToServer('server')
      .showNotification('upload finished')
      .to({domain: 'online-order'})
      .showNotification()


  });
});
