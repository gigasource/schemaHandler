const {
  checkEqual2,
  convertSchemaToPaths,
  findAllPathsInLevelArrHandler2,
  parseCondition
} = require("../schemaHandler");
const orm = require("../orm");
const { ObjectID } = require("bson");
const { stringify } = require("../utils");
const _ = require("lodash");
let id = () => "5fb7f13453d00d8aace1d89b";
let paths, Model, model, schema;
const uuid = require("uuid").v1;

describe("commit-sync", function() {
  beforeAll(async () => {
    orm.connect({ uri: "mongodb://localhost:27017" }, "myproject");
    schema = {
      table: String
    };
  });

  it("case1", async function(done) {
    const Model = orm("Model");
    //await Model.remove({})

    orm.pre("pre:execChain", async function(query) {
      query.uuid = uuid();
    });

    orm.on("pre:execChain", async function(query) {
      const last = _.last(query.chain);
      if (last.fn === "commit") {
        query.chain.pop();
        query.mockCollection = true;
        let _chain = [...query.chain];
        const { args } = last;
        const commit = {
          uuid: uuid(),
          tags: args.filter(arg => typeof arg === "string"),
          data: _.assign({}, ...args.filter(arg => typeof arg === "object")),
          chain: JSON.stringify(_chain),
          approved: false
        };

        //commitId: incremental
        //const CommitCol = orm(`${query.name}Commit`);
        //const _commit = await CommitCol.create(commit);
        //const r = await orm.emit(`commit:${query.name}`, commit, query);
        //_.assign(this, r);
        //remove later:
        query.commit = true;

        orm.once(`proxyPreReturnValue:${query.uuid}`, async function(
          _query,
          target
        ) {
          if (_.get(_query, "chain[0].args[0]._id")) {
            commit.data.docId = _.get(_query, "chain[0].args[0]._id");
          }
          await orm.emit(`commit:${_query.name}`, commit, _query);
        });
        //test behavior if not create model
      }
    });

    //Làm sao để assign duoc _id cho doc vua duoc tao ra
    //gen ra uuid cho mỗi câu lệnh query, từ đó hooks vào kết quả sau khi tạo ra
    //cần once : -> ko bị leak memory
    orm.default("commit:Model", async function(commit, query) {
      await orm.emit("toMaster", commit, query);
      await orm.emit("commit:build-fake:Model", commit, query);
    });

    orm.on("commit:build-fake:Model", async function(commit, query) {
      debugger;
    });

    orm.on("toMaster", async function(commit, query) {
      expect(stringify(commit)).toMatchInlineSnapshot(`
        Object {
          "approved": false,
          "chain": "[{\\"fn\\":\\"create\\",\\"args\\":[{\\"table\\":10,\\"items\\":[{\\"name\\":\\"cola\\",\\"price\\":10,\\"quantity\\":1}]}]}]",
          "data": Object {
            "docId": "ObjectID",
            "table": "10",
          },
          "tags": Array [
            "update",
          ],
          "uuid": "uuid-v1",
        }
      `);
      //socket io layer here
      orm.once(`approve:${commit.uuid}`, async function() {
        await orm.emit("commit:sync:Model");
        //sync data
      });
      const CommitCol = orm(`${query.name}Commit`);
      const _commit = await CommitCol.create(commit);
      orm.emit(`approve:${commit.uuid}`);
      done();
    });

    orm.on(`commit:sync:Model`, function() {});

    orm.on("//approve", async function() {
      //sync data
      //remove fake
      //build model
      //do something custom
    });

    //gen _id for parseSchema

    //order._fake = true;

    const m1 = await Model.create({
      table: 10,
      items: [{ name: "cola", price: 10, quantity: 1 }]
    }).commit("update", { table: "10" });

    //fake chi apply voi cac lenh apply cho one document

    //todo: save chain in db: use 1 collection ?? compound index?
    //todo: fake + approve process:
  });
});
