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
    done();
  });

  it("case4", async function() {
    const m1 = await Model.create({ items: [] });
    const m2 = await Model.findOneAndUpdate(
      { _id: m1._id },
      { $push: { items: { name: "fanta" } } }
    );
    const m3 = await Model.findOneAndUpdate(
      { _id: m1._id },
      { $push: { items: { $each: [{ name: "fanta" }, { name: "Pepsi" }] } } }
    );
    expect(stringify(m2)).toMatchInlineSnapshot(`
      Object {
        "_id": "ObjectID",
        "author": "ObjectID",
        "b": 100,
        "categories": Array [],
        "groups": Array [],
        "items": Array [
          Object {
            "_id": "ObjectID",
            "name": "fanta",
          },
        ],
        "strArr": Array [],
      }
    `);
    expect(stringify(m3)).toMatchInlineSnapshot(`
      Object {
        "_id": "ObjectID",
        "author": "ObjectID",
        "b": 100,
        "categories": Array [],
        "groups": Array [],
        "items": Array [
          Object {
            "_id": "ObjectID",
            "name": "fanta",
          },
          Object {
            "_id": "ObjectID",
            "name": "fanta",
          },
          Object {
            "_id": "ObjectID",
            "name": "Pepsi",
          },
        ],
        "strArr": Array [],
      }
    `);
  });
});
