const orm = require("../../../orm");
const { stringify } = require("../../../utils");
const FAKE_LAYER_TAG = require("../../../plugins/tags").FAKE_LAYER_TAG;
const _ = require("lodash");

describe("Fake document test", () => {
  let orderModel;
  let recovery;
  beforeAll(async () => {
    orm.connect({ uri: "mongodb://localhost:27017" }, "myproject");
    recovery = orm("Recovery");
    orderModel = orm("Order");
    await orderModel.deleteMany();
    await recovery.deleteMany();
  });

  afterEach(async () => {
    await orderModel.deleteMany();
    await recovery.deleteMany();
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
        const _this = this;
        this.value = (
          await orm.emit(
            `${FAKE_LAYER_TAG}:fakeDocuments`,
            _query.name,
            target.condition,
            exec
          )
        ).value;
      } else {
        this.value = await exec();
      }
    });
  };

  it("Fake a create query 1", async () => {
    await orderModel.create({
      table: 10,
      items: [{ name: "cola", price: 10, quantity: 1 }]
    });
    orm.on("pre:execChain", cb);
    await orderModel.create({
      table: 11,
      items: [{ name: "a", price: 12 }]
    });
    const orders = await orderModel.find({}).direct();
    expect(stringify(orders)).toMatchInlineSnapshot(`
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
          "fake": true,
          "items": Array [
            Object {
              "name": "a",
              "price": 12,
            },
          ],
          "table": 11,
        },
      ]
    `);
    orm.off("pre:execChain", cb);
  });

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
    const recoveryDoc = await recovery.find();
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
  });

  it("Fake an existing doc", async () => {
    const doc = await orderModel.create({
      table: 10,
      items: [{ name: "cola", price: 10, quantity: 1 }]
    });
    orm.on("pre:execChain", cb);
    const recoveryPreLen = (await recovery.find()).length;
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
    const original = await recovery.findOne({ _id: doc._id });
    expect(stringify(original)).toMatchInlineSnapshot(`
      Object {
        "_id": "ObjectID",
        "collectionName": "Order",
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
    const recoveryPostLength = (await recovery.find()).length;
    expect(recoveryPostLength).toBe(recoveryPreLen);
    orm.off("pre:execChain", cb);
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
    const original = await recovery.find();
    expect(stringify(original)).toMatchInlineSnapshot(`
      Array [
        Object {
          "_id": "ObjectID",
          "collectionName": "Order",
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
          "collectionName": "Order",
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

  // it("Test lock", async (done) => {
  //   const testFn = jest.fn(() => {});
  //   orm.on("pre:execChain", cb);
  //   await orm.emit(`${FAKE_LAYER_TAG}:recover`, "Order", {});
  //   const promise = new Promise(async (resolve, reject) => {
  //     await orderModel.create({
  //       table: 10,
  //       items: [{ name: "cola", price: 10, quantity: 1 }]
  //     });
  //     testFn();
  //     console.log('done')
  //     done()
  //     resolve()
  //   });
  //   setTimeout(async () => {
  //     expect(testFn.mock.calls.length).toBe(0);
  //     console.log('pre')
  //     await orm.emit(`${FAKE_LAYER_TAG}:postRecover`);
  //     orm.off("pre:execChain", cb);
  //   }, 100);
  // });

  it("Create many", async () => {
    await orderModel.create([
      {
        table: 5,
        items: [{ name: "pepsi", price: 10, quantity: 1 }]
      },
      {
        table: 9,
        items: [{ name: "tobaco", price: 10, quantity: 1 }]
      }
    ]);
    orm.on("pre:execChain", cb);
    await orderModel.create([
      {
        table: 10,
        items: [{ name: "cola", price: 10, quantity: 1 }]
      },
      {
        table: 15,
        items: [{ name: "fanta", price: 10, quantity: 1 }]
      }
    ]);
    const orders = await orderModel.find({});
    expect(stringify(orders)).toMatchInlineSnapshot(`
      Array [
        Object {
          "_id": "ObjectID",
          "items": Array [
            Object {
              "name": "pepsi",
              "price": 10,
              "quantity": 1,
            },
          ],
          "table": 5,
        },
        Object {
          "_id": "ObjectID",
          "items": Array [
            Object {
              "name": "tobaco",
              "price": 10,
              "quantity": 1,
            },
          ],
          "table": 9,
        },
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
        },
        Object {
          "_id": "ObjectID",
          "fake": true,
          "items": Array [
            Object {
              "name": "fanta",
              "price": 10,
              "quantity": 1,
            },
          ],
          "table": 15,
        },
      ]
    `);
    orm.off("pre:execChain", cb);
  });
});
