const {
  checkEqual2,
  convertSchemaToPaths,
  findAllPathsInLevelArrHandler2,
  parseCondition
} = require("../schemaHandler");
const { ObjectID } = require("bson");

let id = () => "5fb7f13453d00d8aace1d89b";
let paths;

function stringify() {
  return JSON.stringify(arguments[0], function(k, v) {
    if (this[k] instanceof ObjectID) {
      return "ObjectID";
    }
    return v;
  });
}

describe("checkEqual", function() {
  beforeAll(() => {
    paths = convertSchemaToPaths({
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
          products: [
            {
              items: [{}]
            }
          ]
        }
      ]
    });
  });

  it("categories.products._id", async function() {
    const arr = findAllPathsInLevelArrHandler2(
      paths,
      "categories.products._id".split(".")
    );
    expect(arr).toMatchInlineSnapshot(`
      Array [
        Object {
          "absolute": "categories.0.products.0._id",
          "relative": "",
        },
      ]
    `);
  });

  it("categories.products.$elemMatch._id.$in", async function() {
    const arr = findAllPathsInLevelArrHandler2(
      paths,
      "categories.products.$elemMatch._id.$in".split(".")
    );
    expect(arr).toMatchInlineSnapshot(`
      Array [
        Object {
          "absolute": "categories.0.products.0._id",
          "relative": "",
        },
      ]
    `);
  });

  it("categories.products", async function() {
    const arr = findAllPathsInLevelArrHandler2(
      paths,
      "categories.products".split(".")
    );
    //consider maybe not .0 at last
    expect(arr).toMatchInlineSnapshot(`
      Array [
        Object {
          "absolute": "categories.0.products",
          "relative": "",
        },
        Object {
          "absolute": "categories.0.products.0",
          "relative": "0",
        },
      ]
    `);
  });

  it("categories.products.items._id.$in", async function() {
    const arr = findAllPathsInLevelArrHandler2(
      paths,
      "categories.products.items._id.$in".split(".")
    );
    expect(arr).toMatchInlineSnapshot(`
      Array [
        Object {
          "absolute": "categories.0.products.0.items.0._id",
          "relative": "",
        },
      ]
    `);
  });

  it("case1", async function() {
    const _condition = parseCondition(paths, {
      _id: id()
    });
    expect(stringify(_condition)).toMatchInlineSnapshot(
      `"{\\"_id\\":\\"ObjectID\\"}"`
    );
  });

  it("case2", async function() {
    const _condition = parseCondition(paths, {
      "categories.products._id": id()
    });
    expect(stringify(_condition)).toMatchInlineSnapshot(
      `"{\\"categories.products._id\\":\\"ObjectID\\"}"`
    );
  });

  it("case2.1", async function() {
    const _condition = parseCondition(paths, {
      "categories.products": { _id: id() }
    });
    expect(stringify(_condition)).toMatchInlineSnapshot(
      `"{\\"categories.products\\":{\\"_id\\":\\"ObjectID\\"}}"`
    );
  });

  it("case2.2", async function() {
    const _condition = parseCondition(paths, {
      "categories.products": { _id: { $in: [id(), id()] } }
    });
    expect(stringify(_condition)).toMatchInlineSnapshot(
      `"{\\"categories.products\\":{\\"_id\\":{\\"$in\\":[\\"ObjectID\\",\\"ObjectID\\"]}}}"`
    );
  });

  it("case2.3", async function() {
    const _condition = parseCondition(paths, {
      groups: { $elemMatch: { $in: [id(), id()] } }
    });
    expect(stringify(_condition)).toMatchInlineSnapshot(
      `"{\\"groups\\":{\\"$elemMatch\\":{\\"$in\\":[\\"ObjectID\\",\\"ObjectID\\"]}}}"`
    );
  });

  it("case2.4", async function() {
    const _condition = parseCondition(paths, {
      "categories.products.items._id": { $in: [id(), id()] }
    });
    expect(stringify(_condition)).toMatchInlineSnapshot(
      `"{\\"categories.products.items._id\\":{\\"$in\\":[\\"ObjectID\\",\\"ObjectID\\"]}}"`
    );
  });

  it("case3", async function() {
    const _condition = parseCondition(paths, {
      author: id()
    });
    expect(stringify(_condition)).toMatchInlineSnapshot(
      `"{\\"author\\":\\"ObjectID\\"}"`
    );
  });
});
