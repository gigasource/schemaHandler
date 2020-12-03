const orm = require("../../../orm");
const { stringify } = require("../../../utils");
const FAKE_LAYER_TAG = require("../../../plugins/tags").FAKE_LAYER_TAG;
const _ = require("lodash");

describe("Fake document test", () => {
  beforeAll(async () => {
    orm.connect({ uri: "mongodb://localhost:27017" }, "myproject");
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

    const orderModel = orm("Order");
    const orderModelRecovery = orm("Order-recovery");
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

  it("Fake an exists doc", async () => {
    const orderModel = orm("Order");
    const orderModelRecovery = orm("Order-recovery");
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
  });

  it('Fake many doc')
});
