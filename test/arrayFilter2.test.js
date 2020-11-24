const {
  checkEqual2,
  convertSchemaToPaths,
  findAllPathsInLevelArrHandler2,
  parseCondition
} = require("../schemaHandler");
const orm = require("../orm");
const { ObjectID } = require("bson");

let id = () => "5fb7f13453d00d8aace1d89b";
let paths, Model, model;

function stringify() {
  return JSON.parse(
    JSON.stringify(
      arguments[0],
      function(k, v) {
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

describe("checkEqual", function() {
  beforeAll(async done => {
    orm.connect({ uri: "mongodb://localhost:27017" }, "myproject");
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
    //Model = orm.getCollection('Model')
    await Model.remove();
    model = await Model.create({
      categories: [
        {
          name: "catA",
          products: [{ name: "A" }, { name: "B" }]
        },
        {
          name: "catB",
          products: [{ name: "C" }, { name: "D" }]
        }
      ]
    });
    done();
  });

  it("case4", async function() {
    const filter1 = { "cate._id": model.categories[1]._id.toString() };
    const filter2 = {
      "product._id": model.categories[1].products[1]._id.toString()
    };
    const condition = {
      $set: { "categories.$[cate].products.$[product].name": "D2" }
    };
    /*const condition = {
      $set: { "categories.$[cate].name": "catB2" }
    };*/
    //const condition = {'categories.$[cate].name': 'test'}
    let arrayFilters = [filter1, filter2];
    /*parseCondition(paths, condition, {arrayFilters});
    expect(stringify(arrayFilters)).toMatchInlineSnapshot(
      `"[{\\"_id\\":\\"ObjectID\\"},{\\"product\\":{\\"_id\\":\\"ObjectID\\"}}]"`
    );*/
    const _model = await Model.findOneAndUpdate({ _id: model._id }, condition, {
      arrayFilters
    });
    expect(stringify(arrayFilters)).toMatchInlineSnapshot(`
      Array [
        Object {
          "cate._id": "ObjectID",
        },
        Object {
          "product._id": "ObjectID",
        },
      ]
    `);
    expect(stringify(_model)).toMatchInlineSnapshot(`
      Object {
        "_id": "ObjectID",
        "categories": Array [
          Object {
            "_id": "ObjectID",
            "name": "catA",
            "products": Array [
              Object {
                "_id": "ObjectID",
                "items": Array [],
                "name": "A",
              },
              Object {
                "_id": "ObjectID",
                "items": Array [],
                "name": "B",
              },
            ],
          },
          Object {
            "_id": "ObjectID",
            "name": "catB",
            "products": Array [
              Object {
                "_id": "ObjectID",
                "items": Array [],
                "name": "C",
              },
              Object {
                "_id": "ObjectID",
                "items": Array [],
                "name": "D2",
              },
            ],
          },
        ],
        "groups": Array [],
        "items": Array [],
        "strArr": Array [],
      }
    `);
  });

  it("case5: without schema", async function() {
    const filter1 = { "cate._id": new ObjectID() };
    const filter2 = {
      "product._id": new ObjectID()
    };
    const condition = {
      $set: { "categories.$[cate].products.$[product].name": "D2" }
    };
    /*const condition = {
      $set: { "categories.$[cate].name": "catB2" }
    };*/
    //const condition = {'categories.$[cate].name': 'test'}
    let arrayFilters = [filter1, filter2];
    /*parseCondition(paths, condition, {arrayFilters});
    expect(stringify(arrayFilters)).toMatchInlineSnapshot(
      `"[{\\"_id\\":\\"ObjectID\\"},{\\"product\\":{\\"_id\\":\\"ObjectID\\"}}]"`
    );*/
    const Model2 = orm.getCollection("Model2");
    const _model = await Model2.findOneAndUpdate(
      { _id: model._id },
      condition,
      {
        arrayFilters
      }
    );
    expect(stringify(arrayFilters)).toMatchInlineSnapshot(`
      Array [
        Object {
          "cate._id": "ObjectID",
        },
        Object {
          "product._id": "ObjectID",
        },
      ]
    `);
    expect(stringify(_model)).toMatchInlineSnapshot(`
      Object {
        "lastErrorObject": Object {
          "n": 0,
          "updatedExisting": false,
        },
        "ok": 1,
        "value": null,
      }
    `);
  });
});
