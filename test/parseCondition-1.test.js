const {
  checkEqual2,
  convertSchemaToPaths,
  findAllPathsInLevelArrHandler2,
  parseCondition
} = require("../schemaHandler");
const { ObjectID } = require("bson");
const { stringify } = require("../utils");

let id = () => "5fb7f13453d00d8aace1d89b";
let paths;

describe("parseCondition 1", function() {
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
    const condition = { groups: { $elemMatch: { $in: [id(), id()] } } };
    //const condition = {'categories.$[cate].name': 'test'}
    const _condition = parseCondition(paths, condition);
    expect(stringify(_condition)).toMatchInlineSnapshot(`
      Object {
        "groups": Object {
          "$elemMatch": Object {
            "$in": Array [
              "ObjectID",
              "ObjectID",
            ],
          },
        },
      }
    `);
  });
});
