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
    await orm.setDefaultDb("myproject");
    orm.registerSchema("Model", schema);
    const ModelSchema = orm.getSchema("Model");
    expect(ModelSchema).toMatchInlineSnapshot(`
      Object {
        "_id": Object {
          "$options": Object {
            "default": [Function],
          },
          "$type": "ObjectID",
        },
        "a": Object {
          "$type": "Number",
        },
        "author": Object {
          "$options": Object {},
          "$type": "ObjectID",
        },
        "b": Object {
          "$options": Object {
            "default": 100,
          },
          "$type": "Number",
        },
        "categories": Object {
          "$options": Object {
            "default": Array [],
          },
          "$type": "Array",
        },
        "categories.0": Object {
          "$options": Object {},
          "$type": "Object",
        },
        "categories.0._id": Object {
          "$options": Object {
            "default": [Function],
          },
          "$type": "ObjectID",
        },
        "categories.0.name": Object {
          "$type": "String",
        },
        "categories.0.products": Object {
          "$options": Object {
            "default": Array [],
          },
          "$type": "Array",
        },
        "categories.0.products.0": Object {
          "$options": Object {},
          "$type": "Object",
        },
        "categories.0.products.0._id": Object {
          "$options": Object {
            "default": [Function],
          },
          "$type": "ObjectID",
        },
        "categories.0.products.0.items": Object {
          "$options": Object {
            "default": Array [],
          },
          "$type": "Array",
        },
        "categories.0.products.0.items.0": Object {
          "$options": Object {},
          "$type": "Object",
        },
        "categories.0.products.0.items.0._id": Object {
          "$options": Object {
            "default": [Function],
          },
          "$type": "ObjectID",
        },
        "categories.0.products.0.name": Object {
          "$type": "String",
        },
        "date": Object {
          "$type": "Date",
        },
        "groups": Object {
          "$options": Object {
            "default": Array [],
          },
          "$type": "Array",
        },
        "groups.0": Object {
          "$options": Object {},
          "$type": "ObjectID",
        },
        "items": Object {
          "$options": Object {
            "default": Array [],
          },
          "$type": "Array",
        },
        "items.0": Object {
          "$options": Object {},
          "$type": "Object",
        },
        "items.0._id": Object {
          "$options": Object {
            "default": [Function],
          },
          "$type": "ObjectID",
        },
        "strArr": Object {
          "$options": Object {
            "default": Array [],
          },
          "$type": "Array",
        },
        "strArr.0": Object {
          "$type": "String",
        },
      }
    `);
  });

  it("case2", async function() {
    await orm.setDefaultDb("myproject");
    const Model = orm.getCollection("Model");
    expect(Model.modelName).toMatchInlineSnapshot(`"Model@myproject"`);
  });

  it("case3", async function() {
    await orm.setDefaultDb("myproject");
    const Model = orm._getCollection("Model");
    expect(Model.s.namespace).toMatchInlineSnapshot(`
      MongoDBNamespace {
        "collection": "models",
        "db": "myproject",
      }
    `);
  });

  it("case4", async function() {
    await orm.setDefaultDb("myproject");
    orm.registerCollectionOptions("Model", { w: 1 });
    const options = orm.getOptions("Model");
    expect(options).toMatchInlineSnapshot(`
      Object {
        "w": 1,
      }
    `);
  });

  it("case5", async function() {});
});
