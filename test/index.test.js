const {
  checkEqual2,
  convertSchemaToPaths,
  findAllPathsInLevelArrHandler2,
  parseCondition
} = require("../schemaHandler");
const orm = require("../orm");
const { ObjectID } = require("bson");
const { stringify } = require("../utils");

let id = () => "5fb7f13453d00d8aace1d89b";
let paths, Model, model, schema;

describe("checkEqual", function() {
  beforeAll(async () => {
    orm.setMultiDbMode();
    orm.connect({ uri: "mongodb://localhost:27017" });
    schema = {
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
  });

  it("case1", async function() {
    const Model = orm("Model2", "myproject");
    await Model.remove();
    const indexes = await Model.indexes();
    expect(indexes).toMatchInlineSnapshot(`
      Array [
        Object {
          "key": Object {
            "_id": 1,
          },
          "name": "_id_",
          "ns": "myproject.models",
          "v": 2,
        },
      ]
    `);
  });

  it("case2", async function() {
    const Model = orm("Model2", "myproject");
    await Model.remove();
    const m1 = await Model.create({ _id: id(), a: 1 });
    try {
      const m2 = await Model.create({ _id: id(), a: 2 });
    } catch (e) {
      expect(e.message.slice(0, 6)).toMatchInlineSnapshot(`"E11000"`);
    }
  });
});
