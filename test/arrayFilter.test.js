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
          name: String,
          products: [
            {
              name: String,
              items: [{}]
            }
          ]
        }
      ]
    });
  });

  it("case1", async function() {
    const filter1 = { "cate._id": id() };
    //todo: search prefix for $[cate]
    //todo: remove $[]
    //todo: convert filter1 -> cate = {'_id': id()}
    const condition = { "categories.$[cate].products.$[product].0": "100" };
    //const condition = {'categories.$[cate].name': 'test'}
    let arrayFilters = [filter1];
    parseCondition(paths, condition, { arrayFilters });
    expect(stringify(arrayFilters)).toMatchInlineSnapshot(
      `"[{\\"cate\\":{\\"_id\\":\\"ObjectID\\"}}]"`
    );
  });
  it("case2", async function() {
    const filter1 = { "cate._id": id() };
    const filter2 = { "product._id": id() };
    //todo: search prefix for $[cate]
    //todo: remove $[]
    //todo: convert filter1 -> cate = {'_id': id()}
    const condition = { "categories.$[cate].products.$[product].0": "100" };
    //const condition = {'categories.$[cate].name': 'test'}
    let arrayFilters = [filter1, filter2];
    parseCondition(paths, condition, { arrayFilters });
    expect(stringify(arrayFilters)).toMatchInlineSnapshot(
      `"[{\\"cate\\":{\\"_id\\":\\"ObjectID\\"}},{\\"product\\":{\\"_id\\":\\"ObjectID\\"}}]"`
    );
  });

  it("case3", async function() {
    const filter1 = { cate: { _id: id() } };
    const filter2 = { "product._id": id() };
    //todo: search prefix for $[cate]
    //todo: remove $[]
    //todo: convert filter1 -> cate = {'_id': id()}
    const condition = { "categories.$[cate].products.$[product].0": "100" };
    //const condition = {'categories.$[cate].name': 'test'}
    let arrayFilters = [filter1, filter2];
    parseCondition(paths, condition, { arrayFilters });
    expect(stringify(arrayFilters)).toMatchInlineSnapshot(
      `"[{\\"_id\\":\\"ObjectID\\"},{\\"product\\":{\\"_id\\":\\"ObjectID\\"}}]"`
    );
  });
});
