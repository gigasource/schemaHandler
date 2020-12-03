const orm = require("../../../orm");
const { stringify } = require("../../../utils");
const FAKE_LAYER_TAG = require("../../../plugins/tags").FAKE_LAYER_TAG;
const _ = require("lodash");

describe("Fake document test", () => {
  let orderModel;
  let orderModelRecovery;
  beforeAll(async () => {
    orm.connect({ uri: "mongodb://localhost:27017" }, "myproject");
    orderModelRecovery = orm("Order-recovery");
    orderModel = orm("Order");
    await orderModelRecovery.deleteMany();
    await orderModel.deleteMany();
  });

  afterEach(async () => {
    await orderModel.deleteMany();
    await orderModelRecovery.deleteMany();
  });

  const cb = async function(query) {
    const last = _.last(query.chain);
    if (last.fn === "direct") {
      query.chain.pop();
      return;
    }
    query.mockCollection = true;
    orm.once(`proxyPreReturnValue:${query.uuid}`, async function(
      _query,
      target,
      exec
    ) {
      if (target.isMutateCmd) {
        await orm.emit(
          `${FAKE_LAYER_TAG}:preFakeDocuments`,
          _query.name,
          target.condition
        );
        this.value = await exec();
        await orm.emit(
          `${FAKE_LAYER_TAG}:postFakeDocuments`,
          _query.name,
          target.condition ? target.condition : this.value
        );
      } else {
        this.value = await exec();
      }
    });
  };

  it("Fake a create query", async () => {
    orm.on("pre:execChain", cb);

    const result = await orderModel.create({
      table: 10,
      items: [{ name: "cola", price: 10, quantity: 1 }]
    });
    expect(stringify(result)).toMatchInlineSnapshot(`
      Object {
        "_id": "ObjectID",
        "items": Array [
          Object {
            "name": "cola",
            "price": 10,
            "quantity": 1,
          },
        ],
        "table": 10,
      }
    `);
    const fakeDocument = await orderModel.findOne({ _id: result._id });
    const recoveryDoc = await orderModelRecovery.find();
    expect(recoveryDoc).toMatchInlineSnapshot(`Array []`);
    expect(stringify(fakeDocument)).toMatchInlineSnapshot(`
      Object {
        "_id": "ObjectID",
        "fake": true,
        "items": Array [
          Object {
            "name": "cola",
            "price": 10,
            "quantity": 1,
          },
        ],
        "table": 10,
      }
    `);
    orm.off("pre:execChain", cb);
    orderModel.deleteMany().direct();
    orderModelRecovery.deleteMany().direct();
  });

  it("Fake an exists doc", async () => {
    const doc = await orderModel.create({
      table: 10,
      items: [{ name: "cola", price: 10, quantity: 1 }]
    });
    orm.on("pre:execChain", cb);
    const recoveryPreLen = (await orderModelRecovery.find()).length;
    const result = await orderModel.findOneAndUpdate(
      { _id: doc._id },
      { table: 20 }
    );
    expect(stringify(result)).toMatchInlineSnapshot(`
      Object {
        "_id": "ObjectID",
        "items": Array [
          Object {
            "name": "cola",
            "price": 10,
            "quantity": 1,
          },
        ],
        "table": 20,
      }
    `);
    const original = await orderModelRecovery.findOne({ _id: doc._id });
    expect(stringify(original)).toMatchInlineSnapshot(`
      Object {
        "_id": "ObjectID",
        "items": Array [
          Object {
            "name": "cola",
            "price": 10,
            "quantity": 1,
          },
        ],
        "table": 10,
      }
    `);
    await orm.emit(`${FAKE_LAYER_TAG}:recover`, "Order", { _id: doc._id });
    await orm.emit(`${FAKE_LAYER_TAG}:postRecover`);
    const recovered = await orderModel.findOne({ _id: doc._id }).direct();
    expect(stringify(recovered)).toMatchInlineSnapshot(`
      Object {
        "_id": "ObjectID",
        "items": Array [
          Object {
            "name": "cola",
            "price": 10,
            "quantity": 1,
          },
        ],
        "table": 10,
      }
    `);
    const recoveryPostLength = (await orderModelRecovery.find()).length;
    expect(recoveryPostLength).toBe(recoveryPreLen);
    orm.off("pre:execChain", cb);
    orderModel.deleteMany().direct();
    orderModelRecovery.deleteMany().direct();
  });

  it("Fake many doc", async () => {
    await orderModel.create({
      table: 10,
      items: [{ name: "cola", price: 10, quantity: 1 }]
    });
    await orderModel.create({
      table: 10,
      items: [{ name: "fanta", price: 5, quantity: 2 }]
    });
    await orderModel.create({
      table: 9,
      items: [{ name: "matcha", price: 1, quantity: 2 }]
    });
    orm.on("pre:execChain", cb);
    await orderModel.updateMany({ table: 10 }, { $set: { test: true } });
    const orders = await orderModel.find();
    expect(stringify(orders)).toMatchInlineSnapshot(`
      Array [
        Object {
          "_id": "ObjectID",
          "fake": true,
          "items": Array [
            Object {
              "name": "cola",
              "price": 10,
              "quantity": 1,
            },
          ],
          "table": 10,
          "test": true,
        },
        Object {
          "_id": "ObjectID",
          "fake": true,
          "items": Array [
            Object {
              "name": "fanta",
              "price": 5,
              "quantity": 2,
            },
          ],
          "table": 10,
          "test": true,
        },
        Object {
          "_id": "ObjectID",
          "items": Array [
            Object {
              "name": "matcha",
              "price": 1,
              "quantity": 2,
            },
          ],
          "table": 9,
        },
      ]
    `);
    const original = await orderModelRecovery.find();
    expect(stringify(original)).toMatchInlineSnapshot(`
      Array [
        Object {
          "_id": "ObjectID",
          "items": Array [
            Object {
              "name": "cola",
              "price": 10,
              "quantity": 1,
            },
          ],
          "table": 10,
        },
        Object {
          "_id": "ObjectID",
          "items": Array [
            Object {
              "name": "fanta",
              "price": 5,
              "quantity": 2,
            },
          ],
          "table": 10,
        },
      ]
    `);
    await orm.emit(`${FAKE_LAYER_TAG}:recover`, "Order", { table: 10 });
    await orm.emit(`${FAKE_LAYER_TAG}:postRecover`);
    const recovered = await orderModel.find({ table: 10 });
    expect(stringify(recovered)).toMatchInlineSnapshot(`
      Array [
        Object {
          "_id": "ObjectID",
          "items": Array [
            Object {
              "name": "cola",
              "price": 10,
              "quantity": 1,
            },
          ],
          "table": 10,
        },
        Object {
          "_id": "ObjectID",
          "items": Array [
            Object {
              "name": "fanta",
              "price": 5,
              "quantity": 2,
            },
          ],
          "table": 10,
        },
      ]
    `);
    orm.off("pre:execChain", cb);
  });

  it("Fake delete", async () => {
    const doc = await orderModel.create({
      table: 10,
      items: [{ name: "cola", price: 10, quantity: 1 }]
    });
    orm.on("pre:execChain", cb);
    await orderModel.deleteOne({ _id: doc._id });
    const orders = await orderModel.find();
    expect(orders).toMatchInlineSnapshot(`Array []`);
    await orm.emit(`${FAKE_LAYER_TAG}:recover`, "Order", { _id: doc._id });
    await orm.emit(`${FAKE_LAYER_TAG}:postRecover`);
    const recovered = await orderModel.find();
    expect(stringify(recovered)).toMatchInlineSnapshot(`
      Array [
        Object {
          "_id": "ObjectID",
          "items": Array [
            Object {
              "name": "cola",
              "price": 10,
              "quantity": 1,
            },
          ],
          "table": 10,
        },
      ]
    `);
    orm.off("pre:execChain", cb);
  });

  it("Update to fake doc and insert direct", async () => {
    orm.on("pre:execChain", cb);
    const _doc = await orderModel.create({
      table: 10,
      items: [{ name: "cola", price: 10, quantity: 1 }]
    });
    const items = await orderModel.findOneAndUpdate(
      { _id: _doc._id },
      { $set: { test: true } }
    );
    expect(items._id.toString()).toBe(_doc._id.toString());
    const fakeItem = await orderModel.findOne({ _id: _doc._id });
    expect(stringify(fakeItem)).toMatchInlineSnapshot(`
      Object {
        "_id": "ObjectID",
        "fake": true,
        "items": Array [
          Object {
            "name": "cola",
            "price": 10,
            "quantity": 1,
          },
        ],
        "table": 10,
        "test": true,
      }
    `);
    await orm.emit(`${FAKE_LAYER_TAG}:recover`, "Order", { _id: _doc._id });
    await orm.emit(`${FAKE_LAYER_TAG}:postRecover`);
    await orderModel.create(items).direct();
    const orders = await orderModel.find();
    expect(stringify(orders)).toMatchInlineSnapshot(`
      Array [
        Object {
          "_id": "ObjectID",
          "fake": true,
          "items": Array [
            Object {
              "name": "cola",
              "price": 10,
              "quantity": 1,
            },
          ],
          "table": 10,
          "test": true,
        },
      ]
    `);
    const newItem = orm.off("pre:execChain", cb);
  });
});
